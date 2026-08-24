# MCP reference

`glina-mcp` (`pipeline/mcp.js`) is a newline-delimited JSON-RPC 2.0 server over stdin/stdout. Stdout contains protocol frames only; diagnostics go to stderr. Protocol version is `2024-11-05`.

## Handshake and methods

`initialize` returns:

```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "glina", "version": "1.0.0" }
}
```

Supported methods are `initialize`, `ping`, `tools/list`, and `tools/call`. Notifications (requests without a non-null `id`) produce no reply. Other methods return JSON-RPC error `-32601`, `method not found: <method>`. Invalid JSON returns `-32700`, `parse error`; a `tools/call` without a string `params.name` returns `-32602`, `params.name must be a string`.

Tool success and product refusal both use a JSON-RPC success envelope. A tool refusal is an MCP result with `isError:true` and one text content block. An exception is formatted `<ErrorName>: <message>` in that block. Tool payloads are pretty-printed JSON inside a text block rather than MCP structured content.

## Tools

### `glina_create_asset`

Runs the [studio job](concepts/studio-job.md).

| Argument | Type | Required | Meaning |
|---|---|---:|---|
| `prompt` | string | yes | Asset description; blank is refused with `prompt is required`. |
| `race` | `humans`, `dwarves`, `elves`, `skeletons` | no | Prefixes the prompt. |
| `out_dir` | string | no | Output directory; default `assets/models`. |
| `filename` | string | no | Download filename. |
| `config` | string | no | Config path; default package `pipeline.config.json`. |

Returns `{outPath, processedPath, artifactUrl, prompt, verification}` as text JSON.

### `glina_sculpt`

Runs the [sculpt job](concepts/sculpt-job.md).

| Argument | Type | Required | Meaning |
|---|---|---:|---|
| `prompt` | string | yes | Asset description; blank is refused with `prompt is required`. |
| `out_dir` | string | no | Output directory. |
| `filename` | string | no | Output GLB filename. |
| `max_rounds` | number | no | Overrides configured/default iteration cap. |
| `config` | string | no | Config path. |

Returns `{outPath, verification, rounds}`; transcript is omitted.

### `glina_verify_asset`

| Argument | Type | Required | Meaning |
|---|---|---:|---|
| `path` | string | yes | GLB path; absent/empty is refused with `path is required`. |
| `config` | string | no | Threshold config. Unreadable config is ignored and defaults apply. |

Returns the full `{ok, errors, stats, thresholds, path}` report. A normal gate rejection is still a successful tool call whose text contains `"ok": false`; clients must inspect `ok`. Only parse/I/O exceptions set `isError:true`.

### `glina_check_config`

Optional string `config` selects the file. Resolves Skarbiec references and returns recursively redacted config. It starts neither browser nor Blender.

### `glina_blender_health`

No arguments. Starts the Blender MCP client, performs an execute probe, returns `{healthy, tools}`. This reaches the live Blender bridge.

### `glina_weles_tools`

No arguments. Starts Weles MCP and returns `[{name, description}]`.

## Complete raw exchange

The repository's [MCP example](examples/mcp-verify.sh) sends initialize, initialized notification, tools/list, and `glina_verify_asset`. It was executed against `assets/models/smok.glb`; the tool returned `ok:true`, 38 meshes, 748 triangles, 5 materials, and clips `flap` / `idle`. See the [verification walkthrough](walkthrough-verify.md) for the full report.
