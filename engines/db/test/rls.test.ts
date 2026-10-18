/**
 * ADR-0005 §9 fail-closed invariants, proven on real PostgreSQL (PGlite)
 * through the SAME migration + connection path production uses (open.ts):
 * generated migrations applied as owner, queries executed as `nile_app`.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeRole, openPglite, UnsafeRuntimeRoleError, type NileDb, type OpenedDatabase } from '../open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant, TenantScopeError } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { salesTransactions, transactionLines } from '../../transactions/src/db/schema.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let saleB: string;
let variantA: string;
let variantB: string;

const count = async (tx: any, table: any) => Number((await tx.select({ n: sql<number>`count(*)` }).from(table))[0].n);
/** Assert a rejection carries a specific PostgreSQL SQLSTATE (not just "some error"). */
async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  let c: any = err;
  while (c && !c.code) c = c.cause;
  expect(c?.code, String(err)).toBe(code);
}
const currentTenant = async (d: any) =>
  ((await d.execute(sql`SELECT current_setting('app.tenant_id', true) AS v`)) as any).rows[0].v as string | null;

async function seedSale(tenantId: string, key: string) {
  return withTenant(db, tenantId, async (tx: any) => {
    const [item] = await tx.insert(catalogItems).values({ tenantId, nameAr: 'صنف', nameEn: 'Item', category: 'x', priceMinor: 100 }).returning();
    const [v] = await tx.insert(catalogVariants).values({ tenantId, itemId: item.id, sku: `SKU-${key}`, labelAr: 'ا', labelEn: 'a', stock: '5' }).returning();
    const [s] = await tx
      .insert(salesTransactions)
      .values({ tenantId, kind: 'sale', totalMinor: 100, idempotencyKey: key, requestHash: 'h', createdBy: tenantId })
      .returning();
    return { saleId: s.id as string, variantId: v.id as string };
  });
}

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'a' }).returning({ id: organization.id })) as [{ id: string }];
  [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'b' }).returning({ id: organization.id })) as [{ id: string }];
  ({ variantId: variantA } = await seedSale(A, 'key-a'));
  ({ saleId: saleB, variantId: variantB } = await seedSale(B, 'key-b'));
});
afterAll(() => opened.close());

describe('runtime role (ADR-0005 §7)', () => {
  it('app runs as nile_app, which cannot bypass RLS', async () => {
    expect(await assertRuntimeRole(db)).toBe('nile_app');
  });

  it('refuses to start on a superuser connection', async () => {
    const raw = new PGlite();
    await expect(assertRuntimeRole(drizzle(raw) as unknown as NileDb)).rejects.toBeInstanceOf(UnsafeRuntimeRoleError);
    await raw.close();
  });

  it('every table with tenant_id has RLS ENABLED + FORCED + a policy (guard for future tables)', async () => {
    const res = (await db.execute(sql`
      SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)`)) as any;
    expect(res.rows.length).toBeGreaterThanOrEqual(14);
    for (const r of res.rows) expect({ t: r.t, rls: r.rls, force: r.force, ok: r.policies > 0 }).toEqual({ t: r.t, rls: true, force: true, ok: true });
  });
});

