# Restoring and pushing session work — 2026-10-18

## Contents

**Files in this folder** (checksums in `SHA256SUMS`; check with `sha256sum -c SHA256SUMS`):

| File | Contents |
|---|---|
| `nilesys-all-local-branches.bundle` | Everything: main + the 3 branches, clones standalone |
| `nilesys-feat-nile-offerings-readiness.bundle` | `main..c910b57` (2 commits) |
| `nilesys-feat-nile-lead-people-services.bundle` | `main..099dc14` (5 commits, includes offerings) |
| `nilesys-feat-nile-mission3-pos-fixes-pg-tests.bundle` | `main..c72f746` (9 commits, includes both above) |
| `deliverables-2026-10-18.tar.gz` | The reports, patches, older bundles and parity files (24 files) |
| `BRANCHES.txt` | Each branch's SHA at backup time |

**Prerequisite for the per-branch bundles:** `main` = `52af469`, which is already on GitHub.

## Restore without GitHub

```bash
git clone nilesys-all-local-branches.bundle nilesys-restored
cd nilesys-restored
git branch -a        # the branches appear as origin/...
```

## Push the branches to GitHub (from a machine with push rights)

Each branch is pushed separately, **without --force**. All three are new on the remote, so there is no overwrite.

```bash
git clone https://github.com/mohamedmasoud3030-tech/nilesys.git && cd nilesys
git fetch /path/to/nilesys-all-local-branches.bundle \
  'refs/heads/feat/*:refs/heads/feat/*'
git push origin feat/nile-offerings-readiness
git push origin feat/nile-lead-people-services
git push origin feat/nile-mission3-pos-fixes-pg-tests
git ls-remote origin 'refs/heads/feat/nile-*'   # must show c910b57 / 099dc14 / c72f746
```

Do not merge into main and do not open a PR; that's a separate decision.

## Restore the deliverables

```bash
tar -xzf deliverables-2026-10-18.tar.gz
```
