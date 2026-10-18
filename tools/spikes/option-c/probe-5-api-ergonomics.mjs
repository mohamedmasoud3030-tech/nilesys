/**
 * M8 — external API ergonomics for a TypeScript caller.
 *
 * Drives a running Odoo over its public HTTP APIs using only fetch — no Odoo
 * libraries, no generated client — the way our own `LedgerProvider` port would.
 * Measures what the integration layer must do, not whether a demo looks nice.
 *
 * Usage: node probe-5-api-ergonomics.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8069';
const DB = 'spike19';
const USER = 'admin';
const PASS = 'admin';

const notes = [];
const t0 = Date.now();
let rpcId = 0;

async function jsonrpc(service, method, args) {
  const started = Date.now();
  const res = await fetch(`${BASE}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
  });
  const body = await res.json();
  return { body, ms: Date.now() - started, http: res.status };
}

function report(label, value) {
  console.log(`\n### ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`);
}

// ── 1. authentication ──────────────────────────────────────────────────────
const ver = await jsonrpc('common', 'version', []);
report('1. common.version (no auth)', { http: ver.http, ms: ver.ms, result: ver.body.result });

const login = await jsonrpc('common', 'login', [DB, USER, PASS]);
const uid = login.body.result;
report('2. common.login (db + user + password)', { ms: login.ms, uid });

if (!uid) {
  report('FATAL', 'authentication failed — cannot continue');
  process.exit(1);
}

// ── 2. create a record ─────────────────────────────────────────────────────
const created = await jsonrpc('object', 'execute_kw', [
  DB, uid, PASS, 'res.partner', 'create',
  [{ name: 'API Probe Customer', company_type: 'company', vat: '100555666777' }],
]);
const partnerId = created.body.result;
report('3. create a partner (execute_kw res.partner.create)', { ms: created.ms, partnerId });

// ── 3. read it back with typed fields ──────────────────────────────────────
const read = await jsonrpc('object', 'execute_kw', [
  DB, uid, PASS, 'res.partner', 'read', [[partnerId], ['name', 'vat', 'create_date']],
]);
report('4. read it back (field list is caller-specified)', read.body.result);

// ── 4. invoices require the company/journal context to be inferred ─────────
const inv = await jsonrpc('object', 'execute_kw', [
  DB, uid, PASS, 'account.move', 'create',
  [{
    move_type: 'out_invoice',
    partner_id: partnerId,
    invoice_date: '2026-10-05',
    ref: 'API-PROBE-1',
    invoice_line_ids: [[0, 0, { name: 'API probe line', quantity: 1, price_unit: 1234.5 }]],
  }],
]);
const invId = inv.body.result;
if (inv.body.error) report('5. create invoice — ERROR', inv.body.error.data?.message ?? inv.body.error);

const invRead = invId
  ? await jsonrpc('object', 'execute_kw', [
      DB, uid, PASS, 'account.move', 'read', [[invId], ['name', 'state', 'amount_total', 'amount_residual', 'currency_id']],
    ])
  : null;
report('5. create + read an invoice without any ETA configuration', invRead?.body.result ?? 'n/a');

// ── 5. is there any idempotency primitive on the API surface? ──────────────
const dup = invId
  ? await jsonrpc('object', 'execute_kw', [
      DB, uid, PASS, 'account.move', 'create',
      [{
        move_type: 'out_invoice',
        partner_id: partnerId,
        invoice_date: '2026-10-05',
        ref: 'API-PROBE-1', // identical external reference
        invoice_line_ids: [[0, 0, { name: 'API probe line', quantity: 1, price_unit: 1234.5 }]],
      }],
    ])
  : null;
report('6. same external ref submitted again (duplicate risk)', {
  createdSecondDocument: Boolean(dup?.body?.result) && dup.body.result !== invId,
  secondId: dup?.body?.result,
  note: 'no idempotency key parameter exists on create — the caller must own deduplication',
});

// ── 6. reporting read for our own dashboards ──────────────────────────────
const rows = await jsonrpc('object', 'execute_kw', [
  DB, uid, PASS, 'account.move.line', 'search_read',
  [[['parent_state', '=', 'posted']], ['account_id', 'debit', 'credit', 'balance']],
  { limit: 5 },
]);
report('7. read posted ledger lines (search_read)', { ms: rows.ms, sample: rows.body.result });

// ── 7. error ergonomics: what does a rejection look like? ─────────────────
const denied = await jsonrpc('object', 'execute_kw', [
  DB, uid, PASS, 'account.move', 'unlink', [[invId ?? 1]],
]);
report('8. error shape on a rejected operation', {
  hasError: Boolean(denied.body.error),
  name: denied.body.error?.data?.name,
  message: (denied.body.error?.data?.message ?? '').slice(0, 160),
  note: 'faults arrive as JSON-RPC error objects; our port maps them to domain errors',
});

report('SUMMARY', {
  totalMs: Date.now() - t0,
  notes,
  verdict:
    'The API is drivable from plain fetch with db/user/password + model/method/args. ' +
    'No schema, no types, no idempotency, no generated contract: the LedgerProvider port must own ' +
    'validation, idempotency, mapping, and error translation. ' +
    'Every call is untyped JSON, so a TypeScript caller needs hand-written types or a codegen step.',
});
