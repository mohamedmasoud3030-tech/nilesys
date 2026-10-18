# Option C spike — results

| Field | Value |
| --- | --- |
| Status | **Complete — all measurements finished; see proposal 0005 for results** |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture agent) |
| Spike plan | [`../../../docs/architecture/proposals/0003-option-c-spike.md`](../../../docs/architecture/proposals/0003-option-c-spike.md) |
| First-pass results | [`../../../docs/architecture/proposals/0004-option-c-results.md`](../../../docs/architecture/proposals/0004-option-c-results.md) |
| Final measurements | [`../../../docs/architecture/proposals/0005-option-c-evidence.md`](../../../docs/architecture/proposals/0005-option-c-evidence.md) |

## What this directory is

Throwaway **evidence-gathering** scripts, not application code and not a deliverable. They were run
against a real Odoo Community instance to measure behaviour instead of asserting it, and they are kept
here so every claim in the results document can be reproduced or challenged.

They are deliberately excluded from any build, test, or lint pipeline. If the Option C direction is
rejected, this directory should be deleted along with the rest of the spike.

## Environment used

| Component | Version / note |
| --- | --- |
| Odoo | **19.0 Community**, cloned from `github.com/odoo/odoo` branch `19.0` (LGPL-3) |
| Python | 3.11.2 — Odoo **20.0 requires Python ≥ 3.12**, so 19.0 was used |
| PostgreSQL | 16.2, bundled via the `pgserver` PyPI package (no contributors available; `pg_trgm` absent, which affects website fuzzy search only, not the ledger) |
| Modules installed | `base`, `account`, `l10n_eg`, `l10n_eg_edi_eta` — Community only, no Enterprise licence |
| Localization setup | Company country set to **EG before** accounting was installed, so the Egyptian chart of accounts and VAT taxes loaded correctly |

## Reproducing

```bash
# inside the Odoo source checkout, with the database and company configured for Egypt
odoo-bin shell -d spike_eg --db_host=<host> --db_user=<user> --db_password=<pw> \
  --log-level=error --no-http < probe-3-eta-configuration.py
```

Probes are ordered: `probe-1` (initial, US chart — kept because its duplicate-reference result is
valid), `probe-2` (Egyptian localization applied correctly), `probe-3` (ETA configuration surface,
`probe-4` (a fully ETA-configured invoice posts), `probe-5` (JSON-RPC API ergonomics),
`probe-6` (Arabic documents, in two parts — see `artifacts/`),
payment allocation, period locking, SQL reporting).

## Known limitations

- ~~No `wkhtmltopdf` in the environment, so PDF rendering (measurement M6) could not be tested at all.~~
  *Superseded:* Odoo's own PDF bytes remain unmeasured, but its HTML report direction was measured and an
  independent PDF was rendered (proposal 0005 §3; see the layout caveat in ADR-0008 §10, C4).
- No ETA API credentials, so live submission to the Egyptian Tax Authority was never attempted —
  only the presence and enforcement of the integration's checks could be verified.
- ~~Posting a fully ETA-configured invoice was **not achieved**; the required configuration surface was
  identified but not completed within the spike.~~ *Superseded:* probe 4 posts a fully configured invoice
  with zero validation errors (proposal 0005 §2).
- The probes use undocumented Odoo internals (ORM field names, raw SQL). They are evidence, not a
  supported interface.
- M9 (upgrade 18 → 19) and M10 (per-tenant operations) have **no committed probe script**; their results in
  proposal 0005 §5–§6 are recorded observations.
- Credentials in the probes (`admin`/`admin`, `odoo`/`odoo`) are defaults of a throwaway local spike
  instance reached on `127.0.0.1` or a Unix socket. They are not real credentials and must never be reused.

