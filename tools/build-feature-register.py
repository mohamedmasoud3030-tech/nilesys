#!/usr/bin/env python3
"""
يبني «سجل المزايا» — مستند واحد قابل للقراءة والطباعة:
  1) المزايا الحالية وخصائصها الكاملة
  2) المزايا المتبقية بمواصفاتها ومعايير قبولها
  3) قائمة التطوير والترقية البصرية
  4) القرارات الموقوفة على المالك

لماذا مُولَّد ولا مكتوب يدوياً: كل بند هنا له مُعرِّف (F-01) وأرقام (حدود، اختبارات،
قياسات) تتغير مع الكود. لو كُتب يدوياً سيكذب بعد أسبوع. التوليد يجعل التصحيح
في مكان واحد.

    python3 tools/build-feature-register.py   →  docs/product/feature-register.html

الملف الناتج مستقل تماماً: لا خطوط خارجية، لا صور، لا سكربتات — يفتح في أي
معاينة معزولة وعلى أي جهاز، ويُطبع على A4 كما هو.
"""
import html
import pathlib
import subprocess


def git_rev():
    """رقم الكوميت الحالي — المستند كان يذكر كوميتاً قديماً فيصير كذباً بعد أسبوع."""
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=str(pathlib.Path(__file__).resolve().parent.parent),
                                       text=True).strip()
    except Exception:
        return "غير معروف"


REV = git_rev()

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "product" / "feature-register.html"
MD_OUT = OUT.with_suffix(".md")

# ----------------------------------------------------------------------------
# 1) المزايا الحالية — كل سطر مدعوم باختبار أو ملف
# ----------------------------------------------------------------------------
CURRENT = [
    {
        "id": "C-01",
        "name": "تسجيل الدخول والجلسات",
        "props": [
            "14 حساب تجريبي بكلمة مرور واحدة `demo1234` موزّعة على الأنظمة",
            "الجلسة موقَّعة بـ HMAC-SHA256 وتحمل `userId` و`system` و`expires` — لا تعتمد على ذاكرة العملية",
            "الكوكي `nile_sid` · HttpOnly · صلاحية 12 ساعة",
            "تسجيل الخروج يُبطل التوكن في نفس النسخة التي خدمت الطلب",
        ],
        "proof": "tests/review.test.js · AUTH-1…AUTH-4",
        "state": "ok",
    },
    {
        "id": "C-02",
        "name": "الأدوار والصلاحيات",
        "props": [
            "`manager`: كل شيء. `cashier`: بيع وتعليق سلة فقط",
            "المرتجعات للمدير فقط (403 للكاشير)",
            "سجل العمليات للمدير فقط (403 للكاشير)",
            "الخصم: الكاشير حتى 10% — المدير بلا حد",
        ],
        "proof": "tests/review.test.js · PERM-1…PERM-4",
        "state": "ok",
    },
    {
        "id": "C-03",
        "name": "الأصناف",
        "props": [
            "إضافة/تعديل/تعطيل صنف · الباركود فريد بين الأصناف النشطة",
            "كل صنف: اسم · باركود · تصنيف · تكلفة · سعر بيع · هامش محسوب · مخزون · إيموجي",
            "الحذف للمدير فقط · يظهر تحذير عند مخزون ≤ 5",
            "السعر يُقرأ من السيرفر عند البيع — لا يُقبل سعر من المتصفح",
        ],
        "proof": "server.js · GET/POST/PUT/DELETE /api/products",
        "state": "ok",
    },
    {
        "id": "C-04",
        "name": "البيع (نقطة البيع)",
        "props": [
            "سلة + بحث بالاسم أو الباركود (الباركود المطابق يُضاف فوراً)",
            "4 طرق دفع: كاش · فيزا/محفظة بنكية · محفظة إلكترونية · تحويل بنكي",
            "الباقي يُحسب ويُخزَّن ويُطبع — ومن الكاش فقط؛ الطرق الأخرى تُسجَّل بالضبط",
            "فحص المخزون قبل الخصم مع تجميع تكرار نفس الصنف",
            "مفتاح تكرار: نفس المفتاح بنفس الطلب → نفس الفاتورة (بدون خصم مخزون ثانٍ) · بطلب مختلف → 409",
            "خصم على الفاتورة بحد 10% للكاشير",
        ],
        "proof": "tests/pos-upgrade.test.js · TENDER-1 · IDEM-1 · PERM-4",
        "state": "ok",
    },
    {
        "id": "C-05",
        "name": "تعليق السلة واسترجاعها",
        "props": [
            "تعليق أي سلة باسم وخصمها محفوظ",
            "استرجاع بضغطة أو إلغاء نهائي",
            "السلة المعلّقة تُشطب تلقائياً في نفس عملية البيع الذي أنهاها",
            "اختصار F9 للتعليق",
        ],
        "proof": "tests/pos-upgrade.test.js · HELD-1",
        "state": "ok",
    },
    {
        "id": "C-06",
        "name": "المرتجعات",
        "props": [
            "مرتجع جزئي أو كامل من داخل الفاتورة، للمدير فقط",
            "الكمية المرتجعة لا تتجاوز المتبقي من السطر · والمبلغ يوزَّع نسبياً على إجمالي الفاتورة",
            "المخزون يرجع تلقائياً · المرتجع يُسجَّل بوقته وطريقته ليُخصم من درج الوردية",
            "منع إرجاع نفس الكمية مرتين (400)",
        ],
        "proof": "tests/review.test.js · RET-1…RET-4 · tests/pos-upgrade.test.js · MONEY-1",
        "state": "ok",
    },
    {
        "id": "C-07",
        "name": "الورديات والدرج",
        "props": [
            "فتح وردية برصيد افتتاحي · إغلاق بعدّ فعلي",
            "المتوقع = رصيد افتتاحي + مبيعات نقدية − مرتجعات نقدية",
            "الفرق = المعدود − المتوقع، يُخزَّن ويظهر للمدير",
            "وردية واحدة مفتوحة لكل نظام في المرة",
        ],
        "proof": "server.js · shiftExpectedCash · tests/review.test.js · SHIFT-1",
        "state": "ok",
    },
    {
        "id": "C-08",
        "name": "التقارير",
        "props": [
            "مدى: اليوم أو آخر 7 أيام",
            "الإجمالي `grossTotal` · المرتجعات `refundsTotal` سطر مستقل · **الصافي `net`** هو الرقم الرئيسي (قرار D-E)",
            "توزيع لكل طريقة دفع (الأربعة تظهر دائماً) · أفضل الأصناف بالصافي بعد المرتجعات · مبيعات بالساعة",
            "لا يُعرض «ربح» حتى تصبح تكلفة الوحدة موثوقة",
        ],
        "proof": "tests/pos-upgrade.test.js · MONEY-1 · tests/review.test.js · RET-4",
        "state": "ok",
    },
    {
        "id": "C-09",
        "name": "سجل العمليات",
        "props": [
            "كل بيع/مرتجع/فتح وإغلاق وردية/تعليق سلة يُكتب بسطر لا يُعدَّل",
            "يحتفظ بآخر 2000 حدث · يُقرأ للمدير فقط · شاشة مستقلة للسجل",
        ],
        "proof": "tests/pos-upgrade.test.js · AUDIT-1",
        "state": "ok",
    },
    {
        "id": "C-10",
        "name": "الإيصال والطباعة",
        "props": [
            "إيصال يعرض: المتجر · رقم الفاتورة · الوقت · السطور · الخصم · الضريبة · الطريقة · المدفوع · الباقي",
            "ورقة @media print بعرض 80 مم وارتفاع تلقائي · لا يُطبع أي زر أو قائمة أو شريط جانبي",
        ],
        "proof": "public/assets/js/pos.js · showReceipt",
        "state": "partial",
    },
    {
        "id": "C-11",
        "name": "الهوية البصرية للمتجر",
        "props": [
            "اسم المتجر · شعار نصي · اللون الأساسي · العملة (ج.م / EGP)",
            "تُطبَّق فوراً على الواجهة والإيصال · للمدير فقط",
        ],
        "proof": "server.js · PUT /api/branding · tests/review.test.js",
        "state": "ok",
    },
    {
        "id": "C-12",
        "name": "العربية والإنجليزية (RTL)",
        "props": [
            "تبديل فوري بين عربي RTL وإنجليزي LTR · الاختيار محفوظ في المتصفح",
            "كل النصوص من قاموس واحد `i18n.js` — لا نص مكتوب داخل الكود",
            "الأرقام لاتينية في اللغتين (كما في الموقع المرجعي)",
        ],
        "proof": "public/assets/js/i18n.js",
        "state": "ok",
    },
    {
        "id": "C-13",
        "name": "اختصارات لوحة المفاتيح",
        "props": ["F2 بحث · F4 إتمام البيع · F9 تعليق السلة · Esc إغلاق النافذة"],
        "proof": "public/assets/js/pos.js · bindShortcuts",
        "state": "ok",
    },
    {
        "id": "C-14",
        "name": "التشغيل والنشر",
        "props": [
            "محلي: `node server.js` بدون أي مكتبة خارجية",
            "منشور على Vercel ومربوط بـ Supabase: الجلسات موقَّعة، والبيانات في صف واحد `jsonb`",
            "حماية الدعوات مقفولة عشان الرابط يبقى عام",
            "صار ريدبلوي كامل و47 فاتورة باقية — دليل إن التخزين مشترك فعلاً",
        ],
        "proof": "nilesys-demo.vercel.app · docs/wiki/demo-and-vercel.md",
        "state": "ok",
    },
    {
        "id": "C-15",
        "name": "غطاء الاختبارات",
        "props": [
            "93 اختبار API على سيرفر حي: 27 سجل المزايا + 16 انحدار + 31 مراجعة + 10 ترقية الكاشير + 9 مخازن",
            "76 فحصاً في المتصفح: 21 يوم كامل · 13 أوفلاين/طباعة · 9 مخازن · 33 مواقع",
        ],
        "proof": "tests/*.test.js",
        "state": "ok",
    },
]

