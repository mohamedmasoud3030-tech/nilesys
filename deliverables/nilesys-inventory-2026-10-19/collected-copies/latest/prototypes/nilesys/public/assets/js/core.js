/* ===== Nile Systems — core utilities (shared by all systems) ===== */
(function () {
  'use strict';

  /* ---- Language ---- */
  function getLang() { return localStorage.getItem('nile_lang') || 'ar'; }
  function setLang(l) {
    localStorage.setItem('nile_lang', l);
    applyI18n();
    window.dispatchEvent(new CustomEvent('nile:lang', { detail: { lang: l } }));
  }
  function t(key) {
    const dict = (window.I18N && (window.I18N[getLang()] || {})) || {};
    return dict[key] ?? (window.I18N?.ar || {})[key] ?? key;
  }
  function applyI18n() {
    const l = getLang();
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    const titleKey = document.body?.dataset.titleKey;
    if (titleKey) document.title = `${t(titleKey)} · ${t('common.appName')}`;
  }

  /* ---- Formatting (always Latin digits, like the original site) ---- */
  const nf = new Intl.NumberFormat('en-US');
  const money = (n) => `${nf.format(Math.round(n || 0))} ${t('common.currency')}`;
  const num = (n) => nf.format(n || 0);
  const dmy = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const hm = (iso) => {
    const d = new Date(iso);
    let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  };
  const ago = (iso) => {
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000));
    if (s < 60) return getLang() === 'ar' ? `${s} ث` : `${s}s`;
    if (s < 3600) return getLang() === 'ar' ? `${Math.floor(s / 60)} د` : `${Math.floor(s / 60)}m`;
    if (s < 86400) return getLang() === 'ar' ? `${Math.floor(s / 3600)} س` : `${Math.floor(s / 3600)}h`;
    return dmy(iso);
  };

  /* ---- API ---- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  /* ---- Toast ---- */
  function toast(msg, type = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; el.style.transition = 'all .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---- Modal ---- */
  function openModal({ title = '', body = '', footer = '', wide = false, onClose } = {}) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-h"><span>${title}</span><button class="x-btn" aria-label="close">✕</button></div>
        <div class="modal-b">${body}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
    back.querySelector('.x-btn').onclick = close;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    back._close = close;
    return back;
  }
  function closeModal() { document.querySelectorAll('.modal-back').forEach((m) => m.remove()); }

  /* ---- Branding ---- */
  function applyBranding(b) {
    if (!b) return;
    if (b.primary) document.documentElement.style.setProperty('--brand', b.primary);
    if (b.primary) document.documentElement.style.setProperty('--brand-600', shade(b.primary, -18));
    if (b.primary) document.documentElement.style.setProperty('--brand-050', shade(b.primary, 92));
    document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = b.storeName || ''; });
    document.querySelectorAll('[data-brand-logo]').forEach((el) => { el.textContent = b.logoText || 'NS'; });
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, c + amt));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  /* ---- misc ---- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms = 200) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };

  window.NS = {
    getLang, setLang, t, applyI18n, money, num, dmy, hm, ago, api, toast,
    openModal, closeModal, applyBranding, $, $$, esc, debounce,
  };
})();
