/**
 * Legacy demo-data audit (G-16 follow-up) — CHECK-ONLY.
 *
 * Detects the well-known demo tenant / demo login emails / demo-seeding
 * settings in a database, so an operator can decide what to do before a
 * real customer goes live. This module NEVER deletes, disables, or modifies
 * anything, and NEVER reads or prints passwords/hashes/tokens.
 *
 * Verdicts:
 *  - PASS            — no known demo identities/settings found.
 *  - ACTION REQUIRED — at least one known demo identity or unsafe setting.
 *  - NOT VERIFIED    — the database could not be inspected (no claim made).
 *
 * Not every record containing the word "demo" is a finding: only the exact
 * identities the demo provisioning creates are flagged. Remediation is an
 * operator decision (see docs/COMMERCIAL_RELEASE_READINESS.md).
 */
import { eq, inArray } from 'drizzle-orm';
import { member, organization, user } from '../../../engines/platform/src/auth/schema.js';
import type { AnyPgDatabase } from '../../../engines/platform/src/db/with-tenant.js';
import { DEMO_ACCOUNTS, DEMO_TENANT } from '../../../engines/platform/src/demo-seed.js';

export type DemoAuditStatus = 'PASS' | 'ACTION REQUIRED' | 'NOT VERIFIED';
export interface DemoAuditFinding { code: string; message: string }
export interface DemoAuditReport { status: DemoAuditStatus; findings: DemoAuditFinding[] }

/** The exact identities demo provisioning creates (single source of truth). */
export function knownDemoIdentities(): { slug: string; emails: string[] } {
  return { slug: DEMO_TENANT.slug, emails: DEMO_ACCOUNTS.map((a) => a.email.toLowerCase()) };
}

export async function auditLegacyDemo(
  db: AnyPgDatabase | null,
  env: Record<string, string | undefined> = process.env,
): Promise<DemoAuditReport> {
  const findings: DemoAuditFinding[] = [];

  if (env.NODE_ENV === 'production' && (env.DEMO_SEED === 'true' || env.DEMO_SEED === '1')) {
    findings.push({
      code: 'demo_seed_enabled_in_production',
      message: 'إعداد DEMO_SEED مفعّل في بيئة إنتاج — أوقفه فورًا (تشغيل الخادم نفسه يرفض الإقلاع بهذه الحالة وفق G-16).',
    });
  }

  if (!db) {
    findings.push({ code: 'database_not_inspected', message: 'لم يتم فحص قاعدة البيانات (غير متصلة) — لا يمكن الحكم على وجود حسابات تجريبية.' });
    return { status: 'NOT VERIFIED', findings };
  }

  try {
    const { slug, emails } = knownDemoIdentities();

    const demoOrgs = await db.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.slug, slug));
    for (const org of demoOrgs) {
      findings.push({
        code: 'demo_tenant_present',
        message: `محل تجريبي معروف موجود (slug=${slug}، الاسم: ${org.name}). وجوده في بيئة عميل حقيقي يتطلب قرار تشغيلي موثقًا (حذف/عزل) — لا يُحذف تلقائيًا.`,
      });
    }

    const demoUsers = await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.email, emails));
    for (const u of demoUsers) {
      // Which tenant(s) does this known demo login belong to? Membership in a
      // REAL tenant is the dangerous case (shared, publicly-known identity).
      const memberships = await db
        .select({ organizationId: member.organizationId, slug: organization.slug, role: member.role })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, u.id));
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
