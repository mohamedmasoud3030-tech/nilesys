# Skills — manifest and operating notes

This directory holds the repository's agent skills, authored in the open
Agent Skills format (https://agentskills.io/specification). Each skill is a
folder containing a `SKILL.md`.

## Manifest

| Skill | Load when… | Path |
|---|---|---|
| `decision-governance` | working with or changing accepted decisions, or surfacing a conflict | `decision-governance/SKILL.md` |
| `implementation-planning` | planning multi-step work before writing code | `implementation-planning/SKILL.md` |
| `test-driven-development` | implementing any feature, bugfix, or behavior change | `test-driven-development/SKILL.md` |
| `systematic-debugging` | any bug, test failure, or unexpected behavior | `systematic-debugging/SKILL.md` |
| `code-review` | reviewing a completed change | `code-review/SKILL.md` |
| `verification-before-completion` | before claiming any work is complete | `verification-before-completion/SKILL.md` |

## Discovery and activation

Harnesses that implement the Agent Skills format load each skill's
`name` + `description` at startup and the full body on activation
(progressive disclosure).

If your harness does **not** auto-discover skills:

1. Read the manifest above at session start.
2. When a trigger matches your task, read the full `SKILL.md`.
3. Re-check when the task's nature changes mid-session.

## Validating skills

- **Tier 0 (structure):** use the `skills-ref` reference implementation from
  `agentskills/agentskills`, or another validator whose source and version are
  recorded — do not treat an unverified third-party package as the official
  validator. `skills-ref validate .agents/skills/<name>` checks frontmatter
  validity and naming. Run when adding or editing a skill.
- **Tier 1 (behavior):** for each behavioral skill, run 1–3 realistic prompts
  in a fresh agent context; verify expected activation and observable
  behavior; where feasible, include one baseline run without the skill.
- **Tier 2 (real work):** when a skill fails in practice, record the failure
  mode, classify it (discovery / trigger description / unclear instruction /
  workflow loophole / conflicting instruction), revise minimally, and re-run
  the relevant acceptance case. Do not add speculative instructions.

## Adding a skill

A new skill must justify itself through a demonstrated recurring need. Before
authoring, inspect mature upstream implementations (Agent Skills spec, then
`anthropics/skills`, then `obra/superpowers`, then others) and classify each
finding as **ADOPT / ADAPT / REFERENCE / REJECT**. Record sources in
`docs/agent-system/REFERENCES.md`. Then:

1. Name the folder in lowercase-hyphen; the frontmatter `name` must equal it.
2. Write a trigger-focused description (≤ 1024 characters) covering what the
   skill does and when it activates.
3. Keep the body under ~500 lines; move detail to `references/`.
4. Run Tier 0 validation and a Tier 1 canary before depending on the skill.
