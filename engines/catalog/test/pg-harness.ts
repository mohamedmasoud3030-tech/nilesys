/**
 * Disposable real-PostgreSQL harness for the lead / people service tests.
 *
 * Same pattern as engines/db/test/pool-resilience.pg.test.ts (N-1): it runs only
 * when NILE_TEST_PG_ADMIN_URL points at a DISPOSABLE server whose login can
 * create databases and roles (a superuser on a throwaway local cluster), e.g.
 *
 *   NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5471/postgres pnpm vitest run engines
 *
 * Per run it creates: a database, an owner role (runs migrations) and a login
 * role (NOSUPERUSER NOBYPASSRLS, member of the runtime role nile_app). The
 * runtime pool is opened through the production path (open.ts → openPostgres),
 * so every query runs as nile_app under FORCE ROW LEVEL SECURITY. Everything
 * except the cluster-wide nile_app role is dropped in dispose().
 *
 * Lives under engines/catalog/test (not engines/db) so the shared db engine,
 * which other workers are changing, is not touched.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { openPostgres, RUNTIME_ROLE, type OpenedDatabase } from '../../db/open.js';

export const ADMIN_URL = process.env.NILE_TEST_PG_ADMIN_URL;

export interface PgHarness {
  /** Runtime pool (login role → SET ROLE nile_app), the production code path. */
  opened: OpenedDatabase;
  /** URL for extra raw connections as the login role (e.g. lock holders). */
  loginUrl: string;
  dbName: string;
  /** Superuser connection to the test database (observation only: pg_stat_activity, catalog checks). */
  observer: pg.Client;
  dispose(): Promise<void>;
}

const DUPLICATE_OBJECT = '42710';
const UNIQUE_VIOLATION = '23505';
const TUPLE_CONCURRENTLY_UPDATED = 'XX000';

async function ensureRuntimeRole(admin: pg.Client): Promise<void> {
  // Several test files may race to create the cluster-wide role; tolerate the loser.
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RUNTIME_ROLE]);
  if (rowCount) return;
  try {
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== DUPLICATE_OBJECT && code !== UNIQUE_VIOLATION) throw e;
  }
}

async function retryCatalogRace<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i < 5 && (code === TUPLE_CONCURRENTLY_UPDATED || code === UNIQUE_VIOLATION)) continue;
      throw e;
    }
  }
}

export async function createPgHarness(label: string): Promise<PgHarness> {
  if (!ADMIN_URL) throw new Error('NILE_TEST_PG_ADMIN_URL is not set');
  const suffix = randomBytes(4).toString('hex');
  const dbName = `nile_${label}_${suffix}`;
  const owner = `nile_${label}_own_${suffix}`;
  const login = `nile_${label}_app_${suffix}`;
  const password = randomBytes(16).toString('hex'); // throwaway, never logged

  const urlFor = (user: string | null, database: string) => {
    const u = new URL(ADMIN_URL);
    if (user) {
      u.username = user;
      u.password = password;
    }
    u.pathname = `/${database}`;
    return u.toString();
  };

  const admin = rawClient(ADMIN_URL);
  await admin.connect();
  let observer: pg.Client | undefined;
  let opened: OpenedDatabase | undefined;
  const dispose = async () => {
    await opened?.close().catch(() => undefined);
    await observer?.end().catch(() => undefined);
    // pg-pool's end() resolves once clients are REMOVED, before their sockets close.
    // Dropping WITH (FORCE) at that moment sends FATAL 57P01 to a still-open pooled
    // client, which re-emits it on the Pool — and openPostgres (main) attaches no
    // pool 'error' listener (N-1, fixed on fix/nile-pool-error-listener), so it
    // would surface as an uncaught exception. Wait for the backends to leave first.
    for (let i = 0; i < 250; i++) {
      const { rows } = await admin.query<{ n: string }>('SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1', [dbName]);
      if (Number(rows[0]?.n) === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${login}`);
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    await admin.end();
  };

  try {
    await admin.query(`CREATE ROLE ${owner} LOGIN CREATEROLE NOSUPERUSER PASSWORD '${password}'`);
    await admin.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    await ensureRuntimeRole(admin);
    await retryCatalogRace(() => admin.query(`GRANT ${RUNTIME_ROLE} TO ${login}`));
    await admin.query(`CREATE DATABASE ${dbName} OWNER ${owner}`);

    const loginUrl = urlFor(login, dbName);
    const migrated = await openPostgres({ url: loginUrl, migrationUrl: urlFor(owner, dbName) });
    await migrated.close();
    opened = await openPostgres({ url: loginUrl });

    observer = rawClient(urlFor(null, dbName));
    await observer.connect();
    return { opened, loginUrl, dbName, observer, dispose };
  } catch (e) {
    await dispose().catch(() => undefined);
    throw e;
  }
}

/**
 * A raw pg.Client with an 'error' listener: an idle client whose backend is
 * terminated (e.g. by DROP DATABASE ... WITH (FORCE) in dispose) must not crash
 * the test process with an unhandled 'error' event.
 */
export function rawClient(connectionString: string): pg.Client {
  const c = new pg.Client({ connectionString });
  c.on('error', () => undefined);
  return c;
}

/** Polls pg_stat_activity until `n` backends of this database are waiting on a heavyweight lock. */
export async function waitForLockWaiters(observer: pg.Client, dbName: string, n: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await observer.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'`,
      [dbName],
    );
    if (Number(rows[0]?.n) >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters (have ${rows[0]?.n})`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Opens a raw login-role transaction, as nile_app with the tenant context set, that holds a row lock until released. */
export async function holdRowLock(loginUrl: string, tenantId: string, table: string, id: string) {
  const c = rawClient(loginUrl);
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rowCount } = await c.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (rowCount !== 1) throw new Error(`lock target ${table}/${id} not visible`);
  } catch (e) {
    await c.end().catch(() => undefined);
    throw e;
  }
  return {
    release: async () => {
      await c.query('COMMIT');
      await c.end();
    },
  };
}
