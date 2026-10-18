"""Option C spike probe — measures Odoo Community's ledger behaviour from inside.

Run:  odoo-bin shell -d spike_test --db_host=... --db_user=... < probe.py
Everything is wrapped so a failure in one measurement does not hide the others.
"""
results = []


def step(label, fn):
    try:
        value = fn()
        results.append((label, True, repr(value)[:220]))
        print(f"PASS | {label} | {repr(value)[:220]}")
    except Exception as exc:  # noqa: BLE001 - spike probe, any failure is data
        results.append((label, False, f"{type(exc).__name__}: {exc}"[:220]))
        print(f"FAIL | {label} | {type(exc).__name__}: {str(exc)[:200]}")
    return None


print("=" * 70)
print("M0 — environment and Egyptian localization")
print("=" * 70)
company = env.ref("base.main_company")
print("company:", company.name, "| country:", company.country_id.code or "(none)")

eg = env["res.country"].search([("code", "=", "EG")], limit=1)
if company.country_id != eg:
    company.write({"country_id": eg.id})
    print("set company country -> EG")


def load_chart():
    loaded = env["account.account"].search_count([("company_ids", "in", company.id)])
    if loaded:
        return f"chart already loaded ({loaded} accounts)"
    env["account.chart.template"].try_loading("eg", company)
    return f"loaded EG chart ({env['account.account'].search_count([('company_ids', 'in', company.id)])} accounts)"


step("M0.1 Egyptian chart of accounts present", load_chart)
step(
    "M0.2 Egyptian VAT tax rate available (14%)",
    lambda: env["account.tax"]
    .search_count([("amount", "=", 14.0), ("company_id", "=", company.id), ("amount_type", "=", "percent")]),
)
step(
    "M0.3 l10n_eg module state",
    lambda: env["ir.module.module"].search([("name", "=", "l10n_eg")]).state,
)
step(
    "M0.4 l10n_eg_edi_eta module state",
    lambda: env["ir.module.module"].search([("name", "=", "l10n_eg_edi_eta")]).state,
)

print()
print("=" * 70)
print("M2 — is the ETA e-invoicing machinery actually present and wired?")
print("=" * 70)
step(
    "M2.1 ETA-related models registered",
    lambda: sorted(m for m in env.registry.keys() if "l10n_eg" in m or "eta" in m.lower())[:12],
)
step(
    "M2.2 ETA fields on account.move",
    lambda: sorted(f for f in env["account.move"]._fields if "edi" in f or "eta" in f)[:14],
)

print()
print("=" * 70)
print("M1 — full invoice -> post -> partial payment flow, Community only")
print("=" * 70)

state = {}


def create_partner():
    p = env["res.partner"].create({"name": "Spike Tenant LLC", "company_type": "company"})
    state["partner"] = p
    return f"partner id={p.id}"


step("M1.1 create customer (partner)", create_partner)

tax = env["account.tax"].search(
    [("amount", "=", 14.0), ("company_id", "=", company.id), ("type_tax_use", "=", "sale"), ("amount_type", "=", "percent")],
    limit=1,
)
print("using tax:", tax.name if tax else "(none found)")


def create_invoice():
    m = env["account.move"].create(
        {
            "move_type": "out_invoice",
            "partner_id": state["partner"].id,
            "invoice_date": "2026-10-01",
            "date": "2026-10-01",
            "ref": "SPIKE-RENT-2026-10",
            "invoice_line_ids": [
                (
                    0,
                    0,
                    {
                        "name": "Rent - October 2026",
                        "quantity": 1,
                        "price_unit": 10000.0,
                        "tax_ids": [(6, 0, [tax.id])] if tax else [],
                    },
                )
            ],
        }
    )
    state["invoice"] = m
    return {"name": m.name, "state": m.state, "total": m.amount_total, "tax": m.amount_tax, "residual": m.amount_residual}


step("M1.2 create customer invoice with 14% VAT", create_invoice)
step("M1.3 post the invoice", lambda: (state["invoice"].action_post(), state["invoice"].state)[1])
step(
    "M1.4 invoice filed as ETA-relevant document",
    lambda: {
        "l10n_eg_edi_state": getattr(state["invoice"], "l10n_eg_edi_state", "field absent"),
        "uuid": getattr(state["invoice"], "l10n_eg_edi_uuid", "field absent"),
    },
)


def register_payment():
    ctx = {
        "active_model": "account.move",
        "active_ids": state["invoice"].ids,
        "active_id": state["invoice"].id,
    }
    wizard = env["account.payment.register"].with_context(**ctx).create(
        {
            "amount": 5000.0,
            "payment_date": "2026-10-05",
            "journal_id": state["invoice"].journal_id.id,
        }
    )
    wizard.action_create_payments()
    state["invoice"].invalidate_recordset()
    return {
        "state": state["invoice"].state,
        "payment_state": state["invoice"].payment_state,
        "residual": state["invoice"].amount_residual,
    }


