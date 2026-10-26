/**
 * Pre-migration check for migration 0008 (lower(sku) unique index) — READ-ONLY.
 *
 *   DATABASE_URL=postgres://… npx tsx tools/check-sku-conflicts.ts
 *
 * Finds (tenant_id, lower(sku)) groups with more than one variant — the exact
 * rows that would make CREATE UNIQUE INDEX fail. Prints COUNTS and the
 * normalized SKU values only (no tenant names, no credentials). Never writes.
 *
 * Exit codes: 0 = clean (migration can build), 1 = conflicts (STOP: operator
 * remediation plan required — see docs/COMMERCIAL_RELEASE_READINESS.md),
 * 2 = could not verify (no PASS is ever assumed).
 *
 * DATABASE_URL is REQUIRED and explicit: there is deliberately no PGlite/dev
 * fallback, so a "clean" result can never come from the wrong database.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('NOT VERIFIED — DATABASE_URL غير مضبوط. حدّد قاعدة PostgreSQL المقصودة صراحةً وأعد التشغيل.');
  process.exit(2);
}

let client: pg.Client | undefined;
try {
  client = new pg.Client({ connectionString: url });
  await client.connect();
  const ident = await client.query(`SELECT current_database() AS db, current_schema() AS schema`);
  console.log(`الهدف المفحوص: PostgreSQL · database=${ident.rows[0].db} · schema=${ident.rows[0].schema}`);

  const { rows } = await client.query(
    `SELECT lower(sku) AS normalized_sku, count(*)::int AS variants, count(DISTINCT sku)::int AS casings
       FROM catalog_variants
      GROUP BY tenant_id, lower(sku)
     HAVING count(*) > 1
      ORDER BY normalized_sku`,
  );
  if (!rows.length) {
    console.log('CLEAN — لا تعارضات SKU بعد التطبيع. ترحيل 0008 يمكنه بناء الفهرس بأمان (exit 0).');
    process.exit(0);
  }
  const total = rows.reduce((s, r) => s + r.variants, 0);
  console.log(`CONFLICTS — ${rows.length} مجموعة SKU متعارضة داخل مستأجرين، تشمل ${total} متغيرًا:`);
  for (const r of rows.slice(0, 50)) console.log(` - lower(sku)=${r.normalized_sku} · variants=${r.variants} · casings=${r.casings}`);
  if (rows.length > 50) console.log(` … و${rows.length - 50} مجموعة إضافية`);
  console.log('توقف: لا تطبّق ترحيل 0008 قبل خطة معالجة معتمدة (لا حذف/إعادة تسمية تلقائية). exit 1.');
  process.exit(1);
} catch (e) {
  console.error('NOT VERIFIED — تعذّر إكمال الفحص (اتصال/صلاحية/بنية). لا تفترض نظافة البيانات. exit 2.');
  process.exit(2);
} finally {
  await client?.end().catch(() => {});
}
