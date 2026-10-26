/**
 * Legacy demo audit (check-only) — synthetic isolated data only.
 * Verifies verdicts and that the audit NEVER modifies data.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { organization, user } from '../../../engines/platform/src/auth/schema.js';
import { auditLegacyDemo } from '../src/demo-audit.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const dataDir = mkdtempSync(join(tmpdir(), 'nile-demo-audit-'));
let opened: OpenedDatabase;

beforeAll(async () => { opened = await openPglite({ dataDir }); });
afterAll(async () => { await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('auditLegacyDemo (check-only)', () => {
  it('empty database → PASS', async () => {
    const report = await auditLegacyDemo(opened.db, {});
    expect(report.status).toBe('PASS');
    expect(report.findings).toEqual([]);
  });

  it('no database → NOT VERIFIED (no false claim)', async () => {
    const report = await auditLegacyDemo(null, {});
    expect(report.status).toBe('NOT VERIFIED');
  });

  it('DEMO_SEED in production env → ACTION REQUIRED even without DB rows', async () => {
    const report = await auditLegacyDemo(opened.db, { NODE_ENV: 'production', DEMO_SEED: 'true' });
    expect(report.status).toBe('ACTION REQUIRED');
    expect(report.findings.map((f) => f.code)).toContain('demo_seed_enabled_in_production');
  });

  it('demo tenant present → ACTION REQUIRED with identity findings, never secrets', async () => {
    const auth = createAuth(opened.db, { baseURL: 'http://localhost:3000', secret: 'test-secret-demo-audit-0123456789-ab', trustedOrigins: ['http://localhost:3000'] });
    await provisionTenant(auth, opened.db, demoTenantSpec());
    const report = await auditLegacyDemo(opened.db, {});
    expect(report.status).toBe('ACTION REQUIRED');
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('demo_tenant_present');
    expect(codes).toContain('demo_login_present');
    const printed = JSON.stringify(report);
    expect(printed).not.toContain('demo1234');
    expect(printed).not.toContain('password');
  });

  it('audit is read-only: row counts unchanged after running', async () => {
    const before = await opened.db.select().from(user);
    await auditLegacyDemo(opened.db, { NODE_ENV: 'production', DEMO_SEED: 'true' });
    const after = await opened.db.select().from(user);
    expect(after.length).toBe(before.length);
    const orgs = await opened.db.select().from(organization);
    expect(orgs.length).toBeGreaterThan(0); // demo tenant still there — audit deleted nothing
  });
});
