/**
 * Catalog administration (G-03) — the manager-facing write side of the
 * catalog: create/update items and variants, activate/deactivate items.
 *
 * Safety invariants:
 *  - Tenant isolation via withTenant (RLS) + explicit tenant filters.
 *  - Prices are integer minor units end-to-end — never floats.
 *  - SKU unique per tenant (DB constraint + friendly pre-check, case-insensitive).
 *  - Optimistic concurrency: every update carries the `version` the editor
 *    read; a stale editor gets `version_conflict`, never a silent overwrite.
 *  - Stock is NOT editable here. Initial stock is set only when a variant is
 *    created (its opening balance, exactly like seeding); later corrections
 *    belong to stock movements (stock:adjust), not catalog edits.
 *  - Historical invoices are unaffected: sale lines snapshot their prices.
 *  - Every mutation writes an audit_log row in the same transaction.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { DomainError } from '../../transactions/src/line.js';
import { catalogItems, catalogVariants } from './db/schema.js';
import { variantStockState } from './catalog.js';

export interface CatalogActor { tenantId: string; userId: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOCK_RE = /^\d{1,12}(\.\d{1,3})?$/;
const MAX_MINOR = 100_000_000_00;

/* Both the legacy exact-case constraint and the 0008 lower(sku) functional
   unique index report their name in `constraint` on 23505 (PG does so for
   unique indexes too). Either one surfacing means «duplicate SKU». */
const SKU_UNIQUE_NAMES = ['catalog_variants_tenant_sku_uq', 'catalog_variants_tenant_sku_lower_uidx'];
function isUniqueViolation(err: unknown, constraints: string | string[]): boolean {
  const names = Array.isArray(constraints) ? constraints : [constraints];
  for (let e: any = err; e; e = e.cause) if (e.code === '23505' && (!e.constraint || names.includes(e.constraint))) return true;
  return false;
}
const dupSku = () => new DomainError('duplicate_sku', 'كود SKU مستخدم من قبل في هذا المحل');

function cleanText(v: string, max: number, label: string): string {
  const t = (v ?? '').trim();
  if (!t || t.length > max) throw new DomainError('invalid_catalog', `${label} مطلوب (1–${max} حرف)`);
  return t;
}
function cleanSku(v: string): string {
  const t = (v ?? '').trim();
  if (!t || t.length > 64 || /\s/.test(t)) throw new DomainError('invalid_catalog', 'كود SKU مطلوب دون مسافات (حتى 64 حرفًا)');
  return t;
}
function cleanPrice(v: number): number {
  if (!Number.isInteger(v) || v < 1 || v > MAX_MINOR) throw new DomainError('invalid_price', 'سعر البيع يجب أن يكون مبلغًا صحيحًا بالقروش أكبر من صفر');
  return v;
}
function cleanCompareAt(v: number | null | undefined, price: number): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v > MAX_MINOR || v < price) throw new DomainError('invalid_price', 'سعر «قبل» يجب أن يساوي سعر البيع أو يزيد عنه');
  return v;
}
function cleanStock(v: string): string {
  const t = (v ?? '').trim();
  if (!STOCK_RE.test(t)) throw new DomainError('invalid_quantity', 'رصيد البداية يجب أن يكون رقمًا عشريًا بحد أقصى 3 خانات');
  return t;
}

export interface CatalogAdminVariant {
  id: string; sku: string; labelAr: string; labelEn: string;
  stock: string; stockState: string; version: number;
}
export interface CatalogAdminItem {
  id: string; nameAr: string; nameEn: string; category: string;
  priceMinor: number; compareAtMinor: number | null; isActive: boolean;
  version: number; variants: CatalogAdminVariant[];
}

