#!/usr/bin/env node
/* ============================================================
   Nile Systems — منصة ديمو موحّدة (أنظمة ومواقع جاهزة)
   سيرفر Node.js بدون أي مكتبات خارجية:
   - يقدّم الملفات الثابتة من public/
   - API JSON لتسجيل الدخول والصلاحيات والبيانات
   - تخزين في data/db.json (يقبل الاستبدال بـ SQLite/MySQL لاحقاً)
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// DB_FILE قابل للتغيير عبر متغير بيئة (للاختبارات المعزولة خارج المستودع)
// على Vercel نظام الملفات للقراءة فقط إلا /tmp — والـ /tmp لكل نسخة (instance) وليس مشتركاً.
const ON_SERVERLESS = Boolean(process.env.VERCEL);
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : (ON_SERVERLESS ? '/tmp/nilesys-db.json' : path.join(ROOT, 'data', 'db.json'));

// مخزن مشترك (Supabase/PostgREST): اختياري تماماً. لو المتغيرين موجودين، المستند كله
// (نفس ملف JSON كما هو) يُقرأ ويُكتب في صف واحد — فلا تعتمد البيانات على /tmp لكل نسخة.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const STATE_ID = process.env.DEMO_STATE_ID || 'nilesys-demo';
const REMOTE_STORE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const PORT = Number(process.env.PORT || 3000);
const DAY = 24 * 60 * 60 * 1000;

/* ================= بذور البيانات (Demo Seed) ================= */

