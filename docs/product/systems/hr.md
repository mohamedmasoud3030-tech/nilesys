---
id: app-hr
slug: hr
order: 6
name: نظام الموارد البشرية
status: planned
system: hr
entry: /systems/hr.html
users: manager, hr, employee
tests: tests/hr.test.js
api: /api/hr/*
---
# نظام الموارد البشرية — مواصفة مستقلة

> الحالة: **لم يُبنَ بعد**. هذه المواصفة هي ما سيُبنى بالضبط.

## 1) الغرض في سطر

حضور الموظف وانصرافه، وأجر الشهر محسوب بالنقص والزيادة قبل يوم الصرف لا بعده.

## 2) المستخدمون

| المستخدم | يدخل بـ | يقدر يعمل | لا يقدر |
| --- | --- | --- | --- |
| مدير | `manager` | كل شيء: موظفون · مرتبات · اعتماد · صرف | — |
| موظف موارد بشرية | `hr` | تسجيل حضور · إجازات · تجهيز مرتب · اعتماد | صرف المرتب أو تعديل الراتب الأساسي |
| موظف | `employee` | يرى حضوره ومسيّره الخاص | يرى بيانات غيره |

## 3) الشاشات

| الشاشة | ماذا فيها |
| --- | --- |
| لوحة اليوم | حاضر · متأخر · غائب · في إجازة · من لم يسجّل انصرافاً |
| الحضور | تسجيل دخول/خروج · تصحيح بسبب (بموافقة) |
| الموظفون | كود · اسم · وظيفة · راتب أساسي · بدلات · تاريخ تعيين · نشط |
| الإجازات | طلب · نوع (سنوية/مرضية/بدون أجر) · رصيد · موافقة/رفض |
| المرتبات | شهر · أساسي + بدلات + إضافي − غياب − تأخير − سلف = الصافي |
| المسيّر | كشف راتب مفرد قابل للطباعة |

## 4) نموذج البيانات

| المجموعة | الحقول |
| --- | --- |
| `employees` | `id` · `code` · `name` · `phone` · `jobTitle` · `baseSalary` · `allowances` · `hireDate` · `active` |
| `attendance` | `id` · `employeeId` · `date` · `in` · `out` · `status` (`present`/`late`/`absent`/`leave`) · `note` |
| `leaves` | `id` · `employeeId` · `from` · `to` · `kind` · `status` (`pending`/`approved`/`rejected`) · `reason` |
| `payroll` | `id` · `month` · `employeeId` · `base` · `allowances` · `bonus` · `absenceDeduction` · `lateDeduction` · `advance` · `net` · `status` (`draft`/`approved`/`paid`) |

## 5) الواجهات

```
GET|POST /api/hr/employees            { code, name, jobTitle, baseSalary, allowances }
PUT  /api/hr/employees/:id            { active, baseSalary, ... }        (manager)
POST /api/hr/attendance               { employeeId, date, in, out }
POST /api/hr/attendance/:id/fix       { in, out, reason }                (hr/manager)
GET  /api/hr/attendance?date=
POST /api/hr/leaves                   { employeeId, from, to, kind }
POST /api/hr/leaves/:id/decide        { approve: true|false }
POST /api/hr/payroll/run              { month }                          (hr/manager)
POST /api/hr/payroll/:month/approve
POST /api/hr/payroll/:month/pay       ← يكتب مصروفاً في الخزينة         (manager)
GET  /api/hr/payroll/:month
GET  /api/hr/me                       ← حضور ومسيّر الموظف نفسه
```

## 6) القواعد

1. تسجيل حضور مرتين لنفس الموظف ونفس اليوم → 409.
2. يوم بلا انصراف يُحسب «نصف يوم» حتى يُصحَّح بسبب موثّق.
3. الإجازة المعتمدة لا تُحسب غياباً، والمرفوضة تُحسب.
4. المرتب = أساسي + بدلات + إضافي − (غياب × قيمة اليوم) − تأخير − سلف.
5. مرتب مُعتمد لا يُعاد حسابه؛ ومرتب مصروف لا يُعدَّل إطلاقاً.
6. الموظف يرى سجله فقط — طلب سجل غيره → 403.
7. صرف المرتب يخصم من الخزينة مرة واحدة (مفتاح شهر).

## 7) معايير القبول

- [ ] حضور مكرر في نفس اليوم → 409
- [ ] يوم بلا انصراف يُحسب نصف يوم
- [ ] إجازة معتمدة لا تُخصم، ومرفوضة تُخصم
- [ ] مرتب شهر: أساسي 6000 + بدل 500 − غياب يومين (400) = 6100
- [ ] مرتب معتمد لا يُعاد حسابه؛ ومصروف لا يُعدَّل → 409
- [ ] الموظف يطلب سجل زميله → 403
- [ ] صرف شهر مرتين → 409 والخزينة لا تتأثر مرتين
- [ ] المسيّر المطبوع يحمل كل بنود الحساب

## 8) كيف يُثبت ذلك

```sh
npm test -- hr
node tools/ui-hr.js
```

## 9) خارج النطاق الآن

- بصمة أو كارت (التسجيل يدوي في هذه المرحلة).
- التأمينات والضرائب على المرتب.
- تقييم الأداء.
