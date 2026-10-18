"""M6 (part 2 of 2) — can a correctly shaped Arabic PDF be produced here at all?

Odoo's own PDF rendering uses wkhtmltopdf, which cannot be installed in this
environment (no apt, no pango/gobject/harfbuzz/cairo in ldconfig, and it is not on
PyPI). So Odoo's exact PDF bytes are NOT measurable here — that limitation is
recorded in the results document.

This script proves the adjacent, useful fact: a pypi-only toolchain
(PyMuPDF -> MuPDF, which shapes complex text through harfbuzz) can lay out
RTL Arabic from inline HTML and produce an inspectable PDF, given an Arabic font
that must be supplied out of band.

Run standalone:

    python3 probe-6-arabic-pdf.py

Reads invoice_facts.json (written by probe-6-arabic-report.py) and the Arabic
fonts from $SPIKE_FONTS (default /tmp/spike/fonts). Writes
arabic_invoice_probe.pdf and .png next to the other artifacts so the result can
be looked at rather than trusted.
"""
import json
import os

import pymupdf

ARTIFACTS = os.environ.get('SPIKE_ARTIFACTS', '/tmp/spike/artifacts')
FONTS = os.environ.get('SPIKE_FONTS', '/tmp/spike/fonts')

facts = json.load(open(f'{ARTIFACTS}/invoice_facts.json', encoding='utf-8'))
OUT_PDF = f'{ARTIFACTS}/arabic_invoice_probe.pdf'
OUT_PNG = f'{ARTIFACTS}/arabic_invoice_probe.png'

html = f"""
<html><head><style>
  body {{ font-family: noto; font-size: 11px; }}
  .rtl {{ direction: rtl; text-align: right; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
  th, td {{ border: 1px solid #999; padding: 5px; }}
</style></head><body>
  <div class="rtl">
    <h1>فاتورة ضريبية</h1>
    <p>رقم الفاتورة: {facts['invoice_name'] or 'مسودة'} — التاريخ: {facts['invoice_date']}</p>
    <p>العميل: {facts['customer']}</p>
    <p>الرقم الضريبي: {facts['customer_vat']}</p>
  </div>
  <table class="rtl">
    <tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
    <tr><td>{facts['line']}</td><td>1</td><td>10,000.00</td><td>10,000.00</td></tr>
  </table>
  <div class="rtl">
    <p>الإجمالي قبل الضريبة: {facts['untaxed']:,.2f} ج.م</p>
    <p>ضريبة القيمة المضافة (14%): {facts['tax']:,.2f} ج.م</p>
    <p><b>الإجمالي المستحق: {facts['total']:,.2f} ج.م</b></p>
  </div>
</body></html>
"""

css = '@font-face { font-family: noto; src: url(NotoNaskhArabic-Regular.ttf); }'

story = pymupdf.Story(html=html, user_css=css, archive=pymupdf.Archive(FONTS))
writer = pymupdf.DocumentWriter(OUT_PDF)
mediabox = pymupdf.paper_rect('a5')
where = mediabox + (28, 28, -28, -28)

pages, more = 0, 1
while more:
    dev = writer.begin_page(mediabox)
    more, _ = story.place(where)
    story.draw(dev)
    writer.end_page()
    pages += 1
writer.close()

doc = pymupdf.open(OUT_PDF)
text = doc[0].get_text()
doc[0].get_pixmap(dpi=110).save(OUT_PNG)

# Arabic presentation forms (U+FB50-U+FEFF) appear only when the text was
# actually shaped for RTL display, so their presence is the proof that matters.
print(json.dumps({
    'pymupdf_version': pymupdf.__version__,
    'pages': pages,
    'pdf_bytes': os.path.getsize(OUT_PDF),
    'png_bytes': os.path.getsize(OUT_PNG),
    'arabic_characters_extracted': sum(1 for c in text if '\u0600' <= c <= '\u06FF'),
    'shaped_presentation_forms': sum(1 for c in text if '\ufb50' <= c <= '\ufeff'),
    'sample': text.strip().replace('\n', ' | ')[:150],
}, ensure_ascii=False, indent=1))
