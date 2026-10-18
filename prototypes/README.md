# prototypes/ — نماذج أولية ومراجع

> **Status: HISTORICAL / REFERENCE (English summary, 2026-10-14).** `prototypes/nilesys` is the first
> working Nile demo: plain Node.js, JSON-file storage, no tenancy. It is **not** the production code path;
> that path is `engines/` + `apps/api` (see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)). It stays as
> the reference for Arabic/RTL UX, the bilingual dictionary and cashier behaviour, to be reused when
> product UIs are built on top of tested engines. It does not override any ADR. The Arabic text below is
> the original; an English translation is a tracked follow-up in [`docs/STATUS.md`](../docs/STATUS.md).

هذا المجلد يحتوي **نماذج أولية عاملة (prototypes)** بُنيت لدراسة المتطلبات
واستخلاص القرارات المعمارية. **ليست هي كود الإنتاج.**

## prototypes/nilesys — منصة «نيل سيستمز»

منصة demo كاملة (موقع تسويقي + نظام كاشير) بُنيت بسرعة بـ **Node.js خالص
بدون أي مكتبات خارجية** لاختبار الفكرة والتجربة الحقيقية للاستخدام.

### لماذا هي prototype وليست الإنتاج

| المعيار | الـ prototype (nilesys) | هدف المصنع (حسب ADRs) |
|---|---|---|
| Stack | Node خالص + HTML/CSS/JS | TypeScript · NestJS + Next.js + Nx (ADR-0001) |
| قاعدة البيانات | ملف JSON واحد | PostgreSQL + ORM (ADR-0004) |
| تعدد المستأجرين | لا يوجد | Tenant context + RLS (ADR-0005) |
| المصادقة | جلسات في الذاكرة، كلمات مرور نص صريح | Auth + عضوية منظمات (ADR-0005) |
| حدود الوحدات | غير مفروضة | مفروضة آلياً في CI (ADR-0001) |

### قيمة هذا الـ prototype للمصنع

1. **مراجعة هندسية موثقة (`prototypes/nilesys/REVIEW.md`)** — 30 سيناريو
   اختباري فعلي، نتيجتها: 24 سلوكاً صحيحاً و6 مشاكل مؤكدة، مع خطة إصلاح
   مرتبة بالخطورة. مشاكل الـ Critical فيه (كلمات المرور النصية، غياب عزل
   المستأجرين، المرتجعات الجزئية في التقارير) هي بالضبط ما تعالجه ADR-0005
   وهيكل الوحدات في ADR-0001 — أي أن الـ prototype **تحقّق من صحة القرارات**.
2. **تصميم وتجربة مستخدم عربية (RTL) مُجرَّبة** — نظام تصميم وقاموس
   عربي/إنجليزي جاهزان لإعادة الاستخدام في Design System الخاص بـ Milestone 1.
3. **متطلبات مجال حقيقية** — منطق الكاشير (ورديات، مرتجعات، خصومات، تقارير)
   موثّق كمتطلبات مرجعية لوحدة Sales/Business Management.

### التشغيل (للتجربة فقط)

```bash
cd prototypes/nilesys
node server.js        # → http://localhost:3000 (حسابات التجربة: manager/cashier · demo1234)
```

### الاختبارات

```bash
cp -r prototypes/nilesys /tmp/nilesys-review && cd /tmp/nilesys-review
PORT=3210 node server.js &
BASE=http://localhost:3210 node --test tests/review.test.js
```