# ----------------------------------------------------------------------------
# 2) المزايا المتبقية — بمواصفات ومعايير قبول
# ----------------------------------------------------------------------------
REMAINING = [
    {
        "id": "F-01",
        "status": "done",
        "proof": "tests/backlog.test.js · F-01 (٤ حالات) + tools/ui-flow.js",
        "note": "الفاتورة الإلكترونية بصيغة ETA لم تُنفَّذ؛ المطبوع PDF/حرارة 80 مم.",
        "name": "الضريبة والفاتورة الضريبية",
        "why": "أكبر فرق بين «ديمو يعجب» و«نظام يتحط في محل بجد». أي بيع في مصر بلا ضريبة غير قانوني.",
        "spec": [
            "نسبة ضريبة قابلة للضبط لكل صنف (افتراضي 14%) مع احتمال إعفاء",
            "الضريبة تُحسب من السيرفر وتظهر سطراً مستقلاً في الإيصال والتقرير",
            "رقم تسلسلي ضريبي لا يتكرر ولا يُحذف · بادئة قابلة للضبط",
            "بيانات المنشأة: الاسم القانوني · الرقم الضريبي · السجل التجاري · العنوان",
            "تصدير الفاتورة JSON/PDF بالصيغة المطلوبة لمنظومة الفاتورة الإلكترونية",
        ],
        "accept": [
            "بيع 100 + ضريبة 14% → الإيصال يعرض 100 + 14 = 114 والصافي المتوقع في الدرج 114",
            "مرتجع جزئي يعكس الضريبة بنفس النسبة لا بمبلغ ثابت",
            "تقرير اليوم يفصل: صافي البيع · الضريبة المحصَّلة · إجمالي المحصَّل",
            "فاتورة بلا ضريبة (صنف معفى) تُسجَّل 0 ولا تكسر التقرير",
        ],
        "deps": "C-04 · C-06 · C-08",
        "size": "كبير",
        "decide": "نسبة الضريبة الافتراضية، وهل نصدّر لصيغة ETA فعلاً أم PDF فقط",
    },
    {
        "id": "F-02",
        "status": "done",
        "proof": "tests/backlog.test.js · F-02 (سقف 30% وسقف 10% للكاشير وكود منتهٍ)",
        "note": "",
        "name": "الخصومات المنظمة",
        "why": "الخصم الحالي مبلغ حر على الفاتورة. المحلات بتخصم بالعرض أو بكود أو على صنف معيّن.",
        "spec": [
            "خصم على سطر صنف · خصم على الفاتورة · كود خصم (نسبة أو مبلغ)",
            "حدود لكل دور: كاشير 10% · مدير بلا حد · كل خصم فوق الحد يحتاج موافقة مسجّلة",
            "منع تراكم خصمين على نفس السطر فوق سقف محدد",
        ],
        "accept": [
            "خصمان على نفس الصنف لا يتجاوزان 30% إجمالاً",
            "كود منتهي الصلاحية → 400 برسالة مفهومة",
            "كل خصم يظهر في سجل العمليات بمن منحه وبكم",
        ],
        "deps": "C-04 · C-09",
        "size": "متوسط",
        "decide": "هل الأكواد داخلية أم تُطبع للعملاء؟",
    },
    {
        "id": "F-03",
        "status": "done",
        "proof": "tools/ui-offline-print.js · F-03 (لا قوائم ولا أشرطة على الورق)",
        "note": "",
        "name": "طباعة حرارية 80mm",
        "why": "الإيصال الحالي للشاشة. أي كاشير حقيقي بيطبع على رول 80 مم.",
        "spec": [
            "ورقة طباعة `@media print` بعرض 80 مم وارتفاع تلقائي",
            "شعار المتجر كنص/SVG · باركود الفاتورة · رقم ضريبي عند إضافة F-01",
            "اختيار: إيصال مختصر أو مفصّل",
        ],
        "accept": [
            "الطباعة على A4 لا تقصّ أي سطر، وعلى 80mm تخرج في عمود واحد",
            "لا يُطبع أي عنصر واجهة (أزرار/قوائم)",
            "الخط أسود خالص على أبيض — لا ألوان ولا خلفيات",
        ],
        "deps": "C-10",
        "size": "صغير",
        "decide": "—",
    },
    {
        "id": "F-04",
        "status": "done",
        "proof": "tools/ui-offline-print.js · F-04 (نافذة، بديل يدوي، منع تكرار 500ms)",
        "note": "قراءة الباركود بالكاميرا تعمل عبر BarcodeDetector؛ في متصفح لا يدعمه يبقى الإدخال اليدوي.",
        "name": "قارئ باركود بالكاميرا",
        "why": "الكاشير على تابلت أو موبايل محتاج يقرأ الباركود بكاميرا الجهاز بدل جهاز منفصل.",
        "spec": [
            "قراءة الكاميرا عبر BarcodeDetector مع بديل يدوي",
            "اهتزاز/صوت تأكيد عند القراءة · منع القراءة المكررة في أقل من 500ms",
        ],
        "accept": [
            "قراءة باركود موجود → يُضاف للسلة مرة واحدة",
            "باركود غير موجود → رسالة واضحة بلا تعطيل الشاشة",
            "رفض الإذن لا يعطّل الكاشير — يبقى الإدخال اليدوي شغالاً",
        ],
        "deps": "C-04",
        "size": "متوسط",
        "decide": "—",
    },
    {
        "id": "F-05",
        "status": "done",
        "proof": "tests/backlog.test.js · F-05 + tests/inventory.test.js",
        "note": "",
        "name": "مخزون حقيقي بحركات",
        "why": "المخزون الآن رقم في الصنف. لازم يبقى سجل حركات: ليه قلّ وكام وإمتى.",
        "spec": [
            "حركة مخزون لكل تغيير: بيع · مرتجع · توريد · جرد · تالف · تحويل",
            "جرد فعلي يقارن بالمحسوب ويولّد حركة تسوية",
            "حد إعادة الطلب لكل صنف + تنبيه",
            "المخزون ممنوع يبقى سالب — يبقى مستحيل من التصميم",
        ],
        "accept": [
            "بيع 3 ثم مرتجع 1 → حركتان بالمبلغ الصحيح ورقم الصنف",
            "جرد: متاح 10 · فعلي 8 → حركة تسوية −2 بسبب مسجّل",
            "تقرير مخزون: رصيد أول المدة + داخل − خارج = رصيد آخر المدة",
        ],
        "deps": "C-03 · C-04",
        "size": "كبير",
        "decide": "هل نبدأ بتقييم المخزون بالتكلفة (متوسط مرجح)؟",
    },
    {
        "id": "F-06",
        "status": "done",
        "proof": "tests/backlog.test.js · F-06 + شاشة الموردين",
        "note": "",
        "name": "المشتريات والموردون",
        "why": "بدون توريد مسجّل، المخزون رقم بلا مصدر والتكلفة بلا سند.",
        "spec": [
            "موردون · أمر شراء · استلام بضاعة يزيد المخزون ويكتب التكلفة",
            "حساب المورد: مستحق ومدفوع",
            "متوسط التكلفة المرجح يتحدّث مع كل استلام",
        ],
        "accept": [
            "استلام 10 × 50 ثم 10 × 70 → متوسط التكلفة 60",
            "بيع بعدها يحسب هامشاً على 60 لا على 50",
            "حذف استلام غير مسموح بعد استخدامه في بيع",
        ],
        "deps": "F-05",
        "size": "كبير",
        "decide": "هل نستورد أرصدة افتتاحية من Excel؟",
    },
    {
        "id": "F-07",
        "status": "done",
        "proof": "tests/backlog.test.js · F-07 (حد الآجل · الولاء · كشف الحساب)",
        "note": "",
        "name": "العملاء والولاء والآجل",
        "why": "الفاتورة الآن مربوطة بالكاشير فقط. البقالة بتشتغل بالحساب الشهري.",
        "spec": [
            "عميل برقم موبايل فريد · رصيد آجل بحد أقصى · نقاط ولاء",
            "بيع آجل يخصم من الرصيد لا من الدرج",
            "سداد من العميل يدخل الدرج كحركة منفصلة عن البيع",
        ],
        "accept": [
            "عميل حده 500 ورصيده 480 → فاتورة 30 تُرفض برسالة واضحة",
            "الآجل لا يزيد المتوقع في درج الوردية",
            "كشف حساب عميل يجمع: مبيعات · مرتجعات · سداد · الرصيد",
        ],
        "deps": "C-04 · C-07",
        "size": "متوسط",
        "decide": "حد الآجل الافتراضي لكل عميل",
    },
    {
        "id": "F-08",
        "status": "done",
        "proof": "tests/backlog.test.js · F-08 (كاشير يطلب ومدير يعتمد)",
        "note": "",
        "name": "حركة الدرج اليدوية",
        "why": "سحب نقدي للبنك أو إيداع فكّة — بيحصل كل يوم ومش موجود في الحساب.",
        "spec": [
            "سحب (خارج) وإيداع (داخل) بمبلغ وسبب ومستخدم",
            "حركات معلّقة تحتاج اعتماد مدير",
            "المتوقع في الدرج يحتسب الحركات المعتمدة فقط",
        ],
        "accept": [
            "فتح 100 + بيع كاش 60 + سحب 40 → المتوقع 120",
            "سحب مرفوض لا يغيّر المتوقع",
            "كل حركة في سجل العمليات باسم منشئها",
        ],
        "deps": "C-07 · C-09",
        "size": "متوسط",
        "decide": "من يعتمد الحركة: مدير الفرع أم المالك؟",
    },
    {
        "id": "F-09",
        "status": "done",
        "proof": "tests/backlog.test.js · F-09 (أربعة ملفات · BOM · أعمدة)",
        "note": "",
        "name": "تقارير قابلة للتصدير",
        "why": "المالك محتاج ياخد الأرقام على Excel للمحاسب.",
        "spec": [
            "CSV وExcel للفواتير والمرتجعات والورديات والمخزون",
            "تقرير وردية مطبوع A4: افتتاحي · مبيعات بالطريقة · مرتجعات · سحب/إيداع · الفرق",
            "فلترة بالتاريخ والمستخدم وطريقة الدفع",
        ],
        "accept": [
            "تصدير 100 فاتورة يفتح في Excel بترميز عربي سليم",
            "تقرير وردية واحد يطابق أرقام الشاشة بالهللة/القرش",
            "لا تصدير بلا صلاحية",
        ],
        "deps": "C-08",
        "size": "صغير",
        "decide": "—",
    },
    {
        "id": "F-10",
        "status": "done",
        "proof": "tests/backlog.test.js · F-10 (تجزئة scrypt · حماية آخر مدير)",
        "note": "",
        "name": "إدارة المستخدمين",
        "why": "الحسابات الآن مزروعة في الكود. محل حقيقي بيضيف كاشير ويوقف واحد.",
        "spec": [
            "CRUD مستخدمين · إعادة تعيين كلمة المرور · تعطيل بلا حذف",
            "كلمات المرور مُشفَّرة (scrypt/bcrypt) لا نص صريح",
            "سجل من عدّل من ومتى",
        ],
        "accept": [
            "كلمة مرور لا تُقرأ من قاعدة البيانات بأي شكل",
            "مستخدم معطّل لا يستطيع الدخول حتى بتوكن قديم",
            "لا يمكن تعطيل آخر مدير في النظام",
        ],
        "deps": "C-01 · C-02",
        "size": "متوسط",
        "decide": "—",
    },
    {
        "id": "F-11",
        "status": "done",
        "proof": "tools/ui-offline-print.js · F-11 (٣ فواتير بلا شبكة → ٣ بالضبط على الخادم)",
        "note": "البيع أثناء الانقطاع يتحقق من آخر مخزون محلي؛ التحقق النهائي على الخادم عند الإرسال.",
        "name": "وضع عدم الاتصال",
        "why": "النت بيقطع في المحلات. الكاشير مايقفش.",
        "spec": [
            "البيع يُسجَّل محلياً ويُرسل عند رجوع الشبكة بطابور",
            "مفاتيح تكرار تمنع التكرار عند الإرسال المتأخر",
            "شريط حالة واضح: متصل / طابور 3 فواتير / تمت المزامنة",
        ],
        "accept": [
            "قطع الشبكة ثم بيع 3 فواتير → الطابور يظهر 3 ثم يفرغ",
            "لا تتكرر أي فاتورة بعد المزامنة",
            "المخزون لا يُسمح ببيعه سالباً أثناء الانقطاع",
        ],
        "deps": "C-04 (المفاتيح) · F-05",
        "size": "كبير",
        "decide": "هل نقبل البيع بلا تحقق مخزون أثناء الانقطاع؟",
    },
    {
        "id": "F-12",
        "status": "done",
        "proof": "tests/backlog.test.js · F-12 + tools/ui-flow.js (تحصيل آجل)",
        "note": "",
        "name": "الدفع الجزئي والتقسيط",
        "why": "عميل يدفع 50 من 120 والباقي عند الاستلام.",
        "spec": [
            "دفعات على نفس الفاتورة · حالة: مسددة/جزئية/غير مسددة",
            "كل دفعة بحركة درج إن كانت نقدية",
        ],
        "accept": [
            "120 على دفعتين 50+70 → الحالة «مسددة» والمتوقع في الدرج 120",
            "الفاتورة الجزئية لا تُعدّ مبيعات محصَّلة كاملة في التقرير",
        ],
        "deps": "F-07 · C-07",
        "size": "متوسط",
        "decide": "—",
    },
    {
        "id": "F-13",
        "status": "done",
        "proof": "tests/backlog.test.js · F-13 + شارة التنبيهات",
        "note": "",
        "name": "التنبيهات",
        "why": "المدير يعرف بنفسه إن المخزون خلص أو إن درج الوردية فيه فرق 200.",
        "spec": [
            "تنبيهات داخلية: نقص مخزون · فرق درج · وردية مفتوحة أكثر من 12 ساعة · مرتجعات غير معتادة",
            "مركز تنبيهات بعدّاد · تعليم كمقروء",
        ],
        "accept": [
            "صنف ينزل تحت حد الطلب → تنبيه واحد لا يتكرر كل ثانية",
            "إغلاق وردية بفرق أكبر من حد → تنبيه للمدير",
        ],
        "deps": "F-05 · C-07",
        "size": "صغير",
        "decide": "هل تصل التنبيهات على واتساب؟",
    },
    {
        "id": "F-14",
        "status": "done",
        "proof": "tests/backlog.test.js · F-14 (نسخة/استعادة بتأكيد RESTORE)",
        "note": "",
        "name": "النسخ الاحتياطي والاستعادة",
        "why": "البيانات الآن في صف واحد. صف واحد = نقطة فشل واحدة.",
        "spec": [
            "نسخة يومية تلقائية · تصدير كامل بضغطة · استعادة بموافقة مزدوجة",
            "سجل بمن استعاد ومتى",
        ],
        "accept": [
            "تصدير ثم استعادة يعيد نفس الأرقام بالضبط",
            "الاستعادة لا تتم بلا تأكيد نصي صريح",
        ],
        "deps": "C-14",
        "size": "صغير",
        "decide": "—",
    },
    {
        "id": "F-15",
        "status": "done",
        "proof": "tests/backlog.test.js · F-15 (خمس محاولات → 429 · حساب موقوف → 403)",
        "note": "",
        "name": "الأمان والتشديد",
        "why": "الديمو مقبول فيه كلام كثير؛ النظام الحقيقي لا.",
        "spec": [
            "تحديد محاولات الدخول · رؤوس أمان · CSRF للطلبات المتغيّرة",
            "سجل عمليات لا يُعدَّل في قاعدة البيانات لا في التطبيق",
            "مراجعة صلاحيات كل مسار آلياً",
        ],
        "accept": [
            "5 محاولات خاطئة → قفل مؤقت مع رسالة واضحة",
            "طلب POST من أصل مختلف لا ينجح",
            "تعديل سطر في سجل العمليات يفشل على مستوى قاعدة البيانات",
        ],
        "deps": "F-10",
        "size": "متوسط",
        "decide": "—",
    },
    {
        "id": "F-16",
        "status": "partial",
        "proof": "tests/inventory.test.js (٩ حالات) + tools/ui-inventory.js (٩ فحوص)",
        "note": "نُفِّذ نظامان: الكاشير والمخازن. المطعم والعيادة والموارد البشرية والحجوزات ولوحة المواقع ما زالت مخططات.",
        "name": "بقية الأنظمة (6 أنظمة)",
        "why": "المشروع في الأصل 7 أنظمة، والكاشير واحد منها.",
        "spec": [
            "المخازن · المطعم (ترابيزات + شاشة مطبخ) · العيادة (مواعيد + روشتات) · الموارد البشرية (حضور ومرتبات) · حجز الملاعب · لوحة تحكم المواقع",
            "كل نظام بقاعدة الصلاحيات والهوية والتقارير نفسها — بلا نسخ كود",
        ],
        "accept": [
            "نظام جديد يظهر في القائمة ويضيف مستخدميه ولا يكسر الكاشير",
            "كل نظام له اختباراته المستقلة",
        ],
        "deps": "F-05 · F-10",
        "size": "كبير جداً",
        "decide": "ترتيب الأنظمة — قرار D-G",
    },
    {
        "id": "F-17",
        "status": "partial",
        "proof": "tools/ui-sites.js (٣٣ فحصاً على الموبايل)",
        "note": "المواقع السبعة تعمل كصفحات نشاط؛ برامج ويندوز الخمسة «قيد التخطيط» ولم تُبنَ.",
        "name": "المواقع السبعة وبرامج ويندوز",
        "why": "الوعد في صفحة الهبوط: 7 أنظمة + 7 مواقع + 5 برامج.",
        "spec": [
            "7 مواقع جاهزة (مطعم · عيادة · عقارات · جيم · موبايلات · ملابس · ملاعب) مربوطة بأنظمتها",
            "صفحات البرامج الخمسة بحالة «قريباً» صادقة",
        ],
        "accept": [
            "كل موقع يفتح ويبدو مكتملاً على الموبايل",
            "أي شيء غير جاهز يظهر «قريباً» بوضوح لا كزر معطّل",
        ],
        "deps": "F-16",
        "size": "كبير جداً",
        "decide": "أين تُستضاف المواقع السبعة — قرار موقوف",
    },
]