async function loadAdminItem(tx: any, tenantId: string, itemId: string): Promise<CatalogAdminItem | null> {
  const rows = await tx
    .select({ item: catalogItems, variant: catalogVariants })
    .from(catalogItems)
    .leftJoin(catalogVariants, and(eq(catalogVariants.tenantId, catalogItems.tenantId), eq(catalogVariants.itemId, catalogItems.id)))
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.id, itemId)))
    .orderBy(asc(catalogVariants.sku));
  if (!rows.length) return null;
  const item = rows[0].item;
  return {
    id: item.id, nameAr: item.nameAr, nameEn: item.nameEn, category: item.category,
    priceMinor: item.priceMinor, compareAtMinor: item.compareAtMinor,
    isActive: item.isActive, version: item.version,
    variants: rows.filter((r: any) => r.variant).map((r: any) => ({
      id: r.variant.id, sku: r.variant.sku, labelAr: r.variant.labelAr, labelEn: r.variant.labelEn,
      stock: r.variant.stock, stockState: variantStockState({ ...r.variant, stock: Number(r.variant.stock) }, 3),
      version: r.variant.version,
    })),
  };
}

/** Full catalog for administration: active AND inactive items. */
export async function listCatalogAdmin(db: AnyPgDatabase, tenantId: string): Promise<CatalogAdminItem[]> {
  return withTenant(db, tenantId, async (tx: any) => {
    const rows = await tx
      .select({ item: catalogItems, variant: catalogVariants })
      .from(catalogItems)
      .leftJoin(catalogVariants, and(eq(catalogVariants.tenantId, catalogItems.tenantId), eq(catalogVariants.itemId, catalogItems.id)))
      .where(eq(catalogItems.tenantId, tenantId))
      .orderBy(asc(catalogItems.category), asc(catalogItems.nameEn), asc(catalogVariants.sku));
    const out = new Map<string, CatalogAdminItem>();
    for (const { item, variant } of rows) {
      let entry = out.get(item.id);
      if (!entry) {
        entry = {
          id: item.id, nameAr: item.nameAr, nameEn: item.nameEn, category: item.category,
          priceMinor: item.priceMinor, compareAtMinor: item.compareAtMinor,
          isActive: item.isActive, version: item.version, variants: [],
        };
        out.set(item.id, entry);
      }
      if (variant) entry.variants.push({
        id: variant.id, sku: variant.sku, labelAr: variant.labelAr, labelEn: variant.labelEn,
        stock: variant.stock, stockState: variantStockState({ ...variant, stock: Number(variant.stock) }, 3),
        version: variant.version,
      });
    }
    return [...out.values()];
  });
}

async function assertSkuFree(tx: any, tenantId: string, sku: string, exceptVariantId?: string) {
  const rows = await tx
    .select({ id: catalogVariants.id })
    .from(catalogVariants)
    .where(and(eq(catalogVariants.tenantId, tenantId), sql`lower(${catalogVariants.sku}) = lower(${sku})`));
  if (rows.some((r: any) => r.id !== exceptVariantId)) throw dupSku();
}

async function audit(tx: any, actor: CatalogActor, action: string, entityId: string, payload: object) {
  await tx.insert(auditLog).values({
    tenantId: actor.tenantId, userId: actor.userId, action, entity: 'catalog_items',
    entityId, payload: JSON.stringify(payload),
  });
}

export interface NewVariantInput { sku: string; labelAr: string; labelEn: string; stock: string }
export interface NewItemInput {
  nameAr: string; nameEn: string; category: string;
  priceMinor: number; compareAtMinor?: number | null;
  variants: NewVariantInput[];
}

