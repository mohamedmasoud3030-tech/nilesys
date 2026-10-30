/**
 * Legacy demo-data audit — CHECK-ONLY (never modifies anything).
 *
 *   npm run api:audit-demo
 *
 * Requires DATABASE_URL (or the PGlite dev database). Prints a verdict:
 * PASS / ACTION REQUIRED / NOT VERIFIED with findings. No passwords,
 * hashes, or tokens are read or printed. Exit codes: 0 = PASS,
 * 1 = ACTION REQUIRED, 2 = NOT VERIFIED (so CI/ops can gate on it).
 */
import { openDatabase } from '../../../engines/db/open.js';
import { auditLegacyDemo } from '../src/demo-audit.js';

let opened: Awaited<ReturnType<typeof openDatabase>> | null = null;
try {
  opened = await openDatabase();
} catch {
  opened = null;
}

const report = await auditLegacyDemo(opened?.db ?? null);
console.log(`\nLegacy demo audit: ${report.status}`);
for (const f of report.findings) console.log(` - [${f.code}] ${f.message}`);
if (!report.findings.length) console.log(' - لم تُرصد أي هوية تجريبية معروفة أو ضبط تجريبي خطير.');
console.log('\nهذا الفحص تقاريري فقط — لم يُحذف أو يُعطَّل أي شيء. أي إصلاح قرار تشغيلي موثق (انظر docs/COMMERCIAL_RELEASE_READINESS.md).');

await opened?.close().catch(() => {});
process.exit(report.status === 'PASS' ? 0 : report.status === 'ACTION REQUIRED' ? 1 : 2);
