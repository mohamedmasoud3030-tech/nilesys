/**
 * Catalog DB schema (Drizzle, ADR-0004). Money = bigint minor units.
 * Stock is numeric(18,3) so the same engine serves piece goods and weighed
 * goods (kayyal heritage).
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantIdColumn, tenantKey, tenantPolicy } from '../../../platform/src/db/tenancy.js';

const money = (name: string) => bigint(name, { mode: 'number' });

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    category: text('category').notNull(),
    priceMinor: money('price_minor').notNull(),
    compareAtMinor: money('compare_at_minor'),
    isActive: boolean('is_active').notNull().default(true),
    // Optimistic-concurrency token for catalog admin edits (G-03): updates
    // must present the version they read, so two simultaneous price edits
    // can never silently overwrite each other.
    version: integer('version').notNull().default(1),
  },
  (t) => [tenantKey('catalog_items', t.tenantId, t.id), tenantPolicy()],
).enableRLS();

export const catalogVariants = pgTable(
  'catalog_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    itemId: uuid('item_id').notNull(),
    sku: text('sku').notNull(),
    labelAr: text('label_ar').notNull(),
    labelEn: text('label_en').notNull(),
    stock: numeric('stock', { precision: 18, scale: 3 }).notNull().default('0'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    tenantKey('catalog_variants', t.tenantId, t.id),
    unique('catalog_variants_tenant_sku_uq').on(t.tenantId, t.sku),
    // Case-insensitive uniqueness enforced BY THE DATABASE (G-03 review fix):
    // the (tenant_id, sku) constraint above is case-sensitive in PostgreSQL,
    // so the application-level pre-check alone could not stop two concurrent
    // requests from creating 'ABC' and 'abc' for the same tenant. This
    // functional unique index on lower(sku) is the real guard; the older
    // constraint is kept (redundant but harmless) to avoid a risky drop.
    uniqueIndex('catalog_variants_tenant_sku_lower_uidx').on(t.tenantId, sql`lower(${t.sku})`),
    foreignKey({ name: 'catalog_variants_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }),
    tenantPolicy(),
  ],
).enableRLS();

/** Every public site writes here; the admin panel works this pipeline. */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    source: text('source').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    message: text('message'),
    stage: text('stage').notNull().default('NEW'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('leads_stage_idx').on(t.tenantId, t.stage, t.createdAt), tenantPolicy()],
).enableRLS();
