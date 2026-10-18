import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashShifts } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { getDailyReport } from '../src/reports.js';

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

function cairoParts(utcDate: Date){ const s=utcDate.toLocaleString('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); const [mdy='',hms='']=s.split(', '); const [m=NaN,d=NaN,y=NaN]=mdy.split('/').map(Number); const [h=NaN,mi=NaN,sec=NaN]=hms.split(':').map(Number); return {y,m,d,h,mi,sec}; }
function cairoOffsetMinutesForUTC(utcDate: Date): number { const p=cairoParts(utcDate); const cairoAsUTC=Date.UTC(p.y,p.m-1,p.d,p.h,p.mi,p.sec); return Math.round((cairoAsUTC-utcDate.getTime())/60000); }
function findCairoDayStartUTC(y:number,m:number,d:number): Date {
  const wallMidnightUTC=Date.UTC(y,m-1,d,0,0,0);
  let best: Date|null=null;
  for(let off=200; off>=60; off--){ const cand=new Date(wallMidnightUTC - off*60000); const pt=cairoParts(cand); if(pt.y===y && pt.m===m && pt.d===d){ if(!best || cand.getTime() < best.getTime()) best=cand; } }
  if(best) return best;
  const off=cairoOffsetMinutesForUTC(new Date(wallMidnightUTC)); return new Date(wallMidnightUTC - off*60000);
}
function parseDayCairo(s: string, end:boolean): Date {
  const [y=NaN,m=NaN,d=NaN] = s.split('-').map(Number);
  if(!end) return findCairoDayStartUTC(y,m,d);
  const dt=new Date(Date.UTC(y,m-1,d+1)); return findCairoDayStartUTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, dt.getUTCDate());
}

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
});
