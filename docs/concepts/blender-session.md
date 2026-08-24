# Blender session

A Blender session (`pipeline/blender.js`, class `BlenderSession`) is the only
way the pipeline touches Blender: a Blender MCP server spoken to over stdio
JSON-RPC — never hand-rolled sockets, never a hand-managed Blender subprocess.

## Shape

- **Spawn**: `uvx blender-mcp` by default. `blender.mcp.command` +
  `blender.mcp.args` override the executable; `blender.mcp.uvx: false` falls
  back to a bare `blender-mcp` binary; `blender.mcp.uvxBin` renames the uvx
  executable.
- **Tool surface used**: exactly `get_scene_info` and
  `execute_blender_code`. Everything else — import, export, decimate, rig —
  is Blender Python (`bpy`) sent through `execute_blender_code`.
- **Environment**: the MCP child gets a scrubbed environment (PATH/HOME
  only), so no credential can leak through env inheritance.

## Lifecycle

1. `BlenderSession.start(options)` spawns the server and performs the MCP
   handshake. A failed start throws:
   `blender MCP server failed to start (<command> <args>): <reason>. Run
   'node pipeline/setup.js' to provision Blender + blender-mcp.`
2. `execute(code)` wraps the code in `try/except` **before** sending. The
   addon's execute path has a nasty failure mode: an exception escaping the
   executed block kills the addon's server thread (every subsequent call gets
   "connection refused"). Wrapping turns bugs into captured
   `GAC-EXEC-ERROR: <traceback>` output instead — the error still reaches the
   caller, but the session survives.
3. `importModel(path)` resets the scene through the data API only (objects,
   actions, meshes, armatures, materials) and imports the GLB.
   `bpy.ops.wm.read_factory_settings` is never used — it would wipe the
   addon's scene properties and kill the MCP server thread. Stale actions are
   removed too: leaving an old `flap` action made previews pick a stale clip
   after repeated imports.
4. `exportGlb(path)` exports the whole scene and stats the file; an absent
   or empty file throws `export produced no file at <path>: <reason>`.
5. `close()` ends the MCP process.

## Health

`isHealthy()` is three checks, because the MCP server starts fine even when
the Blender side of the bridge is dead — tool listing alone lies:

1. the server answers `tools/list`,
2. `execute_blender_code` is among the tools,
3. a trivial `print("health-probe")` actually round-trips into Blender.

`glina blender-health` prints `{ healthy, tools }` and exits 0/1 on it.

## The bridge itself

The MCP server bridges into Blender's own addon listening on
`127.0.0.1:9876`. The addon requires a GUI Blender session.
`scripts/ensure-blender.sh` guards invocations: if port 9876 is not
answering it launches Blender (`$BLENDER_BIN`, default
`/opt/homebrew/bin/blender`), waits up to 60 s for the bridge, then execs the
real command — or fails with `ensure-blender: bridge did not come up`.

## Invariants

- One session per job; sessions are always closed in a `finally`, even on
  failure.
- Consumers that see three consecutive execute failures stop probing — see
  the [sculpt job](sculpt-job.md) bridge-down rule.
