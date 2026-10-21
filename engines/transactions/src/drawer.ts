/**
 * Drawer — the read side of the cash box, and the append-only resolver for pending cash.
 *
 * Contract: docs/architecture/proposals/0007-payment-engine.md §3 I11, §5 (`getDrawer`,
 * `resolvePendingCash`); docs/adr/kayyal-core/0009-cash-reconciliation.md;
 * docs/FINANCIAL_RULES.md §5.
 *
 * Two rules this file exists to keep:
 *
 *  1. **Pending cash is in the drawer but is never revenue.** It must appear in
 *     `expectedInDrawer` and must NOT appear in `expectedPosted`. `computeDrawer` in `cash.ts`
 *     is the single implementation of that split; this file only feeds it.
 *  2. **Resolving is an append, not an edit.** The migrated ledger revokes UPDATE from the runtime
 *     role, so `cash_movements.status` is frozen at insert. A resolution is a new row in
 *     `cash_movement_resolutions`; the effective status is `status` unless a resolution exists.
 */
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { computeDrawer, closeDifference, type CashMovement } from './cash.js';
import { cashMovementResolutions, cashMovements, cashShiftClosures, cashShifts } from './db/schema.js';
import { DomainError } from './line.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Resolution = 'posted' | 'returned';
const RESOLUTIONS: readonly Resolution[] = ['posted', 'returned'];

export interface DrawerActor {
  tenantId: string;
  userId: string;
}

/**
 * Same three numbers as `DrawerPosition`, but as integers in minor units — the drawer is money in
 * the box, not a decimal quantity, and each is an exact integer sum of `amount_minor` rows.
 */
export interface DrawerView {
  /** Posted movements only — this is what may feed revenue and profit. */
  expectedPosted: number;
  /** Unresolved inbound cash: in the box, never revenue. */
  pendingCash: number;
  /** What a physical count is compared against. */
  expectedInDrawer: number;

  shiftId: string;
  registerCode: string;
  /** Minor units, exactly what came in during the shift. */
  cashInMinor: number;
  /** Minor units, change handed back and cash refunds paid out. */
  cashOutMinor: number;
  openingMinor: number;
  /** Present once the shift is closed. */
  closure: {
    countedMinor: number;
    expectedMinor: number;
    differenceMinor: number;
    closedAt: Date;
  } | null;
  /**
   * True when a count taken now would be compared against `expectedInDrawer`.
   * A closed shift reports the numbers it was closed with, not a fresh recomputation.
   */
  closed: boolean;
}

interface MovementRow {
  id: string;
  direction: string;
  status: string;
  amountMinor: number;
  resolution: string | null;
}

/**
 * A movement's status as the drawer must see it.
 *  - no resolution      → its own status (`pending` still counts in the drawer only)
 *  - resolved `posted`  → posted (now revenue-eligible)
 *  - resolved `returned`→ removed from the drawer entirely: the money went back
 */
export function effectiveStatus(row: MovementRow): 'posted' | 'pending' {
  if (row.resolution === 'posted') return 'posted';
  if (row.resolution === 'returned') return 'posted'; // filtered out before the sum; see toCashMovement
  return row.status === 'posted' ? 'posted' : 'pending';
}

/** `null` means "ignore this row": a returned pending movement is no longer cash in the box. */
function toCashMovement(row: MovementRow): CashMovement | null {
  if (row.resolution === 'returned') return null;
  return {
    id: row.id,
    direction: row.direction === 'out' ? 'out' : 'in',
    amount: row.amountMinor as any, // integers in minor units; computeDrawer rounds to 2dp, which is exact
    status: effectiveStatus(row) as 'posted' | 'pending',
  } as unknown as CashMovement;
}

