const API = 'http://127.0.0.1:3300'; const jar = {};
async function call(who, method, path, body) {
  const res = await fetch(API + path, { method, headers: { origin: API, ...(body ? { 'content-type': 'application/json' } : {}), ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.getSetCookie(); if (set.length) jar[who] = set.map((c) => c.split(';')[0]).join('; ');
  const t = await res.text(); return { status: res.status, body: t ? JSON.parse(t) : null };
}
const out = (k, v) => console.log(`${k}: ${JSON.stringify(v)}`);
await call('c', 'POST', '/api/auth/sign-in/email', { email: 'cashier@nile.demo', password: 'demo1234' });
await call('m', 'POST', '/api/auth/sign-in/email', { email: 'pos-manager@nile.demo', password: 'demo1234' });
const cat = await call('c', 'GET', '/api/v1/catalog/items');
const wtr = cat.body.items.flatMap((i) => i.variants).find((v) => v.sku === 'WTR-600').id;
const tag = Date.now();
const s = await call('c', 'POST', '/api/v1/shifts', { registerCode: 'verify-' + tag, openingMinor: 10000, idempotencyKey: 'verify-shift-' + tag });
out('open shift', [s.status, s.body?.shift?.openingMinor]);
const body = { idempotencyKey: 'verify-split-' + tag, shiftId: s.body.shift.id, lines: [{ variantId: wtr, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 375 }, { method: 'cash', amountMinor: 375 }] };
const c1 = await call('c', 'POST', '/api/v1/checkout', body); out('split cash 375+375', [c1.status, c1.body?.sale?.totalMinor ?? c1.body]);
const c2 = await call('c', 'POST', '/api/v1/checkout', body); out('replay', [c2.status, c2.body?.replayed]);
const cl = await call('m', 'POST', `/api/v1/shifts/${s.body.shift.id}/close`, { countedMinor: 10750 }); out('close', [cl.status, cl.body?.closure?.expectedMinor, cl.body?.closure?.differenceMinor]);
const late = await call('c', 'POST', '/api/v1/checkout', { ...body, idempotencyKey: 'verify-late-' + tag }); out('cash sale after close', [late.status, late.body?.error]);
const ok = s.status === 201 && c1.status === 201 && c2.status === 200 && c2.body.replayed === true && cl.status === 201 && cl.body.closure.expectedMinor === 10750 && cl.body.closure.differenceMinor === 0 && late.status === 409;
console.log(ok ? 'POS HTTP FLOW: PASS' : 'POS HTTP FLOW: FAIL'); process.exit(ok ? 0 : 1);
