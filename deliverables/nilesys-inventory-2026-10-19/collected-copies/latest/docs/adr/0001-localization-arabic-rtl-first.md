# ADR-0001 — Arabic and RTL are first-class requirements, English remains the repository language

- Status: **Accepted**
- Date: 2026-10-13
- Deciders: Mohamed (product owner, decided), ChatGPT (technical strategist), Arena (implementation)
- Supersedes: — · Superseded by: —

## Context

Two different things were being conflated in the original project brief:

1. **The working language of the repository** — code, identifiers, comments, documentation, commit
   messages, pull requests, and issues.
2. **The languages the finished applications must serve** — the languages of the people who will use the
   applications, and of the documents the applications produce.

Mohamed confirmed that end users will require **Arabic with right-to-left layout**. Egyptian law
reinforces this: Arabic is mandatory on official documents including tax invoices, and English is
permitted only as a secondary language.

This matters architecturally because RTL and localization are **cross-cutting UI concerns**, not features.
Retrofitting right-to-left layout into a component system that assumed left-to-right touches every screen,
every table, every form, and every generated document. The cost is not linear — it is a rewrite of the
presentation layer.

Two mistakes were available to us: (a) treating Arabic as a later translation task, and (b) writing the
repository itself in Arabic or in two languages, which would fragment documentation and code consistency
for no user-facing benefit.

## Decision

1. **The repository and all technical communication remain in English.** Code, identifiers, comments,
   documentation, commit messages, pull requests, and issues. Unchanged from the original brief.
2. **The applications are built bilingual from the first screen, with Arabic and RTL as first-class
   requirements** — not a later translation project and not a plugin.
3. Concretely, before the first UI is written:
   - Every user-visible string is externalized from day one. No hard-coded display text in components.
   - Layout is built with direction-aware techniques: logical CSS properties, a direction provider, and
     no assumptions about left-to-right ordering in custom components.
   - The UI foundation is chosen with built-in RTL support as a **requirement**, not a bonus.
   - Automated tests must cover Arabic: at minimum, RTL rendering snapshot or visual tests for the
     primary screens and for every generated document template.
   - Generated documents (invoices, statements, contracts) must render Arabic correctly, with Arabic-
     capable fonts and bidi handling, and must support the bilingual Arabic-primary/English-secondary
     format that Egyptian official documents require.
4. **Business content is treated separately from UI language:** business data (customer names, product
   descriptions, addresses) may be stored in either language, but the application must never assume a
   single script.

## Consequences

**Easier:** Arabic support is a property of the system rather than a project. Document generation is
correct by construction. Adding a third language later is a translation task, not an engineering task.

**Harder / more expensive:** UI work costs more up front (logical properties, direction-aware layout,
string externalization). Component selection is constrained — a headless styling approach that requires
us to hand-build RTL behaviour is now less attractive than a component library with first-class RTL
support. Every document template needs Arabic test fixtures. Two-language testing increases CI time.

**Committed to:** Arabic is a release-blocking quality dimension. A screen that breaks in RTL is a defect,
not a translation backlog item.

## Alternatives considered

1. **English-only UI first, Arabic later.** Rejected: RTL retrofitting touches the entire presentation
   layer, and Egyptian legal requirements make Arabic unavoidable for anything invoice- or
   contract-related. This would have been the single most expensive shortcut in the project.
2. **Arabic-only.** Rejected: the team, the codebase, and the tooling work in English; a single-language
   Arabic product would also need English for any international or export-facing use.
3. **Two separate applications (one Arabic, one English).** Rejected outright: doubles the codebase and
   guarantees divergence.
4. **Repository documentation bilingual.** Rejected: doubles the documentation surface, and every
   document then has two versions to keep in sync — one of which will rot silently.

## Review trigger

Reopen if a product decision limits the applications to a non-Arabic market, or if Arabic is dropped from
the product scope. Otherwise this decision stands for the life of the factory.
