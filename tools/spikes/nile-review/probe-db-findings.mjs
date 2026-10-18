/**
 * Nile DB-layer review probe — executable evidence for findings that are
 * otherwise assertions. Throwaway review tooling, not application code.
 *
 * Runs against PGlite (WASM PostgreSQL) exactly like engines/db/test/rls.test.ts,
 * applying the real migration engines/db/migrations/0001_nile_engines.sql, then
 * exercises the runtime role (non-owner, non-superuser) the way production would.
 *
 * Usage: node probe-db-findings.mjs <path-to-engines-repo-root>
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ROOT = process.argv[2] ?? '/tmp/nile';
const MIGRATION = `${ROOT}/engines/db/migrations/0001_nile_engines.sql`;

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const findings = [];

async function check(id, title, fn) {
  try {
    const evidence = await fn();
    findings.push({ id, title, outcome: 'OBSERVED', evidence });
    console.log(`\n[${id}] ${title}\n     -> ${evidence}`);
  } catch (err) {
    findings.push({ id, title, outcome: 'BLOCKED', evidence: `${err.name}: ${err.message}` });
    console.log(`\n[${id}] ${title}\n     -> BLOCKED: ${err.name}: ${String(err.message).slice(0, 160)}`);
  }
}

const db = new PGlite();
await db.exec(readFileSync(MIGRATION, 'utf8'));

// Mirror production: runtime role is NOT owner, NOT superuser, no BYPASSRLS.
await db.exec(`CREATE ROLE nile_app NOLOGIN;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nile_app;`);

async function asTenant(tenantId, fn) {
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  try {
    return await fn();
  } finally {
    await db.query(`SELECT set_config('app.tenant_id', '', false)`);
  }
}

// ── seed two tenants, one transaction each ──────────────────────────────────
let txnB;
await asTenant(ORG_A, async () => {
  await db.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'A','a')`, [ORG_A]);
  await db.query(
    `INSERT INTO sales_transactions (tenant_id,kind,total_minor,idempotency_key,created_by)
     VALUES ($1,'sale',100,'key-a','u1')`,
    [ORG_A],
  );
});
await asTenant(ORG_B, async () => {
  await db.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'B','b')`, [ORG_B]);
  const r = await db.query(
    `INSERT INTO sales_transactions (tenant_id,kind,total_minor,idempotency_key,created_by)
     VALUES ($1,'sale',999,'key-b','u2') RETURNING id`,
    [ORG_B],
  );
  txnB = r.rows[0].id;
});

await db.query('SET ROLE nile_app');

// ── N1: cross-tenant referential integrity ─────────────────────────────────
await check(
  'N1',
  'Cross-tenant FK gap: can tenant A write a line pointing at tenant B\'s transaction?',
  async () => {
    const res = await asTenant(ORG_A, () =>
      db.query(
        `INSERT INTO transaction_lines (tenant_id,transaction_id,item_id,quantity,unit_price_minor,line_total_minor)
         VALUES ($1,$2,'44444444-4444-4444-4444-444444444444','1.000',100,100) RETURNING id`,
        [ORG_A, txnB],
      ),
    );
    return `ACCEPTED — a row owned by tenant A now references B's transaction (${txnB}). ` +
      `RLS WITH CHECK validates the row's own tenant_id only; the single-column FK does not.`;
  },
);

// ── N2: money column range ─────────────────────────────────────────────────
await check('N2', 'Money columns are 32-bit integer: what is the maximum representable amount?', async () => {
  const ok = await asTenant(ORG_A, () =>
    db.query(`INSERT INTO sales_transactions (tenant_id,kind,total_minor,idempotency_key,created_by)
              VALUES ($1,'sale',2147483647,'key-max','u1') RETURNING total_minor`, [ORG_A]),
  );
  let overflow;
  try {
    await asTenant(ORG_A, () =>
      db.query(`INSERT INTO sales_transactions (tenant_id,kind,total_minor,idempotency_key,created_by)
                VALUES ($1,'sale',2147483648,'key-over','u1')`, [ORG_A]),
    );
    overflow = 'accepted (unexpected)';
  } catch (e) {
    overflow = `${e.message}`;
  }
  return `max accepted = ${ok.rows[0].total_minor} minor units = 21,474,836.47 EGP; +1 minor unit => ${overflow}`;
});

// ── N3: audit trail immutability ───────────────────────────────────────────
await check('N3', 'Audit trail: can the runtime application role alter or erase audit rows?', async () => {
  const ins = await asTenant(ORG_A, () =>
    db.query(`INSERT INTO audit_log (tenant_id,user_id,action,entity,entity_id,payload)
              VALUES ($1,'u1','sale.created','sales_transaction','x','{"total":100}') RETURNING id`, [ORG_A]),
  );
  const id = ins.rows[0].id;
  const upd = await asTenant(ORG_A, () =>
    db.query(`UPDATE audit_log SET action='nothing.to.see.here', payload='{}' WHERE id=$1 RETURNING action`, [id]),
  );
  const del = await asTenant(ORG_A, () => db.query(`DELETE FROM audit_log WHERE id=$1`, [id]));
  return `UPDATE succeeded (action now '${upd.rows[0].action}'), DELETE affected ${del.affectedRows ?? '?'} row(s) — ` +
    `audit history is mutable from the application connection`;
});

// ── N4: enumerations unenforced at the database level ──────────────────────
await check('N4', 'Enum-like columns: does the database reject values outside the documented domain?', async () => {
  // NOTE: every read must sit inside the tenant context — with it unset, fail-closed
  // RLS returns zero rows (which is itself the ADR-0005 invariant behaving correctly).
  const resourceId = (
    await asTenant(ORG_A, () =>
      db.query(`INSERT INTO bookable_resources (tenant_id,kind,name_ar,name_en)
                VALUES ($1,'court','ملعب','Court') RETURNING id`, [ORG_A]),
    )
  ).rows[0].id;
  await asTenant(ORG_A, () =>
    db.query(`INSERT INTO bookings (tenant_id,resource_id,customer_name,customer_phone,starts_at,ends_at,status,code)
              VALUES ($1,$2,'X','0100',now(),now()+interval '1 hour','BANANA','BK-N4')`, [ORG_A, resourceId]),
  );
  const sm = await asTenant(ORG_A, () =>
    db.query(`INSERT INTO stock_movements (tenant_id,item_id,direction,quantity)
              VALUES ($1,'44444444-4444-4444-4444-444444444444','sideways','1.000') RETURNING direction`, [ORG_A]),
  );
  return `ACCEPTED bookings.status='BANANA' and stock_movements.direction='${sm.rows[0].direction}' — ` +
    `no CHECK constraints exist; contracts.ts Zod unions are not mirrored in the database`;
});

// ── N5: is_active stored as text ───────────────────────────────────────────
await check('N5', 'is_active / is_demo stored as text: what does the application see for a deactivated row?', async () => {
  const r = await asTenant(ORG_A, async () => {
    await db.query(`UPDATE bookable_resources SET is_active='false' WHERE tenant_id=$1`, [ORG_A]);
    return db.query(`SELECT is_active, pg_typeof(is_active)::text AS sql_type FROM bookable_resources LIMIT 1`);
  });
  const value = r.rows[0].is_active;
  return `stored value = ${JSON.stringify(value)} as SQL type ${r.rows[0].sql_type}; ` +
    `JavaScript truthiness of that value is ${Boolean(value)} (a naive \`if (row.isActive)\` treats a deactivated row as active)`;
});

// ── N6: no database-level overlap protection for bookings ──────────────────
await check('N6', 'Double-booking: is anything at the database level preventing overlapping bookings?', async () => {
  const r = await asTenant(ORG_A, () => db.query(`SELECT id FROM bookable_resources LIMIT 1`));
  const insert = (code) =>
    asTenant(ORG_A, () =>
      db.query(
        `INSERT INTO bookings (tenant_id,resource_id,customer_name,customer_phone,starts_at,ends_at,status,code)
         VALUES ($1,$2,'Y','0100','2026-10-20 10:00+02','2026-10-20 11:00+02','CONFIRMED',$3)`,
        [ORG_A, r.rows[0].id, code],
      ),
    );
  await insert('BK-OVER-1');
  await insert('BK-OVER-2');
  const n = await asTenant(ORG_A, () =>
    db.query(`SELECT count(*)::int AS n FROM bookings WHERE code LIKE 'BK-OVER-%'`),
  );
  return `${n.rows[0].n} identical overlapping bookings accepted — no EXCLUDE constraint; ` +
    `the engine's availability check is application-level and not concurrency-safe`;
});

// ── N7: what the RLS suite actually proves vs what production uses ─────────
await check('N7', 'Tenant context scope: session-level (as the test sets it) vs transaction-local (as production sets it)', async () => {
  // (a) session-scoped, the mechanism used by engines/db/test/rls.test.ts
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [ORG_A]);
  await db.query('SELECT 1'); // an unrelated later statement, as a pooled reuse would be
  const leaked = await db.query(`SELECT count(*)::int AS n FROM sales_transactions`);
  await db.query(`SELECT set_config('app.tenant_id', '', false)`);

  // (b) transaction-local, the mechanism used by withTenant()
  await db.exec('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [ORG_A]);
  const inside = await db.query(`SELECT count(*)::int AS n FROM sales_transactions`);
  await db.exec('COMMIT');
  const after = await db.query(`SELECT count(*)::int AS n FROM sales_transactions`);
  return `session-scoped context persisted into a later statement (rows visible: ${leaked.rows[0].n} — this is what the RLS test relies on); ` +
    `transaction-local context saw ${inside.rows[0].n} inside the transaction and ${after.rows[0].n} after COMMIT. ` +
    `withTenant() is therefore correct, but no test exercises it — the suite proves isolation, not transaction-locality`;
});

console.log('\n' + '='.repeat(78));
console.log('SUMMARY');
console.log('='.repeat(78));
for (const f of findings) console.log(`[${f.id}] ${f.outcome.padEnd(8)} ${f.title}`);
