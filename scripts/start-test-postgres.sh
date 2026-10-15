#!/usr/bin/env bash
# Always creates a new private cluster; never connects to a host development server.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
pgbin=${PG_TEST_BIN:-}
if [[ -z "$pgbin" ]] && command -v brew >/dev/null; then pgbin="$(brew --prefix postgresql@17)/bin"; fi
if [[ -z "$pgbin" ]]; then echo 'Set PG_TEST_BIN to PostgreSQL 17 binaries.' >&2; exit 1; fi
cluster=$(mktemp -d "${TMPDIR:-/tmp}/vinyl-test-cluster.XXXXXXXX")
cleanup() {
  "$pgbin/pg_ctl" -D "$cluster/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf -- "$cluster"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
admin_password=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
export VINYL_TEST_PASSWORD=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
printf '%s\n' "$admin_password" > "$cluster/password"
# Bind only loopback; choose a currently free port. A race fails startup, never reuses a server.
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
"$pgbin/initdb" -D "$cluster/data" -U vinyl_test_admin --pwfile="$cluster/password" --auth-local=trust --auth-host=scram-sha-256 > "$cluster/init.log" 2>&1
"$pgbin/pg_ctl" -D "$cluster/data" -l "$cluster/server.log" -o "-h 127.0.0.1 -p $port -k $cluster" -w -t 30 start > "$cluster/start.log" 2>&1
for attempt in {1..30}; do
  if "$pgbin/pg_isready" -h 127.0.0.1 -p "$port" -q; then break; fi
  if [[ "$attempt" -eq 30 ]]; then echo 'Disposable PostgreSQL startup failed.' >&2; exit 1; fi
  sleep 1
done
PGPASSWORD="$admin_password" "$pgbin/psql" -X -h 127.0.0.1 -p "$port" -U vinyl_test_admin -d postgres -f "$root/test-support/provision-test-db.sql" > "$cluster/provision.log" 2>&1
export TEST_DATABASE_URL="postgresql://vinyl_shop_test:${VINYL_TEST_PASSWORD}@127.0.0.1:${port}/vinyl_shop_test"
unset VINYL_TEST_PASSWORD admin_password PGPASSWORD PGOPTIONS
if [[ "$#" -eq 0 ]]; then set -- npm test; fi
"$@"
