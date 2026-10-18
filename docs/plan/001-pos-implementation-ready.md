# خطة تنفيذ POS داخل LENA — جاهزة للاعتماد (لا كود قبل الموافقة)

**التاريخ:** 2026-10-18 · **الحالة:** PROPOSED · **النطاق:** نطاقك المعتمد 2026-10-18 — عرض المنظومة داخل LENA + إكمال POS وحده كنظام تشغيلي متكامل  
**المرجع:** الجرد السابق `docs/REUSE.md` + `proposals/0002` + `docs/STATUS.md` + `REVIEW.md` + `engines/*` + `proposal 0007`

> **لا كود قبل هذه الموافقة.** هذه الخطة تحسم التناقضات، تحدد النطاق بدقة، وتثبت تسلسلاً يسمح بالعمل المتوازي دون تضارب ملفات.

---

## 1) حسم التناقضات — قبل تحديد النطاق

### 1.1: 7 أنظمة + 7 مواقع + Windows مقابل "14 كرتاً"

**الحقيقة الموثقة:**
- `prototypes/nilesys/public/assets/js/home.js:SYSTEMS` = 7 أنظمة (courts, pos, inventory, restaurant, clinic, hr, admin) — `prototypes/nilesys/public/index.html:63-70` `#systemsGrid`
- `SITES` = 7 مواقع (courts, restaurant, clinic, realestate, gym, mobile, fashion) — `#sitesGrid` [87-95]
- `WINDOWS` = 5 برامج ويندوز (pos, inventory, restaurant, clinic, hr) — `#winGrid` [94] مع شارة `common.soon`
- `REVIEW.md` ذكر "7 أنظمة + 7 مواقع + قسم Windows" — صحيح كأقسام، لكن **14 كرتاً = الأنظمة (7) + المواقع (7)**، و Windows قسم إضافي (5 بلاطات "قريباً") — ليس 15 كرتاً موحداً

**القرار للحطة:** **Phase 1 تعرض 14 كرتاً (7+7) كمنظومة، وWindows كقسم منفصل بـ 5 بلاطات "قريباً"** — مطابق للتجربة `home.js:SYSTEMS/SITES/WINDOWS` — لا نفترض 7+7 كـ نطاق نهائي لكل شيء.

### 1.2: سلوك Idempotency — طلب مطابق vs متضارب

**الحقيقة الموثقة:**
- `engines/transactions/src/sale-service.ts:96-99` — نفس `idempotencyKey` + نفس الجسم (hash مطابق) → `replayed: true` → `apps/api/src/controllers.ts:SalesController.create` يرد **200** (إعادة) مقابل **201** (جديد)
- نفس المفتاح + جسم مختلف → `DomainError('idempotency_conflict')` → `apps/api/src/http.ts:60` يحولها إلى **409 ConflictException** — مثبت بـ `proposal 0007 §3 I6` واختبار `e2e-sale.test.ts` على `main`
- النمط: `unique(tenant_id, idempotency_key)` + `request_hash` في `engines/transactions/src/db/schema.ts:sales_transactions`

**القرار للخطة:** نطبق **نفس القاعدة الموثقة** على كل أوامر POS الجديدة (checkout, refund, openShift, closeShift) — لا نخترع قاعدة جديدة.

### 1.3: هل يمكن إعادة استخدام السكيمة/الخدمات الحالية بأمان؟

**الحقيقة الموثقة:**
- `engines/catalog/src/db/schema.ts:catalog_items` — يحتوي `priceMinor, compareAtMinor` **فقط** — **لا يوجد `costMinor`** — لذلك تكلفة المنتج غير موثوقة
- `engines/transactions/src/db/schema.ts:sales_transactions` — `kind (sale|return)`, `status (posted|void)` لكن `void` سيصبح غير قابل للوصول بعد `PR #4` (F4 في `proposals/0007 §1`) لأنه يتطلب UPDATE
- `cash_movements` — `shift_id NOT NULL` لكن **لا يوجد جدول `cash_shifts`** ولا مفتاح أجنبي، ولا رابط `payment_id/refund_id`، و `status pending→posted` مستحيل بعد `PR #4` (REVOKE UPDATE) — `proposals/0007 §1 F2,F4`
- `stockMovements.costPerUnitMinor` موجود لكن يُملأ فقط عند الشراء (غير موجود في POS)
- `proposal 0007 §4` يقترح **migration `0003_payments`** بـ 5 جداول جديدة + تعديل `cash_movements` + `REVOKE` لكل جدول جديد