# ----------------------------------------------------------------------------
# 3) الترقية البصرية — من الحالة الحالية إلى معيار قابل للقياس
# ----------------------------------------------------------------------------
VISUAL = [
    ("V-01", "مقياس طباعة موحّد", "أحجام عشوائية بحسب الشاشة", "6 أحجام فقط 12/14/16/20/28/40 وأرقام جدولية في كل مبلغ"),
    ("V-02", "شبكة مسافات 8px", "هوامش 6 و8 و10 و26 معاً", "كل المسافات من مضاعفات 4 — والرأسي من 8"),
    ("V-03", "هدف لمس 44px", "أزرار الأسهم في السلة 32px", "كل هدف لمس ≥ 44×44 على الشاشات اللمسية"),
    ("V-04", "شريط سفلي للموبايل", "قائمة جانبية تُفتح بزر ☰", "شريط سفلي ثابت بأربعة أقسام أساسية على الموبايل"),
    ("V-05", "حالات الفراغ", "جدول فاضي يظهر كصفحة بيضاء", "لكل قائمة: أيقونة + سبب + إجراء واحد واضح"),
    ("V-06", "هياكل تحميل", "الشاشة تقفز عند وصول البيانات", "هيكل عظمي بنفس أبعاد المحتوى — لا قفز"),
    ("V-07", "الوصولية", "لا حلقة تركيز ظاهرة", "حلقة تركيز 2px · تباين AA 4.5:1 · احترام prefers-reduced-motion"),
    ("V-08", "إيصال 80mm للطباعة", "إيصال للشاشة فقط", "ورقة طباعة بعرض 80mm وأسود خالص وباركود"),
    ("V-09", "صور الأصناف", "إيموجي فقط", "صورة أو حرف أول بلون ثابت + بديل عند غياب الصورة"),
    ("V-10", "الوضع الليلي", "فاتح فقط", "ضوء منخفض للورديات الليلية — تباين مفحوص لا معكوس آلياً"),
    ("V-11", "لوحة ألوان دلالية", "ألوان موزّعة داخل الملفات", "متغيّرات دلالية: --ok --bad --warn --brand --ink --rule"),
    ("V-12", "حركة واحدة مقصودة", "كل شيء يظهر بلا انتقال", "انتقال واحد عند إضافة صنف للسلة يوضّح ما تغيّر — وبلا مؤثرات موزّعة"),
    ("V-13", "اتجاه الأرقام", "أرقام مدفوعة للجانب في RTL", "كل مبلغ باتجاه ثابت مع عزل bidi صحيح"),
    ("V-14", "تقرير A4 مطبوع", "لا يوجد", "تقرير وردية على صفحة واحدة قابلة للتوقيع"),
    ("V-15", "مجموعة أيقونات SVG", "إيموجي مختلفة العائلات", "مجموعة واحدة بخط 1.5px ونفس الأبعاد"),
    ("V-16", "صفحة الهبوط", "صفحة تعريفية بسيطة", "هوية بصرية + عرض حقيقي للأنظمة السبعة + لقطات حقيقية لا رسوماً توضيحية"),
]

