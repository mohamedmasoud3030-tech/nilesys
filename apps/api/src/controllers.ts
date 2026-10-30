/**
 * Thin REST controllers (ADR-0006). Business logic lives in the engines;
 * controllers only: authenticate → authorize → validate → call engine.
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEPS, type Deps } from './deps.js';
import { parseBody, requireContext, toHttp } from './http.js';
import { permissionsOf } from '../../../engines/platform/src/auth/permissions.js';
import { closeShiftSchema, createCheckoutSchema, createRefundSchema, createSaleSchema, currentShiftQuerySchema, openShiftSchema, reconcileQuerySchema, reportQuerySchema } from '../../../engines/transactions/src/contracts.js';
import { getSale, getSaleByIdempotencyKey, recordSale } from '../../../engines/transactions/src/sale-service.js';
import { checkout } from '../../../engines/transactions/src/checkout.js';
import { closeShift, getCurrentShift, getShift, openShift } from '../../../engines/transactions/src/shifts.js';
import { createRefund, getRefundByIdempotencyKey } from '../../../engines/transactions/src/refunds.js';
import { getDailyReport } from '../../../engines/transactions/src/reports.js';
import { listCatalog } from '../../../engines/catalog/src/catalog-service.js';
import { addCatalogVariant, createCatalogItem, listCatalogAdmin, updateCatalogItem, updateCatalogVariant } from '../../../engines/catalog/src/catalog-admin.js';
import { catalogVariantInputSchema, createCatalogItemAdminSchema, updateCatalogItemSchema, updateCatalogVariantSchema } from '../../../engines/catalog/src/contracts.js';
import { organization } from '../../../engines/platform/src/auth/schema.js';
import { eq } from 'drizzle-orm';

@ApiTags('platform')
@Controller('api')
export class HealthController {
  @Get('health')
  health() {
    return { ok: true };
  }
}

@ApiTags('platform')
@Controller('api/v1')
export class MeController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user, active tenant, role and permissions' })
  async me(@Req() req: FastifyRequest) {
    const ctx = await requireContext(this.deps, req);
    const [org] = await this.deps.db
      .select({ name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ctx.tenantId));
    return {
      user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail },
      tenant: { id: ctx.tenantId, name: org?.name, slug: org?.slug },
      role: ctx.role,
      permissions: permissionsOf(ctx.role),
    };
  }
}

@ApiTags('catalog')
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  @Get('items')
  @ApiOperation({ summary: 'Sellable catalog for the active tenant (with stock state)' })
  async items(@Req() req: FastifyRequest) {
    const ctx = await requireContext(this.deps, req, { catalog: ['read'] });
    return { items: await listCatalog(this.deps.db, ctx.tenantId) };
  }

  /* ── G-03: catalog administration (catalog:manage, server-authorized) ── */
  @Get('items/admin')
  @ApiOperation({ summary: 'Full catalog incl. inactive items, for administration' })
  async itemsAdmin(@Req() req: FastifyRequest) {
    const ctx = await requireContext(this.deps, req, { catalog: ['manage'] });
    return { items: await listCatalogAdmin(this.deps.db, ctx.tenantId) };
  }

  @Post('items')
  @ApiOperation({ summary: 'Create a catalog item with variants (initial stock = opening balance)' })
  @ApiBody({ schema: z.toJSONSchema(createCatalogItemAdminSchema) as Record<string, unknown> })
  async createItem(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { catalog: ['manage'] });
    const input = parseBody(createCatalogItemAdminSchema, body);
    try {
      const item = await createCatalogItem(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, input);
      reply.status(201);
      return { item };
    } catch (e) { throw toHttp(e); }
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update item fields/price/active state (optimistic concurrency via expectedVersion)' })
  @ApiBody({ schema: z.toJSONSchema(updateCatalogItemSchema) as Record<string, unknown> })
  async updateItem(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await requireContext(this.deps, req, { catalog: ['manage'] });
    const input = parseBody(updateCatalogItemSchema, body);
    try {
      return { item: await updateCatalogItem(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, id, input) };
    } catch (e) { throw toHttp(e); }
  }

  @Post('items/:id/variants')
  @ApiOperation({ summary: 'Add a variant (SKU) to an item' })
  @ApiBody({ schema: z.toJSONSchema(catalogVariantInputSchema) as Record<string, unknown> })
  async addVariant(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { catalog: ['manage'] });
    const input = parseBody(catalogVariantInputSchema, body);
    try {
      const item = await addCatalogVariant(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, id, input);
      reply.status(201);
      return { item };
    } catch (e) { throw toHttp(e); }
  }

  @Patch('variants/:id')
  @ApiOperation({ summary: 'Update variant SKU/labels (stock is never edited here — use stock movements)' })
  @ApiBody({ schema: z.toJSONSchema(updateCatalogVariantSchema) as Record<string, unknown> })
  async updateVariant(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    const ctx = await requireContext(this.deps, req, { catalog: ['manage'] });
    const input = parseBody(updateCatalogVariantSchema, body);
    try {
      return { item: await updateCatalogVariant(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, id, input) };
    } catch (e) { throw toHttp(e); }
  }
}