**القرار للخطة:** **لا يمكن إعادة استخدام السكيمة الحالية كما هي للمدفوعات/المرتجعات/الورديات/الربح** — نحتاج `0003_payments` كما هو مقترح في `proposal 0007` — وإلا نكسر append-only ونفقد تتبع الدرج. **الربح (profit) محجوب حتى تتوفر `costPerUnitMinor` موثوق** (انظر §2).

---

## 2) الدلالة المالية — لا نخلط صافي المبيعات بالربح

| المصطلح | التعريف الدقيق | المصدر الموثق | الحالة في POS |
|---|---|---|---|
| **إجمالي البيع (gross)** | `Σ lineTotalMinor` من `priceSale()` — سعر الكتالوج × كمية، مقرب لكل سطر | `engines/transactions/src/sale.ts:priceSale` + `money-bridge.ts` | ✅ موثق — 27 اختبار ذهبي |
| **صافي المبيعات (net sales)** | `gross - Σ refunds` (مرتجعات جزئية/كلية) — **مشتق، لا يُخزن** | `proposals/0007 §3 I10` (حالة الدفع مشتقة) | ✅ نحسبه كاستعلام — لا عمود جديد |
| **المدفوعات (tenders)** | `payments (method, amountMinor, tenderedMinor, changeMinor)` — كل طريقة دفع سجل منفصل، `Σ tender - change = total` | `proposals/0007 §3 I1,I2` + `schema:payments` | ✅ سنبنيه في `0003` — ليس موجوداً الآن |
| **تكلفة البضاعة (COGS)** | `Σ qty × costPerUnitMinor` — **المصدر الوحيد الموثق هو `stockMovements.costPerUnitMinor` عند الشراء** (غير موجود في `catalog_items`) | `engines/transactions/src/db/schema.ts:stockMovements` | ⚠️ **محجوب — لا بيانات تكلفة موثوقة في الكتالوج الحالي** |
| **مجمل الربح (gross profit)** | `net sales - COGS` — **لا نحسبه ولا نعرضه حتى تتوفر COGS** | `engines/transactions/src/costing.ts:computeSaleProfit` (يرجع `uncomputable:true` إذا `avgCostPerKg=0`) | 🔴 **محظور/مستبعد في Phase 1-4** — نعرض صافي مبيعات فقط، ونضع لافتة "الربح غير متاح حتى تسجيل تكلفة الشراء" |

> **لا نعادل net sales بـ profit.** `REVIEW.md` أظهر DIAG-2 (تقرير يحسب مرتجع جزئي بكامل قيمته) — سنصلحه بحساب `net`، لكن لن ندّعي ربحاً بدون تكلفة.

---

## 3) النطاق الدقيق والمراحل — 4 مراحل مترابطة

### سجل الأدلة المختصر (ماذا اعتمدنا)

| الحالة | أمثلة | المصدر |
|---|---|---|
| **موثق (Verified)** | بيع ذري مع idempotency + RLS FORCE + عزل مستأجرين + 27 ذهبي فلوس | `sale-service.ts:recordSale` + `docs/STATUS.md:91/91` + `REUSE.md` |
| **مفقود (Missing)** | خدمة/ API مرتجعات، ورديات، تقارير، مدفوعات | `STATUS.md: Not implemented refunds, cash shifts, reports` |
| **محجوب (Blocked)** | `pending→posted` UPDATE بعد PR #4، profit بدون تكلفة | `proposal 0007 §1 F4,F5` + §1.3 |
| **لم يُفحص (Not checked)** | شكل فاتورة مطبوعة، ترجمة كاملة | لا مصدر — مؤجل |

---

### Phase 1: عرض المنظومة داخل تصميم LENA الحالي (لا منطق أعمال)