export async function createCatalogItem(db: AnyPgDatabase, actor: CatalogActor, input: NewItemInput): Promise<CatalogAdminItem> {
  const nameAr = cleanText(input.nameAr, 120, 'اسم الصنف بالعربية');
  const nameEn = cleanText(input.nameEn, 120, 'اسم الصنف بالإنجليزية');
  const category = cleanText(input.category, 50, 'التصنيف');
  const priceMinor = cleanPrice(input.priceMinor);
  const compareAtMinor = cleanCompareAt(input.compareAtMinor, priceMinor);
  if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > 20) {
    throw new DomainError('invalid_catalog', 'أضف متغيرًا واحدًا على الأقل (SKU) للصنف');
  }
  const variants = input.variants.map((v) => ({
    sku: cleanSku(v.sku),
    labelAr: cleanText(v.labelAr, 80, 'وصف المتغير بالعربية'),
    labelEn: cleanText(v.labelEn, 80, 'وصف المتغير بالإنجليزية'),
    stock: cleanStock(v.stock),
  }));
  const seen = new Set<string>();
  for (const v of variants) {
    const k = v.sku.toLowerCase();
    if (seen.has(k)) throw dupSku();
    seen.add(k);
  }

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      for (const v of variants) await assertSkuFree(tx, actor.tenantId, v.sku);
      const [row] = await tx.insert(catalogItems)
        .values({ tenantId: actor.tenantId, nameAr, nameEn, category, priceMinor, compareAtMinor })
        .returning({ id: catalogItems.id });
      await tx.insert(catalogVariants).values(variants.map((v) => ({ tenantId: actor.tenantId, itemId: row.id, ...v })));
      await audit(tx, actor, 'catalog.create', row.id, { nameAr, priceMinor, skus: variants.map((v) => v.sku) });
      return (await loadAdminItem(tx, actor.tenantId, row.id))!;
    });
  } catch (err) {
    if (isUniqueViolation(err, SKU_UNIQUE_NAMES)) throw dupSku();
    throw err;
  }
}

export interface UpdateItemInput {
  nameAr?: string; nameEn?: string; category?: string;
  priceMinor?: number; compareAtMinor?: number | null; isActive?: boolean;
  expectedVersion: number;
}

export async function updateCatalogItem(db: AnyPgDatabase, actor: CatalogActor, itemId: string, input: UpdateItemInput): Promise<CatalogAdminItem> {
  if (!UUID_RE.test(itemId)) throw new DomainError('item_not_found', 'الصنف غير موجود');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new DomainError('version_conflict', 'بيانات الصنف تغيّرت — حدّث الصفحة وحاول مرة أخرى');
  }
  return withTenant(db, actor.tenantId, async (tx: any) => {
    const [current] = await tx.select().from(catalogItems)
      .where(and(eq(catalogItems.tenantId, actor.tenantId), eq(catalogItems.id, itemId))).limit(1);
    if (!current) throw new DomainError('item_not_found', 'الصنف غير موجود');

    const patch: Record<string, unknown> = {};
    if (input.nameAr !== undefined) patch.nameAr = cleanText(input.nameAr, 120, 'اسم الصنف بالعربية');
    if (input.nameEn !== undefined) patch.nameEn = cleanText(input.nameEn, 120, 'اسم الصنف بالإنجليزية');
    if (input.category !== undefined) patch.category = cleanText(input.category, 50, 'التصنيف');
    const nextPrice = input.priceMinor !== undefined ? cleanPrice(input.priceMinor) : (current.priceMinor as number);
    if (input.priceMinor !== undefined) patch.priceMinor = nextPrice;
    if (input.compareAtMinor !== undefined) patch.compareAtMinor = cleanCompareAt(input.compareAtMinor, nextPrice);
    else if (input.priceMinor !== undefined && current.compareAtMinor !== null && current.compareAtMinor < nextPrice) {
      // Raising the price above a stale «compare at» would break its meaning.
      throw new DomainError('invalid_price', 'سعر «قبل» الحالي أصغر من سعر البيع الجديد — حدّثه أو احذفه');
    }
    if (input.isActive !== undefined) {
      if (typeof input.isActive !== 'boolean') throw new DomainError('invalid_catalog', 'حالة التفعيل يجب أن تكون صحيحة');
      patch.isActive = input.isActive;
    }
    if (!Object.keys(patch).length) throw new DomainError('invalid_catalog', 'لا توجد تغييرات لحفظها');

    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => current[k] !== v));
    const rows = await tx.update(catalogItems)
      .set({ ...patch, version: sql`${catalogItems.version} + 1` })
      .where(and(eq(catalogItems.tenantId, actor.tenantId), eq(catalogItems.id, itemId), eq(catalogItems.version, input.expectedVersion)))
      .returning({ id: catalogItems.id });
    if (!rows.length) throw new DomainError('version_conflict', 'بيانات الصنف تغيّرت من مكان آخر — حدّث الصفحة وحاول مرة أخرى');
    await audit(tx, actor, 'catalog.update', itemId, { changed });
    return (await loadAdminItem(tx, actor.tenantId, itemId))!;
  });
}

