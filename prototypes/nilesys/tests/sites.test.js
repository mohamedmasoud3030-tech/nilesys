/* لوحة المواقع — اختبارات النظام الكامل (API).
 * كل حالة تقابل معيار قبول في docs/product/systems/sites.md.
 *   BASE=http://localhost:4000 node --test tests/sites.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:4000';

async function req(method, path, { cookie, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const sc = r.headers.get('set-cookie');
  return { status: r.status, data, cookie: sc ? sc.split(';')[0] : null };
}
const phone = (n) => `010${String(Date.now()).slice(-6)}${n}`;

let ADMIN, MARKETER, PHONE_A, PHONE_B;

test('SETUP: مدير الموقع ومدير نشاط، وقائمة المواقع السبعة', async () => {
  const login = async (username, password = 'demo1234') => req('POST', '/api/login', {
    body: { system: 'admin', username, password },
  });
  const a = await login('admin');
  assert.equal(a.status, 200, JSON.stringify(a.data));
  ADMIN = a.cookie;
  const m = await login('manager');
  assert.equal(m.status, 200, JSON.stringify(m.data));
  MARKETER = m.cookie;
  PHONE_A = phone(1);
  PHONE_B = phone(2);

  const list = await req('GET', '/api/sites', { cookie: ADMIN });
  assert.equal(list.status, 200);
  assert.equal(list.data.sites.length, 7, 'سبعة مواقع');
});

test('S-01: سبعة مواقع، حالتان على الأقل live، ولكل موقع رابط يعمل', async () => {
  const { data } = await req('GET', '/api/sites', { cookie: ADMIN });
  const live = data.sites.filter((s) => s.status === 'live');
  assert.ok(live.length >= 2, `مواقع تعمل: ${live.length}`);
  for (const s of data.sites) {
    const page = await fetch(BASE + s.url);
    assert.equal(page.status, 200, `صفحة ${s.slug} ترد 200`);
  }
  // الحالة لا تُخترع: كل موقع يعلن حالته كما هي في صفحته
  const fashion = data.sites.find((s) => s.slug === 'fashion');
  const gym = data.sites.find((s) => s.slug === 'gym');
  assert.equal(fashion.status, 'live');
  assert.equal(gym.status, 'coming');
});

test('S-02: رسالة من صفحة موقع عامة تُحفظ وتظهر في اللوحة', async () => {
  const r = await req('POST', '/api/sites/fashion/lead', {
    body: { name: 'سلمى فؤاد', phone: PHONE_A, message: 'عايزة أعرف المقاسات' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.lead.status, 'new');

  const leads = await req('GET', '/api/sites/leads', { cookie: ADMIN });
  assert.equal(leads.status, 200);
  const hit = leads.data.leads.find((l) => l.id === r.data.lead.id);
  assert.ok(hit, 'الرسالة ظاهرة في اللوحة');
  assert.equal(hit.siteName, 'متجر ملابس');
});

test('S-03: نفس الموبايل مرتين في 24 ساعة → رسالة واحدة', async () => {
  const first = await req('POST', '/api/sites/mobile/lead', {
    body: { name: 'كريم ياسر', phone: PHONE_B, message: 'سعر الآيفون' },
  });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/sites/mobile/lead', {
    body: { name: 'كريم ياسر', phone: PHONE_B, message: 'سعر الآيفون تاني' },
  });
  assert.equal(second.status, 200, 'لا رسالة جديدة');
  assert.equal(second.data.duplicate, true);
  assert.equal(second.data.lead.id, first.data.lead.id, 'نفس الرسالة تُعاد');

  const all = await req('GET', '/api/sites/leads?site=mobile', { cookie: ADMIN });
  assert.equal(all.data.leads.filter((l) => l.phone === PHONE_B).length, 1);
});

test('S-04: رسالة بلا اسم أو بموبايل غير صالح → 400', async () => {
  assert.equal((await req('POST', '/api/sites/fashion/lead', { body: { name: '', phone: PHONE_A } })).status, 400);
  assert.equal((await req('POST', '/api/sites/fashion/lead', { body: { name: 'محمد', phone: '123' } })).status, 400);
  assert.equal((await req('POST', '/api/sites/ghost/lead', { body: { name: 'محمد', phone: PHONE_A } })).status, 404);
});

test('S-05: مدير النشاط يرى موقعه فقط، وطلب غيره → 403', async () => {
  const mine = await req('GET', '/api/sites', { cookie: MARKETER });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.sites.map((s) => s.slug), ['fashion']);

  const leads = await req('GET', '/api/sites/leads', { cookie: MARKETER });
  assert.equal(leads.status, 200);
  assert.ok(leads.data.leads.every((l) => l.siteSlug === 'fashion'), 'يرى رسائل موقعه فقط');

  // رسالة موقع آخر: لا تُعدَّل
  const other = await req('POST', '/api/sites/mobile/lead', {
    body: { name: 'هدى مراد', phone: phone(9) },
  });
  assert.equal(other.status, 201);
  const patch = await req('POST', `/api/sites/leads/${other.data.lead.id}/status`, {
    cookie: MARKETER, body: { status: 'replied' },
  });
  assert.equal(patch.status, 403);

  // ونفس مدير النشاط لا يعدّل موقعاً آخر
  const put = await req('PUT', '/api/sites/mobile', { cookie: MARKETER, body: { headline: 'x' } });
  assert.equal(put.status, 403);

  // ولا مستخدم نظام آخر يدخل اللوحة
  const pos = await req('POST', '/api/login', { body: { system: 'pos', username: 'cashier', password: 'demo1234' } });
  assert.equal((await req('GET', '/api/sites', { cookie: pos.cookie })).status, 403);
});

test('S-06: رسالة مغلقة لا ترجع جديدة (409)', async () => {
  const made = await req('POST', '/api/sites/gym/lead', {
    body: { name: 'أمينة سعد', phone: phone(3), message: 'مواعيد الجيم' },
  });
  const id = made.data.lead.id;
  const replied = await req('POST', `/api/sites/leads/${id}/status`, { cookie: ADMIN, body: { status: 'replied' } });
  assert.equal(replied.status, 200);
  const closed = await req('POST', `/api/sites/leads/${id}/status`, { cookie: ADMIN, body: { status: 'closed' } });
  assert.equal(closed.status, 200);
  // مغلقة → تم الرد = 409، ومغلقة → مغلقة = 409
  assert.equal((await req('POST', `/api/sites/leads/${id}/status`, { cookie: ADMIN, body: { status: 'replied' } })).status, 409);
  assert.equal((await req('POST', `/api/sites/leads/${id}/status`, { cookie: ADMIN, body: { status: 'closed' } })).status, 409);
  // وحالة غير معروفة = 400
  const newOne = await req('POST', '/api/sites/gym/lead', { body: { name: 'سامح', phone: phone(4) } });
  assert.equal((await req('POST', `/api/sites/leads/${newOne.data.lead.id}/status`, { cookie: ADMIN, body: { status: 'new' } })).status, 400);
});

test('S-07: زيارة مكررة من نفس الجلسة لا تُحسب مرتين', async () => {
  const first = await req('POST', '/api/sites/fashion/view');
  assert.equal(first.status, 200);
  assert.equal(first.data.counted, true);
  const sid = first.cookie;
  assert.ok(sid && sid.startsWith('nile_vid='), 'جلسة زيارة تُمنح');
  const before = first.data.views;

  const again = await req('POST', '/api/sites/fashion/view', { cookie: sid });
  assert.equal(again.status, 200);
  assert.equal(again.data.counted, false, 'نفس الجلسة لا تُحسب');
  assert.equal(again.data.views, before);

  // جلسة أخرى تُحسب
  const other = await req('POST', '/api/sites/fashion/view');
  assert.equal(other.data.counted, true);
  assert.equal(other.data.views, before + 1);

  const list = await req('GET', '/api/sites', { cookie: ADMIN });
  const fashion = list.data.sites.find((s) => s.slug === 'fashion');
  assert.equal(fashion.viewsToday, before + 1, 'العداد يظهر في اللوحة');
});

test('S-08: عدد الأنظمة العاملة يأتي من سجل المواصفات لا من رقم مكتوب', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'systems.json'), 'utf8'));
  const { data } = await req('GET', '/api/sites/summary', { cookie: ADMIN });
  assert.equal(data.systems.source, 'public/data/systems.json');
  assert.equal(data.systems.total, reg.systems.length, 'نفس عدد أنظمة السجل');
  assert.equal(data.systems.live, reg.systems.filter((s) => s.status === 'live').length);
  assert.equal(data.sites.total, 7);
  assert.ok(data.leads.total >= 3);
  assert.ok(data.topSite && data.topSite.slug, 'أكثر موقع جذباً محسوب');
});

test('S-09: تعديل المحتوى يحفظ ويظهر، وحالة الموقع لا تُزيف', async () => {
  const put = await req('PUT', '/api/sites/gym', {
    cookie: ADMIN, body: { headline: 'جيم نسائي — اشتراك شهري بضمان', phone: '0100 999 8877' },
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.site.headline, 'جيم نسائي — اشتراك شهري بضمان');

  const list = await req('GET', '/api/sites', { cookie: ADMIN });
  const gym = list.data.sites.find((s) => s.slug === 'gym');
  assert.equal(gym.headline, 'جيم نسائي — اشتراك شهري بضمان', 'الحفظ ظاهر في القائمة');
  assert.equal(gym.status, 'coming', 'الحالة لم تتغيّر بالكتابة');

  // محاولة تغيير الحالة من اللوحة → 400 (تُقرأ من الصفحة)
  const fake = await req('PUT', '/api/sites/gym', { cookie: ADMIN, body: { status: 'live' } });
  assert.equal(fake.status, 400);

  // إيقاف الموقع لا يحذفه
  const off = await req('PUT', '/api/sites/clinic', { cookie: ADMIN, body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.site.active, false);
  const after = await req('GET', '/api/sites', { cookie: ADMIN });
  assert.equal(after.data.sites.length, 7, 'الإيقاف لا يحذف');
  await req('PUT', '/api/sites/clinic', { cookie: ADMIN, body: { active: true } });
});
