# Proposal 0006 — Ledger decision memo

| Field | Value |
| --- | --- |
| Status | **Proposed**. D1 was decided on 2026-10-14 ([ADR-0010](../../adr/0010-engines-continue-behind-ledger-provider-port.md)); D2–D4 remain open. The memo itself decides nothing |
| Date | 2026-10-14 |
| Question | [ADR-0008](../../adr/0008-build-vs-adopt-ledger-substrate.md) (build vs. adopt the regulated core) |
| Evidence | [index and provenance](../README.md); [proposal 0005](0005-option-c-evidence.md) |
| Labels | **Fact** = measured with a committed script or artifact. **Reported** = measured, no script. **Hypothesis** = unproven. **Recommendation** = an opinion, not a decision |

## 0. Summary

Odoo remains a **viable but unproven** candidate for Nile's accounting and tax core. Nothing measured
rules it out. Two things that matter most commercially have not been shown: live submission to the
Egyptian Tax Authority, and a correctly laid out Arabic PDF from Odoo itself. The tax regime that governs
a cashier, B2C **e-receipts**, was not in scope at all. ERPNext has never been measured.

Nile's own engines (tenancy, auth, catalog, sales, booking) **do not depend on this choice**, provided
Nile owns the operational records and talks to any ledger through a narrow port. The owner needs to make
four decisions (§9). None of them blocks current engine work.

## 1. Odoo viability

| Area | What is known | Label | Remaining risk |
| --- | --- | --- | --- |
| ETA e-invoice (B2B) | Configured invoice posts with 0 validation errors; entry balances (11,400) | Fact | Signing, preproduction and production never reached. Needs a real taxpayer, an eSeal and credentials |
| ETA e-receipt (B2C, POS) | Egypt runs a separate, phased, mandatory e-receipt system for consumer sales, submitted from an integrated POS or ERP. Odoo's code has an `l10n_eg_edi_pos` module for it | External sources; not measured | High for Nile's cashier: the most relevant regime is entirely unmeasured |
| Arabic PDF / RTL | HTML report direction follows the language (`ar_001`). The independent PDF shapes Arabic but lays the page out left-to-right. Odoo's own PDF was never produced | Fact (HTML); Hypothesis (PDF) | Medium. Mitigation: Nile renders customer-facing documents from its own data (see §4). ETA submissions are JSON, not PDF |
| API idempotency | None: a duplicate create gives a duplicate document | Fact | Must be supplied by Nile (outbox + idempotency key + reconciliation, §4) |
| Upgrades | Free 18→19 path failed; paid service needed; vendor surcharge if far behind | Reported | A recurring cost and a scheduled operational task per tenant database |
| Tenant operations | Clone / dump / restore well under 3 s each, on 2 tenants | Reported | Fleet operations (tens or hundreds of databases, monitoring, upgrades) unmeasured |
| Licence | Community edition is LGPL-3. Financial reports need Enterprise or a third-party module (MIS Builder is AGPL-3) | Fact (licence texts) | §6 |

## 2. ERPNext: known and unknown

- **Known (desk research, proposal 0002, not verified by measurement):** ERPNext is GPL-3 and runs on the
  MIT-licensed Frappe framework. It supports Arabic and RTL, and ETA integration exists through
  third-party apps.
- **Unknown:** every measurement made for Odoo: ETA validation, Arabic document layout, API idempotency,
  upgrade cost and per-tenant operations. No ERPNext probe exists. **ERPNext has not been benchmarked, and
  no comparative claim about it should be made.**

## 3. Ledger boundary (Recommendation)