export async function addCatalogVariant(db: AnyPgDatabase, actor: CatalogActor, itemId: string, input: NewVariantInput): Promise<CatalogAdminItem> {
  if (!UUID_RE.test(itemId)) throw new DomainError('item_not_found', 'الصنف غير موجود');
  const variant = {
    sku: cleanSku(input.sku),
    labelAr: cleanText(input.labelAr, 80, 'وصف المتغير بالعربية'),
    labelEn: cleanText(input.labelEn, 80, 'وصف المتغير بالإنجليزية'),
    stock: cleanStock(input.stock),
  };
  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      const [item] = await tx.select({ id: catalogItems.id }).from(catalogItems)
        .where(and(eq(catalogItems.tenantId, actor.tenantId), eq(catalogItems.id, itemId))).limit(1);
      if (!item) throw new DomainError('item_not_found', 'الصنف غير موجود');
      await assertSkuFree(tx, actor.tenantId, variant.sku);
      const [row] = await tx.insert(catalogVariants)
        .values({ tenantId: actor.tenantId, itemId, ...variant })
        .returning({ id: catalogVariants.id });
      await audit(tx, actor, 'catalog.variant.create', itemId, { variantId: row.id, sku: variant.sku, stock: variant.stock });
      return (await loadAdminItem(tx, actor.tenantId, itemId))!;
    });
  } catch (err) {
    if (isUniqueViolation(err, SKU_UNIQUE_NAMES)) throw dupSku();
    throw err;
  }
}

export interface UpdateVariantInput {
  sku?: string; labelAr?: string; labelEn?: string;
  expectedVersion: number;
}

export async function updateCatalogVariant(db: AnyPgDatabase, actor: CatalogActor, variantId: string, input: UpdateVariantInput): Promise<CatalogAdminItem> {
  if (!UUID_RE.test(variantId)) throw new DomainError('item_not_found', 'المتغير غير موجود');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new DomainError('version_conflict', 'بيانات المتغير تغيّرت — حدّث الصفحة وحاول مرة أخرى');
  }
  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      const [current] = await tx.select().from(catalogVariants)
        .where(and(eq(catalogVariants.tenantId, actor.tenantId), eq(catalogVariants.id, variantId))).limit(1);
      if (!current) throw new DomainError('item_not_found', 'المتغير غير موجود');

      const patch: Record<string, unknown> = {};
      if (input.sku !== undefined) patch.sku = cleanSku(input.sku);
      if (input.labelAr !== undefined) patch.labelAr = cleanText(input.labelAr, 80, 'وصف المتغير بالعربية');
      if (input.labelEn !== undefined) patch.labelEn = cleanText(input.labelEn, 80, 'وصف المتغير بالإنجليزية');
      if (!Object.keys(patch).length) throw new DomainError('invalid_catalog', 'لا توجد تغييرات لحفظها');
      if (patch.sku !== undefined && patch.sku !== current.sku) await assertSkuFree(tx, actor.tenantId, patch.sku as string, variantId);

      const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => current[k] !== v));
      const rows = await tx.update(catalogVariants)
        .set({ ...patch, version: sql`${catalogVariants.version} + 1` })
        .where(and(eq(catalogVariants.tenantId, actor.tenantId), eq(catalogVariants.id, variantId), eq(catalogVariants.version, input.expectedVersion)))
        .returning({ id: catalogVariants.id });
      if (!rows.length) throw new DomainError('version_conflict', 'بيانات المتغير تغيّرت من مكان آخر — حدّث الصفحة وحاول مرة أخرى');
      await audit(tx, actor, 'catalog.variant.update', current.itemId, { variantId, changed });
      return (await loadAdminItem(tx, actor.tenantId, current.itemId))!;
    });
  } catch (err) {
    if (isUniqueViolation(err, SKU_UNIQUE_NAMES)) throw dupSku();
    throw err;
  }
}
