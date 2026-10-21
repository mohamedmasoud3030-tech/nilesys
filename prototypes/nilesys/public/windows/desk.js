/* ===== نيل سيستمز — نواة برامج سطح المكتب =====
 *
 * الخمسة برامج تشترك في هذه النواة ولا تنسخها: تخزين محلي، طابور مزامنة،
 * طباعة، باركود، وتنسيق أرقام.
 *
 * القاعدة الحاكمة: البرنامج يعمل كاملاً بلا إنترنت. كل عملية تُحفظ محلياً أولاً
 * بمفتاح فريد، ثم تُرسل عند رجوع الشبكة — والخادم يعرف المفتاح، فالإرسال
 * المتأخر أو المكرر لا يصنع حركة ثانية أبداً.
 */
(function () {
  'use strict';

  const VERSION = '1.0';
  const DEVICE_KEY = 'demo-device'; // مفتاح جهاز العرض التجريبي (يُبدَّل لكل عميل)
  const DEVICE_ID = (() => {
    try {
      let d = localStorage.getItem('nile.os.device');
      if (!d) { d = 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem('nile.os.device', d); }
      return d;
    } catch { return 'PC-DEMO'; }
  })();

  const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
  const money = (n) => num(Math.round((Number(n) || 0) * 100) / 100) + ' ج.م';
  const dmy = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const hm = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------------- التخزين المحلي ---------------- */
  const keyOf = (slug) => `nile.os.${slug}.v1`;

  function load(slug, seedFn) {
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem(keyOf(slug)) || 'null'); } catch { doc = null; }
    if (!doc || doc.version !== VERSION) {
      doc = { version: VERSION, device: DEVICE_ID, createdAt: new Date().toISOString(), pending: [], lastSync: null };
      if (seedFn) Object.assign(doc, seedFn());
      save(slug, doc);
    }
    doc.pending = doc.pending || [];
    return doc;
  }
  function save(slug, doc) {
    try { localStorage.setItem(keyOf(slug), JSON.stringify(doc)); } catch { /* ممتلئ */ }
    return doc;
  }
  function reset(slug, seedFn) {
    const doc = { version: VERSION, device: DEVICE_ID, createdAt: new Date().toISOString(), pending: [], lastSync: null };
    if (seedFn) Object.assign(doc, seedFn());
    return save(slug, doc);
  }

  /* ---------------- طابور المزامنة ---------------- */
  // كل عملية تُسجَّل محلياً وتدخل الطابور فوراً؛ الشبكة ليست شرطاً لشيء.
  function queue(slug, doc, type, payload, amount) {
    const op = {
      key: uid(), type, at: new Date().toISOString(),
      amount: Math.round((Number(amount) || 0) * 100) / 100,
      payload: payload || {},
    };
    doc.pending.push(op);
    save(slug, doc);
    return op;
  }

  const listeners = new Set();
  const onNet = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  async function sync(slug, doc, { force = false } = {}) {
    if (!force && !navigator.onLine) return { offline: true, acked: 0 };
    const ops = (doc.pending || []).slice(0, 300);
    if (!ops.length) return { acked: 0, empty: true };
    const r = await fetch('/api/windows/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nile-device': DEVICE_KEY },
      body: JSON.stringify({ program: slug, device: doc.device, ops }),
    });
    if (!r.ok) throw new Error(`المزامنة اترفضت (${r.status})`);
    const data = await r.json();
    const acked = new Set(data.acked || []);
    doc.pending = (doc.pending || []).filter((o) => !acked.has(o.key));
    doc.lastSync = data.serverTime || new Date().toISOString();
    save(slug, doc);
    listeners.forEach((fn) => { try { fn({ acked: acked.size, doc }); } catch { /* */ } });
    return { acked: acked.size, duplicates: (data.duplicates || []).length };
  }

  /* ---------------- الطباعة (80mm و A4) ---------------- */
  function printHtml(html, { width = '80mm' } = {}) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;inset-inline-start:-9999px;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const w = frame.contentWindow;
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <style>
        @page { size: ${width} auto; margin: 3mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; color: #000; font-size: 12px; line-height: 1.5; }
        h1, h2, h3 { margin: 0 0 4px; font-size: 14px; }
        .row { display: flex; justify-content: space-between; gap: 6px; }
        .mono { font-family: ui-monospace, Consolas, monospace; }
        .small { font-size: 11px; }
        .sep { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 2px 0; font-size: 11px; text-align: start; }
        .tot { font-weight: 800; font-size: 13px; }
        .center { text-align: center; }
        .sign { margin-top: 18px; display: flex; justify-content: space-between; font-size: 10px; }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    // آخر مستند طُبع — يُقرأ في الاختبار الآلي للتأكد من محتوى الورقة نفسها،
    // ويُستخدم في عرض «معاينة الطباعة». لا يمنع الطباعة الحقيقية.
    window.__lastPrint = html;
    if (navigator.webdriver) { setTimeout(() => frame.remove(), 50); return; } // بلا نافذة طباعة في الاختبار
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* */ } }, 120);
    setTimeout(() => frame.remove(), 60000);
  }

  /* ---------------- باركود Code39 (حقيقي، لا رسم عشوائي) ---------------- */
  const C39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
    F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
    K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
    P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
    U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
    Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn',
    $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
  };

  // يُرجع SVG جاهزاً للطباعة: أعمدة سوداء بعرض 1 أو 2 وحدة بحسب الجدول.
  function code39(value, { height = 40, unit = 1.4 } = {}) {
    const text = String(value || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
    const chars = `*${text}*`.split('').filter((c) => C39[c]);
    let x = 0;
    const bars = [];
    chars.forEach((ch, idx) => {
      const pat = C39[ch];
      pat.split('').forEach((el, i) => {
        const w = (el === 'w' ? 2.4 : 1) * unit;
        if (i % 2 === 0) bars.push(`<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="#000"/>`);
        x += w;
      });
      if (idx < chars.length - 1) x += unit; // فراغ بين الحروف
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(x)}" height="${height + 14}"
      viewBox="0 0 ${Math.ceil(x)} ${height + 14}" role="img" aria-label="باركود ${esc(text)}">
      ${bars.join('')}
      <text x="${Math.ceil(x) / 2}" y="${height + 12}" text-anchor="middle"
        font-family="ui-monospace, Consolas, monospace" font-size="11">${esc(text)}</text></svg>`;
  }

  /* ---------------- شريط الحالة (شبكة/طابور) ---------------- */
  function status(el, slug, doc, syncFn) {
    if (!el) return () => {};
    const paint = (extra) => {
      const pending = (doc.pending || []).length;
      const online = navigator.onLine;
      el.innerHTML = `
        <span class="desk-dot ${online ? 'on' : 'off'}"></span>
        <span>${online ? 'متصل' : 'بلا شبكة — كل حاجة بتتحفظ على الجهاز'}</span>
        <span class="desk-sep">|</span>
        <span>${pending ? `<b>${num(pending)}</b> عملية في انتظار المزامنة` : 'كله متزامن'}</span>
        ${doc.lastSync ? `<span class="desk-sep">|</span><span>آخر مزامنة ${hm(doc.lastSync)}</span>` : ''}
        <span class="desk-sep">|</span>
        <span class="mono">${esc(DEVICE_ID)}</span>
        <button class="desk-btn" data-desk-sync="1" ${(!online || !pending) ? 'disabled' : ''}>زامن الآن</button>
        ${extra ? `<span class="desk-sep">|</span><span>${extra}</span>` : ''}`;
      const b = el.querySelector('[data-desk-sync]');
      if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'بيزامن…'; try { await syncFn(); } catch (e) { el.dataset.err = e.message; } paint(); };
    };
    paint();
    window.addEventListener('online', () => { syncFn().catch(() => {}); paint(); });
    window.addEventListener('offline', paint);
    onNet(paint);
    return paint;
  }

  /* ---------------- أدوات واجهة صغيرة ---------------- */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  function toast(msg, kind = 'ok') {
    let host = document.getElementById('deskToast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'deskToast';
      host.className = 'desk-toast';
      document.body.appendChild(host);
    }
    const item = document.createElement('div');
    item.className = `desk-toast-item ${kind}`;
    item.textContent = msg;
    host.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }
  function modal({ title, body, footer }) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'desk-modal-back';
    back.innerHTML = `<div class="desk-modal" role="dialog" aria-modal="true">
      <div class="desk-modal-h"><b>${esc(title)}</b><button class="desk-x" aria-label="إغلاق">✕</button></div>
      <div class="desk-modal-b">${body}</div>
      ${footer ? `<div class="desk-modal-f">${footer}</div>` : ''}</div>`;
    document.body.appendChild(back);
    back.querySelector('.desk-x').onclick = closeModal;
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    document.addEventListener('keydown', escClose);
    return back;
  }
  const escClose = (e) => { if (e.key === 'Escape') closeModal(); };
  function closeModal() {
    $$('.desk-modal-back').forEach((m) => m.remove());
    document.removeEventListener('keydown', escClose);
  }

  window.Desk = {
    VERSION, DEVICE_ID, uid, esc, num, money, dmy, hm, today,
    load, save, reset, queue, sync, onNet, status,
    printHtml, code39, $, $$, toast, modal, closeModal,
  };
})();
