#!/usr/bin/env python3
"""Read-only inventory of files kept OUTSIDE the git repo (deliverables + backups).
Usage: build_outside_inventory.py <outdir>"""
import csv, hashlib, os, re, subprocess, sys, tarfile, collections, datetime

out = sys.argv[1]
ROOTS = ['/home/user/deliverables', '/home/user/backups']
SKIP = '/home/user/deliverables/nilesys-inventory-2026-10-19'
REPO = '/home/user/repos/nilesys'

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(1 << 16), b''):
            h.update(c)
    return h.hexdigest()

# hashes of files inside the backup tarball
tar_hash = {}
with tarfile.open('/home/user/backups/session-2026-10-18/deliverables-2026-10-18.tar.gz') as t:
    for m in t.getmembers():
        if m.isfile():
            tar_hash[m.name.replace('deliverables/', '', 1)] = hashlib.sha256(t.extractfile(m).read()).hexdigest()

# patch-ids of every commit, to recognise exported patches exactly
logp = subprocess.run(['git', '-C', REPO, 'log', '--all', '-p', '--no-merges'], capture_output=True).stdout
pid = {}
for l in subprocess.run(['git', '-C', REPO, 'patch-id', '--stable'], input=logp, capture_output=True).stdout.decode().splitlines():
    a, c = l.split(); pid.setdefault(a, c[:7])
def patch_commit(path):
    with open(path, 'rb') as f:
        o = subprocess.run(['git', '-C', REPO, 'patch-id', '--stable'], input=f.read(), capture_output=True).stdout.decode().split()
    return pid.get(o[0], 'no matching commit') if o else 'unparsable'

def describe(path, rel):
    name = os.path.basename(path)
    if path.endswith('.md'):
        with open(path, encoding='utf-8', errors='replace') as f:
            for l in f:
                if l.startswith('#'):
                    return l.lstrip('#').strip()[:140]
    if path.endswith('.patch'):
        return f'git format-patch export, identical diff to commit {patch_commit(path)}'
    if path.endswith('.bundle'):
        heads = subprocess.run(['git', '-C', REPO, 'bundle', 'list-heads', path], capture_output=True, text=True).stdout.split('\n')
        return 'git bundle: ' + ', '.join(f'{l.split()[1].replace("refs/heads/", "")}@{l[:7]}' for l in heads if l.strip())
    if name == 'SHA256SUMS':
        return 'checksums for this folder'
    if path.endswith(('.txt', '.log')):
        return 'test/command output (evidence)'
    if path.endswith(('.diff',)):
        return 'git diff (evidence)'
    if path.endswith('.ts'):
        return 'probe test (not in repo)'
    if path.endswith(('.yml', '.toml', '.py', '.sh')):
        return 'proposed CI / helper script (not in repo)'
    if path.endswith('.tar.gz'):
        return 'backup archive of deliverables at 2026-10-18 13:10'
    return ''

rows = []
for root in ROOTS:
    for d, _, fs in os.walk(root):
        if d.startswith(SKIP):
            continue
        for fn in fs:
            p = os.path.join(d, fn)
            st = os.stat(p)
            rel = os.path.relpath(p, '/home/user')
            h = sha(p)
            in_tar = ''
            if rel.startswith('deliverables/'):
                k = rel[len('deliverables/'):]
                in_tar = ('identical copy in backup tar' if tar_hash.get(k) == h else 'differs from backup tar') if k in tar_hash else 'created after backup'
            rows.append(dict(path=rel, size=st.st_size,
                             modified_utc=datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M'),
                             sha256=h, description=describe(p, rel), backup_status=in_tar))
by = collections.defaultdict(list)
for r in rows:
    by[r['sha256']].append(r['path'])
for r in rows:
    r['identical_files'] = ' '.join(x for x in by[r['sha256']] if x != r['path'])
rows.sort(key=lambda r: r['path'])
with open(os.path.join(out, 'outside-repo-files.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(len(rows), 'files;', sum(1 for r in rows if r['identical_files']), 'with identical copies')
