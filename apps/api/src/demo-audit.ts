/**
 * Legacy demo-data audit (G-16 follow-up) — CHECK-ONLY.
 *
 * Detects the well-known demo tenant / demo login emails / demo-seeding
 * settings in a database, so an operator can decide what to do before a
 * real customer goes live. This module NEVER deletes, disables, or modifies
 * anything, and NEVER reads or prints passwords/hashes/tokens.
 *
 * Verdicts:
 *  - PASS            — the IDENTIFIED target was fully inspected and no known
 *                      demo identities/settings were found.
 *  - ACTION REQUIRED — at least one known demo identity or unsafe setting.
 *  - NOT VERIFIED    — target missing/unreachable/unidentifiable (no claim).
 *
 * The canonical core is auditLegacyDemoSql over an injected read-only query
 * function, so the production CLI can run it on a verified, read-only
 * connection (see audit-target.ts) — a PASS can never come from the wrong
 * database or from rows hidden by an unintended role/session. The drizzle
 * adapter auditLegacyDemo(db) exists for tests and explicit dev mode only.
 *
 * Not every record containing the word "demo" is a finding: only the exact
 * identities the demo provisioning creates are flagged. Remediation is an
 * operator decision (see docs/COMMERCIAL_RELEASE_READINESS.md).
 */
import { sql } from 'drizzle-orm';
import type { AnyPgDatabase } from '../../../engines/platform/src/db/with-tenant.js';
import { DEMO_ACCOUNTS, DEMO_TENANT } from '../../../engines/platform/src/demo-seed.js';

export type DemoAuditStatus = 'PASS' | 'ACTION REQUIRED' | 'NOT VERIFIED';
export interface DemoAuditFinding { code: string; message: string }
export interface DemoAuditReport { status: DemoAuditStatus; findings: DemoAuditFinding[] }

export type SqlQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** The exact identities demo provisioning creates (single source of truth). */
export function knownDemoIdentities(): { slug: string; emails: string[] } {
  return { slug: DEMO_TENANT.slug, emails: DEMO_ACCOUNTS.map((a) => a.email.toLowerCase()) };
}

function seedFinding(env: Record<string, string | undefined>, findings: DemoAuditFinding[]) {
  if (env.NODE_ENV === 'production' && (env.DEMO_SEED === 'true' || env.DEMO_SEED === '1')) {
    findings.push({
      code: 'demo_seed_enabled_in_production',
      message: 'إعداد DEMO_SEED مفعّل في بيئة إنتاج — أوقفه فورًا (تشغيل الخادم نفسه يرفض الإقلاع بهذه الحالة وفق G-16).',
    });
  }
}

/** Canonical audit over an injected read-only SQL query function. */
export async function auditLegacyDemoSql(
  query: SqlQuery | null,
  env: Record<string, string | undefined> = process.env,
): Promise<DemoAuditReport> {
  const findings: DemoAuditFinding[] = [];
  seedFinding(env, findings);

  if (!query) {
    findings.push({ code: 'database_not_inspected', message: 'لم يتم فحص قاعدة البيانات (غير متصلة) — لا يمكن الحكم على وجود حسابات تجريبية.' });
    return { status: 'NOT VERIFIED', findings };
  }

  try {
    const { slug, emails } = knownDemoIdentities();

    const demoOrgs = (await query('SELECT id, name FROM organization WHERE slug = $1', [slug])).rows;
    for (const org of demoOrgs) {
      findings.push({
        code: 'demo_tenant_present',
        message: `محل تجريبي معروف موجود (slug=${slug}، الاسم: ${org.name}). وجوده في بيئة عميل حقيقي يتطلب قرار تشغيلي موثقًا (حذف/عزل) — لا يُحذف تلقائيًا.`,
      });
    }

    const placeholders = emails.map((_, i) => `$${i + 1}`).join(',');
    const demoUsers = (await query(`SELECT id, email FROM "user" WHERE lower(email) IN (${placeholders})`, emails)).rows;
    for (const u of demoUsers) {
      // Which tenant(s) does this known demo login belong to? Membership in a
      // REAL tenant is the dangerous case (shared, publicly-known identity).
      const memberships = (await query(
        `SELECT o.slug AS slug FROM member m JOIN organization o ON o.id = m.organization_id WHERE m.user_id = $1`,
        [u.id],
      )).rows;
      const realTenants = memberships.filter((m: { slug: string }) => m.slug !== slug);
      if (realTenants.length) {
        findings.push({
          code: 'demo_login_in_real_tenant',
          message: `حساب دخول تجريبي معروف (${u.email}) عضو في محل غير تجريبي (slug: ${realTenants.map((m: { slug: string }) => m.slug).join(', ')}). هذا خطر مباشر: غيّر/احذف الحساب بقرار تشغيلي قبل التشغيل الفعلي.`,
        });
      } else {
        findings.push({
          code: 'demo_login_present',
          message: `حساب تجريبي معروف موجود (${u.email}) — مقبول فقط داخل المحل التجريبي المعزول، ويجب تأكيد عدم استخدامه فعليًا أمام عميل.`,
        });
      }
    }
  } catch {
    findings.push({ code: 'database_inspection_failed', message: 'تعذّر استعلام قاعدة البيانات أثناء الفحص — أعد التشغيل باتصال صحيح ولا تفترض النتيجة.' });
    return { status: 'NOT VERIFIED', findings };
  }

  return { status: findings.length ? 'ACTION REQUIRED' : 'PASS', findings };
}

/**
 * Drizzle adapter (tests + explicit dev mode). Converts $n placeholders to
 * drizzle sql parameters — the core's statements are ours, with at most one
 * parameter each, so the mapping stays exact.
 */
export async function auditLegacyDemo(
  db: AnyPgDatabase | null,
  env: Record<string, string | undefined> = process.env,
): Promise<DemoAuditReport> {
  if (!db) return auditLegacyDemoSql(null, env);
  const query: SqlQuery = async (text, params = []) => {
    const parts = text.split(/\$\d+/);
    let frag = sql.raw(parts[0] ?? '');
    for (let i = 1; i < parts.length; i++) frag = sql`${frag}${params[i - 1]}${sql.raw(parts[i] ?? '')}`;
    const res: any = await (db as any).execute(frag);
    return { rows: (res.rows ?? res) as any[] };
  };
  return auditLegacyDemoSql(query, env);
}
