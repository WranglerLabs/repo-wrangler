#!/usr/bin/env bash
#
# Storage adapter smoke test (PN-7). Boots the real Node server host against the
# configured backend, proving that migrations apply and a live query succeeds
# through the storage seam. Run once per backend by the adapter-matrix CI job:
#
#   SQLITE_PATH=/tmp/rw.db ./scripts/adapter-smoke.sh          # SQLite
#   DATABASE_URL=postgres://… ./scripts/adapter-smoke.sh       # PostgreSQL
#
# Demo mode keeps it secret-free; the point is the storage adapter, not auth.
set -uo pipefail

PORT="${PORT:-8799}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

label="sqlite"; [ -n "${DATABASE_URL:-}" ] && label="postgres"
echo "=== adapter smoke: $label ==="

DEMO_MODE=true PORT="$PORT" ENABLE_SCHEDULER=false \
  node --experimental-sqlite --import tsx apps/server/src/index.ts > /tmp/rw-smoke.log 2>&1 &
SVR=$!
trap 'kill $SVR 2>/dev/null' EXIT

ready=""
for _ in $(seq 1 40); do
  body="$(curl -sf "http://127.0.0.1:$PORT/health/ready" 2>/dev/null)" || true
  if printf '%s' "$body" | grep -q '"ok":true'; then ready="$body"; break; fi
  sleep 1
done

echo "--- server log ---"; cat /tmp/rw-smoke.log

if [ -z "$ready" ]; then
  echo "FAIL: /health/ready never reported ok (adapter did not come up)"; exit 1
fi
echo "ready: $ready"

# A real request path through the app on top of the adapter.
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/repositories")"
echo "GET /api/v1/repositories -> $code"
[ "$code" = "200" ] || { echo "FAIL: repositories endpoint returned $code"; exit 1; }

echo "PASS: $label adapter served the app end-to-end"
