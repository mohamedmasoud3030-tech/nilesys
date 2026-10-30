/**
 * First-customer onboarding — explicit, operator-run, NEVER at server boot.
 *
 *   NILE_TENANT_SLUG=acme-store \
 *   NILE_TENANT_NAME="متجر النور" \
 *   NILE_MANAGER_EMAIL=owner@example.com \
 *   npm run api:provision
 *
 * Optional: NILE_MANAGER_PASSWORD, NILE_CASHIER_EMAIL, NILE_CASHIER_PASSWORD
 * (passwords are generated and printed ONCE when not supplied — store them
 * in a password manager; they are never written anywhere else), and
 * NILE_CATALOG_FILE=/path/items.json (array of catalog items, see
 * docs/COMMERCIAL_RELEASE_READINESS.md). Without a catalog file the tenant
 * starts empty and a warning is printed.
 *
 * Idempotent: re-running for an existing slug is a no-op (passwords and
 * data are NOT touched). Requires the same DATABASE_URL / BETTER_AUTH_SECRET
 * environment as the API server.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { customerTenantSpec, provisionTenant } from '../src/provision.js';
import type { NewCatalogItem } from '../../../engines/catalog/src/catalog-service.js';

const genPassword = () => randomBytes(15).toString('base64url'); // 20 chars

const env = process.env;
const managerPassword = env.NILE_MANAGER_PASSWORD ?? genPassword();
const generated: string[] = [];
if (!env.NILE_MANAGER_PASSWORD) generated.push('manager');
let cashierPassword: string | undefined;
if (env.NILE_CASHIER_EMAIL) {
  cashierPassword = env.NILE_CASHIER_PASSWORD ?? genPassword();
  if (!env.NILE_CASHIER_PASSWORD) generated.push('cashier');
}

let catalog: NewCatalogItem[] = [];
if (env.NILE_CATALOG_FILE) {
  const parsed: unknown = JSON.parse(await readFile(env.NILE_CATALOG_FILE, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('NILE_CATALOG_FILE must contain a JSON array of catalog items');
  catalog = parsed as NewCatalogItem[];
}

const spec = customerTenantSpec({
  slug: env.NILE_TENANT_SLUG,
  name: env.NILE_TENANT_NAME,
  managerEmail: env.NILE_MANAGER_EMAIL,
  managerPassword,
  managerName: env.NILE_MANAGER_NAME,
  cashierEmail: env.NILE_CASHIER_EMAIL,
  cashierPassword,
  cashierName: env.NILE_CASHIER_NAME,
  catalog,
});

const secret = env.BETTER_AUTH_SECRET;
if (!secret) throw new Error('BETTER_AUTH_SECRET is required (use the same value as the API server)');

const opened = await openDatabase({ ...env, NILE_PGLITE_DIR: env.NILE_PGLITE_DIR ?? 'apps/api/.local/db' });
try {
  const auth = createAuth(opened.db, {
    baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    secret,
    production: env.NODE_ENV === 'production',
  });
  const { tenantId, created } = await provisionTenant(auth, opened.db, spec);
  if (!created) {
    console.log(`Tenant "${spec.slug}" already exists (${tenantId}) — nothing changed. Passwords were NOT reset.`);
  } else {
    console.log(`Tenant "${spec.slug}" created (${tenantId}).`);
    console.log(`  manager: ${spec.accounts[0]!.email}`);
    if (generated.includes('manager')) console.log(`  manager password (shown once): ${managerPassword}`);
    const cashier = spec.accounts.find((a) => a.role === 'cashier');
    if (cashier) {
      console.log(`  cashier: ${cashier.email}`);
      if (generated.includes('cashier')) console.log(`  cashier password (shown once): ${cashierPassword}`);
    }
    if (catalog.length === 0) console.log('  ⚠ catalog is EMPTY — the shop cannot sell until items exist (see readiness doc, G-03).');
    else console.log(`  catalog: ${catalog.length} item(s) seeded.`);
  }
} finally {
  await opened.close();
}