step("M1.5 record PARTIAL payment (5000 of 11400)", register_payment)

print()
print("=" * 70)
print("M4 / M5 — integrity guarantees we would be adopting the ledger for")
print("=" * 70)


def delete_posted():
    try:
        state["invoice"].unlink()
        return "DELETED (unexpected)"
    except Exception as exc:  # noqa: BLE001
        return f"refused: {type(exc).__name__}"


step("M5.1 deleting a posted entry is refused", delete_posted)


def reverse():
    wizard = (
        env["account.move.reversal"]
        .with_context(active_model="account.move", active_ids=state["invoice"].ids)
        .create({"reason": "spike reversal", "journal_id": state["invoice"].journal_id.id})
    )
    wizard.refresh()
    res = wizard.reverse_moves()
    moves = env["account.move"].browse(res.get("res_id")) if res.get("res_id") else None
    return {"reversal_route": bool(res), "reversal_ids": moves.ids if moves else res}


step("M5.2 correction exists as reversal (not edit/delete)", reverse)


def closed_period():
    earlier = state["invoice"].date
    company.write({"period_lock_date": "2026-10-31"})
    blocker = env["account.move"].create(
        {
            "move_type": "out_invoice",
            "partner_id": state["partner"].id,
            "invoice_date": earlier,
            "date": earlier,
            "invoice_line_ids": [(0, 0, {"name": "late entry", "quantity": 1, "price_unit": 100.0})],
        }
    )
    try:
        blocker.action_post()
        company.write({"period_lock_date": False})
        return "POSTED INTO LOCKED PERIOD (unexpected)"
    except Exception as exc:  # noqa: BLE001
        company.write({"period_lock_date": False})
        blocker.unlink()
        return f"refused: {type(exc).__name__}"


step("M4.1 posting into a locked period is refused", closed_period)


def idempotency():
    """Does the ledger itself prevent the same invoice being posted twice?"""
    dup = env["account.move"].create(
        {
            "move_type": "out_invoice",
            "partner_id": state["partner"].id,
            "invoice_date": "2026-10-01",
            "date": "2026-10-01",
            "ref": "SPIKE-RENT-2026-10",  # same external reference
            "invoice_line_ids": [(0, 0, {"name": "Rent - duplicate submission", "quantity": 1, "price_unit": 10000.0})],
        }
    )
    dup.action_post()
    return {
        "second_document_created": dup.id != state["invoice"].id,
        "duplicate_allowed": dup.state == "posted",
        "note": "ledger does not deduplicate on external ref — the port must enforce idempotency",
    }


step("M3.1 duplicate submission with identical external ref", idempotency)

print()
print("=" * 70)
print("M7 — can our own reporting layer reconstruct statements read-only?")
print("=" * 70)


def trial_balance():
    env.cr.execute(
        """
        SELECT aa.code, aa.name->>'en_US' AS name,
               SUM(aml.debit)  AS debit,
               SUM(aml.credit) AS credit,
               SUM(aml.balance) AS balance
        FROM account_move_line aml
        JOIN account_account aa ON aa.id = aml.account_id
        WHERE aml.company_id = %s AND aml.parent_state = 'posted'
        GROUP BY aa.code, aa.name
        HAVING SUM(aml.debit) <> 0 OR SUM(aml.credit) <> 0
        ORDER BY aa.code
        """,
        (company.id,),
    )
    rows = env.cr.fetchall()
    return {"accounts_with_movement": len(rows), "sample": rows[:3]}


step("M7.1 trial balance from plain SQL (no Enterprise, no AGPL module)", trial_balance)


def ar_aging():
    env.cr.execute(
        """
        SELECT am.partner_id, am.invoice_date_due, am.amount_residual
        FROM account_move am
        WHERE am.company_id = %s AND am.move_type = 'out_invoice'
          AND am.state = 'posted' AND am.amount_residual > 0
        """,
        (company.id,),
    )
    return env.cr.fetchall()


step("M7.2 outstanding receivables (AR aging base query)", ar_aging)

print()
print("=" * 70)
print("SUMMARY")
print("=" * 70)
passed = sum(1 for _, ok, _ in results if ok)
print(f"{passed}/{len(results)} measurements passed")
for label, ok, detail in results:
    print(f"  [{'ok' if ok else 'XX'}] {label}" + ("" if ok else f"  -> {detail[:120]}"))
