// نيل كاشير R1 — واجهة فوق /api/v1 مباشرة. لا منطق بيزنس هنا: الأسعار والإجماليات من المحرك.
const $ = (id) => document.getElementById(id);
const fmt = (minor) => (Number(minor) / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toMinor = (v) => Math.round(Number(v || 0) * 100);
let me = null, shift = null, catalog = [], cart = new Map(), lastSale = null;
const key = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `خطأ ${res.status}`);
  return data;
}

async function login() {
  $('loginErr').textContent = '';
  try {
    await api('POST', '/api/auth/sign-in/email', { email: $('email').value, password: $('password').value });
    me = await api('GET', '/api/v1/me');
    $('whoami').textContent = `${me.user.name} · ${me.role} · ${me.tenant?.name ?? ''}`;
    $('loginView').classList.add('hidden'); $('posView').classList.remove('hidden'); $('sessionBox').classList.remove('hidden');
    await loadCatalog();
  } catch (e) { $('loginErr').textContent = e.message; }
}

async function loadCatalog() {
  const { items } = await api('GET', '/api/v1/catalog/items');
  catalog = items;
  $('catalog').innerHTML = items.map((it) => `
    <div class="item"><b>${it.nameAr}</b><span class="price">${fmt(it.priceMinor)} ج.م</span>
    ${it.variants.map((v) => `<div class="stock">${v.labelAr} · مخزون ${v.stock} (${v.stockState})</div>
      <button data-add="${v.id}">أضف — ${v.labelAr}</button>`).join('')}
    </div>`).join('') || '<p class="muted">لا أصناف</p>';
  document.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => addToCart(b.dataset.add));
}

function variantOf(vid) {
  for (const it of catalog) { const v = it.variants.find((x) => x.id === vid); if (v) return { item: it, v }; }
  return null;
}
function addToCart(vid) { cart.set(vid, (cart.get(vid) || 0) + 1); renderCart(); }
function renderCart() {
  let total = 0;
  $('cartLines').innerHTML = [...cart.entries()].map(([vid, q]) => {
    const { item, v } = variantOf(vid); const lt = item.priceMinor * q; total += lt;
    return `<div class="cartline"><span>${item.nameAr} — ${v.labelAr}</span>
      <span class="qty"><button data-dec="${vid}">−</button> ${q} <button data-inc="${vid}">+</button></span><b>${fmt(lt)}</b></div>`;
  }).join('') || '<p class="muted">السلة فارغة</p>';
  $('total').textContent = fmt(total);
  document.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { cart.set(b.dataset.inc, cart.get(b.dataset.inc) + 1); renderCart(); });
  document.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const q = cart.get(b.dataset.dec) - 1; q <= 0 ? cart.delete(b.dataset.dec) : cart.set(b.dataset.dec, q); renderCart(); });
}

async function openShift() {
  try {
    const r = await api('POST', '/api/v1/shifts', { openingMinor: toMinor($('opening').value), idempotencyKey: key('shift') });
    shift = r.shift; $('shiftState').innerHTML = `وردية مفتوحة: <b>${shift.id.slice(0, 8)}…</b> برصيد ${fmt(shift.openingMinor ?? toMinor($('opening').value))} ج.م`;
    $('shiftMsg').textContent = r.replayed ? 'أُعيد فتح نفس الوردية (تكرار آمن)' : 'اتفتحت الوردية';
  } catch (e) { $('shiftMsg').textContent = e.message; }
}

