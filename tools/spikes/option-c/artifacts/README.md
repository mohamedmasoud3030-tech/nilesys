# M6 artifacts — Arabic document rendering

Produced by `probe-6-arabic-report.py` and `probe-6-arabic-pdf.py` on 2026-10-14.
Kept in the repository because the M6 claim is a *rendering* claim: it should be
looked at, not only read.

| File | What it is |
| --- | --- |
| `odoo_invoice_report.html` | Odoo's own `account.report_invoice` QWeb output, rendered with an English-language user. Contains the Arabic content but **no `dir="rtl"`** (`<html lang="en-US">`). |
| `odoo_invoice_report_ar.html` | The same report with Arabic (`ar_001`) activated. Still no `dir="rtl"` when the report language is not Arabic. |
| `odoo_invoice_report_ar_userlang.html` | The same report rendered in an Arabic report language: `<html lang="ar-001">` **with** `dir="rtl"`. |
| `arabic_invoice_probe.pdf` / `.png` | Independent PyMuPDF rendering of the invoice facts in Arabic, RTL and shaped. This is what an inspectable Arabic PDF looks like from a pypi-only toolchain — it is **not** Odoo's PDF pipeline. |
| `invoice_facts.json` | The invoice data both renders were built from. |

Two honest defects visible in the PyMuPDF artifact:

1. The em dash (`—`) from the real invoice line text renders as a missing-glyph box:
   Noto Naskh Arabic has no Latin punctuation. A bilingual document needs a font
   *pair* with overlapping coverage, which is a configuration requirement, not a
   framework feature.
2. It shows `مسودة` (draft), because the invoice is never posted in this spike —
   posting is gated by the ETA configuration checks measured in probe 4, and report
   rendering works on a draft. `invoice_name` is only assigned on posting.

> **Consolidation review note (2026-10-14).** Verified against the files: `odoo_invoice_report.html` has
> `lang="en-US"` and no `dir="rtl"`; `odoo_invoice_report_ar.html` and `odoo_invoice_report_ar_userlang.html`
> both have `lang="ar-001"` **and** `dir="rtl"` and are otherwise identical, so the description of
> `odoo_invoice_report_ar.html` above is inaccurate. All three contain the same 245 Arabic characters. The
> PNG shows correct shaping but a left-to-right page layout (ADR-0008 §10, C4).

