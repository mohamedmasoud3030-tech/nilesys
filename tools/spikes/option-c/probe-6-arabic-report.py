"""M6 (part 1 of 2) — what does Odoo's own report layer do with Arabic?

Measured facts this script produces:
  1. Arabic *content* reaches the rendered invoice (partner name, address, line text).
  2. Whether the document comes out RTL, and what decides that.
  3. Whether Arabic UI/data translations actually load and reach accounting data.

Run with the Odoo shell (the module must not be imported into app code):

    PYTHONPATH=/tmp/spike/pystub python3 /tmp/spike/odoo19/odoo-bin shell \
      -d spike19 --db_host=/tmp/spike/pgdata --db_user=odoo --db_password=odoo \
      --log-level=error --no-http < probe-6-arabic-report.py

Requires the Arabic invoice created by probe 6's setup step (ref 'AR-PDF-001').
Posting is not required: report rendering works on a draft invoice, and posting is
gated by the ETA configuration checks measured in probe 4.
"""
import json
import re

ARTIFACTS = '/tmp/spike/artifacts'

# --- setup: an Arabic partner + a draft Arabic invoice -----------------------
partner = env['res.partner'].sudo().search([('ref', '=', 'AR-PDF-001')], limit=1)
if not partner:
    partner = env['res.partner'].sudo().create({
        'name': 'شركة النيل للمقاولات',
        'ref': 'AR-PDF-001',
        'company_type': 'company',
        'vat': '100987654321',
        'street': '١٢ كورنيش النيل',
        'city': 'القاهرة',
        'country_id': env.ref('base.eg').id,
    })
invoice = env['account.move'].sudo().search([('ref', '=', 'AR-PDF-001')], limit=1)
if not invoice:
    invoice = env['account.move'].sudo().create({
        'move_type': 'out_invoice',
        'partner_id': partner.id,
        'invoice_date': '2026-10-01',
        'ref': 'AR-PDF-001',
        'invoice_line_ids': [(0, 0, {
            'name': 'إيجار شهر أكتوبر ٢٠٢٦ — وحدة ٥',
            'quantity': 1,
            'price_unit': 10000.0,
            'account_id': env['account.account'].sudo().search(
                [('account_type', '=', 'income')], limit=1).id,
            'tax_ids': [(6, 0, env['account.tax'].sudo().search(
                [('amount', '=', 14.0), ('type_tax_use', '=', 'sale')], limit=1).ids)],
        })],
    })
env.cr.commit()

# --- step 1: render BEFORE Arabic is active (English UI user) ----------------
report = env['ir.actions.report']
def render(lang=None):
    rep = report.with_context(lang=lang) if lang else report
    res = rep._render_qweb_html('account.report_invoice', invoice.ids)
    return res[0].decode('utf-8') if isinstance(res[0], bytes) else str(res[0])

html_default = render()
open(f'{ARTIFACTS}/odoo_invoice_report.html', 'w', encoding='utf-8').write(html_default)

def metrics(html):
    return {
        'arabic_characters': len(re.findall(r'[\u0600-\u06FF]', html)),
        'partner_name_present': 'شركة النيل للمقاولات' in html,
        'line_text_present': 'إيجار شهر أكتوبر' in html,
        'html_lang': (re.search(r'<html[^>]*lang="([^"]*)"', html) or [None, None])[1],
        'dir_rtl': 'dir="rtl"' in html,
        'rtl_markers': len(re.findall(r'dir="rtl"|text-right|rtl', html)),
    }

part1 = {'render_english_user': metrics(html_default)}

# --- step 2: activate the Arabic language Odoo ships -------------------------
# Egypt has no ar_EG record; Odoo 19 ships ar_001 (generic Arabic, direction=rtl)
# plus ar_SY. res.lang hides inactive rows unless active_test is disabled.
RL = env['res.lang'].with_context(active_test=False)
arabic = RL.search([('code', '=', 'ar_001')], limit=1)
if arabic and not arabic.active:
    arabic.write({'active': True})
    env.cr.commit()
if arabic:
    env['base.language.install'].create({
        'lang_ids': [(6, 0, [arabic.id])], 'overwrite': True,
    }).lang_install()
    env.cr.commit()

# --- step 3: render as an Arabic-language report/user ------------------------
html_ar = render(lang='ar_001')
open(f'{ARTIFACTS}/odoo_invoice_report_ar.html', 'w', encoding='utf-8').write(html_ar)
part1['render_arabic_language'] = metrics(html_ar)
part1['rtl_decided_by'] = (
    "web/views/report_templates.xml: t-att-dir uses "
    "env['res.lang']._get_data(code=lang or env.user.lang).direction"
)
part1['egypt_specific_language_record_exists'] = bool(
    RL.search([('code', '=', 'ar_EG')], limit=1))
part1['l10n_eg_ships_arabic_translations'] = __import__('os').path.exists(
    '/tmp/spike/odoo19/addons/l10n_eg/i18n/ar.po')

# --- step 4: did Arabic reach the *data*, not just the labels? ---------------
def count_jsonb_ar(table, column):
    env.cr.execute(
        f'SELECT count(*) FROM {table} WHERE {column} ? %s', ('ar_001',))
    return env.cr.fetchone()[0]

part1['data_translations'] = {
    'account_account.name_with_ar_001': count_jsonb_ar('account_account', 'name'),
    'account_journal.name_with_ar_001': count_jsonb_ar('account_journal', 'name'),
}

print(json.dumps(part1, ensure_ascii=False, indent=1))

# --- facts for part 2 (the independent PDF proof) ---------------------------
totals = {
    'company': env.company.name,
    'customer': partner.name,
    'customer_vat': partner.vat,
    'invoice_name': invoice.name or False,
    'invoice_date': str(invoice.invoice_date),
    'untaxed': invoice.amount_untaxed,
    'tax': invoice.amount_tax,
    'total': invoice.amount_total,
    'line': invoice.invoice_line_ids[0].name,
}
with open(f'{ARTIFACTS}/invoice_facts.json', 'w', encoding='utf-8') as fh:
    json.dump(totals, fh, ensure_ascii=False, indent=1)
print('invoice facts saved:', json.dumps(totals, ensure_ascii=False))