**الملفات/الوحدات المتوقع تغييرها (بناءً على أدلة):**
- `apps/marketing` **أو** `platform/artifacts/lena/src/pages` — إضافة قسم `#nile-systems` يعرض `SYSTEMS+SITES` كبيانات فقط (لا منطق) — **نحافظ على `AppShell.tsx`, `SystemGrid.tsx`, `SeoHead.tsx` كما هي** — دليل: `REUSE.md` §3.4 "UI shells per system ... screens last"

**التبعيات والمتطلبات المسبقة:** لا شيء — مستقل تماماً

**المخرجات المرئية للمستخدم:**
- LENA الرئيسية تعرض 14 كرتاً (7+7) + Windows 5 بلاطات "قريباً" — نفس تخطيط `prototypes/nilesys` لكن بتصميم LENA
- ضغط أي كرت غير POS → صفحة "قريباً — تواصل للتجربة" (نفس badge `common.soon`)

**الاختبارات المطلوبة (بما فيها عزل وحالات فشل):**
- `SystemGrid.test.tsx` — 14 كرتاً تُرسم، `ready:false` → badge "قريباً"
- `i18n.test.ts` — تبديل عربي/إنجليزي يعكس `dir=rtl`

**معايير القبول (Pass/Fail):**
- [ ] 14 كرتاً مرئية بالعناوين العربية/الإنجليزية المطابقة لـ `home.js` — **Pass:** screenshot مطابق
- [ ] لا تغيير في `lib/db`, `auth`, `tenancy` — **Fail:** أي تعديل يرفض
- [ ] `pnpm --filter marketing build` 0 أخطاء

**المخاطر وحدود التراجع والقرارات التي تحتاج موافقتك:**
- خطر: تفسير 7+7 كـ نطاق نهائي — **التراجع:** بيانات فقط، لا سكيمة — حذف القسم يعيد LENA كما كانت
- قرار يحتاج موافقتك قبل Phase 2: هل نبني `apps/marketing` في `nilesys` أم نعدّل `platform/artifacts/lena` مباشرة؟ (يقترح: `nilesys/apps/marketing` — لا نغير `platform` بدون إذن)

---

### Phase 2: إكمال POS — بيع + تسجيل دفع + إيصال + حركة مخزون

**الملفات/الوحدات (مبنية على أدلة):**
- **جديد:** `engines/db/migrations/0003_payments.sql` (من `proposal 0007 §4`) — جداول `cash_shifts, cash_shift_closures, payments, refunds, cash_movement_resolutions` + تعديل `cash_movements` (إضافة `payment_id, refund_id, FK shift`) + `REVOKE UPDATE,DELETE` لكل جديد
- **توسعة:** `engines/transactions/src/sale-service.ts` → `checkout()` (بيع + مدفوعات + حركات درج في معاملة واحدة) — يحل محل `recordSale` للـ POS — دليل: `proposal 0007 §5`
- **توسعة:** `apps/api/src/controllers.ts` — `POST /checkout`, `POST /shifts`, `POST /shifts/:id/close`, `GET /shifts/:id/drawer`
- **جديد:** `engines/transactions/src/checkout.ts` (منطق I1,I2)

**التبعيات:** PR #4 مدمج (append-only) — **محجوب حتى موافقتك على دمجه** — بدونه `pending→posted` لا يزال يعمل لكننا سنبني على النمط الجديد (insert-only) مباشرة

**المخرجات المرئية:**
- POS داخل LENA: بحث/باركود/سلة → اختيار دفع (كاش/بطاقة/محفظة/تحويل) → إيصال قابل للطباعة `GET /sales/:id`

**الاختبارات المطلوبة:**
- `checkout.test.ts` — بيع كامل الدفع: `Σ tenders - change = total`, `change>0` فقط من كاش، `change ≤ tendered`, `tendered>0`, `amount>0` — **I1,I2,I8**
- `rls.test.ts` توسعة — مستأجر B لا يقرأ/يشير لبيع/dفع/وردية مستأجر A — **I7**
- `idempotency.test.ts` — نفس `checkout` بنفس المفتاح → 200 replay، مفتاح نفسه بجسم مختلف → 409 — **I6**
- `concurrency.test.ts` (على PostgreSQL حقيقي بمنفذين — ليس PGlite) — فتح ورديتين متزامن → وردية واحدة — **I9,I12**
- `privileges.test.ts` — كـ `nile_app`، `UPDATE/DELETE` تفشل على كل جدول جديد — **I4**

