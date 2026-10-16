#!/bin/sh
# Drive the glina-mcp stdio server by hand: initialize, list tools, and run
# the quality gate through the glina_verify_asset tool. Frames are newline-
# delimited JSON-RPC 2.0 on stdin/stdout.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Without a config argument verify reads pipeline.config.json and, only when
# that file is absent, gates with the built-in thresholds. An explicit config
# that cannot be read, or a default that exists and does not parse, is refused
# with the file and the cause, as glina verify refuses it.
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"glina_verify_asset\",\"arguments\":{\"path\":\"$ROOT/assets/models/smok.glb\"}}}"
} | node "$ROOT/pipeline/mcp.js"
