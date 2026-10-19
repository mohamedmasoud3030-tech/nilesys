# Working on Nile from an Arena Agent Mode sandbox

**Status:** CANONICAL (process). These are operational notes for any AI agent running in an Arena.ai Agent Mode
sandbox. They add environment facts to `AGENTS.md`. They never relax `AGENTS.md`; when the two differ,
`AGENTS.md` wins.
Every fact below was observed in sessions on 2026-10-18 and 2026-10-19. Re-check a fact before you rely on it.

## 1. Read first, in this order

1. `AGENTS.md`, completely: rules, gates, commands.
2. `docs/STATUS.md`: what is allowed now. §5 is the task queue; take the first unblocked task, or the one the
   owner names.
3. `docs/PRODUCT_PLAN.md`: feature IDs, phases and acceptance criteria. Owner decisions are marked D-x.
   **Never decide them yourself.**
4. This file.

## 2. What the sandbox keeps and what it loses

| Kept between messages | Lost on an environment reset (it happens without warning) |
| --- | --- |
| Regular files under `/home/user` | Everything in `/tmp`: worktrees, PostgreSQL clusters, scratch files |
| Git objects and refs under `/home/user/repos/*/.git` | `.git/config`: the remote URL disappears, and with it any credential |
| — | `node_modules`, `.npm`, `.cache` and other excluded directory names, and installed apt packages (PostgreSQL) |
| — | Running processes. File modification times are reset, so never use mtimes as dates |

**Consequences:**
- Commit early on a named branch, and save evidence files under `/home/user` (never only in `/tmp`).
- After a reset, re-run the recipe in §3.
- Do not claim a file exists on GitHub unless `git ls-remote` or the API shows it.

## 3. Setup recipe (idempotent)

```bash
# Repository
mkdir -p /home/user/repos && cd /home/user/repos
[ -d nilesys/.git ] || git clone https://github.com/mohamedmasoud3030-tech/nilesys.git
cd nilesys
git remote get-url origin 2>/dev/null || git remote add origin https://github.com/mohamedmasoud3030-tech/nilesys.git
git fetch origin --prune
git checkout docs/unified-plan-2026-10-19   # until PRODUCT_PLAN/STATUS updates are merged; then use the base STATUS names
npm ci                                  # npm only: never `corepack pnpm`, never `pnpm install` (D-H is open)

# Real PostgreSQL 17 (needed for every *.pg.test.ts; PGlite has one connection and cannot prove races)
command -v /usr/lib/postgresql/17/bin/initdb || sudo apt-get install -y postgresql-17
rm -rf /tmp/pgt && /usr/lib/postgresql/17/bin/initdb -D /tmp/pgt -U postgres --auth=trust > /tmp/initdb.log
/usr/lib/postgresql/17/bin/pg_ctl -D /tmp/pgt -l /tmp/pgt.log \
  -o "-p 5471 -k /tmp -c listen_addresses=127.0.0.1 -c shared_buffers=32MB" start
export NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5471/postgres
```

- **Use a fresh cluster for every full run.** On a reused cluster, `CREATE ROLE nile_app` fails.
- **Memory:** the sandbox has about 2 GB, so use `shared_buffers=32MB` and `--maxWorkers=1`.
- **When you finish,** stop the cluster: `/usr/lib/postgresql/17/bin/pg_ctl -D /tmp/pgt stop`. Do not use `pkill -f`.

## 4. Verification commands (record their exact output)

| What | Command |
| --- | --- |
| Types | `npm run typecheck` (must exit 0) |
| Whole suite, real PostgreSQL | `NILE_TEST_PG_ADMIN_URL=… npx vitest run --maxWorkers=1 --reporter=default --reporter=json --outputFile=/home/user/evidence/vitest-pg.json > /home/user/evidence/vitest-pg.txt 2>&1; echo "exit ${PIPESTATUS[0]}"` |
| Without PostgreSQL | `npm test`. The `.pg.test.ts` files are **skipped**, and skipped is not passed |
| API smoke | `npm run api:smoke` (see the CI draft for production-shaped roles) |
| After a schema change | `npm run db:generate` then `npx drizzle-kit check`. **Never** use `drizzle-kit push` as a drift gate |
| Prototype parity (UX reference) | `deliverables/parity/run-parity.sh` on branch `rescue/2026-10-19-workspace-archive`. Run `review.test.js` in-process, not with `node --test` |
| Secrets | gitleaks v8.30.1 with `--redact`, before every push |

**Reporting rules:**
- Strip ANSI codes from logs.
- A vitest JSON report can say success even after a worker crashed. Check that total = passed and that the
  number of real-PG files is greater than 0.
- Report numbers exactly as printed: for example "236/236 on PostgreSQL 17.11, local sandbox", never just
  "all green".
- **Local is not CI, CI is not staging, and staging is not production.**

## 5. Git and GitHub

- **Branching:** one task per branch, cut from the base that `STATUS.md` names (today:
  `integration/nile-2026-10-18`). Each fix is its own commit, with a test that fails before the fix and
  passes after it. Keep both outputs.
- **Worktrees:** use them for experiments (`git worktree add --detach /tmp/wt-x <ref>`). Remove the
  `node_modules` symlink before `git worktree remove --force`. Mutation tests run only in a throw-away
  worktree.
- **Credentials:** the sandbox has none. Ask the owner for a **fine-grained token, limited to this
  repository, Contents read/write, 1-day expiry**.
  - Keep it in an environment variable, and pass it through a `GIT_ASKPASS` script that reads that variable.
  - Never write it to `.git/config`, a file, a commit or a log. Delete the askpass script afterwards.
  - Tell the owner to revoke the token.
  - Never reuse a token from an earlier session.
- **Never, without the owner's explicit approval in this conversation:**
  - push;
  - open or merge a PR;
  - touch `main`;
  - force-push;
  - delete branches;
  - deploy;
  - run migrations on any shared or production database.
- **Pushing has side effects:** every pushed branch triggers a Vercel preview build. Say so in your report.
  Archive branches use `rescue/*` and are excluded by their own `vercel.json`.
- **After a push,** verify with `git ls-remote` and the API, and compare tree SHAs. Report: repository,
  branch, commit SHA, link.

## 6. Talking to the owner

The owner is **not technical**. He reads Arabic.

- **Questions:** ask with clear options and a recommendation, and keep it to at most 3–4 questions at a time.
- **D-x decisions:** never decide them yourself (payments, permissions, money definitions, hosting, product
  order).
- **End of every task, report:**
  1. What changed (files, commit SHA, branch, link).
  2. Exact verification results.
  3. What is still not done or not verified.
  4. Decisions needed from him.
  5. The next step you propose.
- **Words:** do not write "done", "ready" or "production-ready" without the commit and the evidence
  (`AGENTS.md` status labels).

## 7. Known traps (each one cost time before)

| Trap | Fix |
| --- | --- |
| `git worktree add` from a remote branch fails | add `--detach` |
| `review.test.js` crashes under `node --test` (Arabic output) | run it in-process with `node review.test.js` |
| The prototype server will not start under the root `"type": "module"` | `prototypes/nilesys/package.json` sets CommonJS. Run the prototype from a copy in `/tmp` |
| Readonly array errors in `offerings.ts` | keep `Offering` arrays `readonly` |
| A push fails with exit 128 | there are no credentials. Ask the owner; do not hunt for tokens |
| gitleaks reports noise | use `--redact`, and `regexTarget="match"` in custom rules |
| Matching patches by subject fails | use `git patch-id --stable` |
| `git bundle verify \| tail -1` shows nothing useful | grep for "okay" instead |
