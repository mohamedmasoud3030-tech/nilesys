#!/usr/bin/env python3
"""Execute the `run:` steps of one job of a GitHub Actions workflow locally, verbatim.

Usage: run-workflow-local.py <workflow.yml> <job-id> <checkout-dir> [--only "step name substr"] [--env K=V ...]

- Shell: bash --noprofile --norc -eo pipefail (GitHub's default for `run`).
- Env: os.environ + workflow env + job env + step env; GITHUB_ENV is applied between steps.
- `uses:` steps are NOT executed (reported as emulated): checkout = <checkout-dir>,
  setup-node = whatever `node` is first on PATH, services = provided by the caller.
- `if: always()` steps run even after a failure; other steps stop at the first failure.
- Any ${{ }} left inside run/env would be a bug for this workflow's design; it aborts.
"""
import os, subprocess, sys, tempfile, yaml

wf_path, job_id, cwd = sys.argv[1:4]
only, extra = None, {}
args = sys.argv[4:]
while args:
    a = args.pop(0)
    if a == '--only': only = args.pop(0)
    elif a == '--env':
        k, v = args.pop(0).split('=', 1); extra[k] = v
wf = yaml.safe_load(open(wf_path))
job = wf['jobs'][job_id]
genv = tempfile.NamedTemporaryFile(delete=False, prefix='github_env_').name
base = {**os.environ, **{k: str(v) for k, v in (wf.get('env') or {}).items()}, **{k: str(v) for k, v in (job.get('env') or {}).items()}, 'GITHUB_ENV': genv, 'CI': 'true'}
base.update(extra)
failed = False
results = []
for i, st in enumerate(job['steps'], 1):
    name = st.get('name') or (st.get('run', '').splitlines()[0] if 'run' in st else st.get('uses', '?'))
    if 'uses' in st:
        results.append((i, name, 'EMULATED (uses)')); continue
    if only and only not in name:
        continue
    cond = str(st.get('if', ''))
    if failed and 'always()' not in cond:
        results.append((i, name, 'NOT RUN (earlier failure)')); continue
    env = dict(base)
    for line in open(genv):
        if '=' in line:
            k, v = line.rstrip('\n').split('=', 1); env[k] = v
    env.update({k: str(v) for k, v in (st.get('env') or {}).items()})
    script = st['run']
    if '${{' in script or any('${{' in str(v) for v in (st.get('env') or {}).values()):
        print(f'ABORT: expression inside step {name!r}'); sys.exit(3)
    wd = os.path.join(cwd, st.get('working-directory', '.'))
    print(f'\n>>> [{job_id}] step {i}: {name}\n$ ' + script.strip().replace('\n', '\n  '), flush=True)
    rc = subprocess.run(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', script], cwd=wd, env=env).returncode
    print(f'<<< step {i} exit={rc}', flush=True)
    results.append((i, name, 'PASS' if rc == 0 else f'FAIL (exit {rc})'))
    if rc != 0: failed = True
print(f'\n===== job {job_id} summary =====')
for i, n, r in results: print(f'  {i:2}. {r:26} {n}')
print('JOB RESULT:', 'FAIL' if failed else 'PASS')
sys.exit(1 if failed else 0)
