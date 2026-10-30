/* ============================================================================
 * نيل كاشير — واجهة نقطة البيع الإنتاجية فوق /api/v1 مباشرة.
 *
 * قواعد هذا الملف (انظر docs/pos-ui/AUDIT_AND_DESIGN.md):
 *  1) لا منطق تسعير نهائي هنا: المحرك يسعّر ويحسب الباقي والمتوقع. ما يظهر قبل
 *     الحفظ «مبدئي/معاينة» ويُوسم صراحةً بهذا المسمى في الواجهة.
 *  2) المال أعداد صحيحة (قروش) من الطرف للطرف — لا قسمة عائمة للعرض ولا تحويل.
 *     الكميات بأجزاء الألف الصحيحة (milli) وتُرسل نصًا كما يقتضي العقد.
 *  3) كل عملية مالية لها هوية معلّقة واحدة (مفتاح + بصمة) تُعاد عند المحاولات
 *     غير المؤكدة فلا يتكرر البيع/المرتجع/فتح الوردية بضغطة مزدوجة أو قطع شبكة.
 *  4) لا innerHTML لأي نص قادم من الخادم — بناء DOM عبر textContent فقط.
 *  5) لا بيانات تجريبية ولا كلمات مرور افتراضية في واجهة العميل.
 * ========================================================================== */

/* ── 1) منطق نقي (بلا DOM) — يُختبَر في apps/web/app.pure.test.ts ────────── */

function normalizeDigits(raw) {
  return String(raw ?? '')
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)) // ٠-٩
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0)) // ۰-۹
    .replace(/\u066B/g, '.') // ٫ فاصلة عشرية عربية
    .replace(/[\u066C,٬\s]/g, '') // فاصل آلاف/فراغات
    .trim();
}

/** نص مبلغ بالجنيه («89.95») → قروش صحيحة. رفض صارم لأي صيغة غامضة. */
function parseMoneyToMinor(raw) {
  const s = normalizeDigits(raw);
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** نص كمية («0.250») → أجزاء ألف صحيحة (250). */
function parseQtyMilli(raw) {
  const s = normalizeDigits(raw);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  return Number.isSafeInteger(milli) ? milli : null;
}

/** أجزاء ألف → نص العقد («2», «0.25») بلا أصفار زائدة. */
function milliToQtyString(milli) {
  const whole = Math.trunc(milli / 1000);
  const frac = String(Math.abs(milli % 1000)).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** تنسيق نص كمية قادم من الخادم («12.500») → «12.5». */
function fmtQtyString(q) {
  const milli = parseQtyMilli(q);
  return milli === null ? String(q ?? '') : milliToQtyString(milli);
}

/** قروش صحيحة → عرض مصري بأرقام لاتينية («12,345.67») دون أي قسمة عائمة. */
function fmtMinor(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n))).padStart(3, '0');
  const cents = digits.slice(-2);
  let pounds = digits.slice(0, -2);
  let grouped = '';
  while (pounds.length > 3) { grouped = ',' + pounds.slice(-3) + grouped; pounds = pounds.slice(0, -3); }
  return `${sign}${pounds}${grouped}.${cents}`;
}

/** معاينة سطر واحد فقط: السعر × الكمية مقربًا على مستوى السطر (النهائي من الخادم). */
function lineEstimateMinor(priceMinor, qtyMilli) {
  return Math.round((priceMinor * qtyMilli) / 1000);
}

function computeEstimate(lines) {
  let totalMinor = 0;
  const out = lines.map((l) => {
    const lineMinor = lineEstimateMinor(l.priceMinor, l.qtyMilli);
    totalMinor += lineMinor;
    return { ...l, lineMinor };
  });
  return { lines: out, totalMinor };
}

/** بصمة حمولة مستقرة لمقارنة «نفس العملية؟» — مقارنة نصية لا تشفير. */
function fingerprintOf(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(fingerprintOf).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + fingerprintOf(value[k])).join(',') + '}';
}

function newIdempotencyKey(kind) {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  return `pos-${kind}-${Date.now().toString(36)}-${rand}`;
}

/**
 * مخزن هويات العمليات المالية المعلّقة.
 * - نفس البصمة ⇒ نفس المفتاح (إعادة محاولة آمنة يستكملها الخادم دون تكرار).
 * - بصمة مختلفة (المستخدم عدّل العملية) ⇒ مفتاح جديد، لأنها عملية جديدة فعلًا.
 * - تُصفَّر فقط بنجاح مؤكد أو رفض نهائي؛ النتائج غير المؤكدة تُبقي الهوية.
 */
function createPendingStore(keygen = newIdempotencyKey) {
  const store = new Map();
  return {
    getOrCreate(kind, fingerprint) {
      const cur = store.get(kind);
      if (cur && cur.fingerprint === fingerprint) return cur.key;
      const key = keygen(kind);
      store.set(kind, { key, fingerprint });
      return key;
    },
    has(kind) { return store.has(kind); },
    keyOf(kind) { return store.get(kind)?.key ?? null; },
    fingerprint(kind) { return store.get(kind)?.fingerprint ?? null; },
    clear(kind) { store.delete(kind); },
    /** تصدير/استعادة لحفظ الهويات عبر إعادة تحميل الصفحة (لا مفاتيح جديدة لنفس العملية). */
    snapshot() { return [...store.entries()].map(([kind, v]) => [kind, v.key, v.fingerprint]); },
    restore(rows) {
      store.clear();
      for (const r of rows ?? []) {
        if (Array.isArray(r) && r.length === 3 && r.every((x) => typeof x === 'string')) store.set(r[0], { key: r[1], fingerprint: r[2] });
      }
    },
  };
}

