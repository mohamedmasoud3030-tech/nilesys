/**
 * Nile API server entrypoint.
 *   DATABASE_URL / MIGRATION_DATABASE_URL → PostgreSQL (production)
 *   otherwise → PGlite (real PostgreSQL, in-process) at NILE_PGLITE_DIR
 *
 * Boot safety (G-16): the demo tenant is seeded ONLY outside production
 * (see env-guard.ts). Production refuses to start with demo seeding
 * requested, without BETTER_AUTH_SECRET, or without DATABASE_URL.
 * First real customers are created explicitly via `npm run api:provision`.
 */
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { createApp } from './app.js';
import { assertBootSafety } from './env-guard.js';
import { demoTenantSpec, provisionTenant } from './provision.js';

const { production, seedDemo } = assertBootSafety(process.env);
const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
// Production secret presence is enforced by assertBootSafety above; the
// ephemeral fallback exists only for local development convenience.
const secret = process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString('hex');

const opened = await openDatabase({ ...process.env, NILE_PGLITE_DIR: process.env.NILE_PGLITE_DIR ?? 'apps/api/.local/db' });
const auth = createAuth(opened.db, {
  baseURL,
  secret,
  production,
  // Dev/preview: trust the origin the browser actually uses (proxied preview
  // hosts). Production: explicit allow-list only.
  trustedOrigins: production
    ? (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean)
    : async (req?: Request) => [baseURL, req?.headers.get('origin') ?? ''].filter(Boolean),
});
let demoNote = 'demo seed off';
if (seedDemo) {
  const seeded = await provisionTenant(auth, opened.db, demoTenantSpec());
  demoNote = `demo tenant ${seeded.created ? 'created' : 'present'}`;
}
const { app } = await createApp({ db: opened.db, auth }, { serveWeb: true });

await app.listen({ port, host: '0.0.0.0' });
console.log(`Nile API on :${port} (db=${opened.driver}, ${demoNote})`);
