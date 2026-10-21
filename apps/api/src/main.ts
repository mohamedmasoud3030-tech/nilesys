/**
 * Nile API server entrypoint.
 *   DATABASE_URL / MIGRATION_DATABASE_URL → PostgreSQL (production)
 *   otherwise → PGlite (real PostgreSQL, in-process) at NILE_PGLITE_DIR
 * The demo tenant is provisioned on boot if missing.
 */
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { createApp } from './app.js';
import { demoTenantSpec, provisionTenant } from './provision.js';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
const secret = process.env.BETTER_AUTH_SECRET ?? (production ? '' : randomBytes(32).toString('hex'));
if (!secret) throw new Error('BETTER_AUTH_SECRET is required in production');

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
const seeded = await provisionTenant(auth, opened.db, demoTenantSpec());
const { app } = await createApp({ db: opened.db, auth }, { serveWeb: true });

await app.listen({ port, host: '0.0.0.0' });
console.log(`Nile API on :${port} (db=${opened.driver}, demo tenant ${seeded.created ? 'created' : 'present'})`);