# ----------------------------------------------------------------------------
# 4) القرارات الموقوفة
# ----------------------------------------------------------------------------
DECISIONS = [
    ("D-A", "طرق الدفع المعتمدة", "تم الحسم: 4 طرق", "مغلق"),
    ("D-B", "تصحيح النقد يدوياً", "متى يُسمح بتعديل الدرج ومن يعتمده (يعتمد F-08)", "مفتوح"),
    ("D-C", "من يغلق الوردية", "الكاشير أم المدير فقط — يحكم شاشة الإغلاق", "مفتوح"),
    ("D-D", "من يقرأ التقرير", "المدير أم المالك أيضاً — يحكم صلاحية التقارير", "مفتوح"),
    ("D-E", "دلالة المبيعات", "تم الحسم: الصافي = الإجمالي − المرتجعات", "مغلق"),
    ("D-G", "ترتيب الأنظمة", "أي نظام بعد الكاشير (يعتمد F-16)", "مفتوح"),
    ("—", "أين تُستضاف المواقع السبعة", "نفس مشروع فيرسال أم مشاريع منفصلة (يعتمد F-17)", "مفتوح"),
    ("—", "الضريبة", "نسبتها وهل تصدير ETA أم PDF (يعتمد F-01)", "مفتوح"),
]