**معايير القبول:**
- [ ] بيع + دفع كاش مع باقي → `cash_movements` سجل واحد في وردية مفتوحة لنفس المستأجر/السجل — **I3**
- [ ] بيع بطاقة بدون وردية → ينجح (لا حاجة لدرج)
- [ ] مستأجر B → `POST /checkout` بـ `variantId` لمستأجر A → 404 `unknown_item`
- [ ] مخزون يمنع السالب: `stock 2` → بيع 3 → 409 `insufficient_stock` (موجود في `sale-service.ts:4 Atomic stock decrement`)

**المخاطر/التراجع/القرارات:**
- خطر: G-4 (لا CHECK على جداول قديمة) — **لا نصلحه الآن** — فقط جداول جديدة تحصل `CHECK` — القرار: موافقتك على migration `0003` كما هو في `proposal 0007 §4`
- تراجع: إسقاط `0003` يعيد بيعاً بدون دفع (الحالة الحالية) — آمن
- قرارك: هل نسمح بـ 4 طرق دفع (كاش/بطاقة/محفظة/تحويل) كما في `proposal 0007 §7`؟ (افتراضي: نعم)

---

### Phase 3: مرتجعات جزئية/كلية مع عكس صحيح لمخزون ومالية

**الملفات:**
- **توسعة:** `engines/transactions/src/refund.ts` + `apps/api` → `POST /payments/:id/refunds` (مدير/مالك فقط) — يكتب `refunds` + `stockMovements in` + `cash_movements` (إذا كاش) — دليل: `proposal 0007 §2 Out of scope: refunds` الآن داخل النطاق
- **تحديث:** `stock.movements` inbound يعكس المتوسط المرجح إذا توفرت تكلفة — وإلا `costPerUnitMinor = null` (الربح يبقى محجوب)

**التبعيات:** Phase 2 (جداول `payments` موجودة)

**المخرجات:**
- من فاتورة: اختيار سطر/كمية → مرتجع → المخزون +1 → مبلغ المرتجع ظاهر في الإيصال

**الاختبارات:**
- `refund.test.ts` — مرتجع جزئي → `stock +qty` + `net = gross - refunds` صحيح (يغلق `REVIEW.md DIAG-2`) + مرتجع يتجاوز دفع → 400 — **I5**
- تزامن مرتجعين على نفس الدفع → لا يتجاوز المبلغ — **I5+I9**

**معايير القبول:**
- [ ] بيع 2×10 → مرتجع 1×10 → `stock` عاد + `net=10` (لا 20) — **Pass**
- [ ] مرتجع كاش → `cash_movements out` في نفس الوردية المفتوحة — **I3**
- [ ] مستأجر B لا يرتجع دفع مستأجر A — 404

**المخاطر/القرارات:**
- خطر: `DIAG-1` (مرتجع لا يُخصم من الوردية) — نغلقه هنا — التراجع: حذف سطر مرتجع
- قرارك: هل المرتجع يحتاج موافقة مدير؟ (proposal 0007: نعم — نفترض نعم حتى توافق)

---

### Phase 4: ورديات + مطابقة درج + تقارير دقيقة

**الملفات:**
- **توسعة:** `engines/transactions/src/shifts.ts` — `openShift`, `closeShift`, `getDrawer` (يستخدم `cash.ts:computeDrawer` الموجود) + `cash_movement_resolutions` لحل pending — دليل: `cash.ts` موجود ومختبر (G-10, G-11)
- **جديد:** `apps/api/src/reports/summary.ts` — استعلام `net sales` و `expectedInDrawer` — لا عمود ربح

**التبعيات:** Phase 2 (ورديات)

**المخرجات:**
- فتح وردية (opening) → كل مدفوعات كاش/مرتجعات كاش تكتب في درجها → إغلاق بعدّ درج → فرق `counted - expected` + ملخص يومي (صافي مبيعات، عدد فواتير، طرق دفع) — **بدون ربح**