Nile owns the **operational subledger**: sales, tenders and payments, refunds, cash-drawer movements,
stock movements and bookings. These records are committed in Nile's own database, under its tenant
isolation and append-only rules (PR #4), and they are the operational source of truth.

A ledger provider (Odoo, ERPNext, or a Nile-built general ledger) owns the **general ledger**: chart of
accounts, double-entry journals, tax returns, statutory reports and ETA document submission.

Rules at the boundary:

1. A sale is a fact once Nile commits it. A provider outage or ETA rejection never rolls the sale back.
   It surfaces as a posting status that needs attention.
2. Corrections are reversals (refund, credit note), never edits. That matches both PR #4's append-only
   ledger and Odoo's posted-entry model.
3. Money crosses the port as integer minor units with an explicit currency (EGP). Converting to and
   rounding for the provider happen inside the adapter, and so does reconciling any rounding difference.
4. No provider types, IDs or field names leak past the adapter. Nile stores the provider reference as an
   opaque string.

### 3.1 `LedgerProvider` contract (sketch, not implemented)

```ts
interface LedgerProvider {
  readonly capabilities: {
    etaEInvoice: boolean;
    etaEReceipt: boolean;
    financialReports: boolean;
  };
  // All commands are idempotent by `idempotencyKey`; repeating one returns the original result.
  postSale(cmd: PostSaleCommand): Promise<PostingResult>;
  postPayment(cmd: PostPaymentCommand): Promise<PostingResult>;
  postReversal(cmd: PostReversalCommand): Promise<PostingResult>;
  submitTaxDocument(cmd: SubmitTaxDocumentCommand): Promise<SubmissionResult>; // ETA e-invoice / e-receipt
  getStatus(ref: ProviderRef): Promise<PostingStatus>;
}

interface PostSaleCommand {
  idempotencyKey: string; // = Nile outbox row id
  tenantId: string;
  occurredAt: string; // ISO-8601
  currency: 'EGP';
  lines: Array<{
    itemCode: string;
    quantity: string;
    unitCode: string;
    netMinor: bigint;
    taxes: Array<{ code: string; amountMinor: bigint }>;
  }>;
  party?: { name: string; taxId?: string };
}

type PostingState = 'pending' | 'posted' | 'submitted' | 'accepted' | 'rejected' | 'failed';
```

Delivery is a transactional **outbox**. The sale (or payment) and an outbox row are written in the same
database transaction. A worker delivers outbox rows to the provider one tenant at a time, in order. For
providers without native idempotency (Odoo, per F2), the adapter writes the idempotency key into the
document reference and checks for it before creating. That check is safe only because the worker
serializes per tenant. A reconciliation job compares Nile's records with the provider's.

## 4. Documents and printing (Recommendation)

Customer-facing receipts and invoices should be rendered by Nile from its own records, in Arabic and RTL
per ADR-0009. The ETA QR code or UUID is added once the provider returns it. This takes Odoo's unproven
RTL PDF off the critical path for the cashier. The provider's own PDFs would then only be needed for
back-office accounting.

## 5. Tenant topology and operational isolation

- **Decided for Nile (Fact):** one shared PostgreSQL database with row-level security (ADR-0002,
  ADR-0005). This choice does not change.
- **External ledger (open):**
  - (a) one provider database per tenant: isolation by construction, provisioning measured, operational
    cost grows with each tenant;
  - (b) one provider database, multi-company: unmeasured, and isolation depends on the provider's record
    rules;
  - (c) a provider only for tenants that need statutory accounting, with others staying on Nile's
    subledger alone.
- **In every option (Recommendation):**
  - a Nile table maps each tenant to its provider instance and company, with credentials referenced from
    a secret store, never stored in plain text;
  - each tenant's outbox queue is separate, so one failing tenant cannot block others.

## 6. Financial reporting and licensing

- **Operational reports** (sales by day, cashier shift, stock, bookings) come from Nile's data, so they
  are independent of the ledger choice.
- **Statutory financial statements** come from the ledger. With Odoo Community that means one of:
  - Enterprise licences, a per-user recurring cost;
  - MIS Builder (AGPL-3): obligations attach to the Odoo deployment that runs it. Nile's code, talking to
    it over an API, is a separate program, but this must be **confirmed by a lawyer before sale**;
  - reports built by Nile from the ledger's read API.
- This memo is not legal advice.

## 7. ETA credentials, certificates and live submission

- **Each Nile customer is the taxpayer.** It registers with ETA and owns its API client credentials and
  signing certificate. Signing uses a USB token or HSM from ETA or Egypt Trust, issued per signer.
- **Responsibility to decide (§9 D3):**
  - who holds the credentials (the customer, or Nile on the customer's behalf);
  - where signing happens (a device at the customer's site, or Nile-hosted signing);
  - who is accountable for a failed or late submission.
- Live submission must go through ETA's **preproduction** environment first, using a consenting
  taxpayer's own credentials under a written agreement. No agent or developer may use anyone's
  credentials informally. Real credentials are never committed to the repository.

## 8. Impact on Nile engines and sales

- **No change** to tenancy, auth, RLS, catalog, booking or the sale engine.
- **Payment engine:** provider-independent and Nile-owned. It records tenders, change, refunds and the
  cash drawer, and makes each completed sale with its payments one postable unit. Design only until PR #4
  merges (see the separate payment-engine design handoff).
- **Catalog data that ETA requires later:**
  - an item code (GS1 or EGS) per sellable item;
  - a unit code per item;
  - a tax code per line;
  - branch and activity codes per tenant.

  These are additive schema changes, not needed now. They should be planned so the catalog does not have
  to be reworked later.
- **Cashier UI:** stays blocked until payment integrity and the gate pass. The B2C e-receipt question
  (§1) must be answered before a cashier is sold to customers who fall under the mandate.

## 9. Owner decisions (minimal set)

| # | Decision | Options | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| D1 | Does engine work continue while ADR-0008 is open? ADR-0008 says "no application code until reviewed"; the later engines-first direction and PRs #1–#3 did the opposite | (a) continue engines, ledger stays behind the port; (b) pause all code | **DECIDED 2026-10-14: (a)**, approved by the owner and recorded as [ADR-0010](../../adr/0010-engines-continue-behind-ledger-provider-port.md) | The payment engine, after PR #4 |
| D2 | Is one measured candidate enough to choose? | (a) choose from Odoo's evidence; (b) time-box an ERPNext measurement with the same probes first | (b), with a fixed time box | Ratifying ADR-0008 |
| D3 | Who owns ETA credentials and signing, and will a real taxpayer run a paid preproduction pilot (e-invoice **and** e-receipt)? | Customer-held / Nile-operated / mixed; pilot yes or no, and which business | Customer holds credentials and signing device; Nile operates the integration; one consenting pilot business | Any live-tax claim in sales material |
| D4 | Budget and licence posture for the ledger | Accept recurring upgrade cost; reporting via Enterprise, MIS Builder (legal review) or built by Nile | Decide after the pilot; get a legal opinion before choosing MIS Builder | Commercial launch with accounting |

Technical choices (outbox, port shape, rendering, topology mechanics) are left to engineering, as the
owner has delegated them.