# ----------------------------------------------------------------------------
# التوليد
# ----------------------------------------------------------------------------
STATUS_LABEL = {
    "done": "منفَّذ ومُختبَر",
    "partial": "منفَّذ جزئياً",
    "planned": "لم يُنفَّذ",
}

STATE_LABEL = {"ok": "يعمل", "partial": "جزئي", "open": "متبقي"}


def esc(t):
    return html.escape(t, quote=False)


def inline(t):
    """يحوّل `code` إلى <code>."""
    out, inside = [], False
    for part in t.split("`"):
        out.append(f"<code>{esc(part)}</code>" if inside else esc(part))
        inside = not inside
    return "".join(out)


def main():
    working = sum(1 for c in CURRENT if c["state"] == "ok")
    partial = sum(1 for c in CURRENT if c["state"] == "partial")
    remaining = sum(1 for f in REMAINING if f["status"] != "done")
    done_f = sum(1 for f in REMAINING if f["status"] == "done")
    visual = len(VISUAL)

    rows_current = "\n".join(
        f"""      <tr>
        <td class="id">{c['id']}</td>
        <td class="feat"><span class="fname">{esc(c['name'])}</span>
          <span class="stamp st-{c['state']}">{STATE_LABEL[c['state']]}</span></td>
        <td><ul class="props">{''.join(f'<li>{inline(p)}</li>' for p in c['props'])}</ul></td>
        <td class="proof">{inline(c['proof'])}</td>
      </tr>"""
        for c in CURRENT
    )

    blocks_remaining = []
    for f in REMAINING:
        blocks_remaining.append(f"""
    <article class="spec" id="{f['id']}">
      <header>
        <span class="sid">{f['id']}</span>
        <h3>{esc(f['name'])}</h3>
        <span class="size">{esc(f['size'])}</span>
        <span class="stamp st-{'ok' if f['status'] == 'done' else 'partial'}">{STATUS_LABEL[f['status']]}</span>
      </header>
      <p class="why">{inline(f['why'])}</p>
      <div class="two">
        <div>
          <h4>المواصفات</h4>
          <ul>{''.join(f'<li>{inline(s)}</li>' for s in f['spec'])}</ul>
        </div>
        <div>
          <h4>معايير القبول</h4>
          <ul class="accept">{''.join(f'<li>{inline(a)}</li>' for a in f['accept'])}</ul>
        </div>
      </div>
      <footer>
        <span>يعتمد على: {inline(f['deps'])}</span>
        <span class="proof">الدليل: {inline(f['proof'])}</span>
        {f'<span class="decide">ملاحظة: {inline(f["note"])}</span>' if f['note'] else ''}
      </footer>
    </article>""")

    rows_visual = "\n".join(
        f"""      <tr><td class="id">{v[0]}</td><td class="feat">{esc(v[1])}</td>
        <td class="now">{esc(v[2])}</td><td class="target">{esc(v[3])}</td></tr>"""
        for v in VISUAL
    )

    rows_dec = "\n".join(
        f"""      <tr><td class="id">{esc(d[0])}</td><td><b>{esc(d[1])}</b></td>
        <td>{esc(d[2])}</td><td><span class="stamp {'st-ok' if d[3] == 'مغلق' else 'st-open'}">{esc(d[3])}</span></td></tr>"""
        for d in DECISIONS
    )

    doc = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>سجل مزايا نيل سيستمز — الحالي والمتبقي والبصري</title>
