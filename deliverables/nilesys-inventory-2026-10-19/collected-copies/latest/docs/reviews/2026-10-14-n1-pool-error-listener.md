# N-1: runtime pool had no `error` listener — fix and verification (2026-10-14)

- **Status:** review / verification record (tier 5). Current state lives in `docs/STATUS.md` on the
  `handoff/2026-10-14-evidence` branch, which this branch does not contain.
- **Repository:** `mohamedmasoud3030-tech/Mohamed-App-Factory`
- **Branch:** `fix/nile-pool-error-listener`, based on `main` `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8`
- **Scope:** finding **N-1** only (`docs/STATUS.md` §6, task 2a). No migration, no schema change, no
  security-role change. **Not part of G-7.** Not pushed, no PR opened.
- **Independence limitation:** the agent that wrote this also wrote the code, so it is not an independent review.

Labels: **VERIFIED** (reproduced here, command and output recorded), **PASS / FAIL** (a test that ran),
**NOT VERIFIED** (not checked), **NOT RUN**.

## 1. The finding

`openPostgres` created a `pg.Pool` and attached only a `connect` handler. When PostgreSQL terminates an
idle pooled connection — a server restart, an administrator `pg_terminate_backend`, a provider recycling
the backend — `pg-pool` purges that client and then emits `'error'` on the pool. With no listener that
emit is an unhandled `'error'` event, and Node exits. **One idle connection being killed took the whole
API process down** (originally observed 2026-10-14, PostgreSQL 18.4, pg 8.23.1, SQLSTATE `57P01`).

Reproduced here on PostgreSQL 17.10, Node v20.20.2, pg 8.23.1 — **VERIFIED**: a `pg.Client` with no
`error` listener whose backend was terminated crashed the process with `Unhandled 'error' event`,
`code: '57P01'`, exit status 1.

`node_modules/pg-pool/index.js` `makeIdleListener` confirms the ordering that makes the fix correct:
`pool._remove(client)` runs **before** `pool.emit('error', err, client)`, so by the time the handler
runs the dead client is already purged. pg's own comment: *"once the pool emits an error the client has
already been closed & purged and is unusable."*

## 2. The change

`engines/db/open.ts` — the added block, nothing else in the file changed:

```ts
pool.on('error', (err) => {
  const code = (err as { code?: string }).code ?? 'no-code';
  console.error(
    `[nile:db] an idle PostgreSQL connection failed (${code}); the pool discarded it and will open a replacement on the next request: ${err.message}`,
  );
});
```

Log the failure and let the pool carry on. **The code and message only:** `pg-pool` sets
`err.client = client`, and that client holds `connectionParameters`, including the password. Logging or
serialising the error object therefore prints the database credential in cleartext. This was not
theoretical — see §4.

**The replacement is lazy, not eager** (measured, see §5): `pg-pool`'s idle listener calls `_remove()`
without a callback and never calls `_pulseQueue()`, and `_pulseQueue()` returns early when nothing is
waiting — there is no minimum pool size. After a kill the pool sits at `totalCount` 0 until the next
request needs a connection, which then pays the connect + `SET ROLE` cost. The replacement does come up
correctly as `nile_app`. An earlier wording of this log line said the pool "will replace it", which
implied an immediacy the code does not have; corrected in the follow-up commit (review finding D1).

New files:

| Path | Purpose |
| --- | --- |
| `engines/db/test/pool-resilience.pg.test.ts` | 5 real-PostgreSQL tests; skipped without `NILE_TEST_PG_ADMIN_URL` |
| `engines/db/test/fixtures/pool-error-child.ts` | child harness; the failure mode is process death, which cannot be observed from inside the vitest worker |

The idle backend is killed **by the runtime login itself**: a backend's owner may signal it, so that
part needs no superuser (**VERIFIED**: `pg_terminate_backend` returned `true` as a non-superuser).
Only role/database creation needs an elevated login.

## 3. Tests

