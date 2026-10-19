---
name: verification-before-completion
description: Use before claiming any work is complete, fixed, or passing. Run the verification commands and confirm fresh output before making any success claim; evidence before assertions, always.
---

# Verification Before Completion

**Core principle:** evidence before claims, always. No completion claim without
fresh verification evidence.

## The gate — applicability-aware

Before claiming any status:

1. **IDENTIFY** which checks actually prove this claim (see categories below).
2. For each APPLICABLE check, **RUN** the full command now (fresh, complete).
   For NOT APPLICABLE, record "N/A" and why. For REQUIRED BUT UNAVAILABLE,
   report the missing capability — do not invent a passing result.
3. **READ** the output; check the exit code and failure counts.
4. **VERIFY** the output confirms the claim. If not, state the actual status.
5. Only then make the claim, citing the output.

## Definition of Done — applicability-aware evidence

The invariant is fixed: **every completion claim must be backed by fresh
evidence appropriate to that claim.** Which checks apply depends on the
change. For each standard category, classify it:

- **APPLICABLE** — run it fresh now and record the result.
- **NOT APPLICABLE** — explicitly record "N/A" and why.
- **REQUIRED BUT UNAVAILABLE** — the check is needed but the tooling does not
  exist yet (for example no lint/typecheck/build pipeline before the
  scaffold). Do not silently pass; report the missing capability and do not
  claim that category is verified.

Typical categories by change type:

- **Code change** — tests, lint, typecheck, build, relevant
  integration/permission/tenant checks, requirement-by-requirement.
- **Skill change** — structural validation (the `skills-ref` reference
  implementation or a recorded-equivalent validator), frontmatter/trigger
  checks, a behavioral canary, cross-reference checks,
  requirement-by-requirement.
- **Documentation-only change** — content and requirement review, link/path
  validation where relevant, format-specific validation where available.

In every case:

- [ ] Each category is classified APPLICABLE / NOT APPLICABLE / REQUIRED BUT
      UNAVAILABLE, with a one-line reason.
- [ ] Every APPLICABLE check was run fresh and its result recorded.
- [ ] Every REQUIRED BUT UNAVAILABLE capability is reported as a gap, not
      passed silently.
- [ ] Requirement-by-requirement: each requested item is verified against
      fresh evidence, or explicitly reported as not done.
- [ ] Fresh output: every claim cites output produced in this session, not a
      remembered or earlier run.

## Common failures

| Claim | Requires fresh output of |
|---|---|
| Tests pass | the test command, 0 failures |
| Lint clean | the lint command, 0 errors |
| Build succeeds | the build command, exit 0 |
| Bug fixed | the original symptom reproduced, then passing |
| Requirements met | item-by-item verification |

## Red flags — STOP and run the command

- "should", "probably", "seems to", or expressing success before verifying.
- Trusting a previous run or an agent's success report as evidence.

## References

- `code-review` — review quality first, then apply this gate before claiming
  done.
- `AGENTS.md` — evidence-before-completion rule; this skill is the canonical
  Definition of Done.
- Sources and licensing: `docs/agent-system/REFERENCES.md`.
