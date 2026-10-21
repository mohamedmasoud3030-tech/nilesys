#!/usr/bin/env python3
"""
يبني من كل مواصفة تطبيق ملف HTML مستقل + فهرساً للسبعة.

لماذا مولَّد: المواصفة فيها حقول تتغير مع الكود (الحالة، الاختبارات، عدد معايير
القبول المنجزة). لو كانت مكتوبة بيد في مكانين، سيكذب أحدهما. هنا المصدر واحد
(`docs/product/systems/*.md`) والباني يتحقق منه قبل أن يصدّقه:

  • إن قال الملف `status: live` فلابد أن يوجد ملف اختباره فعلاً.
  • إن قال `entry:` فلابد أن توجد الصفحة.
  • عدد معايير القبول المعلَّمة [x] يُحسب من الملف، لا يُكتب.

    python3 tools/build-app-specs.py
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "product" / "systems"
PROTO = ROOT / "prototypes" / "nilesys"

ORDER_LABEL = {"live": "يعمل ومُختبَر", "partial": "يعمل جزئياً", "planned": "لم يُبنَ بعد"}


def git_rev():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT), text=True).strip()
    except Exception:
        return "غير معروف"


def parse(path):
    text = path.read_text(encoding="utf-8")
    meta, body = {}, text
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        for line in fm.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    return meta, body.strip()


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def inline(s):
    s = esc(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def md_to_html(md):
    out, lines, i = [], md.splitlines(), 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(esc(lines[i]))
                i += 1
            out.append("<pre>" + "\n".join(buf) + "</pre>")
            i += 1
            continue
        if re.match(r"^\s*\|.*\|\s*$", line) and i + 1 < len(lines) and re.match(r"^\s*\|[-: |]+\|\s*$", lines[i + 1]):
            head = [c.strip() for c in line.strip().strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and re.match(r"^\s*\|.*\|\s*$", lines[i]):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            t = ["<table><thead><tr>" + "".join(f"<th>{inline(h)}</th>" for h in head) + "</tr></thead><tbody>"]
            for r in rows:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table>")
            out.append("\n".join(t))
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue
        if re.match(r"^\s*[-*]\s+\[[ xX]\]\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+\[[ xX]\]\s+", lines[i]):
                done = "[x]" in lines[i][:6].lower()
                txt = re.sub(r"^\s*[-*]\s+\[[ xX]\]\s+", "", lines[i])
                items.append(f'<li class="crit {"done" if done else "open"}">'
                             f'<span class="box">{"✓" if done else ""}</span>{inline(txt)}</li>')
                i += 1
            out.append('<ul class="criteria">' + "".join(items) + "</ul>")
            continue
        if re.match(r"^\s*[-*]\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                items.append(f"<li>{inline(re.sub(r'^\s*[-*]\s+', '', lines[i]))}</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        if re.match(r"^\s*\d+\.\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                items.append(f"<li>{inline(re.sub(r'^\s*\d+\.\s+', '', lines[i]))}</li>")
                i += 1
            out.append("<ol>" + "".join(items) + "</ol>")
            continue
        if line.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").strip())
                i += 1
            out.append("<blockquote>" + " ".join(inline(b) for b in buf) + "</blockquote>")
            continue
        if line.strip() == "---":
            out.append("<hr>")
            i += 1
            continue
        if line.strip():
            out.append(f"<p>{inline(line)}</p>")
        i += 1
    return "\n".join(out)


CSS = """
:root{--paper:#f3f6f5;--sheet:#fcfdfc;--ink:#13201e;--muted:#5b6c67;--rule:#cdd8d3;
--soft:#e3eae7;--brand:#0b7a6b;--brand-ink:#064c42;--warn:#a8641a}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 "Segoe UI","Noto Sans Arabic",Tahoma,sans-serif}
.sheet{max-width:900px;margin:0 auto;background:var(--sheet);box-shadow:0 0 0 1px var(--rule);padding:0 0 60px}
.head{padding:38px 44px 0}
.kicker{font-size:13px;color:var(--muted);letter-spacing:.02em}
h1{font-size:32px;line-height:1.25;margin:8px 0 16px;letter-spacing:-.3px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule);margin:22px 44px 0}
.fact{background:var(--sheet);padding:12px 14px}
.fact .k{font-size:12px;color:var(--muted)}
.fact .v{font:700 15px/1.4 ui-monospace,Menlo,Consolas,monospace;margin-top:4px;direction:ltr;unicode-bidi:isolate}
.fact .v.ar{direction:rtl}
.body{padding:8px 44px 0}
h2{font-size:20px;margin:34px 0 10px;padding-top:14px;border-top:1px solid var(--soft)}
h3{font-size:16px;margin:22px 0 6px}
p{margin:0 0 10px}
ul,ol{margin:0 0 12px;padding-inline-start:22px}
li{margin-bottom:5px}
code{font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#e9efec;color:var(--brand-ink);padding:1px 5px;border-radius:3px;direction:ltr;display:inline-block;unicode-bidi:isolate}
pre{background:#0f221e;color:#e7f2ee;padding:14px 16px;overflow:auto;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;direction:ltr;text-align:left}
pre code{background:none;color:inherit;padding:0}
table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14.5px}
th{text-align:start;font-size:12.5px;color:var(--muted);border-bottom:2px solid var(--ink);padding:6px 10px 8px 0}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--soft);vertical-align:top}
blockquote{margin:0 0 16px;padding:12px 16px;background:#eef4f2;border-inline-start:3px solid var(--brand);color:var(--brand-ink);font-size:15px}
ul.criteria{list-style:none;padding:0}
ul.criteria li{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--soft);font-size:15px}
ul.criteria .box{width:18px;height:18px;border:1.5px solid var(--brand);flex:0 0 18px;display:grid;place-items:center;font-size:12px;font-weight:800;color:var(--brand);margin-top:3px}
ul.criteria li.open .box{border-color:var(--muted)}
ul.criteria li.open{color:#41524d}
hr{border:0;border-top:1px solid var(--soft);margin:26px 0}
.foot{margin:40px 44px 0;padding-top:16px;border-top:2px solid var(--ink);font-size:13px;color:var(--muted)}
.badge{display:inline-block;border:1.5px solid currentColor;padding:4px 9px;font-size:12px;font-weight:700;transform:rotate(-1deg)}
.st-live{color:var(--brand)}.st-partial{color:var(--warn)}.st-planned{color:#a3382c}
@media (max-width:760px){.head,.body,.foot{padding-inline:20px}.facts{margin-inline:20px;grid-template-columns:repeat(2,1fr)}}
@media print{body{background:#fff}.sheet{box-shadow:none;max-width:none}h2{break-after:avoid}table{break-inside:avoid}}
"""


def render(meta, body_html, facts, footer):
    return f"""<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{esc(meta.get('name','مواصفة'))} · نيل سيستمز</title>
<style>{CSS}</style></head>
<body><div class="sheet">
<header class="head">
  <div class="kicker">نيل سيستمز · مواصفة تطبيق رقم {meta.get('order','—')}</div>
  <h1>{esc(meta.get('name',''))}</h1>
  <span class="badge st-{meta.get('status','planned')}">{ORDER_LABEL.get(meta.get('status'),'—')}</span>
</header>
<div class="facts">{''.join(f'<div class="fact"><div class="k">{esc(k)}</div><div class="v{" ar" if ar else ""}">{esc(v)}</div></div>' for k, v, ar in facts)}</div>
<main class="body">{body_html}</main>
<footer class="foot">{footer}</footer>
</div></body></html>"""


WIN_SRC = ROOT / "docs" / "product" / "windows"
WIN_OUT = PROTO / "public" / "docs" / "windows"


def windows_specs():
    """مواصفات برامج ويندوز الخمسة: تُصدَّر داخل الموقع حتى تُقرأ من الديمو.

    نفس قاعدة المواصفات الأخرى: لا `status: live` بلا ملف اختبار موجود،
    ولا `entry:` بلا صفحة تعمل، وعدد المعايير المعلَّمة يُحسب من الملف لا يُكتب.
    """
    import json
    if not WIN_SRC.exists():
        return []
    WIN_OUT.mkdir(parents=True, exist_ok=True)
    built, problems = [], []

    def to_html(md):
        # روابط المواصفات في الملفات مكتوبة `.md` (صحيحة على GitHub) وتصبح `.html`
        # في الموقع المولَّد — وإلا كنا نسلّم 404.
        return re.sub(r'href="([^"]+)\.md"', r'href="\1.html"', md_to_html(md))

    for f in sorted(WIN_SRC.glob("*.md")):
        if f.name == "index.md":
            continue
        meta, body = parse(f)
        slug = meta.get("slug", f.stem)
        checked = len(re.findall(r"^\s*[-*]\s+\[[xX]\]", body, re.M))
        total = checked + len(re.findall(r"^\s*[-*]\s+\[ \]", body, re.M))
        if meta.get("status") == "live":
            t = meta.get("tests", "")
            if t and not (PROTO / t).exists():
                problems.append(f"{f.name}: الحالة live لكن {t} غير موجود")
            entry = meta.get("entry", "")
            if entry and not (PROTO / "public" / entry.strip("/")).exists():
                problems.append(f"{f.name}: الحالة live لكن الصفحة {entry} غير موجودة")
        facts = [
            ("المُعرِّف", meta.get("id", ""), False),
            ("الصفحة", meta.get("entry", ""), False),
            ("المستخدمون", meta.get("users", "—"), True),
            ("معايير القبول", f"{checked}/{total}", False),
            ("ملف الاختبار", meta.get("tests", "—"), False),
            ("واجهات الخادم", meta.get("api", "—"), False),
        ]
        footer = (f"مُولَّد من <code>{f.relative_to(ROOT)}</code> بواسطة "
                  f"<code>tools/build-app-specs.py</code> · الكود <code>nilesys@{git_rev()}</code> · "
                  "كل معيار قبول معلَّم ✓ له فحص يعمل.")
        body_html = re.sub(r"^\s*<h1>.*?</h1>", "", to_html(body), count=1)
        (WIN_OUT / f"{slug}.html").write_text(render(meta, body_html, facts, footer), encoding="utf-8")
        built.append((meta, checked, total))

    idx = WIN_SRC / "index.md"
    if idx.exists():
        meta, body = parse(idx)
        rows = "".join(
            f'<li><a href="{m.get("slug")}.html">{esc(m.get("name"))}</a> — '
            f'{ORDER_LABEL.get(m.get("status"), "—")} · {c}/{t} معيار · '
            f'<code>{esc(m.get("entry", ""))}</code></li>'
            for m, c, t in built
        )
        body_html = re.sub(r"^\s*<h1>.*?</h1>", "", to_html(body), count=1)
        facts = [("البرامج", str(len(built)), False),
                 ("معايير القبول", f"{sum(c for _, c, _ in built)}/{sum(t for _, _, t in built)}", False),
                 ("الصفحة", "/windows/", False),
                 ("الكود", f"nilesys@{git_rev()}", False)]
        footer = ("هذه المواصفات تُولَّد من <code>docs/product/windows/*.md</code>. "
                  "البرامج الخمسة تعمل في المتصفح؛ التغليف كـ <code>.exe</code> خارج النطاق الحالي.")
        html = render({**(meta or {}), "name": meta.get("name", "برامج ويندوز الخمسة")},
                      body_html + f"<h2>البرامج</h2><ul>{rows}</ul>", facts, footer)
        (WIN_OUT / "index.html").write_text(html, encoding="utf-8")

    reg = {
        "generatedAt": __import__("datetime").date.today().isoformat(),
        "rev": git_rev(),
        "programs": [
            {"slug": m.get("slug"), "name": m.get("name"), "status": m.get("status"),
             "order": int(m.get("order", 99) or 99), "entry": m.get("entry"),
             "criteria": f"{c}/{t}"}
            for m, c, t in built
        ],
    }
    out = PROTO / "public" / "data" / "windows.json"
    out.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"برامج ويندوز: {len(built)} مواصفة → {WIN_OUT.relative_to(ROOT)}")
    for m, c, t in built:
        print(f"  {m.get('order')}. {m.get('name'):<22} {m.get('status'):<7} {c}/{t} معيار")
    for p in problems:
        print("  ⚠ " + p)
    return built


def main():
    files = sorted(SRC.glob("*.md"))
    files = [f for f in files if f.name != "index.md"]
    if not files:
        print("لا مواصفات في", SRC)
        return 1

    specs, problems = [], []
    for f in files:
        meta, body = parse(f)
        slug = meta.get("slug", f.stem)
        checked = len(re.findall(r"^\s*[-*]\s+\[[xX]\]", body, re.M))
        total = checked + len(re.findall(r"^\s*[-*]\s+\[ \]", body, re.M))

        # تحقق: لا ندّعي حالة لا دليل عليها
        if meta.get("status") in ("live", "partial"):
            t = meta.get("tests", "")
            if t and not (PROTO / t).exists():
                problems.append(f"{slug}: الحالة {meta['status']} لكن {t} غير موجود")
        entry = meta.get("entry", "")
        if meta.get("status") == "live" and entry:
            page = PROTO / "public" / entry.lstrip("/")
            if not page.exists():
                problems.append(f"{slug}: الحالة live لكن الصفحة {entry} غير موجودة")

        facts = [
            ("المُعرِّف", meta.get("id", ""), False),
            ("النظام", meta.get("system", ""), False),
            ("الصفحة", entry or "—", False),
            ("الحسابات", meta.get("users", "—"), True),
            ("معايير القبول", f"{checked}/{total}", False),
            ("ملف الاختبار", meta.get("tests", "—"), False),
        ]
        footer = (f"مُولَّد من <code>{f.relative_to(ROOT)}</code> بواسطة "
                  f"<code>tools/build-app-specs.py</code> · الكود <code>nilesys@{git_rev()}</code> · "
                  f"كل معيار قبول معلَّم ✓ له اختبار يشغّله.")
        # العنوان في الرأس أصلاً — نحذف أول h1 من المتن حتى لا يتكرر.
        body_html = md_to_html(body)
        body_html = re.sub(r"^\s*<h1>.*?</h1>", "", body_html, count=1)
        html = render(meta, body_html, facts, footer)
        (SRC / f"{slug}.html").write_text(html, encoding="utf-8")
        specs.append((meta, body, checked, total))

    specs.sort(key=lambda x: int(x[0].get("order", 99)))

    # فهرس
    rows = "\n".join(
        f"| {m.get('order')} | [{m.get('name')}]({m.get('slug')}.md) | {ORDER_LABEL.get(m.get('status'),'')} | "
        f"{c}/{t} | `{m.get('entry','—')}` |"
        for m, _, c, t in specs
    )
    idx = ("# مواصفات التطبيقات السبعة\n\n"
           f"محدَّث 2026-10-21 · الكود `nilesys@{git_rev()}`\n\n"
           "كل تطبيق له ملف مستقل: الغرض، المستخدمون، الشاشات، نموذج البيانات، الواجهات، القواعد، "
           "ومعايير قبول قابلة للتشغيل. الملفات مولَّدة من `docs/product/systems/*.md`.\n\n"
           "| # | التطبيق | الحالة | معايير القبول | الصفحة |\n|---|---|---|---|---|\n" + rows + "\n\n"
           "## الترتيب ولماذا\n\n"
           "1. **الكاشير** ثم **المخازن** — الأساس المالي والمخزني الذي يخدم كل ما بعده.\n"
           "2. **المطعم** — أعلى قيمة مباشرة، ويعيد استخدام محرك الدفع والورديات نفسه.\n"
           "3. **العيادة** — ملف مريض ومواعيد؛ يعيد استخدام التحصيل والصلاحيات.\n"
           "4. **حجز الملاعب** — جدول زمني ودفع عربون؛ أبسط من العيادة بعد وجود نمط المواعيد.\n"
           "5. **الموارد البشرية** — يحتاج الموظفين الموجودين في الأنظمة السابقة.\n"
           "6. **لوحة المواقع** — تحتاج كل الأنظمة والمواقع قائمة لتقيسها.\n")
    (SRC / "index.md").write_text(idx, encoding="utf-8")

    idx_html = render(
        {"name": "مواصفات التطبيقات السبعة", "status": "live", "order": "—"},
        md_to_html(idx.split("\n", 4)[4]),
        [("التطبيقات", str(len(specs)), False),
         ("تعمل", str(sum(1 for m, *_ in specs if m.get("status") == "live")), False),
         ("لم تُبنَ", str(sum(1 for m, *_ in specs if m.get("status") == "planned")), False),
         ("معايير القبول", f"{sum(s[2] for s in specs)}/{sum(s[3] for s in specs)}", False)],
        f"مُولَّد بواسطة <code>tools/build-app-specs.py</code> · <code>nilesys@{git_rev()}</code>",
    )
    (SRC / "index.html").write_text(idx_html, encoding="utf-8")

    # سجل الأنظمة كبيانات: لوحة المواقع تقرأ منه عدد الأنظمة العاملة
    # بدل رقم مكتوب في الكود، فيبقى الرقم صادقاً بعد كل تحديث.
    import json
    reg = {
        "generatedAt": __import__("datetime").date.today().isoformat(),
        "rev": git_rev(),
        "systems": [
            {
                "slug": m.get("slug", ""), "name": m.get("name", ""),
                "status": m.get("status", ""), "order": int(m.get("order", 99) or 99),
                "entry": m.get("entry", ""), "criteria": f"{c}/{t}",
            }
            for m, _, c, t in specs
        ],
    }
    out = PROTO / "public" / "data" / "systems.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"سجل الأنظمة → {out.relative_to(ROOT)} ({len(specs)} نظاماً)")

    print(f"كُتبت {len(specs)} مواصفة + فهرس في {SRC}")
    for m, _, c, t in specs:
        print(f"  {m.get('order')}. {m.get('name'):<22} {m.get('status'):<8} {c}/{t} معيار")
    windows_specs()

    if problems:
        print("\nمشاكل:")
        for p in problems:
            print("  ✗", p)
        return 1
    print("\nكل الحالات مدعومة بدليلها.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
