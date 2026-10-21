# Decisions

This is the index of Architecture Decision Records (ADRs). Accepted ADRs are immutable:
once accepted they are superseded by newer ADRs, never edited. Proposed ADRs may be revised.
Known gaps between accepted ADRs and the code are listed in [ARCHITECTURE.md](ARCHITECTURE.md) §3.

| ADR | Title | Status | Date |
|---|---|---|---|
| `0001` | Technology stack (TypeScript, NestJS/Fastify, Next.js, Nx/pnpm, PostgreSQL) | Accepted | 2026-09-04 |
| `0002` | Tenancy and deployment topology | Accepted | 2026-09-04 |
| `0003` | Milestone 1 target application and scope | Accepted | 2026-09-04 |
| `0004` | ORM and database access (Drizzle ORM + Drizzle Kit) | Accepted | 2026-09-04 |
| `0005` | Authentication, organization membership, tenant context, and RLS security boundary | Accepted | 2026-09-04 |
| `0006` | REST and OpenAPI API contract | Accepted | 2026-09-04 |
| `0007` | Roles and permissions via Better Auth access control | Accepted | 2026-10-14 |
| `0008` | Build vs. adopt: how the factory obtains its regulated core (ledger) | **Proposed** — awaiting Mohamed's decision | 2026-10-14 |
| `0009` | Arabic and RTL are first-class requirements; English remains the repository language | Accepted | 2026-10-13 |
| `0010` | Engine development continues; accounting is reached only through a provider-neutral port | Accepted | 2026-10-14 |
| `0011` | Repository tooling stays on npm; Nx + pnpm not adopted now (supersedes ADR-0001's workspace bullet only) | Accepted | 2026-10-19 |
| `0012` | Nile's marketing site and system sites live in this repository; Platform (LENA) links to them | **Superseded by 0013** | 2026-10-19 |
| `0013` | The Nile marketing site is part of the LENA Digital site in `platform` (owner decision; system sites still open) | Accepted | 2026-10-19 |
| `0014` | "Total sales" means money collected, not money rung up; a refund is its own line (resolves D-E) | Accepted | 2026-10-19 |

## Numbering notes

- `adr/kayyal-core/0001…0012` are **reference copies of another product's decisions** (Kayyal, repository
  `bug-free-garbanzo`). They are not this repository's ADRs and do not use its number space. See
  `adr/kayyal-core/README.md`.

- ADR-0007 existed on `main` but was missing from this index; added on 2026-10-14.
- ADR-0008 and ADR-0009 came from branch `arena/bfcb5ed1-mohamed-app-factory` (commit `e61cd06`).
  ADR-0009 was numbered ADR-0001 on that branch, which collides with this repository's ADR-0001, and its
  planned number ADR-0007 is now the roles ADR. Only its heading number changed. It was accepted on that
  branch on 2026-10-13. Provenance: `architecture/README.md`.
- The branch's ADR-0001 "build vs adopt" proposal (`docs/architecture/proposals/0001-platform-strategy.md`)
  was not imported because it conflicts with accepted ADR-0001 here. ADR-0008 is the live form of that
  question.


## قرارات 2026-10-21 (مالك)

| القرار | النص | الأثر |
|---|---|---|
| التقارب | هدف واحد: الواجهات الإنتاجية تُبنى فوق المحركات؛ البروتوتايب عرض مجمّد لا منتج موازٍ | يلغي أي بناء فوق `prototypes/nilesys/lib` |
| مصدر المستندات الواحد | كل مستندات المشروع في `docs/` القانونية فقط؛ لا أرشيف ولا نسخ موازية في أي مكان | حُذفت `adr/` و`architecture/proposals/` و`archive/` و`plan/` و`prd/` و`todo/` و`vision/` و`reviews/` و`owner/` و`agent-system/` و`product/` بعد هجرة محتواها هنا وفي المواصفات؛ تاريخ Git هو الأرشيف الوحيد |
| الاستضافة | Vercel: مشروع `nilesys` إنتاج من `main` + مشروع `nilesys-demo` للعرض | `nilesys.vercel.app` محجوز عالميًا؛ الإنتاج على `nilesys-seven.vercel.app` |

> سجل ADR التاريخي (0001–0014 + مرجع kayyal-core): ملخص كل قرار في جدول هذا الملف أعلاه؛
> النصوص الكاملة محفوظة في تاريخ Git (قبل حذف `docs/adr/` في 2026-10-21) — هذا الملف هو المرجع الحي الوحيد من الآن.
