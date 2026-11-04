#!/usr/bin/env bash
# Disposable REAL PostgreSQL for the *.pg.test.ts suites — the no-apt route.
#
# tools/local-pg.sh needs apt (Debian postgresql). Sandboxes without apt
# network access can use this instead: the PyPI `pgserver` wheel bundles
# genuine PostgreSQL binaries (16.x), so the server below is a real server
# with real locking/RLS/concurrency — NOT a mock, NOT PGlite.
#
#   ./tools/local-pg-pgserver.sh start   # venv + initdb + pg_ctl start (127.0.0.1:5433)
#   ./tools/local-pg-pgserver.sh url     # print the admin URL
#   ./tools/local-pg-pgserver.sh test    # start (if needed) + full vitest suite with PG tests ON
#   ./tools/local-pg-pgserver.sh stop    # stop the cluster (data stays in /tmp)
#
# Everything lives in /tmp (venv, cluster). Nothing touches the repository
# or any non-test database. The pg-harness creates and drops its own
# databases/roles; only the cluster-wide `nile_app` role may remain.
set -euo pipefail

PORT="${NILE_TEST_PG_PORT:-5433}"
VENV="${NILE_PG_VENV:-/tmp/pgvenv}"
DATA="${NILE_PG_DATA:-/tmp/pgdata2}"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
BIN="" # filled by ensure_bin

ensure_bin() {
  if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q pgserver
  fi
  BIN="$("$VENV/bin/python" -c 'import pgserver,os;print(os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin"))')"
}

running() { [ -n "$BIN" ] && "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

start() {
  ensure_bin
  if running; then echo "$URL"; return 0; fi
  if [ ! -s "$DATA/PG_VERSION" ]; then
    "$BIN/initdb" -D "$DATA" -U postgres --auth=trust --no-instructions >/dev/null
  fi
  "$BIN/pg_ctl" -D "$DATA" -l /tmp/pg.log -o "-p ${PORT} -h 127.0.0.1 -k /tmp" start >/dev/null
  echo "$URL"
}

stop() { ensure_bin; "$BIN/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true; }

case "${1:-start}" in
  start) start ;;
  url)   echo "$URL" ;;
  stop)  stop ;;
  test)  start >/dev/null; NILE_TEST_PG_ADMIN_URL="$URL" npm test ;;
  *) echo "usage: $0 {start|url|test|stop}" >&2; exit 2 ;;
esac
