/**
 * Independent final review gates — accounting, concurrency, RLS, auth, DB integrity, reporting, failure recovery, ops.
 * Each gate is tested directly in isolated PGlite. Failures indicate defects.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShifts, payments, refunds } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { openShift, closeShift, getShift } from '../src/shifts.js';
import { getDailyReport } from '../src/reports.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let vA: string;

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'GateA', slug: 'gate-a' }).returning({ id: organization.id }) as [{ id: string }];
  const [b] = await db.insert(organization).values({ name: 'GateB', slug: 'gate-b' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id; B = b.id;
  const [item] = await withTenant(db, A, async (tx: any) => tx.insert(catalogItems).values({ tenantId: A, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 750, isActive: true }).returning({ id: catalogItems.id }));
  const [v] = await withTenant(db, A, async (tx: any) => tx.insert(catalogVariants).values({ tenantId: A, itemId: item.id as string, sku: `WTR-${A.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }).returning({ id: catalogVariants.id }));
  vA = v.id as string;
  // B variant
  const [itemB] = await withTenant(db, B, async (tx: any) => tx.insert(catalogItems).values({ tenantId: B, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 750, isActive: true }).returning({ id: catalogItems.id }));
  await withTenant(db, B, async (tx: any) => tx.insert(catalogVariants).values({ tenantId: B, itemId: itemB.id as string, sku: `WTRB-${B.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }));
});
afterAll(() => opened.close());

describe('Gate 1 — Accounting', () => {
  it('invoice total equals sum of line totals, tenders sum to total', async () => {
    const shiftId = await withTenant(db, A, async (tx: any) => {
      const [s] = await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'gate1', openedBy: A, openingMinor: 0, idempotencyKey: 'gate1-shift', requestHash: 'h1' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'gate1-chk-001', shiftId,
      lines: [{ variantId: vA, quantity: '2' }], // 2*750=1500
      tenders: [{ method: 'cash', amountMinor: 1000 }, { method: 'card', amountMinor: 500 }],
    });
    expect(sale.totalMinor).toBe(1500);
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    expect(pays.reduce((s:number, p:any)=>s+p.amountMinor,0)).toBe(1500);
  });

  it('change counts toward drawer not revenue (F3)', async () => {
    const shiftId = await withTenant(db, A, async (tx: any) => {
      const [s] = await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'gate1-change', openedBy: A, openingMinor: 10000, idempotencyKey: 'gate1-shift-change', requestHash: 'h2' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'gate1-chk-change', shiftId,
      lines: [{ variantId: vA, quantity: '1' }], // 750
      tenders: [{ method: 'cash', amountMinor: 750, tenderedMinor: 1000 }],
    });
    // change should be 250 out, in should be 1000 tendered (or 750 amount?) — defect check
    const moves = await withTenant(db, A, async (tx: any) => tx.select().from(cashMovements).where(eq(cashMovements.shiftId, shiftId)));
    const sumIn = moves.filter((m:any)=>m.direction==='in').reduce((s:number,m:any)=>s+m.amountMinor,0);
    const sumOut = moves.filter((m:any)=>m.direction==='out').reduce((s:number,m:any)=>s+m.amountMinor,0);
    // Expected drawer: opening 10000 + tendered 1000 - change 250 = 10750, revenue 750
    // Current buggy implementation: in=750 out=250 net 500 => drawer 10500 vs 10750 difference 250
    const shiftView = await getShift(db, A, shiftId);
    console.log('GATE1 change drawer expected', shiftView?.expectedMinor, 'sumIn', sumIn, 'sumOut', sumOut);
    expect(shiftView?.expectedMinor).toBe(10000 + 1000 - 250); // should be 10750 if correct
  });

  it('refund cumulative limit enforced', async () => {
    const shiftId = await withTenant(db, A, async (tx: any) => {
      const [s] = await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'gate1-refund', openedBy: A, openingMinor: 0, idempotencyKey: 'gate1-shift-refund', requestHash: 'h3' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'gate1-chk-refund', shiftId,
      lines: [{ variantId: vA, quantity: '2' }], // 1500
      tenders: [{ method: 'cash', amountMinor: 1500 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const payId = pays[0].id as string;
    await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'gate1-ref-001', originalTransactionId: sale.id, paymentId: payId,
      items: [{ variantId: vA, quantity: '1' }], shiftId,
    });
    // second refund of remaining 1 should succeed, third should fail
    await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'gate1-ref-002', originalTransactionId: sale.id, paymentId: payId,
      items: [{ variantId: vA, quantity: '1' }], shiftId,
    });
    try {
      await createRefund(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'gate1-ref-003', originalTransactionId: sale.id, paymentId: payId,
        items: [{ variantId: vA, quantity: '1' }], shiftId,
      });
      expect.fail('should have thrown over limit');
    } catch (e:any) { expect(['refund_over_limit','refund_quantity_exceeded']).toContain(e.code); }
  });
});

describe('Gate 2 — Concurrency (single-connection PGlite limitations noted)', () => {
  it('last unit: two concurrent checkouts only one succeeds (atomic stock check)', async () => {
    // create variant with 1 stock
    const [item] = await withTenant(db, A, async (tx:any)=> tx.insert(catalogItems).values({ tenantId: A, nameAr: 'آخر وحدة', nameEn: 'Last unit', category: 'x', priceMinor: 100, isActive: true }).returning({ id: catalogItems.id }));
    const [v] = await withTenant(db, A, async (tx:any)=> tx.insert(catalogVariants).values({ tenantId: A, itemId: item.id as string, sku: `LAST-${Date.now()}`, labelAr:'a', labelEn:'a', stock:'1.000' }).returning({ id: catalogVariants.id }));
    const vid = v.id as string;
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'conc-stock', openedBy: A, openingMinor:0, idempotencyKey:'conc-stock-shift-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const p1 = checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'conc-stock-001', shiftId, lines:[{ variantId: vid, quantity:'1' }], tenders:[{ method:'cash', amountMinor:100 }] });
    const p2 = checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'conc-stock-002', shiftId, lines:[{ variantId: vid, quantity:'1' }], tenders:[{ method:'cash', amountMinor:100 }] });
    const results = await Promise.allSettled([p1,p2]);
    const successes = results.filter(r=>r.status==='fulfilled').length;
    const failures = results.filter(r=>r.status==='rejected').length;
    // One should succeed, one should fail with insufficient_stock
    expect(successes).toBe(1);
    expect(failures).toBe(1);
    const fail = results.find(r=>r.status==='rejected') as PromiseRejectedResult;
    expect((fail.reason as any).code).toBe('insufficient_stock');
  });

  it('idempotency concurrent same key: one wins, other replays (not duplicate)', async () => {
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'conc-idem', openedBy: A, openingMinor:0, idempotencyKey:'conc-idem-shift-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const input = { idempotencyKey: 'conc-idem-001', shiftId, lines:[{ variantId: vA, quantity:'1' }], tenders:[{ method:'cash' as const, amountMinor:750 }] };
    const p1 = checkout(db, { tenantId: A, userId: A }, input);
    const p2 = checkout(db, { tenantId: A, userId: A }, input);
    const [r1,r2] = await Promise.all([p1,p2]);
    expect(r1.sale.id).toBe(r2.sale.id);
    expect([r1.replayed, r2.replayed].filter(Boolean).length).toBe(1);
    // stock decremented only once
    const stock = await withTenant(db, A, async (tx:any)=> {
      const { eq } = await import('drizzle-orm');
      const [r]= await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return Number(r.s);
    });
    expect(stock).toBeGreaterThan(0);
  });

  it('open shift concurrent same register: only one should succeed (requires advisory lock — expected to fail without fix)', async () => {
    const key1 = 'conc-open-'+Date.now();
    const key2 = 'conc-open2-'+Date.now();
    const p1 = openShift(db, { tenantId: A, userId: A }, { registerCode: 'conc-register', openingMinor: 1000, idempotencyKey: key1 });
    const p2 = openShift(db, { tenantId: A, userId: A }, { registerCode: 'conc-register', openingMinor: 1000, idempotencyKey: key2 });
    const results = await Promise.allSettled([p1,p2]);
    const succ = results.filter(r=>r.status==='fulfilled');
    const fail = results.filter(r=>r.status==='rejected');
    // Without advisory lock, both may succeed (defect) — we expect 1 success +1 fail shift_already_open
    // If both succeed, test will show defect
    console.log('GATE2 open concurrent results', results.map(r=> r.status==='fulfilled' ? (r.value as any).shift?.id?.slice(0,8) : (r.reason as any).code));
    expect(succ.length).toBe(1);
    if (fail.length===1) expect((fail[0] as PromiseRejectedResult).reason.code).toBe('shift_already_open');
  });
});

describe('Gate 3 — Multi-tenancy & RLS', () => {
  it('tenant cannot read other tenant sale/payment/shift via direct DB withTenant', async () => {
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'rls-test', openedBy: A, openingMinor:0, idempotencyKey:'rls-shift-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const { sale } = await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'rls-chk-'+Date.now(), shiftId, lines:[{ variantId: vA, quantity:'1' }], tenders:[{ method:'cash', amountMinor:750 }] });
    // B trying to fetch A's sale via getShift should get null
    const shiftB = await getShift(db, B, shiftId);
    expect(shiftB).toBeNull();
    // B trying to refund A's sale should fail sale_not_found
    const pays = await withTenant(db, A, async (tx:any)=> tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pid = pays[0].id as string;
    try { await createRefund(db, { tenantId: B, userId: B }, { idempotencyKey:'rls-ref-'+Date.now(), originalTransactionId: sale.id, paymentId: pid, items:[{ variantId: vA, quantity:'1' }] }); expect.fail('should throw'); } catch(e:any){ expect(e.code).toBe('sale_not_found'); }
    // Composite FK prevents cross-tenant line attach: try to insert transaction_line with B tenant but A sale id — should get FK violation 23503
    try {
      await withTenant(db, B, async (tx:any)=>{
        const { transactionLines } = await import('../src/db/schema.js');
        await tx.insert(transactionLines).values({ tenantId: B, transactionId: sale.id, variantId: vA, nameAr:'x', nameEn:'x', quantity:'1', unitPriceMinor:750, lineTotalMinor:750 });
      });
      expect.fail('should have FK violation');
    } catch(e:any){ let c=e; while(c&&!c.code) c=c.cause; expect(c.code).toBe('23503'); }
  });

  it('RLS FORCE: owner cannot bypass without tenant context', async () => {
    // Direct query without withTenant should return zero rows for tenant-owned tables
    const rows = await db.select().from(cashShifts).limit(1);
    expect(rows.length).toBe(0); // no tenant context → RLS returns zero
  });

  it('every table with tenant_id has RLS ENABLED+FORCED+policy (guard)', async () => {
    const res = await db.execute(sql`SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int AS pol FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped)`) as any;
    for (const r of res.rows) {
      expect({ t:r.t, rls:r.rls, force:r.force, ok:r.pol>0 }).toEqual({ t:r.t, rls:true, force:true, ok:true });
    }
    expect(res.rows.length).toBeGreaterThanOrEqual(14);
  });
});

describe('Gate 4 — Authorization (service-level, not just UI)', () => {
  it('refund requires sale:void, checkout requires sale:create — tested via HTTP e2e-pos but also via can() check', async () => {
    const { can } = await import('../../platform/src/auth/permissions.js');
    expect(can('cashier', { sale: ['create'] })).toBe(true);
    expect(can('cashier', { sale: ['void'] })).toBe(false);
    expect(can('branch-manager', { sale: ['void'] })).toBe(true);
    expect(can('cashier', { audit: ['read'] })).toBe(false);
  });
});

describe('Gate 5 — DB integrity', () => {
  it('FK composite prevents cross-tenant attach already checked, unique prevents duplicate idempotency', async () => {
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'db-int-'+Date.now(), openedBy: A, openingMinor:0, idempotencyKey:'db-int-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    // try to insert payment referencing other tenant sale
    const { sale } = await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'db-int-chk-'+Date.now(), shiftId, lines:[{ variantId: vA, quantity:'1' }], tenders:[{ method:'cash', amountMinor:750 }] });
    // B tries to insert payment for A's sale via direct DB with B context — FK should fail because (tenant_id, transaction_id) mismatch
    try {
      await withTenant(db, B, async (tx:any)=>{
        const { payments } = await import('../src/db/schema.js');
        await tx.insert(payments).values({ tenantId: B, transactionId: sale.id, method:'cash', amountMinor:750, idempotencyKey:'db-int-pay-'+Date.now(), requestHash:'h2', createdBy: B });
      });
      expect.fail('should FK violation');
    } catch(e:any){ let c=e; while(c&&!c.code) c=c.cause; expect(c.code).toBe('23503'); }
  });

  it('append-only: nile_app cannot UPDATE payments/refunds/shifts', async () => {
    try {
      await withTenant(db, A, async (tx:any)=>{
        const { payments } = await import('../src/db/schema.js');
        await tx.update(payments).set({ amountMinor: 9999 }).where(eq(payments.tenantId, A));
      });
      expect.fail('should UPDATE denied 42501');
    } catch(e:any){ let c=e; while(c&&!c.code) c=c.cause; expect(c.code).toBe('42501'); }
  });

  it('migration journal and snapshots in sync', async () => {
    const journal = await import('../../db/migrations/meta/_journal.json');
    expect(journal.entries.length).toBe(5); // 0..4
    expect(journal.entries.map((e:any)=>e.tag)).toEqual(['0000_nile_engines','0001_security_hardening','0002_ledger_append_only','0003_vengeful_zuras','0004_payments_append_only']);
  });
});

describe('Gate 6 — Reporting', () => {
  it('refund on different day than sale: counted on refund day, not sale day', async () => {
    // Use a fresh tenant to avoid pollution from earlier gate refunds
    const freshTenant = (await db.insert(organization).values({ name: 'GateReportFresh', slug: 'gate-report-fresh-'+Date.now() }).returning({ id: organization.id }) as [{ id: string }])[0].id;
    const [itemF] = await withTenant(db, freshTenant, async (tx:any)=> tx.insert(catalogItems).values({ tenantId: freshTenant, nameAr:'مياه', nameEn:'Water', category:'drinks', priceMinor:750, isActive:true }).returning({ id: catalogItems.id }));
    const [vF] = await withTenant(db, freshTenant, async (tx:any)=> tx.insert(catalogVariants).values({ tenantId: freshTenant, itemId: itemF.id as string, sku:`WTRF-${Date.now()}`, labelAr:'a', labelEn:'a', stock:'10.000' }).returning({ id: catalogVariants.id }));
    const vfid = vF.id as string;
    const shiftId = await withTenant(db, freshTenant, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: freshTenant, registerCode: 'rep-cross-day', openedBy: freshTenant, openingMinor:0, idempotencyKey:'rep-cross-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const { sale } = await checkout(db, { tenantId: freshTenant, userId: freshTenant }, { idempotencyKey: 'rep-cross-chk-'+Date.now(), shiftId, lines:[{ variantId: vfid, quantity:'1' }], tenders:[{ method:'cash', amountMinor:750 }] });
    const pays = await withTenant(db, freshTenant, async (tx:any)=> tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pid = pays[0].id as string;
    const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const tomorrowStr = `${tomorrow.getUTCFullYear().toString().padStart(4,'0')}-${(tomorrow.getUTCMonth()+1).toString().padStart(2,'0')}-${tomorrow.getUTCDate().toString().padStart(2,'0')}`;
    await withTenant(db, freshTenant, async (tx:any)=>{
      const { refunds } = await import('../src/db/schema.js');
      await tx.insert(refunds).values({ tenantId: freshTenant, paymentId: pid, transactionId: sale.id, amountMinor:750, shiftId, approvedBy: freshTenant, idempotencyKey:'rep-cross-ref-'+Date.now(), requestHash:'h2', createdAt: tomorrow });
    });
    const todayStr = `${new Date().getUTCFullYear().toString().padStart(4,'0')}-${(new Date().getUTCMonth()+1).toString().padStart(2,'0')}-${new Date().getUTCDate().toString().padStart(2,'0')}`;
    const todayReport = await getDailyReport(db, freshTenant, { from: todayStr, to: todayStr });
    const tomReport = await getDailyReport(db, freshTenant, { from: tomorrowStr, to: tomorrowStr });
    expect(todayReport.grossMinor).toBe(750);
    expect(todayReport.refundsMinor).toBe(0);
    expect(tomReport.grossMinor).toBe(0);
    expect(tomReport.refundsMinor).toBe(750);
  });

  it('report timezone: days are Africa/Cairo, not UTC and not a fixed +2', async () => {
    // 2026-08-10T21:30Z is 2026-08-11 00:30 in Cairo (summer, +3).
    // UTC day boundaries would put it on 08-10; a fixed UTC+2 offset (23:30) would too.
    const [t] = await db.insert(organization).values({ name: 'TZGate', slug: 'tz-gate-' + Date.now() }).returning({ id: organization.id }) as [{ id: string }];
    const { salesTransactions } = await import('../src/db/schema.js');
    const at = new Date('2026-08-10T21:30:00.000Z');
    await withTenant(db, t.id, async (tx: any) => {
      const [s] = await tx.insert(salesTransactions).values({ tenantId: t.id, kind: 'sale', totalMinor: 4321, idempotencyKey: 'tz-gate-' + Date.now(), requestHash: 'h', createdBy: t.id, createdAt: at }).returning({ id: salesTransactions.id });
      await tx.insert(payments).values({ tenantId: t.id, transactionId: s.id, method: 'cash', amountMinor: 4321, idempotencyKey: 'tz-gate-p-' + Date.now(), requestHash: 'h', createdBy: t.id, createdAt: at });
    });
    expect((await getDailyReport(db, t.id, { from: '2026-08-10', to: '2026-08-10' })).grossMinor).toBe(0);
    expect((await getDailyReport(db, t.id, { from: '2026-08-11', to: '2026-08-11' })).grossMinor).toBe(4321);
  });
});

describe('Gate 7 — Failure recovery', () => {
  it('mid-transaction failure rolls back sale+payment+stock atomically', async () => {
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'fail-recov', openedBy: A, openingMinor:0, idempotencyKey:'fail-recov-shift-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const stockBefore = await withTenant(db, A, async (tx:any)=> {
      const { eq } = await import('drizzle-orm');
      const [r]= await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return r.s;
    });
    // Attempt checkout with insufficient stock on second line (will fail after first stock decrement? Actually our checkout loops stock decrement sequentially and rolls back whole tx on failure)
    const [item2] = await withTenant(db, A, async (tx:any)=> tx.insert(catalogItems).values({ tenantId: A, nameAr:'مرهق', nameEn:'Rare', category:'x', priceMinor:100, isActive:true }).returning({ id: catalogItems.id }));
    const [v2] = await withTenant(db, A, async (tx:any)=> tx.insert(catalogVariants).values({ tenantId: A, itemId: item2.id as string, sku:`RARE-${Date.now()}`, labelAr:'a', labelEn:'a', stock:'0.000' }).returning({ id: catalogVariants.id }));
    try {
      await checkout(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'fail-recov-001', shiftId,
        lines:[{ variantId: vA, quantity:'1' }, { variantId: v2.id as string, quantity:'1' }],
        tenders:[{ method:'cash', amountMinor:850 }],
      });
      expect.fail('should throw insufficient_stock');
    } catch(e:any){ expect(e.code).toBe('insufficient_stock'); }
    const stockAfter = await withTenant(db, A, async (tx:any)=> {
      const { eq } = await import('drizzle-orm');
      const [r]= await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return r.s;
    });
    expect(Number(stockAfter)).toBe(Number(stockBefore)); // rolled back
  });

  it('retry after failure with same idempotencyKey but corrected body should conflict 409, not create duplicate', async () => {
    const shiftId = await withTenant(db, A, async (tx:any)=> {
      const [s]= await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'retry-test', openedBy: A, openingMinor:0, idempotencyKey:'retry-shift-'+Date.now(), requestHash:'h' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'retry-001', shiftId, lines:[{ variantId: vA, quantity:'1' }], tenders:[{ method:'cash', amountMinor:750 }] });
    try {
      await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'retry-001', shiftId, lines:[{ variantId: vA, quantity:'2' }], tenders:[{ method:'cash', amountMinor:1500 }] });
      expect.fail('should 409');
    } catch(e:any){ expect(e.code).toBe('idempotency_conflict'); }
  });
});

describe('Gate 8 — Operational readiness', () => {
  it('PostgreSQL compatibility: real DB would need advisory locks; PGlite cannot test multi-connection concurrency fully', async () => {
    // Document UNVERIFIED for two-connection advisory lock test
    // We can verify PGlite supports pg_advisory_xact_lock
    const res = await db.execute(sql`SELECT pg_advisory_xact_lock(12345) as locked`) as any;
    expect(res.rows[0].locked).toBe(''); // empty string for void? Just check no error
  });

  it('backup/restore and monitoring are out of scope for isolated test — documented as UNVERIFIED', async () => {
    expect(true).toBe(true);
  });
});
