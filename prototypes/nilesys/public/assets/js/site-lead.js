/* ===== نموذج رسالة الزائر — لكل موقع =====
 *
 * صفحة الموقع صفحة تسويقية، لكن الرسالة اللي بتوصل منها لازم تتحفظ فعلاً في
 * لوحة المواقع. هذا الملف يحقن النموذج في أي صفحة تحمل <body data-site="slug">،
 * ويسجّل زيارة واحدة لكل جلسة في اليوم.
 *
 * بلا مكتبات: الصفحات تُفتح في متصفح قديم أحياناً، والفشل هنا لا يجوز أن يمنع
 * الصفحة من العمل — كل نداء داخل try/catch، والفشل يظهر كلاماً لا شاشة بيضاء.
 */
(function () {
  'use strict';
  const slug = document.body && document.body.getAttribute('data-site');
  if (!slug) return;

  /* ---- عدّاد الزيارة: لا يوقف شيئاً لو فشل ---- */
  try {
    fetch(`/api/sites/${encodeURIComponent(slug)}/view`, { method: 'POST', credentials: 'same-origin' })
      .catch(() => {});
  } catch { /* */ }

  const wrap = document.createElement('section');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="card" style="margin:26px 0;padding:18px">
      <b style="display:block;margin-bottom:6px">اترك رقمك ونتواصل معاك</b>
      <p style="margin:0 0 12px;font-size:14px;color:#64748b">
        الرسالة توصل لفريق الموقع مباشرة — من غير ما تفتح بريد ولا واتساب.
      </p>
      <form id="leadForm" novalidate style="display:grid;gap:8px;max-width:460px">
        <input id="leadName" name="name" placeholder="الاسم" autocomplete="name"
          style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:10px;font:inherit" />
        <input id="leadPhone" name="phone" placeholder="رقم الموبايل" inputmode="tel" autocomplete="tel"
          style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:10px;font:inherit" />
        <textarea id="leadMsg" name="message" rows="3" placeholder="عايز تعرف إيه؟"
          style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:10px;font:inherit;resize:vertical"></textarea>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="submit" id="leadSend"
            style="background:var(--accent,#0d9488);color:#fff;border:0;border-radius:10px;padding:11px 20px;font:inherit;font-weight:800;cursor:pointer">
            ابعت الرسالة
          </button>
          <span id="leadState" role="status" aria-live="polite" style="font-size:14px;color:#64748b"></span>
        </div>
      </form>
    </div>`;

  const mount = () => {
    const footer = document.querySelector('body > footer');
    document.body.insertBefore(wrap, footer || null);
    const form = document.getElementById('leadForm');
    const state = document.getElementById('leadState');
    const btn = document.getElementById('leadSend');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (document.getElementById('leadName').value || '').trim();
      const phone = (document.getElementById('leadPhone').value || '').replace(/\s+/g, '');
      const message = (document.getElementById('leadMsg').value || '').trim();
      if (name.length < 2) { state.textContent = 'اكتب اسمك الأول'; state.style.color = '#b91c1c'; return; }
      if (!/^0\d{8,14}$/.test(phone)) { state.textContent = 'رقم الموبايل مش مظبوط'; state.style.color = '#b91c1c'; return; }
      btn.disabled = true;
      state.textContent = 'بنبعت…';
      state.style.color = '#64748b';
      try {
        const r = await fetch(`/api/sites/${encodeURIComponent(slug)}/lead`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ name, phone, message }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          state.textContent = data.duplicate
            ? 'وصلتنا رسالتك قبل كده — هنكلمك قريب'
            : 'وصلت ✓ هنكلمك على الرقم ده';
          state.style.color = '#166534';
          form.reset();
        } else {
          state.textContent = data.error || 'ما قدرناش نبعت — جرّب تاني';
          state.style.color = '#b91c1c';
        }
      } catch {
        state.textContent = 'الشبكة قطعت — جرّب تاني';
        state.style.color = '#b91c1c';
      }
      btn.disabled = false;
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
