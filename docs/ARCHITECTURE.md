# Nile architecture: current state and decision status

**Status:** canonical (tier 3 in `AGENTS.md`). Describes `main` as verified at `ebcfe72` on 2026-10-14.
It summarises; when it disagrees with an accepted ADR, the ADR is right and this file must be fixed.
Live status of PRs, gates and findings: [`STATUS.md`](STATUS.md).

## 1. Shape of the system

```
apps/api  (NestJS + Fastify REST, OpenAPI)          ← HTTP, auth session → tenant context
   │
engines/*/src/*-service.ts  (application services)   ← transactions: recordSale/getSale; catalog: list
   │
engines/*/src/*.ts  (pure domain code)               ← money, lines, costing, cash drawer, booking rules, …
   │
engines/*/src/db/schema.ts → engines/db/migrations   ← Drizzle schemas → generated SQL
   │
PostgreSQL  (PGlite in tests and dev)                ← RLS on every tenant table, runtime role nile_app
```

- **Modular monolith in TypeScript** (ADR-0001). One API process serves every Nile system.
- **Tenancy** (ADR-0002, ADR-0005): one shared database. Every tenant-owned row carries `tenant_id`.
  Policies are fail-closed RLS with FORCE. The runtime role `nile_app` is not a superuser, cannot bypass
  RLS and owns no tables. The only tenant-scoped SQL path is `engines/platform/src/db/with-tenant.ts`, and
  `engines/db/open.ts` is the single migrate-then-connect path.
- **Auth and roles** (ADR-0005, ADR-0007): Better Auth with the Organization plugin. 14 demo roles are
  declared with Better Auth access control, and `can()` is evaluated server-side.
- **Money** (engines/transactions): integer minor units in storage and the API (`bigint`), Decimal
  arithmetic inside the domain, and conversion only in `money-bridge.ts`.
- **Accounting boundary** (ADR-0010): engines own operational records. Any ledger or tax provider is
  reached only through a provider-neutral port, and **no provider is chosen** (ADR-0008 is PROPOSED).
- **Localization** (ADR-0009): Arabic and RTL are first-class product requirements; repository language
  is English.

## 2. Engine status (verified against code at `ebcfe72`)

| Engine | Domain code + tests | DB schema | Service | API | Notes |
| --- | --- | --- | --- | --- | --- |
| platform | tenant context, idempotency, branding, locale, auth, permissions | `audit_log`, auth tables | n/a | `GET /api/v1/me` | Demo tenant provisioned on boot |
| transactions | money, lines, costing, cash drawer, regrade (golden tests) | sales, lines, stock and cash movements | `recordSale`, `getSale` | `POST /api/v1/sales`, `GET /api/v1/sales/:id` | **No payment recorded with a sale** (G-3); `cash_movements` unused |
| catalog | items, variants, stock states, discounts, installments, leads | items, variants, leads | list | `GET /api/v1/catalog/items` | |
| booking | resources, slots, overlap check, lifecycle | resources, bookings | none | none | Overlap is **not** enforced by the database (no `EXCLUDE`, G-10) |
| people | attendance, leave, loans, payroll | employees, attendance, leave, loans | none | none | |

Append-only protection for the five ledger tables is **open on `main`** and fixed on PR #4 (not merged).

## 3. Decision status

