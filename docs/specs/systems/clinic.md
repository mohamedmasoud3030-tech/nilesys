---
id: app-clinic
slug: clinic
order: 4
name: نظام العيادة
status: live
system: clinic
entry: /systems/clinic.html
users: manager, reception, doctor
tests: tests/clinic.test.js
api: /api/clinic/*
---
# نظام العيادة — مواصفة مستقلة

> الحالة: **مبني ويعمل**. المحرك `lib/clinic.js` (11/11 اختبار API) والشاشة `public/systems/clinic.html` (17/17 اختبار متصفح).

## 1) الغرض في سطر

الاستقبال يحجز، الطبيب يكتب الروشتة، والحساب يُحصَّل — وملف المريض واحد لا يتكرر.

## 2) المستخدمون

| المستخدم | يدخل بـ | يقدر يعمل | لا يقدر |
| --- | --- | --- | --- |
| مدير | `manager` | كل شيء: أطباء · أسعار · تقارير · إلغاء | — |
| استقبال | `reception` | حجز · تسجيل مريض · تحصيل · إعادة جدولة | كتابة روشتة أو تشخيص |
| طبيب | `doctor` | بدء كشف · تشخيص · روشتة · طلب متابعة | تعديل الأسعار أو المدفوعات |

## 3) الشاشات

| الشاشة | ماذا فيها |
| --- | --- |
| يوم العيادة | مواعيد اليوم بالترتيب · من وصل · من في الغرفة · الانتظار |
| المريض | ملف: بيانات · زيارات سابقة · روشتات · المدفوع والمتبقي |
| الحجز | اختيار طبيب ووقت · منع التعارض · مدة الكشف |
| الكشف | شكوى · تشخيص · روشتة (دواء/جرعة/مدة) · متابعة بعد كم يوم |
| التحصيل | سعر الكشف · مدفوع · طريقة الدفع · إيصال |
| الأطباء والأسعار | طبيب · تخصص · سعر الكشف · أيام العمل |
| التقارير | عدد الكشوف · الإيراد · نسبة عدم الحضور · أكثر التشخيصات |

## 4) نموذج البيانات

| المجموعة | الحقول |
| --- | --- |
| `patients` | `id` · `code` · `name` · `phone` (فريد) · `gender` · `birthYear` · `notes` · `createdAt` |
| `doctors` | `id` (مرتبط بمستخدم النظام) · `name` · `specialty` · `fee` |
| `appointments` | `id` · `patientId` · `doctorId` · `at` · `minutes` · `status` (`booked`/`arrived`/`in_room`/`done`/`no_show`/`cancelled`) · `fee` · `paid` · `method` |
| `visits` | `id` · `appointmentId` · `patientId` · `doctorId` · `complaint` · `diagnosis` · `prescription[]` · `followUpAt` · `at` |
| `prescription[]` | `drug` · `dose` · `duration` · `notes` |

## 5) الواجهات

```
GET|POST /api/clinic/patients            { name, phone, gender, birthYear }
GET  /api/clinic/patients/:id            ← ملف كامل بزياراته
GET|POST /api/clinic/doctors             { name, specialty, fee }   (manager)
GET  /api/clinic/appointments?date=
POST /api/clinic/appointments            { patientId, doctorId, at, minutes }
POST /api/clinic/appointments/:id/status { status }
POST /api/clinic/appointments/:id/pay    { method, amount }
POST /api/clinic/appointments/:id/visit  { complaint, diagnosis, prescription[], followUpAt }
GET  /api/clinic/summary?range=today
```

## 6) القواعد

1. موعدان لنفس الطبيب متعارضان زمنياً → 409.
2. لا كشف بلا موعد «وصل» — البدء يتطلب `arrived`.
3. الروشتة تُكتب مرة واحدة لكل زيارة، والزيارة لا تُعدَّل بعد التحصيل إلا بمدير.
4. التحصيل النقدي يدخل درج وردية العيادة؛ البطاقة لا تمسّ الدرج.
5. موبايل المريض فريد — تسجيل مريض موجود يعيد ملفه لا يكرره (409 مع المعرّف).
6. عدم الحضور يُسجَّل ولا يُحصَّل.

## 7) معايير القبول

- [x] موعدان متعارضان لنفس الطبيب → 409
- [x] بدء كشف قبل وصول المريض → 400
- [x] تسجيل موبايل مكرر → 409 يحمل معرّف المريض الموجود
- [x] روشتة بحبتين تُحفظ وتُقرأ كاملة في ملف المريض
- [x] تحصيل كاش 300 يظهر في درج وردية العيادة
- [x] طبيب يحاول التحصيل → 403
- [x] عدم الحضور لا يزيد الإيراد
- [x] إعادة جدولة موعد لا تفقد ملف المريض

## 8) كيف يُثبت ذلك

```sh
BASE=http://localhost:4000 node --test tests/clinic.test.js                   # 11/11
BASE=http://localhost:4000 sh tools/setup-browser.sh tools/ui-clinic.js      # 17/17
```

نتيجة آخر تشغيل: **11/11** للـ API و**17/17** للمتصفح، وصفر أخطاء JavaScript.

---

## حالة التنفيذ والصدق المهني (قانوني — يُحدَّث مع أي تغيير)

| البند | القيمة |
|---|---|
| رابط حي | `https://nilesys-seven.vercel.app/systems/clinic.html` (وعلى مشروع الديمو `nilesys-demo.vercel.app`) |
| تنفيذ العرض الحالي | `prototypes/nilesys` — خادم Node خام (`server.js` + `lib/`)، تخزين ملفي/Supabase demo_state |
| محرك الإنتاج المقابل | booking (مواعيد) + platform (أدوار) |
| واجهة إنتاجية فوق المحرك | **ليست مبنية بعد** — هذا هو مسار التقارب المعتمد في `PRODUCT_PLAN.md` |
| معايير القبول المُختبَرة | 8/8 (قسم «معايير القبول» في هذه المواصفة) |
| آخر تحقق | 2026-10-21 — اختبارات 156/156 + فحص حي 200 |

> **قاعدة:** هذه المواصفة تصف السلوك المطلوب والمُثبَت في العرض. لا تُقرأ على أنها ادعاء منتج إنتاجي؛
> حالة الإنتاج الحقيقية لكل نظام مسجلة في `../../STATUS.md` فقط.

## 9) خارج النطاق الآن

- التأمين الطبي والمطالبات.
- ربط بالمعمل والأشعة.
- تطبيق حجز للمرضى.
