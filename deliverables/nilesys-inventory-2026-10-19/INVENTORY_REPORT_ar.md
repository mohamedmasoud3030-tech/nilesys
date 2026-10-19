# جرد NILESYS / Nile Systems الموحد — 2026-10-19

**النطاق:** المستودع `nilesys` بكامل تاريخه (كل الفروع والـcommits والـPRs)، ومساحة العمل خارج المستودع (`deliverables/`، `backups/`)، وGitHub، وGoogle Drive المتصل، وذاكرة هذه الجلسة.
**طريقة العمل:** قراءة فقط. لم يُعدَّل أي ملف أصلي ولم يُنقل أو يُحذف، ولم يتغير أي فرع، ولا commit ولا push ولا merge ولا نشر. كل المخرجات الجديدة داخل هذا المجلد فقط.
**البحث ليس شاملًا لكل المصادر.** أهم ما تعذّر الوصول إليه مستودع `platform` وسبعة مستودعات خاصة أخرى، ونصوص المحادثات السابقة. التفاصيل في §8.

---

## 1) الخلاصة: أين المرجع؟

| المطلوب | النسخة المرجعية (الأصلية) | الحالة | النسخ اللاحقة والمشتقات |
|---|---|---|---|
| **كتالوج مزايا POS والتطبيقات المصاحبة** | `prototypes/nilesys/public/assets/js/home.js`، مصفوفات `SYSTEMS` (7 أنظمة لكل منها اسم ووصف و3 مزايا بالعربية والإنجليزية) و`SITES` (7 مواقع) و`WINDOWS` (5 برامج). commit `e74167b` بتاريخ 2026-10-13 للمؤلف M7mdlab | على `main` ولم يتغير منذ أول commit (نسخة واحدة فقط). [رابط](https://github.com/mohamedmasoud3030-tech/nilesys/blob/52af4693e53ca17883b473512f22aeb32e77672a/prototypes/nilesys/public/assets/js/home.js) | `tools/nile-offerings/offerings.ts`: سجل جاهزية مشتق (19 مدخلًا) على فروع غير مدموجة. PRD 001 §3.1 وplan 001 §1.1. `DEMO_ACCOUNTS` في `engines/platform/src/demo-seed.ts` و`LeadSource` في `engines/catalog/src/catalog.ts` تفرضان نفس المعرّفات |
| **مزايا POS التفصيلية** | `prototypes/nilesys/README.md`، القسم «اللي شغال دلوقتي (المرحلة 1)»، مع جدول الـAPI | على `main`. النسخة الأصلية في `e74167b`، والنسخة الثانية في `1a2ce95` بتاريخ 2026-10-14 أضافت فقط ترويسة «HISTORICAL» (تشابه 95%) | `REVIEW.md` (30 سيناريو و6 عيوب) |
| **خطة تنفيذ NILESYS الأصلية** | `prototypes/nilesys/README.md` §«خطة المراحل الجاية»: المرحلة 1 الكاشير والموقع، 2 المخازن والمطعم، 3 العيادة وHR والملاعب ولوحة المواقع، 4 المواقع السبعة، 5 الويندوز والتحميل وواتساب. commit `e74167b` | على `main`، مع خطة إصلاح في `REVIEW.md` | `docs/prd/001-marketing-site-as-platform.md` (توسيع المراحل الخمس)، و`docs/todo/001-marketing-phased-todo.md`، و`docs/plan/001-pos-implementation-ready.md` («خطة تنفيذ POS داخل LENA»، 4 مراحل). الثلاثة من commit `e94ecc4` بتاريخ 2026-10-18 للمؤلف arena-agent، وكلها **PROPOSED** وغير موجودة على `main`. هي موجودة على `feat/nile-pos-dst-2026-10-18` وعلى فرع التكامل |
| **خارطة الطريق المعتمدة حاليًا** | `docs/STATUS.md` §5 «Next work, in order». ينص `AGENTS.md` على أنها ملف الحالة الحي الوحيد | على `main`، 4 نسخ، آخرها `a71284f` بتاريخ 2026-10-14 | `docs/REUSE.md` (تاريخ الاستخراج فقط) |

**ملاحظة جوهرية:** لا يوجد في أي commit أو فرع ملف باسم ROADMAP أو FEATURES أو SPECIFICATION(S)، ولا ملف عنوانه «كتالوج المزايا». بحثت بالاسم والنص في كل نسخ كل الملفات عبر 66 commit. ما يقابل هذه الأسماء فعليًا موضح في §3.

---

## 2) المصادر التي فُحصت وحالة الوصول

| المصدر | ما فُحص | النتيجة | الوصول |
|---|---|---|---|
| مستودع `nilesys` المحلي | 66 commit، و5 فروع محلية، و21 فرعًا بعيدًا، و`refs/pull/1-5`. **310 مسارات** ظهرت في التاريخ: 144 على `main`، و166 على فروع فقط، ولا يوجد مسار محذوف من كل الفروع | `evidence/repo-files-all-history.csv` | ✅ كامل |
| GitHub `mohamedmasoud3030-tech/nilesys` | `ls-remote`، والـPRs (#1–#5)، وissues، وreleases، وwiki | كل الفروع البعيدة منسوخة محليًا ومطابقة. لا توجد releases (0) ولا wiki ولا issues، والموجود 5 PRs فقط | ✅ عام |
| GitHub: باقي المالك | قائمة المستودعات العامة | عامّان فقط: `nilesys` و`mosaid` (Go، خارج النطاق) | ⚠️ جزئي |
| GitHub `platform` و`starting` و`malek` و`Terranex` و`bug-free-garbanzo` و`carmen-gallery-` و`larabeauty-` و`Lenastore` | صفحة الويب والـAPI بدون مصادقة | 404 (مستودعات خاصة أو أعيدت تسميتها) | ❌ لا توجد بيانات اعتماد مصرّح بها، والتوكنات السابقة ممنوعة |
| مساحة العمل خارج المستودع | `deliverables/` (116 ملفًا) و`backups/` (8 ملفات) | `evidence/outside-repo-files.csv` | ✅ |
| Google Drive (متصل) | بحث بالاسم والنص الكامل عن nile وNILESYS وPOS ونقاط البيع وLENA وكتالوج وخطة، وقائمة كاملة | 23 عنصرًا كلها لمشروع **TerraNex** التسويقي. **لا يوجد أي ملف NILESYS** | ✅ |
| Supabase | — | مربوط لكنه **مغلق** في هذه المحادثة، فلم يُفحص | ⛔ يحتاج تفعيلك |
| المحادثات السابقة | ذاكرة الجلسة المختصرة والتقارير المحفوظة | النصوص الكاملة للمحادثات غير متاحة | ⚠️ |
| الويب | `nilesys.vercel.app` و`marketing-app.runasp.net` | 404 و200 على الترتيب | ✅ |

---

## 3) الوثائق الأساسية داخل المستودع: الكتالوج والخطط والمتطلبات والتصميم

| الملف | الوظيفة | التاريخ والنسخ | الموقع | أصلي أم نسخة |
|---|---|---|---|---|
| `prototypes/nilesys/public/assets/js/home.js` | **كتالوج المزايا** (7 أنظمة و7 مواقع و5 برامج ويندوز) | `e74167b` بتاريخ 2026-10-13، نسخة واحدة | `main` و23 فرعًا | **أصلي** |
| `prototypes/nilesys/README.md` | مزايا المرحلة 1 و**خطة المراحل الأصلية** | `e74167b` ثم `1a2ce95`، نسختان | `main` | **أصلي** |
| `prototypes/nilesys/REVIEW.md` | مراجعة هندسية وخطة إصلاح مرتبة بالخطورة | 3 نسخ، آخرها `43af873` بتاريخ 2026-10-18 | `main` (نسخة 1a2ce95)، والأحدث على الفروع | أصلي |
| `prototypes/nilesys/public/index.html` و`systems/pos.html` و`assets/css/app.css` و`assets/js/i18n.js` | **التصميم** (واجهة الكتالوج والكاشير، ونظام تصميم RTL، والقاموس) | `e74167b`، نسخة واحدة | `main` | أصلي |
| `docs/prd/001-marketing-site-as-platform.md` | **متطلبات (PRD)**: موقع تسويقي «كبديل لـ platform» وخمس مراحل | `e94ecc4` بتاريخ 2026-10-18 | فرع POS-DST وفرع التكامل | أصلي، PROPOSED |
| `docs/todo/001-marketing-phased-todo.md` | خطة تنفيذ خطوة بخطوة | `e94ecc4` | نفس الفروع | أصلي. ترويسته تقول إنه «مبني على تفسير منسوخ»، وإن المرجع هو vision 001، وإنه لا يُنفذ قبل ADR-0011 |
| `docs/plan/001-pos-implementation-ready.md` | **خطة تنفيذ POS داخل LENA** (4 مراحل، ودلالات مالية) | `e94ecc4` | نفس الفروع | أصلي، PROPOSED |
| `docs/vision/001-lena-as-umbrella-nile-integration.md` | **رؤية: LENA مظلة وNile يندمج داخلها** (النسخة الثانية تُلغي أحكام الأولى) | `e94ecc4` | نفس الفروع | أصلي، PROPOSED |
| `tools/nile-offerings/{offerings.ts,README.md,offerings.test.ts}` | سجل جاهزية الكتالوج | `c910b57` ثم `099dc14` ثم `3e9469a` بتاريخ 2026-10-18، 3 نسخ | 3 فروع وفرع التكامل | **مشتق** من home.js |
| `docs/STATUS.md` | الحالة و**خارطة الطريق** (§5) | 4 نسخ، آخرها 2026-10-14 | `main` | أصلي، معتمد |
| `docs/ARCHITECTURE.md` و`DECISIONS.md` و`docs/adr/0001–0010` | **المواصفات المعمارية** والقرارات | 2026-09-04 إلى 2026-10-14 | `main` | أصلية، معتمدة (0008 PROPOSED) |
| `docs/architecture/proposals/0002–0007` | تدقيق المصادر المفتوحة، وتجربة Odoo، ومذكرة السجل، و**تصميم محرك الدفع (0007)** | 2026-10-13 إلى 2026-10-14 | `main` | أصلية، PROPOSED |
| `docs/architecture/proposals/0001-platform-strategy.md` | استراتيجية المنصة (الأقدم) | 2026-10-13 | فرع `arena/bfcb5ed1` فقط | أصلي، **غير مدموج** ومستشهد به على `main` |
| `docs/REUSE.md` | مصدر كل محرك من مستودعات المحفظة | 5 نسخ | `main` | أصلي |
| `docs/FINANCIAL_RULES.md` و`docs/adr/kayyal-core/0001–0012` | قواعد kayyal المالية وقراراتها | `ac1f367` بتاريخ 2026-10-18 | فرع `docs/resolve-source-of-truth-citations` فقط | أصلي، **غير مدموج** |
| `AGENTS.md` و`.agents/skills/*` و`docs/agent-system/*` | قواعد الوكلاء | 2026-09-04 إلى 2026-10-18 | `main`، وبروتوكول التنفيذ الذاتي على PR #5 المفتوح | أصلية |

القائمة الكاملة (310 مسارات) موجودة في `INVENTORY_UNIFIED.csv` وفي `evidence/repo-files-all-history.csv`. لكل مسار: أول commit وآخر commit، وعدد النسخ، والفروع التي تحتويه، ورابط GitHub.

---

## 4) تقارير الوكلاء والاختبارات والتدقيق والأدلة

**داخل المستودع (أصلية):**
- **مراجعات `docs/reviews/`:** 9 مراجعات، منها 5 على `main` و4 على `handoff/2026-10-14-evidence` أو `fix/nile-pool-error-listener`.
- **أرشيف `docs/archive/agent-reports-2026-10-14/`:** 7 تقارير ومسودات PR، على فرع handoff فقط.
- **أدلة `tools/spikes/`:** تجربة Odoo/ETA، وG-7 runtime-role، وجدوى Supabase. فيها 67 ملف دليل (سجلات vitest وPG15/17/18، وملفات MANIFEST)، وكلها على فرع `handoff/2026-10-14-evidence` وبعض الفروع الأخرى.

**خارج المستودع (`deliverables/`):**
- **تقارير المهام 1–11 (16 تقريرًا):** منها `LENA_PARALLEL_AGENT_REPORT.md` و`SERVICES_REPORT.md` و`MISSION3_DELIVERY_REPORT.md` و`COORDINATION_*` و`FINAL_COORDINATION_REPORT` و`INTEGRATION_PLAN_2026-10-18.md` («خطة توحيد أعمال Nilesys»، وهي **ليست** خطة التنفيذ الأصلية) و`MISSION9_*` و`MISSION11_FINAL_REVIEW`.
- **أدلة `integration-probes/`:** 6 مجلدات، فيها ملفات SHA256SUMS. أعدت التحقق منها: **76/76 OK**.
- **مواد أخرى:** `ci/` (CI مقترح غير مُعتمد)، و`parity/` (مصفوفة التكافؤ 30/30)، و9 ملفات patch، و4 bundles.

**النسخ الاحتياطية (`backups/session-2026-10-18/`):** `SHA256SUMS` يطابق 7/7، و`git bundle verify` ينجح لكل الـbundles الأربعة. أرشيف `deliverables-2026-10-18.tar.gz` يحتوي 24 ملفًا، **كلها مطابقة بايت ببايت** للنسخ الحالية في `deliverables/`.

---

## 5) التكرار والنسخ المختلفة

| المجموعة | العلاقة | المرجع المعتمد |
|---|---|---|
| `docs/adr/0001-localization-arabic-rtl-first.md` (فرع arena) مقابل `docs/adr/0009-localization-arabic-rtl-first.md` (`main`) | المحتوى نفسه تقريبًا (تشابه 1.00) بعد إعادة الترقيم | **0009** على `main` |
| `docs/architecture-assessment.md` (8 فروع قديمة) مقابل `docs/archive/2026-09-04-architecture-assessment.md` | إعادة تسمية `R097` في `1a2ce95` | نسخة الأرشيف على `main` (HISTORICAL) |
| `archive/.../2026-10-14-post-merge-gate-report.md` مقابل `reviews/2026-10-14-post-merge-security-gate.md` | تشابه 93%، والثانية منقحة | `reviews/…` على `main` |
| `archive/.../2026-10-14-payment-engine-design.md` مقابل `proposals/0007-payment-engine.md` | تشابه 97% | `0007` على `main` |
| `g7-runtime-role-assertion-PR.md` مقابل `superseded/…-420c203.md` | نسختان مختلفتان (35%)، والثانية مستبدلة | الأولى |
| `prototypes/nilesys/README.md` نسخة `e74167b` مقابل نسخة `main` | الثانية أضافت ترويسة HISTORICAL فقط | **e74167b للمحتوى الأصلي**، و`main` للحالة |
| proposals 0002 و0005 على فرع arena مقابل `main` | تشابه 99%، وروابطها صُححت في `bf23dad` | `main` |
| الكتالوج نفسه | home.js (الأصل)، وofferings.ts (سجل مشتق)، وPRD 001 §3.1 وplan 001 §1.1 (إعادة صياغة)، وdemo-seed وcatalog.ts (المعرّفات في الكود) | **home.js** |
| تعارض «14 كرتًا» مقابل «7+7+5» | plan 001 §1.1 يحسمه: 14 = 7 أنظمة + 7 مواقع، والويندوز قسم منفصل بـ5 بلاطات «قريبًا» | home.js |
| تعارض الهوية | `PORTFOLIO.md` في platform يسمي nilesys «Kayyal»، بينما README وAGENTS يسميانه «Nile Systems». المصدر: LENA report §6 | غير محسوم، وPORTFOLIO.md غير متاح الآن |
| PRD 001 («بديل لـ platform») مقابل vision 001 v2 («LENA مظلة») | تعارض في الاتجاه، وTODO 001 يوجّه إلى vision 001 | vision 001، مع أن كليهما PROPOSED |
| `deliverables/nilesys-feat-nile-offerings-readiness.bundle` | **مطابق بايت ببايت** للنسخة في `backups/` | أي منهما |
| `deliverables/…mission3-pos-fixes-pg-tests.bundle` (`3e9469a`) | مستبدل بـ`…-c72f746.bundle` | `c72f746` |
| 9 ملفات patch في `deliverables/nilesys-patches*` | **نسخ** من commits موجودة على GitHub، والتطابق مثبت بـpatch-id: `b0c17fc` و`c910b57` و`a03cca9` و`7a3207e` و`099dc14` و`43af873` و`47d8bea` و`3e9469a` و`c72f746` | الـcommits على GitHub |
| وصف PR #3 | نسخة من مراجعة `engines-db-auth-review` | الملف في `docs/reviews/` |

---

## 6) علاقة NILESYS بمستودع PLATFORM: الوثائق الموجودة

| الوثيقة | ما تقوله | الحالة |
|---|---|---|
| `docs/vision/001-lena-as-umbrella-nile-integration.md` | LENA Digital House هي المظلة، وNile يندمج داخلها. لا قرار بأرشفة platform | PROPOSED، على فرع POS-DST وفرع التكامل |
| `docs/prd/001-marketing-site-as-platform.md` | موقع تسويقي «كبديل لـ platform»، مع إعادة استخدام `SystemGrid` و`AppShell` و`SeoHead` و`FounderCard` من `platform/artifacts/lena` | PROPOSED، وتتعارض معه vision v2 |
| `docs/plan/001-pos-implementation-ready.md` المرحلة 1 | المكان `apps/marketing` **أو** `platform/artifacts/lena/src/pages` | PROPOSED |
| `docs/architecture/proposals/0001-platform-strategy.md` | استراتيجية «Mohamed App Factory» | Draft، فرع arena فقط |
| PR #5 و`AUTONOMOUS_EXECUTION_PROTOCOL.md` | «No approved Nile-to-Platform migration is implied» | PR مفتوح |
| `deliverables/LENA_PARALLEL_AGENT_REPORT.md` و`COORDINATION_AUDIT_COMMIT4.md` و`COORDINATION_RESOLUTION` | تصنيف المحفظة، وحالة روابط platform، والاعتماد على PR #98 | خارج المستودع |
| platform PR #98: `docs/handoff/HANDOFF_ar.md` و`docs/ops-kit/PORTFOLIO.md` (17 ملفًا، `a54ed5f`) | قرارات المالك: «6 منتجات منصة واحدة»، وKayyal قبل POS، ونسخ 14 فحص CI من malek | ❌ **مشار إليه فقط.** قُرئ في 2026-10-18 بتوكن لم يعد مسموحًا، ونسخته المؤقتة `/tmp/pr98` فُقدت. ملخصه موجود في ذاكرة الجلسة فقط |

---

## 7) الملفات المفقودة أو المشار إليها فقط

| الملف | من يشير إليه | الحالة الفعلية |
|---|---|---|
| `docs/OPEN_BUSINESS_DECISIONS.md` | `engines/transactions/src/money-by-currency.ts` | **غير موجود** في أي commit |
| `docs/adr/0011-marketing-site-is-platform.md` | TODO 001 | لم يُنشأ |
| `docs/adr/0009-cash-reconciliation.md` | `cash.ts` و`engines/README.md` | غير موجود بهذا المسار. البديل `docs/adr/kayyal-core/0009-cash-reconciliation.md` موجود على فرع غير مدموج |
| `docs/FINANCIAL_RULES.md` | `REUSE.md` و`engines/README.md` على `main` | موجود على فرع غير مدموج فقط |
| `docs/reviews/2026-10-14-supabase-feasibility.md` و`…-g7-redesign-design-review.md` | `STATUS.md` على `main` | موجودان على فرع handoff فقط |
| `docs/architecture/proposals/0001-platform-strategy.md` و`docs/adr/README.md` | `architecture/README.md` و`DECISIONS.md` | موجودان على فرع arena فقط |
| `tools/eta_serialize.py` | proposal 0003 | غير موجود |
| `tools/parity/*` و`parity.test.js` | TODO 001 | غير موجودة في المستودع. البديل الفعلي `deliverables/parity/run-parity.sh` |
| `.github/workflows/ci.yml` | Mission 10 | غير موجود. المسودة في `deliverables/ci/` |
| `apps/marketing` و`apps/pos` و`libs/design-system` و`libs/i18n` وغيرها | PRD/TODO/plan 001 | خطط لم تُبنَ بعد |
| `/home/user/nilesys-backup-phase1.tar.gz` (sha256 `1fa8a354…d02f`) و`/home/user/nilesys/` مع `data/db.json` | `REVIEW.md:10` و`README` | **مفقودة.** كانت على جهاز النموذج الأصلي وليست في مساحة العمل |
| مكونات `platform/artifacts/lena/*` و`platform/design-system` | PRD/plan 001 | غير متاحة لأن المستودع خاص |

يوجد 27 مسارًا غير محلول في روابط `main`، و67 على فرع التكامل (أغلبها خطط لملفات مستقبلية)، و24 على فرع docs. القوائم كاملة في `evidence/dead-refs-*.tsv`.

---

## 8) ما لم يكتمل ولماذا

1. **مستودع `platform` و7 مستودعات خاصة أخرى:** تعذّر الوصول (404). لم أستخدم أي توكن قديم. فحصها يحتاج طريقة وصول آمنة ومصرّحًا بها منك، مثل توكن قراءة فقط محدود المدة.
2. **Supabase:** الربط مغلق في هذه المحادثة، وفحصه يحتاج تفعيلك.
3. **المحادثات السابقة:** نصوصها غير متاحة. الجرد يعتمد على ذاكرة الجلسة والتقارير المحفوظة فقط.
4. **Vercel ولوحات الاستضافة:** لم تُفحص من الداخل، وفحصت فقط استجابة HTTP العامة.
5. **Google Drive:** فُحص بالكامل، ولا يحتوي ملفات NILESYS. لم أقرأ محتوى prompt «متطلبات نظام إدارة العقارات» في AI Studio، وارتباطه بالمشروع غير مثبت.
6. **تواريخ تعديل الملفات خارج المستودع (mtime):** أعيد ضبطها عند استعادة البيئة إلى 2026-10-19 08:39، فلا يُعتمد عليها. التاريخ الموثوق هو التاريخ المكتوب في اسم الملف أو محتواه، ومعه sha256.

---

## 9) مخرجات هذا الجرد (كلها جديدة، داخل هذا المجلد فقط)

| الملف | المحتوى |
|---|---|
| `INVENTORY_REPORT_ar.md` | هذا التقرير |
| `INVENTORY_UNIFIED.csv` | **الجرد الموحد** (459 صفًا): الاسم، والموقع، والرابط، والوظيفة، والنوع، والتاريخ والنسخة، وهل هو أصلي أم نسخة، والفروع، وحالة الوصول، والدليل |
| `collected-copies/` | نسخ (وليست نقلًا) لـ102 وثيقة مستخرجة بـ`git show`: آخر نسخة من كل وثيقة غير برمجية (97)، و**النسخ الأصلية** للكتالوج والخطة كما في `e74167b` (5). مع `MANIFEST.tsv` |
| `evidence/` | `repo-files-all-history.csv` و`outside-repo-files.csv` و`refs-snapshot.txt` و`dead-refs-*.tsv` وفحوص sha256 والـbundles و`github-*.json` و`external-sources.txt` |
| `tools/` | سكربتات القراءة التي أنتجت الجرد، ويمكن إعادة تشغيلها |
| `SHA256SUMS` | بصمات كل ملفات هذا المجلد |

**حالة المستودع بعد الجرد:** لم يتغير. الفرع `integration/nile-2026-10-18` عند `0207c13` (محلي، ولم يُرفع)، و`main` عند `52af469`، والملف الوحيد غير المتتبَّع هو `pnpm-lock.yaml`، والفرع البعيد للتكامل لا يزال عند `b25cb65`.
