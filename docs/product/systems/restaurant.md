---
id: app-restaurant
slug: restaurant
order: 3
name: نظام المطعم
status: live
system: restaurant
entry: /systems/restaurant.html
users: manager, waiter, kitchen
tests: tests/restaurant.test.js
api: /api/restaurant/*
---
# نظام المطعم — مواصفة مستقلة

> الحالة: **مبني ويعمل**. المحرك `lib/restaurant.js` (14/14 اختبار API) والشاشة `public/systems/restaurant.html` (19/19 اختبار متصفح) — وكل معيار قبول تحته دليل يُعاد تشغيله بأمر واحد.

## 1) الغرض في سطر

الطلب يتكتب على الترابيزة، يوصل للمطبخ في نفس اللحظة، ويُحاسب مرة واحدة — بلا ورق يضيع ولا أوردر يتكرر.

## 2) المستخدمون

| المستخدم | يدخل بـ | يقدر يعمل | لا يقدر |
| --- | --- | --- | --- |
| مدير | `manager` | كل شيء: منيو · ترابيزات · إلغاء · خصم · تقارير | — |
| ويتر | `waiter` | فتح ترابيزة · إضافة أصناف · إرسال للمطبخ · تحويل الترابيزة · طلب الحساب | إلغاء أوردر مدفوع · تعديل المنيو · الخصم |
| شيف | `kitchen` | شاشة المطبخ · «بدأت» · «جاهز» | أي شيء مالي |

## 3) الشاشات

| الشاشة | ماذا فيها |
| --- | --- |
| الصالة | خريطة ترابيزات بحالاتها (فاضية · مشغولة · محجوزة · تحت التنضيف) ووقت الجلوس |
| الترابيزة | أصناف الطلب · ملاحظات لكل صنف · إرسال للمطبخ · تجميع الحساب |
| المنيو | أصناف المطعم بأقسامها ومحطة التحضير (مطبخ/بار) وتوفّرها |
| المطبخ | تذاكر حيّة: جديد · قيد التحضير · جاهز، بترتيب الوقت |
| الحجوزات | حجز باسم وموبايل وعدد أفراد ووقت |
| الحساب | تقسيم بالصنف أو بالتساوي · طرق الدفع الخمسة · إيصال وطباعة |
| التقارير | مبيعات اليوم · أكثر الأصناف · متوسط وقت التحضير · إشغال الترابيزات |

## 4) نموذج البيانات

| المجموعة | الحقول |
| --- | --- |
| `tables` | `id` · `name` · `seats` · `area` · `status` (`free`/`seated`/`reserved`/`dirty`) · `currentOrderId` · `seatedAt` |
| `menuItems` | `id` · `name` · `category` · `price` · `cost` · `station` (`kitchen`/`bar`) · `available` · `prepMinutes` |
| `orders` | `id` · `no` · `tableId` · `type` (`dine_in`/`takeaway`/`delivery`) · `items[]` · `status` (`open`/`served`/`paid`/`void`) · `openedAt` · `closedAt` |
| `order.items[]` | `menuItemId` · `name` · `qty` · `price` · `notes` · `station` · `state` (`new`/`cooking`/`ready`/`served`/`void`) · `sentAt` · `readyAt` |
| `reservations` | `id` · `tableId` · `at` · `name` · `phone` · `partySize` · `status` |

الطلب المسدَّد يكتب `payment` في نفس مجموعة مبيعات النظام، وحركة درج أصلها `restaurant`.

## 5) الواجهات

```
GET  /api/restaurant/tables
POST /api/restaurant/tables              { name, seats, area }        (manager)
POST /api/restaurant/tables/:id/status   { status }
GET  /api/restaurant/menu
POST /api/restaurant/menu                { name, price, station, category }  (manager)
PUT  /api/restaurant/menu/:id            { price, available, ... }    (manager)
GET  /api/restaurant/orders?tableId=&status=
POST /api/restaurant/orders              { tableId, type, items[] }
POST /api/restaurant/orders/:id/items    { items[] }
POST /api/restaurant/orders/:id/send     ← يثبت الأصناف ويولّد تذاكر المطبخ
PATCH /api/restaurant/orders/:id/items/:lineId { state }              (kitchen)
PATCH /api/restaurant/orders/:id/items/:lineId { qty }                (قبل الإرسال فقط)
POST /api/restaurant/orders/:id/pay      { method, paid, discount, split }
POST /api/restaurant/orders/:id/void     { reason }                   (manager)
GET  /api/restaurant/kitchen             ← تذاكر مفتوحة مرتّبة بالوقت
GET|POST /api/restaurant/reservations
GET  /api/restaurant/summary?range=today
```

## 6) القواعد

1. ترابيزة واحدة لا تحمل طلبين مفتوحين. فتح طلب على مشغولة → 409.
2. الصنف يُرسل للمطبخ مرة واحدة؛ إرساله مرتين لا يضاعف الكمية ولا يولّد تذكرة ثانية.
3. لا يمكن الدفع قبل إرسال كل الأصناف (`new` → مرفوض حتى تُرسل)، ولا يُدفع طلب مسدَّد مرتين.
4. إلغاء صنف بعد بدء تحضيره يحتاج مدير، ويُسجَّل باسمه وسببه.
5. الدفع يحرّر الترابيزة إلى `dirty`، والتنضيف يرجّعها `free`.
6. الدفع النقدي يدخل الدرج بضبط النفس؛ غير النقدي يُسجَّل ولا يمسّ الدرج.
7. الحجز المتعارض على نفس الترابيزة في نفس الوقت → 409.

## 7) معايير القبول

- [x] فتح طلب على ترابيزة مشغولة → 409
- [x] إرسال طلب للمطبخ مرتين → تذكرة واحدة وبنفس الكميات
- [x] دفع طلب فيه صنف لم يُرسل → 400
- [x] دفع مرتين → 400 والرصيد لا يتضاعف
- [x] إلغاء صنف بعد التحضير بالويتر → 403، وبالمدير → يمر ويُسجَّل
- [x] الدفع النقدي يظهر في درج وردية المطعم بالضبط
- [x] حساب مقسوم على 3 → مجموع الأجزاء = الإجمالي بالقرش
- [x] حجز متعارض → 409
- [x] شاشة المطبخ لا تعرض إلا ما يستحق التحضير ومرتّباً بالأقدم
- [x] منيو غير متوفّر لا يُباع → 400

## 8) كيف يُثبت ذلك

```sh
BASE=http://localhost:4000 node --test tests/restaurant.test.js   # 14/14
BASE=http://localhost:4000 sh tools/setup-browser.sh tools/ui-restaurant.js   # 19/19
```

نتيجة آخر تشغيل: **14/14** للـ API و**19/19** للمتصفح، وصفر أخطاء JavaScript.

## 9) خارج النطاق الآن

- التطبيق الخارجي للتوصيل (ت Aggregator).
- شاشة مطبخ على طابعة حرارية.
- حساب البقشيش وتوزيعه.
