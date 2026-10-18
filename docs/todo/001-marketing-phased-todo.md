> **NOTE (2026-10-18):** هذا الـ TODO بُني على تفسير منسوخ. الأولويات الجديدة في `docs/vision/001-...md` §6 هي المرجع حتى ADR-0011. هذا الملف محفوظ كمرجع ولا يُنفذ قبل ADR-0011.

# TODO 001 — تنفيذ الموقع التسويقي كبديل لـ `platform` (5 مراحل)

**الحالة:** PROPOSED (ينتظر ADR-0011) · **يرتبط بـ:** PRD 001 · **القاعدة:** محرك أولاً، ثم واجهة (AGENTS.md) · **المنهج:** اختبار أولاً (TDD) + دليل قبل ادعاء (verification)

> **كيف تقرأ هذا الملف:** كل خطوة = عمل واحد صغير قابل للاختبار والتراجع. كل خطوة تنتهي بنتيجة خضراء مستقلة: كتابة الاختبار الفاشل → شاهده يفشل → كود الحد الأدنى → شاهده ينجح → إعادة تنظيف. لا خطوات ضبابية ("أضف معالجة أخطاء") — كل شيء ملفات ونتائج محددة.

---

## القواعد قبل البدء (من المهارات الست)

- **decision-governance:** لا نكسر ADR-0001/0003 إلا بـ ADR-0011 جديد (نصيغه في الخطوة 0)
- **source-driven:** نبحث قبل أن نبني — كل محرك مذكور له مصدر في `docs/REUSE.md`
- **implementation-planning:** كل خطوة ملفاتها ونتيجتها مذكورة — لا "TBD"
- **verification-before-completion:** لا "تم" بدون `npm test` + `typecheck` + `drizzle-kit check` طازج
- **security-review:** كل لمسة مصادقة/مستأجر/RLS تمر بمراجعة

---

## الخطوة 0 — التثبيت الحاكم (قبل أي كود) — 30 دقيقة

**الهدف:** نحسم تضارب البيت وM1 قبل أن نكتب سطراً.

| # | ماذا نفعل | الملفات | النتيجة |
|---|---|---|---|
| 0.1 | اكتب ADR-0011 مسودة: "Marketing site is the platform — supersedes ADR-0003 scope" (يضيف موقع تسويقي + واجهة كاشير إلى M1، ويحدد nilesys كـ canonical) | `docs/adr/0011-marketing-site-is-platform.md` (جديد) + `docs/DECISIONS.md` (تحديث الفهرس) | PR بعنوان `docs(adr): ADR-0011 PROPOSED` — لا يُدمج إلا بموافقتك |
| 0.2 | ثبّت PRD 001 وTODO 001 كـ PROPOSED | `docs/prd/001-...md` + `docs/todo/001-...md` (موجودان) | رابطان في `docs/README.md` |
| 0.3 | افتح `docs/STATUS.md` §5 وأضف Tasks 9-13 للمراحل (BLOCKED BY ADR-0011) | `docs/STATUS.md` | خارطة طريق مرئية للمالك |

**خارج النطاق في 0:** لا كود، لا نشر.

---

## المرحلة 1 — موقع تسويقي + كاشير كامل (الآن → 3 أسابيع)

### 1.1 — تثبيت التجربة (اختبارات تكافؤ) — يومان — لا يمس الإنتاج

| # | ماذا نفعل | الملفات | النتيجة المتوقعة |
|---|---|---|---|
| 1.1.1 | انسخ `prototypes/nilesys` إلى `/tmp/nilesys-parity` وشغّل التجربة معزولة | `tools/parity/run.sh` (جديد: ينسخ + `PORT=3211 node server.js &`) | التجربة تعمل على 3211 بدون لمس الديمو الحي |
| 1.1.2 | شغّل `review.test.js` الـ30 وسجّل الإخراج كأساس | `tools/parity/baseline-001.txt` (جديد) | 24 PASS / 6 FAIL كما في REVIEW.md — دليل طازج |
| 1.1.3 | حوّل الأساس إلى اختبارات تكافؤ مجمدة | `prototypes/nilesys/tests/parity.test.js` (جديد: يقرأ baseline ويقارن `expected`) | `BASE=3211 node --test parity.test.js` → 30/30 مطابق للأساس |

**لماذا أولاً؟** يحمي الفلوس: أي كسر في P1-P5 سيظهر فوراً.

### 1.2 — هيكل الواجهات (Next.js + pnpm) — 3 أيام

