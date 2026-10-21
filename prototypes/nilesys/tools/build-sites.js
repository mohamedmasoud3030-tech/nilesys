#!/usr/bin/env node
/* مولّد المواقع السبعة — F-17.
 *
 * لماذا مولّد: سبع صفحات بنفس الهوية. نسخ الصفحة سبع مرات يعني سبع نسخ من
 * نفس الخطأ، وسبع فرص لتختلف الألوان. هنا القالب واحد والاختلاف بيانات.
 *
 * قاعدة صارمة: كل شارة حالة تقول الحقيقة. ما يعمل نكتب عنده «يعمل» ونربطه،
 * وما لم يُبنَ نكتب عنده «قيد التنفيذ» ونقول ما الموجود فعلاً. لا زر يوهم.
 *
 *   node tools/build-sites.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'sites');
fs.mkdirSync(OUT, { recursive: true });

const SITES = [
  {
    slug: 'mobile', name: 'متجر موبايلات', icon: '📱', accent: '#0d9488',
    headline: 'بيع موبايلات بضمان، وبضاعة بتتعدّد صح',
    lead: 'كاشير يقرأ الباركود، ويخصم، ويطبع فاتورة ضريبية، ويعرف كل جهاز دخل وخارج من المخزن.',
    status: 'live', system: '/systems/pos.html',
    features: ['بيع كاش وفيزا ومحفظة وتحويل', 'ضمان بالأرقام التسلسلية في خانة الباركود', 'فاتورة ضريبية 80 مم', 'مرتجعات جزئية لا تُلخبط الدرج'],
  },
  {
    slug: 'fashion', name: 'متجر ملابس', icon: '👕', accent: '#7c3aed',
    headline: 'مقاسات وألوان بلا فوضى في الرف',
    lead: 'كل مقاس صنف، والتسوية تكشف الفاقد بدل ما يختفي. العرض والخصم بقواعد واضحة.',
    status: 'live', system: '/systems/pos.html',
    features: ['أكواد خصم بحد أدنى للفاتورة', 'خصم سطر بسقف 30% لحماية الهامش', 'جرد يفتح فرق بالسبب', 'تقارير أفضل الأصناف بالساعة'],
  },
  {
    slug: 'restaurant', name: 'مطعم', icon: '🍽️', accent: '#dc2626',
    headline: 'ترابيزات وشاشة مطبخ وحساب في الآخر',
    lead: 'الطلب يتكتب على ترابيزة، يمشي للمطبخ، ويتحاسب مرة واحدة — بلا ورق يضيع.',
    status: 'planned', system: null,
    features: ['ترابيزات وحجوزات', 'شاشة مطبخ بالتذاكر', 'تعديل أوردر قبل التحضير', 'تقسيم الحساب'],
    note: 'المحرك المالي والمخزون والورديات موجودة ويعمل بها الكاشير الآن؛ شاشة الترابيزات والمطبخ لم تُبنَ بعد.',
  },
  {
    slug: 'clinic', name: 'عيادة', icon: '🩺', accent: '#2563eb',
    headline: 'مواعيد وملف مريض وروشتة تُطبع',
    lead: 'الاستقبال يحجز، الطبيب يكتب، والصيدلية تقرأ. نفس المريض لا يُسأل نفس السؤال مرتين.',
    status: 'planned', system: null,
    features: ['مواعيد ومنع التعارض', 'ملف مريض وزائر واحد', 'روشتة تُطبع', 'حساب الكشف والتحصيل'],
    note: 'طبقة الحسابات والصلاحيات جاهزة في المنصة؛ جدول المواعيد وملف المريض لم يُبنَ بعد.',
  },
  {
    slug: 'gym', name: 'جيم', icon: '🏋️', accent: '#ea580c',
    headline: 'اشتراكات بتخلص في وقتها، وتذكير قبلها',
    lead: 'عضوية بمدة، تنبيه قبل الانتهاء، ودخول يتسجّل — بدل إكسل على الاستقبال.',
    status: 'planned', system: null,
    features: ['اشتراك شهري/سنوي', 'تجميد واستئناف', 'تنبيه انتهاء', 'دخول وخروج'],
    note: 'نظام الاشتراكات نفسه لم يُبنَ. ما يعمل الآن هو الكاشير والمخزون.',
  },
  {
    slug: 'courts', name: 'حجز ملاعب', icon: '⚽', accent: '#16a34a',
    headline: 'الملعب محجوز للساعة دي؟ تعرف قبل ما ترد',
    lead: 'جدول ساعات، حجز ودفع عربون، وإلغاء بقواعد — بلا تعارض في المواعيد.',
    status: 'planned', system: null,
    features: ['جدول ساعات لكل ملعب', 'عربون وإلغاء', 'حجز متكرر أسبوعي', 'تقرير إشغال'],
    note: 'لم يُبنَ بعد. الخطة أن يستخدم نفس محرك الدفع والورديات الموجود.',
  },
  {
    slug: 'realestate', name: 'عقارات', icon: '🏠', accent: '#0891b2',
    headline: 'وحدات وعملاء ومتابعات في مكان واحد',
    lead: 'كل وحدة بصورها وسعرها، وكل عميل بمتابعاته — لا فرص تضيع في واتساب.',
    status: 'planned', system: null,
    features: ['وحدات وصور', 'عملاء ومتابعات', 'عمولة وسمسرة', 'مشاركة صفحة الوحدة'],
    note: 'لم يُبنَ بعد؛ هذه الصفحة تحدد الشكل والوعد قبل أن يُكتب سطر منها.',
  },
];

const WINDOWS = [
  { name: 'برنامج الكاشير للويندوز', note: 'نسخة تعمل بلا متصفح، تعمل أوفلاين وترفع لما الشبكة ترجع', state: 'planned' },
  { name: 'برنامج المخازن', note: 'جرد بالباركود وطبع ملصقات', state: 'planned' },
  { name: 'برنامج المطعم', note: 'شاشة مطبخ وشاشة كاشير على نفس الشبكة المحلية', state: 'planned' },
  { name: 'برنامج الحضور', note: 'بصمة/كارت وربط بالمرتبات', state: 'planned' },
  { name: 'برنامج التقارير', note: 'تقارير ثقيلة تعمل على جهاز المدير', state: 'planned' },
];

const badge = (s) => (s === 'live'
  ? '<span class="b live">يعمل الآن</span>'
  : '<span class="b soon">قيد التنفيذ</span>');

const shell = (title, accent, body, nav = '') => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} · نيل سيستمز</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='${encodeURIComponent(accent)}'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>N</text></svg>" />
  <style>
    :root { --accent: ${accent}; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --bg: #f8fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", "Noto Kufi Arabic", Tahoma, sans-serif; color: var(--ink); background: var(--bg); line-height: 1.65; }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
    header.bar { background: #fff; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
    header.bar .wrap { display: flex; align-items: center; gap: 12px; padding: 12px 20px; }
    .mark { width: 34px; height: 34px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 900; }
    .bar nav { margin-inline-start: auto; display: flex; gap: 14px; font-size: 14px; font-weight: 700; }
    .hero { padding: 56px 0 34px; }
    .hero .icon { font-size: 44px; }
    h1 { font-size: clamp(26px, 5vw, 42px); line-height: 1.25; margin: 10px 0; }
    .lead { color: var(--muted); font-size: 17px; max-width: 620px; }
    .b { display: inline-block; font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 999px; }
    .b.live { background: #dcfce7; color: #166534; }
    .b.soon { background: #fef3c7; color: #92400e; }
    .cta { display: inline-flex; gap: 8px; align-items: center; margin-top: 18px; background: var(--accent); color: #fff; padding: 12px 22px; border-radius: 12px; font-weight: 800; }
    .cta.ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 30px 0; }
    .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
    .card b { display: block; margin-bottom: 4px; }
    .note { background: #fff; border-inline-start: 4px solid var(--accent); border-radius: 10px; padding: 14px 16px; font-size: 14px; color: #334155; margin-bottom: 28px; }
    footer { border-top: 1px solid var(--line); margin-top: 40px; padding: 24px 0; color: var(--muted); font-size: 14px; }
    @media (max-width: 640px) { .bar nav { display: none; } .hero { padding: 34px 0 20px; } }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  </style>
</head>
<body>
  <header class="bar"><div class="wrap">
    <a href="/"><span class="mark">N</span></a>
    <b>نيل سيستمز</b>
    <nav><a href="/sites/">المواقع السبعة</a><a href="/systems/pos.html">جرّب الكاشير</a><a href="/">الرئيسية</a></nav>
  </div></header>
  ${nav}
  <main class="wrap">${body}</main>
  <footer><div class="wrap">نيل سيستمز — كل شارة على هذه الصفحة تقول الحقيقة: ما يعمل مكتوب أنه يعمل، وما لم يُبنَ مكتوب أنه قيد التنفيذ.</div></footer>
</body>
</html>`;

// ---------- صفحات المواقع ----------
for (const s of SITES) {
  const body = `
    <section class="hero">
      <div class="icon">${s.icon}</div>
      ${badge(s.status)}
      <h1>${s.headline}</h1>
      <p class="lead">${s.lead}</p>
      ${s.status === 'live'
        ? `<a class="cta" href="${s.system}">افتح النظام ←</a>`
        : `<span class="cta ghost" aria-disabled="true">مش جاهز بعد — قيد التنفيذ</span>`}
    </section>
    ${s.note ? `<div class="note">${s.note}</div>` : ''}
    <section class="grid">
      ${s.features.map((f) => `<div class="card">✓ ${f}</div>`).join('')}
    </section>`;
  fs.writeFileSync(path.join(OUT, `${s.slug}.html`), shell(s.name, s.accent, body), 'utf8');
}

// ---------- صفحة البرامج الخمسة ----------
const winBody = `
  <section class="hero">
    <div class="icon">🪟</div>
    <span class="b soon">قيد التنفيذ</span>
    <h1>خمسة برامج ويندوز</h1>
    <p class="lead">للمحلات اللي بتشتغل على جهاز في المحل، بلا متصفح وبلا نت. كلها لم تُبنَ بعد — ومكتوب هنا عشان محدش يستنى حاجة مش موجودة.</p>
  </section>
  <section class="grid">
    ${WINDOWS.map((w) => `<div class="card"><b>${w.name}</b><span class="b soon">قيد التخطيط</span><div class="muted" style="font-size:14px;margin-top:6px">${w.note}</div></div>`).join('')}
  </section>`;
fs.writeFileSync(path.join(OUT, 'windows.html'), shell('برامج ويندوز', '#334155', winBody), 'utf8');

// ---------- فهرس المواقع ----------
const idx = `
  <section class="hero">
    <div class="icon">🌐</div>
    <h1>المواقع السبعة</h1>
    <p class="lead">سبعة مواقع نشاط، كل واحد بشكل يناسب زبونه. حالتها الحقيقية مكتوبة على كل بطاقة.</p>
  </section>
  <section class="grid">
    ${SITES.map((s) => `<a class="card" href="/sites/${s.slug}.html">
      <div style="font-size:30px">${s.icon}</div>
      <b>${s.name}</b>
      ${badge(s.status)}
    </a>`).join('')}
    <a class="card" href="/sites/windows.html">
      <div style="font-size:30px">🪟</div>
      <b>برامج ويندوز</b>
      <span class="b soon">قيد التخطيط</span>
    </a>
  </section>`;
fs.writeFileSync(path.join(OUT, 'index.html'), shell('المواقع السبعة', '#0d9488', idx), 'utf8');

console.log(`كُتبت ${SITES.length + 2} صفحة في ${OUT}`);
