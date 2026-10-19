# Proposal 0005 — Option C: complete measurement evidence

| Field | Value |
| --- | --- |
| Status | **Complete — all four outstanding measurements now measured** |
| Date | 2026-10-14 |
| Author | Arena (implementation / architecture agent) |
| Reviewers | Mohamed (product owner), ChatGPT (technical strategist) |
| Scope | Finishes the measurements left outstanding by [proposal 0004](0004-option-c-results.md): M6 (Arabic documents), M8 (API ergonomics), M9 (upgrade rehearsal), M10 (per-tenant operations), plus the M1 completion case |
| Raw evidence | [`tools/spikes/option-c/`](../../../tools/spikes/option-c/) — probes 4–6 and the rendered artifacts |
| Feeds | [ADR-0008](../../adr/0008-build-vs-adopt-ledger-substrate.md) (build vs. adopt) — **a recommendation to Mohamed, not a decision taken here** |

> **Method.** Every number below is a recorded output of a script in `tools/spikes/option-c/`, run
> against a real Odoo 19.0 Community instance. Where a measurement **could not** be made, it is listed
> in §7 as unmeasured rather than estimated. One conclusion from the earlier round is *corrected* in
> §5.2, because re-examination showed the evidence did not support it.

---

## 1. Headline

| # | Measurement | Verdict |
| --- | --- | --- |
| M1 | ETA-configured invoice, end to end | **Posts cleanly.** Chain stops at the *credential* boundary, not a technical wall |
| M6 | Arabic documents | **Arabic content works; RTL is not automatic.** RTL is decided by the report/user language, and Egypt has no `ar_EG` record — generic `ar_001` only. Odoo's own PDF pipeline is unmeasurable here; an independent render proves a shaped RTL Arabic PDF is achievable |
| M8 | API ergonomics | **Adequate but untyped.** Plain JSON-RPC works; there is **no idempotency primitive** — a duplicate external reference creates a second document |
| M9 | Upgrade rehearsal 18 → 19 | **The free CLI upgrade path fails, deterministically.** The supported path is Odoo's paid Upgrade Service. This is a *cost and cadence* input to the decision, not a technical impossibility |
| M10 | Per-tenant operations | **Cheap and clean to provision, heavier to operate.** One configured tenant clones in **276 ms**; backup 428 ms; restore 2.2 s. Isolation is total because PostgreSQL cannot reference across databases |

No kill criterion from [proposal 0003](0003-option-c-spike.md) fired. What emerged instead is a
**specific cost profile**: Odoo gives real value in the regulated accounting core, and places concrete
obligations on whoever operates it.

---

## 2. M1 completion — a fully configured ETA invoice posts

Probe 4 drives the exact validation contract read from `l10n_eg_edi_eta`'s source rather than guessed.
Once the journal, branch, customer, unit-of-measure, tax and product codes are all set:

| Check | Result |
| --- | --- |
| Validation errors at post time | `[]` (was `[journal, branch, customer UoM, product barcode]`) |
| State | `posted`, `INV/2026/00001` |
| Amounts | 10,000 untaxed + 1,400 VAT (14%) = **11,400** |
| Journal entry | sum of balances **0.0** — the ledger balances |
| EDI state | `to_send` |
| `l10n_eg_submission_number` / `l10n_eg_uuid` / `l10n_eg_is_signed` | `false` / `false` / `false`, no QR |

**Interpretation.** The localization implements the Egyptian Tax Authority contract faithfully — so
faithfully that it refuses to post an incomplete invoice. What remains is credentials: a
client identifier/secret, an Egypt Trust eSeal certificate for signing, and a reachable ETA endpoint.
The ETA API and token domains are **hardcoded constants** in the module, not system parameters; only
`l10n_eg_client_identifier`, `l10n_eg_client_secret`, `l10n_eg_invoicing_threshold` and
`l10n_eg_production_env` are configurable per company.

