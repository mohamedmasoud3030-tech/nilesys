/**
 * Legacy demo-data audit — CHECK-ONLY (never modifies anything).
 *
 *   DATABASE_URL=postgres://… npm run api:audit-demo
 *
 * Target safety (final-review fix): the audit NEVER falls back to a local
 * dev database. A production/staging audit requires an explicit PostgreSQL
 * URL (NILE_AUDIT_DATABASE_URL or DATABASE_URL); the connected database is
 * identified from the server, forced read-only, and printed (without
 * credentials) BEFORE any verdict. Optional strong guards:
 *   NILE_AUDIT_EXPECT_DB=<name>      refuse if current_database() differs
 *   NILE_AUDIT_SCHEMA=<schema>       set search_path (then verify)
 *   NILE_AUDIT_EXPECT_SCHEMA=<sch>   refuse if active schema differs
 *   NILE_AUDIT_ENV=production|staging|development   label shown in output
 * Explicit development audit (PGlite, labeled as such) exists ONLY with
 *   NILE_AUDIT_TARGET=dev [NILE_PGLITE_DIR=…]
 *
 * Verdicts: PASS (exit 0) · ACTION REQUIRED (exit 1) · NOT VERIFIED (exit 2).
 * No passwords/hashes/tokens are read or printed. PASS means the printed,
 * identified target was fully inspected — nothing else.
 */
import { openPglite } from '../../../engines/db/open.js';
import { auditLegacyDemo, auditLegacyDemoSql, type DemoAuditReport } from '../src/demo-audit.js';
import { openVerifiedAuditConnection, resolveAuditTarget } from '../src/audit-target.js';

const exitFor = (report: DemoAuditReport) =>
  report.status === 'PASS' ? 0 : report.status === 'ACTION REQUIRED' ? 1 : 2;

const target = resolveAuditTarget();
let report: DemoAuditReport;

if (target.kind === 'unverified') {
  console.log('\nLegacy demo audit: NOT VERIFIED');
  console.log(` - [target_not_selected] ${target.reason}`);
  process.exit(2);
}

if (target.kind === 'dev-pglite') {
  console.log(`\nالهدف المفحوص: PGlite (تطوير محلي صريح) · dir=${target.dataDir ?? '(ذاكرة مؤقتة)'} · env=Development`);
  console.log('⚠️  نتائج وضع التطوير لا تعني أي شيء عن أي قاعدة إنتاج.');
  const opened = await openPglite({ dataDir: target.dataDir });
  try {
    report = await auditLegacyDemo(opened.db);
  } finally {
    await opened.close().catch(() => {});
  }
} else {
  let conn: Awaited<ReturnType<typeof openVerifiedAuditConnection>>;
  try {
    conn = await openVerifiedAuditConnection(target);
  } catch (e) {
    console.log('\nLegacy demo audit: NOT VERIFIED');
    console.log(` - [target_not_verified] تعذّر التحقق من هدف الفحص: ${e instanceof Error ? e.message : 'خطأ اتصال'} — لم يُفحص أي شيء ولا يُفترض نظافة البيئة.`);
    process.exit(2);
  }
  console.log(`\nالهدف المفحوص: ${conn.identity.detail}`);
  try {
    report = await auditLegacyDemoSql(conn.query);
  } finally {
    await conn.close();
  }
}

console.log(`Legacy demo audit: ${report.status}`);
for (const f of report.findings) console.log(` - [${f.code}] ${f.message}`);
if (!report.findings.length) console.log(' - لم تُرصد أي هوية تجريبية معروفة أو ضبط تجريبي خطير.');
console.log('\nهذا الفحص تقاريري فقط — لم يُحذف أو يُعطَّل أي شيء. أي إصلاح قرار تشغيلي موثق (انظر docs/COMMERCIAL_RELEASE_READINESS.md).');
process.exit(exitFor(report));
