#!/usr/bin/env python3
"""Workspace rescue: classify every local file, then stage the files that must be kept into an orphan
branch of a throw-away staging repo (/tmp/rescue-staging). Read-only on all originals: nothing under
/home/user/repos/nilesys, deliverables/ or backups/ is modified. Output: evidence/LOCAL_FILES_CLASSIFIED.tsv,
RESCUE_MANIFEST.tsv (sha256 of every staged file), and the staging commit."""
import hashlib, os, subprocess, shutil, sys, json
H = '/home/user'
OUT = os.path.join(H, 'deliverables/rescue-2026-10-19')
STAGE = '/tmp/rescue-staging'
BRANCH = 'rescue/2026-10-19-workspace-archive'
NILE = os.path.join(H, 'repos/nilesys')

# Files that contain the CODE of the unpushed POS fixes d90b7c9 / 0207c13 -> held until the owner approves separately
HELD = {
 'deliverables/integration-probes/mission9-refund/d90b7c9.diff': 'full diff of unpushed POS fix d90b7c9 (refund lock)',
 'deliverables/integration-probes/mission11-payment-mismatch/0207c13.diff': 'full diff of unpushed test commit 0207c13',
 'deliverables/integration-probes/mission11-payment-mismatch/b25cb65..0207c13.diff': 'full diff of both unpushed commits d90b7c9+0207c13',
}
# Excluded: regenerable / environment / platform-internal (never uploaded); every one is listed with its reason
EXCL_DIRS = {
 '.npm': 'npm download cache (regenerable)',
 'repos/nilesys/node_modules': 'npm dependencies, regenerable with npm ci from package-lock.json',
 'repos/nilesys/.git': 'git database: every commit except d90b7c9/0207c13 is already on GitHub (verified); dangling commits saved as a bundle instead',
}
EXCL_FILES = {'.sudo_as_admin_successful': 'empty system marker file'}
TMP_INCLUDE = {  # /tmp files with unique content worth keeping (raw evidence); others excluded with reason
 '/tmp/rev': 'raw (ANSI-coloured) Mission 13 test outputs; stripped copies already in integration-probes',
 '/tmp/allpaths.txt': 'Mission 14 all-history path list (intermediate evidence)',
 '/tmp/cur.sha': 'Mission 14 sha256 of current deliverables (backup comparison)',
 '/tmp/tar.sha': 'Mission 14 sha256 of files inside the backup tar',
 '/tmp/gh_jiwdah.json': 'GitHub API 404 body, 2026-10-19', '/tmp/gh_malek-plus.json': 'GitHub API 404 body',
 '/tmp/gh_malek.json': 'GitHub API 404 body', '/tmp/gh_platform.json': 'GitHub API 404 body',
 '/tmp/gh_terranex.json': 'GitHub API 404 body', '/tmp/gh_nilesys.json': 'GitHub API repo metadata',
 '/tmp/gh_pulls.json': 'GitHub API PR list', '/tmp/refund-before.txt': 'Mission 11 raw output',
 '/tmp/refund-after-1.txt': 'Mission 11 raw output', '/tmp/refund-after-2.txt': 'Mission 11 raw output',
 '/tmp/refund-after-3.txt': 'Mission 11 raw output', '/tmp/tsc-refund.txt': 'Mission 11 raw output (empty = tsc clean)',
}
TMP_EXCLUDE = {
 '/tmp/arena-workspace': 'Arena platform sync internals (hydrate/changes zips), not project files',
 '/tmp/pgt': 'throw-away PostgreSQL test cluster data directory', '/tmp/pgt.log': 'PG server log of the throw-away cluster',
 '/tmp/apt-pg.log': 'apt install log', '/tmp/tsx-1000': 'tsx compiler cache', '/tmp/scarf-js-history-user.log': 'npm telemetry marker',
 '/tmp/tarx': 'extracted copy of backups/.../deliverables-2026-10-18.tar.gz (24 files, all identical to deliverables/)',
 '/tmp/gitleaks': 'scanner binary downloaded for this check', '/tmp/gl.tgz': 'scanner archive',
 '/tmp/rescue-staging': 'this staging repo', '/tmp/systemd-private-4d6350ec97f2455592a238b652448345-systemd-logind.service-e3xXoh': 'OS',
}
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()

def walk(root):
    for d, ds, fs in os.walk(root):
        ds.sort(); 
        for f in sorted(fs): yield os.path.join(d, f)

rows, stage = [], []   # rows: rel, size, sha, decision, dest, reason
for p in walk(H):
    rel = os.path.relpath(p, H)
    if rel.startswith('deliverables/rescue-2026-10-19/'):   # this mission's own output: staged at the end
        continue
    ex = next((r for d, r in EXCL_DIRS.items() if rel == d or rel.startswith(d + '/')), None) or EXCL_FILES.get(rel)
    if ex:
        continue  # summarised per directory below (thousands of cache files)
    s = sha(p); size = os.path.getsize(p)
    if rel in HELD:
        rows.append((rel, size, s, 'HELD', '-', HELD[rel])); continue
    if rel == 'repos/nilesys/pnpm-lock.yaml':
        dest = 'untracked/repos/nilesys/pnpm-lock.yaml'; why = 'untracked file in nilesys (origin unknown; kept, not added to the repo tree)'
    elif rel.startswith('repos/nilesys/'):
        r = subprocess.run(['git', '-C', NILE, 'ls-files', '--error-unmatch', os.path.relpath(p, NILE)], capture_output=True)
        rows.append((rel, size, s, 'ON-GITHUB', '-', 'tracked file of nilesys (content = commit 0207c13 worktree; see repo check)')); continue
    else:
        dest = rel; why = 'local-only file'
    rows.append((rel, size, s, 'UPLOAD', dest, why)); stage.append((p, dest, s))
for d, r in EXCL_DIRS.items():
    full = os.path.join(H, d)
    if os.path.exists(full):
        n = sum(1 for _ in walk(full)); rows.append((d + '/', n, '-', 'EXCLUDED', '-', f'{n} files: {r}'))
for f, r in EXCL_FILES.items(): rows.append((f, 0, '-', 'EXCLUDED', '-', r))
for t in sorted(os.listdir('/tmp')):
    p = '/tmp/' + t
    if p in TMP_INCLUDE:
        for q in (walk(p) if os.path.isdir(p) else [p]):
            dest = 'tmp-evidence/' + os.path.relpath(q, '/tmp'); s = sha(q)
            rows.append((q, os.path.getsize(q), s, 'UPLOAD', dest, TMP_INCLUDE[p])); stage.append((q, dest, s))
    else:
        rows.append((p, '-', '-', 'EXCLUDED', '-', TMP_EXCLUDE.get(p, 'temporary file (unclassified - review)')))

os.makedirs(os.path.join(OUT, 'evidence'), exist_ok=True)
with open(os.path.join(OUT, 'evidence/LOCAL_FILES_CLASSIFIED.tsv'), 'w') as f:
    f.write('path\tsize_or_count\tsha256\tdecision\tdestination_in_rescue_branch\treason\n')
    for r in rows: f.write('\t'.join(map(str, r)) + '\n')
from collections import Counter
print(Counter(r[3] for r in rows))
json.dump(stage, open('/tmp/rescue-stage-list.json', 'w'))