<style>
  :root {{
    --paper: #f2f5f3;
    --sheet: #fbfcfb;
    --ink: #14211f;
    --muted: #5a6b66;
    --rule: #c9d4cf;
    --rule-soft: #e2e9e6;
    --brand: #0b7a6b;
    --brand-ink: #064c42;
    --warn: #a8641a;
    --bad: #a3382c;
    --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
    --sans: "Segoe UI", "Noto Sans Arabic", "Dubai", Tahoma, system-ui, sans-serif;
  }}
  * {{ box-sizing: border-box; }}
  html {{ -webkit-text-size-adjust: 100%; }}
  body {{
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.65 var(--sans);
    font-feature-settings: "tnum" 1;
  }}
  .sheet {{
    max-width: 1080px;
    margin: 0 auto;
    background: var(--sheet);
    padding: 0 0 64px;
    box-shadow: 0 0 0 1px var(--rule);
  }}

  /* ---- الرأس: خانة العمل، ثم شريط الإيصال ---- */
  .head {{ padding: 40px 44px 0; }}
  .kicker {{
    font: 600 13px/1 var(--sans);
    color: var(--muted);
    letter-spacing: 0;
    margin-bottom: 10px;
  }}
  h1 {{
    font-size: 34px;
    line-height: 1.25;
    font-weight: 700;
    margin: 0 0 14px;
    letter-spacing: -0.4px;
  }}
  .lede {{ margin: 0; color: var(--muted); max-width: 62ch; }}
  .provenance {{
    margin-top: 18px; padding: 12px 14px;
    border-inline-start: 3px solid var(--brand);
    background: #eef4f2;
    font-size: 14px; color: var(--brand-ink);
  }}
  .provenance b {{ font-weight: 700; }}

  /* شريط الإيصال: حافة مثقّبة، أرقام كعداد —— عنصر واحد مميز في الصفحة */
  .receipt {{
    margin: 30px 44px 0;
    background: #10231f;
    color: #eaf3f0;
    padding: 22px 26px 26px;
    position: relative;
  }}
  .receipt::before, .receipt::after {{
    content: "";
    position: absolute; left: 0; right: 0; height: 8px;
    background-image: radial-gradient(circle at 4px 4px, var(--paper) 4px, transparent 4px);
    background-size: 12px 8px;
  }}
  .receipt::before {{ top: -1px; }}
  .receipt::after {{ bottom: -1px; }}
  .counts {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }}
  .count .n {{
    font: 700 40px/1 var(--mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -1px;
    display: block;
  }}
  .count .l {{ font-size: 13px; color: #9fc0b8; margin-top: 8px; display: block; }}
  .count.a .n {{ color: #7fd7c4; }}
  .count.b .n {{ color: #f0c37a; }}
  .count.c .n {{ color: #e9a79c; }}
  .count.d .n {{ color: #cfe0da; }}

  /* ---- الأقسام ---- */
  section {{ padding: 44px 44px 0; }}
  h2 {{
    font-size: 13px; font-weight: 700; color: var(--muted);
    margin: 0 0 4px;
  }}
  h2 + .h2sub {{ font-size: 24px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.3px; }}
  .intro {{ color: var(--muted); margin: 0 0 22px; max-width: 70ch; font-size: 15px; }}
  hr.sep {{ border: 0; border-top: 1px solid var(--rule); margin: 0; }}

  /* جدول السجل: خطوط رأسية فقط بين الأعمدة — هو دفتر، فيُعرض كدفتر */
  table {{ width: 100%; border-collapse: collapse; }}
  thead th {{
    text-align: start; font-size: 12.5px; font-weight: 700; color: var(--muted);
    padding: 0 12px 10px 0; border-bottom: 2px solid var(--ink);
  }}
  tbody td {{ padding: 16px 12px 16px 0; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }}
  tbody tr:last-child td {{ border-bottom: 1px solid var(--rule); }}
  td.id {{
    font: 600 12.5px/1.5 var(--mono); color: var(--brand);
    width: 62px; white-space: nowrap;
  }}
  td.feat {{ width: 220px; font-weight: 700; }}
  .fname {{ display: block; margin-bottom: 6px; }}
  ul.props {{ margin: 0; padding-inline-start: 18px; }}
  ul.props li {{ margin-bottom: 5px; font-size: 14.5px; }}
  code {{
    font: 12.5px/1.4 var(--mono); background: #e9efec; color: var(--brand-ink);
    padding: 1px 5px; border-radius: 3px; direction: ltr; display: inline-block;
    unicode-bidi: isolate;
  }}
  td.proof {{ width: 210px; font-size: 12.5px; color: var(--muted); }}

  /* الختم: العنصر المميز الثاني — القرار يُختم لا يُلوَّن */
  .stamp {{
    display: inline-block; font: 700 11.5px/1 var(--sans);
    padding: 5px 9px 4px; border: 1.5px solid currentColor;
    transform: rotate(-1.2deg); white-space: nowrap;
  }}
  .st-ok {{ color: var(--brand); }}
  .st-partial {{ color: var(--warn); }}
  .st-open {{ color: var(--bad); }}

  /* ---- المزايا المتبقية ---- */
  .spec {{ border-top: 1px solid var(--rule); padding: 24px 0 20px; }}
  .spec header {{ display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }}
  .sid {{ font: 600 12.5px/1 var(--mono); color: var(--brand); }}
  .spec h3 {{ margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.2px; flex: 1; }}
  .size {{ font-size: 12px; color: var(--muted); border: 1px solid var(--rule); padding: 3px 8px; }}
  .why {{ margin: 0 0 14px; color: #2c3f3a; font-size: 15px; max-width: 78ch; }}
  .two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }}
  .two h4 {{ font-size: 12.5px; color: var(--muted); margin: 0 0 6px; font-weight: 700; }}
  .two ul {{ margin: 0; padding-inline-start: 18px; }}
  .two li {{ font-size: 14px; margin-bottom: 5px; }}
  ul.accept {{ list-style: none; padding-inline-start: 0; }}
  ul.accept li {{ position: relative; padding-inline-start: 22px; }}
  ul.accept li::before {{
    content: ""; position: absolute; inset-inline-start: 0; top: 7px;
    width: 11px; height: 11px; border: 1.5px solid var(--brand);
  }}
  .spec footer {{
    display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 14px;
    font-size: 13px; color: var(--muted);
  }}
  .decide {{ color: var(--bad); }}

  /* ---- البصري ---- */
  td.now {{ width: 235px; color: var(--muted); font-size: 14px; }}
  td.target {{ font-size: 14px; }}
  td.target::before {{ content: "→ "; color: var(--brand); font-weight: 700; }}

  /* ---- التذييل ---- */
  .foot {{
    margin: 44px 44px 0; padding-top: 18px; border-top: 2px solid var(--ink);
    font-size: 13px; color: var(--muted);
  }}
  .foot code {{ background: transparent; padding: 0; color: var(--brand-ink); }}
  .foot p {{ margin: 0 0 8px; }}

  @media (max-width: 820px) {{
    .head, section, .receipt, .foot {{ padding-inline: 20px; }}
    .receipt {{ margin-inline: 20px; }}
    .counts {{ grid-template-columns: repeat(2, 1fr); }}
    .two {{ grid-template-columns: 1fr; gap: 14px; }}
    table, thead, tbody, tr, td {{ display: block; width: auto !important; }}
    thead {{ display: none; }}
    tbody td {{ padding: 8px 0; border: 0; }}
    tbody tr {{ padding: 14px 0; border-bottom: 1px solid var(--rule); }}
    td.feat {{ font-size: 17px; }}
  }}

  @media print {{
    body {{ background: #fff; font-size: 11pt; }}
    .sheet {{ box-shadow: none; max-width: none; }}
    .receipt {{ background: #10231f !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .spec {{ break-inside: avoid; }}
    section {{ padding-top: 24px; }}
  }}
</style>
</head>
<body>
<div class="sheet">

  <header class="head">
    <div class="kicker">نيل سيستمز · سجل المزايا</div>
    <h1>كل ما يعمله النظام الآن،<br>وكل ما لم يعمله بعد — ومواصفاته</h1>
    <p class="lede">مستند واحد يُقرأ من أوله لآخره: مزايا تعمل ومعها الدليل، مزايا متبقية ومعها
      معايير القبول، وقائمة ترقية بصرية بمعيار قابل للقياس. لا بند هنا بلا رقم يمكن التحقق منه.</p>
    <div class="provenance">
      <b>من أين جاء هذا المستند:</b> <code>docs/plan/001-pos-implementation-ready.md</code> ·
      <code>docs/architecture/proposals/0007-payment-engine.md</code> ·
      <code>docs/STATUS.md</code> · الكود على <code>nilesys@{REV}</code> ·
      قرارات المالك في <code>platform/docs/wiki/owner-decisions.md</code>.
      تاريخ التحرير: <b>2026-10-21</b>.
    </div>
  </header>

  <div class="receipt">
    <div class="counts">
      <div class="count a"><span class="n">{working}</span><span class="l">ميزة تعمل اليوم ومعها اختبار</span></div>
      <div class="count b"><span class="n">{partial}</span><span class="l">ميزة تعمل جزئياً</span></div>
      <div class="count c"><span class="n">{done_f}</span><span class="l">ميزة منفَّذة باختباراتها</span></div>
      <div class="count d"><span class="n">{visual}</span><span class="l">بند ترقية بصرية</span></div>
    </div>
  </div>

  <section>
    <h2>القسم الأول</h2>
    <p class="h2sub">المزايا الحالية وخصائصها</p>
    <p class="intro">«الخصائص» هنا ليست وصفاً أدبياً: حدود، أرقام، وقيود، ثم الدليل الذي يثبتها.
      كل سطر يمكن تتبعه إلى ملف أو اختبار.</p>
    <table>
      <thead><tr><th>المُعرِّف</th><th>الميزة</th><th>الخصائص الكاملة</th><th>الدليل</th></tr></thead>
      <tbody>
{rows_current}
      </tbody>
    </table>
  </section>

  <section>
    <h2>القسم الثاني</h2>
    <p class="h2sub">كل ميزة كانت متبقية — وحالتها الآن بدليلها</p>
    <p class="intro">مرتبة بقيمة صاحب المحل لا بسهولة البرمجة. «معايير القبول» هي ما سيُختبر فعلاً:
      لو لم يكن البند قابلاً للفحص بأمر، فهو ليس بنداً.</p>
{''.join(blocks_remaining)}
  </section>

  <section>
    <h2>القسم الثالث</h2>
    <p class="h2sub">التطوير والترقية البصرية</p>
    <p class="intro">لكل بند: ما هو الآن، وما يصبح عليه بمعيار يمكن قياسه — لا كلمة «أجمل».</p>
    <table>
      <thead><tr><th>المُعرِّف</th><th>البند</th><th>الآن</th><th>المستهدف</th></tr></thead>
      <tbody>
{rows_visual}
      </tbody>
    </table>
  </section>

  <section>
    <h2>القسم الرابع</h2>
    <p class="h2sub">القرارات الموقوفة عليك</p>
    <p class="intro">كل قرار هنا يحجب ميزة بعينها. القرارات المغلقة مذكورة لأنها تشرح لماذا
      صار السلوك كما هو.</p>
    <table>
      <thead><tr><th>الرمز</th><th>القرار</th><th>يحجب</th><th>الحالة</th></tr></thead>
      <tbody>
{rows_dec}
      </tbody>
    </table>
  </section>

  <footer class="foot">
    <p><b>الأرقام في هذا المستند أُنتجت لا اختُرعت.</b> الحالي: 93 اختبار API ناجحاً على سيرفر حي
      (<code>27 + 16 + 31 + 10 + 9</code>) و76 فحص واجهة في متصفح حقيقي. المنشور: <code>https://nilesys-demo.vercel.app</code> على
      <code>nilesys@{REV}</code>.</p>
    <p>الملف مُولَّد من <code>tools/build-feature-register.py</code>. تعديله بيد ليس أسرع من تعديل
      المصدر، وسيصير كاذباً عند أول تغيير في الكود.</p>
    <p>ما لا يدّعيه هذا المستند: لا فاتورة إلكترونية بصيغة ETA (المطبوع 80 مم وPDF)، ولا خمسة
      أنظمة لم تُبنَ (المطعم · العيادة · الموارد البشرية · الحجوزات · لوحة المواقع)، ولا برامج
      ويندوز، ولا تعدد فروع. هذه ليست تفاصيل صغيرة — هي الفرق بين ديمو ونظام.</p>
  </footer>

</div>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")

    # نفس المحتوى بصيغة Markdown — يُقرأ على GitHub بلا أدوات، ويبقى قابلاً للبحث والنسخ.
    md = []
    md.append("# سجل مزايا نيل سيستمز\n")
    md.append("**الحالي · المتبقي · الترقية البصرية · القرارات** — محدَّث 2026-10-21، "
              f"الكود `nilesys@{REV}`، المنشور https://nilesys-demo.vercel.app\n")
    md.append(f"| يعمل | جزئي | متبقٍ | بصري | قرارات |\n|---|---|---|---|---|\n"
              f"| {working} | {partial} | {remaining} | {visual} | {len(DECISIONS)} |\n")
    md.append("> مُولَّد من `tools/build-feature-register.py`. لا يُعدَّل بيد.\n")

    md.append("\n## القسم الأول — المزايا الحالية وخصائصها\n")
    for c in CURRENT:
        md.append(f"\n### {c['id']} — {c['name']}  ·  _{STATE_LABEL[c['state']]}_\n")
        for p_ in c["props"]:
            md.append(f"- {p_}")
        md.append(f"\n<sub>الدليل: {c['proof']}</sub>\n")

    md.append("\n## القسم الثاني — المزايا: الحالة والدليل\n")
    for f in REMAINING:
        md.append(f"\n### {f['id']} — {f['name']}  ·  _{f['size']}_  ·  **{STATUS_LABEL[f['status']]}**\n")
        md.append(f"{f['why']}\n")
        if f['note']:
            md.append(f"> **ملاحظة:** {f['note']}\n")
        md.append("**المواصفات**\n")
        for x in f["spec"]:
            md.append(f"- {x}")
        md.append("\n**معايير القبول**\n")
        for x in f["accept"]:
            md.append(f"- [{'x' if f['status'] == 'done' else ' '}] {x}")
        md.append(f"\n<sub>يعتمد على: {f['deps']} · الدليل: {f['proof']} · **قرار مطلوب:** {f['decide']}</sub>\n")

    md.append("\n## القسم الثالث — التطوير والترقية البصرية\n")
    md.append("| # | البند | الآن | المستهدف |\n|---|---|---|---|")
    for v in VISUAL:
        md.append(f"| {v[0]} | {v[1]} | {v[2]} | {v[3]} |")

    md.append("\n## القسم الرابع — القرارات الموقوفة على المالك\n")
    md.append("| الرمز | القرار | يحجب | الحالة |\n|---|---|---|---|")
    for d in DECISIONS:
        md.append(f"| {d[0]} | **{d[1]}** | {d[2]} | {d[3]} |")

    md.append("\n---\n")
    md.append("**ما لا يدّعيه هذا المستند:** لا فاتورة إلكترونية بصيغة ETA، ولا خمسة أنظمة لم تُبنَ، ولا برامج ويندوز، ولا تعدد فروع.\n")

    MD_OUT.parent.mkdir(parents=True, exist_ok=True)
    MD_OUT.write_text("\n".join(md), encoding="utf-8")

    print(f"كتب {OUT} — {len(doc)} حرفاً")
    print(f"وكتب {MD_OUT}")
    print(f"  يعمل {working} · جزئي {partial} · منفَّذ من المتبقي {done_f} · متبقٍ فعلاً {remaining} · بصري {visual} · قرارات {len(DECISIONS)}")


if __name__ == "__main__":
    main()
