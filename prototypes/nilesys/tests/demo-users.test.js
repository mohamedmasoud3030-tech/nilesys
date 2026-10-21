/* حسابات الديمو على مستند قديم — اختبار ترحيل لا اختبار مسار.
 *
 * الحالة التي كشفت العيب: الديمو المنشور يحمل مستنداً حُفظ قبل إضافة نظام جديد،
 * فحسابات ذاك النظام (الموارد البشرية، الملاعب) غير موجودة فيه — والدخول يفشل
 * بـ 401 رغم أن الكود يضمّها. الاختبار يفتح سيرفراً على مستند «قديم» صناعيّاً
 * ويتأكد أن الترحيل يضيف الحسابات الناقصة ويكتبها في المستند فوراً.
 *
 *   node --test tests/demo-users.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.OLD_DB_PORT || 3557);

// مستند «من الأمس»: أنظمة الكاشير والمخازن فقط، بلا موارد بشرية ولا ملاعب.
const OLD_DOC = {
  branding: { storeName: 'سوبر ماركت النيل', logoText: 'NS', primary: '#0d9488', currency: 'ج.م' },
  users: [
    { id: 'u-pos-mgr', system: 'pos', username: 'manager', password: 'demo1234', name: 'أحمد سامي', role: 'manager' },
    { id: 'u-pos-cash', system: 'pos', username: 'cashier', password: 'demo1234', name: 'منى عادل', role: 'cashier' },
  ],
  products: [],
  sales: [],
  shifts: [],
  settings: { resetDaily: true },
};

let srv;
const dbFile = path.join(os.tmpdir(), `nile-old-doc-${process.pid}.json`);

async function waitUp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/session`);
      if (r.ok) return;
    } catch { /* لسه */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('السيرفر ما اشتغلش على المستند القديم');
}

test.before(async () => {
  fs.writeFileSync(dbFile, JSON.stringify(OLD_DOC, null, 2));
  srv = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_FILE: dbFile, PORT: String(PORT), SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' },
    stdio: 'ignore',
  });
  await waitUp();
});

test.after(() => {
  if (srv) srv.kill('SIGKILL');
  try { fs.unlinkSync(dbFile); } catch { /* */ }
});

test('M-01: مستند قديم — دخول نظام لم يكن في المستند ينجح بعد الترحيل', async () => {
  const login = async (system, username) => {
    const r = await fetch(`http://localhost:${PORT}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, username, password: 'demo1234' }),
    });
    return r.status;
  };
  assert.equal(await login('hr', 'officer'), 200, 'حساب الموارد البشرية أُضيف بالترحيل');
  assert.equal(await login('hr', 'employee'), 200);
  assert.equal(await login('courts', 'reception'), 200);
  assert.equal(await login('pos', 'cashier'), 200, 'حساب قديم لم يتأثر');
  assert.equal(await login('hr', 'ghost'), 401, 'الترحيل لا يفتح دخولاً وهمياً');
});

test('M-02: الحسابات المُضافة تُكتب في المستند (لا تعيش في الذاكرة فقط)', async () => {
  // القراءة من الملف بعد الترحيل: النسخة على Vercel تتجمد بعد الرد، فالترحيل
  // غير المحفوظ كان يعني 401 متكرراً على الديمو المنشور.
  const doc = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const names = doc.users.map((u) => `${u.system}:${u.username}`);
  assert.ok(names.includes('hr:officer'), 'officer محفوظ في المستند');
  assert.ok(names.includes('hr:manager'), 'مدير الموارد البشرية محفوظ');
  assert.ok(names.includes('courts:reception'), 'استقبال الملاعب محفوظ');
  assert.equal(doc.users.filter((u) => u.system === 'pos' && u.username === 'cashier').length, 1,
    'لا تكرار لحساب موجود');
});