describe('fail-closed invariants (ADR-0005 §9)', () => {
  it('1. no tenant context → zero rows', async () => {
    expect(await count(db, salesTransactions)).toBe(0);
    expect(await count(db, catalogItems)).toBe(0);
  });

  it('2. tenant A cannot read tenant B rows', async () => {
    await withTenant(db, A, async (tx: any) => {
      expect(await count(tx, salesTransactions)).toBe(1);
      expect(await tx.select().from(salesTransactions).where(eq(salesTransactions.id, saleB))).toEqual([]);
    });
  });

  it('3a. tenant A cannot insert rows as tenant B (RLS WITH CHECK → 42501)', async () => {
    await rejectsWith(
      withTenant(db, A, (tx: any) =>
        tx.insert(salesTransactions).values({ tenantId: B, kind: 'sale', totalMinor: 1, idempotencyKey: 'evil', requestHash: 'h', createdBy: A }),
      ),
      '42501',
    );
  });

  it('3b. tenant A cannot update or delete tenant B rows', async () => {
    // Probed on a table the runtime may legitimately UPDATE/DELETE, so that a
    // privilege error cannot mask the RLS USING filter (ledger tables are
    // append-only since 0002 — see 'append-only ledger' below).
    await withTenant(db, A, async (tx: any) => {
      const upd = await tx.update(catalogVariants).set({ stock: '0' }).where(eq(catalogVariants.id, variantB)).returning();
      const del = await tx.delete(catalogVariants).where(eq(catalogVariants.id, variantB)).returning();
      expect(upd).toEqual([]);
      expect(del).toEqual([]);
    });
    await withTenant(db, B, async (tx: any) => {
      expect((await tx.select().from(catalogVariants).where(eq(catalogVariants.id, variantB)))[0].stock).toBe('5.000');
    });
  });

  it('3c. composite FK: tenant A cannot attach a line to tenant B sale (FK checks bypass RLS → 23503)', async () => {
    await rejectsWith(
      withTenant(db, A, (tx: any) =>
        tx.insert(transactionLines).values({
          tenantId: A, transactionId: saleB, variantId: variantA, nameAr: 'x', nameEn: 'x', quantity: '1', unitPriceMinor: 1, lineTotalMinor: 1,
        }),
      ),
      '23503',
    );
  });

  it('4. tenant context is transaction-local (gone after commit and after rollback)', async () => {
    await withTenant(db, A, async () => undefined);
    expect(await currentTenant(db)).toBeFalsy();
    await expect(withTenant(db, A, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await currentTenant(db)).toBeFalsy();
    expect(await count(db, salesTransactions)).toBe(0);
  });

  it('5. a reused (pooled) connection never carries context between transactions', async () => {
    const seen: number[] = [];
    for (const t of [A, B, A, B]) seen.push(await withTenant(db, t, (tx: any) => count(tx, catalogItems)));
    expect(seen).toEqual([1, 1, 1, 1]);
    expect(await count(db, catalogItems)).toBe(0);
  });
});

describe('append-only ledger and audit (0002)', () => {
  const APPEND_ONLY = ['audit_log', 'sales_transactions', 'transaction_lines', 'stock_movements', 'cash_movements'];

  it('nile_app holds SELECT + INSERT but neither UPDATE nor DELETE on ledger/audit tables', async () => {
    for (const t of APPEND_ONLY) {
      const res = (await db.execute(sql`
        SELECT has_table_privilege(current_user, ${t}, 'SELECT') AS s, has_table_privilege(current_user, ${t}, 'INSERT') AS i,
               has_table_privilege(current_user, ${t}, 'UPDATE') AS u, has_table_privilege(current_user, ${t}, 'DELETE') AS d`)) as any;
      expect({ t, ...res.rows[0] }).toEqual({ t, s: true, i: true, u: false, d: false });
    }
  });

  it('rewriting or erasing history inside the own tenant is refused (42501)', async () => {
    for (const t of APPEND_ONLY) {
      await rejectsWith(withTenant(db, A, (tx: any) => tx.execute(sql.raw(`UPDATE ${t} SET tenant_id = tenant_id`))), '42501');
      await rejectsWith(withTenant(db, A, (tx: any) => tx.execute(sql.raw(`DELETE FROM ${t}`))), '42501');
    }
    await withTenant(db, A, async (tx: any) => expect(await count(tx, salesTransactions)).toBe(1));
  });
});

describe('data-model hardening', () => {
  it('money is 64-bit: a 30,000,000.00 EGP total is stored exactly', async () => {
    const total = 3_000_000_000; // minor units
    const row = await withTenant(db, A, async (tx: any) =>
      (await tx.insert(salesTransactions).values({ tenantId: A, kind: 'sale', totalMinor: total, idempotencyKey: 'big', requestHash: 'h', createdBy: A }).returning())[0],
    );
    expect(row.totalMinor).toBe(total);
  });

  it('idempotency keys are unique per tenant, not globally', async () => {
    await withTenant(db, B, (tx: any) =>
      tx.insert(salesTransactions).values({ tenantId: B, kind: 'sale', totalMinor: 1, idempotencyKey: 'key-a', requestHash: 'h', createdBy: B }),
    );
    await rejectsWith(
      withTenant(db, A, (tx: any) =>
        tx.insert(salesTransactions).values({ tenantId: A, kind: 'sale', totalMinor: 1, idempotencyKey: 'key-a', requestHash: 'h', createdBy: A }),
      ),
      '23505',
    );
  });

  it('withTenant rejects missing or malformed tenant ids before touching the DB', async () => {
    await expect(withTenant(db, '', async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
    await expect(withTenant(db, "x' OR 1=1 --", async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
  });
});
