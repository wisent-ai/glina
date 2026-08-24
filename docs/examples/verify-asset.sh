#!/bin/sh
# Run the GLB quality gate against the repo's reference dragon, twice:
# once with default thresholds (passes) and once with deliberately strict
# thresholds (fails, exit 1). No vault, browser, or Blender is touched.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== default thresholds (no config file needed)"
node "$ROOT/pipeline/cli.js" verify "$ROOT/assets/models/smok.glb" \
  --config "$WORK/absent.json"

echo "== strict thresholds (gate refuses, exit 1)"
cat > "$WORK/strict.json" <<'EOF'
{ "verify": { "triTarget": 300, "triTolerancePct": 50, "requireAnimations": true, "minAnimationClips": 3 } }
EOF
if node "$ROOT/pipeline/cli.js" verify "$ROOT/assets/models/smok.glb" \
  --config "$WORK/strict.json"; then
  echo "unexpected: strict gate passed" >&2
  exit 1
fi
echo "strict gate refused as expected"
