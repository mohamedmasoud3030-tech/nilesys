#!/usr/bin/env python3
"""Read-only inventory of every path that ever existed in the nilesys git history.
Uses only `git` plumbing reads (log, ls-tree, cat-file, show). Never writes to the repo.
Usage: build_repo_inventory.py <repo> <outdir>
"""
import csv, collections, json, os, re, subprocess, sys

repo, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def git(*a, binary=False):
    r = subprocess.run(['git', '-C', repo, *a], capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')

refs = [l.split() for l in git('for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads', 'refs/remotes').splitlines()]
refs = [(n, s) for n, s in refs if n not in ('origin', 'origin/HEAD')]
tips = {}
for name, sha in refs:
    tree = {}
    for line in git('ls-tree', '-r', '-l', sha).splitlines():
        meta, path = line.split('\t', 1)
        mode, typ, blob, size = meta.split()
        tree[path] = (blob, size)
    tips[name] = tree

# every path ever touched + its history (oldest first)
hist = collections.defaultdict(list)
cur = None
for line in git('log', '--all', '--reverse', '--date=short', '--name-status', '--format=@@%h|%ad|%an|%s').splitlines():
    if line.startswith('@@'):
        cur = line[2:].split('|', 3)
    elif line.strip():
        parts = line.split('\t')
        st = parts[0]
        for p in parts[1:]:
            hist[p].append((cur[0], cur[1], cur[2], cur[3], st[0]))

def blobs_of(path):
    s = set()
    for c in {h[0] for h in hist[path]}:
        try:
            s.add(git('rev-parse', f'{c}:{path}').strip())
        except subprocess.CalledProcessError:
            pass
    return s

def category(p):
    rules = [
        (r'^prototypes/nilesys/public/assets/js/home\.js$', 'catalog-data (prototype)'),
        (r'^prototypes/', 'prototype'),
        (r'^tools/nile-offerings/', 'offerings registry'),
        (r'^docs/plan/', 'plan'), (r'^docs/prd/', 'requirements (PRD)'), (r'^docs/todo/', 'plan (TODO)'),
        (r'^docs/vision/', 'vision'), (r'^docs/adr/', 'decision (ADR)'), (r'^docs/architecture', 'architecture'),
        (r'^docs/reviews/', 'review/audit'), (r'^docs/archive/', 'archived agent report'),
        (r'^docs/agent-system/|^\.agents/|^AGENTS\.md$', 'agent rules'), (r'^docs/', 'project doc'),
        (r'^tools/spikes/.*(artifacts|\.log$|\.txt$|\.json$|MANIFEST|sha256)', 'test/audit evidence'),
        (r'^tools/spikes/', 'spike/probe code'), (r'migrations/', 'DB migration'),
        (r'/test/|\.test\.', 'test'), (r'^(engines|apps)/.*\.ts$', 'source code'),
        (r'README\.md$', 'readme'),
    ]
    for rx, c in rules:
        if re.search(rx, p):
            return c
    return 'config/other'

def title(path, ref_or_commit):
    if not re.search(r'\.(md|txt)$', path):
        return ''
    try:
        txt = git('show', f'{ref_or_commit}:{path}')
    except subprocess.CalledProcessError:
        return ''
    for l in txt.splitlines():
        l = l.strip()
        if l.startswith('#'):
            return l.lstrip('#').strip()[:140]
    return ''

blob_paths = collections.defaultdict(set)
rows = []
for path in sorted(hist):
    h = hist[path]
    present = [n for n, _ in refs if path in tips[n]]
    local = [n for n in present if not n.startswith('origin')]
    remote = [n[len('origin/'):] if n.startswith('origin/') else n for n in present if n.startswith('origin')]
    last_ref = 'integration/nile-2026-10-18' if path in tips.get('integration/nile-2026-10-18', {}) else (present[0] if present else None)
    if last_ref:
        blob, size = tips[last_ref][path]
        src = last_ref
    else:  # deleted / renamed away everywhere: take the last commit that had it
        last_add = [x for x in h if x[4] != 'D']
        src = last_add[-1][0] if last_add else h[-1][0]
        try:
            blob = git('rev-parse', f'{src}:{path}').strip(); size = git('cat-file', '-s', blob).strip()
        except subprocess.CalledProcessError:
            blob, size = '', ''
    vers = blobs_of(path)
    for b in vers:
        blob_paths[b].add(path)
    status = 'on main' if path in tips['main'] else ('on branches only' if present else 'history only (deleted/renamed)')
    rows.append(dict(
        path=path, category=category(path), title=title(path, src), status=status,
        on_main='Y' if path in tips['main'] else 'N',
        on_integration='Y' if path in tips.get('integration/nile-2026-10-18', {}) else 'N',
        remote_branches=' '.join(sorted(set(remote))), local_branches=' '.join(sorted(local)),
        first_commit=f'{h[0][0]} {h[0][1]} {h[0][2]}', first_subject=h[0][3][:100],
        last_commit=f'{h[-1][0]} {h[-1][1]} {h[-1][2]} ({h[-1][4]})', n_commits=len({x[0] for x in h}),
        n_versions=len(vers), latest_blob=blob[:12], size=size, version_source=src,
    ))

# duplicate detection: identical content under different paths, and same basename in different folders
for r in rows:
    same = set()
    try:
        b = git('rev-parse', f"{r['version_source']}:{r['path']}").strip()
        same = blob_paths[b] - {r['path']}
    except subprocess.CalledProcessError:
        pass
    r['identical_content_at'] = ' '.join(sorted(same))
base = collections.defaultdict(list)
for r in rows:
    base[os.path.basename(r['path'])].append(r['path'])
for r in rows:
    others = [p for p in base[os.path.basename(r['path'])] if p != r['path']]
    r['same_name_at'] = ' '.join(others) if os.path.basename(r['path']) not in ('README.md', 'package.json', 'tsconfig.json', 'schema.ts', 'index.ts', 'matrix.mts', 'role-and-deploy.mts', 'initdb.log', 'matrix.txt', 'server.log', 'supa-emul.txt', 'vitest-g7-pg.json', 'vitest-g7-pg.log', 'vitest-merged-pg.json', 'vitest-merged-pg.log', 'MANIFEST.sha256') else ''

fields = list(rows[0].keys())
with open(os.path.join(out, 'repo-files-all-history.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
with open(os.path.join(out, 'refs-snapshot.txt'), 'w') as f:
    for n, s in refs:
        f.write(f'{n} {s}\n')
print(json.dumps(collections.Counter(r['status'] for r in rows)), len(rows))
print(json.dumps(collections.Counter(r['category'] for r in rows), ensure_ascii=False))
