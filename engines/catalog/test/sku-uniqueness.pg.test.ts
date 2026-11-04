/**
 * SKU case-insensitive uniqueness UNDER CONCURRENCY — real PostgreSQL only.
 *
 * Defect (final review, 2026-10-26): G-03 enforced "ABC ≡ abc" only with an
 * application-level pre-check (read-then-write), while the DB constraint
 * UNIQUE(tenant_id, sku) is case-sensitive. Two concurrent creates could both
 * pass the pre-check and both commit, leaving one tenant with two logical
 * duplicates. Fix: migration 0008 adds a functional unique index on
 * (tenant_id, lower(sku)) so the DATABASE is the guard, and catalog-admin
 * maps its 23505 to the domain error duplicate_sku.
 *
 * Sequential ABC-then-abc tests (catalog-admin.test.ts) cannot show the race;
 * PGlite is single-connection. This file is skipped unless
 * NILE_TEST_PG_ADMIN_URL points at a disposable server.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ADMIN_URL, createPgHarness, type PgHarness } from './pg-harness.js';
import { organization } from '../../platform/src/auth/schema.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../src/db/schema.js';
import { listCatalog } from '../src/catalog-service.js';
import * as admin from '../src/catalog-admin.js';
import { checkout } from '../../transactions/src/checkout.js';

let h: PgHarness;
let db: any;
let seq = 0;
const key = (p: string) => `${p}-${seq++}-${Date.now()}`;
const actorOf = (tenantId: string) => ({ tenantId, userId: tenantId });
const codeOf = (e: any) => { let c = e; while (c && !c.code) c = c.cause; return String(c?.code ?? e?.message); };

async function tenant(): Promise<string> {
  const [o] = await db.insert(organization).values({ name: 'SkuRace', slug: key('skurace') }).returning({ id: organization.id });
  return o.id as string;
}
const itemWith = (tenantId: string, sku: string, priceMinor = 1000) =>
  admin.createCatalogItem(db, actorOf(tenantId), {
    nameAr: 'صنف سباق', nameEn: 'Race Item', category: 'race', priceMinor,
    variants: [{ sku, labelAr: 'وحدة', labelEn: 'unit', stock: '10' }],
  });

async function tenantVariants(tenantId: string): Promise<any[]> {
  return withTenant(db, tenantId, (tx: any) =>
    tx.select().from(catalogVariants).where(eq(catalogVariants.tenantId, tenantId)));
}
async function tenantItems(tenantId: string): Promise<any[]> {
  return withTenant(db, tenantId, (tx: any) =>
    tx.select().from(catalogItems).where(eq(catalogItems.tenantId, tenantId)));
}
async function createAuditRows(tenantId: string): Promise<any[]> {
  return withTenant(db, tenantId, (tx: any) =>
    tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'catalog.create'))));
}

describe.skipIf(!ADMIN_URL)('SKU lower() uniqueness under concurrency (real PostgreSQL)', () => {
  beforeAll(async () => { h = await createPgHarness('skurace'); db = h.opened.db; }, 60_000);
  afterAll(async () => { await h?.dispose(); });

  it('B1: concurrent creates ABC vs abc — exactly one wins, loser duplicate_sku, no partial data (x10)', async () => {
    for (let i = 0; i < 10; i++) {
      const T = await tenant();
      const base = `SKU${i}-${seq}`;
      const rs = await Promise.allSettled([
        itemWith(T, `${base}-CASE`),
        itemWith(T, `${base}-case`),
      ]);
      const outcomes = rs.map((r) => (r.status === 'fulfilled' ? 'ok' : codeOf(r.reason))).sort();
      expect(outcomes, `iteration ${i}`).toEqual(['duplicate_sku', 'ok']);

      const variants = await tenantVariants(T);
      expect(variants.length, `iteration ${i} variants`).toBe(1);
      expect(new Set(variants.map((v: any) => String(v.sku).toLowerCase())).size).toBe(1);
      // No partial write: the losing item was never created, and no audit row
      // claims a success for it.
      expect((await tenantItems(T)).length, `iteration ${i} items`).toBe(1);
      expect((await createAuditRows(T)).length, `iteration ${i} audits`).toBe(1);
    }
  }, 180_000);

  it('B2: concurrent renames to conflicting casings — they cannot both succeed (x10)', async () => {
    for (let i = 0; i < 10; i++) {
      const T = await tenant();
      const a = await itemWith(T, `R${i}-AAA`);
      const b = await itemWith(T, `R${i}-BBB`);
      const va = a.variants[0]!
      const vb = b.variants[0]!
      const rs = await Promise.allSettled([
        admin.updateCatalogVariant(db, actorOf(T), va.id, { sku: `R${i}-Same`, expectedVersion: va.version }),
        admin.updateCatalogVariant(db, actorOf(T), vb.id, { sku: `R${i}-same`, expectedVersion: vb.version }),
      ]);
      const outcomes = rs.map((r) => (r.status === 'fulfilled' ? 'ok' : codeOf(r.reason))).sort();
      expect(outcomes, `iteration ${i}`).toEqual(['duplicate_sku', 'ok']);
      const variants = await tenantVariants(T);
      expect(new Set(variants.map((v: any) => String(v.sku).toLowerCase())).size).toBe(2);
    }
  }, 180_000);

  it('B3: tenant isolation — A owns ABC while B owns abc, created concurrently', async () => {
    const A = await tenant();
    const B = await tenant();
    const rs = await Promise.allSettled([itemWith(A, 'SHARED-1'), itemWith(B, 'shared-1')]);
    expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await tenantVariants(A)).map((v: any) => v.sku)).toEqual(['SHARED-1']);
    expect((await tenantVariants(B)).map((v: any) => v.sku)).toEqual(['shared-1']);
  }, 60_000);

  it('B5: selling still works after the guard; later price edit affects only later sales', async () => {
    const T = await tenant();
    const item = await itemWith(T, 'SELL-1', 1234);
    const variantId = item.variants[0]!.id;
    const s1 = await checkout(db, actorOf(T), {
      idempotencyKey: key('sku-sell'), lines: [{ variantId, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 1234 }],
    });
    expect(s1.sale.totalMinor).toBe(1234);
    const updated = await admin.updateCatalogItem(db, actorOf(T), item.id, { priceMinor: 1500, expectedVersion: item.version });
    expect(updated.priceMinor).toBe(1500);
    const s2 = await checkout(db, actorOf(T), {
      idempotencyKey: key('sku-sell'), lines: [{ variantId, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 1500 }],
    });
    expect(s2.sale.totalMinor).toBe(1500);
    const sellable = await listCatalog(db, T);
    expect(sellable.find((i) => i.id === item.id)?.priceMinor).toBe(1500);
    // Direct proof the functional index exists in the migrated schema.
    const idx = await h.observer.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'catalog_variants_tenant_sku_lower_uidx' AND indexdef ILIKE '%lower(sku)%'`,
    );
    expect(idx.rowCount).toBe(1);
  }, 60_000);
});