| # | Test | Proves |
| --- | --- | --- |
| 1 | `openPostgres` attaches an error listener to the runtime pool | the fix is present (`listenerCount('error') === 1`) |
| 2 | the pool survives an idle backend being terminated and keeps serving as `nile_app` | process lives; next query runs as `nile_app`; the replacement client has a **new** backend pid |
| 3 | logs the failure with its SQLSTATE and never the password or the pg client | a `57P01` line is logged; the password, `connectionParameters` and any non-string argument are absent |
| 4 | CONTROL: with the listener removed (pre-fix `main`) the process dies | the failure mode is real, not assumed |
| 5 | the same harness survives when the listener is present | the control differs only by the fix |

Tests 4 and 5 run the **same** child harness against the **same** real `openPostgres`; they differ only
in whether the listener is removed, so the control exercises the shipped code path rather than a copy.

## 4. Verification

Throwaway local clusters (`@embedded-postgres/linux-x64`), `--auth=trust` on 127.0.0.1, deleted after
each run. No cloud resource, no existing project, no credential was requested or stored.

The numbers below were produced from a **fresh clone with a clean `npm ci`**, not from a working tree,
and were **re-run after the D1/D2 correction commit** (which changes the log wording in `open.ts`); the
re-run results are the ones reported. The originally verified commit was `433cdbd`, whose test and
fixture blobs (`pool-resilience.pg.test.ts` `3e52bd5`, `fixtures/pool-error-child.ts` `261d897`) are
still byte-identical here.

```
npx tsc --noEmit
NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres \
  npx vitest run engines/db/test/pool-resilience.pg.test.ts
NILE_TEST_PG_ADMIN_URL=... npx vitest run          # full suite, real PG available
npx vitest run                                     # full suite, default (no database)
npx drizzle-kit check ; npx drizzle-kit generate
```

| Check | PG 15.18 | PG 17.10 | PG 18.4 |
| --- | --- | --- | --- |
| `tsc --noEmit` | exit 0 | exit 0 | exit 0 |
| N-1 real-PG test | **PASS 5/5** | **PASS 5/5** | **PASS 5/5** |
| Full suite, real PG available | **PASS 96/96** (10 files) | **PASS 96/96** | **PASS 96/96** |
| Full suite, default run | 91 passed + 5 skipped (9 run + 1 skipped file) | same | same |
| `drizzle-kit check` | Everything's fine, exit 0 | — (run once) | — |
| `drizzle-kit generate` | No schema changes, nothing to migrate, exit 0; `engines/db/migrations/` unchanged | — | — |

The default run stays at **91 passed**, identical to `main`: the 5 new tests skip cleanly when no
disposable server is configured, so nothing that passed before was weakened.

### Before the fix (same branch, listener absent)

**FAIL 4 / PASS 1** on PostgreSQL 17.10. Test 1 failed on `listenerCount === 0`; tests 2 and 3 tore the
vitest worker down with the unhandled `'error'` event. That run also printed the throwaway role password
in cleartext inside the serialised `err.client.connectionParameters` — direct evidence for the
code-and-message-only rule in §2.

### Mutation testing

Run in a throwaway copy outside the repository, so the reviewed tree was never modified.

| Mutation | Result | Which assertion died |
| --- | --- | --- |
| M1 — remove the `error` listener entirely | **KILLED** — 4 failed / 1 passed | `:148` `listenerCount === 0`, then tests 2–3 |
| M2 — log the whole error object (`console.error(msg, err)`) | **KILLED** — 1 failed / 4 passed | **`:187`**, the "expected a 57P01 log line" check |
| M3 — log the password as a *string*, keeping `57P01` present | **KILLED** — 1 failed / 4 passed | **`:189`**, `not.toContain(password)` |