function daysAgo(d, h, m) {
  const t = new Date(Date.now() - d * DAY);
  t.setHours(h, m || 0, 0, 0);
  return t.toISOString();
}
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// RESET-2: معرّف ثابت لكل حساب ديمو (مشتق من النظام + اسم المستخدم) حتى لا
// تنكسر الجلسات المفتوحة عند إعادة ضبط الديمو (الجلسة مربوطة بـ userId).
function stableUserId(system, username) {
  const h = crypto.createHash('sha256').update(`nile-demo-user:${system}:${username}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function seedUsers() {
  const mk = (system, username, name, role) => ({
    id: stableUserId(system, username), system, username, password: 'demo1234', name, role,
  });
  return [
    mk('pos', 'manager', 'أحمد سامي', 'manager'),
    mk('pos', 'cashier', 'منى عادل', 'cashier'),
    mk('inventory', 'manager', 'خالد فتحي', 'manager'),
    mk('inventory', 'store', 'سعيد ربيع', 'store'),
    mk('restaurant', 'manager', 'طارق نبيل', 'manager'),
    mk('restaurant', 'waiter', 'يوسف حسن', 'waiter'),
    mk('restaurant', 'kitchen', 'شيف إبراهيم', 'kitchen'),
    mk('clinic', 'manager', 'د. هالة مراد', 'manager'),
    mk('clinic', 'reception', 'نورا سمير', 'reception'),
    mk('clinic', 'doctor', 'د. أحمد الشريف', 'doctor'),
    mk('hr', 'manager', 'مها رشدي', 'manager'),
    mk('hr', 'employee', 'نادين حسام', 'employee'),
    mk('courts', 'manager', 'مدير ملعبنا', 'manager'),
    mk('admin', 'admin', 'مدير الموقع', 'admin'),
  ];
}

function seedProducts() {
  // [الاسم, القسم, التكلفة, السعر, الأيقونة, الباركود]
  const raw = [
    ['مياه معدنية 600 مل', 'مشروبات', 5, 10, '💧', '6221031500101'],
    ['كولا 330 مل', 'مشروبات', 8, 15, '🥤', '6221031500102'],
    ['عصير مانجو 1 لتر', 'مشروبات', 18, 32, '🧃', '6221031500103'],
    ['شاي أكياس 25 كوب', 'مشروبات', 22, 40, '🍵', '6221031500104'],
    ['نسكافيه أصلي 50 جم', 'مشروبات', 55, 85, '☕', '6221031500105'],
    ['شيبسي عائلي', 'وجبات خفيفة', 12, 20, '🥔', '6221031500106'],
    ['بسكويت سادة', 'وجبات خفيفة', 6, 12, '🍪', '6221031500107'],
    ['شوكولاتة بار', 'وجبات خفيفة', 10, 18, '🍫', '6221031500108'],
    ['مكسرات مشكلة 100 جم', 'وجبات خفيفة', 35, 60, '🥜', '6221031500109'],
    ['زيتون أسود 250 جم', 'وجبات خفيفة', 18, 32, '🫒', '6221031500110'],
    ['عيش فينو', 'مخبوزات', 2, 5, '🥖', '6221031500111'],
    ['كيك إسبونج', 'مخبوزات', 15, 28, '🍰', '6221031500112'],
    ['توست أبيض', 'مخبوزات', 9, 16, '🍞', '6221031500113'],
    ['كرواسون بالزبدة', 'مخبوزات', 12, 22, '🥐', '6221031500114'],
    ['لبن جهينة 1 لتر', 'ألبان', 24, 36, '🥛', '6221031500115'],
    ['زبادي 100 جم', 'ألبان', 4, 8, '🍶', '6221031500116'],
    ['جبنة بيضاء 500 جم', 'ألبان', 45, 70, '🧀', '6221031500117'],
    ['قشطة طازجة', 'ألبان', 20, 35, '🥄', '6221031500118'],
    ['صابون مضاد للبكتيريا', 'عناية شخصية', 12, 22, '🧼', '6221031500119'],
    ['شامبو 400 مل', 'عناية شخصية', 65, 95, '🧴', '6221031500120'],
    ['معجون أسنان', 'عناية شخصية', 25, 45, '🦷', '6221031500121'],
    ['مناديل ورقية', 'عناية شخصية', 10, 18, '🧻', '6221031500122'],
    ['كلوركس 1 لتر', 'منظفات', 20, 35, '🧹', '6221031500123'],
    ['مسحوق غسيل 2.5 كجم', 'منظفات', 75, 115, '🧺', '6221031500124'],
    ['سائل أطباق', 'منظفات', 28, 48, '🍽️', '6221031500125'],
    ['قفازات مطاطة', 'منظفات', 15, 28, '🧤', '6221031500126'],
  ];
  return raw.map(([name, category, cost, price, emoji, barcode]) => ({
    id: crypto.randomUUID(), system: 'pos', name, category, cost, price, emoji, barcode,
    stock: rnd(8, 60), active: true,
  }));
}

function seedSales(users, products) {
  const sales = [];
  const cashier = users.find((u) => u.username === 'cashier');
  const manager = users.find((u) => u.username === 'manager');
  let no = 1000;
  // مبيعات آخر 7 أيام (للتقرير)
  for (let d = 6; d >= 1; d--) {
    const count = rnd(4, 9);
    for (let i = 0; i < count; i++) {
      const h = rnd(9, 22);
      const items = [];
      const n = rnd(1, 5);
      for (let j = 0; j < n; j++) {
        const p = pick(products);
        items.push({ productId: p.id, name: p.name, qty: rnd(1, 3), price: p.price, cost: p.cost });
      }
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
      const discount = Math.random() < 0.15 ? rnd(5, 20) : 0;
      const total = subtotal - discount;
      sales.push({
        id: crypto.randomUUID(), no: no++, system: 'pos',
        userId: Math.random() < 0.75 ? cashier.id : manager.id,
        createdAt: daysAgo(d, h, rnd(0, 59)), items,
        subtotal, discount, total,
        profit: items.reduce((s, it) => s + (it.price - it.cost) * it.qty, 0) - discount,
        method: Math.random() < 0.7 ? 'cash' : 'card', status: 'completed', returned: [],
      });
    }
  }
  // مبيعات النهارده
  const nowH = new Date().getHours();
  for (let h = 9; h <= Math.max(nowH, 9); h++) {
    const count = rnd(1, 3);
    for (let i = 0; i < count; i++) {
      const items = [];
      const n = rnd(1, 4);
      for (let j = 0; j < n; j++) {
        const p = pick(products);
        items.push({ productId: p.id, name: p.name, qty: rnd(1, 3), price: p.price, cost: p.cost });
      }
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
      const discount = 0;
      sales.push({
        id: crypto.randomUUID(), no: no++, system: 'pos',
        // SEED-1: لا تولّد مبيعات بتاريخ مستقبلي (كانت تقع داخل أي وردية تُفتح الآن وتضخّم النقدية المتوقعة)
        userId: cashier.id, createdAt: new Date(Math.min(Date.parse(daysAgo(0, h, rnd(0, 59))), Date.now() - 60 * 1000)).toISOString(), items,
        subtotal, discount, total: subtotal,
        profit: items.reduce((s, it) => s + (it.price - it.cost) * it.qty, 0),
        method: Math.random() < 0.7 ? 'cash' : 'card', status: 'completed', returned: [],
      });
    }
  }
  return sales;
}

function buildSeed() {
  const users = seedUsers();
  const products = seedProducts();
  return {
    branding: { storeName: 'سوبر ماركت النيل', logoText: 'NS', primary: '#0d9488', currency: 'ج.م' },
    users, products,
    sales: seedSales(users, products),
    shifts: [],
    settings: { resetDaily: true },
  };
}

/* ================= مخزن البيانات ================= */

let db;
let initPromise = null;

/* --- التخزين المشترك عبر PostgREST (Supabase) --- */
function remoteHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}
async function remoteRead() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/demo_state?id=eq.${encodeURIComponent(STATE_ID)}&select=doc`,
    { headers: remoteHeaders() },
  );
  if (!res.ok) throw new Error(`remote read ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length ? rows[0].doc : null;
}
async function remoteWrite(doc) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/demo_state`, {
    method: 'POST',
    headers: { ...remoteHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: STATE_ID, doc, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) throw new Error(`remote write ${res.status}: ${await res.text()}`);
}

function loadLocal() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = buildSeed();
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

// تُستدعى مرة واحدة؛ آمنة للنداء المتكرر. مطلوبة لأن القراءة المشتركة غير متزامنة.
function initialize() {
  if (initPromise) return initPromise;
  if (!REMOTE_STORE) {
    loadLocal();
    initPromise = Promise.resolve();
    return initPromise;
  }
  initPromise = (async () => {
    const doc = await remoteRead();
    if (doc) {
      db = doc;
    } else {
      db = buildSeed();
      await remoteWrite(db);
    }
  })();
  return initPromise;
}

let saveTimer = null;
let pendingWrite = Promise.resolve();
function flush() {
  if (REMOTE_STORE) {
    pendingWrite = pendingWrite
      .then(() => remoteWrite(db))
      .catch((e) => console.error('remote save failed:', e.message));
    return pendingWrite;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  return Promise.resolve();
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 80);
}
function resetDemo() {
  db = buildSeed();
  flush();
}

/* ================= الجلسات ================= */

// التوكن موقَّع ووافٍ بذاته (لا يعتمد على ذاكرة العملية) — ضروري على Vercel حيث كل طلب قد يصل لنسخة أخرى.
// الإبطال (تسجيل خروج) عبر قائمة jti ملغاة داخل العملية الواحدة.
const COOKIE = 'nile_sid';
// مفتاح التوقيع: للديمو فقط. على Vercel لازم يكون ثابتاً بين النسخ (انظر README).
const SESSION_SECRET = process.env.SESSION_SECRET || 'nilesys-demo-session-secret';
const SESSION_TTL = 12 * 60 * 60 * 1000;
const revoked = new Set(); // jti ملغاة (تسجيل خروج) داخل هذه العملية

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!s || !s.expires || s.expires < Date.now()) return null;
    return s;
  } catch { return null; }
}
function newSession(user) {
  return sign({
    userId: user.id,
    system: user.system,
    expires: Date.now() + SESSION_TTL,
    jti: crypto.randomBytes(9).toString('hex'),
  });
}
function getSession(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const s = verify(m[1]);
  if (!s) return null;
  if (revoked.has(s.jti)) return null;
  return s;
}
function currentUser(req) {
  const s = getSession(req);
  if (!s) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}

