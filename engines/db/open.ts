/**
 * ONE deterministic migration + connection path (ADR-0004), shared by the
 * API, the tests, and (later) the offline desktop builds.
 *
 *   migrate as OWNER  →  switch to runtime role `nile_app`  →  assert the
 *   effective role cannot bypass RLS (refuse to start otherwise).
 *
 * - PostgreSQL (production): DATABASE_URL = runtime login (member of
 *   nile_app); MIGRATION_DATABASE_URL = owner login.
 * - PGlite (tests, dev, offline desktop): a real PostgreSQL engine in-process;
 *   single connection, so we migrate first and then `SET ROLE nile_app`.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.js';

export { schema };
export const RUNTIME_ROLE = 'nile_app';
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * One handle type for both drivers. Both are Drizzle `PgDatabase`s over the
 * same schema and expose `{ rows }` from execute(); we type them as the
 * node-postgres flavour so call sites are not a union of overloads.
 */
export type NileDb = NodePgDatabase<typeof schema>;

export interface OpenedDatabase {
  db: NileDb;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

export class UnsafeRuntimeRoleError extends Error {}

/** Fail closed: the runtime connection must never be able to bypass RLS. */
export async function assertRuntimeRole(db: NileDb): Promise<string> {
  const res = (await db.execute(
    sql`SELECT current_user AS role, r.rolsuper AS super, r.rolbypassrls AS bypass
        FROM pg_roles r WHERE r.rolname = current_user`,
  )) as unknown as { rows: Array<{ role: string; super: boolean; bypass: boolean }> };
  const row = res.rows[0];
  if (!row) throw new UnsafeRuntimeRoleError('cannot determine runtime role');
  if (row.super || row.bypass) {
    throw new UnsafeRuntimeRoleError(`runtime role "${row.role}" can bypass RLS — refusing to start (ADR-0005 §7)`);
  }
  return row.role;
}

export async function openPglite(opts: { dataDir?: string } = {}): Promise<OpenedDatabase> {
  if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true }); // first boot
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as NileDb;
  await migratePglite(db as never, { migrationsFolder }); // as owner (PGlite default superuser)
  await client.exec(`SET ROLE ${RUNTIME_ROLE}`);
  await assertRuntimeRole(db);
  return { db, driver: 'pglite', close: () => client.close() };
}

/**
 * An idle pooled connection can be terminated by the server at any moment: `pg_terminate_backend`,
 * a PostgreSQL restart, a failover, a pooler cutting an idle session. `pg` re-emits that as an
 * `error` event on the Pool, and an EventEmitter `error` with no listener throws — which took the
 * whole API process down (finding N-1, observed on PostgreSQL 18.4, pg 8.23.1, SQLSTATE 57P01).
 *
 * The pool already discards the dead client and opens a fresh one; the process only has to survive
 * the notification. Exported separately so the wiring is testable without a live server.
 */
export function attachPoolErrorHandler(
  pool: { on: (event: 'error', fn: (err: Error) => void) => unknown },
  onError: (err: Error) => void = (err) => console.error('[db] idle connection error (pool will replace the client):', err.message),
): void {
  // pg types the Pool 'error' listener as (err: Error, client: PoolClient). A narrower
  // (err) => void is assignable at runtime and is all this handler needs.
  pool.on('error', onError as (err: Error) => void);
}

export async function openPostgres(opts: { url: string; migrationUrl?: string; onPoolError?: (err: Error) => void }): Promise<OpenedDatabase> {
  if (opts.migrationUrl) {
    const owner = new pg.Pool({ connectionString: opts.migrationUrl, max: 1 });
    try {
      await migratePg(drizzlePg(owner, { schema }), { migrationsFolder });
    } finally {
      await owner.end();
    }
  }
  const pool = new pg.Pool({ connectionString: opts.url });
  // N-1: survive a server-side kill of an idle client instead of exiting the process.
  attachPoolErrorHandler(pool, opts.onPoolError);
  // Every pooled connection assumes the runtime role before first use.
  pool.on('connect', (c) => void c.query(`SET ROLE ${RUNTIME_ROLE}`));
  const db = drizzlePg(pool, { schema });
  await assertRuntimeRole(db);
  return { db, driver: 'postgres', close: () => pool.end() };
}

export async function openDatabase(env: NodeJS.ProcessEnv = process.env): Promise<OpenedDatabase> {
  if (env.DATABASE_URL) return openPostgres({ url: env.DATABASE_URL, migrationUrl: env.MIGRATION_DATABASE_URL });
  return openPglite({ dataDir: env.NILE_PGLITE_DIR });
}
