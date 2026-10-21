---
id: app-courts
slug: courts
order: 5
name: نظام حجز الملاعب
status: live
system: courts
entry: /systems/courts.html
users: manager, reception
tests: tests/courts.test.js
api: /api/courts/*
---
# نظام حجز الملاعب — مواصفة مستقلة

> الحالة: **مبني ويعمل**. المحرك `lib/courts.js` (10/10 اختبار API) والشاشة `public/systems/courts.html` (14/14 اختبار متصفح).

## 1) الغرض في سطر

تعرف الملعب فاضي ولا محجوز في الساعة دي قبل ما ترد على التليفون — والعربون محسوب.

## 2) المستخدمون

| المستخدم | يدخل بـ | يقدر يعمل | لا يقدر |
| --- | --- | --- | --- |
| مدير | `manager` | كل شيء: ملاعب · أسعار · إلغاء · تقارير | — |
| استقبال | `reception` | حجز · تأكيد · تحصيل عربون · إلغاء بالسياسة | تغيير الأسعار |

## 3) الشاشات

| الشاشة | ماذا فيها |
| --- | --- |
| جدول اليوم | كل ملعب × كل ساعة: فاضي · محجوز · مدفوع · ملغي |
| الحجز | ملعب · تاريخ · من/إلى · اسم وموبايل · عربون · طريقة الدفع |
| الملاعب | اسم · نوع (خماسي/بادل) · سعر الساعة · مواعيد العمل |
| الحجوزات | بحث بالتاريخ أو الموبايل · تأكيد · إلغاء بسبب |
| التقارير | إشغال كل ملعب · إيراد · عربونات · أكثر الأوقات طلباً |

## 4) نموذج البيانات

| المجموعة | الحقول |
| --- | --- |
| `courts` | `id` · `name` · `kind` (`football`/`padel`) · `pricePerHour` · `openFrom` · `openTo` · `active` |
| `bookings` | `id` · `no` · `courtId` · `date` · `from` · `to` · `customerName` · `phone` · `amount` · `deposit` · `method` · `status` (`held`/`confirmed`/`played`/`cancelled`) · `note` |

## 5) الواجهات

```
GET|POST /api/courts                     { name, kind, pricePerHour, openFrom, openTo }
GET  /api/courts/grid?date=YYYY-MM-DD    ← الملاعب × الساعات
GET|POST /api/courts/bookings            { courtId, date, from, to, customerName, phone, deposit, method }
GET  /api/courts/bookings?q=              ← بحث بالاسم أو الموبايل
POST /api/courts/bookings/:id/confirm
POST /api/courts/bookings/:id/cancel     { reason }
POST /api/courts/bookings/:id/play       ← تسجيل أن الحجز لُعب
GET  /api/courts/summary?range=today
```

## 6) القواعد

1. لا تعارض: أي تقاطع زمني على نفس الملعب ونفس اليوم → 409.
2. الحجز داخل مواعيد عمل الملعب فقط، ومدة لا تقل عن ساعة وبمضاعفات النصف ساعة.
3. العربون لا يتجاوز قيمة الحجز، والحجز بلا عربون يبقى `held` وينتهي تلقائياً بعد ساعة إن لم يُؤكَّد.
4. الإلغاء قبل 12 ساعة يعيد العربون (حركة درج سالبة معتمدة)، وبعدها لا.
5. السعر يُحسب من سعر الملعب في الساعة × المدة، ولا يُقبل سعر من المتصفح.
6. العربون النقدي يدخل درج وردية الملاعب.

## 7) معايير القبول

- [x] حجز متقاطع → 409
- [x] حجز خارج مواعيد العمل → 400
- [x] مدة 25 دقيقة → 400
- [x] الإلغاء داخل 12 ساعة لا يعيد العربون، وخارجها يعيده بحركة درج
- [x] السعر يتغير بتغيير سعر الملعب، ولا يُقبل من المتصفح
- [x] حجز `held` لم يُؤكَّد يظهر منتهياً في الجدول
- [x] الإشغال في التقرير = دقائق محجوزة ÷ دقائق متاحة

## 8) كيف يُثبت ذلك

```sh
BASE=http://localhost:4000 node --test tests/courts.test.js                 # 10/10
BASE=http://localhost:4000 sh tools/setup-browser.sh tools/ui-courts.js     # 14/14
```

نتيجة آخر تشغيل: **10/10** للـ API و**14/14** للمتصفح، وصفر أخطاء JavaScript.

## 9) خارج النطاق الآن

- الحجز الذاتي من الموقع للعملاء.
- الاشتراكات الشهرية للفرق.
- ربط بإضاءة الملعب أو بوابته.
