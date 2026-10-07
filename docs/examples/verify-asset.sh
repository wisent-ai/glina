#!/bin/sh
# Run the GLB quality gate against the repo's reference dragon, twice:
# once with a config that states no thresholds (structure, materials and
# animation presence only; passes) and once with deliberately strict
# thresholds (fails, exit 1). No vault, browser, or Blender is touched.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/build/verify-walkthrough"
mkdir -p "$WORK"

echo "== no stated thresholds"
echo '{}' > "$WORK/plain.json"
node "$ROOT/pipeline/cli.js" verify "$ROOT/assets/models/smok.glb" \
  --config "$WORK/plain.json"

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
