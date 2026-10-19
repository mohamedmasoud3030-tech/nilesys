# Repository publication audit before cloud-agent handoff (2026-10-14)

- **Status:** review / verification record (tier 5). Current state lives in `docs/STATUS.md`.
- **Scope:** all local work of the coordinating agent for `mohamedmasoud3030-tech/Mohamed-App-Factory`: branches,
  commits, worktrees, untracked files, stashes, handoff bundles and reports, evidence folders.
- **Written before pushing.** Whether each branch below reached GitHub must be checked with `git ls-remote origin`;
  this file cannot record its own publication.

## 1. Remote state (verified 2026-10-14 19:38:45 UTC, `git ls-remote` and GitHub API)

| Ref | SHA |
| --- | --- |
| `main` (= `HEAD`) | `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` |
| PR #4 `fix/nile-gate-ledger-append-only-demo-lock` | `784e50cb085f6d7d23c018cc5e9183746ff8109b`: open, not merged, 0 reviews |
| `arena/01a06b01-mohamed-app-factory` | `e74167b08808e240cf19e7ee4f50b0bf8d8f9a6b` |
| `arena/bfcb5ed1-mohamed-app-factory` | `e61cd06ea8a8a3b974c81627b692c23549355a3d` |
| `feat/nile-engines-v1`, `feat/nile-engines-wave2-db`, `feat/nile-e2e-auth-sale` | `3916924…`, `949228f…`, `b602a57…` (PRs #1–#3, merged) |

No `docs/*`, `investigation/*` or `handoff/*` branch existed on the remote.

## 2. Local inventory

| Local branch | SHA | Contained in a remote ref? | Action |
| --- | --- | --- | --- |
| `main` | `ebcfe72` | yes | none |
| `fix/nile-gate-ledger-append-only-demo-lock` | `784e50c` | yes (PR #4) | none |
| `arena/01a06b01-…`, `feat/*` (3) | as remote | yes | none |
| `arena/bfcb5ed1-…` | `0ce506f` | yes (ancestor of remote `e61cd06`, 3 behind) | none |
| `docs/consolidate-option-c-evidence` | `ce6f328` | no, but an ancestor of `84d8044` | published through the docs branch |
| `docs/source-of-truth-cleanup` | `84d8044` → new `a71284f` | no | publish under the same name |
| `fix/g7-runtime-role-assertion` | `60342be` | no | publish the same commit as `investigation/g7-runtime-role-boundary-incomplete`; keep the local name |
| `handoff/2026-10-14-evidence` (new) | on top of `a71284f` | no | publish (this file is on it) |

Other local state: 0 stashes; all worktrees clean except untracked scratch (§5). `git log --all --not <every remote SHA>`
lists only the docs chain (`d81cf97`…`84d8044`) and the G-7 chain (`420c203`, `60342be`).

## 3. Documentation consistency

| Path | `ebcfe72` | `784e50c` | `84d8044` | `60342be` |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | `6dc2d886` | same | `0639f830` | same as main |
| `README.md` | `3f4afb5b` | same | `5ecd3b5c` | same as main |
| `docs/README.md` | absent | absent | `3d633dbb` | absent |
| `docs/STATUS.md` | absent | absent | `662abce0` | absent |
| `docs/DECISIONS.md` | `34c51f7f` | same | `26151cb5` | same as main |
| `docs/ARCHITECTURE.md` | absent | absent | `8e96457a` | absent |

Findings and resolution:

| # | Finding | Resolution |
| --- | --- | --- |
| D1 | `main`'s ADR index lacks ADR-0007 (the file exists) | Fixed on the docs branch (`84d8044`); reaches `main` only if that branch is merged |
| D2 | `84d8044` STATUS said G-7 was "FIXED ON BRANCH" although the adversarial review says REVISE | Corrected in `a71284f` (new finding G-7a, High) |
| D3 | `84d8044` STATUS said "see its PR" for a docs PR that does not exist | Corrected in `a71284f` |
| D4 | Hosting decision not recorded | Added as D5 (UNRESOLVED) in `a71284f` |
| D5 | `.gitignore` did not cover `.env`, scratch or probe folders | Added in `a71284f` |
| D6 | Draft PR text for G-7 presents the candidate as a fix | Archived and labelled STALE (`docs/archive/agent-reports-2026-10-14/`) |
| D7 | No CI workflow | Open (STATUS task 6) |

Checks that passed: relative links 11 / 11 / 11 / 146 checked on `ebcfe72` / `784e50c` / `60342be` / `84d8044`, 0 broken
(`tools/spikes/supabase-feasibility/probes/linkcheck.py`); all 23 file-provenance blob hashes in
`docs/architecture/README.md` match `e61cd06`; published test counts reproduce in fresh clones (`main` tsc 0, 91/91;
PR #4 tsc 0, 95/95).

## 4. Secret and personal-data scan

Pattern (GitHub/OpenAI/AWS/Slack tokens, private keys, JWTs, connection strings with a password) run with `git grep`
on `ebcfe72`, `784e50c`, `60342be`, `84d8044`, `ce6f328` (text, JSON and PDF): **0 matches**. Positive control: 2/2
synthetic strings matched. Password literals in the repository are only the public demo password `demo1234` and test
fixtures. E-mail addresses: only `*.test` fixtures. Evidence folders: no password hashes (`SCRAM-SHA-256$`, scrypt,
argon2, bcrypt, md5) and no long tokens except git SHAs.

The only real match outside the repository: `pr4/.scratch-review/pg-real.mts`, two passwords of throwaway roles on a
loopback cluster. Not published; a sanitized copy is (§5).

## 5. Publication manifest (file by file)

**Branch `docs/source-of-truth-cleanup`** = `84d8044` (45 files changed against `main`, 11 commits) + `a71284f`
(`docs/STATUS.md`, `.gitignore`).

**Branch `investigation/g7-runtime-role-boundary-incomplete`** = `60342be` exactly: `engines/db/open.ts` (modified),
`engines/db/test/runtime-role.test.ts`, `engines/db/test/runtime-role.pg.test.ts` (new). Not a fix.

**Branch `handoff/2026-10-14-evidence`** = `a71284f` + one commit adding:

| Path | Source | Treatment |
| --- | --- | --- |
| `docs/reviews/2026-10-14-supabase-feasibility.md` | this session | new |
| `docs/reviews/2026-10-14-g7-redesign-design-review.md` | `handoff/g7-redesign-design-review-2026-10-14.md` | verbatim + publication note on top |
| `docs/reviews/2026-10-14-repository-publication-audit.md` | this session | new (this file) |
| `tools/spikes/g7-runtime-role/artifacts/adversarial-60342be/` (18 files) | `evidence/g7-adversarial-60342be-2026-10-14/` | verbatim; own manifest verifies |
| `tools/spikes/supabase-feasibility/artifacts/`, `probes/` | `evidence/supabase-feasibility-2026-10-14/` | verbatim except the excluded Supavisor copies |
| `tools/spikes/supabase-feasibility/supavisor-source-provenance.md` | this session | new (replaces the source copies) |
| `tools/spikes/nile-review/scratch-2026-10-14/` | `pr4/.scratch-review/`, `pr4/.list.mts`, `verify/.scratch/` | verbatim except `pg-real.mts` (sanitized) |
| `docs/archive/agent-reports-2026-10-14/` | `handoff/*.md` | verbatim, HISTORICAL |
| `tools/spikes/2026-10-14-handoff.sha256` | this session | checksums of every file this commit adds or changes |
| `.gitignore` | this session | adds `!tools/spikes/**/artifacts/**/*.log`: the repository ignores `*.log`, which silently dropped 24 evidence logs until a read-back from a simulated remote caught it |

**Intentionally not published:**

| Item | Reason |
| --- | --- |
| Original `pr4/.scratch-review/pg-real.mts` | contains throwaway passwords; sanitized copy published |
| Supavisor source copies and `tree.json` | third-party code; pinned URLs and blob SHAs published instead |
| `handoff/*.bundle`, `handoff/patches/`, `handoff/g7-patches/`, `handoff/superseded-2026-10-14/*.bundle` and patches | transport copies of commits that are published as branches; `*.bundle` is now git-ignored |
| `handoff/0001-fix-security-…loc.patch` | the PR #4 commit, already on GitHub |
| `handoff/supabase-feasibility-2026-10-14.md` | short local summary, superseded by the full review |
| `/tmp/supa-eval/` clones and `/tmp/pgg7` cluster | runtime state |
