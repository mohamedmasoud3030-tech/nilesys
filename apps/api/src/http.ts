/**
 * HTTP edge helpers: trusted request context + permission guard + mapping of
 * engine errors to stable HTTP responses ({ error: code, message }).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { resolveRequestContext, type RequestContext } from '../../../engines/platform/src/auth/request-context.js';
import { can, type PermissionRequest } from '../../../engines/platform/src/auth/permissions.js';
import { TenantContextError } from '../../../engines/platform/src/tenant.js';
import { TenantScopeError } from '../../../engines/platform/src/db/with-tenant.js';
import { DomainError } from '../../../engines/transactions/src/line.js';
import type { Deps } from './deps.js';

export function webHeaders(req: FastifyRequest): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.append(k, String(v));
  }
  return h;
}

export async function requireContext(deps: Deps, req: FastifyRequest, permission?: PermissionRequest): Promise<RequestContext> {
  let ctx: RequestContext;
  try {
    ctx = await resolveRequestContext(deps.auth, deps.db, webHeaders(req));
  } catch (e) {
    throw toHttp(e);
  }
  if (permission && !can(ctx.role, permission)) {
    throw new ForbiddenException({ error: 'forbidden', message: 'ليس لديك صلاحية لهذه العملية' });
  }
  return ctx;
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({ error: 'validation_failed', message: 'بيانات غير صالحة', issues: r.error.issues });
  }
  return r.data;
}

const DOMAIN_STATUS: Record<string, (body: object) => HttpException> = {
  unknown_item: (b) => new UnprocessableEntityException(b),
  invalid_quantity: (b) => new UnprocessableEntityException(b),
  invalid_price: (b) => new UnprocessableEntityException(b),
  invalid_variant: (b) => new UnprocessableEntityException(b),
  empty_sale: (b) => new UnprocessableEntityException(b),
  empty_refund: (b) => new UnprocessableEntityException(b),
  amount_out_of_range: (b) => new UnprocessableEntityException(b),
  invalid_amount: (b) => new UnprocessableEntityException(b),
  insufficient_stock: (b) => new ConflictException(b),
  idempotency_conflict: (b) => new ConflictException(b),
  tender_mismatch: (b) => new UnprocessableEntityException(b),
  shift_required_for_cash: (b) => new UnprocessableEntityException(b),
  shift_not_found: (b) => new UnprocessableEntityException(b),
  shift_closed: (b) => new ConflictException(b),
  shift_already_open: (b) => new ConflictException(b),
  shift_already_closed: (b) => new ConflictException(b),
  invalid_shift: (b) => new BadRequestException(b),
  sale_not_found: (b) => new UnprocessableEntityException(b),
  payment_not_found: (b) => new UnprocessableEntityException(b),
  payment_mismatch: (b) => new UnprocessableEntityException(b),
  refund_over_limit: (b) => new UnprocessableEntityException(b),
  refund_quantity_exceeded: (b) => new UnprocessableEntityException(b),
  invalid_idempotency_key: (b) => new BadRequestException(b),
  invalid_transaction: (b) => new BadRequestException(b),
  invalid_payment: (b) => new BadRequestException(b),
  invalid_date: (b) => new BadRequestException(b),
};

export function toHttp(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  if (e instanceof TenantContextError) {
    return e.message === 'UNAUTHENTICATED'
      ? new UnauthorizedException({ error: 'unauthenticated', message: 'يجب تسجيل الدخول' })
      : new ForbiddenException({ error: e.message.toLowerCase(), message: 'لا توجد شركة نشطة لهذا الحساب' });
  }
  if (e instanceof TenantScopeError) return new ForbiddenException({ error: e.code.toLowerCase(), message: 'سياق الشركة غير صالح' });
  if (e instanceof DomainError) {
    const make = DOMAIN_STATUS[e.code] ?? ((b: object) => new UnprocessableEntityException(b));
    return make({ error: e.code, message: e.message, details: e.details });
  }
  throw e; // unknown → 500 via Nest (never leak internals in the body)
}