export async function getDrawer(db: AnyPgDatabase, tenantId: string, shiftId: string): Promise<DrawerView | null> {
  if (!UUID_RE.test(shiftId)) return null;
  return withTenant(db, tenantId, async (tx: any) => {
    const [shift] = await tx
      .select()
      .from(cashShifts)
      .where(and(eq(cashShifts.id, shiftId), eq(cashShifts.tenantId, tenantId)))
      .limit(1);
    if (!shift) return null;

    const rows: MovementRow[] = await tx
      .select({
        id: cashMovements.id,
        direction: cashMovements.direction,
        status: cashMovements.status,
        amountMinor: cashMovements.amountMinor,
        resolution: cashMovementResolutions.resolution,
      })
      .from(cashMovements)
      .leftJoin(cashMovementResolutions, eq(cashMovementResolutions.movementId, cashMovements.id))
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.shiftId, shiftId)));

    const movements = rows.map(toCashMovement).filter((m): m is CashMovement => m !== null);
    const position = computeDrawer((shift.openingMinor as number) as any, movements as any);

    const cashInMinor = rows
      .filter((r) => r.resolution !== 'returned' && r.direction === 'in')
      .reduce((s, r) => s + r.amountMinor, 0);
    const cashOutMinor = rows
      .filter((r) => r.resolution !== 'returned' && r.direction === 'out')
      .reduce((s, r) => s + r.amountMinor, 0);

    const [closure] = await tx
      .select()
      .from(cashShiftClosures)
      .where(and(eq(cashShiftClosures.shiftId, shiftId), eq(cashShiftClosures.tenantId, tenantId)))
      .limit(1);

    return {
      shiftId,
      registerCode: shift.registerCode,
      openingMinor: shift.openingMinor as number,
      expectedPosted: Number(position.expectedPosted),
      pendingCash: Number(position.pendingCash),
      expectedInDrawer: Number(position.expectedInDrawer),
      cashInMinor,
      cashOutMinor,
      closed: Boolean(closure),
      closure: closure
        ? {
            countedMinor: closure.countedMinor as number,
            expectedMinor: closure.expectedMinor as number,
            differenceMinor: closure.differenceMinor as number,
            closedAt: closure.closedAt as Date,
          }
        : null,
    };
  });
}

export interface ResolvePendingCashInput {
  movementId: string;
  resolution: Resolution;
  /** A cashier may only resolve their own shift unless they are a manager; the API enforces that. */
  reason?: string;
}

/**
 * Resolve one pending movement by appending a row. Never updates `cash_movements`.
 * Idempotent on `movement_id`: the same resolution replays, a different one is a conflict.
 */
export async function resolvePendingCash(
  db: AnyPgDatabase,
  actor: DrawerActor,
  input: ResolvePendingCashInput,
): Promise<{ resolution: Resolution; replayed: boolean; drawer: DrawerView }> {
  if (!UUID_RE.test(input.movementId)) throw new DomainError('invalid_movement', 'معرف الحركة غير صالح');
  if (!RESOLUTIONS.includes(input.resolution)) throw new DomainError('invalid_resolution', 'طريقة التسوية غير صالحة');

  const shiftId = await withTenant(db, actor.tenantId, async (tx: any) => {
    const [movement] = await tx
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.id, input.movementId), eq(cashMovements.tenantId, actor.tenantId)))
      .limit(1);
    if (!movement) throw new DomainError('movement_not_found', 'الحركة غير موجودة');

    const [existing] = await tx
      .select()
      .from(cashMovementResolutions)
      .where(eq(cashMovementResolutions.movementId, input.movementId))
      .limit(1);
    if (existing) {
      if (existing.resolution !== input.resolution) {
        throw new DomainError('resolution_conflict', 'الحركة سُوّيت بقرار مختلف');
      }
      return { shiftId: movement.shiftId as string, replayed: true };
    }

    if (movement.status !== 'pending') {
      throw new DomainError('movement_not_pending', 'الحركة ليست معلّقة');
    }

    await tx
      .insert(cashMovementResolutions)
      .values({ tenantId: actor.tenantId, movementId: input.movementId, resolution: input.resolution });
    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'resolve_pending_cash',
      entity: 'cash_movements',
      entityId: input.movementId,
      payload: JSON.stringify({ resolution: input.resolution, reason: input.reason ?? null }),
    });
    return { shiftId: movement.shiftId as string, replayed: false };
  });

  const drawer = await getDrawer(db, actor.tenantId, shiftId.shiftId);
  if (!drawer) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
  return { resolution: input.resolution, replayed: shiftId.replayed, drawer };
}

/** Difference a count would produce right now, using the same arithmetic `closeShift` uses. */
export function drawerDifference(countedMinor: number, drawer: DrawerView): number {
  return Number(closeDifference(new Decimal(countedMinor) as any, new Decimal(drawer.expectedInDrawer) as any));
}
