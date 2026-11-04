/**
 * G-16 — commercial provisioning safety.
 * Proves, over real HTTP + real PGlite:
 *  - an unseeded boot (the production posture) knows NO demo accounts,
 *  - the boot guard refuses demo seeding / missing secrets in production,
 *  - a real customer spec rejects the demo identity and weak passwords,
 *  - provisioning a customer works with DISTINCT manager/cashier passwords,
 *  - re-running provisioning never resets an existing customer's password.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth, type NileAuth } from '../../../engines/platform/src/auth/auth.js';
import { organization } from '../../../engines/platform/src/auth/schema.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { assertBootSafety } from '../src/env-guard.js';
import { customerTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-provisioning-0123456789-abcdef';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-provision-'));

let opened: OpenedDatabase;
let auth: NileAuth;
let created: CreatedApp;

async function signIn(email: string, password: string): Promise<number> {
  const res = await created.app.getHttpAdapter().getInstance().inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: BASE, 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  });
  return res.statusCode;
}

beforeAll(async () => {
  opened = await openPglite({ dataDir });
  auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  // Production posture: NO provisionTenant call at boot.
  created = await createApp({ db: opened.db, auth }, { logger: false });
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('boot guard (pure)', () => {
  it('production without secret is refused', () => {
    expect(() => assertBootSafety({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(/BETTER_AUTH_SECRET/);
  });
  it('production without DATABASE_URL is refused', () => {
    expect(() => assertBootSafety({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 's' })).toThrow(/DATABASE_URL/);
  });
  it('production with demo seed requested is refused', () => {
    expect(() => assertBootSafety({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 's', DATABASE_URL: 'postgres://x', NILE_SEED_DEMO: '1' })).toThrow(/forbidden in production/);
  });
  it('valid production boots with demo seed OFF', () => {
    expect(assertBootSafety({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 's', DATABASE_URL: 'postgres://x' })).toEqual({ production: true, seedDemo: false });
  });
  it('development keeps isolated demo seed by default, opt-out works', () => {
    expect(assertBootSafety({}).seedDemo).toBe(true);
    expect(assertBootSafety({ NILE_SEED_DEMO: '0' }).seedDemo).toBe(false);
  });
});

describe('customer spec guards', () => {
  const base = { slug: 'acme-store', name: 'متجر', managerEmail: 'owner@acme.test', managerPassword: 'long-manager-pass-1' };
  it('refuses the demo slug / demo emails / demo password / short passwords', () => {
    expect(() => customerTenantSpec({ ...base, slug: 'nile-demo' })).toThrow(/demo slug/);
    expect(() => customerTenantSpec({ ...base, managerEmail: 'x@nile.demo' })).toThrow(/@nile\.demo/);
    expect(() => customerTenantSpec({ ...base, managerPassword: 'demo1234' })).toThrow(/at least 12|demo password/);
    expect(() => customerTenantSpec({ ...base, managerPassword: 'short' })).toThrow(/at least 12/);
  });
  it('refuses cashier sharing the manager password', () => {
    expect(() => customerTenantSpec({ ...base, cashierEmail: 'c@acme.test', cashierPassword: base.managerPassword })).toThrow(/must differ/);
  });
});

describe('unseeded boot + real customer lifecycle', () => {
  it('demo accounts do not exist and cannot sign in', async () => {
    expect(await signIn('cashier@nile.demo', 'demo1234')).toBe(401);
    expect(await signIn('pos-manager@nile.demo', 'demo1234')).toBe(401);
    const orgs = await opened.db.select({ id: organization.id }).from(organization);
    expect(orgs).toHaveLength(0);
  });

  it('provisions a customer with distinct passwords; both sign in; cross-password fails', async () => {
    const spec = customerTenantSpec({
      slug: 'acme-store', name: 'متجر النور',
      managerEmail: 'owner@acme.test', managerPassword: 'manager-secret-42',
      cashierEmail: 'till@acme.test', cashierPassword: 'cashier-secret-42',
      catalog: [{ nameAr: 'صنف', nameEn: 'Item', category: 'x', priceMinor: 100, variants: [{ sku: 'A-1', labelAr: 'افتراضي', labelEn: 'Default', stock: '5' }] }],
    });
    const first = await provisionTenant(auth, opened.db, spec);
    expect(first.created).toBe(true);
    expect(await signIn('owner@acme.test', 'manager-secret-42')).toBe(200);
    expect(await signIn('till@acme.test', 'cashier-secret-42')).toBe(200);
    expect(await signIn('till@acme.test', 'manager-secret-42')).toBe(401);
  });

  it('re-provisioning is a no-op and never resets the customer password', async () => {
    const again = customerTenantSpec({
      slug: 'acme-store', name: 'متجر النور',
      managerEmail: 'owner@acme.test', managerPassword: 'attacker-password-99',
    });
    const second = await provisionTenant(auth, opened.db, again);
    expect(second.created).toBe(false);
    expect(await signIn('owner@acme.test', 'manager-secret-42')).toBe(200);
    expect(await signIn('owner@acme.test', 'attacker-password-99')).toBe(401);
    // and the demo identity still does not exist after all this
    expect(await signIn('cashier@nile.demo', 'demo1234')).toBe(401);
  });
});
