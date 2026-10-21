import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashShifts } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { cairoDayBounds, cairoOffsetMinutesForUTC, getDailyReport } from '../src/reports.js';

// Day boundaries come from production (reports.ts); no local copy, so a regression
// in getDailyReport's timezone handling fails here.
const parseDayCairo = (day: string, end: boolean): Date => (end ? cairoDayBounds(day).end : cairoDayBounds(day).start);

let opened: OpenedDatabase;
let db: NileDb;
let tenant: string;
let variant: string;

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [org] = await db.insert(organization).values({ name: 'DSTTest', slug: 'dst-test-'+Date.now() }).returning({ id: organization.id }) as [{ id: string }];
  tenant = org.id;
  const [item] = await withTenant(db, tenant, async (tx:any)=> tx.insert(catalogItems).values({ tenantId: tenant, nameAr:'مياه', nameEn:'Water', category:'drinks', priceMinor:1000, isActive:true }).returning({ id: catalogItems.id }));
  const [v] = await withTenant(db, tenant, async (tx:any)=> tx.insert(catalogVariants).values({ tenantId: tenant, itemId: item.id as string, sku:`WTR-DST-${Date.now()}`, labelAr:'a', labelEn:'a', stock:'100.000' }).returning({ id: catalogVariants.id }));
  variant = v.id as string;
});
afterAll(()=> opened.close());

describe('Africa/Cairo DST 2026 — report day boundaries', () => {
  it('parses 2026-04-24 start with +3 after transition (23h day)', () => {
    const from = parseDayCairo('2026-04-24', false);
    const to = parseDayCairo('2026-04-24', true);
    expect(from.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-04-24T21:00:00.000Z');
    expect((to.getTime()-from.getTime())/3600000).toBe(23);
    expect(cairoOffsetMinutesForUTC(from)).toBe(180);
  });

  it('parses 2026-04-23 (day before transition) 24h long', () => {
    const from = parseDayCairo('2026-04-23', false);
    const to = parseDayCairo('2026-04-23', true);
    expect(from.toISOString()).toBe('2026-04-22T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect((to.getTime()-from.getTime())/3600000).toBe(24);
  });

  it('parses 2026-10-29 25h long (DST end)', () => {
    const from29 = parseDayCairo('2026-10-29', false);
    const to29 = parseDayCairo('2026-10-29', true);
    expect(from29.toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(to29.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    expect((to29.getTime()-from29.getTime())/3600000).toBe(25);
  });

  it('sale at 2026-04-23 21:00 UTC counted on 2026-04-23 Cairo, sale at 22:00 UTC on 2026-04-24', async () => {
    const shiftId = await withTenant(db, tenant, async (tx:any)=>{
      const [s]= await tx.insert(cashShifts).values({ tenantId: tenant, registerCode:'dst-1', openedBy:tenant, openingMinor:0, idempotencyKey:'dst-shift-1-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const saleTime1 = new Date('2026-04-23T21:00:00.000Z');
    const saleTime2 = new Date('2026-04-23T22:00:00.000Z');
    const { salesTransactions } = await import('../src/db/schema.js');
    const [s1] = await withTenant(db, tenant, async (tx:any)=>{
      const [r]= await tx.insert(salesTransactions).values({ tenantId: tenant, kind:'sale', totalMinor:1000, idempotencyKey:'dst-1-'+Date.now(), requestHash:'h1', createdBy:tenant, createdAt: saleTime1 }).returning({ id: salesTransactions.id });
      return [r];
    });
    const [s2] = await withTenant(db, tenant, async (tx:any)=>{
      const [r]= await tx.insert(salesTransactions).values({ tenantId: tenant, kind:'sale', totalMinor:2000, idempotencyKey:'dst-2-'+Date.now(), requestHash:'h2', createdBy:tenant, createdAt: saleTime2 }).returning({ id: salesTransactions.id });
      return [r];
    });
    const { payments } = await import('../src/db/schema.js');
    await withTenant(db, tenant, async (tx:any)=>{
      await tx.insert(payments).values({ tenantId: tenant, transactionId: s1.id, method:'cash', amountMinor:1000, idempotencyKey:'pay-dst-1-'+Date.now(), requestHash:'h', createdBy:tenant, createdAt: saleTime1 });
      await tx.insert(payments).values({ tenantId: tenant, transactionId: s2.id, method:'cash', amountMinor:2000, idempotencyKey:'pay-dst-2-'+Date.now(), requestHash:'h', createdBy:tenant, createdAt: saleTime2 });
    });
    const report23 = await getDailyReport(db, tenant, { from:'2026-04-23', to:'2026-04-23' });
    const report24 = await getDailyReport(db, tenant, { from:'2026-04-24', to:'2026-04-24' });
    // With correct bounds: 04-23 is 22:00 04-22 to 22:00 04-23, so saleTime1 21:00 is before start of 04-24? Let's check: 21:00 UTC 04-23 is within 04-23 day (22:00 04-22 to 22:00 04-23) inclusive, so report23 should contain 1000. saleTime2 22:00 UTC 04-23 is start of 04-24, so report24 should contain 2000
    expect(report23.grossMinor).toBe(1000);
    expect(report24.grossMinor).toBe(2000);
    expect(report23.grossMinor + report24.grossMinor).toBe(3000);
  });

  async function saleAt(iso: string, minor: number, key: string) {
    const { salesTransactions, payments } = await import('../src/db/schema.js');
    await withTenant(db, tenant, async (tx: any) => {
      const [s] = await tx.insert(salesTransactions).values({ tenantId: tenant, kind: 'sale', totalMinor: minor, idempotencyKey: key, requestHash: 'h', createdBy: tenant, createdAt: new Date(iso) }).returning({ id: salesTransactions.id });
      await tx.insert(payments).values({ tenantId: tenant, transactionId: s.id, method: 'cash', amountMinor: minor, idempotencyKey: key + '-p', requestHash: 'h', createdBy: tenant, createdAt: new Date(iso) });
    });
  }

  it('summer (+3) via getDailyReport: 2026-07-15T21:30Z is Cairo 07-16 00:30 and belongs to 07-16', async () => {
    await saleAt('2026-07-15T21:30:00Z', 111, 'dst-p1-' + Date.now());
    expect((await getDailyReport(db, tenant, { from: '2026-07-15', to: '2026-07-15' })).grossMinor).toBe(0);
    expect((await getDailyReport(db, tenant, { from: '2026-07-16', to: '2026-07-16' })).grossMinor).toBe(111);
  });

  it('25h day 2026-10-29 via getDailyReport: 00:30 (+3) and 23:30 (+2) on 10-29; 10-30 00:00 (+2) is not', async () => {
    await saleAt('2026-10-28T21:30:00Z', 300, 'dst-p2a-' + Date.now()); // Cairo 10-29 00:30, +3
    await saleAt('2026-10-29T21:30:00Z', 400, 'dst-p2b-' + Date.now()); // Cairo 10-29 23:30, +2 (after fall-back)
    await saleAt('2026-10-29T22:00:00Z', 500, 'dst-p2c-' + Date.now()); // Cairo 10-30 00:00, +2
    expect((await getDailyReport(db, tenant, { from: '2026-10-28', to: '2026-10-28' })).grossMinor).toBe(0);
    expect((await getDailyReport(db, tenant, { from: '2026-10-29', to: '2026-10-29' })).grossMinor).toBe(700);
    expect((await getDailyReport(db, tenant, { from: '2026-10-30', to: '2026-10-30' })).grossMinor).toBe(500);
  });
});
