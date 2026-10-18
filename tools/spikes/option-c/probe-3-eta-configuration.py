"""Probe v3 — what does ETA configuration actually require before an invoice can be posted?
Also: can a locked period be enforced, and can a trial balance be reconstructed from SQL
given that account codes now live in a jsonb column?
"""
results = []


def step(label, fn):
    try:
        v = fn()
        results.append((label, True, repr(v)[:260])); print(f"PASS | {label} | {repr(v)[:260]}")
    except Exception as exc:  # noqa: BLE001
        results.append((label, False, f"{type(exc).__name__}: {exc}"[:260])); print(f"FAIL | {label} | {type(exc).__name__}: {str(exc)[:230]}")
    return None


def raw_sql(q, p=()):
    with env.cr.savepoint():
        env.cr.execute(q, p); return env.cr.fetchall()


company = env.ref("base.main_company")

print("=" * 72)
print("A — what ETA configuration does the module require?")
print("=" * 72)
eta_company_fields = sorted(f for f in env["res.company"]._fields if "l10n_eg" in f or "eta" in f)
print("company ETA fields:", eta_company_fields)
eta_journal_fields = sorted(f for f in env["account.journal"]._fields if "l10n_eg" in f or "eta" in f)
print("journal ETA fields:", eta_journal_fields)
eta_move_fields = sorted(f for f in env["account.move"]._fields if "l10n_eg" in f)
print("invoice ETA fields:", eta_move_fields)
print("activity types available:", env["l10n_eg_edi.activity.type"].search([]).mapped(lambda r: (r.code, r.name))[:5])
print("uom codes available:", env["l10n_eg_edi.uom.code"].search_count([]))

print()
print("=" * 72)
print("B — configure the minimum and try to post an ETA-valid invoice")
print("=" * 72)


def configure():
    company.write({"vat": "100123456789", "name": "Spike Egypt LLC"})
    partner = env["res.partner"].create({
        "name": "Cairo Tenant LLC",
        "company_type": "company",
        "vat": "100987654321",
        "country_id": env["res.country"].search([("code", "=", "EG")], limit=1).id,
        "street": "1 Corniche El Nil", "city": "Cairo",
    })
    journal = env["account.journal"].search([("type", "=", "sale"), ("company_id", "=", company.id)], limit=1)
    activity = env["l10n_eg_edi.activity.type"].search([], limit=1)
    applied = []
    if "l10n_eg_edi_activity_type_id" in journal._fields and activity:
        journal.write({"l10n_eg_edi_activity_type_id": activity.id}); applied.append(f"journal.activity={activity.code}")
    for fname, value in (("l10n_eg_edi_branch_id", "0"), ("l10n_eg_edi_issuer_name", company.name), ("l10n_eg_edi_issuer_id", "100123456789")):
        if fname in journal._fields:
            try:
                journal.write({fname: value}); applied.append(f"journal.{fname}={value}")
            except Exception as e:  # noqa: BLE001
                applied.append(f"journal.{fname} FAILED ({type(e).__name__})")
    for fname, value in (("l10n_eg_edi_branch_id", "0"), ("l10n_eg_edi_activity_type_id", activity.id if activity else False)):
        if fname in company._fields and value:
            try:
                company.write({fname: value}); applied.append(f"company.{fname}={value}")
            except Exception as e:  # noqa: BLE001
                applied.append(f"company.{fname} FAILED ({type(e).__name__})")
    return {"journal": journal.name, "partner_vat": partner.vat, "applied": applied}


cfg = configure()
print("configured:", cfg)
journal = env["account.journal"].search([("type", "=", "sale"), ("company_id", "=", company.id)], limit=1)
partner = env["res.partner"].search([("vat", "=", "100987654321")], limit=1)
tax = env["account.tax"].search([("amount", "=", 14.0), ("company_id", "=", company.id), ("type_tax_use", "=", "sale")], limit=1)

state = {}


def create_and_post():
    m = env["account.move"].create({
        "move_type": "out_invoice",
        "partner_id": partner.id,
        "journal_id": journal.id,
        "invoice_date": "2026-10-01", "date": "2026-10-01",
        "ref": "SPIKE-RENT-2026-10",
        "invoice_line_ids": [(0, 0, {"name": "Rent - October 2026", "quantity": 1, "price_unit": 10000.0, "tax_ids": [(6, 0, tax.ids)]})],
    })
    state["invoice"] = m
    m.action_post()
    return {"name": m.name, "state": m.state, "total": m.amount_total, "edi_state": getattr(m, "edi_state", None), "l10n_eg_edi_state": getattr(m, "l10n_eg_edi_state", None)}


step("B.1 create and POST an ETA-configured invoice", create_and_post)

if state.get("invoice"):
    inv = state["invoice"]


    def partial_payment():
        line = env["account.payment.method.line"].search([("payment_type", "=", "inbound")], limit=1)
        ctx = {"active_model": "account.move", "active_ids": inv.ids, "active_id": inv.id}
        vals = {"amount": 5000.0, "payment_date": "2026-10-05"}
        if line:
            vals["payment_method_line_id"] = line.id
        w = env["account.payment.register"].with_context(**ctx).create(vals)
        w.action_create_payments()
        inv.invalidate_recordset()
        return {"payment_state": inv.payment_state, "residual": inv.amount_residual, "total": inv.amount_total}


    step("B.2 partial payment of a posted ETA invoice", partial_payment)


    def locked_period():
        company.write({"hard_lock_date": "2026-10-31"})
        try:
            blocker = env["account.move"].create({
                "move_type": "out_invoice", "partner_id": partner.id, "journal_id": journal.id,
                "invoice_date": "2026-10-15", "date": "2026-10-15",
                "invoice_line_ids": [(0, 0, {"name": "late", "quantity": 1, "price_unit": 50.0})],
            })
            try:
                blocker.action_post(); outcome = "POSTED INTO LOCKED PERIOD (unexpected)"
            except Exception as e:  # noqa: BLE001
                outcome = f"refused: {type(e).__name__}: {str(e)[:90]}"
            with env.cr.savepoint():
                blocker.unlink()
            return outcome
        finally:
            company.write({"hard_lock_date": False})


    step("B.3 hard-locked period refuses new postings", locked_period)

    print()
    print("=" * 72)
    print("C — trial balance from SQL with the jsonb account-code layout")
    print("=" * 72)
    step("C.1 code_store jsonb sample", lambda: raw_sql("SELECT id, code_store FROM account_account WHERE code_store IS NOT NULL LIMIT 3"))


    def trial_balance():
        rows = raw_sql("""
            SELECT aa.code_store->>%s AS code, SUM(aml.debit), SUM(aml.credit), SUM(aml.balance)
            FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
            WHERE aml.company_id = %s AND aml.parent_state = 'posted'
            GROUP BY aa.code_store->>%s HAVING SUM(aml.balance) <> 0 ORDER BY 1
        """, (str(company.id), company.id, str(company.id)))
        return {"accounts": len(rows), "sum_of_balances": round(sum(float(r[3] or 0) for r in rows), 2), "sample": rows[:4]}


    step("C.2 trial balance via code_store->>company_id", trial_balance)

print()
print("=" * 72)
print("SUMMARY")
print("=" * 72)
print(f"{sum(1 for _, ok, _ in results if ok)}/{len(results)} passed")
for label, ok, detail in results:
    print(f"  [{'ok' if ok else 'XX'}] {label}" + ("" if ok else f" -> {detail[:150]}"))
env.cr.rollback()
