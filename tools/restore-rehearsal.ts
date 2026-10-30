/**
 * Backup/restore rehearsal driver — isolated synthetic data ONLY.
 *
 *   DATABASE_URL=postgres://…/nile_src  tsx tools/restore-rehearsal.ts seed
 *   pg_dump -Fc …/nile_src  -> backup.dump ;  pg_restore -> nile_dst
 *   DATABASE_URL=postgres://nile_rt…/nile_dst tsx tools/restore-rehearsal.ts verify
 *
 * seed:   migrates the source DB, provisions two test tenants, adds catalog
 *         items via the G-03 admin API, runs shifts/sales/refund, and writes
 *         a summary (per-tenant counts + money sums) to summary JSON.
 * verify: boots the real API against the RESTORED DB (runtime role), logs in
 *         both tenants, re-reads invoices/reports/shift state, checks tenant
 *         isolation, and compares every number with the seed summary.
 *
 * Never point this at a customer database. See
 * docs/COMMERCIAL_RELEASE_READINESS.md §backup-restore.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { openPostgres } from '../engines/db/open.js';
import { createAuth } from '../engines/platform/src/auth/auth.js';
import { createApp, type CreatedApp } from '../apps/api/src/app.js';
import { customerTenantSpec, provisionTenant } from '../apps/api/src/provision.js';

const MODE = process.argv[2] ?? '';
const SUMMARY_PATH = process.env.NILE_REHEARSAL_SUMMARY ?? '/tmp/nile-restore-summary.json';
const SECRET = 'restore-rehearsal-secret-0123456789-ab';
const BASE = 'http://localhost:3000';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const opened = await openPostgres({ url, migrationUrl: process.env.MIGRATION_DATABASE_URL ?? url });
const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
let created: CreatedApp | null = null;

type Res = { status: number; body: any };
async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const res = await created!.app.getHttpAdapter().getInstance().inject({
    method: method as 'GET', url: path,
    headers: { origin: BASE, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, body };
}
async function login(email: string, password: string): Promise<string> {
  const res = await created!.app.getHttpAdapter().getInstance().inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: BASE, 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}
const today = new Date().toISOString().slice(0, 10);
const reportOf = async (cookie: string) => (await http('GET', `/api/v1/reports/daily?from=${today}&to=${today}`, { cookie })).body.report;

if (MODE === 'seed') {
  await provisionTenant(auth, opened.db, customerTenantSpec({
    slug: 'restore-alpha', name: 'محل الاستعادة ألفا',
    managerEmail: 'alpha-mgr@restore.test', managerPassword: 'alpha-mgr-pass-123',
    cashierEmail: 'alpha-cash@restore.test', cashierPassword: 'alpha-cash-pass-123',
    catalog: [{ nameAr: 'مياه معدنية', nameEn: 'Mineral Water', category: 'drinks', priceMinor: 500, variants: [{ sku: 'WTR-500', labelAr: '500 مل', labelEn: '500 ml', stock: 50 }] }],
  }));
  await provisionTenant(auth, opened.db, customerTenantSpec({
    slug: 'restore-beta', name: 'محل بيتا',
    managerEmail: 'beta-mgr@restore.test', managerPassword: 'beta-mgr-pass-123',
    catalog: [],
  }));
  created = await createApp({ db: opened.db, auth }, { logger: false });

  const mgr = await login('alpha-mgr@restore.test', 'alpha-mgr-pass-123');
  const cash = await login('alpha-cash@restore.test', 'alpha-cash-pass-123');

  // G-03 admin: create an item through the real API.
  const createdItem = await http('POST', '/api/v1/catalog/items', {
    cookie: mgr,
    body: { nameAr: 'أرز بلدي', nameEn: 'Local Rice', category: 'groceries', priceMinor: 3500, variants: [{ sku: 'RICE-1KG', labelAr: '1 كجم', labelEn: '1 kg', stock: '30' }] },
  });
  if (createdItem.status !== 201) throw new Error(`create item failed: ${createdItem.status} ${JSON.stringify(createdItem.body)}`);
  const riceVariant = createdItem.body.item.variants[0].id;

  const shift = await http('POST', '/api/v1/shifts', { cookie: cash, body: { openingMinor: 20000, idempotencyKey: 'restore-shift-1' } });
  const shiftId = shift.body.shift.id;

  const sale1 = await http('POST', '/api/v1/checkout', {
    cookie: cash,
    body: { idempotencyKey: 'restore-sale-1', shiftId, lines: [{ variantId: riceVariant, quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 7000, tenderedMinor: 7000 }] },
  });
  const items = (await http('GET', '/api/v1/catalog/items', { cookie: cash })).body.items;
  const water = items.find((i: any) => i.variants.some((v: any) => v.sku === 'WTR-500')).variants[0];
  const sale2 = await http('POST', '/api/v1/checkout', {
    cookie: cash,
    body: { idempotencyKey: 'restore-sale-2', lines: [{ variantId: water.id, quantity: '3' }], tenders: [{ method: 'card', amountMinor: 1500 }] },
  });
  if (sale1.status !== 201 || sale2.status !== 201) throw new Error(`sales failed: ${sale1.status}/${sale2.status}`);

  const sale1View = (await http('GET', `/api/v1/sales/${sale1.body.sale.id}`, { cookie: mgr })).body.sale;
  const refund = await http('POST', '/api/v1/refunds', {
    cookie: mgr,
    body: { idempotencyKey: 'restore-refund-1', originalTransactionId: sale1.body.sale.id, paymentId: sale1View.payments[0].id, shiftId, items: [{ variantId: riceVariant, quantity: '1' }] },
  });
  if (refund.status !== 201) throw new Error(`refund failed: ${refund.status} ${JSON.stringify(refund.body)}`);

  const alphaReport = await reportOf(mgr);
  const current = (await http('GET', '/api/v1/shifts/current', { cookie: cash })).body.shift;
  const betaMgr = await login('beta-mgr@restore.test', 'beta-mgr-pass-123');
  const betaReport = await reportOf(betaMgr);

  const summary = {
    alpha: {
      saleIds: [sale1.body.sale.id, sale2.body.sale.id],
      saleTotals: [sale1.body.sale.totalMinor, sale2.body.sale.totalMinor],
      refundAmountMinor: refund.body.refund.amountMinor,
      report: alphaReport,
      shiftId,
      shiftExpectedMinor: current.expectedMinor,
      itemCount: items.length,
    },
    beta: { report: betaReport, itemCount: (await http('GET', '/api/v1/catalog/items', { cookie: betaMgr })).body.items.length },
  };
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log('SEED OK', JSON.stringify({ alphaNet: alphaReport.netCollectedMinor, betaNet: betaReport.netCollectedMinor, shiftExpected: current.expectedMinor }));
} else if (MODE === 'verify') {
  const summary = JSON.parse(await readFile(SUMMARY_PATH, 'utf8'));
  created = await createApp({ db: opened.db, auth }, { logger: false });
  const mgr = await login('alpha-mgr@restore.test', 'alpha-mgr-pass-123');
  const cash = await login('alpha-cash@restore.test', 'alpha-cash-pass-123');
  const betaMgr = await login('beta-mgr@restore.test', 'beta-mgr-pass-123');
  const fail = (msg: string) => { throw new Error(`VERIFY MISMATCH: ${msg}`); };

  const alphaReport = await reportOf(mgr);
  for (const k of ['collectedMinor', 'refundsMinor', 'netCollectedMinor', 'collectedCount', 'billedMinor']) {
    if (alphaReport[k] !== summary.alpha.report[k]) fail(`alpha report ${k}: ${alphaReport[k]} !== ${summary.alpha.report[k]}`);
  }
  const betaReport = await reportOf(betaMgr);
  if (betaReport.netCollectedMinor !== 0) fail('beta figures leaked into restored DB');
  const cashierReport = await http('GET', `/api/v1/reports/daily?from=${today}&to=${today}`, { cookie: cash });
  if (cashierReport.status !== 403) fail(`cashier report must be 403 (D-D), got ${cashierReport.status}`);

  for (let i = 0; i < summary.alpha.saleIds.length; i++) {
    const view = await http('GET', `/api/v1/sales/${summary.alpha.saleIds[i]}`, { cookie: mgr });
    if (view.status !== 200 || view.body.sale.totalMinor !== summary.alpha.saleTotals[i]) fail(`sale ${i} changed`);
    const foreign = await http('GET', `/api/v1/sales/${summary.alpha.saleIds[i]}`, { cookie: betaMgr });
    if (foreign.status !== 404) fail(`sale ${i} visible to another tenant (${foreign.status})`);
  }
  const current = (await http('GET', '/api/v1/shifts/current', { cookie: cash })).body.shift;
  if (!current || current.id !== summary.alpha.shiftId) fail('open shift not recovered');
  if (current.expectedMinor !== summary.alpha.shiftExpectedMinor) fail(`shift expected ${current.expectedMinor} !== ${summary.alpha.shiftExpectedMinor}`);

  const adminItems = (await http('GET', '/api/v1/catalog/items/admin', { cookie: mgr })).body.items;
  if (adminItems.length !== summary.alpha.itemCount) fail('catalog item count changed');
  const rice = adminItems.find((i: any) => i.variants.some((v: any) => v.sku === 'RICE-1KG'));
  if (!rice || rice.priceMinor !== 3500) fail('G-03 created item lost');

  // Idempotent replay on the restored DB must NOT duplicate the invoice.
  const replay = await http('POST', '/api/v1/checkout/reconcile', { cookie: cash, body: {} }).catch(() => null);
  const rec = await http('GET', '/api/v1/checkout/reconcile?key=restore-sale-1', { cookie: cash });
  if (rec.body.state !== 'saved' || rec.body.sale.id !== summary.alpha.saleIds[0]) fail('idempotency identity lost after restore');

  console.log('VERIFY OK — restored DB matches seed summary (reports, invoices, shift, catalog, isolation, idempotency)');
} else {
  throw new Error('usage: restore-rehearsal.ts seed|verify');
}

await created?.app.close().catch(() => {});
await opened.close();
process.exit(0);
