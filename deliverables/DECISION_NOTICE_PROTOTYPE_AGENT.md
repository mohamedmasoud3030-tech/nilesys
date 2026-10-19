# إشعار قرار — إلى وكيل الـPrototype (`prototypes/nilesys`)

**الحالة: جاهز للتحويل — لم يُسلَّم بعد.** لا توجد قناة متاحة لي للوصول إلى هذا الوكيل:
- غير مسموح لي بفتح PR أو issue.
- غير مسموح لي باستخدام الـtoken.
- هوية الوكيل وفرعه غير معروفين.

**المطلوب من المالك:** تحويل هذا الملف إليه كما هو.

**المصدر:** قرار المالك بتاريخ 2026-10-18 (رد على `COORDINATION_RESOLUTION_2026-10-18.md`).

---

## القرار

**1. v2 مرجع للمقارنة التاريخية فقط.**
- v2 هو `prototypes/nilesys/tests/review.test.js` عند `099dc14`.
- **ليس** معيارًا لقبول السلوك القديم، فلا تُكتب اختبارات تثبّت العيوب الستة.

**2. عقد السلوك المستهدف** هو:
- `review.test.js` v3 عند `c72f746`؛
- مع `prototypes/nilesys/tests/regression.test.js` (16 اختبارًا).

**3. السيناريوهات الـ24 التي كانت صحيحة قبل الإصلاح يجب أن تستمر:**
AUTH-1..4، PERM-1/2، SALE-1/4/5/7، RET-1..4، SHIFT-1/3، RESET-1/3، VAL-1/2، SEC-1/2، PERSIST-1، SETUP.

**4. العيوب الستة تُختبر وفق السلوك المصحح:**

| السيناريو | السلوك المطلوب |
|---|---|
| PERM-3 | بيانات نقطة البيع لمستخدمي `system = pos` فقط، وإلا `403`. يشمل ذلك مدير نظام آخر |
| SALE-2 | البيع بأكثر من المخزون يُرفض بـ`409` ولا يتغير المخزون. تكرار نفس الصنف في السلة يُجمَع قبل الفحص |
| SALE-3 | **سياسة معتمدة:** الكاش الأقل من الإجمالي يُرفض بـ`400`. الكارت يُسجَّل بالإجمالي بالضبط |
| SALE-6 | الباركود المكرر بين الأصناف النشطة يُرفض بـ`409` |
| SHIFT-2 | المرتجع الجزئي الكاش داخل الوردية يُخصم من النقدية المتوقعة. الخصم يُوزَّع نسبيًا على المرتجع |
| RESET-2 | الجلسات تبقى صالحة بعد Reset، لأن معرّفات حسابات الديمو ثابتة |
| SEED-1 | لا توجد مبيعات بذور بتاريخ مستقبلي |

## قواعد التنسيق

- **ملفات قائمة لا تُكرَّر:** `server.js` و`tests/review.test.js` و`tests/regression.test.js` و`public/assets/js/pos.js` و`REVIEW.md` معدّلة على `feat/nile-mission3-pos-fixes-pg-tests`.
  - افحصها قبل إنشاء اختبارات موازية.
  - أي تعديل عليها يُنسَّق أولًا.
- **التشغيل:** `node tests/review.test.js` يعمل in-process ضد سيرفر على `BASE`، و`node --test tests/regression.test.js` معزول ذاتيًا.
  - لا تستخدم `node --test` مع review: مشغّل Node 20 يفشل أحيانًا مع المخرجات العربية.
- **مقارنة التكافؤ القابلة للتكرار:** `deliverables/parity/run-parity.sh`. نقله إلى المستودع **مؤجَّل** بقرار المالك.
- **آخر نتيجة** (`c72f746`):

  | التشغيلة | النتيجة |
  |---|---|
  | v3 بعد الإصلاح | 30/30 |
  | v3 قبل الإصلاح | 24 ✅ / 6 ❌ (تكشف العيوب الستة بالضبط) |
  | regression بعد الإصلاح | 16/16 |
  | regression قبل الإصلاح | 2/16 |

---

### English summary

v2 (`099dc14`) is the historical comparison reference only, not an acceptance standard. The target contract is review v3 (`c72f746`) plus `regression.test.js`.

The 24 previously-correct scenarios must keep passing. The six defects are tested against the corrected behaviour:
- PERM-3 → 403
- SALE-2 → 409, stock unchanged
- SALE-3 → 400 (approved policy)
- SALE-6 → 409
- SHIFT-2 → partial cash refunds reduce expected cash
- RESET-2 → sessions survive a reset

Check the existing files on `feat/nile-mission3-pos-fixes-pg-tests` before adding parallel tests.
