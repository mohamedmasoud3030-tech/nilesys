"""M1 completion probe — can a FULLY ETA-configured invoice be posted from Odoo Community?

Reads the real validation contract from addons/l10n_eg_edi_eta/models/account_edi_format.py
(_check_move_configuration) and satisfies every requirement it lists, then reports:
  A. the exact validation errors before configuration (evidence of what ETA demands)
  B. the exact validation errors after configuration (expect: none)
  C. what posting does, and where the chain stops without live ETA credentials

Network note: the ETA API domain is pointed at a closed local port so the submission
attempt fails fast (connection refused) instead of hanging on DNS. Live submission is
out of scope and impossible here — there are no ETA credentials and no route to ETA.
"""
import json

out = {}


def show(label, value):
    print(f"{label}: {value}")
    return value


company = env.ref("base.main_company")
eg = env["res.country"].search([("code", "=", "EG")], limit=1)
journal = env["account.journal"].search([("type", "=", "sale"), ("company_id", "=", company.id)], limit=1)
edi = env["account.edi.format"].search([("code", "=", "eg_eta")], limit=1)
print(f"company={company.name} ({company.country_id.code}) | journal={journal.name} ({journal.country_code}) | edi={edi.name if edi else 'MISSING'}")

# ── build the objects first, so step A can measure the *unconfigured* error list ──
# ETA address validation requires: country, state (governorate), city, street,
# l10n_eg_building_no, and vat — see _l10n_eg_validate_info_address in account_edi_format.py.
cairo = env["res.country.state"].search([("country_id", "=", eg.id), ("name", "ilike", "cairo")], limit=1)
branch = env["res.partner"].create({
    "name": "Spike Egypt LLC — Cairo Branch",
    "company_type": "company",
    "street": "12 Corniche El Nil",
    "city": "Cairo",
    "zip": "11511",
    "country_id": eg.id,
    "state_id": cairo.id,
    "l10n_eg_building_no": "12",
    "vat": "100123456789",
})
customer = env["res.partner"].create({
    "name": "Cairo Tenant LLC",
    "company_type": "company",
    "street": "5 Tahrir Square",
    "city": "Cairo",
    "zip": "11511",
    "country_id": eg.id,
    "state_id": cairo.id,
    "l10n_eg_building_no": "5",
    "vat": "100987654321",
})
tax = env["account.tax"].search(
    [("amount", "=", 14.0), ("company_id", "=", company.id), ("type_tax_use", "=", "sale")], limit=1
)
product = env["product.product"].create({"name": "Monthly Rent — October 2026", "list_price": 10000.0, "barcode": "SPIKE-RENT-001"})
invoice = env["account.move"].create({
    "move_type": "out_invoice",
    "partner_id": customer.id,
    "journal_id": journal.id,
    "invoice_date": "2026-10-01",
    "date": "2026-10-01",
    "ref": "SPIKE-ETA-2026-10",
    "invoice_line_ids": [(0, 0, {
        "product_id": product.id,
        "name": "Rent - October 2026",
        "quantity": 1,
        "price_unit": 10000.0,
        "tax_ids": [(6, 0, tax.ids)],
    })],
})
show("A. errors BEFORE configuration", json.dumps(edi._check_move_configuration(invoice), ensure_ascii=False, indent=1))

# ── satisfy every requirement in the validation contract ──────────────────────
company.write({"vat": "100123456789", "l10n_eg_production_env": False})
journal.write({
    "l10n_eg_branch_id": branch.id,
    "l10n_eg_branch_identifier": "0",
    "l10n_eg_activity_type_id": env["l10n_eg_edi.activity.type"].search([], limit=1).id,
})
# NOTE: the ETA API/token domains are builtin constants (ETA_DOMAINS in
# account_edi_format.py), not system parameters — nothing to configure here.
# Live submission needs ETA credentials and a route to ETA, neither of which exist here.

# UoM must carry an ETA unit code; the invoice line's UoM comes from the line/product.
uom_codes = env["l10n_eg_edi.uom.code"].search([], limit=5)
line_uom = invoice.invoice_line_ids[:1].product_uom_id
if uom_codes and not line_uom.l10n_eg_unit_code_id:
    line_uom.write({"l10n_eg_unit_code_id": uom_codes[0].id})
show("B0. UoM", f"{line_uom.name} -> unit code {line_uom.l10n_eg_unit_code_id.code or 'NONE'}")
show("B0. tax ETA code", f"{tax.name} -> {tax.l10n_eg_eta_code or 'NONE'}")
show("B0. product", f"barcode={product.barcode or 'NONE'} eta_code={product.l10n_eg_eta_code or 'NONE'}")

# ── measure again after configuration ─────────────────────────────────────────
errors_after = edi._check_move_configuration(invoice)
show("B. errors AFTER configuration", json.dumps(errors_after, ensure_ascii=False, indent=1))

# ── attempt the post ──────────────────────────────────────────────────────────
try:
    invoice.action_post()
    invoice.invalidate_recordset()
    show("C. POST result", json.dumps({
        "state": invoice.state,
        "name": invoice.name,
        "amount_untaxed": invoice.amount_untaxed,
        "amount_tax": invoice.amount_tax,
        "amount_total": invoice.amount_total,
        "edi_state": getattr(invoice, "edi_state", None),
        "l10n_eg_submission_number": invoice.l10n_eg_submission_number,
        "l10n_eg_uuid": invoice.l10n_eg_uuid,
        "l10n_eg_is_signed": invoice.l10n_eg_is_signed,
        "has_signed_json": bool(invoice.l10n_eg_eta_json_doc_file),
        "has_qr": bool(invoice.l10n_eg_qr_code),
    }, indent=1))
    # what the ETA chain produced locally, and where it stopped
    if invoice.l10n_eg_eta_json_doc_file:
        doc = json.loads(__import__("base64").b64decode(invoice.l10n_eg_eta_json_doc_file))
        show("C1. ETA document keys", list(doc.keys()))
        req = doc.get("request", {})
        show("C2. ETA request keys", sorted(req.keys()))
        show("C3. signatures present", bool(req.get("signatures")))
    show("C4. EDI messages", [
        {"blocking_level": m.blocking_level, "error": (m.error or "")[:200]} for m in invoice.edi_document_ids
    ])
    show("C5. edi_error_message", (invoice.edi_error_message or "(none)")[:300])
except Exception as exc:  # noqa: BLE001
    show("C. POST raised", f"{type(exc).__name__}: {str(exc)[:400]}")

# ── ledger check regardless of the ETA outcome ────────────────────────────────
if invoice.state == "posted":
    env.cr.execute("SELECT sum(balance) FROM account_move_line WHERE move_id = %s", (invoice.id,))
    show("D. journal entry balanced (sum of balances)", env.cr.fetchone()[0])
env.cr.rollback()
