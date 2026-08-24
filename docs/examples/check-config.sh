#!/bin/sh
# Demonstrate the config loader's secrets policy without a vault:
# a config with no secret values loads and prints; a config holding an
# inline password is refused before anything else runs.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== non-secret config loads and prints"
cat > "$WORK/plain.json" <<'EOF'
{ "llm": { "maxRounds": 8 }, "verify": { "enabled": true, "triTarget": 6000 }, "blender": { "enabled": false, "mcp": {} } }
EOF
node "$ROOT/pipeline/cli.js" check-config --config "$WORK/plain.json"

echo "== inline secret is refused (exit 1)"
cat > "$WORK/inline.json" <<'EOF'
{ "credentials": { "username": "you@example.com", "password": "hunter2" } }
EOF
if node "$ROOT/pipeline/cli.js" check-config --config "$WORK/inline.json"; then
  echo "unexpected: inline secret accepted" >&2
  exit 1
fi
echo "inline secret refused as expected"
