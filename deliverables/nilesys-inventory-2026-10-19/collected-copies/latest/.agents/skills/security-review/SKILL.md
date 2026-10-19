---
name: security-review
description: Perform repository-grounded security review for changes that touch authentication, authorization, organization or tenant context, PostgreSQL RLS, secrets, untrusted input, external integrations, sensitive data, or other trust boundaries. Also use when an explicit security audit or threat review is requested. Identify realistic abuse paths and verify existing controls; do not replace general code review or duplicate accepted security policy from ADRs.
---

# Security Review

Review the security properties of the actual change and repository, not a
generic checklist.

**Core principle:** prove realistic abuse paths and controls at concrete trust
boundaries.

## Use when

- Authentication, sessions, organization membership, permissions, tenant
  context, or RLS are touched.
- A change handles secrets, credentials, sensitive business data, untrusted
  input, file/parser boundaries, or external services.
- A migration or raw SQL path can affect isolation or data integrity.
- A new network/API boundary or privileged operation is introduced.
- A security review, threat model, or secure-by-default implementation is
  explicitly requested.

## Do NOT use when

- A general code review has no security-relevant surface.
- The task is a trivial edit with no trust, data, or privilege boundary.

## Required inputs

- The diff/plan and its requirements.
- Relevant accepted ADRs via `decision-governance`.
- Current upstream security/API behavior via `source-driven-development`
  whenever a control depends on a framework, library, database, or protocol.

## Workflow

1. **Scope the security surface.** Identify the changed components, entry
   points, data stores, external integrations, and privileged operations.
2. **Map the relevant trust boundary.** State the asset being protected, who can
   supply input, what identity/authority crosses the boundary, and what control
   is expected to enforce it.
3. **Select only applicable review lenses:**
   - authentication and session handling;
   - authorization, organization membership, tenant isolation, and RLS;
   - validation/parsing/injection boundaries;
   - secrets and configuration;
   - database integrity, migrations, raw SQL, and transaction context;
   - API response/error/log data exposure;
   - external integrations and dependency trust.
4. **Trace realistic abuse paths.** For each candidate issue, establish
   reachability, attacker capability, the missing/bypassed control, and concrete
   impact. Do not report purely theoretical weakness without a plausible path.
5. **Apply repository security policy from the ADRs.** For tenant-owned data,
   derive the required fail-closed and cross-tenant tests from ADR-0002,
   ADR-0004, and ADR-0005 rather than importing provider-specific assumptions.
   The runtime-role and tenant-context invariants in those ADRs are
   authoritative.
6. **Escalate architectural security gaps.** A new trust model, auth mechanism,
   tenant model, or security-boundary change is consequential and goes through
   `decision-governance`.
7. **Classify findings by impact and exploitability:**
   - **Critical** — credible auth/authorization bypass, cross-tenant data access,
     severe secret exposure, arbitrary code/command execution, destructive data
     integrity failure, or equivalent catastrophic impact.
   - **Important** — exploitable weakness with meaningful confidentiality,
     integrity, or availability impact, or a missing defense required by an ADR.
   - **Minor** — hardening opportunity with limited realistic impact.
8. **Report before fixing.** Record findings first. Do not silently mutate the
   change during the review pass. If the task includes remediation, fix one
   finding at a time through `test-driven-development`, then re-run the
   relevant security review.
9. **For a new or materially changed trust boundary, run a compact threat-model
   pass:** assets → boundary → attacker capability → abuse path → existing
   control → mitigation/test.

## Required evidence / output

For each finding:

- location/surface;
- severity and confidence;
- realistic abuse path;
- concrete impact;
- evidence for the existing or missing control;
- specific mitigation and the test that would prove it.

Also record which security lenses were applied and which were not applicable.

## Exit criteria

- Every applicable trust boundary in the change has been reviewed.
- Critical findings are fixed before readiness.
- Important findings follow the deferral rule in `code-review`.
- Security-sensitive completion claims are backed by fresh tests/evidence via
  `verification-before-completion`.

## Common failure modes

- Generic OWASP-style findings with no reachable path.
- Treating authentication as authorization.
- Assuming application query filters are equivalent to database-enforced tenant
  isolation.
- Testing RLS with a database role that bypasses the production boundary.
- Copying Supabase-, Next.js-, or JWT-specific advice into a different accepted
  architecture.
- Mixing review and remediation so findings disappear without an auditable
  review step.

## References

- `decision-governance` — accepted security architecture is authoritative.
- `source-driven-development` — verify current upstream security behavior.
- `code-review` — general review and severity/deferral workflow.
- `test-driven-development` — regression/fail-closed tests for remediation.
- `verification-before-completion` — final evidence gate.
- Sources and licensing: `docs/agent-system/REFERENCES.md`.
