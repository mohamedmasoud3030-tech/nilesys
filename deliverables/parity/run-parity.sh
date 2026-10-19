#!/usr/bin/env bash
# Reproducible parity run for prototypes/nilesys (read-only w.r.t. the repo).
# Extracts the prototype at two refs into a temp dir via `git archive`, runs:
#   - review suite v2 (original, from 099dc14)  — the comparison REFERENCE
#   - review suite v3 (from HEAD)               — the behaviour CONTRACT after the fixes
#   - tests/regression.test.js (from HEAD)       — isolated regression tests
# against the OLD server (099dc14) and the NEW server (HEAD), and prints, per
# scenario, the recorded verdict (PASS/FAIL) and the node:test outcome (ok/not ok).
# Usage: run-parity.sh /path/to/nilesys [OLD_REF] [NEW_REF]
set -u
REPO=${1:?repo path}; OLD=${2:-099dc14}; NEW=${3:-HEAD}
OUT=${OUT:-$(mktemp -d /tmp/parity-XXXX)}; PORT=${PORT:-3210}
cd "$REPO" || exit 1
echo "repo=$(git rev-parse --short HEAD) old=$(git rev-parse --short $OLD) new=$(git rev-parse --short $NEW) out=$OUT"

extract() { mkdir -p "$2"; git archive "$1" prototypes/nilesys | tar -x -C "$2" --strip-components=2; rm -rf "$2/data"; }

run_review() { # $1=label $2=server-dir $3=suite-file
  local data="$OUT/$1-data"; rm -rf "$data"; mkdir -p "$data"
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/session"; then echo "ABORT: port $PORT already in use" >&2; exit 2; fi
  pushd "$2" > /dev/null
  PORT=$PORT DB_FILE="$data/db.json" node server.js > "$OUT/$1.server.log" 2>&1 &
  local pid=$!; popd > /dev/null
  for i in $(seq 1 50); do grep -q "Nile Systems" "$OUT/$1.server.log" && break; sleep 0.1; done
  if ! grep -q "Nile Systems" "$OUT/$1.server.log"; then echo "ABORT: server for $1 did not start" >&2; cat "$OUT/$1.server.log" >&2; exit 2; fi
  # The old server ignores DB_FILE and writes <dir>/data/db.json; PERSIST-1 reads DB_FILE.
  local dbf="$data/db.json"; [ -f "$dbf" ] || dbf="$2/data/db.json"
  # In-process run (not `node --test`): Node 20's runner can fail to deserialize Arabic child output.
  (cd "$2" && BASE="http://127.0.0.1:$PORT" DB_FILE="$dbf" timeout 200 node "$3" > "$OUT/$1.log" 2>&1)
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/session" || break; sleep 0.1; done
  # verdicts: "<ID> <PASS|FAIL>" ; outcomes: "<ID> <ok|not_ok>"
  grep -E "^(✅ PASS|❌ FAIL)" "$OUT/$1.log" | sed -E 's/^✅ PASS  ([A-Z0-9-]+).*/\1 PASS/; s/^❌ FAIL  ([A-Z0-9-]+).*/\1 FAIL/' | sort -u > "$OUT/$1.verdicts"
  grep -E "^(not )?ok [0-9]+ - " "$OUT/$1.log" | sed -E 's/^(not ok|ok) [0-9]+ - ([A-Z0-9-]+).*/\2 \1/; s/not ok$/not_ok/' | grep -E "^[A-Z]" | sort -u > "$OUT/$1.outcomes"
}

extract "$OLD" "$OUT/old"; extract "$NEW" "$OUT/new"
git show "$OLD:prototypes/nilesys/tests/review.test.js" > "$OUT/review-v2.test.js"
git show "$NEW:prototypes/nilesys/tests/review.test.js" > "$OUT/review-v3.test.js"
cp "$OUT/review-v2.test.js" "$OUT/review-v3.test.js" "$OUT/old/tests/" 2>/dev/null || { mkdir -p "$OUT/old/tests"; cp "$OUT/review-v2.test.js" "$OUT/review-v3.test.js" "$OUT/old/tests/"; }
cp "$OUT/review-v2.test.js" "$OUT/review-v3.test.js" "$OUT/new/tests/"

run_review v2-old "$OUT/old" tests/review-v2.test.js
run_review v2-new "$OUT/new" tests/review-v2.test.js
run_review v3-old "$OUT/old" tests/review-v3.test.js
run_review v3-new "$OUT/new" tests/review-v3.test.js

printf "\n%-9s | %-16s | %-16s | %-16s | %-16s\n" ID "v2 @ old" "v2 @ new" "v3 @ old" "v3 @ new"
printf "%-9s | %-16s | %-16s | %-16s | %-16s\n" "" "verdict/outcome" "verdict/outcome" "verdict/outcome" "verdict/outcome"
for id in $(cat "$OUT"/*.verdicts "$OUT"/*.outcomes | awk '{print $1}' | sort -u); do
  row=""; for r in v2-old v2-new v3-old v3-new; do
    v=$(awk -v k="$id" '$1==k{print $2}' "$OUT/$r.verdicts"); o=$(awk -v k="$id" '$1==k{print $2}' "$OUT/$r.outcomes")
    row="$row | $(printf '%-16s' "${v:-—}/${o:-—}")"; done
  printf "%-9s%s\n" "$id" "$row"
done
for r in v2-old v2-new v3-old v3-new; do echo "$r: verdict PASS=$(grep -c PASS "$OUT/$r.verdicts") FAIL=$(grep -c FAIL "$OUT/$r.verdicts") | node:test ok=$(grep -c ' ok$' "$OUT/$r.outcomes") not_ok=$(grep -c not_ok "$OUT/$r.outcomes")"; done

# regression suite (self-contained: own port + temp DB_FILE) against both servers
for side in old new; do
  cp "$REPO/prototypes/nilesys/tests/regression.test.js" "$OUT/$side/tests/regression.test.js" 2>/dev/null || git show "$NEW:prototypes/nilesys/tests/regression.test.js" > "$OUT/$side/tests/regression.test.js"
  (cd "$OUT/$side" && timeout 200 node --test tests/regression.test.js > "$OUT/regression-$side.log" 2>&1)
  echo "regression @ $side: $(grep -E '^# (pass|fail)' "$OUT/regression-$side.log" | tr '\n' ' ')"
  grep -E "^not ok" "$OUT/regression-$side.log" | sed 's/^/   /'
done
echo "logs: $OUT"
