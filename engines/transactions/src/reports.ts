/**
 * Daily reports — gross/refunds/net, counts, by payment method.
 * Profit excluded until cost data trusted.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { payments, refunds, salesTransactions } from './db/schema.js';

export interface ReportActor { tenantId: string; }
export interface ReportRange { from: string; to: string; } // YYYY-MM-DD inclusive, Africa/Cairo

/**
 * Decision D-E (owner-delegated, decided 2026-10-19): the sales total means **money collected**,
 * with refunds as their own line. `billedMinor` stays visible so nothing is hidden, but the number
 * the owner reads at night is `netCollectedMinor`.
 *
 * Why this way and not the other: the engine already refuses to treat unresolved cash as revenue
 * (I11, and `pendingCash` lives in the drawer only). A report that counted rung-up sales would then
 * contradict the drawer in the same screen. Also, "I sold 5,000" and "I collected 4,200 and 800 is
 * owed" are different facts, and only the second one is a cash fact.
 */
export interface DailyReport {
  period: { from: string; to: string };

  /** What was rung up: Σ sale totals. NOT the collected figure — see `netCollectedMinor`. */
  billedMinor: number;
  billedCount: number;

  /** Money actually received in the period: Σ payments. */
  collectedMinor: number;
  collectedCount: number;

  refundsMinor: number;
  refundsCount: number;

  /** D-E headline: collected − refunds. This is "إجمالي المبيعات". */
  netCollectedMinor: number;

  /** Billed minus what has been settled, over the sales of this period only. */
  outstandingMinor: number;

  /** @deprecated alias of `billedMinor`, kept so older callers keep reading the same number. */
  grossMinor: number;
  /** @deprecated alias of `billedCount`. */
  grossCount: number;
  /** @deprecated alias of `billedMinor - refundsMinor`; it is NOT the D-E headline. */
  netMinor: number;

  byMethod: Array<{ method: string; totalMinor: number; count: number }>;
}

function cairoParts(utcDate: Date): { y: number; m: number; d: number; h: number; mi: number; sec: number; s: string } {
  const s = utcDate.toLocaleString('en-US', {
    timeZone: 'Africa/Cairo', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const [mdy = '', hms = ''] = s.split(', ');
  const [m = NaN, d = NaN, y = NaN] = mdy.split('/').map(Number);
  const [h = NaN, mi = NaN, sec = NaN] = hms.split(':').map(Number);
  return { y, m, d, h, mi, sec, s };
}

export function cairoOffsetMinutesForUTC(utcDate: Date): number {
  const p = cairoParts(utcDate);
  const cairoAsUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.sec);
  return Math.round((cairoAsUTC - utcDate.getTime()) / 60000);
}

function findCairoDayStartUTC(y: number, m: number, d: number): Date {
  const wallMidnightUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  let best: Date | null = null;
  for (let off = 200; off >= 60; off--) {
    const cand = new Date(wallMidnightUTC - off * 60000);
    const pt = cairoParts(cand);
    if (pt.y === y && pt.m === m && pt.d === d) {
      if (!best || cand.getTime() < best.getTime()) best = cand;
    }
  }
  if (best) return best;
  const off = cairoOffsetMinutesForUTC(new Date(wallMidnightUTC));
  return new Date(wallMidnightUTC - off * 60000);
}

function parseDay(s: string, end: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('invalid_date');
  const [y, m, d] = s.split('-').map(Number);
  if (!end) {
    return findCairoDayStartUTC(y as number, m as number, d as number);
  } else {
    const dt = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + 1));
    const ny = dt.getUTCFullYear(), nm = dt.getUTCMonth() + 1, nd = dt.getUTCDate();
    return findCairoDayStartUTC(ny, nm, nd);
  }
}

/**
 * The UTC instants bounding one Africa/Cairo calendar day: [start, end).
 * Exported so tests exercise the exact code getDailyReport uses (23h/24h/25h days).
 */
export function cairoDayBounds(day: string): { start: Date; end: Date } {
  return { start: parseDay(day, false), end: parseDay(day, true) };
}

export async function getDailyReport(db: AnyPgDatabase, tenantId: string, range: ReportRange): Promise<DailyReport> {
  const from = parseDay(range.from, false);
  const to = parseDay(range.to, true);
  return withTenant(db, tenantId, async (tx: any) => {
    const [grossRow] = await tx
      .select({ sum: sql<number>`COALESCE(SUM(${salesTransactions.totalMinor}),0)`, cnt: sql<number>`COUNT(*)::int` })
      .from(salesTransactions)
      .where(and(eq(salesTransactions.tenantId, tenantId), eq(salesTransactions.kind, 'sale'), gte(salesTransactions.createdAt, from), lt(salesTransactions.createdAt, to)));
    const grossMinor = Number(grossRow?.sum ?? 0);
    const grossCount = Number(grossRow?.cnt ?? 0);
    const [refRow] = await tx
      .select({ sum: sql<number>`COALESCE(SUM(${refunds.amountMinor}),0)`, cnt: sql<number>`COUNT(*)::int` })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), gte(refunds.createdAt, from), lt(refunds.createdAt, to)));
    const refundsMinor = Number(refRow?.sum ?? 0);
    const refundsCount = Number(refRow?.cnt ?? 0);
    const netMinor = grossMinor - refundsMinor;
    const [collectedRow] = await tx
      .select({ sum: sql<number>`COALESCE(SUM(${payments.amountMinor}),0)`, cnt: sql<number>`COUNT(*)::int` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), gte(payments.createdAt, from), lt(payments.createdAt, to)));
    const collectedMinor = Number(collectedRow?.sum ?? 0);
    const collectedCount = Number(collectedRow?.cnt ?? 0);

    // Outstanding is a balance, not a period flow: it is measured over the sales rung up in the
    // period, wherever the money for them arrived. Per sale, floored at zero.
    const outstandingRes = (await tx.execute(sql`
      SELECT COALESCE(SUM(GREATEST(
        t.total_minor
        - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.tenant_id = t.tenant_id AND p.transaction_id = t.id), 0)
        + COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.tenant_id = t.tenant_id AND r.transaction_id = t.id), 0)
      , 0)), 0) AS outstanding
      FROM sales_transactions t
      WHERE t.tenant_id = ${tenantId} AND t.kind = 'sale'
        AND t.created_at >= ${from} AND t.created_at < ${to}
    `)) as unknown as { rows: Array<{ outstanding: string | number }> };
    const outstandingMinor = Number(outstandingRes.rows[0]?.outstanding ?? 0);

    const byMethodRows = await tx
      .select({ method: payments.method, total: sql<number>`COALESCE(SUM(${payments.amountMinor}),0)`, cnt: sql<number>`COUNT(*)::int` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), gte(payments.createdAt, from), lt(payments.createdAt, to)))
      .groupBy(payments.method);
    const byMethod = (byMethodRows as Array<{ method: string; total: number; cnt: number }>).map((r) => ({ method: r.method, totalMinor: Number(r.total), count: Number(r.cnt) }));
    return {
      period: range,
      billedMinor: grossMinor,
      billedCount: grossCount,
      collectedMinor,
      collectedCount,
      refundsMinor,
      refundsCount,
      netCollectedMinor: collectedMinor - refundsMinor,
      outstandingMinor,
      grossMinor,
      grossCount,
      netMinor,
      byMethod,
    };
  });
}
