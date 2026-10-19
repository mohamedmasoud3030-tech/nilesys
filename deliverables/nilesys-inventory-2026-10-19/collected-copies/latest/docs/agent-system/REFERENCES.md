# External References

Upstream methodologies and standards this repository intentionally learns
from. External projects are references, not hidden dependencies: nothing here
is vendored, and the repository must remain understandable without them.

For each borrowed material, classify it as:

- **ADOPT** — use essentially the same concept.
- **ADAPT** — retain the proven pattern, made repository- and vendor-neutral.
- **REFERENCE** — useful background only.
- **REJECT** — conflicts with our requirements or adds unnecessary complexity.

## agentskills/agentskills

- **Source:** https://github.com/agentskills/agentskills
- **License:** code Apache-2.0; documentation CC-BY-4.0.
- **Used for:** the Agent Skills format — `SKILL.md` frontmatter, progressive
  disclosure, naming and description constraints. **ADOPT** (the format is
  normative for our skills).
- **Validation tooling:** the repository ships a `skills-ref` reference
  implementation (Python, version 0.1.0, Apache-2.0), explicitly described by
  its authors as intended for demonstration purposes, not for production. Use
  it, or another validator whose source and version are recorded. The npm
  package `skills-ref` (v0.1.5) is a third-party CLI, not the upstream
  reference implementation.

## anthropics/skills

- **Source:** https://github.com/anthropics/skills
- **License:** NOT a single blanket license. Many example skills are Apache-2.0;
  the document skills (`docx`, `pdf`, `pptx`, `xlsx`) are source-available, not
  open source. Verify the license of each specific material before copying or
  adapting substantive text or code.
- **Used for:** skill-authoring patterns and the `skill-creator` methodology —
  trigger-description design (description as the primary activation mechanism,
  "pushy" descriptions to counter under-triggering), progressive-disclosure
  structure, behavioral evaluation with baseline comparison (with-skill vs.
  without-skill), and iteration on observed failures. **ADAPT** (concepts only;
  no evaluation infrastructure imported).

## obra/superpowers

- **Source:** https://github.com/obra/superpowers
- **License:** MIT.
- **Used for:** software-engineering workflow — implementation planning
  (`writing-plans`), TDD, systematic debugging, code review
  (`requesting-code-review` + `code-reviewer.md`), verification-before-
  completion, and the "validate skills, don't assume they work" mindset.
  **ADAPT** (patterns retained with vendor/runtime-specific assumptions
  removed: no subagent-only flow, no `superpowers:` skill references, no
  git-worktree requirement).
- **REJECT for now:** subagent-driven-development orchestration, the tmux/"Drill"
  eval harness, and plugin/hook infrastructure — premature for this repository.
