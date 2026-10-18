"""Option C spike probe v2 — Egyptian localization applied at setup, savepoint-guarded SQL,
adaptive field discovery so Odoo version differences are data rather than noise.
"""
results = []


def step(label, fn):
    try:
        value = fn()
        results.append((label, True, repr(value)[:240]))
        print(f"PASS | {label} | {repr(value)[:240]}")
    except Exception as exc:  # noqa: BLE001
        results.append((label, False, f"{type(exc).__name__}: {exc}"[:240]))
        print(f"FAIL | {label} | {type(exc).__name__}: {str(exc)[:200]}")
    return None


def raw_sql(query, params=()):
    """Read-only SQL, isolated in a savepoint so a failure cannot abort the transaction."""
    with env.cr.savepoint():
        env.cr.execute(query, params)
        return env.cr.fetchall()


print("=" * 72)
print("M0 — Egyptian localization applied at company setup")
print("=" * 72)
company = env.ref("base.main_company")
print("company:", company.name, "| country:", company.country_id.code or "(none)")
step("M0.1 company country is EG", lambda: company.country_id.code)
step(
    "M0.2 accounts installed for this company",
    lambda: env["account.account"].search_count([("company_ids", "in", company.id)]),
)
vat = env["account.tax"].search([("amount", "=", 14.0), ("company_id", "=", company.id), ("amount_type", "=", "percent")])
step("M0.3 Egyptian 14% VAT tax exists", lambda: {"count": len(vat), "names": vat.mapped("name")[:3]})
step("M0.4 l10n_eg_edi_eta installed", lambda: env["ir.module.module"].search([("name", "=", "l10n_eg_edi_eta")]).state)

print()
print("=" * 72)
print("M2 — ETA machinery wired into accounting")
print("=" * 72)
step("M2.1 ETA models registered", lambda: sorted(m for m in env.registry.keys() if "edi" in m and "l10n_eg" in m))
step(
    "M2.2 ETA fields on account.move",
    lambda: sorted(f for f in env["account.move"]._fields if f.startswith(("l10n_eg", "edi_state", "edi_document")))[:10],
)
step(
    "M2.3 ETA journal configuration fields",
    lambda: sorted(f for f in env["account.journal"]._fields if "l10n_eg" in f or "edi" in f)[:10],
)

print()
print("=" * 72)
print("M1 — invoice with Egyptian VAT -> post -> partial payment (Community only)")
print("=" * 72)
state = {}
step("M1.1 create customer", lambda: (state.setdefault("partner", env["res.partner"].create({"name": "Spike Tenant LLC", "company_type": "company"})), f"id={state['partner'].id}")[1])
tax = vat[:1] or env["account.tax"].search([("type_tax_use", "=", "sale"), ("company_id", "=", company.id)], limit=1)
print("tax used:", tax.name, "| amount:", tax.amount)


def create_invoice():
    m = env["account.move"].create({
        "move_type": "out_invoice",
        "partner_id": state["partner"].id,
        "invoice_date": "2026-10-01",
        "date": "2026-10-01",
        "ref": "SPIKE-RENT-2026-10",
        "invoice_line_ids": [(0, 0, {
            "name": "Rent - October 2026",
            "quantity": 1,
            "price_unit": 10000.0,
            "tax_ids": [(6, 0, tax.ids)],
        })],
    })
    state["invoice"] = m
    return {"name": m.name, "state": m.state, "untaxed": m.amount_untaxed, "tax": m.amount_tax, "total": m.amount_total}


step("M1.2 create invoice with 14% VAT", create_invoice)
step("M1.3 post invoice", lambda: (state["invoice"].action_post(), state["invoice"].state, state["invoice"].name)[1:])


def partial_payment():
    journal = state["invoice"].journal_id
    line = env["account.payment.method.line"].search(
        [("payment_type", "=", "inbound"), "|", ("journal_id", "=", journal.id), ("journal_id", "=", False)], limit=1
    )
    ctx = {"active_model": "account.move", "active_ids": state["invoice"].ids, "active_id": state["invoice"].id}
    vals = {"amount": 5000.0, "payment_date": "2026-10-05", "journal_id": journal.id}
    if line:
        vals["payment_method_line_id"] = line.id
    wizard = env["account.payment.register"].with_context(**ctx).create(vals)
    wizard.action_create_payments()
    state["invoice"].invalidate_recordset()
    return {
        "payment_method_line": line.display_name if line else "default",
        "payment_state": state["invoice"].payment_state,
        "residual_after_partial": state["invoice"].amount_residual,
        "total": state["invoice"].amount_total,
    }


step("M1.4 partial payment (5000 of 11400)", partial_payment)

print()
print("=" * 72)
print("M4 / M5 — integrity guarantees")
print("=" * 72)
step(
    "M5.1 delete posted entry refused",
    lambda: (state["invoice"].unlink(), "DELETED (unexpected)")[1] if False else _refuse_unlink(state) if False else None,
)


def _refuse_unlink(state=state):
    try:
        state["invoice"].unlink()
        return "DELETED (unexpected)"
    except Exception as exc:  # noqa: BLE001
        return f"refused: {type(exc).__name__}"


step("M5.1 delete posted entry refused", _refuse_unlink)


