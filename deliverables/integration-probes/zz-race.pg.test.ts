// TEMPORARY PROBE — /tmp/wt-dst only, never committed. Real PostgreSQL, disposable DB.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createPgHarness, ADMIN_URL, type PgHarness } from './zz-pg-harness.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { openShift, closeShift } from '../src/shifts.js';

const key = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0; return h; };
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p.then(() => 'completed'), new Promise<string>((r) => setTimeout(() => r('blocked'), ms))]);

let h: PgHarness; let T: string; let V: string; let n = 0;
describe.skipIf(!ADMIN_URL)('RACE — shift close vs cash sale (real PG)', () => {
  beforeAll(async () => {
    h = await createPgHarness('race');
    const db = h.opened.db as any;
    const own = new pg.Client({ connectionString: h.loginUrl }); // login role; org insert needs no tenant
    T = (await db.insert(organization).values({ name: 'Race', slug: 'race-' + Date.now() }).returning({ id: organization.id }))[0].id;
    V = await withTenant(db, T, async (tx: any) => {
      const [i] = await tx.insert(catalogItems).values({ tenantId: T, nameAr: 'م', nameEn: 'W', category: 'd', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
      const [v] = await tx.insert(catalogVariants).values({ tenantId: T, itemId: i.id, sku: 'R-' + Date.now(), labelAr: 'افتراضي', labelEn: 'Default', stock: '100000.000' }).returning({ id: catalogVariants.id });
      return v.id as string;
    });
  }, 60000);
  afterAll(async () => { await h?.dispose(); });

  const newShift = async () => (await openShift(h.opened.db as any, { tenantId: T, userId: T }, { registerCode: 'r' + (n++), openingMinor: 0, idempotencyKey: 'race-open-' + n + '-' + Date.now() })).shift!.id as string;
  const sale = (shiftId: string) => checkout(h.opened.db as any, { tenantId: T, userId: T }, { idempotencyKey: 'race-chk-' + (n++) + '-' + Date.now(), shiftId, lines: [{ variantId: V, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] });

  async function holding(lockKey: string, fn: () => Promise<unknown>) {
    const c = new pg.Client({ connectionString: h.loginUrl }); await c.connect();
    await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock($1)', [key(lockKey)]);
    const p = fn(); const r = await within(p, 2500);
    await c.query('COMMIT'); await c.end(); await p.catch(() => {});
    return r;
  }

  it('R1 closeShift is NOT blocked by the lock checkout holds', async () => {
    const s = await newShift();
    const r = await holding(`shift:${T}:${s}`, () => closeShift(h.opened.db as any, { tenantId: T, userId: T }, { shiftId: s, countedMinor: 0 }));
    console.log('R1 closeShift while checkout-key held →', r);
    expect(r).toBe('completed'); // documents the defect: different keys
  }, 20000);
  it('R2 control: checkout IS blocked by its own key', async () => {
    const s = await newShift();
    const r = await holding(`shift:${T}:${s}`, () => sale(s));
    console.log('R2 checkout while checkout-key held →', r);
    expect(r).toBe('blocked');
  }, 20000);
  it('R3 stochastic: concurrent sale + close — sale committed into a closed shift, missing from expected', async () => {
    let lost = 0, both = 0;
    for (let i = 0; i < 60; i++) {
      const s = await newShift();
      const [a, b] = await Promise.allSettled([sale(s), closeShift(h.opened.db as any, { tenantId: T, userId: T }, { shiftId: s, countedMinor: 0 })]);
      if (a.status === 'fulfilled' && b.status === 'fulfilled') { both++; if ((b.value as any).closure.expectedMinor === 0) lost++; }
    }
    console.log(`R3 iterations=60 both-succeeded=${both} sale-missing-from-closure=${lost}`);
    expect(true).toBe(true); // observation only
  }, 120000);
});
