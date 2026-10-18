/**
 * REST request contracts (ADR-0006) — validated at the API edge and exported
 * to OpenAPI via z.toJSONSchema. Objects are STRICT: unknown keys (e.g. a
 * client-supplied tenantId, price or total) are rejected, not ignored.
 */
import { z } from 'zod';

const quantity = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, 'quantity as decimal string (≤3 dp)');

export const createSaleSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    lines: z
      .array(z.object({ variantId: z.string().uuid(), quantity }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const stockMovementSchema = z
  .object({
    variantId: z.string().uuid(),
    direction: z.enum(['in', 'out', 'adjust']),
    quantity,
    warehouse: z.string().default('main'),
    reason: z.string().max(500).optional(),
  })
  .strict();

const tenderMethod = z.enum(['cash', 'card', 'wallet', 'transfer']);
export const createCheckoutSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    shiftId: z.string().uuid().optional(),
    lines: z
      .array(z.object({ variantId: z.string().uuid(), quantity }).strict())
      .min(1)
      .max(200),
    tenders: z
      .array(
        z
          .object({
            method: tenderMethod,
            amountMinor: z.number().int().min(1),
            tenderedMinor: z.number().int().min(0).optional(),
            changeMinor: z.number().int().min(0).optional(),
            externalRef: z.string().max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const openShiftSchema = z
  .object({
    registerCode: z.string().min(1).max(50).optional(),
    openingMinor: z.number().int().min(0).max(30_000_000_00),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export type OpenShiftInput = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z
  .object({
    countedMinor: z.number().int().min(0).max(100_000_000_00),
  })
  .strict();

export const createRefundSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    originalTransactionId: z.string().uuid(),
    paymentId: z.string().uuid(),
    items: z
      .array(z.object({ variantId: z.string().uuid(), quantity }).strict())
      .min(1)
      .max(200),
    reason: z.string().max(500).optional(),
    shiftId: z.string().uuid().optional(),
  })
  .strict();
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export const reportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

