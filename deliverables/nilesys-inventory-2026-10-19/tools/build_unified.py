#!/usr/bin/env python3
"""Merge the repo-history inventory, the outside-repo inventory and the hand-checked external /
referenced-only sources into one table: INVENTORY_UNIFIED.csv (+ a Markdown view of the key rows)."""
import csv, os, subprocess
O = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = os.path.join(O, 'evidence')
REPO = '/home/user/repos/nilesys'
GH = 'https://github.com/mohamedmasoud3030-tech/nilesys/blob'
full = lambda r: subprocess.run(['git', '-C', REPO, 'rev-parse', r], capture_output=True, text=True).stdout.strip()

FUNC = {
 'prototypes/nilesys/public/assets/js/home.js': 'المصدر الأصلي لكتالوج المزايا: مصفوفات SYSTEMS(7) وSITES(7) وWINDOWS(5) مع وصف ومزايا كل نظام بالعربية والإنجليزية',
 'prototypes/nilesys/README.md': 'وثيقة النموذج الأصلية: مزايا المرحلة 1 (الكاشير) وخطة المراحل 2-5 الأصلية + الـAPI',
 'prototypes/nilesys/REVIEW.md': 'المراجعة الهندسية للمرحلة 1: 30 سيناريو، 6 عيوب، خطة إصلاح مرتبة بالخطورة',
 'prototypes/nilesys/public/index.html': 'الصفحة الرئيسية للنموذج (شبكات الأنظمة والمواقع والويندوز)',
 'prototypes/nilesys/public/assets/js/i18n.js': 'قاموس عربي/إنجليزي لنصوص الكتالوج والكاشير',
 'prototypes/nilesys/public/systems/pos.html': 'واجهة الكاشير في النموذج',
 'docs/plan/001-pos-implementation-ready.md': 'خطة تنفيذ POS داخل LENA (4 مراحل) — PROPOSED',
 'docs/prd/001-marketing-site-as-platform.md': 'متطلبات PRD: الموقع التسويقي + 5 مراحل مزايا موسّعة — PROPOSED',
 'docs/todo/001-marketing-phased-todo.md': 'TODO تنفيذي مفصل للمراحل — موسوم بأنه مبني على تفسير منسوخ ولا يُنفذ قبل ADR-0011',
 'docs/vision/001-lena-as-umbrella-nile-integration.md': 'رؤية: LENA مظلة وNile يندمج داخلها (v2) — PROPOSED',
 'tools/nile-offerings/offerings.ts': 'سجل جاهزية الكتالوج (19 مدخلًا: 7+7+5) مشتق من home.js مع حالة كل مدخل',
 'tools/nile-offerings/README.md': 'شرح سجل الجاهزية',
 'docs/STATUS.md': 'الحالة الحالية وخارطة الطريق (§5 Next work) — الملف الحي الوحيد للحالة',
 'docs/REUSE.md': 'سجل مصدر كل محرك مستخرج من مستودعات المحفظة',
 'docs/architecture/proposals/0001-platform-strategy.md': 'مقترح استراتيجية المنصة (الأقدم) — على فرع arena فقط',
 'docs/architecture/proposals/0007-payment-engine.md': 'تصميم محرك المدفوعات (I1-I12)',
 'docs/FINANCIAL_RULES.md': 'قواعد مالية منقولة من kayyal — على فرع غير مدموج',
}

rows = []
for r in csv.DictReader(open(os.path.join(E, 'repo-files-all-history.csv'), encoding='utf-8')):
    if r['category'] in ('source code', 'test', 'spike/probe code', 'config/other') and r['path'] not in FUNC:
        kind = 'كود/اختبار'
    else:
        kind = 'وثيقة/دليل'
    # GitHub link must point at a commit that exists on GitHub: main, else pushed integration, else any origin branch
    cands = ['origin/main', 'b25cb656a0718cca4ecbc845b1d263240d31ae94'] + ['origin/' + b for b in r['remote_branches'].split()]
    link_ref = next((c for c in cands if subprocess.run(['git', '-C', REPO, 'cat-file', '-e', f"{c}:{r['path']}"], capture_output=True).returncode == 0), None)
    sha = full(link_ref) if link_ref else None
    dup = []
    if r['identical_content_at']: dup.append('محتوى مطابق في: ' + r['identical_content_at'])
    if r['status'] == 'on main': orig = 'أصلي (النسخة المعتمدة على main)'
    elif r['on_integration'] == 'Y': orig = 'أصلي — على فرع التكامل/فروع غير مدموجة'
    else: orig = 'أصلي على فرع غير مدموج'
    rows.append(dict(
        name=os.path.basename(r['path']), location=f"nilesys:{r['path']}", link=(f'{GH}/{sha}/{r["path"]}' if sha else 'محلي فقط (commit غير مرفوع) — لا رابط GitHub'),
        function=FUNC.get(r['path'], r['title'] or r['category']), kind=kind, category=r['category'],
        date_version=f"أول: {r['first_commit']} · آخر: {r['last_commit']} · نسخ: {r['n_versions']}",
        original_or_copy=orig + ('; ' + '; '.join(dup) if dup else ''),
        branches=('main + ' if r['on_main'] == 'Y' else '') + f"{len(r['remote_branches'].split())} فرع بعيد",
        access='متاح (مستودع عام + نسخة محلية)', evidence='evidence/repo-files-all-history.csv'))