async function checkout() {
  if (!cart.size) { $('saleMsg').textContent = 'السلة فارغة'; return; }
  const lines = [...cart.entries()].map(([variantId, quantity]) => ({ variantId, quantity: String(quantity) }));
  const total = [...cart.entries()].reduce((s, [vid, q]) => s + variantOf(vid).item.priceMinor * q, 0);
  const method = $('method').value;
  const tender = { method, amountMinor: total };
  if (method === 'cash' && $('tendered').value) tender.tenderedMinor = toMinor($('tendered').value);
  try {
    const r = await api('POST', '/api/v1/checkout', { idempotencyKey: key('sale'), shiftId: shift?.id, lines, tenders: [tender] });
    // قراءة الفاتورة بعرضها الكامل: المدفوعات (اللازمة لأي مرتجع) تأتي من GET /sales/:id
    lastSale = (await api('GET', `/api/v1/sales/${r.sale.id}`)).sale; cart.clear(); renderCart(); await loadCatalog();
    $('saleMsg').innerHTML = `<span class="ok">تم البيع</span> — فاتورة ${lastSale.id.slice(0, 8)}… بإجمالي ${fmt(lastSale.totalMinor)} ج.م`;
    $('receipt').innerHTML = `<b>الإيصال</b><table>${lastSale.lines.map((l) => `<tr><td>${l.nameAr} × ${l.quantity}</td><td>${fmt(l.lineTotalMinor)}</td></tr>`).join('')}</table>
      <p>الدفع: ${lastSale.payments.map((p) => `${p.method} ${fmt(p.amountMinor)}`).join(' · ') || '—'}</p>
      <button id="refundBtn">مرتجع كامل لهذه الفاتورة (مدير)</button> <span id="refundMsg" class="muted"></span>`;
    $('refundBtn').onclick = refundLast;
  } catch (e) { $('saleMsg').textContent = e.message; }
}

async function refundLast() {
  if (!lastSale?.payments?.length) { $('refundMsg').textContent = 'لا مدفوعات ظاهرة'; return; }
  const pay = lastSale.payments[0];
  try {
    const r = await api('POST', '/api/v1/refunds', {
      idempotencyKey: key('refund'), originalTransactionId: lastSale.id, paymentId: pay.id,
      items: lastSale.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), shiftId: shift?.id,
    });
    $('refundMsg').innerHTML = `<span class="ok">تم المرتجع</span> بمبلغ ${fmt(r.refund.amountMinor)} ج.م`; await loadCatalog();
  } catch (e) { $('refundMsg').textContent = e.message; }
}

async function closeShift() {
  if (!shift) { $('shiftMsg').textContent = 'لا وردية مفتوحة'; return; }
  try {
    const before = await api('GET', `/api/v1/shifts/${shift.id}`);
    const r = await api('POST', `/api/v1/shifts/${shift.id}/close`, { countedMinor: toMinor($('counted').value) });
    const c = r.closure;
    $('shiftMsg').innerHTML = `أُغلقت الوردية — المتوقع ${fmt(c.expectedMinor)} · المعدود ${fmt(c.countedMinor)} · الفرق <b>${fmt(c.differenceMinor)}</b> ج.م`;
    $('shiftState').textContent = 'لا توجد وردية مفتوحة'; shift = null;
  } catch (e) { $('shiftMsg').textContent = e.message; }
}

async function report() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  try {
    const { report: r } = await api('GET', `/api/v1/reports/daily?from=${today}&to=${today}`);
    $('report').classList.remove('hidden');
    $('report').innerHTML = `<h2>تقرير اليوم (${today})</h2>
      <p>إجمالي البيع: <b>${fmt(r.grossMinor)}</b> ج.م (${r.grossCount} فاتورة) · مرتجعات: ${fmt(r.refundsMinor)} (${r.refundsCount})</p>
      <p>الصافي: <b>${fmt(r.netMinor)}</b> · المحصّل فعليًا: ${fmt(r.collectedMinor)}</p>`;
  } catch (e) { $('report').classList.remove('hidden'); $('report').textContent = e.message; }
}

$('loginBtn').onclick = login;
$('openShiftBtn').onclick = openShift;
$('checkoutBtn').onclick = checkout;
$('closeShiftBtn').onclick = closeShift;
$('reportBtn').onclick = report;
$('logoutBtn').onclick = async () => { await api('POST', '/api/auth/sign-out', {}).catch(() => {}); location.reload(); };
