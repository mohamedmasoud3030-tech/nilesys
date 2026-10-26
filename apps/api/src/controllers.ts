/**
 * Thin REST controllers (ADR-0006). Business logic lives in the engines;
 * controllers only: authenticate → authorize → validate → call engine.
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEPS, type Deps } from './deps.js';
import { parseBody, requireContext, toHttp } from './http.js';
import { permissionsOf } from '../../../engines/platform/src/auth/permissions.js';
import { closeShiftSchema, createCheckoutSchema, createRefundSchema, createSaleSchema, currentShiftQuerySchema, openShiftSchema, reportQuerySchema } from '../../../engines/transactions/src/contracts.js';
import { getSale, recordSale } from '../../../engines/transactions/src/sale-service.js';
import { checkout } from '../../../engines/transactions/src/checkout.js';
import { closeShift, getCurrentShift, getShift, openShift } from '../../../engines/transactions/src/shifts.js';
import { createRefund } from '../../../engines/transactions/src/refunds.js';
import { getDailyReport } from '../../../engines/transactions/src/reports.js';
import { listCatalog } from '../../../engines/catalog/src/catalog-service.js';
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
}

@ApiTags('sales')
@Controller('api/v1/checkout')
export class CheckoutController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

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
  @ApiOperation({ summary: 'Daily report: gross/refunds/net + by method (profit excluded)' })
  async daily(@Req() req: FastifyRequest, @Query() query: unknown) {
    const ctx = await requireContext(this.deps, req, { sale: ['read'] });
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