def reversal():
    wizard = env["account.move.reversal"].with_context(
        active_model="account.move", active_ids=state["invoice"].ids
    ).create({"reason": "spike reversal", "journal_id": state["invoice"].journal_id.id})
    action = wizard.reverse_moves()
    ids = (action or {}).get("res_id")
    new_moves = env["account.move"].browse(ids) if ids else env["account.move"].search(
        [("reversed_entry_id", "=", state["invoice"].id)]
    )
    return {"reversal_ids": new_moves.ids, "original_state": state["invoice"].state,
            "reversal_state": new_moves.mapped("state") or "posted-via-action"}


step("M5.2 correction via reversal (never edit/delete)", reversal)

lock_fields = sorted(f for f in env["res.company"]._fields if "lock" in f)
print("lock-related company fields:", lock_fields)


def locked_period():
    field = next((f for f in ("hard_lock_date", "fiscalyear_lock_date", "period_lock_date", "tax_lock_date") if f in lock_fields), None)
    if not field:
        return "no lock field found — cannot verify"
    company.write({field: "2026-10-31"})
    try:
        blocker = env["account.move"].create({
            "move_type": "out_invoice",
            "partner_id": state["partner"].id,
            "invoice_date": "2026-10-01",
            "date": "2026-10-01",
            "invoice_line_ids": [(0, 0, {"name": "late entry", "quantity": 1, "price_unit": 100.0})],
        })
        try:
            blocker.action_post()
            outcome = "POSTED INTO LOCKED PERIOD (unexpected)"
        except Exception as exc:  # noqa: BLE001
            outcome = f"refused: {type(exc).__name__}"
        with env.cr.savepoint():
            blocker.unlink()
        return {"field": field, "outcome": outcome}
    finally:
        company.write({field: False})


step("M4.1 posting into a locked period refused", locked_period)


def duplicate_ref():
    dup = env["account.move"].create({
        "move_type": "out_invoice",
        "partner_id": state["partner"].id,
        "invoice_date": "2026-10-01",
        "date": "2026-10-01",
        "ref": "SPIKE-RENT-2026-10",
        "invoice_line_ids": [(0, 0, {"name": "Duplicate submission", "quantity": 1, "price_unit": 10000.0})],
    })
    dup.action_post()
    return {
        "distinct_document_created": dup.id != state["invoice"].id,
        "both_posted": dup.state == "posted" and state["invoice"].state in ("posted", "reversed"),
        "conclusion": "ledger does NOT deduplicate on external reference -> LedgerProvider must enforce idempotency",
    }


step("M3.1 duplicate external reference accepted?", duplicate_ref)

print()
print("=" * 72)
print("M7 — read-only reporting over ledger data (no Enterprise, no AGPL)")
print("=" * 72)
step(
    "M7.0 account code storage layout (schema coupling)",
    lambda: [
        {"table": t, "columns": [c for c in cols if "code" in c or c in ("account_id", "company_id")]}
        for t, cols in [
            (t, [r[0] for r in raw_sql(
                "select column_name from information_schema.columns where table_name=%s", (t,))])
            for t in ("account_account", "account_code_mapping", "account_move_line")
        ]
    ],
)


def trial_balance():
    cols = [r[0] for r in raw_sql("select column_name from information_schema.columns where table_name='account_code_mapping'")]
    if cols:
        query = """
            SELECT acm.code, SUM(aml.debit), SUM(aml.credit), SUM(aml.balance)
            FROM account_move_line aml
            JOIN account_code_mapping acm ON acm.account_id = aml.account_id AND acm.company_id = aml.company_id
            WHERE aml.company_id = %s AND aml.parent_state = 'posted'
            GROUP BY acm.code HAVING SUM(aml.balance) <> 0 ORDER BY acm.code
        """
    else:
        query = """
            SELECT aa.code, SUM(aml.debit), SUM(aml.credit), SUM(aml.balance)
            FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
            WHERE aml.company_id = %s AND aml.parent_state = 'posted'
            GROUP BY aa.code HAVING SUM(aml.balance) <> 0 ORDER BY aa.code
        """
    rows = raw_sql(query, (company.id,))
    total_balance = sum(float(r[3] or 0) for r in rows)
    return {"accounts_with_movement": len(rows), "sum_of_balances": round(total_balance, 2), "sample": rows[:3]}


step("M7.1 trial balance reconstructable from plain SQL", trial_balance)
step(
    "M7.2 AR aging base query",
    lambda: raw_sql(
        """SELECT am.invoice_date_due, am.amount_residual FROM account_move am
           WHERE am.company_id=%s AND am.move_type='out_invoice' AND am.state='posted' AND am.amount_residual>0""",
        (company.id,),
    ),
)
step(
    "M7.3 journals/periods readable for statements",
    lambda: raw_sql(
        """SELECT j.code, count(*) FROM account_move m JOIN account_journal j ON j.id=m.journal_id
           WHERE m.company_id=%s GROUP BY j.code""",
        (company.id,),
    ),
)

print()
print("=" * 72)
print("SUMMARY")
print("=" * 72)
passed = sum(1 for _, ok, _ in results if ok)
print(f"{passed}/{len(results)} measurements passed")
for label, ok, detail in results:
    print(f"  [{'ok' if ok else 'XX'}] {label}" + ("" if ok else f"  -> {detail[:130]}"))
env.cr.rollback()
