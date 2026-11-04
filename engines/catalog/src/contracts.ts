/** REST/OpenAPI request contracts (ADR-0006) — validated at the API edge. */
import { z } from 'zod';

export const createCatalogItemSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  category: z.string().min(1),
  priceMinor: z.number().int().min(0),
  compareAtMinor: z.number().int().min(0).optional(),
  variants: z.array(
    z.object({
      sku: z.string().min(1),
      labelAr: z.string().min(1),
      labelEn: z.string().min(1),
      stock: z.number().int().min(0),
    }),
  ),
});
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;

/**
 * G-03 catalog administration contracts (manager UI). STRICT objects: a
 * client-supplied tenantId/stock-on-update/version-bump is rejected, not
 * ignored. Stock is a decimal string (≤3 dp) so weighed goods keep working.
 */
const stockString = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, 'stock as decimal string (≤3 dp)');
const skuString = z.string().trim().min(1).max(64).regex(/^\S+$/, 'SKU must not contain spaces');

export const catalogVariantInputSchema = z.object({
  sku: skuString,
  labelAr: z.string().trim().min(1).max(80),
  labelEn: z.string().trim().min(1).max(80),
  stock: stockString,
}).strict();

export const createCatalogItemAdminSchema = z.object({
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(50),
  priceMinor: z.number().int().min(1).max(100_000_000_00),
  compareAtMinor: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
  variants: z.array(catalogVariantInputSchema).min(1).max(20),
}).strict();
export type CreateCatalogItemAdminInput = z.infer<typeof createCatalogItemAdminSchema>;

export const updateCatalogItemSchema = z.object({
  nameAr: z.string().trim().min(1).max(120).optional(),
  nameEn: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  priceMinor: z.number().int().min(1).max(100_000_000_00).optional(),
  compareAtMinor: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
  isActive: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
}).strict();
export type UpdateCatalogItemAdminInput = z.infer<typeof updateCatalogItemSchema>;

export const updateCatalogVariantSchema = z.object({
  sku: skuString.optional(),
  labelAr: z.string().trim().min(1).max(80).optional(),
  labelEn: z.string().trim().min(1).max(80).optional(),
  expectedVersion: z.number().int().min(1),
}).strict();
export type UpdateCatalogVariantAdminInput = z.infer<typeof updateCatalogVariantSchema>;

/** Public-site lead submission (no auth — rate-limited at the edge). */
export const createLeadSchema = z.object({
  source: z.enum(['courts', 'restaurant', 'clinic', 'realestate', 'gym', 'mobile', 'fashion']),
  customerName: z.string().min(2),
  customerPhone: z.string().min(8),
  message: z.string().max(1000).optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
