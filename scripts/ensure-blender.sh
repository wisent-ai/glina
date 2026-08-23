#!/bin/sh
# ensure-blender.sh — guarantee a live Blender MCP bridge, then exec CMD.
#
# The blender-mcp server starts even when the Blender side of the bridge is
# dead, and the Blender app itself sometimes quits between sessions. Every
# pipeline invocation therefore runs through this check: if port 9876 is not
# answering, launch Blender (GUI session required by the addon) and wait for
# the bridge, then hand over to the real command.
set -eu

wait_bridge() {
  i=0
  while [ $i -lt 20 ]; do
    if nc -z 127.0.0.1 9876 2>/dev/null; then return 0; fi
    sleep 3
    i=$((i + 1))
  done
  return 1
}

if ! nc -z 127.0.0.1 9876 2>/dev/null; then
  echo "ensure-blender: bridge down, launching Blender"
  nohup "${BLENDER_BIN:-/opt/homebrew/bin/blender}" >/dev/null 2>&1 &
  if ! wait_bridge; then
    echo "ensure-blender: bridge did not come up" >&2
    exit 1
  fi
fi

exec "$@"
