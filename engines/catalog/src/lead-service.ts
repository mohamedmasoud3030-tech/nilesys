/**
 * Admin lead capture — every public site → one tenant-scoped inbox.
 *
 * Built on the EXISTING contract and table only:
 *   - contract: `createLeadSchema` (./contracts.ts), `Lead` / `LeadStage` / `canMoveLead` (./catalog.ts)
 *   - table:    `leads` (./db/schema.ts, migration 0000; RLS enabled + forced, tenant_isolation policy)
 * No schema or migration change.
 *
 * Tenant isolation is enforced by the database, not by this file: every query
 * runs inside `withTenant` (transaction-local `app.tenant_id`) under the
 * non-bypass runtime role, so another tenant's rows are invisible and an
 * insert carrying another tenant id fails RLS WITH CHECK.
 *
 * The tenant id is ALWAYS supplied by the server (session context for the
 * admin inbox; server-side site configuration for public forms). The input
 * contract is strict: a body carrying `tenantId`, `stage`, `id` or
 * `createdAt` is rejected, never silently honoured.
 *
 * Not in scope here (surfaced, not decided): how a public site resolves its
 * tenant without a session, and edge rate limiting for anonymous submissions.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { DomainError } from '../../transactions/src/line.js';
import { canMoveLead, type Lead, type LeadSource, type LeadStage } from './catalog.js';
import { createLeadSchema } from './contracts.js';
import { leads } from './db/schema.js';

const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const satisfies readonly LeadStage[];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phone accepted as international or national digits with common separators.
 * Stored as digits with an optional leading '+'. Market-specific validation
 * (EG / OM / SA) is a product decision and deliberately not guessed here.
 */
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+?\d{8,15}$/, 'phone must be 8–15 digits, optionally starting with +'));

/** Strict, normalising refinement of the existing public contract. */
export const captureLeadSchema = createLeadSchema
  .extend({
    customerName: z.string().trim().min(2).max(120),
    customerPhone: phone,
    message: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((m) => (m ? m : undefined)),
  })
  .strict();

export const listLeadsQuerySchema = z
  .object({
    stage: z.enum(LEAD_STAGES).optional(),
    source: createLeadSchema.shape.source.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListLeadsQuery = z.input<typeof listLeadsQuerySchema>;

function validation(err: z.ZodError): DomainError {
  const details: Record<string, string> = {};
  for (const issue of err.issues) details[issue.path.join('.') || '_'] = issue.message;
  return new DomainError('validation_failed', 'بيانات غير صالحة', details);
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw validation(r.error);
  return r.data;
}

function toLead(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    tenantId: row.tenantId,
    source: row.source as LeadSource,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    ...(row.message ? { message: row.message } : {}),
    stage: row.stage as LeadStage,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Capture one lead into the tenant's inbox. Always starts at stage NEW. */
export async function captureLead(db: AnyPgDatabase, tenantId: string, input: unknown): Promise<Lead> {
  const data = parse(captureLeadSchema, input);
  return withTenant(db, tenantId, async (tx: any) => {
    const [row] = await tx
      .insert(leads)
      .values({
        tenantId,
        source: data.source,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        message: data.message ?? null,
        stage: 'NEW',
      })
      .returning();
    return toLead(row);
  });
}

/** Newest first, tenant-scoped by RLS; optional stage/source filters. */
export async function listLeads(db: AnyPgDatabase, tenantId: string, query: ListLeadsQuery = {}): Promise<Lead[]> {
  const q = parse(listLeadsQuerySchema, query);
  return withTenant(db, tenantId, async (tx: any) => {
    const filters = [q.stage ? eq(leads.stage, q.stage) : undefined, q.source ? eq(leads.source, q.source) : undefined].filter(Boolean);
    const rows = await tx
      .select()
      .from(leads)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(q.limit);
    return rows.map(toLead);
  });
}

/**
 * Move a lead along the pipeline (`canMoveLead`). The UPDATE is conditional
 * on the stage that was read, so two admins racing on the same lead cannot
 * both win; the loser gets `lead_stage_conflict`. Another tenant's lead is
 * indistinguishable from a missing one.
 */
export async function moveLead(db: AnyPgDatabase, tenantId: string, leadId: string, to: unknown): Promise<Lead> {
  if (!UUID_RE.test(leadId)) throw new DomainError('lead_not_found', 'الطلب غير موجود');
  const target = parse(z.enum(LEAD_STAGES), to);
  return withTenant(db, tenantId, async (tx: any) => {
    const [current] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!current) throw new DomainError('lead_not_found', 'الطلب غير موجود');
    const from = current.stage as LeadStage;
    if (!canMoveLead(from, target)) {
      throw new DomainError('invalid_lead_transition', 'لا يمكن نقل الطلب لهذه المرحلة', { from, to: target });
    }
    const [row] = await tx
      .update(leads)
      .set({ stage: target })
      .where(and(eq(leads.id, leadId), eq(leads.stage, from)))
      .returning();
    if (!row) throw new DomainError('lead_stage_conflict', 'تم تعديل الطلب بواسطة مستخدم آخر', { from, to: target });
    return toLead(row);
  });
}