/** قروش → نص حقل إدخال («89.95») بتفكيك صحيح دون عائم. */
function minorToInput(minor) {
  const n = Math.trunc(Number(minor));
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** تصنيف نتيجة HTTP لاتخاذ قرار الاحتفاظ بهوية العملية أو رميها. */
function classifyStatus(status) {
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'uncertain';
  if (status === 401) return 'unauthenticated';
  return 'definitive';
}

const METHOD_AR = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة إلكترونية', transfer: 'تحويل بنكي' };
const STOCK_AR = { in: 'متوفر', low: 'كمية أخيرة', out: 'غير متوفر' };
const CATEGORY_AR = { drinks: 'مشروبات', snacks: 'تسالي وحلويات', grocery: 'بقالة', deli: 'ألبان وأجبان' };
const ROLE_AR = {
  owner: 'مالك', admin: 'مدير عام', member: 'عضو', 'branch-manager': 'مدير فرع', cashier: 'كاشير',
  'inventory-manager': 'مدير مخزون', storekeeper: 'أمين مخزن', 'restaurant-manager': 'مدير مطعم',
  waiter: 'ويتر', kitchen: 'مطبخ', 'clinic-manager': 'مدير عيادة', reception: 'استقبال', doctor: 'طبيب',
  'hr-manager': 'مدير موارد بشرية', employee: 'موظف', 'courts-manager': 'مدير ملاعب', 'site-admin': 'مدير موقع',
};

function roleLabelAr(roleField) {
  return String(roleField ?? '')
    .split(',')
    .map((r) => ROLE_AR[r.trim()] ?? r.trim())
    .filter(Boolean)
    .join(' · ') || '—';
}

/** رسائل عربية إجرائية لأكواد أخطاء الخادم المعروفة (apps/api/src/http.ts). */
const ERROR_AR = {
  network_error: 'تعذّر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة — لم نفترض نتيجة العملية.',
  unauthenticated: 'انتهت الجلسة. سجّل الدخول مجددًا لتكمل.',
  forbidden: 'ليس لديك صلاحية لهذه العملية في حسابك الحالي.',
  validation_failed: 'بعض البيانات المُدخلة غير صالحة. راجع الخانات ثم أعد المحاولة.',
  insufficient_stock: 'الكمية المطلوبة غير متوفرة في المخزون الآن. قلّل الكمية أو حدّث الأصناف.',
  tender_mismatch: 'مجموع الدفعات لا يساوي إجمالي الفاتورة المحسوب من الخادم. حدّثنا الأصناف — راجع المبالغ ثم أعد المحاولة.',
  shift_required_for_cash: 'هذه العملية نقدية وتحتاج وردية مفتوحة. افتح وردية أولًا.',
  shift_not_found: 'الوردية المحددة غير موجودة. حدّث حالة الوردية.',
  shift_closed: 'الوردية مغلقة ولا يمكن البيع النقدي عليها. افتح وردية جديدة.',
  shift_already_open: 'توجد وردية مفتوحة أصلًا لهذا الجهاز. أغلقها أولًا إن أردت فتح غيرها.',
  shift_already_closed: 'الوردية مُغلقة بالفعل — عرضنا نتيجة إغلاقها المحفوظة.',
  unknown_item: 'أحد الأصناف لم يعد متاحًا للبيع. حدّث الأصناف وراجع السلة.',
  duplicate_sku: 'كود SKU مستخدم من قبل في هذا المحل. اختر كودًا مختلفًا.',
  version_conflict: 'بيانات هذا الصنف تغيّرت من مكان آخر أثناء التعديل. حدّثنا القائمة — راجع القيم الجديدة ثم أعد المحاولة.',
  item_not_found: 'هذا الصنف غير موجود (ربما في محل آخر أو حُذف). حدّث القائمة.',
  invalid_catalog: 'بيانات الصنف غير صالحة. راجع الحقول ثم أعد المحاولة.',
  idempotency_conflict: 'هوية هذه العملية استُخدمت لعملية مختلفة. راجع العملية ثم أعد تنفيذها من جديد.',
  refund_over_limit: 'مبلغ المرتجع يتجاوز المتبقّي القابل للاسترداد من هذه الدفعة.',
  refund_quantity_exceeded: 'كمية المرتجع تتجاوز ما تبقّى من الكمية المباعة في الفاتورة.',
  payment_not_found: 'الدفعة المختارة غير موجودة في هذه الفاتورة.',
  payment_mismatch: 'الدفعة المختارة لا تخص هذه الفاتورة.',
  invalid_amount: 'المبلغ المُدخل غير صالح.',
  invalid_tendered: 'المبلغ المستلم نقدًا غير صالح.',
  change_exceeds_tendered: 'المبلغ المستلم أقل من قيمة الدفعة النقدية.',
  change_only_cash: 'حقل «المستلم» يخص الدفع النقدي فقط.',
  invalid_date: 'التاريخ المُدخل غير صالح.',
  not_found: 'غير موجود في محلّك.',
};

function messageForError(err) {
  if (!err) return 'حدث خطأ غير متوقع.';
  if (err.code && ERROR_AR[err.code]) return ERROR_AR[err.code];
  if (err.status === 0) return ERROR_AR.network_error;
  if (err.status === 401) return ERROR_AR.unauthenticated;
  if (err.status === 403) return ERROR_AR.forbidden;
  if (typeof err.message === 'string' && err.message && !/^خطأ \d+$/.test(err.message)) return err.message;
  return `حدث خطأ (رمز ${err.status ?? '؟'}). أعد المحاولة، وإن تكرر راجع مدير النظام.`;
}

function todayCairo() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

const Pure = {
  normalizeDigits, parseMoneyToMinor, parseQtyMilli, milliToQtyString, fmtQtyString, fmtMinor, minorToInput,
  lineEstimateMinor, computeEstimate, fingerprintOf, newIdempotencyKey, createPendingStore,
  classifyStatus, messageForError, roleLabelAr, METHOD_AR, STOCK_AR, CATEGORY_AR, ERROR_AR, todayCairo,
};
if (typeof globalThis !== 'undefined') globalThis.NilePOSPure = Pure;

/* ── 2) طبقة المتصفح ────────────────────────────────────────────────────── */

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const $ = (id) => document.getElementById(id);

  function iconEl(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls ? `ic ${cls}` : 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, opts = {}, kids = []) {
    const n = document.createElement(tag);
    if (opts.class) n.className = opts.class;
    if (opts.text != null) n.textContent = String(opts.text);
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) { if (v != null && v !== false) n.setAttribute(k, v === true ? '' : String(v)); }
    if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) n.dataset[k] = String(v);
    for (const kid of [].concat(kids)) {
      if (kid == null) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || code || `خطأ ${status}`);
      this.status = status; this.code = code;
    }
  }

  let sessionExpiredHandler = null;

  async function api(method, url, body, opts = {}) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'network_error', '');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (typeof data?.error === 'string' ? data.error : data?.error?.code) ?? data?.code ?? null;
      const message = data?.message ?? (typeof data?.error === 'object' ? data.error?.message : null) ?? '';
      const err = new ApiError(res.status, code, message);
      if (res.status === 401 && !opts.silent401 && sessionExpiredHandler) sessionExpiredHandler();
      throw err;
    }
    return data;
  }

  /* ── الحالة ── */
  const pending = createPendingStore();
  let me = null;
  let perms = new Set();
  let catalog = [];
  let catalogLoadedAt = null;
  const byVariant = new Map(); // variantId -> { item, variant }
  const selectedVariant = new Map(); // itemId -> variantId
  let activeCategory = 'all';
  let searchTerm = '';
  const cart = new Map(); // variantId -> qtyMilli
  let shift = null; // { id, openingMinor, openedAt, expectedMinor }
  let lastSale = null; // SaleView (GET /sales/:id)
  let refundSale = null;
  let currentView = 'sale';
  let reportLoadedOnce = false;
  const inFlight = { checkout: false, shiftOpen: false, refund: false, close: false, catalogSave: false };
  let adminCatalog = []; // إدارة الأصناف: قائمة شاملة النشطة والموقوفة
  let adminCatalogLoaded = false;
  let editingItem = null; // { item } أثناء التعديل، null للصنف الجديد

  const canVoid = () => perms.has('sale:void');
  const canManageCatalog = () => perms.has('catalog:manage');
  const sessionStore = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  };

  /*
   * هويات العمليات المالية المعلّقة ومسودة الدفع (§6): تُحفظ في localStorage
   * مربوطةً بمعرف المستخدم — تعيش بعد إغلاق المتصفح وإعادة تشغيل الجهاز على
   * نفس الجهاز، ولا يرثها مستخدم آخر على نفس الجهاز. هي ليست مرجع الحقيقة:
   * عند الدخول تُصالَح مع الخادم (reconcilePending) فهو وحده الحَكَم.
   * المفاتيح v1 القديمة (sessionStorage) تُهاجَر مرة واحدة ثم تُزال.
   */
  const PENDING_KEY = 'nile-pos-pending-v1'; // legacy (migration source only)
  const CHECKOUT_DRAFT_KEY = 'nile-pos-checkout-draft-v1'; // legacy
  const durableStore = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  let pendingScope = null; // userId — يُضبط عند الدخول
  const pendingKeyFor = () => (pendingScope ? `nile-pos-pending-v2:${pendingScope}` : null);
  const draftKeyFor = () => (pendingScope ? `nile-pos-checkout-draft-v2:${pendingScope}` : null);
  function persistPending() { const k = pendingKeyFor(); if (k) durableStore.set(k, JSON.stringify(pending.snapshot())); }
  function loadCheckoutDraft() { const k = draftKeyFor(); if (!k) return null; try { return JSON.parse(durableStore.get(k) ?? 'null'); } catch { return null; } }
  function saveCheckoutDraft(d) { const k = draftKeyFor(); if (k) durableStore.set(k, d ? JSON.stringify(d) : null); }
  function loadPendingForUser(userId) {
    pendingScope = userId ?? null;
    if (!pendingScope) { pending.restore([]); return; }
    try {
      const legacyPending = sessionStore.get(PENDING_KEY);
      if (legacyPending && !durableStore.get(pendingKeyFor())) durableStore.set(pendingKeyFor(), legacyPending);
      const legacyDraft = sessionStore.get(CHECKOUT_DRAFT_KEY);
      if (legacyDraft && !durableStore.get(draftKeyFor())) durableStore.set(draftKeyFor(), legacyDraft);
      sessionStore.set(PENDING_KEY, null);
      sessionStore.set(CHECKOUT_DRAFT_KEY, null);
    } catch {}
    try { pending.restore(JSON.parse(durableStore.get(pendingKeyFor()) ?? '[]')); } catch { pending.restore([]); }
  }
  function cartLinesPayload() {
    return [...cart.entries()].map(([variantId, qtyMilli]) => ({ variantId, quantity: milliToQtyString(qtyMilli) }));
  }

  /* ── تنبيهات ومساعدات ── */
  function toast(text, type = 'info') {
    const box = $('toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    const t = el('div', { class: `toast${type === 'ok' ? ' is-ok' : type === 'bad' ? ' is-bad' : ''}` }, [
      iconEl(type === 'ok' ? 'check' : type === 'bad' ? 'alert' : 'info'),
      el('span', { text }),
    ]);
    box.appendChild(t);
    setTimeout(() => t.remove(), 4600);
  }

  const busyOriginals = new WeakMap();
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!busyOriginals.has(btn)) busyOriginals.set(btn, btn.innerHTML);
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      btn.replaceChildren(el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }), el('span', { text: label ?? 'جارٍ التنفيذ…' }));
    } else {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      /* محتوى الزر الأصلي قادم من HTML الساكن الخاص بنا لا من الخادم. */
      if (busyOriginals.has(btn)) btn.innerHTML = busyOriginals.get(btn);
    }
  }

  let confirmResolve = null;
  function confirmAction({ title, body, okLabel = 'تأكيد', danger = false }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $('confirmTitle').textContent = title;
      $('confirmBody').textContent = body;
      const ok = $('confirmOk');
      ok.textContent = okLabel;
      ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      $('confirmDialog').showModal();
      ok.focus();
    });
  }
  $('confirmOk').addEventListener('click', () => { $('confirmDialog').close(); confirmResolve?.(true); confirmResolve = null; });
  $('confirmCancel').addEventListener('click', () => { $('confirmDialog').close(); confirmResolve?.(false); confirmResolve = null; });
  $('confirmDialog').addEventListener('cancel', () => { confirmResolve?.(false); confirmResolve = null; });

  document.querySelectorAll('[data-close-dialog]').forEach((b) =>
    b.addEventListener('click', () => $(b.dataset.closeDialog)?.close()));

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
    } catch { return String(iso); }
  }
  /* عزل اتجاهي (FSI/PDI) حتى لا ينعكس ترتيب «الرمز…» داخل نص عربي. */
  const shortId = (id) => (id ? `\u2068${String(id).slice(0, 8).toUpperCase()}…\u2069` : '—');
  /* التركيز التلقائي على البحث لأجهزة لوحة المفاتيح فقط — على اللمس يفتح
     لوحة مفاتيح افتراضية تغطي الأصناف فور الدخول. */
  const finePointer = () => window.matchMedia('(pointer:fine)').matches;
  function focusSearch() { if (finePointer()) $('searchInput').focus({ preventScroll: true }); }
  const variantLabel = (item, v) => (v.labelAr && v.labelAr !== 'افتراضي' ? `${item.nameAr} — ${v.labelAr}` : item.nameAr);

  /* ── الجلسة ── */
  function showLogin(message) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('appView').hidden = true;
    $('loginView').hidden = false;
    const err = $('loginErr');
    if (message) { err.textContent = message; err.hidden = false; }
    $('email').focus();
  }

  sessionExpiredHandler = () => {
    if ($('appView').hidden) return;
    me = null; perms = new Set();
    showLogin('انتهت الجلسة — سجّل الدخول مجددًا. سلتك وورديتك محفوظتان وستكمل من حيث وقفت.');
    toast('انتهت الجلسة، سجّل الدخول مجددًا.', 'bad');
  };

  async function enterApp(meData) {
    me = meData;
    perms = new Set(meData.permissions ?? []);
    loadPendingForUser(meData.user?.id);
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('tenantName').textContent = meData.tenant?.name ?? 'محل';
    $('userName').textContent = meData.user?.name || meData.user?.email || '—';
    $('userRole').textContent = roleLabelAr(meData.role);
    $('navAdmin').hidden = !canVoid();
    $('navCatalog').hidden = !canManageCatalog();
    const today = todayCairo();
    $('reportFrom').value = today; $('reportTo').value = today;
    await loadCatalog().catch(() => {});
    restoreCart();
    await restoreShift().catch(() => {});
    renderCart(); renderShift();
    setView('sale');
    // مصالحة أي عملية مالية معلقة مع الخادم قبل أي بيع جديد (§6).
    await reconcilePending().catch(() => {});
  }

  /*
   * المصالحة المالية (§6): لأي عملية معلقة نسأل الخادم بهوية العملية نفسها.
   *  - محفوظة خادميًا ⇒ نسترجع نتيجتها (إيصال/مبلغ) ونغلق الملف محليًا.
   *  - غير موجودة خادميًا ⇒ يقين بأنها لم تُحفظ: إن أمكن إعادة بنائها
   *    (بنود المسودة) نبقيها قابلة لإعادة المحاولة بنفس الهوية، وإلا
   *    نتخلص منها بوعي كامل لا تخمينًا.
   *  - الخادم غير متاح ⇒ لا نمس شيئًا؛ تبقى الحالة معلقة كما هي.
   */
  async function reconcilePending() {
    if (pending.has('shift-open') && shift) { pending.clear('shift-open'); persistPending(); }

    if (pending.has('checkout')) {
      const key = pending.keyOf('checkout');
      let res = null;
      try { res = await api('GET', `/api/v1/checkout/reconcile?key=${encodeURIComponent(key)}`); } catch { return; }
      if (res.state === 'saved' && res.sale) {
        const draft = loadCheckoutDraft();
        pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
        if (draft && cart.size && fingerprintOf(cartLinesPayload()) === draft.linesFp) {
          cart.clear(); persistCart(); renderCart();
        }
        lastSale = res.sale;
        toast('وجدنا على الخادم فاتورة محفوظة لعملية دفع سابقة لم يصلك تأكيدها — هذه هي، ولم يتكرر أي بيع.', 'ok');
        showReceipt(res.sale, true);
        loadCatalog().catch(() => {});
        if (shift) refreshShiftExpected().catch(() => {});
      } else if (res.state === 'not_found') {
        const draft = loadCheckoutDraft();
        if (!cart.size && draft && Array.isArray(draft.lines) && draft.lines.length) {
          // أعد بناء السلة من بنود المحاولة الأولى لتظل إعادة المحاولة مطابقة.
          for (const l of draft.lines) {
            const milli = parseQtyMilli(l.quantity);
            if (milli !== null && byVariant.has(l.variantId)) cart.set(l.variantId, (cart.get(l.variantId) ?? 0) + milli);
          }
          persistCart(); renderCart();
          toast('توجد عملية دفع سابقة لم تُحفظ على الخادم. استعدنا سلتها كما كانت — راجعها ثم أكمل الدفع، وستُستكمل بنفس هوية العملية دون تكرار.', 'info');
        } else if (!cart.size) {
          // لا بنود قابلة للاسترجاع والخادم يؤكد عدم الحفظ: إغلاق واعٍ للملف.
          pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
          toast('تحققنا من الخادم: عملية دفع سابقة لم تُحفظ ولم تُخصم أي مبالغ. يمكنك بدء بيع جديد بأمان.', 'info');
        } else {
          toast('توجد عملية دفع سابقة لم تتأكد نتيجتها بعد (غير محفوظة على الخادم حتى الآن). أكملها من زر الدفع — لن يتكرر البيع.', 'info');
        }
      }
    }

    if (pending.has('refund') && canVoid()) {
      const key = pending.keyOf('refund');
      try {
        const res = await api('GET', `/api/v1/refunds/reconcile?key=${encodeURIComponent(key)}`);
        if (res.state === 'saved' && res.refund) {
          pending.clear('refund'); persistPending();
          toast(`وجدنا على الخادم مرتجعًا محفوظًا بمبلغ ${fmtMinor(res.refund.amountMinor)} ج.م لعملية سابقة لم يصلك تأكيدها.`, 'ok');
          loadCatalog().catch(() => {});
        }
      } catch { /* غير مؤكد بعد — يبقى معلقًا */ }
    }
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginErr'); err.hidden = true;
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || !password) { err.textContent = 'أدخل البريد الإلكتروني وكلمة المرور.'; err.hidden = false; return; }
    setBusy($('loginBtn'), true, 'جارٍ تسجيل الدخول…');
    try {
      await api('POST', '/api/auth/sign-in/email', { email, password }, { silent401: true });
      const meData = await api('GET', '/api/v1/me', null, { silent401: true });
      $('password').value = '';
      await enterApp(meData);
      toast(`أهلًا ${meData.user?.name ?? ''}`.trim(), 'ok');
    } catch (e2) {
      err.textContent = e2.status === 401 ? 'البريد أو كلمة المرور غير صحيحة.' : messageForError(e2);
      err.hidden = false;
      $('password').focus(); $('password').select();
    } finally { setBusy($('loginBtn'), false); }
  });

  $('logoutBtn').addEventListener('click', async () => {
    /*
     * عملية مالية معلقة لا تُمسح عند الخروج أبدًا (§6): تبقى محفوظة على هذا
     * الجهاز مرتبطةً بحسابك، وستُصالَح مع الخادم عند دخولك القادم. الخروج
     * مسموح لكن بعد تنبيه صريح — لا نجاح ولا فشل مفترض.
     */
    if (pending.has('checkout') || pending.has('refund')) {
      const go = await confirmAction({
        title: 'توجد عملية مالية غير مؤكدة',
        body: 'بدأت عملية دفع/مرتجع ولم نتأكد من نتيجتها على الخادم بعد. إن خرجت الآن ستبقى العملية محفوظة على هذا الجهاز لحسابك، وعند دخولك القادم سنتحقق من نتيجتها من الخادم تلقائيًا. الأفضل إكمالها الآن إن أمكن — لا تعتبرها ناجحة ولا فاشلة.',
        okLabel: 'خروج مع إبقاء العملية معلقة', danger: true,
      });
      if (!go) return;
    } else if (cart.size && !(await confirmAction({
      title: 'تسجيل الخروج؟',
      body: 'توجد أصناف في السلة لم تُبع بعد. الخروج سيفرّغ السلة من هذا الجهاز (الوردية المفتوحة تبقى مفتوحة بالخادم حتى تُغلق صراحةً — وستُسترجع تلقائيًا عند دخولك).',
      okLabel: 'خروج وتفريغ السلة', danger: true,
    }))) return;
    sessionStore.set('nile-pos-cart-v1', null);
    sessionStore.set('nile-pos-shift-v1', null);
    pendingScope = null;
    pending.restore([]);
    await api('POST', '/api/auth/sign-out', {}, { silent401: true }).catch(() => {});
    location.reload();
  });

  /* ── التنقل ── */
  function setView(name) {
    if (name === 'admin' && !canVoid()) name = 'sale';
    if (name === 'catalogAdmin' && !canManageCatalog()) name = 'sale';
    currentView = name;
    $('viewSale').hidden = name !== 'sale';
    $('viewShift').hidden = name !== 'shift';
    $('viewAdmin').hidden = name !== 'admin';
    $('viewCatalogAdmin').hidden = name !== 'catalogAdmin';
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'sale') { updateMobileBar(); focusSearch(); }
    else $('mobileCartBar').hidden = true;
    if (name === 'shift' && shift) refreshShiftExpected().catch(() => {});
    if (name === 'catalogAdmin' && !adminCatalogLoaded) loadAdminCatalog().catch(() => {});
    if (name === 'admin') {
      $('adminDenied').hidden = canVoid();
      $('adminBody').hidden = !canVoid();
      if (canVoid() && !reportLoadedOnce) loadReport().catch(() => {});
    }
  }
  document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('shiftChip').addEventListener('click', () => setView('shift'));
  $('cartGoShift').addEventListener('click', () => { closeCartSheet(); setView('shift'); });

  /* ── إدارة الأصناف (G-03) — كتابة/قراءة من الخادم، الصلاحية catalog:manage ── */
  async function loadAdminCatalog() {
    const msg = $('adminCatalogMsg');
    msg.textContent = '';
    try {
      const { items } = await api('GET', '/api/v1/catalog/items/admin');
      adminCatalog = items ?? [];
      adminCatalogLoaded = true;
      buildAdminCategoryFilter();
      renderAdminItems();
      return adminCatalog;
    } catch (e) {
      msg.textContent = `تعذّر تحميل قائمة الإدارة: ${messageForError(e)}`;
      msg.classList.add('is-error');
      throw e;
    }
  }

  function adminCategories() {
    return [...new Set([...catalog, ...adminCatalog].map((i) => i.category))].sort();
  }

  function buildAdminCategoryFilter() {
    const sel = $('adminCategory');
    const current = sel.value || 'all';
    sel.replaceChildren(
      el('option', { attrs: { value: 'all' }, text: 'كل الأقسام' }),
      ...adminCategories().map((c) => el('option', { attrs: { value: c }, text: CATEGORY_AR[c] ?? c })),
    );
    sel.value = [...sel.options].some((o) => o.value === current) ? current : 'all';
    $('categoryList').replaceChildren(...adminCategories().map((c) => el('option', { attrs: { value: c } })));
  }

  function renderAdminItems() {
    const q = ($('adminSearch').value ?? '').trim().toLowerCase();
    const cat = $('adminCategory').value || 'all';
    const showInactive = $('adminShowInactive').checked;
    const matches = (item) => {
      if (!item.isActive && !showInactive) return false;
      if (cat !== 'all' && item.category !== cat) return false;
      if (!q) return true;
      if (item.nameAr.includes(q) || item.nameEn.toLowerCase().includes(q)) return true;
      return item.variants.some((v) => v.sku.toLowerCase().includes(q) || v.labelAr.includes(q) || v.labelEn.toLowerCase().includes(q));
    };
    const visible = adminCatalog.filter(matches);
    $('adminCatalogEmpty').hidden = visible.length !== 0;
    $('adminCatalogMsg').textContent =
      `${visible.length} من ${adminCatalog.length} صنف${showInactive ? ' (شاملًا الموقوفة)' : ''}`;
    $('adminItemCards').replaceChildren(...visible.map(adminItemCard));
  }

  function adminItemCard(item) {
    const statusBadge = el('span', {
      class: `badge ${item.isActive ? 'badge-ok' : 'badge-off'}`,
      text: item.isActive ? 'نشط — يُباع' : 'موقوف — لا يُباع',
    });
    const priceLine = el('p', { class: 'admin-price' }, [
      el('b', { class: 'num', text: fmtMinor(item.priceMinor) }),
      ' ج.م',
      ...(item.compareAtMinor != null
        ? [el('span', { class: 'muted', text: ` · قبل: ` }), el('span', { class: 'num muted', text: fmtMinor(item.compareAtMinor) }), ' ج.م']
        : []),
    ]);
    const variantRows = item.variants.map((v) => el('tr', {}, [
      el('td', {}, [el('code', { class: 'code-ltr', text: v.sku })]),
      el('td', { text: v.labelAr }),
      el('td', { class: 'num', text: fmtQtyString(v.stock) }),
      el('td', { text: STOCK_AR[v.stockState] ?? v.stockState }),
    ]));
    const editBtn = el('button', { class: 'btn btn-secondary btn-sm', attrs: { type: 'button' } }, [iconEl('edit'), ' تعديل']);
    editBtn.addEventListener('click', () => openItemDialog(item));
    const addVariantBtn = el('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button' } }, [iconEl('plus'), ' متغير']);
    addVariantBtn.addEventListener('click', () => openItemDialog(item, true));
    const toggleBtn = el('button', { class: item.isActive ? 'btn btn-danger-ghost btn-sm' : 'btn btn-secondary btn-sm', attrs: { type: 'button' }, text: item.isActive ? 'إيقاف البيع' : 'تفعيل البيع' });
    toggleBtn.addEventListener('click', () => toggleItemActive(item, toggleBtn));
    return el('article', { class: `admin-item-card${item.isActive ? '' : ' is-inactive'}` }, [
      el('header', { class: 'admin-item-head' }, [
        el('div', {}, [
          el('h3', { text: item.nameAr }),
          el('p', { class: 'muted', text: `${item.nameEn} · ${CATEGORY_AR[item.category] ?? item.category}` }),
        ]),
        statusBadge,
      ]),
      priceLine,
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { attrs: { scope: 'col' }, text: 'SKU' }),
            el('th', { attrs: { scope: 'col' }, text: 'المتغير' }),
            el('th', { attrs: { scope: 'col' }, text: 'المخزون' }),
            el('th', { attrs: { scope: 'col' }, text: 'الحالة' }),
          ])]),
          el('tbody', {}, variantRows),
        ]),
      ]),
      el('div', { class: 'admin-item-actions' }, [editBtn, addVariantBtn, toggleBtn]),
    ]);
  }

  async function toggleItemActive(item, btn) {
    const next = !item.isActive;
    const ok = await confirmAction({
      title: next ? 'تفعيل بيع الصنف؟' : 'إيقاف بيع الصنف؟',
      body: next
        ? `«${item.nameAr}» سيظهر مجددًا في شاشة البيع ويُباع بالسعر الحالي ${fmtMinor(item.priceMinor)} ج.م.`
        : `«${item.nameAr}» سيختفي فورًا من شاشة البيع ويرفض الخادم أي محاولة بيع له. الفواتير السابقة لا تتأثر، ويمكن إعادة تفعيله في أي وقت.`,
      okLabel: next ? 'تفعيل' : 'إيقاف البيع',
      danger: !next,
    });
    if (!ok) return;
    setBusy(btn, true, 'جارٍ الحفظ…');
    try {
      const { item: updated } = await api('PATCH', `/api/v1/catalog/items/${item.id}`, { isActive: next, expectedVersion: item.version });
      replaceAdminItem(updated);
      await syncSellingCatalog(true);
      toast(next ? `فُعِّل «${updated.nameAr}» للبيع.` : `أُوقف بيع «${updated.nameAr}».`, 'ok');
    } catch (e) {
      toast(messageForError(e), 'bad');
      if (e.code === 'version_conflict') loadAdminCatalog().catch(() => {});
    } finally { setBusy(btn, false); }
  }

  function replaceAdminItem(updated) {
    const ix = adminCatalog.findIndex((i) => i.id === updated.id);
    if (ix >= 0) adminCatalog[ix] = updated; else adminCatalog.unshift(updated);
    buildAdminCategoryFilter();
    renderAdminItems();
  }

  /** يعكس تغييرات الإدارة على شاشة البيع + تنبيه لو تأثرت السلة الحالية. */
  async function syncSellingCatalog(warnCart) {
    const before = new Map([...cart.keys()].map((vid) => [vid, byVariant.get(vid)?.item.priceMinor]));
    await loadCatalog().catch(() => {});
    if (!warnCart) return;
    for (const [vid, oldPrice] of before) {
      const now = byVariant.get(vid);
      if (!now || now.item.priceMinor !== oldPrice) {
        toast('تغيّر سعر/توافر صنف في السلة الحالية بعد تحديث الكتالوج — راجع السلة قبل الدفع (السعر النهائي دائمًا من الخادم).', 'info');
        return;
      }
    }
  }

  function variantRowEl(v) {
    const persisted = Boolean(v?.id);
    const row = el('div', { class: 'variant-row' });
    row.dataset.variantId = v?.id ?? '';
    row.dataset.variantVersion = String(v?.version ?? '');
    const sku = el('input', { class: 'vr-sku', attrs: { type: 'text', dir: 'ltr', maxlength: '64', placeholder: 'SKU *', 'aria-label': 'كود SKU' } });
    sku.value = v?.sku ?? '';
    const labelAr = el('input', { class: 'vr-label-ar', attrs: { type: 'text', maxlength: '80', placeholder: 'الوصف عربي *', 'aria-label': 'وصف المتغير بالعربية' } });
    labelAr.value = v?.labelAr ?? '';
    const labelEn = el('input', { class: 'vr-label-en', attrs: { type: 'text', dir: 'ltr', maxlength: '80', placeholder: 'Label (EN) *', 'aria-label': 'وصف المتغير بالإنجليزية' } });
    labelEn.value = v?.labelEn ?? '';
    const stock = el('input', { class: 'vr-stock num-input', attrs: { type: 'text', inputmode: 'decimal', dir: 'ltr', placeholder: persisted ? '—' : 'رصيد البداية', 'aria-label': 'رصيد البداية' } });
    stock.value = persisted ? fmtQtyString(v.stock) : '';
    stock.disabled = persisted; // الرصيد لا يُحرَّر هنا بعد الإنشاء (حركة مخزون بدلًا منه)
    if (persisted) stock.title = 'الرصيد الحالي — لا يُعدَّل من هنا (تصحيحه بحركة مخزون)';
    row.append(sku, labelAr, labelEn, stock);
    if (!persisted) {
      const remove = el('button', { class: 'btn btn-icon', attrs: { type: 'button', 'aria-label': 'حذف هذا المتغير الجديد' } }, [iconEl('trash')]);
      remove.addEventListener('click', () => row.remove());
      row.appendChild(remove);
    }
    return row;
  }

  function openItemDialog(item, focusNewVariant = false) {
    editingItem = item ?? null;
    $('itemDialogTitle').replaceChildren(iconEl('box'), document.createTextNode(item ? ` تعديل «${item.nameAr}»` : ' صنف جديد'));
    $('itemNameAr').value = item?.nameAr ?? '';
    $('itemNameEn').value = item?.nameEn ?? '';
    $('itemCategory').value = item?.category ?? '';
    $('itemPrice').value = item ? minorToInput(item.priceMinor) : '';
    $('itemCompareAt').value = item?.compareAtMinor != null ? minorToInput(item.compareAtMinor) : '';
    $('itemActiveField').hidden = !item;
    $('itemActive').checked = item?.isActive ?? true;
    $('itemSaveBtn').lastChild.textContent = item ? ' حفظ التعديلات' : ' حفظ الصنف';
    const rows = $('itemVariantRows');
    rows.replaceChildren(...(item?.variants ?? []).map(variantRowEl));
    if (!item?.variants?.length || focusNewVariant) rows.appendChild(variantRowEl(null));
    buildAdminCategoryFilter();
    $('itemErr').hidden = true;
    if (!$('itemDialog').open) $('itemDialog').showModal();
    (focusNewVariant ? rows.lastElementChild?.querySelector('.vr-sku') : $('itemNameAr'))?.focus();
  }

  $('newItemBtn')?.addEventListener('click', () => openItemDialog(null));
  $('addVariantRowBtn')?.addEventListener('click', () => $('itemVariantRows').appendChild(variantRowEl(null)));
  $('adminSearch').addEventListener('input', renderAdminItems);
  $('adminCategory').addEventListener('change', renderAdminItems);
  $('adminShowInactive').addEventListener('change', renderAdminItems);
  $('adminRefresh').addEventListener('click', () => loadAdminCatalog().then(() => toast('تم تحديث قائمة الأصناف.', 'ok')).catch(() => {}));

  function readVariantRow(row, needStock) {
    const sku = row.querySelector('.vr-sku').value.trim();
    const labelAr = row.querySelector('.vr-label-ar').value.trim();
    const labelEn = row.querySelector('.vr-label-en').value.trim();
    const stockRaw = row.querySelector('.vr-stock').value.trim();
    if (!sku || /\s/.test(sku) || !labelAr || !labelEn) return { error: 'كل متغير يحتاج كود SKU (دون مسافات) ووصفًا بالعربية والإنجليزية.' };
    const out = { sku, labelAr, labelEn };
    if (needStock) {
      const milli = parseQtyMilli(stockRaw === '' ? '0' : stockRaw);
      if (milli === null || milli < 0) return { error: 'رصيد البداية يجب أن يكون رقمًا عشريًا صالحًا (حتى 3 خانات عشرية).' };
      out.stock = milliToQtyString(milli);
    }
    return out;
  }

  $('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight.catalogSave) return;
    const err = $('itemErr'); err.hidden = true;
    const showErr = (text) => { err.textContent = text; err.hidden = false; };
    const nameAr = $('itemNameAr').value.trim();
    const nameEn = $('itemNameEn').value.trim();
    const category = $('itemCategory').value.trim();
    const priceMinor = parseMoneyToMinor($('itemPrice').value);
    const compareRaw = $('itemCompareAt').value.trim();
    const compareAtMinor = compareRaw === '' ? null : parseMoneyToMinor(compareRaw);
    if (!nameAr || !nameEn) return showErr('اسم الصنف بالعربية والإنجليزية مطلوب.');
    if (!category) return showErr('القسم مطلوب (مثال: drinks أو مشروبات).');
    if (priceMinor === null || priceMinor < 1) return showErr('سعر البيع يجب أن يكون مبلغًا صحيحًا أكبر من صفر.');
    if (compareAtMinor !== null && (compareAtMinor === null || compareAtMinor < priceMinor)) return showErr('سعر «قبل» يجب أن يساوي سعر البيع أو يزيد عنه.');
    const rows = [...$('itemVariantRows').children];
    const persisted = [];
    const fresh = [];
    for (const row of rows) {
      const isPersisted = Boolean(row.dataset.variantId);
      const v = readVariantRow(row, !isPersisted);
      if (v.error) return showErr(v.error);
      (isPersisted ? persisted : fresh).push({ ...v, id: row.dataset.variantId, version: Number(row.dataset.variantVersion) });
    }
    if (!persisted.length && !fresh.length) return showErr('أضف متغيرًا واحدًا على الأقل (SKU) للصنف.');

    inFlight.catalogSave = true;
    setBusy($('itemSaveBtn'), true, 'جارٍ الحفظ…');
    try {
      if (!editingItem) {
        const { item } = await api('POST', '/api/v1/catalog/items', {
          nameAr, nameEn, category, priceMinor, compareAtMinor,
          variants: fresh.map(({ sku, labelAr, labelEn, stock }) => ({ sku, labelAr, labelEn, stock })),
        });
        replaceAdminItem(item);
        await syncSellingCatalog(false);
        toast(`أُضيف «${item.nameAr}» وأصبح متاحًا للبيع.`, 'ok');
      } else {
        let item = editingItem;
        const itemPatch = {};
        if (nameAr !== item.nameAr) itemPatch.nameAr = nameAr;
        if (nameEn !== item.nameEn) itemPatch.nameEn = nameEn;
        if (category !== item.category) itemPatch.category = category;
        if (priceMinor !== item.priceMinor) itemPatch.priceMinor = priceMinor;
        if (compareAtMinor !== item.compareAtMinor) itemPatch.compareAtMinor = compareAtMinor;
        if ($('itemActive').checked !== item.isActive) itemPatch.isActive = $('itemActive').checked;
        if (Object.keys(itemPatch).length) {
          item = (await api('PATCH', `/api/v1/catalog/items/${item.id}`, { ...itemPatch, expectedVersion: item.version })).item;
        }
        for (const v of persisted) {
          const orig = editingItem.variants.find((x) => x.id === v.id);
          const patch = {};
          if (v.sku !== orig.sku) patch.sku = v.sku;
          if (v.labelAr !== orig.labelAr) patch.labelAr = v.labelAr;
          if (v.labelEn !== orig.labelEn) patch.labelEn = v.labelEn;
          if (Object.keys(patch).length) {
            item = (await api('PATCH', `/api/v1/catalog/variants/${v.id}`, { ...patch, expectedVersion: v.version })).item;
          }
        }
        for (const v of fresh) {
          item = (await api('POST', `/api/v1/catalog/items/${item.id}/variants`, { sku: v.sku, labelAr: v.labelAr, labelEn: v.labelEn, stock: v.stock })).item;
        }
        replaceAdminItem(item);
        await syncSellingCatalog(true);
        toast(`حُفظت تعديلات «${item.nameAr}».`, 'ok');
      }
      $('itemDialog').close();
    } catch (e2) {
      showErr(e2.code === 'validation_failed' ? 'بعض البيانات المُدخلة غير صالحة. راجع الخانات ثم أعد المحاولة.' : messageForError(e2));
      /* تضارب نسخة/فشل جزئي: أعد جلب حقيقة الخادم وحدّث كائن التعديل لئلا تُبنى المحاولة التالية على نسخ قديمة. */
      if (['version_conflict', 'duplicate_sku'].includes(e2.code) || editingItem) {
        loadAdminCatalog().then((items) => {
          if (editingItem) {
            const freshItem = items.find((i) => i.id === editingItem.id);
            if (freshItem && $('itemDialog').open) editingItem = freshItem;
          }
        }).catch(() => {});
      }
    } finally {
      inFlight.catalogSave = false;
      setBusy($('itemSaveBtn'), false);
    }
  });

  /* ── الكتالوج ── */
  async function loadCatalog() {
    const first = !catalogLoadedAt;
    if (first) $('catalogSkeleton').hidden = false;
    $('catalogEmpty').hidden = true;
    try {
      const { items } = await api('GET', '/api/v1/catalog/items');
      catalog = items ?? [];
      catalogLoadedAt = new Date();
      byVariant.clear();
      for (const item of catalog) {
        for (const v of item.variants) byVariant.set(v.id, { item, variant: v });
        if (!selectedVariant.has(item.id) || !item.variants.some((v) => v.id === selectedVariant.get(item.id))) {
          selectedVariant.set(item.id, (item.variants.find((v) => v.stockState !== 'out') ?? item.variants[0])?.id);
        }
      }
      buildCategoryChips();
      renderItems();
      renderCart();
      const time = catalogLoadedAt.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
      $('catalogStatus').textContent = `${catalog.length} صنفًا · الأسعار محدّثة ${time}`;
    } catch (e) {
      $('catalogSkeleton').hidden = true;
      $('catalog').replaceChildren();
      $('catalogEmpty').hidden = false;
      $('catalogEmptyText').textContent = `تعذّر تحميل الأصناف: ${messageForError(e)}`;
      $('catalogStatus').textContent = '';
      throw e;
    } finally { $('catalogSkeleton').hidden = true; }
  }
  $('catalogRefresh').addEventListener('click', () => loadCatalog().then(() => toast('تم تحديث الأصناف والأسعار.', 'ok')).catch(() => {}));
  $('catalogRetry').addEventListener('click', () => loadCatalog().catch(() => {}));

  function buildCategoryChips() {
    const cats = ['all', ...new Set(catalog.map((i) => i.category))];
    if (!cats.includes(activeCategory)) activeCategory = 'all';
    $('catChips').replaceChildren(...cats.map((c) => {
      const b = el('button', {
        class: 'chip', attrs: { type: 'button', 'aria-pressed': String(activeCategory === c) },
        text: c === 'all' ? 'كل الأصناف' : (CATEGORY_AR[c] ?? c),
      });
      b.addEventListener('click', () => { activeCategory = c; buildCategoryChips(); renderItems(); });
      return b;
    }));
  }

  function filteredItems() {
    const q = normalizeDigits(searchTerm).toLowerCase();
    return catalog.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (!q) return true;
      const hay = [item.nameAr, item.nameEn, item.category, CATEGORY_AR[item.category] ?? '',
        ...item.variants.flatMap((v) => [v.labelAr, v.labelEn, v.sku])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderItems() {
    const items = filteredItems();
    $('catalog').replaceChildren(...items.map(renderItemCard));
    const empty = items.length === 0 && catalogLoadedAt;
    $('catalogEmpty').hidden = !empty;
    if (empty) {
      $('catalogEmptyText').textContent = catalog.length === 0
        ? 'لا توجد أصناف مفعّلة في محلّك بعد. إضافة الأصناف تُدار حاليًا من إدارة النظام.'
        : 'لا توجد أصناف مطابقة للبحث أو القسم الحالي.';
      $('catalogRetry').textContent = catalog.length === 0 ? 'إعادة التحميل' : 'مسح التصفية';
      $('catalogRetry').onclick = catalog.length === 0
        ? () => loadCatalog().catch(() => {})
        : () => { searchTerm = ''; $('searchInput').value = ''; activeCategory = 'all'; buildCategoryChips(); renderItems(); };
    }
  }

  function renderItemCard(item) {
    const selId = selectedVariant.get(item.id);
    const variant = item.variants.find((v) => v.id === selId) ?? item.variants[0];
    const inCartMilli = variant ? (cart.get(variant.id) ?? 0) : 0;
    const anyOut = item.variants.every((v) => v.stockState === 'out');

    const titleRow = el('div', { class: 'item-top' }, [
      el('div', {}, [
        el('p', { class: 'item-name', text: item.nameAr }),
        el('span', { class: 'item-cat', text: CATEGORY_AR[item.category] ?? item.category }),
      ]),
    ]);
    if (inCartMilli > 0) titleRow.appendChild(el('span', { class: 'in-cart-badge num', attrs: { 'aria-label': `في السلة ${milliToQtyString(inCartMilli)}` }, text: milliToQtyString(inCartMilli) }));

    const priceRow = el('div', {}, [
      el('span', { class: 'item-price num', text: `${fmtMinor(item.priceMinor)} ج.م` }),
      item.compareAtMinor && item.compareAtMinor > item.priceMinor
        ? el('span', { class: 'item-compare num', text: `${fmtMinor(item.compareAtMinor)} ج.م` }) : null,
    ]);

    const card = el('article', { class: `item-card${anyOut ? ' is-out' : ''}` }, [titleRow, priceRow]);

    if (item.variants.length > 1) {
      const row = el('div', { class: 'variant-row' });
      for (const v of item.variants) {
        const chip = el('button', {
          class: 'variant-chip',
          attrs: { type: 'button', 'aria-pressed': String(v.id === variant?.id), disabled: v.stockState === 'out' },
          text: v.labelAr,
        });
        chip.addEventListener('click', () => { selectedVariant.set(item.id, v.id); renderItems(); });
        row.appendChild(chip);
      }
      card.appendChild(row);
    }

    if (variant) {
      const dot = el('span', { class: `stock-dot${variant.stockState === 'low' ? ' low' : variant.stockState === 'out' ? ' out' : ''}`, attrs: { 'aria-hidden': 'true' } });
      card.appendChild(el('p', { class: 'stock-line' }, [
        dot,
        el('span', { text: `${STOCK_AR[variant.stockState] ?? variant.stockState} · المتاح ` }),
        el('b', { class: 'num', text: fmtQtyString(variant.stock) }),
      ]));
      card.appendChild(el('p', { class: 'sku-line', attrs: { dir: 'ltr' }, text: variant.sku }));
    }

    const addBtn = el('button', {
      class: 'btn btn-primary item-add',
      attrs: { type: 'button', disabled: !variant || variant.stockState === 'out', 'aria-label': variant ? `إضافة ${variantLabel(item, variant)} إلى السلة` : '' },
    }, [
      iconEl('plus'),
      el('span', { text: !variant || variant.stockState === 'out' ? 'غير متوفر' : 'إضافة' }),
    ]);
    addBtn.addEventListener('click', () => { if (variant) addToCart(variant.id, 1000); });
    card.appendChild(addBtn);
    return card;
  }

  /* ── السلة ── */
  function persistCart() {
    sessionStore.set('nile-pos-cart-v1', JSON.stringify([...cart.entries()]));
  }
  function restoreCart() {
    cart.clear();
    try {
      const raw = JSON.parse(sessionStore.get('nile-pos-cart-v1') ?? '[]');
      for (const [vid, milli] of raw) {
        if (byVariant.has(vid) && Number.isSafeInteger(milli) && milli > 0) cart.set(vid, milli);
      }
    } catch {}
  }

  function stockMilliOf(variant) { return parseQtyMilli(variant.stock); }

  function addToCart(variantId, milli) {
    const found = byVariant.get(variantId);
    if (!found) return;
    const { item, variant } = found;
    if (variant.stockState === 'out') { toast(`«${variantLabel(item, variant)}» غير متوفر حاليًا.`, 'bad'); return; }
    const next = (cart.get(variantId) ?? 0) + milli;
    const avail = stockMilliOf(variant);
    if (avail !== null && next > avail) { toast(`المتاح من «${variantLabel(item, variant)}» هو ${fmtQtyString(variant.stock)} فقط.`, 'bad'); return; }
    cart.set(variantId, next);
    persistCart(); renderCart(); renderItems();
  }

  function setQty(variantId, milli) {
    if (milli <= 0) cart.delete(variantId); else cart.set(variantId, milli);
    persistCart(); renderCart(); renderItems();
  }

  function cartEstimate() {
    const lines = [...cart.entries()].map(([vid, qtyMilli]) => {
      const f = byVariant.get(vid);
      return { variantId: vid, qtyMilli, priceMinor: f?.item.priceMinor ?? 0, found: f };
    });
    return computeEstimate(lines);
  }

  function renderCart() {
    const est = cartEstimate();
    const wrap = $('cartLines');
    wrap.replaceChildren(...est.lines.filter((l) => l.found).map((l) => renderCartLine(l)));
    $('cartEmpty').hidden = cart.size > 0;
    wrap.hidden = cart.size === 0;
    $('clearCartBtn').hidden = cart.size === 0;
    $('cartCount').textContent = String(cart.size);
    $('sumLines').textContent = String(cart.size);
    $('sumTotal').textContent = fmtMinor(est.totalMinor);
    $('openCheckoutBtn').disabled = cart.size === 0;
    $('cartShiftWarn').hidden = !(cart.size > 0 && !shift);
    updateMobileBar(est.totalMinor);
  }

  function updateMobileBar(totalMinor) {
    const total = totalMinor ?? cartEstimate().totalMinor;
    $('mcbCount').textContent = String(cart.size);
    $('mcbTotal').textContent = fmtMinor(total);
    $('mobileCartBar').hidden = !(currentView === 'sale' && cart.size > 0);
  }

  function renderCartLine(l) {
    const { item, variant } = l.found;
    const qtyInput = el('input', {
      class: 'qty-input num',
      attrs: {
        type: 'text', inputmode: 'decimal', dir: 'ltr', value: milliToQtyString(l.qtyMilli),
        'aria-label': `كمية ${variantLabel(item, variant)} (يمكن إدخال وزن مثل 0.25)`,
      },
    });
    qtyInput.addEventListener('change', () => {
      const milli = parseQtyMilli(qtyInput.value);
      if (milli === null) {
        qtyInput.setAttribute('aria-invalid', 'true');
        toast('أدخل كمية صحيحة (مثال: 2 أو 0.25).', 'bad');
        qtyInput.value = milliToQtyString(l.qtyMilli); qtyInput.removeAttribute('aria-invalid'); qtyInput.focus();
        return;
      }
      const avail = stockMilliOf(variant);
      if (avail !== null && milli > avail) { toast(`المتاح هو ${fmtQtyString(variant.stock)} فقط.`); qtyInput.value = milliToQtyString(l.qtyMilli); return; }
      setQty(l.variantId, milli);
    });
    qtyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qtyInput.blur(); } });

    const step = l.qtyMilli % 1000 === 0 ? 1000 : 250;
    const decBtn = el('button', { class: 'qty-btn', attrs: { type: 'button', 'aria-label': `تقليل كمية ${variantLabel(item, variant)}` } }, [iconEl('minus')]);
    decBtn.addEventListener('click', () => setQty(l.variantId, l.qtyMilli - step));
    const incBtn = el('button', { class: 'qty-btn', attrs: { type: 'button', 'aria-label': `زيادة كمية ${variantLabel(item, variant)}` } }, [iconEl('plus')]);
    incBtn.addEventListener('click', () => addToCart(l.variantId, step));
    const rmBtn = el('button', { class: 'btn btn-icon cart-line-remove', attrs: { type: 'button', 'aria-label': `حذف ${variantLabel(item, variant)} من السلة` } }, [iconEl('trash')]);
    rmBtn.addEventListener('click', () => setQty(l.variantId, 0));

    return el('div', { class: 'cart-line' }, [
      el('div', { class: 'cart-line-main' }, [
        el('div', {}, [
          el('div', { class: 'cart-line-name', text: variantLabel(item, variant) }),
          el('div', { class: 'cart-line-meta num', text: `${fmtMinor(item.priceMinor)} ج.م / للوحدة` }),
        ]),
        el('div', { class: 'cart-line-total num', text: `${fmtMinor(l.lineMinor)} ج.م` }),
      ]),
      el('div', { class: 'qty-row' }, [decBtn, qtyInput, incBtn, el('span', { class: 'qty-unit', text: 'الكمية' }), rmBtn]),
    ]);
  }

  $('clearCartBtn').addEventListener('click', async () => {
    if (!(await confirmAction({ title: 'تفريغ السلة؟', body: 'سيُحذف كل ما في السلة الحالية. البيع المحفوظ سابقًا لا يتأثر.', okLabel: 'تفريغ', danger: true }))) return;
    cart.clear(); persistCart(); renderCart(); renderItems(); closeCartSheet();
    $('searchInput').focus();
  });

  /* بحث + مسح SKU (قارئ يعمل كلوحة مفاتيح: يكتب الكود ثم Enter) */
  let searchTimer = null;
  $('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    $('searchClear').hidden = !searchTerm;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderItems, 120);
  });
  $('searchClear').addEventListener('click', () => {
    searchTerm = ''; $('searchInput').value = ''; $('searchClear').hidden = true; renderItems(); $('searchInput').focus();
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = normalizeDigits(searchTerm).trim().toLowerCase();
    if (!code) return;
    for (const [vid, f] of byVariant) {
      if (f.variant.sku.toLowerCase() === code) {
        addToCart(vid, 1000);
        searchTerm = ''; e.target.value = ''; $('searchClear').hidden = true; renderItems();
        return;
      }
    }
    const items = filteredItems();
    if (items.length === 1) {
      const item = items[0];
      const v = item.variants.find((x) => x.id === selectedVariant.get(item.id)) ?? item.variants.find((x) => x.stockState !== 'out');
      if (v) addToCart(v.id, 1000);
    } else {
      toast(`لا يوجد صنف بالكود «${searchTerm.trim()}».`, 'bad');
    }
  });

  /* سلة الجوال (درج سفلي) */
  function openCartSheet() { $('cartPane').classList.add('is-open'); $('cartScrim').hidden = false; }
  function closeCartSheet() { $('cartPane').classList.remove('is-open'); $('cartScrim').hidden = true; }
  $('mobileCartBar').addEventListener('click', openCartSheet);
  $('closeCartSheet').addEventListener('click', closeCartSheet);
  $('cartScrim').addEventListener('click', closeCartSheet);
  window.addEventListener('resize', () => { if (window.innerWidth > 1024) closeCartSheet(); });

  /* ── الدفع ── */
  const METHODS = [
    { code: 'cash', label: 'نقدي', icon: 'cash' },
    { code: 'card', label: 'بطاقة', icon: 'card' },
    { code: 'wallet', label: 'محفظة', icon: 'wallet' },
    { code: 'transfer', label: 'تحويل', icon: 'transfer' },
  ];
  let tenderSeq = 0;

  function readTenderRows() {
    return [...document.querySelectorAll('#tenderRows .tender-row')].map((row) => ({
      row,
      method: row.dataset.method,
      amountStr: row.querySelector('.tender-amount')?.value ?? '',
      tenderedStr: row.querySelector('.tender-tendered')?.value ?? '',
      amountMinor: parseMoneyToMinor(row.querySelector('.tender-amount')?.value ?? ''),
      tenderedMinor: parseMoneyToMinor(row.querySelector('.tender-tendered')?.value ?? ''),
    }));
  }

  function buildTenderRow(method = 'cash', amountMinor = null, tenderedMinor = null) {
    tenderSeq += 1;
    const uid = `t${tenderSeq}`;
    const row = el('div', { class: 'tender-row', dataset: { method } });

    const removeBtn = el('button', { class: 'btn btn-icon tender-remove', attrs: { type: 'button', 'aria-label': 'حذف هذه الدفعة' } }, [iconEl('close')]);
    removeBtn.addEventListener('click', () => { row.remove(); refreshTenderHeads(); recalcTenders(); });
    row.appendChild(el('div', { class: 'tender-row-head' }, [el('b', { class: 'tender-title', text: 'دفعة' }), removeBtn]));

    const seg = el('div', { class: 'method-seg', attrs: { role: 'group', 'aria-label': 'طريقة الدفع لهذه الدفعة' } });
    for (const m of METHODS) {
      const b = el('button', { class: 'method-btn', attrs: { type: 'button', 'aria-pressed': String(m.code === method) } }, [iconEl(m.icon), el('span', { text: m.label })]);
      b.addEventListener('click', () => {
        row.dataset.method = m.code;
        seg.querySelectorAll('.method-btn').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        row.querySelector('.tendered-wrap').hidden = m.code !== 'cash';
        row.querySelector('.quick-cash').hidden = m.code !== 'cash';
        recalcTenders();
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);

    const amountInput = el('input', {
      class: 'tender-amount num', attrs: { id: `${uid}-amt`, type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', value: amountMinor != null ? minorToInput(amountMinor) : '' },
    });
    const tenderedInput = el('input', {
      class: 'tender-tendered num', attrs: { id: `${uid}-ten`, type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', placeholder: 'اتركه فارغًا = المبلغ نفسه', value: tenderedMinor != null ? minorToInput(tenderedMinor) : '' },
    });
    amountInput.addEventListener('input', recalcTenders);
    tenderedInput.addEventListener('input', recalcTenders);

    const tenderedWrap = el('div', { class: 'field tendered-wrap' }, [el('label', { attrs: { for: `${uid}-ten` }, text: 'المستلم نقدًا (ج.م)' }), tenderedInput]);
    tenderedWrap.hidden = method !== 'cash';
    row.appendChild(el('div', { class: 'tender-amounts' }, [
      el('div', { class: 'field' }, [el('label', { attrs: { for: `${uid}-amt` }, text: 'قيمة الدفعة (ج.م)' }), amountInput]),
      tenderedWrap,
    ]));

    const quick = el('div', { class: 'quick-cash' });
    quick.hidden = method !== 'cash';
    for (const q of [[null, 'بالضبط'], [50, '50'], [100, '100'], [200, '200'], [500, '500']]) {
      const chip = el('button', { class: 'chip num', attrs: { type: 'button' }, text: q[1] });
      chip.addEventListener('click', () => {
        const amt = parseMoneyToMinor(amountInput.value);
        tenderedInput.value = q[0] === null ? (amt !== null ? minorToInput(amt) : '') : q[0].toFixed(2);
        recalcTenders();
      });
      quick.appendChild(chip);
    }
    row.appendChild(quick);
    return row;
  }

  function refreshTenderHeads() {
    const rows = [...document.querySelectorAll('#tenderRows .tender-row')];
    rows.forEach((r, i) => {
      r.querySelector('.tender-title').textContent = rows.length > 1 ? `دفعة ${i + 1}` : 'دفعة واحدة';
      r.querySelector('.tender-remove').hidden = rows.length <= 1;
    });
    $('addTenderBtn').disabled = rows.length >= 10;
  }

  function recalcTenders() {
    const estTotal = cartEstimate().totalMinor;
    const rows = readTenderRows();
    const paid = rows.reduce((s, r) => s + (r.amountMinor ?? 0), 0);
    const remaining = estTotal - paid;
    const change = rows.reduce((s, r) => (r.method === 'cash' && r.tenderedMinor !== null && r.amountMinor !== null ? s + Math.max(0, r.tenderedMinor - r.amountMinor) : s), 0);
    const bal = document.querySelector('.tender-balance');
    const remText = $('tenderRemainingText');
    bal.classList.toggle('is-ok', remaining === 0 && paid > 0);
    bal.classList.toggle('is-short', remaining !== 0);
    remText.replaceChildren(
      document.createTextNode(remaining >= 0 ? 'المتبقي للدفع: ' : 'يزيد عن الإجمالي بـ: '),
      el('b', { class: 'num' }, [el('span', { attrs: { id: 'tenderRemaining' }, text: fmtMinor(Math.abs(remaining)) }), document.createTextNode(' ج.م')]),
    );
    $('tenderChangeText').hidden = !(change > 0);
    $('tenderChange').textContent = fmtMinor(change);
    const hasCash = rows.some((r) => r.method === 'cash');
    $('checkoutShiftWarn').hidden = !(hasCash && !shift);
  }

  let checkoutLocked = false;
  function setCheckoutLocked(v) {
    checkoutLocked = v;
    /* القفل يشمل قائمة «طريقة الدفع» نفسها — تغييرها يغيّر حمولة إعادة المحاولة. */
    document.querySelectorAll('#tenderRows input, #tenderRows button, #tenderRows select').forEach((n) => { n.disabled = v; });
    $('addTenderBtn').disabled = v;
    if (!v) refreshTenderHeads();
    $('discardPendingBtn').hidden = !v;
    $('checkoutUncertain').hidden = !v;
  }

  async function openCheckout() {
    if (!cart.size) return;
    // مصالحة فورية قبل فتح الدفع: ربما حُفظت المحاولة المعلقة خادميًا أثناء
    // بقاء الشاشة مفتوحة — عندها يعرض reconcilePending الإيصال وينتهي الأمر.
    if (pending.has('checkout')) {
      await reconcilePending().catch(() => {});
      if (!pending.has('checkout') && !cart.size) return; // صُولحت وفُرّغت السلة
    }
    closeCartSheet();
    const est = cartEstimate();
    $('checkoutTotal').textContent = fmtMinor(est.totalMinor);
    $('checkoutLinesInfo').textContent = `(${cart.size} بند)`;
    $('checkoutErr').hidden = true;

    /*
     * حماية العملية المعلّقة: إن وُجدت محاولة بيع لم تتأكد نتيجتها:
     * - نفس بنود السلة ⇒ نسترجع نفس الدفعات حرفيًا ونقفل تحريرها (إعادة
     *   المحاولة تولّد نفس البصمة ⇒ نفس المفتاح ⇒ الخادم يعيد الفاتورة نفسها).
     * - بنود مختلفة ⇒ لا نتابع بصمت؛ المشغّل يقرر صراحةً تجاهل السابقة.
     */
    const draft = pending.has('checkout') ? loadCheckoutDraft() : null;
    const linesFp = fingerprintOf(cartLinesPayload());
    let restored = false;
    if (draft && draft.linesFp === linesFp && Array.isArray(draft.tenders) && draft.tenders.length) {
      $('tenderRows').replaceChildren(...draft.tenders.map((t) => buildTenderRow(t.method, t.amountMinor, t.tenderedMinor ?? null)));
      restored = true;
    } else {
      if (draft && draft.linesFp !== linesFp) {
        const proceed = await confirmAction({
          title: 'توجد عملية بيع غير مؤكدة لبنود مختلفة',
          body: 'سبق بدء بيع لم نتأكد من نتيجته، والسلة الحالية لا تطابقه. لا تعتبر العملية الأولى فاشلة من تلقاء نفسك: تحقق أولًا (مثال: اسأل المدير أو راجع آخر فاتورة). المتابعة تعني تجاهلها وبدء بيع جديد على مسؤوليتك.',
          okLabel: 'تجاهلها وبدء بيع جديد', danger: true,
        });
        if (!proceed) return;
        pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
      }
      $('tenderRows').replaceChildren(buildTenderRow('cash', est.totalMinor));
    }
    refreshTenderHeads(); recalcTenders();
    setCheckoutLocked(restored);
    if (!$('checkoutDialog').open) $('checkoutDialog').showModal();
    if (restored) $('confirmCheckoutBtn').focus();
    else {
      const first = document.querySelector('#tenderRows .tender-amount');
      first?.focus(); first?.select();
    }
  }

  $('discardPendingBtn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'تجاهل عملية بيع غير مؤكدة؟',
      body: 'إن كانت هذه العملية قد حُفظت عند الخادم بالفعل، فإن تنفيذ بيع جديد لنفس العميل سيحصّل منه المبلغ مرتين. لا تتابع إلا بعد التأكد من مدير/فاتورة محفوظة. البديل الآمن هو «إعادة المحاولة» التي تستكمل نفس العملية ولا تكررها.',
      okLabel: 'تأكدت — تجاهل وابدأ دفعًا جديدًا', danger: true,
    });
    if (!ok) return;
    pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
    setCheckoutLocked(false);
    $('checkoutDialog').close();
    toast('تُركت العملية المعلّقة بقرارك.', 'bad');
    openCheckout();
  });
  $('openCheckoutBtn').addEventListener('click', openCheckout);
  $('addTenderBtn').addEventListener('click', () => {
    const estTotal = cartEstimate().totalMinor;
    const paid = readTenderRows().reduce((s, r) => s + (r.amountMinor ?? 0), 0);
    const remaining = Math.max(0, estTotal - paid);
    $('tenderRows').appendChild(buildTenderRow('card', remaining || null));
    refreshTenderHeads(); recalcTenders();
  });
  $('checkoutDialog').addEventListener('cancel', (e) => { if (inFlight.checkout) e.preventDefault(); });

  function validateTenders() {
    const estTotal = cartEstimate().totalMinor;
    const rows = readTenderRows();
    const problems = [];
    if (estTotal <= 0) problems.push('إجمالي السلة صفر — لا يمكن حفظ بيع بلا قيمة عبر الدفع.');
    let paid = 0;
    for (const [i, r] of rows.entries()) {
      const amountInput = r.row.querySelector('.tender-amount');
      const tenderedInput = r.row.querySelector('.tender-tendered');
      amountInput.removeAttribute('aria-invalid'); tenderedInput.removeAttribute('aria-invalid');
      if (r.amountMinor === null || r.amountMinor <= 0) {
        problems.push(`أدخل قيمة صحيحة للدفعة ${i + 1}.`); amountInput.setAttribute('aria-invalid', 'true');
        if (!validateTenders._firstBad) validateTenders._firstBad = amountInput;
        continue;
      }
      paid += r.amountMinor;
      if (r.method === 'cash' && tenderedInput.value.trim() !== '') {
        if (r.tenderedMinor === null || r.tenderedMinor < r.amountMinor) {
          problems.push(`«المستلم» في الدفعة ${i + 1} يجب أن يكون مساويًا لقيمتها أو أكبر.`);
          tenderedInput.setAttribute('aria-invalid', 'true');
          if (!validateTenders._firstBad) validateTenders._firstBad = tenderedInput;
        }
      }
    }
    /*
     * عند القفل (محاولة سابقة غير مؤكدة) لا نعيد تقييم مطابقة المجموع محليًا:
     * القيم مسترجَعة حرفيًا من المحاولة الأولى، والخادم قد يكون حفظ البيع
     * بأسعار وقتها — إعادة الإرسال بنفس الحمولة تُعيد الفاتورة نفسها قبل أي
     * تسعير جديد. الحظر المحلي هنا سيجبر المشغّل على «تجاهل» قد يضاعف البيع.
     * أي رفض نهائي الآن يأتينا من الخادم نفسه فيفكّ القفل مع بقاء السلة.
     */
    if (!checkoutLocked && !problems.length && paid !== estTotal) {
      problems.push(paid < estTotal
        ? `يبقى ${fmtMinor(estTotal - paid)} ج.م غير مدفوع. أكمل الدفعات أو عدّل قيمها.`
        : `الدفعات تزيد عن الإجمالي بـ ${fmtMinor(paid - estTotal)} ج.م. عدّل القيم (الباقي للنقدي يُكتب في «المستلم» لا في قيمة الدفعة).`);
    }
    const draftShiftId = loadCheckoutDraft()?.shiftId ?? null;
    if (!problems.length && rows.some((r) => r.method === 'cash') && !shift && !draftShiftId) {
      problems.push('الدفع النقدي يحتاج وردية مفتوحة. افتح وردية من قسم «الوردية» أولًا.');
    }
    return { problems, rows, estTotal };
  }

  $('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight.checkout || !cart.size) return;
    validateTenders._firstBad = null;
    const { problems, rows } = validateTenders();
    const errBox = $('checkoutErr');
    if (problems.length) {
      errBox.textContent = problems[0]; errBox.hidden = false;
      validateTenders._firstBad?.focus();
      return;
    }
    errBox.hidden = true;

    const lines = cartLinesPayload();
    const hasCash = rows.some((r) => r.method === 'cash');
    const tenders = rows.map((r) => {
      const t = { method: r.method, amountMinor: r.amountMinor };
      if (r.method === 'cash') t.tenderedMinor = r.tenderedMinor ?? r.amountMinor;
      return t;
    });
    /*
     * وردية العملية تُستعاد من مسودة المحاولة الأولى إن وُجدت — الوردية
     * جزء من بصمة الحمولة، واستبدالها = مفتاح جديد = خطر بيع مكرر.
     */
    const existingDraft = pending.has('checkout') ? loadCheckoutDraft() : null;
    const effectiveShiftId = hasCash ? (existingDraft?.shiftId ?? shift?.id ?? null) : null;
    if (hasCash && !effectiveShiftId) {
      errBox.textContent = 'وردية المحاولة الأصلية غير معروفة، ولا يمكن إعادة إرسالها بأمان. راجع المدير للتأكد من حالة العملية قبل أي بيع جديد.';
      errBox.hidden = false;
      return;
    }
    const payload = { lines, tenders, shiftId: effectiveShiftId };
    const key = pending.getOrCreate('checkout', fingerprintOf(payload));
    /* تُحفظ الهوية والمسودة قبل إطلاق الطلب: إعادة التحميل أثناء انتظاره
       لا يجب أن تفقدنا أثر العملية أبدًا. */
    persistPending();
    /* البنود نفسها تُحفظ أيضًا: بعد إعادة تشغيل المتصفح تُبنى منها السلة كما
       كانت لتظل إعادة المحاولة مطابقة حرفيًا للمحاولة الأولى. */
    saveCheckoutDraft({ linesFp: fingerprintOf(lines), lines, tenders, shiftId: effectiveShiftId });
    const body = { idempotencyKey: key, lines, tenders };
    if (hasCash) body.shiftId = effectiveShiftId;

    inFlight.checkout = true;
    setBusy($('confirmCheckoutBtn'), true, 'جارٍ حفظ البيع…');
    try {
      const r = await api('POST', '/api/v1/checkout', body);
      pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
      setCheckoutLocked(false);
      /* البيع محفوظ من هذه النقطة مهما حدث تاليًا: فرّغ السلة ثم اجلب الإيصال كاملًا. */
      cart.clear(); persistCart(); renderCart();
      $('checkoutDialog').close();
      let saleView = null;
      try { saleView = (await api('GET', `/api/v1/sales/${r.sale.id}`)).sale; }
      catch { /* الإيصال سيُبنى من استجابة الحفظ نفسها */ }
      lastSale = saleView ?? { ...r.sale, payments: [], createdAt: new Date().toISOString() };
      if (!saleView) toast('حُفظ البيع، لكن تعذّرت قراءة إيصاله كاملًا. يمكن استرجاعه برقمه من قسم الإدارة.', 'bad');
      showReceipt(lastSale, !!r.replayed);
      loadCatalog().catch(() => {});
      if (shift) refreshShiftExpected().catch(() => {});
    } catch (e2) {
      const cls = classifyStatus(e2.status ?? 0);
      if (cls === 'uncertain') {
        /* أبقِ الهوية والمسودة واقفل التحرير: نفس البصمة تعيد نفس المفتاح فلا بيع ثانٍ أبدًا. */
        setCheckoutLocked(true);
        errBox.textContent = messageForError(e2); errBox.hidden = false;
      } else if (cls === 'unauthenticated') {
        errBox.textContent = 'انتهت الجلسة قبل تأكيد النتيجة. بعد الدخول أكمل نفس عملية الدفع.'; errBox.hidden = false;
      } else {
        pending.clear('checkout'); persistPending(); saveCheckoutDraft(null);
        setCheckoutLocked(false);
        errBox.textContent = messageForError(e2); errBox.hidden = false;
        if (e2.code === 'insufficient_stock' || e2.code === 'tender_mismatch' || e2.code === 'unknown_item') loadCatalog().catch(() => {});
        if (e2.code === 'shift_closed') { shift = null; sessionStore.set('nile-pos-shift-v1', null); renderShift(); renderCart(); recalcTenders(); }
      }
    } finally {
      inFlight.checkout = false;
      setBusy($('confirmCheckoutBtn'), false);
    }
  });

  /* ── الإيصال ── */
  function buildReceiptPaper(sale, container) {
    container.replaceChildren();
    container.appendChild(el('div', { class: 'receipt-shop', text: me?.tenant?.name ?? 'نيل كاشير' }));
    container.appendChild(el('div', { class: 'receipt-meta', text: `إيصال بيع · ${fmtDateTime(sale.createdAt)}` }));
    const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button', 'aria-label': 'نسخ رقم الفاتورة الكامل' } }, [iconEl('copy'), el('span', { text: 'نسخ الرقم' })]);
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(sale.id); toast('نُسخ رقم الفاتورة.', 'ok'); }
      catch { toast(`رقم الفاتورة: ${sale.id}`); }
    });
    container.appendChild(el('div', { class: 'receipt-id' }, [
      el('span', { text: `فاتورة ${shortId(sale.id)}` }),
      el('code', { class: 'code-ltr', attrs: { dir: 'ltr' }, text: sale.id }),
      copyBtn,
    ]));

    const tbody = el('tbody');
    for (const l of sale.lines ?? []) {
      tbody.appendChild(el('tr', {}, [
        el('td', { text: l.nameAr }),
        el('td', { class: 'num', text: `${fmtQtyString(l.quantity)} × ${fmtMinor(l.unitPriceMinor)}` }),
        el('td', { class: 'amt num', text: fmtMinor(l.lineTotalMinor) }),
      ]));
    }
    container.appendChild(el('table', { class: 'receipt-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'الصنف' }), el('th', { text: 'الكمية × السعر' }), el('th', { class: 'amt', text: 'المبلغ' })])]),
      tbody,
    ]));
    container.appendChild(el('div', { class: 'receipt-total-row num' }, [el('span', { text: 'الإجمالي' }), el('span', { text: `${fmtMinor(sale.totalMinor)} ج.م` })]));

    const pays = sale.payments ?? [];
    if (pays.length) {
      const box = el('div');
      for (const p of pays) {
        box.appendChild(el('div', { class: 'receipt-pay num' }, [
          el('span', { text: `الدفع (${METHOD_AR[p.method] ?? p.method})` }), el('span', { text: `${fmtMinor(p.amountMinor)} ج.م` }),
        ]));
        if (p.tenderedMinor != null) {
          box.appendChild(el('div', { class: 'receipt-pay num' }, [
            el('span', { text: 'المستلم نقدًا' }), el('span', { text: `${fmtMinor(p.tenderedMinor)} ج.م` }),
          ]));
        }
        if (p.changeMinor != null && p.changeMinor > 0) {
          box.appendChild(el('div', { class: 'receipt-pay receipt-change num' }, [
            el('span', { text: 'الباقي للعميل' }), el('span', { text: `${fmtMinor(p.changeMinor)} ج.م` }),
          ]));
        }
      }
      container.appendChild(box);
    } else {
      container.appendChild(el('p', { class: 'muted', text: 'تفاصيل الدفع غير متاحة في هذا العرض.' }));
    }
    container.appendChild(el('p', { class: 'receipt-meta', text: 'شكرًا لتعاملكم معنا' }));
  }

  function showReceipt(sale, replayed) {
    /* لو انتهت الجلسة أثناء جلب الإيصال لا نفتح حوارًا فوق شاشة الدخول —
       البيع محفوظ، والإيصال قابل للاسترجاع برقمه بعد الدخول. */
    if ($('appView').hidden) { toast('حُفظ البيع. سجّل الدخول واسترجع الإيصال برقمه من قسم الإدارة إن لزم.', 'ok'); return; }
    buildReceiptPaper(sale, $('receiptPaper'));
    $('receiptReplayNote').hidden = !replayed;
    $('receiptErr').hidden = true;
    $('receiptRefundBtn').hidden = !(canVoid() && (sale.payments ?? []).length > 0);
    if (!$('receiptDialog').open) $('receiptDialog').showModal();
    $('newSaleBtn').focus();
  }
  $('newSaleBtn').addEventListener('click', () => { $('receiptDialog').close(); setView('sale'); });
  $('printReceiptBtn').addEventListener('click', () => {
    const area = $('printArea');
    area.replaceChildren($('receiptPaper').cloneNode(true));
    area.hidden = false;
    window.print();
    setTimeout(() => { area.hidden = true; area.replaceChildren(); }, 300);
  });
  $('receiptRefundBtn').addEventListener('click', () => { if (lastSale) openRefund(lastSale); });

  /* ── الوردية ── */
  /*
   * استرجاع الوردية: المحفوظ محليًا أولًا، فإن غاب (جهاز جديد/جلسة ممسوحة)
   * أو كانت مغلقة نسأل الخادم عن الوردية المفتوحة حاليًا لهذا الجهاز/المحل
   * (G-02) ونرتبط بها — هكذا لا يتعطل الدفع النقدي بسبب حالة متصفح ضائعة.
   */
  async function restoreShift() {
    const id = sessionStore.get('nile-pos-shift-v1');
    if (id) {
      shift = { id, openingMinor: null, openedAt: null, expectedMinor: null };
      await refreshShiftExpected(true);
      if (shift) return;
    }
    try {
      const { shift: current } = await api('GET', '/api/v1/shifts/current');
      if (current && !current.isClosed) {
        shift = { id: current.id, openingMinor: current.openingMinor, openedAt: current.openedAt, expectedMinor: current.expectedMinor };
        sessionStore.set('nile-pos-shift-v1', shift.id);
        renderShift();
      } else {
        shift = null;
      }
    } catch {
      /* شبكة/خادم غير متاح الآن: نبقى «بلا وردية» محليًا ونعيد المحاولة لاحقًا. */
      shift = null;
    }
  }

  async function refreshShiftExpected(silent404 = false) {
    if (!shift) return;
    try {
      const { shift: s } = await api('GET', `/api/v1/shifts/${shift.id}`);
      if (!s) throw new ApiError(404, 'not_found', '');
      if (s.isClosed) {
        shift = null; sessionStore.set('nile-pos-shift-v1', null);
        if (s.closure) showClosure(s.closure);
        renderShift(); renderCart();
        toast('الوردية المحفوظة كانت قد أُغلقت.', 'info');
        return;
      }
      shift = { id: s.id, openingMinor: s.openingMinor, openedAt: s.openedAt, expectedMinor: s.expectedMinor };
      renderShift();
    } catch (e) {
      if (e.status === 404) {
        shift = null; sessionStore.set('nile-pos-shift-v1', null); renderShift(); renderCart();
        if (!silent404) toast('الوردية المحفوظة غير موجودة — صارت الحالة: بلا وردية.', 'bad');
      }
      /* خطأ شبكة: نبقي الوردية المحلية؛ الخادم يحسم عند أول عملية. */
    }
  }
  $('shiftRefresh').addEventListener('click', () => refreshShiftExpected().then(() => toast('تم تحديث حالة الوردية.', 'ok')).catch(() => {}));

  function renderShift() {
    const open = !!shift;
    $('shiftNoneCard').hidden = open;
    $('shiftOpenCard').hidden = !open;
    const chip = $('shiftChip');
    chip.classList.toggle('is-open', open);
    $('shiftChipText').textContent = open ? 'وردية مفتوحة' : 'بلا وردية';
    if (open && shift) {
      $('shiftIdShort').textContent = shortId(shift.id);
      $('shiftOpenedAt').textContent = shift.openedAt ? fmtDateTime(shift.openedAt) : '—';
      $('shiftOpening').textContent = shift.openingMinor != null ? fmtMinor(shift.openingMinor) : '—';
      $('shiftExpected').textContent = shift.expectedMinor != null ? fmtMinor(shift.expectedMinor) : '—';
      updateClosePreview();
    }
  }

  $('openShiftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight.shiftOpen) return;
    const raw = $('openingAmount').value.trim();
    const openingMinor = raw === '' ? 0 : parseMoneyToMinor(raw);
    const msg = $('openShiftMsg');
    if (openingMinor === null) { msg.textContent = 'أدخل رصيد افتتاح صحيحًا (أو اتركه فارغًا للصفر).'; msg.className = 'form-msg is-error'; $('openingAmount').focus(); return; }
    const key = pending.getOrCreate('shift-open', fingerprintOf({ openingMinor }));
    persistPending();
    inFlight.shiftOpen = true; setBusy($('openShiftBtn'), true, 'جارٍ فتح الوردية…');
    msg.textContent = ''; msg.className = 'form-msg';
    try {
      const r = await api('POST', '/api/v1/shifts', { openingMinor, idempotencyKey: key });
      pending.clear('shift-open'); persistPending();
      shift = { id: r.shift.id, openingMinor: r.shift.openingMinor ?? openingMinor, openedAt: r.shift.openedAt, expectedMinor: r.shift.openingMinor ?? openingMinor };
      sessionStore.set('nile-pos-shift-v1', shift.id);
      $('closureResult').hidden = true;
      $('openingAmount').value = '';
      renderShift(); renderCart();
      toast(r.replayed ? 'استُعيدت نفس الوردية (تكرار آمن).' : 'فُتحت الوردية.', 'ok');
      refreshShiftExpected().catch(() => {});
    } catch (e2) {
      const cls = classifyStatus(e2.status ?? 0);
      if (cls === 'definitive') { pending.clear('shift-open'); persistPending(); }
      if (e2.code === 'shift_already_open') {
        /* توجد وردية مفتوحة على الخادم (ربما من جهاز آخر): ارتبط بها بدل التعطل. */
        await restoreShift().catch(() => {});
        if (shift) {
          msg.textContent = 'توجد وردية مفتوحة بالفعل على هذا الجهاز — تم الارتباط بها.';
          msg.className = 'form-msg is-ok';
          renderShift(); renderCart();
          toast('ارتبطنا بالوردية المفتوحة حاليًا.', 'ok');
          return;
        }
      }
      msg.textContent = cls === 'uncertain'
        ? 'لم تتأكد نتيجة فتح الوردية. أعد الضغط بنفس الرصيد — ستُستكمل نفس العملية دون تكرار.'
        : messageForError(e2);
      msg.className = 'form-msg is-error';
    } finally { inFlight.shiftOpen = false; setBusy($('openShiftBtn'), false); }
  });

  function updateClosePreview() {
    const out = $('closeDiffPreview');
    const counted = parseMoneyToMinor($('countedAmount').value);
    if (!shift || counted === null || shift.expectedMinor == null) { out.textContent = '—'; out.className = 'diff-preview num'; return; }
    const diff = counted - shift.expectedMinor;
    out.textContent = `${diff > 0 ? '+' : ''}${fmtMinor(diff)} ج.م`;
    out.className = `diff-preview num ${diff < 0 ? 'diff-neg' : diff > 0 ? 'diff-pos' : 'diff-zero'}`;
  }
  $('countedAmount').addEventListener('input', updateClosePreview);

  function showClosure(c) {
    $('closureExpected').textContent = fmtMinor(c.expectedMinor);
    $('closureCounted').textContent = fmtMinor(c.countedMinor);
    const d = $('closureDiff');
    d.textContent = `${c.differenceMinor > 0 ? '+' : ''}${fmtMinor(c.differenceMinor)}`;
    d.className = c.differenceMinor < 0 ? 'diff-neg' : c.differenceMinor > 0 ? 'diff-pos' : 'diff-zero';
    $('closureDiffNote').textContent = c.differenceMinor === 0
      ? 'المعدود يطابق المتوقع تمامًا.'
      : c.differenceMinor < 0 ? 'يوجد عجز بالنقدية عن المتوقع — سُجّل بالإغلاق كما هو للمراجعة.'
        : 'يوجد فائض بالنقدية عن المتوقع — سُجّل بالإغلاق كما هو للمراجعة.';
    $('closureResult').hidden = false;
  }

  $('closeShiftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight.close || !shift) return;
    const msg = $('closeShiftMsg');
    const counted = parseMoneyToMinor($('countedAmount').value);
    if (counted === null) { msg.textContent = 'أدخل «المعدود فعليًا» مبلغًا صحيحًا.'; msg.className = 'form-msg is-error'; $('countedAmount').focus(); return; }
    await refreshShiftExpected().catch(() => {});
    if (!shift) return; /* أُغلقت من مكان آخر أثناء التحديث */
    const expectedText = shift.expectedMinor != null ? fmtMinor(shift.expectedMinor) : '—';
    const ok = await confirmAction({
      title: 'إغلاق الوردية نهائيًا؟',
      body: `المتوقع في الدرج (من الخادم): ${expectedText} ج.م · المعدود الذي أدخلته: ${fmtMinor(counted)} ج.م. بعد الإغلاق لا يمكن البيع النقدي على هذه الوردية ولا التراجع عنه.`,
      okLabel: 'نعم، أغلق الوردية', danger: true,
    });
    if (!ok) return;
    /*
     * G-17: الإغلاق يحمل مفتاح عملية مربوطًا ببصمة (الوردية + المعدود) ويُحفظ
     * قبل الطلب — إن فُقد الرد بعد نجاح الخادم، إعادة المحاولة بنفس المعدود
     * تُعيد نتيجة الإغلاق المحفوظة نفسها بدل أي تكرار أو تخمين.
     */
    const closeKey = pending.getOrCreate('shift-close', fingerprintOf({ shiftId: shift.id, countedMinor: counted }));
    persistPending();
    inFlight.close = true; setBusy($('closeShiftBtn'), true, 'جارٍ إغلاق الوردية…');
    msg.textContent = ''; msg.className = 'form-msg';
    try {
      const r = await api('POST', `/api/v1/shifts/${shift.id}/close`, { countedMinor: counted, idempotencyKey: closeKey });
      pending.clear('shift-close'); persistPending();
      shift = null; sessionStore.set('nile-pos-shift-v1', null);
      $('countedAmount').value = '';
      showClosure(r.closure); renderShift(); renderCart();
      toast('أُغلقت الوردية وحُفظت نتيجتها.', 'ok');
    } catch (e2) {
      /*
       * عند نتيجة غير مؤكدة نعيد قراءة الوردية بدل الافتراض. مفتاح العملية
       * يبقى محفوظًا ما دامت النتيجة غير مؤكدة — إعادة المحاولة بنفس المعدود
       * تسترد نتيجة الخادم نفسها (G-17)؛ ونمسحه فقط عند رفض نهائي مؤكد.
       */
      const cls = classifyStatus(e2.status ?? 0);
      if (cls === 'definitive' && e2.code !== 'shift_already_closed') { pending.clear('shift-close'); persistPending(); }
      if (e2.code === 'shift_already_closed' || cls === 'uncertain') {
        const id = shift.id;
        try {
          const { shift: s } = await api('GET', `/api/v1/shifts/${id}`);
          if (s?.isClosed && s.closure) {
            pending.clear('shift-close'); persistPending();
            shift = null; sessionStore.set('nile-pos-shift-v1', null);
            $('countedAmount').value = '';
            showClosure(s.closure); renderShift(); renderCart();
            toast('الوردية مُغلقة بالفعل — هذه نتيجتها المحفوظة.', 'ok');
            return;
          }
        } catch {}
        msg.textContent = 'لم تتأكد نتيجة الإغلاق. تحقق من حالة الوردية قبل أي محاولة جديدة (لا تعتبرها مفتوحة ولا مغلقة).';
      } else {
        msg.textContent = messageForError(e2);
      }
      msg.className = 'form-msg is-error';
    } finally { inFlight.close = false; setBusy($('closeShiftBtn'), false); }
  });

  /* ── المرتجع ── */
  function openRefund(sale) {
    if (!canVoid()) { toast('المرتجع بصلاحية المدير فقط.', 'bad'); return; }
    refundSale = sale;
    $('refundSaleInfo').textContent = `فاتورة ${shortId(sale.id)} · الإجمالي ${fmtMinor(sale.totalMinor)} ج.م · ${fmtDateTime(sale.createdAt)}`;
    $('refundErr').hidden = true;
    $('refundUncertain').hidden = !pending.has('refund');
    $('refundReason').value = '';

    const paySelect = $('refundPayment');
    paySelect.replaceChildren(...(sale.payments ?? []).map((p) =>
      el('option', { attrs: { value: p.id }, text: `${METHOD_AR[p.method] ?? p.method} — ${fmtMinor(p.amountMinor)} ج.م` })));
    $('refundPaymentField').hidden = (sale.payments ?? []).length <= 1;
    paySelect.onchange = syncRefundShiftWarn;

    $('refundLines').replaceChildren(...(sale.lines ?? []).map((l) => {
      const soldMilli = parseQtyMilli(l.quantity) ?? 0;
      const input = el('input', {
        class: 'qty-input num refund-qty',
        attrs: { type: 'text', inputmode: 'decimal', dir: 'ltr', value: milliToQtyString(soldMilli), 'aria-label': `كمية مرتجع ${l.nameAr}` },
        dataset: { variantId: l.variantId, unitPrice: String(l.unitPriceMinor), soldMilli: String(soldMilli) },
      });
      input.addEventListener('input', updateRefundPreview);
      return el('div', { class: 'refund-line' }, [
        el('span', { class: 'rl-name' }, [
          document.createTextNode(l.nameAr),
          el('span', { class: 'rl-meta num', text: `بيعت ${fmtQtyString(l.quantity)} × ${fmtMinor(l.unitPriceMinor)} ج.م` }),
        ]),
        el('label', { class: 'qty-unit', text: 'يرتجع:' }),
        input,
      ]);
    }));
    syncRefundShiftWarn();
    updateRefundPreview();
    if (!$('refundDialog').open) $('refundDialog').showModal();
  }

  function selectedRefundPayment() {
    if (!refundSale) return null;
    const id = $('refundPayment').value;
    return (refundSale.payments ?? []).find((p) => p.id === id) ?? (refundSale.payments ?? [])[0] ?? null;
  }
  function syncRefundShiftWarn() {
    const p = selectedRefundPayment();
    $('refundShiftWarn').hidden = !(p?.method === 'cash' && !shift);
  }
  function readRefundItems() {
    const items = [];
    let minutes = null;
    document.querySelectorAll('.refund-qty').forEach((input) => {
      input.removeAttribute('aria-invalid');
      const milli = parseQtyMilli(input.value === '' ? '0' : input.value);
      if (milli === null) { input.setAttribute('aria-invalid', 'true'); minutes = 'bad'; return; }
      if (milli > Number(input.dataset.soldMilli)) { input.setAttribute('aria-invalid', 'true'); minutes = 'over'; return; }
      if (milli > 0) items.push({ variantId: input.dataset.variantId, quantity: milliToQtyString(milli), milli, unitPrice: Number(input.dataset.unitPrice) });
    });
    return { items, error: minutes };
  }
  function updateRefundPreview() {
    const { items } = readRefundItems();
    const total = items.reduce((s, it) => s + lineEstimateMinor(it.unitPrice, it.milli), 0);
    $('refundPreview').textContent = fmtMinor(total);
  }

  $('refundForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight.refund || !refundSale) return;
    const errBox = $('refundErr');
    const pay = selectedRefundPayment();
    const { items, error } = readRefundItems();
    const fail = (m) => { errBox.textContent = m; errBox.hidden = false; };
    if (!pay) return fail('لا توجد دفعة قابلة للاسترداد في هذه الفاتورة.');
    if (error === 'bad') return fail('أدخل كميات صحيحة (مثال: 1 أو 0.25).');
    if (error === 'over') return fail('كمية مرتجع تتجاوز المباع في الفاتورة.');
    if (!items.length) return fail('حدّد كمية أكبر من صفر لصنف واحد على الأقل.');
    if (pay.method === 'cash' && !shift) return fail('المرتجع النقدي يحتاج وردية مفتوحة. افتح وردية ثم أعد المحاولة.');
    errBox.hidden = true;

    const previewMinor = items.reduce((s, it) => s + lineEstimateMinor(it.unitPrice, it.milli), 0);
    const ok = await confirmAction({
      title: 'تأكيد تنفيذ المرتجع؟',
      body: `سيُسترد نحو ${fmtMinor(previewMinor)} ج.م (معاينة) من دفعة «${METHOD_AR[pay.method] ?? pay.method}» وتعود الكميات للمخزون. المبلغ النهائي يحسبه الخادم ولا يمكن التراجع عن المرتجع المحفوظ.`,
      okLabel: 'نعم، نفّذ المرتجع', danger: true,
    });
    if (!ok) return;

    const payload = {
      originalTransactionId: refundSale.id,
      paymentId: pay.id,
      items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      shiftId: pay.method === 'cash' ? shift.id : null,
    };
    const key = pending.getOrCreate('refund', fingerprintOf(payload));
    persistPending();
    const body = { idempotencyKey: key, originalTransactionId: payload.originalTransactionId, paymentId: pay.id, items: payload.items };
    const reason = $('refundReason').value.trim();
    if (reason) body.reason = reason;
    if (pay.method === 'cash') body.shiftId = shift.id;

    inFlight.refund = true; setBusy($('confirmRefundBtn'), true, 'جارٍ حفظ المرتجع…');
    try {
      const r = await api('POST', '/api/v1/refunds', body);
      pending.clear('refund'); persistPending();
      $('refundDialog').close();
      if ($('receiptDialog').open) $('receiptDialog').close();
      toast(`تم المرتجع بمبلغ ${fmtMinor(r.refund.amountMinor)} ج.م${r.replayed ? ' (كانت هذه العملية محفوظة مسبقًا)' : ''}.`, 'ok');
      loadCatalog().catch(() => {});
      if (shift) refreshShiftExpected().catch(() => {});
      refundSale = null;
    } catch (e2) {
      const cls = classifyStatus(e2.status ?? 0);
      if (cls === 'uncertain') {
        $('refundUncertain').hidden = false;
        fail(messageForError(e2));
      } else if (cls === 'unauthenticated') {
        fail('انتهت الجلسة قبل تأكيد النتيجة. بعد الدخول أعد المرتجع بنفس الاختيارات.');
      } else {
        pending.clear('refund'); persistPending();
        fail(messageForError(e2));
      }
    } finally { inFlight.refund = false; setBusy($('confirmRefundBtn'), false); }
  });

  /* ── التقارير + استرجاع فاتورة ── */
  async function loadReport() {
    const from = $('reportFrom').value, to = $('reportTo').value;
    const msg = $('reportMsg');
    if (!from || !to || from > to) { msg.textContent = 'اختر نطاق تاريخ صحيحًا (من ≤ إلى).'; msg.className = 'form-msg is-error'; return; }
    setBusy($('reportLoadBtn'), true, 'جارٍ جلب التقرير…');
    msg.textContent = ''; msg.className = 'form-msg';
    try {
      const { report: r } = await api('GET', `/api/v1/reports/daily?from=${from}&to=${to}`);
      reportLoadedOnce = true;
      $('kpiNetCollected').textContent = fmtMinor(r.netCollectedMinor);
      $('kpiCollected').textContent = fmtMinor(r.collectedMinor);
      $('kpiCollectedCount').textContent = String(r.collectedCount);
      $('kpiRefunds').textContent = fmtMinor(r.refundsMinor);
      $('kpiRefundsCount').textContent = String(r.refundsCount);
      $('kpiBilled').textContent = fmtMinor(r.billedMinor);
      $('kpiBilledCount').textContent = String(r.billedCount);
      $('kpiOutstanding').textContent = fmtMinor(r.outstandingMinor);
      $('reportKpis').hidden = false;
      const tbody = $('reportMethods');
      tbody.replaceChildren(...((r.byMethod ?? []).length ? r.byMethod.map((m) => el('tr', {}, [
        el('td', { text: METHOD_AR[m.method] ?? m.method }),
        el('td', { class: 'num', text: String(m.count) }),
        el('td', { class: 'num', text: fmtMinor(m.totalMinor) }),
      ])) : [el('tr', {}, [el('td', { attrs: { colspan: '3' }, text: 'لا دفعات في هذه الفترة.' })])]));
      $('reportMethodsWrap').hidden = false;
    } catch (e) {
      msg.textContent = messageForError(e); msg.className = 'form-msg is-error';
      throw e;
    } finally { setBusy($('reportLoadBtn'), false); }
  }
  $('reportForm').addEventListener('submit', (e) => { e.preventDefault(); loadReport().catch(() => {}); });
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    const today = todayCairo();
    const shiftDays = (iso, d) => { const dt = new Date(`${iso}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + d); return dt.toISOString().slice(0, 10); };
    if (b.dataset.range === 'today') { $('reportFrom').value = today; $('reportTo').value = today; }
    if (b.dataset.range === 'yesterday') { const y = shiftDays(today, -1); $('reportFrom').value = y; $('reportTo').value = y; }
    if (b.dataset.range === '7d') { $('reportFrom').value = shiftDays(today, -6); $('reportTo').value = today; }
    loadReport().catch(() => {});
  }));

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  $('saleLookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('saleLookupId').value.trim();
    const msg = $('saleLookupMsg');
    if (!UUID_RE.test(id)) { msg.textContent = 'ألصق رقم الفاتورة الكامل كما ظهر في الإيصال.'; msg.className = 'form-msg is-error'; $('saleLookupId').focus(); return; }
    setBusy($('saleLookupBtn'), true, 'جارٍ البحث…');
    msg.textContent = ''; msg.className = 'form-msg';
    try {
      const { sale } = await api('GET', `/api/v1/sales/${id}`);
      const out = $('saleLookupResult');
      out.hidden = false;
      out.replaceChildren();
      const paper = el('div', { class: 'receipt-paper' });
      buildReceiptPaper(sale, paper);
      out.appendChild(paper);
      if (canVoid() && (sale.payments ?? []).length) {
        const btn = el('button', { class: 'btn btn-danger-ghost', attrs: { type: 'button' } }, [iconEl('undo'), el('span', { text: 'تنفيذ مرتجع لهذه الفاتورة…' })]);
        btn.addEventListener('click', () => openRefund(sale));
        const row = el('div', { class: 'dialog-actions' }, [btn]);
        out.appendChild(row);
      }
    } catch (e2) {
      $('saleLookupResult').hidden = true;
      msg.textContent = e2.status === 404 ? 'الفاتورة غير موجودة في محلّك.' : messageForError(e2);
      msg.className = 'form-msg is-error';
    } finally { setBusy($('saleLookupBtn'), false); }
  });

  /* ── الثيم، الاتصال، الاختصارات ── */
  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0b110e' : '#0e7a5f');
    try { localStorage.setItem('nile-pos-theme', next); } catch {}
  });

  const syncOnline = () => { $('offlineBanner').hidden = navigator.onLine; };
  window.addEventListener('online', () => { syncOnline(); toast('عاد الاتصال.', 'ok'); });
  window.addEventListener('offline', syncOnline);
  syncOnline();

  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName ?? '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
    const anyDialog = document.querySelector('dialog[open]');
    if (e.key === '/' && !typing && !anyDialog && !$('appView').hidden) {
      e.preventDefault();
      if (currentView !== 'sale') setView('sale'); else $('searchInput').focus();
    }
    if (e.key === 'F9' && !$('appView').hidden && !$('checkoutDialog').open) {
      e.preventDefault();
      if (cart.size) openCheckout();
    }
    if (e.key === 'Escape' && $('cartPane').classList.contains('is-open')) closeCartSheet();
  });

  /* ── الإقلاع: استعادة الجلسة القائمة إن وجدت ── */
  (async () => {
    try {
      const meData = await api('GET', '/api/v1/me', null, { silent401: true });
      await enterApp(meData);
    } catch {
      showLogin();
    }
  })();
}
