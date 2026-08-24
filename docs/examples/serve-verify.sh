#!/bin/sh
# Start the loopback HTTP backend (`glina serve`) on an ephemeral port,
# probe /v1/health, stream one verify job as NDJSON, then shut it down.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true' EXIT

cat > "$WORK/plain.json" <<'EOF'
{ "verify": { "enabled": true, "triTarget": 6000 } }
EOF

node "$ROOT/pipeline/cli.js" serve --port 0 --config "$WORK/plain.json" \
  > "$WORK/ready.line" 2> "$WORK/serve.err" &
PID=$!

# Exactly one ready line lands on stdout: {"ready":true,"port":<number>}
i=0
until [ -s "$WORK/ready.line" ]; do
  i=$((i + 1)); [ $i -gt 50 ] && { echo "backend never became ready" >&2; exit 1; }
  sleep 0.1
done
PORT="$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "$WORK/ready.line")"
echo "backend ready on 127.0.0.1:$PORT"

echo "== GET /v1/health"
curl -s "http://127.0.0.1:$PORT/v1/health"; echo

echo "== POST /v1/verify (NDJSON stream)"
curl -s -X POST "http://127.0.0.1:$PORT/v1/verify" \
  -H 'content-type: application/json' \
  -d "{\"path\":\"$ROOT/assets/models/smok.glb\"}"