/* ================= أدوات HTTP ================= */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function sendJSON(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body);
}
function sendError(res, code, message) { sendJSON(res, code, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* ================= منطق الـ API ================= */

function publicUser(u) {
  return u ? { id: u.id, name: u.name, username: u.username, role: u.role, system: u.system } : null;
}

function saleTotals(items, discount) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const d = Math.max(0, Math.min(Number(discount) || 0, subtotal));
  const profit = items.reduce((s, it) => s + (it.price - it.cost) * it.qty, 0) - d;
  return { subtotal, discount: d, total: subtotal - d, profit };
}

// PERM-3: مسارات بيانات نقطة البيع — مسموحة لمستخدمي نظام pos فقط
const POS_ROUTE = /^(GET|POST|PUT|DELETE) \/api\/(products|sales|returns|shifts|reports|branding|reset)(\/|$)/;

// SHIFT-2: حركة النقدية داخل نافذة الوردية = مبيعات كاش − مرتجعات كاش مدفوعة في نفس النافذة.
// الفواتير القديمة (قبل تسجيل refunds) المرتجعة بالكامل تُستبعد كما كان السلوك السابق.
function shiftExpectedCash(shift, untilIso) {
  const from = new Date(shift.openedAt).getTime();
  const until = untilIso ? new Date(untilIso).getTime() : Infinity;
  const inWindow = (iso) => { const t = new Date(iso).getTime(); return t >= from && t <= until; };
  let cash = 0;
  for (const s of db.sales) {
    if (s.system !== 'pos' || s.method !== 'cash') continue;
    const legacyFullReturn = !Array.isArray(s.refunds) && s.status === 'returned';
    if (!legacyFullReturn && inWindow(s.createdAt)) cash += s.total;
    for (const r of s.refunds || []) if (inWindow(r.at)) cash -= r.amount;
  }
  return shift.startingCash + cash;
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const user = currentUser(req);
  const isManager = user && user.role === 'manager';
  const q = url.searchParams;

  /* ---- الجلسة ---- */
  if (route === 'POST /api/login') {
    const { system, username, password } = await readBody(req);
    const u = db.users.find((x) => x.system === system && x.username === username);
    if (!u || u.password !== password) return sendError(res, 401, 'اسم المستخدم أو كلمة المرور غلط');
    const token = newSession(u);
    return sendJSON(res, 200, { user: publicUser(u) }, {
      'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
    });
  }
  if (route === 'POST /api/logout') {
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (m) { const s = verify(m[1]); if (s && s.jti) revoked.add(s.jti); }
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
  }
  if (route === 'GET /api/session') {
    return sendJSON(res, 200, { user: publicUser(user) });
  }
  if (!user) return sendError(res, 401, 'لازم تسجل دخول الأول');

  /* ---- بيانات عامة لأي نظام ---- */
  if (route === 'GET /api/bootstrap') {
    const openShift = db.shifts.find((s) => s.system === user.system && !s.closedAt) || null;
    return sendJSON(res, 200, {
      branding: db.branding,
      user: publicUser(user),
      openShift,
      todaySales: db.sales.filter((s) => s.system === user.system && isToday(s.createdAt)).length,
    });
  }

  /* ================= POS ================= */
  if (POS_ROUTE.test(route) && user.system !== 'pos') {
    return sendError(res, 403, 'غير مسموح: بيانات نقطة البيع لمستخدمي نظام الكاشير فقط');
  }
  if (route === 'GET /api/products') {
    return sendJSON(res, 200, { products: db.products.filter((p) => p.active) });
  }
  if (route === 'POST /api/products') {
    if (!isManager) return sendError(res, 403, 'للمدير بس');
    const b = await readBody(req);
    if (!b.name || !(b.price > 0)) return sendError(res, 400, 'الاسم والسعر مطلوبين');
    // SALE-6: الباركود لازم يكون فريد بين الأصناف النشطة (المسح بالباركود يختار صنفاً واحداً)
    const barcode = String(b.barcode || `622${Date.now()}`).trim().slice(0, 20);
    if (db.products.some((x) => x.active && x.system === 'pos' && x.barcode === barcode)) {
      return sendError(res, 409, 'الباركود مستخدم لصنف آخر');
    }
    const p = {
      id: crypto.randomUUID(), system: 'pos', name: String(b.name).slice(0, 80),
      category: String(b.category || 'متنوع').slice(0, 40),
      cost: Number(b.cost) || 0, price: Number(b.price),
      emoji: String(b.emoji || '📦').slice(0, 4),
      barcode,
      stock: Number(b.stock) || 0, active: true,
    };
    db.products.push(p); save();
    return sendJSON(res, 201, { product: p });
  }
  if (route.startsWith('PUT /api/products/')) {
    if (!isManager) return sendError(res, 403, 'للمدير بس');
    const id = route.split('/').pop();
    const b = await readBody(req);
    const p = db.products.find((x) => x.id === id);
    if (!p) return sendError(res, 404, 'الصنف مش موجود');
    Object.assign(p, {
      name: String(b.name ?? p.name).slice(0, 80),
      category: String(b.category ?? p.category).slice(0, 40),
      cost: Number(b.cost ?? p.cost) || 0, price: Number(b.price ?? p.price) || p.price,
      emoji: String(b.emoji ?? p.emoji).slice(0, 4),
      stock: Number(b.stock ?? p.stock) || 0,
    });
    save();
    return sendJSON(res, 200, { product: p });
  }
  if (route.startsWith('DELETE /api/products/')) {
    if (!isManager) return sendError(res, 403, 'للمدير بس');
    const id = route.split('/').pop();
    const p = db.products.find((x) => x.id === id);
    if (!p) return sendError(res, 404, 'الصنف مش موجود');
    p.active = false; save();
    return sendJSON(res, 200, { ok: true });
  }
  if (route === 'POST /api/sales') {
    const b = await readBody(req);
    const items = (b.items || []).map((it) => {
      const p = db.products.find((x) => x.id === it.productId);
      if (!p) throw Object.assign(new Error('صنف غير موجود'), { status: 400 });
      return { productId: p.id, name: p.name, qty: Math.max(1, Number(it.qty) || 1), price: p.price, cost: p.cost };
    });
    if (!items.length) return sendError(res, 400, 'السلة فاضية');
    // SALE-2: التحقق من كفاية المخزون (مع تجميع تكرار نفس الصنف في السلة) قبل أي خصم.
    // التحقق والخصم متزامنان في نفس الدورة (Node أحادي الخيط) فلا يوجد سباق بين الطلبات.
    const need = new Map();
    for (const it of items) need.set(it.productId, (need.get(it.productId) || 0) + it.qty);
    for (const [pid, qty] of need) {
      const p = db.products.find((x) => x.id === pid);
      if (qty > p.stock) return sendError(res, 409, `المخزون غير كافٍ: ${p.name} (المتاح ${p.stock})`);
    }
    const t = saleTotals(items, b.discount);
    // SALE-3: الكاش لازم يغطي الإجمالي؛ الكارت يُسجَّل بالإجمالي بالضبط.
    const method = b.method === 'card' ? 'card' : 'cash';
    let paid = t.total;
    if (method === 'cash' && b.paid !== undefined && b.paid !== null && b.paid !== '') {
      paid = Number(b.paid);
      if (!Number.isFinite(paid) || paid < t.total) {
        return sendError(res, 400, `المبلغ المدفوع أقل من الإجمالي (${t.total})`);
      }
    }
    for (const it of items) {
      const p = db.products.find((x) => x.id === it.productId);
      p.stock = Math.max(0, p.stock - it.qty);
    }
    const sale = {
      id: crypto.randomUUID(), no: (db.sales.reduce((m, s) => Math.max(m, s.no), 1000) + 1),
      system: 'pos', userId: user.id, createdAt: new Date().toISOString(),
      items, ...t, method,
      paid, status: 'completed', returned: [], refunds: [],
    };
    db.sales.push(sale); save();
    return sendJSON(res, 201, { sale });
  }
  if (route === 'GET /api/sales') {
    const limit = Math.min(Number(q.get('limit')) || 50, 300);
    const list = db.sales.filter((s) => s.system === 'pos')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
    return sendJSON(res, 200, { sales: list });
  }
  if (route.startsWith('GET /api/sales/')) {
    const s = db.sales.find((x) => x.id === route.split('/').pop());
    if (!s) return sendError(res, 404, 'الفاتورة مش موجودة');
    return sendJSON(res, 200, { sale: s });
  }
  if (route === 'POST /api/returns') {
    if (!isManager) return sendError(res, 403, 'المرتجعات للمدير بس');
    const b = await readBody(req);
    const sale = db.sales.find((x) => x.id === b.saleId);
    if (!sale) return sendError(res, 404, 'الفاتورة مش موجودة');
    if (sale.status === 'returned') return sendError(res, 400, 'الفاتورة مرتجعة بالكامل');
    const back = [];
    for (const r of b.items || []) {
      const it = sale.items.find((x) => x.productId === r.productId);
      if (!it) continue;
      const already = sale.returned.find((x) => x.productId === r.productId);
      const done = already ? already.qty : 0;
      const qty = Math.max(0, Math.min(Number(r.qty) || 0, it.qty - done));
      if (!qty) continue;
      if (already) already.qty += qty;
      else sale.returned.push({ productId: r.productId, qty });
      back.push({ ...r, qty });
      const p = db.products.find((x) => x.id === r.productId);
      if (p) p.stock += qty;
    }
    if (!back.length) return sendError(res, 400, 'مفيش أصناف صالحة للمرتجع');
    const gross = back.reduce((s, r) => {
      const it = sale.items.find((x) => x.productId === r.productId);
      return s + it.price * r.qty;
    }, 0);
    const allBack = sale.items.every((it) => {
      const rr = sale.returned.find((x) => x.productId === it.productId);
      return rr && rr.qty >= it.qty;
    });
    // SHIFT-2: المبلغ المرتجع يُسجَّل بوقته وطريقته ليُخصم من نقدية الوردية.
    // الخصم يُوزَّع نسبياً، وآخر مرتجع يأخذ الباقي بالضبط حتى لا يتجاوز مجموع المرتجع ما دُفع.
    if (!Array.isArray(sale.refunds)) sale.refunds = [];
    const refundedSoFar = sale.refunds.reduce((a, r) => a + r.amount, 0);
    const refund = allBack
      ? Math.max(0, sale.total - refundedSoFar)
      : (sale.subtotal > 0 ? Math.round((gross * sale.total / sale.subtotal) * 100) / 100 : 0);
    sale.refunds.push({ at: new Date().toISOString(), amount: refund, method: sale.method });
    sale.status = allBack ? 'returned' : 'partial';
    save();
    return sendJSON(res, 201, { sale, refund });
  }
  if (route === 'POST /api/shifts') {
    const b = await readBody(req);
    const open = db.shifts.find((s) => s.system === user.system && !s.closedAt);
    if (b.action === 'open') {
      if (open) return sendError(res, 400, 'في وردية مفتوحة بالفعل');
      const shift = {
        id: crypto.randomUUID(), system: 'pos', userId: user.id,
        openedAt: new Date().toISOString(), startingCash: Number(b.startingCash) || 0,
        closedAt: null, countedCash: null, expectedCash: null, diff: null,
      };
      db.shifts.push(shift); save();
      return sendJSON(res, 201, { shift });
    }
    if (b.action === 'close') {
      if (!open) return sendError(res, 400, 'مفيش وردية مفتوحة');
      const closedAt = new Date().toISOString();
      const expected = shiftExpectedCash(open, closedAt);
      const counted = Number(b.countedCash) || 0;
      open.closedAt = closedAt;
      open.expectedCash = expected;
      open.countedCash = counted;
      open.diff = counted - expected;
      save();
      return sendJSON(res, 201, { shift: open });
    }
    return sendError(res, 400, 'action غلط');
  }
  if (route === 'GET /api/shifts') {
    const found = db.shifts.find((s) => s.system === user.system && !s.closedAt);
    const open = found ? { ...found, expectedCashNow: shiftExpectedCash(found) } : null;
    return sendJSON(res, 200, { openShift: open, shifts: db.shifts.filter((s) => s.system === 'pos').slice(-10).reverse() });
  }
  if (route === 'GET /api/reports/summary') {
    const range = q.get('range') || 'today';
    const from = range === 'week' ? Date.now() - 7 * DAY : new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const sales = db.sales.filter((s) => s.system === 'pos' && new Date(s.createdAt).getTime() >= from);
    const valid = sales.filter((s) => s.status !== 'returned');
    const salesTotal = valid.reduce((a, s) => a + s.total, 0);
    const profit = valid.reduce((a, s) => a + s.profit, 0);
    const byHour = Array(24).fill(0);
    valid.forEach((s) => { byHour[new Date(s.createdAt).getHours()] += s.total; });
    const top = {};
    valid.forEach((s) => s.items.forEach((it) => {
      if (!top[it.name]) top[it.name] = { name: it.name, qty: 0, total: 0 };
      top[it.name].qty += it.qty; top[it.name].total += it.price * it.qty;
    }));
    const byMethod = { cash: 0, card: 0 };
    valid.forEach((s) => { byMethod[s.method] += s.total; });
    return sendJSON(res, 200, {
      range, salesTotal, profit, invoices: valid.length,
      avg: valid.length ? Math.round(salesTotal / valid.length) : 0,
      byHour, topProducts: Object.values(top).sort((a, b) => b.total - a.total).slice(0, 6),
      byMethod, returns: sales.filter((s) => s.status !== 'completed').length,
    });
  }
  if (route === 'PUT /api/branding') {
    if (!isManager) return sendError(res, 403, 'للمدير بس');
    const b = await readBody(req);
    db.branding.storeName = String(b.storeName ?? db.branding.storeName).slice(0, 60);
    db.branding.logoText = String(b.logoText ?? db.branding.logoText).slice(0, 4);
    if (/^#[0-9a-f]{6}$/i.test(b.primary || '')) db.branding.primary = b.primary;
    save();
    return sendJSON(res, 200, { branding: db.branding });
  }
  if (route === 'POST /api/reset') {
    if (!isManager) return sendError(res, 403, 'للمدير بس');
    resetDemo();
    return sendJSON(res, 200, { ok: true });
  }

  return sendError(res, 404, 'المسار غير موجود');
}

function isToday(iso) {
  const d = new Date(iso); const n = new Date();
  return d.toDateString() === n.toDateString();
}

/* ================= الملفات الثابتة ================= */

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'ممنوع');
  fs.readFile(file, (err, data) => {
    if (err) {
      // صفحات الويب بدون امتداد → index.html (SPA-ish fallback)
      if (!path.extname(file)) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
        if (e2) return sendError(res, 404, 'مش موجود');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(d2);
      });
      return sendError(res, 404, 'مش موجود');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ================= التشغيل ================= */

async function requestListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    await initialize();
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch (e) {
    sendError(res, e.status || 500, e.message || 'خطأ في السيرفر');
  }
}

function start() {
  return http.createServer(requestListener).listen(PORT, '0.0.0.0', () => {
    console.log(`Nile Systems demo platform → http://localhost:${PORT}`);
  });
}

module.exports = { requestListener, start };

// التشغيل المباشر فقط (`node server.js`) يفتح البورت — الاستيراد من Vercel لا يفتح شيئاً.
if (require.main === module) start();