**Correction to this record (2026-10-14, review pass).** This section originally credited M2 with proving
that the credential assertion at `:189` has teeth. It does not. Under M2 the harness renders the error
argument as `<object>` (line `:184`), so the password never enters the captured log text, and the test
fails earlier at `:187` because `err.message` — and therefore `57P01` — is no longer logged. Execution
never reaches `:189`, which would have passed **vacuously**.

M3 was added to close that gap: it logs the password as a plain string while keeping `57P01` present, so
`:187` passes and `:189` is actually exercised. It fails at `:189` with the throwaway password named in
the assertion message. **The credential assertion does have teeth — M3 proves it, not M2.**

### Secret scan

GitHub/OpenAI/AWS/JWT/private-key/connection-string-with-password patterns, run over the **exported
committed tree** (111 files) as well as the changed files: **0 matches**.

Positive control: the original run matched 1/1 synthetic strings. A stronger control was run during the
review pass — 6 patterns (`github_pat_`, `ghp_`, RSA/EC/OpenSSH private key, `AKIA`, JWT, connection
string with password) against 6 synthetic strings: **6/6 matched**, committed tree **0 matches**.

Note: an earlier scan using `git grep --no-index` reported a positive control of 0/4 — a **broken
control**, caused by flag ordering, so that result proved nothing and was discarded. The 6/6 plain-`grep`
control above supersedes it. The role password is generated with `randomBytes` per run and never written
to a file.

## 5. Observations and limitations

- **Pre-existing, not introduced here — VERIFIED:** Node prints
  `DeprecationWarning: Calling client.query() when the client is already executing a query … removed in
  pg@9.0`. It appears identically with `main`'s `open.ts` (which has 0 error listeners) and with this
  fix, so it comes from the untouched `pool.on('connect', (c) => void c.query(...))` line. That
  unawaited `SET ROLE` is already tracked as **G-7**; it is out of scope for this change and is left
  exactly as it was.
- **NOT VERIFIED:** hosted providers. Supavisor, Neon's PgBouncer, RDS and Supabase were not contacted;
  whether they terminate idle backends, and how often, is unknown (D5 hosting is still UNRESOLVED).
- **NOT VERIFIED:** `idleTimeoutMillis` / `max` tuning. This change makes an idle kill survivable; it
  does not make the pool reconnect faster or bound staleness.
- **NOT RUN:** a kill *during* an in-flight query. Only idle clients are covered here, which is what
  `pg-pool`'s `error` event reports; a query in flight already fails through its own promise.
- **NOT RUN:** repeated/continuous kills (soak). Five single-kill cycles across three majors only.
- **Environment caveat for whoever re-runs this.** The two PGlite suites (`engines/db/test/rls.test.ts`,
  `apps/api/test/e2e-sale.test.ts`) are WASM and memory-hungry. On the 2 GB sandbox used here, keeping
  scratch (embedded-PostgreSQL binaries, a second clone) on a **RAM-backed `/tmp` (tmpfs)** starved the
  vitest workers and they died with `Worker exited unexpectedly`, reporting 61/96 with 2 errors. This
  reproduced with this branch's test file **excluded**, so it is not caused by this change. Moving
  scratch to disk-backed storage restored 96/96 on all three majors. If a run reports worker exits
  rather than test failures, check available memory first.
- Coverage is claimed only for the majors tested: 15.18, 17.10, 18.4. There is still **no CI**, so this
  evidence is local and must be re-run by a reviewer.

## 6. What is still open

1. **`docs/STATUS.md` is not updated by this branch.** That file does not exist on `main`; it lives on
   `docs/source-of-truth-cleanup` / `handoff/2026-10-14-evidence`. Creating it here would conflict with
   those branches. When this merges, the N-1 row in §6 should move from `OPEN (task 2a)` to
   `FIXED ON <merge commit>` and task 2a in §5 should be closed. **Deliberately left to the owner** to
   avoid a conflicting edit.
2. **Not pushed, no PR** — pushing needs the owner's explicit authorisation.
3. The G-7 redesign remains **PROPOSED** and untouched; this change does not affect it.
