# Nile — current state, handoff and task tracker

**Status:** canonical (tier 4 in `AGENTS.md`). This is the **only** live status and handoff document.
Update it in the same change as anything that alters what is below. Do not create per-agent status files.

- **Last verified:** 2026-10-26 — `main` عند `262c799` (MERGE PR #18). فوقها فرع العمل
  `arena/c6b84734-nilesys` (PR #19) يحمل التحول التجاري لواجهة نقطة البيع **+ إكمال
  جاهزية البيع** (G-16 وG-02 وG-17 والمصالحة المالية وPostgreSQL حقيقي) **+ جولة أول
  محل حقيقي** (G-03 إدارة الأصناف، وD-D كproposal، واستعادة نسخ، وفحص ديمو — قسم
  مخصص أدنى هذه القائمة مباشرة): **منفّذ ومُختبر (352/352 على PostgreSQL حقيقي +
  متصفح 81/81)، غير مدمج وغير منشور**، بانتظار مراجعة المالك وإذنه وقراره في D-D.
  ملف بوابات الإطلاق: `docs/COMMERCIAL_RELEASE_READINESS.md`.
- **سجل سابق (2026-10-21):** `main` عند `f3fd73d`، CI أخضر (156 فحص بروتوتايب)، إنتاج Vercel مشروع `nilesys` حي، ودمج كل الفروع/الـPRs مكتمل. الأقسام التاريخية تحت هذا السطر أرشيف مقروء فقط وتُلخَّص في الأعلى, by the LENA integration agent (Arena Agent Mode), using
  `git ls-remote https://github.com/mohamedmasoud3030-tech/nilesys.git` and the GitHub REST API.
  Earlier editions of this file referred to the repository by its old name `Mohamed-App-Factory`.
- **Re-verify before acting:** run `git ls-remote origin` and list the PRs. If the remote differs from this
  file, the remote is right, so fix this file.
- **What to build and in which order:** [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md) holds the catalogue, the
  phases 0–5, feature IDs (`F0-n`, `MKT-n`, `POS-n`, …) and acceptance criteria. It is PROPOSED until the
  owner approves it. This file says **what is allowed right now**.
- **Agents working in an Arena sandbox:** read ``agent-system/ARENA_SANDBOX.md``
  first. The owner's guide is ``owner/AGENT_PLAYBOOK_ar.md``.


## إكمال جاهزية البيع التجاري (2026-10-26) — OPEN للمراجعة في PR #19، غير مدمج

**النطاق:** إغلاق موانع الإطلاق الأربعة الموثقة بعد التحول التجاري، فوق نفس الفرع
وكلٌّ في commit مستقل قابل للمراجعة — بلا كسر عقود (إضافات اختيارية فقط) وبلا
تغيير سياسات مالية/صلاحيات. التفاصيل والحكم في `docs/COMMERCIAL_RELEASE_READINESS.md`.

**ما نُفّذ ومُثبت:**
- **G-16:** الإنتاج يرفض الإقلاع مع أي زرع ديمو (`env-guard.ts`)؛ تهيئة أول عميل
  صريحة عبر `npm run api:provision` (ترفض هوية/كلمة مرور الديمو؛ كلمات مرور
  مميزة مولّدة عند الحاجة). اختبارات: `provisioning.test.ts` (10).
- **G-02:** `GET /api/v1/shifts/current` + ارتباط الواجهة التلقائي بالوردية
  المفتوحة على أجهزة/جلسات جديدة. `shift-recovery.test.ts` (6) + متصفح (تدفق D).
- **G-17:** مفتاح Idempotency اختياري لإغلاق الوردية (ترحيل إضافي `0006`)؛
  إعادة المحاولة تسترد نتيجة الإغلاق نفسها. `shift-close-idempotency.test.ts` (6)
  + سباق إغلاق مزدوج على PostgreSQL حقيقي.
- **§6 مصالحة مالية:** `GET /checkout/reconcile` و`/refunds/reconcile` بهوية
  العملية؛ هويات الواجهة دائمة ومربوطة بالمستخدم وتُصالَح عند الدخول؛ الخروج لم
  يعد يمسح عملية معلقة. `reconcile.test.ts` (5) + متصفح (ردّ مفقود بعد حفظ خادمي).
- **§7 PostgreSQL حقيقي 16.2 (معزول):** الحزمة كاملة **335/335 EXIT=0** — تشمل
  الـ22 اختبارًا التي كانت متخطاة — ومسار إنتاجي كامل أثبت على قاعدة حقيقية
  (ترحيلات 0000–0006، عميل من `api:provision`، بيع نقدي، مصالحة، إغلاق ×2).
  الاستنساخ: `tools/local-pg-pgserver.sh test`.
- **متصفح:** `tools/ui-pos.mjs` صار **62/62 EXIT=0** (أضيف تدفق D: جهاز ثانٍ + مصالحة).

**لم يُحسم/لم يُتحقق:** دمج/نشر (إذن مالك) · أجهزة مادية (طابعة/قارئ — SIMULATED
موثّقة في ملف الجاهزية §8) · G-18 (جهاز ضائع بعملية معلقة) · G-03 (إدارة أصناف) ·
D-C/D-D/ADR-0001 (خيارات وتوصية موثقة في ملف الجاهزية §9، بلا تغيير سياسة).
**الحكم:** NOT READY للبيع بعد بمانعين إجرائيين صريحين (إذن + أجهزة) — التفاصيل في
`docs/COMMERCIAL_RELEASE_READINESS.md` §11.

---

## جولة «أول محل حقيقي» (2026-10-26 مساءً) — نفس الفرع/PR #19، غير مدمج

**النطاق:** إغلاق G-03 فعليًا، وتجهيز D-D كproposal، وإثبات استعادة النسخ، وفحص
الديمو القديم — كلٌّ في commit مستقل. التفاصيل والأدلة في
`docs/COMMERCIAL_RELEASE_READINESS.md`.

- **G-03 إدارة الأصناف ✅ (على الفرع):** API كامل بصلاحية `catalog:manage`
  (إنشاء/تعديل صنف، متغيرات SKU، تفعيل/إيقاف) + ترحيل إضافي `0007` (أعمدة
  `version` — تضارب التعديل المتزامن يفشل بـ`version_conflict` لا صمتًا) +
  قسم «الأصناف» في الواجهة. الأسعار بالقروش، SKU فريد لكل مستأجر (بلا حساسية
  لحالة الأحرف)، كل تغيير يُدقَّق في `audit_log`، الفواتير التاريخية لا
  تتأثر (Snapshot)، ورصيد المخزون يُضبط عند إنشاء المتغير فقط (لا تحرير
  مباشر — تصحيحه `stock:adjust`). اختبارات: `catalog-admin.test.ts` (11)
  + متصفح تدفق E.
- **D-D `report:read` 🟡 proposal (قرار مالك):** فصل صلاحية التقارير عن
  `sale:read`؛ للمدير فقط والكاشير 403 خادميًا حتى من API مباشرة؛ بيع
  الكاشير لم يتغير؛ D-C كما هي. **ليست سياسة معتمدة — لا دمج/نشر قبل اعتماد
  المالك** (commit منفصل قابل للفصل).
- **نسخ/استعادة ✅ محليًا:** `tools/restore-rehearsal.ts` — `pg_dump -Fc` ثم
  استعادة على خادم PostgreSQL ثانٍ ثم تشغيل الـAPI بدور runtime: مطابقة
  عدّادات ومجاميع وتقارير ووردية وعزل وهويات. على بيئة العميل المستضافة
  تُعاد التجربة (Runbook في ملف الجاهزية §5).
- **فحص الديمو القديم ✅ (فحص فقط):** `npm run api:audit-demo` →
  PASS/ACTION REQUIRED/NOT VERIFIED، بلا حذف وبلا أسرار (5 اختبارات).
- **بوابات الجولة:** typecheck صفر · الحزمة كاملة على PostgreSQL حقيقي
  **352/352 EXIT=0** · متصفح `tools/ui-pos.mjs` **81/81 EXIT=0** على قاعدة
  جديدة (أُضيف تدفق E وفحصا D-D؛ عدادات الفواتير صارت بصلاحية مخولة).
- **ملاحظة ملف مفقود:** مرجع `agent-system/ARENA_SANDBOX.md` المذكور أعلاه
  غير موجود على `main` حاليًا (404 عند التحقق 2026-10-26) — يحتاج تحديث
  مرجعية، لا يعيق العمل.

**لم يتغير من الحكم:** NOT READY للبيع بعد — المتبقي إذن الدمج/النشر، قرار
D-D، أجهزة مادية، وتجربة استعادة/تركيب على بيئة العميل. G-18 ما زالت
مفتوحة (جهاز ضائع بعملية معلقة).

---

## التحول التجاري لواجهة نقطة البيع (2026-10-25) — OPEN للمراجعة، غير مدمج

**النطاق:** إعادة بناء واجهة الإنتاج `apps/web/` (تُقدَّم عند `/pos` من الـAPI نفسه)
أماميًا فقط: لا مساس بـ `engines/` ولا بالعقود ولا بالصلاحيات ولا بأي حساب مالي.
المنتج التجريبي التاريخي (`prototypes/`) لم يُطوَّر — مرجع فقط كما هو متفق.

**ما نُفّذ:**
- نظام تصميم عربي RTL كامل (فاتح + داكن) بخط IBM Plex Sans Arabic مستضاف ذاتيًا
  (`apps/web/fonts/`)، أرقام لاتينية جدولية للمبالغ، أيقونات SVG موحدة، أهداف لمس ≥44px.
- شاشة كاشير إنتاجية: بحث/SKU فوري (قارئ باركود لوحة مفاتيح)، تصنيفات، كميات عشرية
  للوزن، سلة سطح مكتب/درج سفلي للجوال والتابلت، اختصارات `/` وF9 وEsc.
- دفع كامل العقود: نقدي/بطاقة/محفظة/تحويل ودفع مقسّم حتى 10 دفعات؛ المجموع والباقي
  النهائيان من الخادم دائمًا (الواجهة «معاينة» فقط)، وإيصال برقم الفاتورة الكامل يطبع 80mm.
- أمان إرسال مشهود: هوية عملية (idempotency) تُحفظ قبل الطلب؛ عند قطع الشبكة حالة
  «غير مؤكدة» مقفلة التحرير، وإعادة المحاولة/التحميل لا تصنع فاتورة ثانية أبدًا.
- مدير: وردية (فتح/إغلاق بفرق درج خادمي)، تقرير ADR-0014 (صافي محصّل)، استرجاع
  فاتورة ومرتجع جزئي بتأكيد؛ والكاشير لا يرى قسم الإدارة (الصلاحية خادمية أصلًا).
- أُزيلت أي بيانات دخول تجريبية من الواجهة التجارية.
- تغيير خادمي وحيد: تقديم خطوط `/pos/fonts/*.woff2` في `apps/api/src/app.ts`.

**التحقق (بيئة معزولة PGlite، بلا أي بيانات إنتاج):**
- `npm run typecheck` نظيف؛ `npm test` ‏285 نجاحًا و22 تخطيًا (ملفات PostgreSQL
  حقيقية تتطلب `ADMIN_URL` — **NOT VERIFIED** في هذا الصندوق، كحال خط الأساس).
- `apps/web/app.pure.test.ts` ‏11/11 لوحدات المال/الكمية/البصمات النقية.
- `tools/ui-pos.mjs` (متصفح حقيقي ضد API حقيقي): **54/54، EXIT=0** على قاعدة جديدة —
  مدير 1440، كاشير 768/390/360، قطع شبكة متعمد؛ صفر أخطاء Console عدا 401 متعمدة
  بالتصميم وقطعَي الاختبار (موثقة في الأداة نفسها).
- لقطات قبل/بعد: `docs/pos-ui/screenshots/`. التدقيق والتصميم والفجوات G-01…G-17:
  `docs/pos-ui/AUDIT_AND_DESIGN.md`.

**لم يُحسم/لم يُتحقق:** دمج أو نشر (بانتظار إذن المالك) · اختبار PostgreSQL الحقيقي ·
G-02 (اكتشاف الوردية المفتوحة — يعيق تبديل الجهاز فعليًا) · D-C/D-D · ADR-0001.

---

## ملف إصدار R1 — أول كاشير إنتاجي فوق المحركات (معماري إصدارات 2026-10-21)

**المنهج:** جرد اعتماديات ← أصغر مجموعة متماسكة ← أثر مسارات/صلاحيات/محاسبة ← بوابات إصدار.

### 1) جرد الاعتماديات (من الكود، 2026-10-21)

| الطبقة | الموجود فعلًا | المسار |
|---|---|---|
| محرك معاملات | بيع/درج/تكلفة/مرتجعات + اختبارات golden وتزامن PG | `engines/transactions/` |
| محرك كتالوج | أصناف وخدمة كتالوج | `engines/catalog/` |
| محرك منصة | Better Auth + أدوار وصلاحيات fail-closed + مستأجر/RLS | `engines/platform/` |
| قاعدة | 6 ترحيلات (0000–0005) تشمل append-only وقيود مال | `engines/db/migrations/` |
| API | health · me · catalog/items · checkout · shifts(+close) · refunds · reports/daily · sales | `apps/api/src/controllers.ts` |
| اختبارات طرفية | e2e-pos · e2e-sale · split-tender | `apps/api/test/` |

### 2) أصغر مجموعة متماسكة للإصدار

بيع + مرتجع + وردية (فتح/إغلاق) + تقرير يومي + دخول بدورين (مدير/كاشير).
**خارج R1 صراحة:** إدارة مستخدمين موسعة، نسخ احتياطي من الواجهة، تعدد فروع، فاتورة ETA.

### 3) فحص الأثر

| النطاق | الأثر |
|---|---|
| المسارات | الواجهة تستهلك `/api/v1/*` القائمة فقط؛ لا مسارات جديدة في R1 إلا عند فجوة موثّقة باختبار |
| الصلاحيات | `manager/cashier` من `engines/platform/src/auth/permissions.ts`؛ المجهول = لا صلاحية |
| المحاسبة | `FINANCIAL_RULES.md` + «المحصّل هو إجمالي البيع» (DECISIONS) + دفاتر append-only (0002/0004) وقيود 0005 لا تُكسر |

### 4) بوابة قاعدة البيانات — أُغلقت 2026-10-21

قرار المالك: قسم معزول داخل مشروع Supabase الحالي. نُفّذ مخطط `nile_prod` كاملًا (26 جدولًا، الترحيلات 0000–0005) وتحقّق منه: دور `nile_app` و19 سياسة و188 قيدًا، ونُظّفت أدوات التنفيذ. عند نشر الـAPI يُربط بـ`search_path=nile_prod`.

### 5) بوابات الإصدار (تُشغَّل قبل أي دمج للإصدار)

```sh
npm run typecheck
npx vitest run engines/transactions engines/catalog apps/api
cd prototypes/nilesys && bash tools/run-tests.sh   # سلامة الديمو المجمد (156)
```

---

## 1. Repository state (2026-10-19)

| Item | Value | Verified how |
| --- | --- | --- |
| `main` | `52af4693e53ca17883b473512f22aeb32e77672a`: merge of PR #4 (on 2026-10-18), which also contains the `docs/source-of-truth-cleanup` merge `0369716` | `git ls-remote`; GitHub API (PR #4 `merged_at` 2026-10-18T05:45:19Z) |
| `integration/nile-2026-10-18` | `0207c1355a6e287f8724ff877c7c3be79fcb75ec`: **all POS engine work, not merged into `main`** (see §2) | `git ls-remote` |
| CI | **None on GitHub.** There is no `.github/workflows` file. A reviewed draft exists on branch `rescue/2026-10-19-workspace-archive`, at `deliverables/ci/nilesys-ci.yml` | repository tree |
| Hosting | **UNRESOLVED (D5).** The Vercel project builds previews on every push, but `https://nilesys.vercel.app` returns 404 (there is no web app) | `curl` 2026-10-19 |
| Production database | Not chosen. The target candidate is Supabase PostgreSQL 17 (conditionally viable, **not chosen**) | `docs/reviews/2026-10-14-supabase-feasibility.md` (branch `handoff/2026-10-14-evidence`) |
| Toolchain | npm with `package-lock.json` v3, Node `>=20`. **npm only (`ADR-0011`, 2026-10-19).** `pnpm-lock.yaml` is git-ignored and is never committed or used. Copies on disk are not deleted | `package.json`; ADR-0011 |

### Verification evidence (local sandboxes only, never CI)

**2026-10-19: a local PostgreSQL makes the skipped files run.** `tools/local-pg.sh` installs, starts and
points a disposable PostgreSQL at the suite. Before it, `ADMIN_URL` was unset in every sandbox and the
22 concurrency assertions never executed — an agent could not honestly claim concurrency was correct.
Now `./tools/local-pg.sh test` runs all 29 files with nothing skipped.

| Commit | Command and result |
| --- | --- |
| `b25cb65` | `npm run typecheck` exit 0 · full suite on real PostgreSQL 17: 230/230 · prototype parity 30/30 · `npm run api:smoke` 5/5 · gitleaks 0 findings |
| `d90b7c9` | full suite on real PostgreSQL 17: 236/236 · refund concurrency tests A–F: 6/6, three runs each |
| `0207c13` | `npm run typecheck` exit 0 · `refund-concurrency.pg.test.ts` 7/7 · refund-related tests 57/57 · mutation check: only test G fails · **2026-10-19 re-run: full suite on real PostgreSQL 17.11 (fresh cluster, `--maxWorkers=1`): 25 files, 237/237, 0 skipped, 4 real-PG files / 22 real-PG tests, 0 leftover test databases** |

| `4dd74f1` (branch `feat/plt-0005-payment-db-constraints`, base `364b51f`) | migration `0005_money_constraints`: `npm run typecheck` exit 0 · `npx vitest run` 23 files passed / 4 skipped, **247 passed / 22 skipped** (23 new assertions in `payment-constraints.test.ts`) · `drizzle-kit check` no drift · `generate` no changes. **No real PostgreSQL available in that sandbox**, so the 4 real-PG files were skipped, as they were before the change |

| `7959fb9` + `tools/local-pg.sh` (2026-10-19) | **First full run with a real PostgreSQL.** `./tools/local-pg.sh test` on PostgreSQL 17.11 (fresh cluster, `--maxWorkers=1`): **29 files passed, 0 skipped · 296/296 tests, 0 skipped.** This is the first time the two `.pg.test.ts` race files ran in a sandbox: 9 concurrency assertions (refund races A–G, double shift open) now pass instead of skipping. 0 leftover test databases. Reproduce with `./tools/local-pg.sh test` |

None of these results comes from GitHub Actions, staging or production.

### 2026-10-21 — demo site (`prototypes/nilesys`): the 5 Windows programs are live

The public demo project (`prototypes/nilesys`, deployed to Vercel project `nilesys-demo`) now ships
the **seven systems + seven marketing sites + five Windows programs** the landing page promises.
The Windows programs work in the browser today: local-first storage, real offline selling, 80mm/50mm
receipt and label printing, Code39 barcode, and a sync endpoint that cannot double-count.

| Command | Result |
| --- | --- |
| `sh tools/run-tests.sh` (in `prototypes/nilesys`) | **156/156** — includes new `tests/windows.test.js` 6/6 |
| `sh tools/setup-browser.sh tools/ui-windows.js` | **69/69** — five programs in a real browser, incl. a full sale with `context.setOffline(true)` then sync on reconnect, plus 390px-no-overflow and SVG-icon checks |
| `sh tools/setup-browser.sh tools/ui-sites.js` | **37/37** — landing and the seven site pages, incl. the five Windows cards opening the real programs |
| `sh tools/setup-browser.sh tools/ui-sites.js` | **37/37** — landing/site pages, incl. the five Windows cards now link to working programs |
| `python3 tools/build-app-specs.py` | 7 systems **7/7 live** + 5 Windows specs **7/7 each**, generated into `public/docs/` |
| live Vercel run (`BASE=https://nilesys-demo-git-feat-demo-on-vercel-lenabeauty.vercel.app sh tools/setup-browser.sh tools/ui-windows.js`) | **69/69** against the deployed build, including a real sale with the network cut and a sync that lands in Supabase |

**Which URL has this build (2026-10-21):** the branch alias
`https://nilesys-demo-git-feat-demo-on-vercel-lenabeauty.vercel.app` serves commit `8c4f342` and is proven
green. The production alias `nilesys-demo.vercel.app` is **one build behind**: Vercel only builds production
from `main`, and the Vercel connector in this session rejects `git_source` (its tool schema wants a string,
the app wants an object), so promotion could not be executed from the sandbox. To close it: click *Promote to
Production* on deployment `dpl_6nyhrvSEAqsiCLZZLCkA5y2dALTS`, or approve a Vercel device login so the CLI can
run `vercel deploy --prod`.

**Not claimed:** the `.exe` installer (Electron packaging) is **not built**; USB thermal-printer and
USB scanner support, and ETA e-invoicing, remain out of scope. Nothing on any page offers a download.

## 2. Branches and pull requests

| Ref | Head | State | Notes |
| --- | --- | --- | --- |
| `main` | `52af469` | default | Production branch of the Vercel project (404, no app) |
| `integration/nile-2026-10-18` | `0207c13` | **CANDIDATE. Not merged; no PR** | Built from `main` by fast-forwarding to `feat/nile-mission3-pos-fixes-pg-tests`, then merging `feat/nile-pos-dst-2026-10-18` (`5dd1f7d`), then fixes F1–F5 (`dcca705`, `3499550`, `0b271af`, `69b3310`, `b25cb65`), the C4 refund lock `d90b7c9` and test G `0207c13`. Contains: checkout and split tenders, refunds, cash shifts, daily report (Africa/Cairo, DST-safe), migrations `0003`/`0004`, lead and people services, prototype fixes, the offerings registry |
| `feat/nile-pos-dst-2026-10-18`, `feat/nile-mission3-pos-fixes-pg-tests`, `feat/nile-lead-people-services`, `feat/nile-offerings-readiness` | `e94ecc4`, `c72f746`, `099dc14`, `c910b57` | contained in the integration branch | Keep them. Delete only with the owner's approval |
| `feat/nile-payments-engine` | `c489a23` | **Alternative, not merged** | A second implementation of proposal 0007 with a different model. It is option (3) of decision D-A |
| `fix/nile-pool-error-listener` | `29390fa` | **CANDIDATE for N-1, not merged** | Task F0-5 |
| `investigation/g7-runtime-role-boundary-incomplete` | `60342be` | **INCOMPLETE, not a fix** | See G-7a. The redesign is in `docs/reviews/2026-10-14-g7-redesign-design-review.md` (branch `handoff/2026-10-14-evidence`) |
| `handoff/2026-10-14-evidence` | `315ebe7` | evidence, not merged | Supabase feasibility, G-7 redesign, publication audit, archived agent reports |
| `docs/resolve-source-of-truth-citations` | `ac1f367` | **docs commit taken** on `docs/unified-plan-2026-10-19` as `8523eae` (cherry-pick `-x`). Its parent `c489a23` (payments alternative) was **not** taken | `docs/FINANCIAL_RULES.md` (Kayyal v1.0 reference, Nile-status banner added) and `docs/adr/kayyal-core/*` |
| `docs/skill-manifest-and-dead-refs` | `a8bbd9d` | not merged | — |
| PR #5 `docs/2026-10-15-autonomous-execution-protocol` | `644f7f6` | OPEN. **Technical decision 2026-10-19: do not merge** (§3) | It replaces the current `AGENTS.md` with an older pre-cleanup version ("Mohamed App Factory") and adds an execution-first «FULL POWER MODE» protocol that conflicts with `AGENTS.md`'s owner rules. Superseded by `agent-system/ARENA_SANDBOX.md` and `owner/AGENT_PLAYBOOK_ar.md`. To close: tag `archive/…`, then close the PR. Owner approval needed for both. Its twin is `platform` PR #95 |
| `rescue/2026-10-19-workspace-archive` | `27bf9b3` | **archive only; never merge** | Byte-identical copies of the sandbox's local reports, evidence, backups and the CI draft (290 files, `RESCUE_MANIFEST.tsv`) |
| `arena/bfcb5ed1-mohamed-app-factory` | `e61cd06` | HISTORICAL | Odoo evaluation. Never merge it wholesale |
| `arena/01a06b01-…`, `feat/nile-engines-v1`, `feat/nile-engines-wave2-db`, `feat/nile-e2e-auth-sale`, `fix/nile-gate-ledger-append-only-demo-lock`, `docs/source-of-truth-cleanup` | — | **MERGED IN `main`** | Deleting them needs the owner's approval |
| PR #1–#4 | — | merged | — |

## 3. Decisions

- **ACCEPTED:** ADR-0001…0007, ADR-0009, ADR-0010.
- **ACCEPTED (owner, 2026-10-18), recorded from the session reports:**
  - The v3 regression contract.
  - Prototype SALE-3 returns 400.
  - Salary is never below zero.
  - UPDATE stays allowed on leads and attendance.
  - LENA is the umbrella brand and Nile is integrated into it.
- **PROPOSED:** ADR-0008; proposals 0002–0007; `PRODUCT_PLAN.md`.
- **ACCEPTED (technical, 2026-10-19).** The owner delegated technical decisions ("make the technical
  decisions, without creating new repositories"):
  - **D-H → npm** (`ADR-0011`). `pnpm-lock.yaml` is git-ignored, not deleted.
  - **No new repositories.** Archives stay in this repository as `archive/<branch>` tags plus
    `rescue/2026-10-19-workspace-archive`. The proposed private `nilesys-archive` repository is dropped.
  - **`platform` planning documents stay in `platform`.** They are not copied into this public
    repository, which only indexes them (``REUSE.md``, "Related material outside this repository").
  - **PR #5 is not merged** (superseded; see §2). The same recommendation applies to its `platform` twin, PR #95.
  - **Kayyal reference rules are pinned to v1.0**, the version the code was extracted from. Kayyal v1.1 is
    not imported (reasons in the `FINANCIAL_RULES.md` banner). Kayyal's boundary-hardening tests are
    adopted (`kayyal-hardening.test.ts`, 9 tests).
  - **Merge order for branch consolidation:** integration code first (task 5), then each money decision
    (D-A…D-E) as its own small PR, then docs. Unique branches are resolved per §2; merged branches get an
    `archive/<branch>` tag before any deletion. Every push, PR, merge, tag or deletion still needs
    owner approval.
  - ~~D-F → Nile sites live here (ADR-0012)~~ **corrected by the owner the same day.** See the next bullet.
- **ACCEPTED (owner, 2026-10-19): D-F → the marketing site is part of the LENA Digital site in `platform`**
  (`ADR-0013`, which supersedes ADR-0012). This repository
  serves it over HTTP: a public readiness endpoint, lead intake and demo links. **Where the seven system
  sites (phase 4) live is still OPEN (owner).**
- **DECIDED 2026-10-19: D-E → money collected is the sales total**, refunds as their own line
  (`ADR-0014`). The owner delegated the choice; `getDailyReport`
  now returns `collectedMinor`, `netCollectedMinor` and `outstandingMinor` alongside the billed figure.
- **OPEN (owner, business):** D-A, D-B, D-C, D-D, D-G, D5 and the location of the seven system sites, listed with options in [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md) §10:
  - D-A: payment model and the list of payment methods.
  - D-B: cash correction policy.
  - D-C: who may close a shift.
  - D-D: who may read the daily report.
  - D-G: product order.
  - D5: hosting.
  - Where the seven system sites (phase 4) live (`ADR-0013` §4).

  D2–D4 (ledger provider) remain open and block nothing in phases 0–2.
- **ADR-vs-code gaps** (ADR-0001 Nx/pnpm/Next.js/CI, ADR-0002 per-vertical apps, ADR-0003 Milestone 1 scope):
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §3.

## 4. Implementation status

- **Implemented on `main` and tested:**
  - Tenancy with fail-closed RLS.
  - Better Auth organisations and 14 demo roles.
  - The sale path (idempotent, atomic, audited).
  - Catalog listing.
  - Append-only ledger for the runtime role, and locked demo logins (PR #4).
- **Implemented on `integration/nile-2026-10-18` only (not merged):**
  - Checkout with split tenders.
  - Refunds, serialised per sale.
  - Cash shifts with a locked close.
  - Daily report (Africa/Cairo).
  - Lead capture service and people service.
  - **Migration `0005_money_constraints`** (branch `feat/plt-0005-payment-db-constraints`, not merged): moves
    I2/I3/I7/I8/I11 for the payment tables from TypeScript into the database.
  - API endpoints:
    - `POST /api/v1/checkout`
    - `POST /api/v1/sales`
    - `GET /api/v1/sales/:id`
    - `POST /api/v1/shifts`
    - `POST /api/v1/shifts/:id/close`
    - `GET /api/v1/shifts/:id`
    - `POST /api/v1/refunds`
    - `GET /api/v1/reports/daily`
    - `GET /api/v1/catalog/items`
- **Domain code only:** booking.
- **Not implemented anywhere:**
  - Any product UI (no Next.js app).
  - Receipt endpoint.
  - Sales list.
  - Product create, update and delete.
  - Branding API.
  - Lead endpoint.
  - Daily demo reset.
  - Profit, top-seller and hourly reports.
  - Inventory/purchasing and restaurant engines.
  - CI.

  The feature-by-feature table is in `PRODUCT_PLAN.md` §5.

## 5. Next work, in order

Task IDs match `PRODUCT_PLAN.md`. Each task needs its own branch, its own commit(s) with tests, and evidence
recorded in its PR description. Nothing is merged without the owner.

| # | Task | Status | Gate |
| --- | --- | --- | --- |
| 1 | **Owner decisions D-A…D-D** (payment methods, cash correction, shift close, who reads the report). **D-E is decided** — `ADR-0014` | PARTLY DONE: D-E decided and implemented; D-A…D-D WAITING ON OWNER | — |
| 2 | F0-2: implement the money decisions on a branch from `integration/nile-2026-10-18` (migration `0005`, the method list, permissions), failing-test-first; full suite on real PostgreSQL | **PARTLY DONE** on `feat/plt-0005-payment-db-constraints`: D-E done (`reports.ts`), migration `0005` done. The rest waits on D-A…D-D | **Full suite now runs on real PostgreSQL: 296/296, 0 skipped** |
| 3 | F0-3: add the CI workflow from the draft; first green run on GitHub Actions | PROPOSED, unblocked | The owner approves pushing a workflow file |
| 4 | F0-9: update `tools/nile-offerings/offerings.ts`, whose POS `mustNotClaim` still says payments live on an unmerged branch | **DONE** on `feat/plt-0005-payment-db-constraints` — POS entry lists nine engine files and no longer claims payments are unbuilt; `offerings.test.ts` 17/17 | — |
| 5 | F0-4: open a PR from the integration branch (after #2 and #3) and request review | BLOCKED BY #2, #3 | The owner alone merges |
| 6 | F0-5: N-1 pool `error` listener | **DONE** on `feat/plt-0005-payment-db-constraints` (`attachPoolErrorHandler`, 4 tests). Still open: the live kill-a-backend test on a real server | — |
| 7 | F0-6: G-7a redesign (closed-world allow-list) and its adversarial real-PostgreSQL matrix | WAITING ON OWNER (approve the redesign) | — |
| 8 | F0-10 / D-H: Nx + pnpm or npm | **DONE 2026-10-19: npm (`ADR-0011`)** | — |
| 9 | F0-7 / D5: disposable Supabase PG 17 project; read-only hosted checks; then staging | WAITING ON OWNER | Creating cloud resources needs approval |
| 10 | Phase 1 APIs: POS-04 receipt, POS-05 sales list, POS-08 profit/top/hourly, POS-09 product writes, POS-10 branding, MKT-09 lead endpoint (accepting the LENA site origin), a public read-only readiness/catalogue endpoint for the LENA site (ADR-0013), POS-11 demo reset | BLOCKED BY #5 merged | One feature per PR, tests first |
| 11 | Phase 1 UI: cashier (POS-*) on Next.js here, in an npm workspace. Marketing site (MKT-*) inside the LENA site in `platform` per `ADR-0013`; that needs the owner's approval for work in `platform` | BLOCKED BY #10 and the UI blockers in §6 | — |
| 12 | Phase 1 acceptance (`PRODUCT_PLAN.md` §5.3) on staging; the owner tests it personally | BLOCKED BY #9, #11 | Owner sign-off |
| 13 | Phase 2 design: purchase receipt contract over the shared stock-movement path; restaurant tables and kitchen domain | PROPOSED (design only; no code before Phase 1 acceptance) | — |
| 14 | P4-1: tests for the remaining locked demo paths (change-email, delete-user) | PROPOSED, unblocked | — |

## 6. Open findings register

IDs:
- **G-n** = `post-merge security gate`.
- **H-n** = `review 0001`.
- **P4-n** = `PR #4 review` §3.
- **N-n** = found later and recorded only here.
- **C-n** = integration-branch review findings, 2026-10-18 (reports on the rescue branch under `deliverables/`).

| ID | Severity | Summary | Status |
| --- | --- | --- | --- |
| G-1 (= H4) | High | Runtime role could rewrite or delete ledger and audit rows | MERGED IN `52af469` (PR #4) |
| G-2 | High | One visitor could lock out or deface shared demo logins | MERGED IN `52af469` (PR #4) |
| G-3 | Medium | A sale stores no payment | FIXED ON `integration/nile-2026-10-18` `0207c13`; OPEN on `main`. **Cashier-UI blocker until merged** |
| G-3b | — | `resolvePendingCash`, `getDrawer`, `recordPayment` and `getPaymentStatus` existed only as a design in proposal 0007 §5 | IMPLEMENTED on `feat/plt-0005-payment-db-constraints` (`payments.ts`, `drawer.ts`), with 21 assertions. Not merged. **Still no HTTP layer**: the engine is reachable only from tests until D-C and D-D fix the permissions |
| G-4 (= H7) | Medium | Missing CHECK constraints on money, quantity and enum columns | **PARTLY CLOSED** on `feat/plt-0005-payment-db-constraints` (`4dd74f1`, migration `0005`): every table added in `0003` is now constrained. Still OPEN for `sales_transactions`, `transaction_lines`, `cash_movements` — that is the owner's option (1) of D-A. Required before public exposure |
| G-5 | Medium | Dev mode trusts any origin; per-boot secret; insecure cookies; no rate limit | OPEN (F0-8). **UI/public blocker** |
| G-6 | Low | Origin/CSRF checks skipped under `NODE_ENV=test` | OPEN |
| G-7 / G-7a | Low / **High** | Runtime-role assertion; the candidate `60342be` accepts 17 of 18 escalation vectors on PG 17.10/18.4 | OPEN. Redesign PROPOSED (task 7). **Public blocker** |
| G-8, G-9, G-11…G-15 | Low/Info | See the gate report | OPEN |
| G-10 (= H9) | Low | Booking overlap not enforced by the database | OPEN. Needed before any booking API (phases 2–3) |
| C4 | High | Two concurrent refunds of the same sale could refund one unit twice | FIXED ON `integration/nile-2026-10-18` `d90b7c9` (tests A–F); `payment_mismatch` pinned by test G (`0207c13`) |
| C-res | Low | 32-bit advisory-lock key collisions can serialise unrelated work (no correctness loss); not verified on PG 18 | OPEN (accepted risk, document) |
| P4-1 | — | Locked demo paths change-email and delete-user have no committed test (revoke-sessions is covered in `e2e-sale.test.ts`) | OPEN (task 14) |
| P4-4 | — | Each new append-only table's migration must REVOKE UPDATE/DELETE from `nile_app` | Rule in `AGENTS.md` |
| N-1 | Low | The runtime pool has no `error` listener, so an idle-connection kill crashes the API | **FIXED** on `feat/plt-0005-payment-db-constraints` (`attachPoolErrorHandler` in `engines/db/open.ts`, 4 wiring tests). The live kill-a-backend test still needs a real PostgreSQL server |
| DOC-1 | Low | Extracted files cited source-repository documents that were missing here | Mostly FIXED on `docs/unified-plan-2026-10-19` (`8523eae`): `FINANCIAL_RULES.md` and `adr/kayyal-core/*` are present, with no dead `kayyal-core` link. Remaining: `money-by-currency.ts` mentions Terranex's `docs/OPEN_BUSINESS_DECISIONS.md` as a source-repo note (documented in `REUSE.md`) |
| E-receipt | — | Egyptian B2C e-receipts never measured | OPEN (evaluation) |

## 7. Approvals required from the owner

1. Approve or amend `PRODUCT_PLAN.md`. Once approved, mark it ACCEPTED and move it to tier 4 in `docs/README.md`.
2. Decide D-A…D-D (task 1), then D-G, D5, and where the seven system sites live. (D-H decided technically, D-F and D-E by the owner on 2026-10-19.)
3. Approve pushing the CI workflow (task 3).
4. Approve the G-7a redesign (task 7).
5. Later: review and merge the integration PR (task 5); delete merged branches if wanted.
6. Revoke every GitHub token that was ever pasted into a chat, including the one used on 2026-10-19.

---

## 🛰️ مراجع الموجات الإدارية — مزامنة مركز القيادة (2026-10-23)

آخر ثلاث موجات إدارية اكتملت على هذا المستودع بدمج موثق — هذا القسم هو الصفحة الأخيرة من رحلة «خطة ← تسليم»:

| الموجة | PR | مرجع الدمج | التاريخ | الأثر |
|---|---|---|---|---|
| توحيد المستندات القانونية | #10 | `ebf6e14` | 2026-10-21 | مواصفات المطوّر في مصدر واحد قانوني |
| ربط مركز القيادة | #15 | `ec1aaf6` | 2026-10-23 | AGENTS/STATUS موحدان + ربط المركز |
| مزامنة المهارات | #16 | `3392142` | 2026-10-23 | 12 مهارة مرجعية بعد المزامنة |

> **المرجع الأم للمحفظة:** مركز القيادة [`command-center-`](https://github.com/mohamedmasoud3030-tech/command-center-) — سجل الجلسات النشطة والـ PRs المفتوحة وقرارات المالك يعيش هناك. هذا القسم يحدّثه مدير المحفظة مع كل موجة ولا يُعدّل يدوياً.
