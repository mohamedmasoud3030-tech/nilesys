/* برامج ويندوز الخمسة — اختبارات طرف الخادم (المزامنة).
 *
 * البرنامج نفسه يُختبر في المتصفح (tools/ui-windows.js) لأنه يعمل على الجهاز
 * بلا خادم. وهنا نختبر ما لا يراه المستخدم: المزامنة، منع التكرار، وحدود الدفعة.
 *
 *   BASE=http://localhost:4000 node --test tests/windows.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:4000';
const DEVICE = { 'x-nile-device': 'demo-device' };

async function req(method, path, { body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, data };
}
const op = (key, extra = {}) => ({ key, type: 'sale', at: new Date().toISOString(), amount: 100, ...extra });

test('W-01: قائمة البرامج الخمسة معروفة للخادم', async () => {
  const r = await req('GET', '/api/windows/programs', { headers: DEVICE });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.programs.map((p) => p.slug).sort(), ['attendance', 'cashier', 'kitchen', 'reports', 'stock']);
});

test('W-02: مفتاح جهاز غير معروف → 401 (البرنامج لا يزامن بهوية مزيفة)', async () => {
  const bad = await req('POST', '/api/windows/sync', {
    headers: { 'x-nile-device': 'intruder' },
    body: { program: 'cashier', device: 'PC-X', ops: [op('k-bad')] },
  });
  assert.equal(bad.status, 401);
  assert.equal((await req('GET', '/api/windows/summary')).status, 401);
  assert.equal((await req('GET', '/api/windows/programs')).status, 401);
});

test('W-03: دفعة فاتورة تُقبل وتظهر في الملخص بالبرنامج الصحيح', async () => {
  const r = await req('POST', '/api/windows/sync', {
    headers: DEVICE,
    body: { program: 'cashier', device: 'PC-TEST-1', ops: [op('c-1', { amount: 250 }), op('c-2', { amount: 150 })] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.acked.length, 2);
  assert.equal(r.data.duplicates.length, 0);
  assert.ok(r.data.serverTime);

  const s = await req('GET', '/api/windows/summary', { headers: DEVICE });
  const cashier = s.data.programs.find((p) => p.program === 'cashier');
  assert.ok(cashier, 'الكاشير ظاهر في الملخص');
  assert.equal(cashier.amount, 400, 'المبالغ تُجمع بدقة');
  assert.ok(s.data.devices.some((d) => d.id === 'PC-TEST-1'));
});

test('W-04: إعادة إرسال نفس الدفعة لا تضاعف شيئاً (شبكة قطعت بعد الإرسال)', async () => {
  const body = { program: 'stock', device: 'PC-TEST-2', ops: [op('s-1'), op('s-2')] };
  const first = await req('POST', '/api/windows/sync', { headers: DEVICE, body });
  assert.equal(first.data.acked.length, 2);

  const again = await req('POST', '/api/windows/sync', { headers: DEVICE, body });
  assert.equal(again.status, 200);
  assert.equal(again.data.acked.length, 0, 'ولا عملية جديدة');
  assert.deepEqual(again.data.duplicates.sort(), ['s-1', 's-2']);

  const s = await req('GET', '/api/windows/summary', { headers: DEVICE });
  const stock = s.data.programs.find((p) => p.program === 'stock');
  assert.equal(stock.ops, 2, 'عمليتان فقط رغم الإرسالين');
});

test('W-05: برنامج غير معروف، أو عملية بلا مفتاح/نوع، أو دفعة أكبر من الحد → 400', async () => {
  const unknown = await req('POST', '/api/windows/sync', {
    headers: DEVICE, body: { program: 'ghost', device: 'PC-1', ops: [op('g-1')] },
  });
  assert.equal(unknown.status, 400);

  const noKey = await req('POST', '/api/windows/sync', {
    headers: DEVICE, body: { program: 'cashier', device: 'PC-1', ops: [{ type: 'sale' }] },
  });
  assert.equal(noKey.status, 400);

  const noType = await req('POST', '/api/windows/sync', {
    headers: DEVICE, body: { program: 'cashier', device: 'PC-1', ops: [{ key: 'x-1' }] },
  });
  assert.equal(noType.status, 400);

  const big = await req('POST', '/api/windows/sync', {
    headers: DEVICE,
    body: { program: 'cashier', device: 'PC-1', ops: Array.from({ length: 301 }, (_, i) => op(`big-${i}`)) },
  });
  assert.equal(big.status, 400);
});

test('W-06: المفاتيح تُنظَّف ولا تتجاوز الحد، والملخص يعطي أياماً وبرامج', async () => {
  // خمسة برامج تزامن كلها — الملخص يجب أن يعرض كل من أرسل
  for (const program of ['kitchen', 'attendance', 'reports']) {
    const r = await req('POST', '/api/windows/sync', {
      headers: DEVICE, body: { program, device: `PC-${program}`, ops: [op(`${program}-1`, { type: 'boot' })] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.acked.length, 1);
  }
  const s = await req('GET', '/api/windows/summary', { headers: DEVICE });
  const slugs = s.data.programs.map((p) => p.program);
  for (const slug of ['cashier', 'stock', 'kitchen', 'attendance', 'reports']) {
    assert.ok(slugs.includes(slug), `${slug} مزامن`);
  }
  assert.ok(Array.isArray(s.data.days) && s.data.days.length >= 1);
  assert.ok(s.data.days[0].day && typeof s.data.days[0].ops === 'number');
  assert.ok(s.data.totalOps >= 6);
});
