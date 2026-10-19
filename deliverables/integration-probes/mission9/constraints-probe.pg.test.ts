// TEMP PROBE (never committed): which invalid rows does the DATABASE refuse, per model?
import { describe, it, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgHarness, ADMIN_URL, type PgHarness } from './zz-pg-harness.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
const MODEL = process.env.PROBE_MODEL as 'dst' | 'pay';
let h: PgHarness;
async function attempt(T: string, label: string, stmt: string) {
  try { await withTenant(h.opened.db as any, T, async (tx: any) => { await tx.execute(sql.raw(stmt)); }); console.log(`ROW|${MODEL}|${label}|ACCEPTED`); }
  catch (e: any) { let c = e; while (c && !c.code) c = c.cause; console.log(`ROW|${MODEL}|${label}|REJECTED ${c?.code ?? '?'} ${c?.constraint ?? ''}`); }
}
describe.skipIf(!ADMIN_URL)('constraint probe', () => {
  afterAll(async () => { await h?.dispose(); });
  it('runs', async () => {
    h = await createPgHarness('cprobe');
    const db = h.opened.db as any;
    const T = (await db.execute(sql`INSERT INTO organization (name, slug) VALUES ('P', ${'p-' + Date.now()}) RETURNING id`)).rows[0].id as string;
    const ids = await withTenant(db, T, async (tx: any) => {
      const s = (await tx.execute(sql.raw(`INSERT INTO sales_transactions (tenant_id, kind, total_minor, idempotency_key, request_hash, created_by) VALUES ('${T}','sale',1000,'k1','h','${T}') RETURNING id`))).rows[0].id;
      const sh = MODEL === 'dst'
        ? (await tx.execute(sql.raw(`INSERT INTO cash_shifts (tenant_id, opened_by, opening_minor, idempotency_key, request_hash) VALUES ('${T}','${T}',0,'s1','h') RETURNING id`))).rows[0].id
        : (await tx.execute(sql.raw(`INSERT INTO cash_shifts (tenant_id, opened_by, idempotency_key, request_hash) VALUES ('${T}','${T}','s1','h') RETURNING id`))).rows[0].id;
      const p = MODEL === 'dst'
        ? (await tx.execute(sql.raw(`INSERT INTO payments (tenant_id, transaction_id, method, amount_minor, idempotency_key, request_hash, created_by) VALUES ('${T}','${s}','cash',1000,'p1','h','${T}') RETURNING id`))).rows[0].id
        : (await tx.execute(sql.raw(`INSERT INTO payments (tenant_id, sale_id, shift_id, total_minor, idempotency_key, request_hash, created_by) VALUES ('${T}','${s}','${sh}',1000,'p1','h','${T}') RETURNING id`))).rows[0].id;
      return { s, sh, p };
    });
    const { s, sh, p } = ids; let n = 0; const k = () => `x${n++}`;
    if (MODEL === 'dst') {
      const pay = (cols: string, vals: string) => `INSERT INTO payments (tenant_id, transaction_id, idempotency_key, request_hash, created_by, ${cols}) VALUES ('${T}','${s}','${k()}','h','${T}', ${vals})`;
      await attempt(T, 'payment amount = 0', pay('method, amount_minor', `'cash', 0`));
      await attempt(T, 'payment amount < 0', pay('method, amount_minor', `'cash', -5`));
      await attempt(T, 'payment unknown method', pay('method, amount_minor', `'bitcoin', 100`));
      await attempt(T, 'payment change < 0', pay('method, amount_minor, tendered_minor, change_minor', `'cash', 100, 100, -1`));
      await attempt(T, 'change > tendered / tendered < amount', pay('method, amount_minor, tendered_minor, change_minor', `'cash', 100, 50, 0`));
      await attempt(T, 'change on non-cash', pay('method, amount_minor, change_minor', `'card', 100, 20`));
      await attempt(T, 'refund amount = 0', `INSERT INTO refunds (tenant_id, payment_id, transaction_id, amount_minor, approved_by, idempotency_key, request_hash) VALUES ('${T}','${p}','${s}',0,'${T}','${k()}','h')`);
      await attempt(T, 'refund unknown method', `SELECT 'n/a: DST refunds have no method column (derived from payment)'`);
      await attempt(T, 'shift opening < 0', `INSERT INTO cash_shifts (tenant_id, opened_by, opening_minor, idempotency_key, request_hash) VALUES ('${T}','${T}',-1,'${k()}','h')`);
      await attempt(T, 'closure counted < 0', `INSERT INTO cash_shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, closed_by) VALUES ('${T}','${sh}',-1,0,-1,'${T}')`);
      await attempt(T, 'closure difference inconsistent', `INSERT INTO cash_shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, closed_by) VALUES ('${T}','${sh}',100,50,7,'${T}')`);
      await attempt(T, 'second closure same shift', `INSERT INTO cash_shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, closed_by) VALUES ('${T}','${sh}',0,0,0,'${T}'); INSERT INTO cash_shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, closed_by) VALUES ('${T}','${sh}',0,0,0,'${T}')`);
      await attempt(T, 'UPDATE payments (append-only)', `UPDATE payments SET amount_minor = 1 WHERE id = '${p}'`);
    } else {
      const ten = (vals: string) => `INSERT INTO payment_tenders (tenant_id, payment_id, method, amount_minor, change_minor) VALUES ('${T}','${p}', ${vals})`;
      await attempt(T, 'payment amount = 0', ten(`'cash', 0, 0`));
      await attempt(T, 'payment amount < 0', ten(`'cash', -5, 0`));
      await attempt(T, 'payment unknown method', ten(`'bitcoin', 100, 0`));
      await attempt(T, 'payment change < 0', ten(`'cash', 100, -1`));
      await attempt(T, 'change > tendered / tendered < amount', ten(`'cash', 100, 150`));
      await attempt(T, 'change on non-cash', ten(`'card', 100, 20`));
      await attempt(T, 'refund amount = 0', `INSERT INTO refunds (tenant_id, payment_id, amount_minor, method, refunded_by, idempotency_key, request_hash) VALUES ('${T}','${p}',0,'cash','${T}','${k()}','h')`);
      await attempt(T, 'refund unknown method', `INSERT INTO refunds (tenant_id, payment_id, amount_minor, method, refunded_by, idempotency_key, request_hash) VALUES ('${T}','${p}',10,'bitcoin','${T}','${k()}','h')`);
      await attempt(T, 'shift opening < 0', `INSERT INTO cash_shifts (tenant_id, opened_by, opening_float_minor, idempotency_key, request_hash) VALUES ('${T}','${T}',-1,'${k()}','h')`);
      await attempt(T, 'closure counted < 0', `INSERT INTO shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, counted_by, idempotency_key, request_hash) VALUES ('${T}','${sh}',-1,0,-1,'${T}','${k()}','h')`);
      await attempt(T, 'closure difference inconsistent', `INSERT INTO shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, counted_by, idempotency_key, request_hash) VALUES ('${T}','${sh}',100,50,7,'${T}','${k()}','h')`);
      await attempt(T, 'second closure same shift', `INSERT INTO shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, counted_by, idempotency_key, request_hash) VALUES ('${T}','${sh}',0,0,0,'${T}','${k()}','h'); INSERT INTO shift_closures (tenant_id, shift_id, counted_minor, expected_minor, difference_minor, counted_by, idempotency_key, request_hash) VALUES ('${T}','${sh}',0,0,0,'${T}','${k()}','h')`);
      await attempt(T, 'UPDATE payments (append-only)', `UPDATE payments SET total_minor = 1 WHERE id = '${p}'`);
    }
  }, 60000);
});