for r in csv.DictReader(open(os.path.join(E, 'outside-repo-files.csv'), encoding='utf-8')):
    copy = 'نسخة' if (r['identical_files'] or 'identical diff to commit' in r['description'] or r['path'].endswith('.bundle')) else 'أصلي (خارج المستودع فقط)'
    if r['identical_files']: copy += ' — مطابق لـ: ' + r['identical_files']
    if r['backup_status'] == 'identical copy in backup tar': copy += ' — وله نسخة مطابقة داخل backups/…/deliverables-2026-10-18.tar.gz'
    rows.append(dict(name=os.path.basename(r['path']), location=r['path'], link='/home/user/' + r['path'],
        function=r['description'], kind='تقرير/دليل خارج المستودع', category='outside-repo',
        date_version=f"mtime {r['modified_utc']} (غير موثوق: أعيد ضبطه عند استعادة البيئة) · sha256 {r['sha256'][:12]}",
        original_or_copy=copy, branches='—', access='متاح محليًا (ليس على GitHub)', evidence='evidence/outside-repo-files.csv'))

EXT = [
 # name, location, link, function, date, original/copy, access
 ('platform (repo)', 'GitHub mohamedmasoud3030-tech/platform', 'https://github.com/mohamedmasoud3030-tech/platform', 'مستودع LENA (المظلة) — مصدر مكونات الواجهة والتسليم', 'آخر قراءة: 2026-10-18 بتوكن سابق', 'أصلي', 'غير متاح الآن: 404 بدون مصادقة (خاص أو أعيدت تسميته)'),
 ('HANDOFF_ar.md', 'platform PR #98 docs/handoff/HANDOFF_ar.md @a54ed5f', 'https://github.com/mohamedmasoud3030-tech/platform/pull/98', 'تسليم المالك: 6 منتجات منصة واحدة، قرارات وقواعد، نسخ 14 فحص CI من malek', '2026-10-18', 'أصلي؛ ملخص محفوظ في ذاكرة الجلسة فقط ونسخة /tmp/pr98 فُقدت', 'غير متاح الآن (مشار إليه في COORDINATION_AUDIT_COMMIT4.md)'),
 ('PORTFOLIO.md', 'platform docs/ops-kit/PORTFOLIO.md (PR #98)', 'https://github.com/mohamedmasoud3030-tech/platform/pull/98', 'سجل المحفظة — يسمي nilesys «Kayyal» (تضارب هوية)', '2026-10-18', 'أصلي', 'غير متاح الآن (مشار إليه في LENA_PARALLEL_AGENT_REPORT.md §6)'),
 ('SystemGrid.tsx / AppShell.tsx / SeoHead.tsx / FounderCard.tsx', 'platform artifacts/lena/src/components/', '—', 'مكونات واجهة LENA المقترح إعادة استخدامها', 'غير معروف', 'أصلي', 'مشار إليه فقط في PRD/plan/todo 001 — غير متاح'),
 ('design-system/', 'platform/design-system/', '—', 'نظام التصميم الموحد', 'غير معروف', '—', 'مشار إليه فقط («فارغ حاليًا» حسب PRD 001) — غير متاح'),
 ('starting / malek / Terranex / bug-free-garbanzo / carmen-gallery- / larabeauty- / Lenastore', 'GitHub repos', 'https://github.com/mohamedmasoud3030-tech', 'مستودعات مصدر المحركات المستخرجة (REUSE.md)', '—', 'أصلي', 'غير متاح الآن: 404 بدون مصادقة'),
 ('nilesys-backup-phase1.tar.gz', '/home/user/nilesys-backup-phase1.tar.gz (جهاز النموذج الأصلي)', '—', 'نسخة آمنة للنموذج قبل المراجعة (sha256 1fa8a354…d02f)', '2026-10-13', 'أصلي', 'مفقود: غير موجود في مساحة العمل؛ مذكور في REVIEW.md:10'),
 ('nilesys/ + data/db.json', '/home/user/nilesys/ (جهاز النموذج الأصلي)', '—', 'مجلد عمل النموذج وبياناته الحية', '2026-10-13', 'أصلي', 'مفقود: غير موجود؛ README يقول إنه على جهاز محلي وليس في المستودع'),
 ('marketing-app.runasp.net', 'موقع خارجي (ديمو كود ماتريكس)', 'https://marketing-app.runasp.net/', 'المرجع الذي بُني النموذج «على غراره»', 'فحص 2026-10-19', 'طرف ثالث', 'متاح (HTTP 200)'),
 ('nilesys.vercel.app', 'Vercel', 'https://nilesys.vercel.app/', 'نشر الإنتاج المسجل للمستودع', 'فحص 2026-10-19', '—', 'يرد 404 (لا مخرجات ويب)'),
 ('Google Drive (23 عنصرًا)', 'Google Drive المتصل', 'https://drive.google.com/drive/folders/1AYz3WaRnDKq_J789eyPMLByY8H8EI8ih', 'كله مشروع TerraNex التسويقي (فيديوهات، عرض، سجل محتوى) — لا شيء عن NILESYS', '2026-10-18', '—', 'متاح؛ بحث الاسم والنص الكامل عن nile/NILESYS/POS/نقاط البيع = 0 نتائج ذات صلة'),
 ('تحديد متطلبات نظام إدارة العقارات', 'Google Drive / Google AI Studio', 'https://drive.google.com/file/d/1gWov33fktqZvJJZTLA0wuLMx3lXgE5iK', 'Prompt في AI Studio لمتطلبات نظام عقارات', '2026-08-28', 'أصلي', 'متاح كبيانات وصفية؛ ارتباطه بـ NILESYS غير مثبت (قد يخص MALEK) — لم يُقرأ محتواه'),
 ('PR #1–#5 (descriptions)', 'GitHub nilesys pulls', 'https://github.com/mohamedmasoud3030-tech/nilesys/pulls?q=is%3Apr', 'أوصاف PR؛ وصف #3 نسخة من مراجعة engines-db-auth', '2026-10-13 → 2026-10-15', 'PR #3 body = نسخة', 'متاح؛ محفوظ في evidence/github-nilesys-pulls.json'),
]
MISSING = [
 ('docs/OPEN_BUSINESS_DECISIONS.md', 'مستشهد به في engines/transactions/src/money-by-currency.ts', 'غير موجود في أي فرع أو commit'),
 ('docs/adr/0011-marketing-site-is-platform.md', 'مخطط في docs/todo/001', 'لم يُنشأ قط'),
 ('docs/adr/0009-cash-reconciliation.md', 'مستشهد به في engines/transactions/src/cash.ts و engines/README.md', 'غير موجود بهذا المسار؛ يوجد بديل docs/adr/kayyal-core/0009-cash-reconciliation.md على الفرع غير المدموج docs/resolve-source-of-truth-citations'),
 ('docs/FINANCIAL_RULES.md', 'مستشهد به في docs/REUSE.md و engines/README.md على main', 'موجود فقط على docs/resolve-source-of-truth-citations (غير مدموج)'),
 ('tools/parity/run.sh, tools/parity/baseline-001.txt, prototypes/nilesys/tests/parity.test.js', 'مخطط في docs/todo/001 §1.1', 'غير موجود في المستودع؛ البديل الفعلي deliverables/parity/run-parity.sh (خارج المستودع)'),
 ('apps/marketing, apps/pos, apps/inventory, libs/design-system, libs/i18n', 'مخطط في PRD/TODO/plan 001', 'لم تُبنَ'),
 ('.github/workflows/ci.yml', 'مقترح Mission 10', 'غير موجود في المستودع؛ المسودة في deliverables/ci/nilesys-ci.yml'),
 ('tools/eta_serialize.py', 'مستشهد به في docs/architecture/proposals/0003-option-c-spike.md', 'غير موجود في أي فرع'),
 ('engines/platform/src/whatsapp.ts, docs/archive/platform-legacy/', 'مخطط في TODO/PRD 001', 'غير موجود'),
 ('docs/reviews/2026-10-14-supabase-feasibility.md, docs/reviews/2026-10-14-g7-redesign-design-review.md', 'مستشهد بهما في docs/STATUS.md على main', 'موجودان فقط على الفرع handoff/2026-10-14-evidence'),
 ('docs/architecture/proposals/0001-platform-strategy.md, docs/adr/README.md', 'مستشهد بهما في docs/architecture/README.md و DECISIONS.md', 'موجودان فقط على الفرع arena/bfcb5ed1-mohamed-app-factory'),
 ('محادثات الجلسات السابقة', 'سياق هذه المحادثة', 'غير متاحة كنصوص؛ المتاح فقط ملخص ذاكرة الجلسة والتقارير المحفوظة في deliverables'),
]
for n, loc, link, fn, d, oc, acc in EXT:
    rows.append(dict(name=n, location=loc, link=link, function=fn, kind='مصدر خارجي', category='external',
                     date_version=d, original_or_copy=oc, branches='—', access=acc, evidence='evidence/external-sources.txt'))
for n, ref, st in MISSING:
    rows.append(dict(name=n, location='—', link='—', function=f'مشار إليه فقط: {ref}', kind='مشار إليه/مفقود',
                     category='referenced-only', date_version='—', original_or_copy='—', branches='—', access=st,
                     evidence='evidence/dead-refs-*.tsv'))
with open(os.path.join(O, 'INVENTORY_UNIFIED.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(len(rows), 'rows')