**What this means for the decision:** live ETA submission is *not* proven (we have no credentials and
must not use anyone's), but nothing in the chain is technically blocked. It is the strongest single
argument in favour of adopting rather than building the accounting core.

---

## 3. M6 — Arabic documents

### 3.1 Content: correct. Layout: conditional.

Odoo's `account.report_invoice` QWeb report, rendered for an Arabic invoice
(`شركة النيل للمقاولات`, Arabic line text, Cairo address):

| Render | `<html lang>` | `dir="rtl"` | Arabic characters |
| --- | --- | --- | --- |
| English-language user (default) | `en-US` | **absent** | 245 |
| Report language Arabic (`ar_001`) | `ar-001` | **present** | 245 |

The Arabic *content* is present in both. The difference is layout only, and it is decided in
`addons/web/views/report_templates.xml` (lines 29, 83, 270):

```xml
<body t-att-dir="env['res.lang']._get_data(code=lang or env.user.lang).direction or 'ltr'">
```

So RTL follows the **report language, or failing that the viewing user's language** — *not* the
customer's language and not the document's content. A perfectly Arabic invoice viewed by an
English-language user renders left-to-right with Arabic text inside it. That is precisely the failure
mode the external research warned about ("menus translate but layouts break"), and it is a
**configuration requirement for the product**, not something to discover in production.

### 3.2 Egypt-specific Arabic does not exist as a language record

- Odoo 19 ships `ar_001` (generic Arabic, `direction = rtl`) and `ar_SY`. **There is no `ar_EG`.**
- `l10n_eg/i18n/ar.po` **does** ship, so Egypt-specific accounting terminology is translated.
- `res.lang` hides inactive languages by default (`active_test`); the Arabic record must be activated
  before it can be assigned.

### 3.3 Arabic reaches the data, not just the labels

| Data | Arabic present |
| --- | --- |
| `account_account.name` values containing an `ar_001` key | **208 of 209** |
| `account_journal.name` values containing an `ar_001` key | 6 |
| Field-description translations loaded | 6,328 |

Translations live in the database as **jsonb columns keyed by language code** (e.g.
`name = {"en_US": "...", "ar_001": "..."}`), which is an Odoo 18+ design — not new in 19. This is worth
knowing because it is the mechanism the upgrade path mishandles (§5).

### 3.4 Arabic PDF: proven achievable, Odoo's own pipeline unmeasured

Odoo renders report PDFs with **wkhtmltopdf**, which cannot be installed in this environment (no apt;
pango/gobject/harabuzz/cairo absent from `ldconfig`; not on PyPI). Odoo's exact PDF bytes are therefore
**not measured**, and this is the one M6 claim that must not be overstated.

What *was* proven: an independent, pypi-only toolchain produced a correctly shaped RTL Arabic PDF from
the same invoice data — PyMuPDF 1.28.2 (MuPDF shapes complex text through harfbuzz), one A5 page,
816 KB, containing **144 Arabic presentation-form characters**, which appear only when text has actually
been shaped for display. The artifact is committed as an image
([`arabic_invoice_probe.png`](../../../tools/spikes/option-c/artifacts/arabic_invoice_probe.png)) to be
looked at rather than trusted.

Two operational requirements surfaced, both real and both cheap once known:

1. **No Arabic-capable font exists on this machine** — 211 fonts scanned, zero with Arabic coverage.
   Arabic output requires provisioning a font (two were fetched and glyph-verified: Noto Naskh Arabic,
   253 Arabic cmap entries; Noto Sans Arabic, 255).
2. **A font pair is required, not a font.** Noto Naskh Arabic has no Latin punctuation: the em dash in
   the invoice line text renders as a missing-glyph box in the artifact. Bilingual documents need fonts
   with overlapping coverage.

> **Consolidation review note (2026-10-14).** The committed PNG shows correct Arabic *shaping* and
> in-line ordering, but its *page layout is left-to-right*: paragraphs are left-aligned and the table's
> first column (`البند`) sits on the left. It demonstrates shaping, not an RTL document layout. See
> [ADR-0008 §10, C4](../../adr/0008-build-vs-adopt-ledger-substrate.md).

---

## 4. M8 — API ergonomics

Plain `fetch` against Odoo's JSON-RPC endpoint, no SDK:

| Step | Result |
| --- | --- |
| `common.version` | 200, 62 ms |
| `common.login(db, user, password)` | uid 2, 508 ms |
| `create` partner | 611 ms |
| Invoice create + read | OK (draft, EGP) |
| Whole probe | 2,117 ms |

The decisive negative: **there is no idempotency primitive.** Sending two documents with an identical
external reference produced **two documents** (ids 3 and 4). Errors arrive as JSON-RPC error objects.

**Interpretation.** The API is usable and the latency is acceptable for interactive work. But it is
untyped JSON with no schema, no types and no codegen, and no deduplication guarantee. Any integration
must own validation, idempotency keys, mapping and error translation itself — which is exactly the job
of the `LedgerProvider` port already proposed, and an argument for keeping that boundary thick rather
than thin.

---

## 5. M9 — upgrade rehearsal, Odoo 18 → 19

The question a product owner actually asks: *when Odoo releases 19 (or 20), what does upgrading cost us?*

### 5.1 The measurement

A clean Odoo 18.0 database (`base`, `account`, `l10n_eg`; 45 modules installed; financial data seeded:
a posted invoice of 28,500, a payment of 10,000, residual 18,500, `payment_state = partial`, ledger sum
0.0) was upgraded with the free CLI path — `odoo19/odoo-bin -u all` — with no custom modules involved.

**It fails, reproducibly:**

```
psycopg2.errors.InvalidTextRepresentation: invalid input syntax for type json
DETAIL:  Token "base" is invalid.
CONTEXT: JSON data, line 1: base
  File "odoo19/odoo/orm/fields.py", line 1146, in _convert_db_column
    sql.convert_column(model.env.cr, model._table, self.name, self.column_type[1])
query: ALTER TABLE "ir_model" ALTER COLUMN "state" DROP DEFAULT,
       ALTER COLUMN "state" TYPE jsonb USING "state"::jsonb
```

All modules remain at 18.0.x, zero at 19.0.x, and the process aborts. `ir_model.state` holds 351 rows
of the selection value `'base'`, which is not valid JSON.

### 5.2 Why — and a correction to the previous round

An earlier attempt appeared to show a *second*, independent failure (a boolean column cast to jsonb).
**That evidence does not hold**: the run was performed against a database I had already hand-modified,
and the modification corrupted field metadata (`ttype` became `{"1": "selection"}`), which is enough to
mislead the ORM. It is recorded here as invalidated rather than as a finding.

The instrumented re-run on a **pristine** 18 database gives the actual cause:

| Observation | Value |
| --- | --- |
| `ir.model.state` as the 19 ORM sees it **on an 18 DB** | `translate=True` → `column_type = jsonb` |
| The same field **on a fresh 19 DB** | `translate=False` → `column_type = varchar` |
| What a fresh 19 database actually has | `ir_model.state character varying`, `ir_model.transient boolean` |
| `ir.model.state`'s own metadata row in the 18 DB | `translate = false` |

Two things follow. First, the jsonb target is **not** Odoo 19's intended schema — an upgraded database
would end up with a *different* column type from a freshly installed one. Second, Odoo 19 *knows* how to
convert a genuinely translated column correctly; in the same run it emitted the proper form for the
fields that are translated:

```sql
ALTER TABLE "ir_model" ALTER COLUMN "model" TYPE jsonb
  USING CASE WHEN "model" IS NOT NULL THEN jsonb_build_object('en_US', "model"::varchar) END
```

`ir_model.state` got the naive `"state"::jsonb` instead. So this is a specific defect in the free
upgrade path, not a general inability to migrate.

### 5.3 The structural fact behind it

**The free Odoo source ships no data migration scripts.** `odoo/addons/base/migrations/` does not
exist — the 18→19 conversion logic lives in the proprietary **Odoo Upgrade Service**. The free CLI path
only knows what `_auto_init` can infer, which is exactly why one column gets converted properly and the
next one does not.

**Verdict.** 18 → 19 is **not a self-serve free operation**. Any Odoo-based plan must budget the
official Upgrade Service, and — because Odoo charges a **25% licence surcharge when four or more
releases behind** — must pick an upgrade cadence deliberately rather than drifting. This does not
disqualify Odoo; it prices it.

---

## 6. M10 — per-tenant operations

The tenancy question for Odoo is not "how do we filter rows?" but "how do we run N databases?".
Measured on this machine (PostgreSQL 16.2, one configured Egyptian company with a 209-account chart):

| Operation | Result |
| --- | --- |
| Provision a new tenant from a configured template (`CREATE DATABASE … TEMPLATE`) | **276 ms** |
| Resulting tenant size | 44 MB |
| Is the clone a *working* ledger? | Yes — 209 accounts, 14% VAT taxes, 2 invoice moves, immediately |
| `pg_dump` (custom format) | **428 ms**, 3.5 MB |
| `pg_restore` into a new database | **2,179 ms** |
| Restored ledger verified | 209 accounts, 2 moves — intact |
| Cross-tenant data access | **Impossible by construction** — PostgreSQL cannot reference another database |

**Interpretation.** Per-tenant provisioning and restore are *fast* — seconds, not minutes — which makes
"one database per tenant" genuinely viable for a modest number of tenants. And isolation is stronger
than row-level security: separate databases cannot leak into each other, and a restore is a whole-tenant
operation with no tenant-filter bug possible.

The cost is operational, not technical: N databases to back up, monitor and upgrade in step — every
upgrade (§5) multiplies by the tenant count. Multi-database mode also requires deliberate
`--db-filter` / `--no-database-list` configuration to avoid exposing a database selector. At the
opposite end, the Nile engines' current design (single database, `FORCE` row-level security, fail-closed)
scales to many tenants on one database but has to *earn* its isolation — and the review found the RLS is
correctly fail-closed yet unused and unauthenticated so far.

**This is a real architectural fork, and it is not yet decided.** Per-tenant databases suit a small
number of high-value tenants; a single RLS database suits many small ones. Mohamed's stated position —
*build tenant-aware by default so neither path closes* — remains the right posture here.

---

## 7. What is NOT measured

Stated plainly, because the value of the rest depends on it:

| Unmeasured | Why | Consequence |
| --- | --- | --- |
| Live ETA submission | No credentials, no eSeal certificate, and using anyone's would be wrong | The last mile is *unproven*, though nothing measured blocks it |
| Odoo's actual PDF bytes | wkhtmltopdf cannot be installed here | M6 proves Arabic *rendering* is achievable, not that Odoo's pipeline produces it correctly |
| ERPNext or any other platform | Out of scope for this round | **The decision cannot be made as Odoo-vs-nothing** — see ADR-0008 §4 |
| Attachment/file MIME handling | `libmagic` is absent; a stub stands in | Attachment behaviour here is not representative |
| Concurrency and scale | Single-user shell and one HTTP session | Latency figures are single-request, not load tests |
| Multi-tenant operation beyond 2 tenants | Only `spike19`, `up18`, `tenant_b` exist | Provisioning cost is measured; fleet operation is inferred, not measured |

---

## 8. What this evidence says about adoption

Read together, the four measurements do not produce "adopt Odoo" or "don't". They produce a shape:

**Odoo is strong exactly where building would be most expensive and most dangerous.**
The Egyptian chart of accounts (209 accounts, 14% VAT), the ETA validation contract, posting, partial
payments, reversal-only correction and the Arabic data translations are all real, working, and would
each be months of work to replicate correctly — with ETA compliance being a *moving legal target*, not a
one-time build.

**Odoo is weak exactly where a product must differentiate.**
RTL is configurational and conditional; there is no `ar_EG`; the API is untyped with no idempotency; the
document layer needs work; and each tenant is a database whose upgrades cost money.

That asymmetry points at a **narrow adoption behind a port**, not at either extreme, and it must be
compared against at least one alternative platform before it is locked. The reasoning, the criteria and
the explicit conditions are in [ADR-0008](../../adr/0008-build-vs-adopt-ledger-substrate.md).

---

## 9. Reproduction

```
tools/spikes/option-c/probe-4-eta-configured-invoice.py   # M1 completion
tools/spikes/option-c/probe-5-api-ergonomics.mjs          # M8
tools/spikes/option-c/probe-6-arabic-report.py            # M6, part 1 (run inside odoo shell)
tools/spikes/option-c/probe-6-arabic-pdf.py               # M6, part 2 (standalone)
tools/spikes/option-c/artifacts/                          # rendered evidence
```

Environment, module list and the shell invocation are recorded in
[`tools/spikes/option-c/README.md`](../../../tools/spikes/option-c/README.md). The upgrade rehearsal
(M9) was run with `odoo19/odoo-bin -u all` against a clean 18.0 database; the instrumented diagnostic is
described in §5.2 and deliberately **not** re-run as a machine-readable probe, because the outcome is
already conclusive and the free path must not be presented as viable.
