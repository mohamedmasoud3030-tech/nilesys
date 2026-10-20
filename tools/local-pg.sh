#!/usr/bin/env bash
# A disposable local PostgreSQL for the real-PG tests, in one command.
#
# Why this exists: two test files (refund-concurrency, shift-close-race) skip themselves unless
# NILE_TEST_PG_ADMIN_URL is set. Before 2026-10-19 nobody set it in a sandbox, so 22 concurrency
# assertions silently never ran, and an agent could not honestly claim concurrency was correct.
# A missing environment is a bug in the environment, not in the agent.
#
#   ./tools/local-pg.sh start   # install if needed, start the cluster, print the URL
#   ./tools/local-pg.sh url     # print the URL only
#   ./tools/local-pg.sh test    # start, then run the full suite with real PostgreSQL
#   ./tools/local-pg.sh stop    # stop the cluster
#
# The server is disposable: the harness creates and drops its own databases and roles. The only
# cluster-wide object it leaves behind is the `nile_app` runtime role, which the harness tolerates.
set -euo pipefail

PORT="${NILE_TEST_PG_PORT:-5432}"
PASSWORD="${NILE_TEST_PG_PASSWORD:-pgpass}"
URL="postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres"

need_install() { ! command -v pg_ctlcluster >/dev/null 2>&1; }

start() {
  if need_install; then
    echo "installing PostgreSQL..." >&2
    sudo apt-get update -qq
    sudo apt-get install -y -qq postgresql >&2
  fi
  sudo pg_ctlcluster "$(pg_lsclusters -h | awk 'NR==1{print $1}')" "$(pg_lsclusters -h | awk 'NR==1{print $2}')" start 2>/dev/null || true
  # The harness connects over TCP as a superuser; set a password so the default scram policy works.
  sudo -u postgres psql -q -c "ALTER USER postgres PASSWORD '${PASSWORD}';"
  for _ in $(seq 1 20); do
    if PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
      echo "$URL"
      return 0
    fi
    sleep 0.5
  done
  echo "could not reach PostgreSQL on 127.0.0.1:${PORT}" >&2
  return 1
}

stop() {
  sudo pg_ctlcluster "$(pg_lsclusters -h | awk 'NR==1{print $1}')" "$(pg_lsclusters -h | awk 'NR==1{print $2}')" stop 2>/dev/null || true
}

case "${1:-start}" in
  start) start ;;
  url)   echo "$URL" ;;
  stop)  stop ;;
  test)
    NILE_TEST_PG_ADMIN_URL="$(start)" exec npx vitest run --maxWorkers=1
    ;;
  *)
    echo "usage: $0 {start|url|stop|test}" >&2
    exit 2
    ;;
esac