**الاختبارات:**
- `drawer.test.ts` — `cash.ts` الذهبي لا يزال أخضر + pending لا يحسب كإيراد — **I11**
- `shift.test.ts` — إغلاق مرتين بنفس المفتاح → idempotent (200 replay)
- `report.test.ts` — بيع 60 - مرتجع 10 + بيع 20 → `net=70` (لا 80) — يغلق `REVIEW.md DIAG-2` + `REPORT DIAG-1`

**معايير القبول:**
- [ ] وردية: `opening 100` + بيع كاش 60 - مرتجع كاش 10 → `expected=150` → عد 150 → `diff=0`
- [ ] وردية مفتوحة ثانية لنفس السجل → 409 — **I12**
- [ ] تقرير يومي: `net` مشتق وليس مخزن — **I10**

**المخاطر/القرارات:**
- خطر: `F5` (لا row-lock بعد PR #4) — نستخدم `pg_advisory_xact_lock` كما في `proposal 0007 §3 I9` — لا تغيير بنية
- قرارك: هل نعرض صافي مبيعات فقط في التقارير حتى تتوفر تكلفة موثوقة؟ (موصى: نعم)

---

## 4) تسلسل يعتمد على التبعيات — يسمح بالتوازي دون تضارب

```
Phase 1 (عرض المنظومة) ──────────────────────────┐
                                                 │ لا تبعيات — يعمل بالتوازي
Phase 2 migration 0003 + checkout  ───────────────┤  ↘
                                                 ├──→ Phase 3 (مرتجعات) ─→ Phase 4 (ورديات/تقارير)
Phase 2 API (controllers) ───────────────────────┘  ↗  (Phase 3 و 4 يشاركان نفس migration لكن ملفات مختلفة)
```

- **العمل المتوازي الحقيقي:** Phase 1 (واجهة فقط) يمكن تنفيذه بالتوازي مع إعداد migration `0003` (ملفات مختلفة تماماً: `apps/marketing` vs `engines/db/migrations`)
- **لا يحرر نفس الملفات:** `sale-service.ts` (Phase 2) vs `refund.ts` (Phase 3) vs `shifts.ts` (Phase 4) — كل مرحلة ملف جديد، لا تضارب
- **لا تكرار فحوص:** `rls.test.ts` يُوسع مرة واحدة في Phase 2 ويُعاد استخدامه — لا نعيد `91/91` بدون سبب

---

## 5) العوائق الموثقة والقرارات المتبقية — نقطة الموافقة

**عوائق موثقة (تمنع التنفيذ الكامل حتى تحسم):**
- **PR #4 غير مدمج** — `docs/STATUS.md:/PR #4 OPEN` — يحجب `0003` (append-only) — **قرارك: دمج PR #4؟** (مستند المراجعة `reviews/2026-10-14-pr4-review.md`)
- **تكلفة المنتج غير موثقة** — `catalog_items` بلا `costMinor` — الربح محجوب — **قرارك: هل نسجل تكلفة الشراء في Phase 2 أو نبقي الربح مستبعداً؟**
- **G-4 (لا CHECK على جداول قديمة) + G-10 (لا EXCLUDE للحجز)** — ليسا عائق POS — مؤجلان صراحة

**قرارات تحتاج موافقتك قبل كتابة كود (لا نفترضها):**
1. هل نعتمد 14 كرتاً + Windows 5 كـ عرض منظومة (Phase 1)؟ 
2. هل نوافق على migration `0003` كما في `proposal 0007 §4` (5 جداول + REVOKE)؟
3. هل نعتمد 4 طرق دفع + مرتجع بموافقة مدير (proposal 0007 §7)؟
4. أين يبنى عرض المنظومة — `nilesys/apps/marketing` أم تعديل `platform/artifacts/lena`؟

---

### نقطة الموافقة

**لا كود قبل موافقتك الصريحة على:** النطاق المحدد أعلاه (14+5 عرض، POS بمراحله 2-4)، والدلالة المالية (صافي بدون ربح)، والمحاور 1.1-1.3 المحسومة، والقرارات الأربعة.

**بعد موافقتك:** نبدأ **Phase 1 فقط** (عرض المنظومة) بالتوازي مع تحضير `0003` — ثم نعرض نتيجة Phase 1 للمراجعة قبل الانتقال لـ Phase 2.