@ApiTags('sales')
@Controller('api/v1/checkout')
export class CheckoutController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  @Get('reconcile')
  @ApiOperation({ summary: 'Resolve an uncertain checkout by idempotency key: saved (with the sale) or not_found (same key may be retried)' })
  async reconcile(@Req() req: FastifyRequest, @Query() query: unknown) {
    const ctx = await requireContext(this.deps, req, { sale: ['read'] });
    const q = parseBody(reconcileQuerySchema, query);
    const sale = await getSaleByIdempotencyKey(this.deps.db, ctx.tenantId, q.key);
    return sale ? { state: 'saved' as const, sale } : { state: 'not_found' as const };
  }

  @Post()
  @ApiOperation({ summary: 'Checkout: sale + payments in one transaction (idempotent, tender must match total)' })
  @ApiBody({ schema: z.toJSONSchema(createCheckoutSchema) as Record<string, unknown> })
  async create(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { sale: ['create'] });
    const input = parseBody(createCheckoutSchema, body);
    try {
      const { sale, replayed } = await checkout(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, input);
      reply.status(replayed ? 200 : 201);
      return { sale, replayed };
    } catch (e) {
      throw toHttp(e);
    }
  }
}

@ApiTags('shifts')
@Controller('api/v1/shifts')
export class ShiftsController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}
  @Post()
  @ApiOperation({ summary: 'Open a cash shift (idempotent)' })
  @ApiBody({ schema: z.toJSONSchema(openShiftSchema) as Record<string, unknown> })
  async open(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { sale: ['create'] });
    const input = parseBody(openShiftSchema, body);
    try {
      const { shift, replayed } = await openShift(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, input);
      reply.status(replayed ? 200 : 201);
      return { shift, replayed };
    } catch (e) { throw toHttp(e); }
  }
  @Post(':id/close')
  @ApiOperation({ summary: 'Close a shift: counted vs expected + difference (idempotent when idempotencyKey is sent, G-17)' })
  @ApiBody({ schema: z.toJSONSchema(closeShiftSchema) as Record<string, unknown> })
  async close(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { sale: ['create'] });
    const input = parseBody(closeShiftSchema, body);
    try {
      const { closure, replayed } = await closeShift(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, { shiftId: id, countedMinor: input.countedMinor, idempotencyKey: input.idempotencyKey });
      reply.status(replayed ? 200 : 201);
      return { closure, replayed };
    } catch (e) { throw toHttp(e); }
  }
  // MUST stay above @Get(':id') or "current" would be captured as an id.
  @Get('current')
  @ApiOperation({ summary: 'Current open shift for a register (device/session recovery, G-02); null when none is open' })
  async current(@Req() req: FastifyRequest, @Query() query: unknown) {
    const ctx = await requireContext(this.deps, req, { sale: ['read'] });
    const q = parseBody(currentShiftQuerySchema, query);
    const shift = await getCurrentShift(this.deps.db, ctx.tenantId, q.registerCode ?? 'main');
    return { shift };
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get shift with expected cash (for reconciliation)' })
  async get(@Req() req: FastifyRequest, @Param('id') id: string) {
    const ctx = await requireContext(this.deps, req, { sale: ['read'] });
    const shift = await getShift(this.deps.db, ctx.tenantId, id);
    if (!shift) throw new NotFoundException({ error: 'not_found', message: 'الوردية غير موجودة' });
    return { shift };
  }
}

@ApiTags('refunds')
@Controller('api/v1/refunds')
export class RefundsController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}
  @Get('reconcile')
  @ApiOperation({ summary: 'Resolve an uncertain refund by idempotency key: saved (with the refund) or not_found' })
  async reconcile(@Req() req: FastifyRequest, @Query() query: unknown) {
    const ctx = await requireContext(this.deps, req, { sale: ['void'] });
    const q = parseBody(reconcileQuerySchema, query);
    const refund = await getRefundByIdempotencyKey(this.deps.db, ctx.tenantId, q.key);
    return refund ? { state: 'saved' as const, refund } : { state: 'not_found' as const };
  }
  @Post()
  @ApiOperation({ summary: 'Refund (partial/full) linked to sale/payment — idempotent, stock restored' })
  @ApiBody({ schema: z.toJSONSchema(createRefundSchema) as Record<string, unknown> })
  async create(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { sale: ['void'] });
    const input = parseBody(createRefundSchema, body);
    try {
      const { refund, replayed } = await createRefund(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, input);
      reply.status(replayed ? 200 : 201);
      return { refund, replayed };
    } catch (e) { throw toHttp(e); }
  }
}

@ApiTags('reports')
@Controller('api/v1/reports')
export class ReportsController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}
  @Get('daily')
  @ApiOperation({ summary: 'Daily report: gross/refunds/net + by method (profit excluded) — requires report:read (D-D, adopted V1 policy)' })
  async daily(@Req() req: FastifyRequest, @Query() query: unknown) {
    const ctx = await requireContext(this.deps, req, { report: ['read'] });
    const q = parseBody(reportQuerySchema, query);
    try {
      const report = await getDailyReport(this.deps.db, ctx.tenantId, q);
      return { report };
    } catch (e) { throw toHttp(e); }
  }
}

@ApiTags('sales')
@Controller('api/v1/sales')
export class SalesController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  @Post()
  @ApiOperation({ summary: 'Record a sale (idempotent; prices come from the catalog)' })
  @ApiBody({ schema: z.toJSONSchema(createSaleSchema) as Record<string, unknown> })
  async create(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = await requireContext(this.deps, req, { sale: ['create'] });
    const input = parseBody(createSaleSchema, body);
    try {
      const { sale, replayed } = await recordSale(this.deps.db, { tenantId: ctx.tenantId, userId: ctx.userId }, input);
      reply.status(replayed ? 200 : 201);
      return { sale, replayed };
    } catch (e) {
      throw toHttp(e);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a saved sale (receipt data)' })
  async get(@Req() req: FastifyRequest, @Param('id') id: string) {
    const ctx = await requireContext(this.deps, req, { sale: ['read'] });
    const sale = await getSale(this.deps.db, ctx.tenantId, id);
    if (!sale) throw new NotFoundException({ error: 'not_found', message: 'الفاتورة غير موجودة' });
    return { sale };
  }
}
