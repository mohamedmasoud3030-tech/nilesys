#!/usr/bin/env python3
"""Read-only: list repo-relative paths cited in .md/.ts files of a ref that do not exist in that ref."""
import re, subprocess, sys, posixpath
repo, ref = sys.argv[1], sys.argv[2]
g = lambda *a: subprocess.run(['git','-C',repo,*a],capture_output=True,text=True).stdout
files = set(g('ls-tree','-r','--name-only',ref).split('\n'))
dirs = {posixpath.dirname(f) for f in files}
alld = set()
for d in dirs:
    while d: alld.add(d); d = posixpath.dirname(d)
pat = re.compile(r'(?:\]\(|`)((?:\.\.?/)*(?:docs|engines|apps|tools|prototypes|\.agents|\.github|libs)/[A-Za-z0-9_./@-]+?)(?:#[^)`]*)?[)`:]')
pat2 = re.compile(r'\]\(((?!https?:|mailto:|#)[A-Za-z0-9_./-]+\.md)(?:#[^)]*)?\)')
seen = set()
for f in sorted(x for x in files if x.endswith(('.md','.ts'))):
    txt = g('show', f'{ref}:{f}')
    for m in list(pat.finditer(txt)) + list(pat2.finditer(txt)):
        p = m.group(1).rstrip('.')
        cand = [posixpath.normpath(posixpath.join(posixpath.dirname(f), p)), posixpath.normpath(p.lstrip('./'))]
        if any(c in files or c in alld for c in cand) or '*' in p or '<' in p: continue
        key = (f, p)
        if key in seen: continue
        seen.add(key); print(f'{f}\t{p}')
