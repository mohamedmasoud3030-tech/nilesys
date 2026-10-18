# tools/nile-offerings — readiness registry for the Nile catalogue

**Tier 5 (evidence) in `AGENTS.md` terms. It never authorises work.**

`offerings.ts` records, for each of the **7 systems, 7 websites and 5 Windows entries** on the Nile
prototype homepage, what actually exists today, what can be reused, what a card must not claim, and the
smallest next step. `cardStatus()` gives any presentation layer (Nile or the LENA umbrella site) an honest
label: **Available to try** only with a verified HTTP-200 destination, **In development** only for work
on the production path, otherwise **Planned**.

```bash
npx vitest run --config tools/nile-offerings/vitest.config.ts   # 16 tests
npx tsc -p tools/nile-offerings/tsconfig.json --noEmit
```

It uses its own config files so the shared root `vitest.config.ts` and `tsconfig.json` stay untouched.
To add it to `npm test`, add `'tools/**/*.test.ts'` to the root vitest `include` in a separate,
owner-approved change.

## What the tests prove on every run

- The registry ids and their order match the prototype `SYSTEMS` / `SITES` / `WINDOWS` arrays, and every
  name matches the exact card string.
- System ids match `DEMO_ACCOUNTS` in the platform engine. Site ids match `LeadSource` in the catalog
  engine. Both are also enforced at compile time through `SystemId` / `SiteId`.
- Every evidence and engine path exists.
- Only `system:pos` is in progress (owner: primary agent). Only POS has a working legacy screen.
- No destination exists without HTTP 200 evidence. None is verified today: `nilesys.vercel.app` returns
  404 `NOT_FOUND`.
- Windows entries carry no size, OS, trial or download facts. The two unverified claims in the prototype
  (`89 MB · Windows 10/11`, `days trial`) are tracked in `UNVERIFIED_PROTOTYPE_CLAIMS`. Delete each entry
  once the prototype or its successor is corrected.

A mutation check was run on 2026-10-18: marking HR in progress, adding an unverified gym URL, adding
"89 MB" to a Windows entry, and swapping two site ids each made the suite fail.

## Repeatable path: legacy asset → maintained Nile product

1. **Registry first.** Change the offering's entry here and cite real paths. If you cannot cite a path,
   the claim does not go in.
2. **Engine before screen** (binding rule). Reuse the listed `engines` entries. Bring in code from a
   legacy repository only with a `docs/REUSE.md` provenance row.
3. **Service + tests.** Add a tenant-scoped service through `withTenant`, modelled on
   `engines/transactions/src/sale-service.ts`, and test it on PGlite. Append-only tables must revoke
   UPDATE/DELETE in their migration (P4-4).
4. **API.** Add a REST endpoint with OpenAPI (ADR-0006) and an e2e test like `apps/api/test/e2e-sale.test.ts`.
5. **Screen.** Reuse the prototype's Arabic/RTL UX and its i18n dictionary as a reference, not as code.
6. **Destination.** Only after a deployment returns HTTP 200 does `destination` get set. `cardStatus`
   then switches to "Available to try" on its own.
7. **Windows.** Only after step 6. Wrap the shipped web system in Tauri, reusing `carmen-gallery-`'s
   desktop boundary. Size, OS support and trial terms get published only after they are measured from a
   real build.
