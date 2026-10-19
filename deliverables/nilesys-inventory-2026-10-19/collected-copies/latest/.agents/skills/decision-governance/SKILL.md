---
name: decision-governance
description: Read, respect, and change the repository's accepted architecture decisions. Use whenever a task touches architecture, dependencies, database schema, module boundaries, permissions, or security; whenever a request would contradict an accepted ADR or architectural invariant; and whenever a consequential choice is unresolved and must be surfaced rather than silently selected.
---

# Decision Governance

Applies the repository's decision rules. The rules live in `AGENTS.md`
(precedence, immutability, surface-don't-choose); the decisions live in
`docs/DECISIONS.md` (index) and `docs/adr/*` (records). This skill is the
procedure for interacting with them — it is not a second source of
architectural truth.

## Use when

- Starting a task that touches architecture, dependencies, database schema,
  module boundaries, permissions, or security.
- A request (including an explicit user request) would change or contradict an
  accepted decision or an architectural invariant.
- A consequential choice is unresolved and must be made.

## Do NOT use when

- The task is a trivial, decision-free edit (typo, formatting, or a fully
  specified small change that touches no accepted decision).

## Required inputs

- The task or request as stated.
- `docs/DECISIONS.md`, plus any ADR whose subject the task touches.

## Workflow

1. Read `docs/DECISIONS.md`; then read every ADR relevant to the task.
2. Check the task against the accepted decisions. A conflict exists when the
   task would change a decided outcome, violate a stated invariant (for
   example a dependency/boundary rule in ADR-0001), or re-decide an
   already-decided topic.
3. No conflict → proceed; cite the ADRs that apply in your plan.
4. Conflict with an accepted ADR or invariant → STOP and surface it: state the
   conflict, the specific ADR/invariant, and the options — (a) comply with the
   request and supersede via a new ADR, or (b) do not proceed. Never edit the
   accepted ADR and never break the architecture silently.
5. Unresolved consequential choice → STOP and surface it with the trade-offs
   and a recommendation; wait for a decision. Do not silently pick.
6. Approved consequential change → draft a superseding ADR in `docs/adr/`
   following the existing format. Declare `Supersedes: ADR-XXXX` in the new
   ADR. Update `docs/DECISIONS.md` so the index reflects the superseded status
   and link. Leave the superseded ADR file byte-for-byte unchanged — accepted
   ADRs are never edited, not even to add a status marker. (If metadata-only
   edits to accepted ADRs ever become desirable, that must first be an
   explicit governance decision — do not introduce the exception through this
   skill.)

## Required evidence / output

- The list of ADRs consulted, or a surfaced conflict / decision request as
  above.
- For a new ADR: the new record file with its `Supersedes` field, and the
  updated `docs/DECISIONS.md` index.

## Exit criteria

- Every applicable accepted decision is respected, or every conflict and
  unresolved choice has been surfaced and is awaiting a decision.

## Common failure modes

- Treating this skill or AGENTS.md as the source of truth instead of the ADRs
  themselves.
- Editing an accepted ADR in place instead of writing a superseding one.
- Silently "reinterpreting" a decision to make the task fit.

## References

- `docs/DECISIONS.md` and `docs/adr/*` — the decisions (source of truth).
- `AGENTS.md` — precedence and immutability rules.
- Sources and licensing: `docs/agent-system/REFERENCES.md`.