| ADR | Decision | Status | Known gap between the ADR and the code |
| --- | --- | --- | --- |
| 0001 | TypeScript modular monolith; NestJS/Fastify; Next.js; Nx + pnpm; PostgreSQL; boundaries enforced in CI | ACCEPTED | **Gap:** there is no Next.js app and **no CI**, so boundaries are not mechanically enforced. The Nx + pnpm part is superseded by `ADR-0011` (npm, 2026-10-19) |
| 0002 | Multi-tenant from day one; shared PostgreSQL for Milestone 1; each vertical independently deployable | ACCEPTED | **Gap:** one `apps/api` serves all systems; there are no per-vertical apps. Needs a decision when the first product UI is built |
| 0003 | Milestone 1 = Sales walking skeleton (auth, tenancy, customers, audit, migrations, design-system UI, tests, CI, boundaries) | ACCEPTED | **Gap:** no customer/party module, no design-system UI, no CI, no boundary enforcement. Auth, tenancy, audit, migrations and tests exist |
| 0004 | Drizzle ORM + Drizzle Kit | ACCEPTED | none known |
| 0005 | Better Auth organizations; tenant context; RLS as the security boundary | ACCEPTED | Open gate findings G-5 (dev-mode origin, secret, cookies, rate limit) and G-7 (role assertion; fixed on branch `fix/g7-runtime-role-assertion`, not merged) |
| 0006 | REST + OpenAPI | ACCEPTED | G-11: `/api/openapi.json` is public; not yet an explicit decision |
| 0007 | Roles via Better Auth access control | ACCEPTED | none known |
| 0008 | Build vs. adopt the regulated core: recommends Odoo behind a port, only under conditions | **PROPOSED** | Evidence and limits: ``architecture/README.md`` |
| 0009 | Arabic and RTL first | ACCEPTED | none known for the engines; product UIs not built yet |
| 0010 | Engines continue; ledger only through a provider-neutral port | ACCEPTED | Port not built (by design; ADR-0010 §5) |

**Open decisions** (owner): D2 (time-boxed ERPNext measurement), D3 (ETA credential ownership and a
pilot), D4 (ledger budget and licence route), all in
`proposal 0006`. **Rejected:** none recorded.

The gaps for ADR-0001..0003 are surfaced here, not resolved. The coordinating agent will propose catch-up
work or superseding ADRs in separate PRs. Until then, the accepted ADR text stands.

## 4. Accounting provider evaluation (summary)

- **Odoo is PROPOSED, not adopted.**
  - Measured: a configured invoice validates for ETA locally, and the HTML report follows the language
    direction.
  - Measured: Odoo's API has no idempotency.
  - **Not shown:** live ETA transmission, B2C e-receipts (the cashier regime), and Odoo's own Arabic PDF
    with RTL layout. The independent PDF lays the page out left-to-right.
- **ERPNext: not evaluated.**
- Licensing, upgrades, tenant operations and responsibility for tax credentials remain evaluation
  concerns.
- Full evidence, provenance and limitations: ``architecture/README.md``.

---

## ملحق 2026-10-21 — الازدواج المكتشف ومسار التقارب (قانوني)

**الحقيقة:** توجد نسختان من منطق العمل: المحركات (`engines/` + `apps/api`) وبروتوتايب العرض
(`prototypes/nilesys/lib/`, ~4,200 سطر JavaScript) الذي بُنيت فوقه الشاشات الحية. الهدف واحد؛ النسختان خطأ
تاريخي سببه بناء العرض قبل دمج المحركات، ولا تُبنى نسخة ثالثة.

**قاعدة التقارب (ملزمة):**

1. البروتوتايب مجمّد: إصلاحات تشغيل فقط، لا مزايا.
2. كل واجهة إنتاجية تُبنى فوق `apps/api` والمحركات، بترتيب مواصفة `specs/projects/nilesys-platform.md`.
3. أي قاعدة ناقصة تُستكمل في محركها مع اختبارها، لا في الشاشة.
4. عند اكتمال نظام إنتاجي، يُحوَّل رابط «جرّبه» إليه وتُقاعَد نسخة البروتوتايب منه.

**نسب الكود المستخرج (Provenance — كان في `REUSE.md` ودُمج هنا):**
ملفات المحركات إما مستخرجة من مستودعات المالك (الأصول باقية، والاستشهادات داخل الملفات تشير لمصادرها)
أو كود عام جديد موثّق المصدر داخل رأسه. اختبارات `golden` المالية لا تتغير إلا بقرار في `DECISIONS.md`.
التفصيل التاريخي الكامل محفوظ في تاريخ Git قبل 2026-10-21.
