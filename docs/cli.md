# CLI reference

Installed binary: `glina`. In a checkout, replace `glina` with `node pipeline/cli.js`. Successful commands print JSON to stdout except `help` and `weles-tools`; operational progress and refusals go to stderr.

Argument parsing is intentionally small: `--name value` becomes a string, a flag without a following value becomes `true`, and remaining words are positional. Unknown options are ignored by commands that do not read them.

## Commands

### `glina help`

Prints usage. No command is equivalent. Exit 0.

### `glina create <prompt> [--race <race>] [--out <dir>] [--config <path>]`

Runs the hosted-studio job through Weles. `--race` prefixes the prompt with the race word and is also returned in the job input; the CLI does not constrain its value. `--out` defaults to `assets/models`. Output is `{outPath, processedPath, artifactUrl, prompt, verification}`. Missing prompt: `error: create requires a prompt`, exit 2.

### `glina sculpt <prompt> [--out <dir>] [--filename <file.glb>] [--rounds <n>] [--config <path>]`

Runs the model→Blender iterative sculpt loop. Defaults: output directory `assets/models`, filename is a 48-character ASCII slug of the prompt, rounds from `llm.maxRounds` then 12. Round thoughts print as `[round N] …` on stderr. Output is `{outPath, verification, rounds}`; the transcript is deliberately omitted. Missing prompt exits 2 with `error: sculpt requires a prompt`.

### `glina verify <file.glb> [--config <path>]`

Runs structural verification and optional render smoke. A missing/unreadable config is ignored and gate defaults apply. Prints the complete report; exit 0 when `ok:true`, 1 when `ok:false`, 2 when the path is missing (`error: verify requires a .glb path`). An unparseable file is an exception and exits 1.

### `glina check-config [--config <path>]`

Reads JSON, refuses inline secrets, resolves all `skarbiec://` values, then prints a recursively redacted config. It does not start Weles or Blender. Missing/invalid/unresolvable config exits 1 with `error: <reason>`.

### `glina blender-health`

Starts the default Blender MCP session, lists tools, and executes a trivial Blender probe. Prints `{healthy, tools}` and exits 0/1 according to `healthy`. This command reaches the live Blender bridge; do not use it merely to inspect configuration.

### `glina weles-tools`

Starts `weles-mcp`, performs the MCP handshake, and prints one `name — description` line per exposed tool. Failure exits 1.

### `glina preview-anim <file.glb> [--clip <name>] [--frames <n>] [--fps <n>] [--out <file.gif>] [--config <path>]`

Imports the GLB through Blender, selects the named clip (or the longest action), renders up to 24 frames by default at 512×512, and assembles a looping GIF at 10 fps by default. `ffmpeg` is preferred; `uv run --with pillow` is the fallback. Default output is `<stem>-anim[-<clip>].gif`. Prints `{outPath, clip, frames, tool}`. Missing path exits 2.

### `glina animate <file.glb> [--preset dragon] [--out <file.glb>] [--config <path>]`

Applies the deterministic `dragon` animation preset through Blender, exports, and gates with materials, moving animation, and at least two clips required. Default output inserts `-animated` before `.glb`. `dragon` is the only preset; another value fails with `unknown animation preset: <value>`. Missing path exits 2.

### `glina showcase [dragon] [--out <file.glb>] [--config <path>]`

Builds the deterministic cohesive dragon reference directly in Blender, then applies the strict animated gate. The positional asset defaults to `dragon`; it is the only supported asset. Default output is `assets/models/<asset>-showcase.glb`. Unknown asset: `unknown showcase asset: <asset>`.

### `glina serve [--port <n>] [--config <path>]`

Starts the loopback desktop backend on `127.0.0.1`. Port defaults to 8080; `0` requests an ephemeral port. The first and only stdout protocol line is `{"ready":true,"port":N}`; the process then serves until terminated. Invalid/non-integer/out-of-range port exits 2 with `error: serve requires --port <n> (0 = ephemeral)`. See [HTTP reference](http.md).

### `glina setup [--check] [--dry-run]`

Builds the macOS or Linux provisioning plan for Blender and uv. `--check` only uses `which` and never installs. Without it, missing tools are installed (Homebrew on macOS; apt/snap and the uv installer on Linux), then `blender-mcp` is resolved through uvx. `--dry-run` reports would-install/would-resolve. Prints `{healthy, steps}` and exits 0/1.

### `glina export-config --out <path> [--config <path>]`

Operational, intentionally omitted from the friendly help and released surface. Resolves vault references locally, writes a `_resolved:true` JSON file, chmods it to 0600, and prints only `{out, resolved:true}`. Missing `--out` exits 2. The output contains secrets; see [configuration](configuration.md#resolved-handoff-files).

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Command completed, health passed, or gate accepted. |
| 1 | Runtime/config/integration error, unhealthy probe, or gate refusal. |
| 2 | CLI usage error or unknown command. |

An unknown command prints `unknown command: <name>` followed by usage and exits 2.
