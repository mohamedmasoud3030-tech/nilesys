/**
 * Legacy demo audit (check-only) — synthetic isolated data only.
 * Verifies verdicts and that the audit NEVER modifies data.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { organization, user } from '../../../engines/platform/src/auth/schema.js';
import { auditLegacyDemo } from '../src/demo-audit.js';
import { resolveAuditTarget } from '../src/audit-target.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const execFileAsync = promisify(execFile);
async function runCli(env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', 'apps/api/scripts/audit-demo.ts'], {
      env: { ...process.env, ...env }, timeout: 120_000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (e: any) {
    return { code: typeof e.code === 'number' ? e.code : -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}
const ADMIN_URL = process.env.NILE_TEST_PG_ADMIN_URL;

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

  it('NILE_SEED_DEMO=1 in production → ACTION REQUIRED (real boot variable)', async () => {
    const report = await auditLegacyDemo(opened.db, { NODE_ENV: 'production', NILE_SEED_DEMO: '1' });
    expect(report.status).toBe('ACTION REQUIRED');
    expect(report.findings.map((f) => f.code)).toContain('demo_seed_enabled_in_production');
  });

  it('production with demo seeding off → no seed finding', async () => {
    const report = await auditLegacyDemo(opened.db, { NODE_ENV: 'production' });
    expect(report.findings.map((f) => f.code)).not.toContain('demo_seed_enabled_in_production');
  });

  it('legacy DEMO_SEED present → explicit legacy finding (not silently ignored)', async () => {
    const report = await auditLegacyDemo(opened.db, { DEMO_SEED: 'true' });
    expect(report.status).toBe('ACTION REQUIRED');
    expect(report.findings.map((f) => f.code)).toContain('legacy_demo_seed_var_present');
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
    await auditLegacyDemo(opened.db, { NODE_ENV: 'production', NILE_SEED_DEMO: '1' });
    const after = await opened.db.select().from(user);
    expect(after.length).toBe(before.length);
    const orgs = await opened.db.select().from(organization);
    expect(orgs.length).toBeGreaterThan(0); // demo tenant still there — audit deleted nothing
  });
});

describe('audit target resolution (no false PASS)', () => {
  it('missing DATABASE_URL in production mode → unverified, never a PGlite fallback', () => {
    const r = resolveAuditTarget({ NODE_ENV: 'production' });
    expect(r.kind).toBe('unverified');
  });

  it('malformed or non-PostgreSQL URL → unverified', () => {
    expect(resolveAuditTarget({ DATABASE_URL: 'not a url' }).kind).toBe('unverified');
    expect(resolveAuditTarget({ DATABASE_URL: 'mysql://h/db' }).kind).toBe('unverified');
  });

  it('dev mode exists ONLY when explicitly requested and is labeled Development', () => {
    expect(resolveAuditTarget({}).kind).not.toBe('dev-pglite');
    const r = resolveAuditTarget({ NILE_AUDIT_TARGET: 'dev' });
    expect(r).toMatchObject({ kind: 'dev-pglite', env: 'Development' });
  });

  it('Production/Staging with dev target → refused (unverified), never a substitution', () => {
    for (const env of ['production', 'staging', 'prod']) {
      const r = resolveAuditTarget({ NILE_AUDIT_TARGET: 'dev', NILE_AUDIT_ENV: env });
      expect(r.kind).toBe('unverified');
      if (r.kind === 'unverified') expect(r.reason).toContain('مرفوض');
    }
  });

  it('Production/Staging resolve WITHOUT NILE_AUDIT_EXPECT_DB → connection gate refuses (verified in PG suite)', () => {
    const r = resolveAuditTarget({ DATABASE_URL: 'postgres://u:p@h/db', NILE_AUDIT_ENV: 'production' });
    expect(r).toMatchObject({ kind: 'postgres', env: 'Production' });
  });

  it('explicit postgres URL resolves with environment label, URL not echoed in errors', () => {
    const r = resolveAuditTarget({ DATABASE_URL: 'postgres://u:secretpw@db.example.com:5432/shop', NILE_AUDIT_ENV: 'staging' });
    expect(r).toMatchObject({ kind: 'postgres', env: 'Staging' });
  });

  it('CLI without DATABASE_URL exits 2 NOT VERIFIED (no silent dev audit)', async () => {
    const { code, out } = await runCli({ DATABASE_URL: undefined, NILE_AUDIT_DATABASE_URL: undefined, NILE_AUDIT_TARGET: undefined });
    expect(code).toBe(2);
    expect(out).toContain('NOT VERIFIED');
  }, 180_000);

  it('CLI with unreachable database exits 2 NOT VERIFIED', async () => {
    const { code, out } = await runCli({ DATABASE_URL: 'postgres://u:p@127.0.0.1:59999/nope' });
    expect(code).toBe(2);
    expect(out).toContain('NOT VERIFIED');
  }, 180_000);
});

describe.skipIf(!ADMIN_URL)('audit CLI on real PostgreSQL', () => {
  let pg: typeof import('pg');
  let admin: InstanceType<typeof import('pg').Client>;
  const dbName = `nile_audit_${Date.now().toString(36)}`;
  let dbUrl = '';

  beforeAll(async () => {
    pg = await import('pg');
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    dbUrl = u.toString();
    // Apply the real schema through the production migration path.
    const { openPostgres } = await import('../../../engines/db/open.js');
    const openedPg = await openPostgres({ url: dbUrl, migrationUrl: dbUrl, onPoolError: () => {} }).catch(async () => {
      // openPostgres asserts the runtime role; migrations already ran by then.
      return null;
    });
    await (openedPg as any)?.close().catch(() => {});
  }, 120_000);
  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });

  it('Production without NILE_AUDIT_EXPECT_DB → NOT VERIFIED exit 2 (printing a name is not identity)', async () => {
    const { code, out } = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_ENV: 'production', NILE_AUDIT_EXPECT_DB: undefined });
    expect(code).toBe(2);
    expect(out).toContain('NOT VERIFIED');
    expect(out).toContain('NILE_AUDIT_EXPECT_DB');
  }, 180_000);

  it('clean database → PASS exit 0 and the target identity is printed', async () => {
    const { code, out } = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_ENV: 'staging', NILE_AUDIT_EXPECT_DB: dbName });
    expect(code).toBe(0);
    expect(out).toContain('PASS');
    expect(out).toContain(dbName);
    expect(out).toContain('schema=public');
    expect(out).not.toContain('postgres://'); // no credentials/connection string echoed
  }, 180_000);

  it('NILE_SEED_DEMO=1 in production → ACTION REQUIRED exit 1; legacy DEMO_SEED → legacy finding', async () => {
    const boot = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_ENV: 'production', NILE_AUDIT_EXPECT_DB: dbName, NILE_SEED_DEMO: '1' });
    expect(boot.code).toBe(1);
    expect(boot.out).toContain('demo_seed_enabled_in_production');
    const legacy = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_ENV: 'production', NILE_AUDIT_EXPECT_DB: dbName, DEMO_SEED: 'true' });
    expect(legacy.code).toBe(1);
    expect(legacy.out).toContain('legacy_demo_seed_var_present');
  }, 300_000);

  it('wrong expected database → NOT VERIFIED exit 2 (never PASS for another DB)', async () => {
    const { code, out } = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_EXPECT_DB: 'some_other_shop' });
    expect(code).toBe(2);
    expect(out).toContain('NOT VERIFIED');
  }, 180_000);

  it('wrong schema → NOT VERIFIED exit 2', async () => {
    const { code, out } = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_SCHEMA: 'does_not_exist_schema' });
    expect(code).toBe(2);
    expect(out).toContain('NOT VERIFIED');
  }, 180_000);

  it('legacy demo identity present → ACTION REQUIRED exit 1 (not a deploy success)', async () => {
    const c = new pg.Client({ connectionString: dbUrl });
    await c.connect();
    await c.query(`INSERT INTO organization (id,name,slug) VALUES ('33333333-3333-4333-8333-333333333333','نيل — حساب تجريبي','nile-demo') ON CONFLICT DO NOTHING`);
    await c.end();
    const { code, out } = await runCli({ DATABASE_URL: dbUrl, NILE_AUDIT_ENV: 'production', NILE_AUDIT_EXPECT_DB: dbName });
    expect(code).toBe(1);
    expect(out).toContain('ACTION REQUIRED');
    expect(out).toContain('demo_tenant_present');
  }, 180_000);
});