| # | ماذا نفعل | الملفات | النتيجة |
|---|---|---|---|
| 1.2.1 | فعّل `pnpm-workspace.yaml` + `nx.json` الحد الأدنى (gap ADR-0001) | `pnpm-workspace.yaml` (جديد من `platform/pnpm-workspace.yaml`), `nx.json` (جديد), `package.json` (تحديث workspaces) | `pnpm install` ينجح, `nx graph` يعرض `apps/*` و `engines/*` |
| 1.2.2 | أنشئ `apps/marketing` (Next.js 14 + App Router + RTL) | `apps/marketing/package.json`, `apps/marketing/app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `next.config.js` | `pnpm --filter marketing dev` → `/` يعرض "مرحباً" عربي/إنجليزي مع زر تبديل |
| 1.2.3 | أنشئ `apps/pos` (واجهة كاشير) فارغة كهيكل | `apps/pos/...` (مماثل) | `pnpm --filter pos dev` → صفحة بيضاء بعنوان "POS" |
| 1.2.4 | استخرج Design System | `libs/design-system/` (من `platform/artifacts/lena/src/components` + `prototypes/nilesys/public/assets/css/app.css`) | `libs/design-system/src/Button.tsx, Card.tsx, tokens.ts` + اختبار `Button.test.tsx` |

### 1.3 — موقع تسويقي يعمل (يعيد استخدام lena) — أسبوع

| # | ماذا نفعل | الملفات | النتيجة |
|---|---|---|---|
| 1.3.1 | انقل `SystemGrid.tsx` + `FounderCard.tsx` + `SeoHead.tsx` كمكونات | `libs/design-system/src/SystemGrid.tsx` (مصدره `platform/artifacts/lena/src/components/SystemGrid.tsx`) | اختبار `SystemGrid.test.tsx` أخضر |
| 1.3.2 | ابنِ صفحة `/` : هيرو + إحصائيات + منتقي نشاط + 7 أنظمة + 7 مواقع + ويندوز + مقارنة | `apps/marketing/app/page.tsx`, `apps/marketing/app/components/Hero.tsx, Stats.tsx, ProductPicker.tsx` | الموقع يعرض 14 كرت + ويندوز كما في `public/index.html` (مقارنة بكسل) |
| 1.3.3 | فعّل i18n: `i18n.js` (قاموس) + RTL + `hreflang` | `libs/i18n/` (من `prototypes/nilesys/public/assets/js/i18n.js` → TS) | زر عربي/إنجليزي يعكس الاتجاه ويحفظ في localStorage |
| 1.3.4 | نموذج استفسار → lead | `apps/marketing/app/api/leads/route.ts` (يستدعي `engines/catalog` lead pipeline) + `engines/catalog/src/db/schema.ts` (leads table) | `POST /api/leads` → 201 + صف في `leads` + اختبار e2e |

### 1.4 — كاشير على محركات حقيقية — أسبوع ونصف

| # | ماذا نفعل | الملفات | النتيجة |
|---|---|---|---|
| 1.4.1 | ثبّت بيع آمن: استدعاء `sale-service.ts` من API | `apps/api/src/controllers.ts` (توسعة `POST /sales` ليفحص السعر من `catalog`, المخزون, `paid>=total`), `engines/transactions/src/sale-service.ts` | 20 بيع متزامن → مخزون صحيح + ربح صحيح (اختبار `e2e-sale.test.ts` يمر) |
| 1.4.2 | منع باركود مكرر | `engines/catalog/src/db/schema.ts` (قيد فريد `unique(tenant_id, barcode)`), `migrations/0003_...sql` | محاولة تكرار باركود → 400 |
| 1.4.3 | إصلاح مرتجع/وردية/تقرير | `engines/transactions/src/cash.ts` (خصم `refund` من `expected`), `engines/transactions/src/sale.ts` (report.net), `prototypes/nilesys` تشخيص | مرتجع جزئي 10 → `expected` ينقص 10 + التقرير يعرض الصافي 10 لا 20 |
| 1.4.4 | واجهة كاشير Next.js | `apps/pos/app/page.tsx` (بحث/باركود/سلة/خصم/كاش-فيزا), `apps/pos/components/Cart.tsx, ProductGrid.tsx` | بيع كامل + طباعة إيصال `/sales/:id` |
| 1.4.5 | عزل مستأجر: `hr` لا يلمس `pos` | `engines/platform/src/db/with-tenant.ts` + `rls.test.ts` (توسعة cross-tenant) | `hr/manager` → `GET /sales` 404/401 |
| 1.4.6 | اختبار ذهبي: بيع+مرتجع+وردية | `apps/api/test/golden-cashier.test.ts` (جديد) | `profit, stock, cash, report` كلها مطابقة لرقم واحد |

**معايير قبول المرحلة 1:** §6 في PRD 001 (6 علامات).

---

## المرحلة 2 — مخازن + مطعم — أسبوعان

| # | ماذا نفعل | المصدر المعاد استخدامه | الملفات | النتيجة |
|---|---|---|---|---|
| 2.1 | مخازن: حالات مخزون + تكلفة متوسطة | `engines/transactions/costing.ts` (weighted avg) + `Terranex` procurement | `engines/catalog` توسعة stock states | تنبيه نواقص + تكلفة صحيحة |
| 2.2 | مطعم: خريطة طاولات + حالات طاولة | `starting` calendarModel (Cairo) + `larabeauty-` appointment lifecycle | `engines/booking/src/booking.ts` توسعة table map | حجز طاولة → شاشة مطبخ لحظية |
| 2.3 | واجهات: `apps/inventory`, `apps/restaurant` | `platform/artifacts/lena` كقالب | `apps/inventory/app/page.tsx` | كل نظام له ديمو بضغطة |

---

## المرحلة 3 — عيادة + HR + ملاعب + لوحة مواقع — أسبوعان

| # | ماذا نفعل | المصدر | الملفات |
|---|---|---|---|
| 3.1 | عيادة: موارد/فترات/حجز EXCLUDE | `engines/booking` (G-10 سابقاً) + `starting` | `engines/booking/src/db/schema.ts` (إضافة `EXCLUDE` بعد 0003) |
| 3.2 | HR: حضور/إجازات/سلف/مرتبات | `engines/people` (attendance, leave, loans, payroll) ← `larabeauty-` | `engines/people` توسعة + `apps/hr` |
| 3.3 | ملاعب: دورة حياة حجز | `engines/booking` | `apps/courts` |
| 3.4 | لوحة مواقع: إدارة 7 مواقع | `platform/lib/content` | `apps/admin` |

---

## المرحلة 4 — 7 مواقع مرتبطة — أسبوع

| # | ماذا نفعل | المصدر | الملفات |
|---|---|---|---|
| 4.1 | 7 قوالب مواقع (مطعم، عيادة...) | `platform/artifacts/lena/pages` + `REUSE.md` lead pipeline | `apps/sites/madison/*` (7 مجلدات) |
| 4.2 | كل موقع يكتب lead لنفس inbox | `engines/catalog` leads | `POST /api/sites/:id/leads` → inbox واحد |

---

## المرحلة 5 — ويندوز + تحميل + واتساب — أسبوع

| # | ماذا نفعل | المصدر | الملفات |
|---|---|---|---|
| 5.1 | صفحات تحميل + إصدارات | `platform/lib/db/drizzle` (project_media bucket) | `apps/marketing/app/downloads/page.tsx` |
| 5.2 | فواتير واتساب | **غير موجود** — بناء جديد (WhatsApp Cloud API) | `engines/platform/src/whatsapp.ts` (جديد) |
| 5.3 | ملخص يومي + تصدير | **غير موجود** — بناء جديد | `apps/api/src/reports/daily.ts` + `export.ts` |

---

## CI — نسخ من `malek` (14 فحص) — على دفعات

| # | ماذا نفعل | الملفات | النتيجة |
|---|---|---|---|
| C1 | انسخ 3 فحوص حرجة أولاً | `.github/workflows/ci.yml` (من `evidence/malek-github/ci.yml`), `canonical-business-rules-guard.yml`, `database-governance.yml` | كل PR يفحص typecheck/test/build + قواعد العمل + DB |
| C2 | أضف 11 الباقية لاحقاً (Sonar, Supabase, Guardian...) | باقي `evidence/` | CI كامل مثل `malek` |

---

## خارج النطاق — صريح

- لا نلمس `platform` repo مباشرة — بعد ADR-0011 نرشفه كـ archive
- لا ETA/B2C قبل P5
- لا microservices
- لا `sasa/teste/Test/mosaid` (أمر مالك)
- لا نعيد كتابة محرك فلوس جديد — نستخدم `bug-free-garbanzo`/`Terranex` كما هو

---

## كيف نتحقق (verification-before-completion)

بعد كل خطوة:
```
pnpm run typecheck  # 0 أخطاء
pnpm test          # كل الاختبارات خضراء (91/91 + parity 30/30)
npx drizzle-kit check  # نظيف
```
ثم نحدّث `docs/STATUS.md` بنفس الـ PR — لا نترك STATUS قديماً.

---

## ماذا نحتاج منك الآن؟

1. **اختر (أ) أو (ب) في PRD §2** (البيت وM1) — بدونها لا كود إنتاج.
2. وافق على معايير قبول المرحلة 1 (§6 PRD).
3. بعد الموافقة: نبدأ 1.1 (التكافؤ) فوراً — يومان بدون لمس الإنتاج.

