# Runnable examples

All examples run from any working directory by finding the repository relative to their own file. The shell scripts use temporary directories and clean them on exit.

| Example | What it demonstrates | External systems |
|---|---|---|
| [`examples/verify-asset.sh`](examples/verify-asset.sh) | Passing defaults and a deliberate multi-reason gate refusal. | None; local file parser only. |
| [`examples/check-config.sh`](examples/check-config.sh) | A non-secret config and an inline-password refusal. | None; the samples contain no Skarbiec refs. |
| [`examples/serve-verify.sh`](examples/serve-verify.sh) | Ephemeral loopback backend, health JSON, and a terminal NDJSON verify result. | Local Node process and curl; no Blender/Weles/vault. |
| [`examples/mcp-verify.sh`](examples/mcp-verify.sh) | Raw MCP initialize, tools/list, and `glina_verify_asset`. | Local `glina-mcp`; no Blender/Weles/vault. |
| [`examples/card-art.mjs`](examples/card-art.mjs) | Generate a dwarven rare forge SVG through `cardArtSvg`. | None. |

## Run them

From the repository root:

```sh
sh docs/examples/verify-asset.sh
sh docs/examples/check-config.sh
sh docs/examples/serve-verify.sh
sh docs/examples/mcp-verify.sh
node docs/examples/card-art.mjs /tmp/glina-card.svg
```

These five examples were executed during documentation authoring. Observed evidence:

- reference dragon: 38 meshes, 748 triangles, 5 materials, two clips (`flap`, `idle`), 8 moving channels;
- strict gate: `over triangle budget: 748 > 450 (target 300)` and `too few animation clips: 2 < 3 [flap, idle]`;
- inline config secret: exact refusal `config key 'credentials.password' holds an inline value; secrets must be skarbiec://<item>/<field> references`;
- HTTP: `GET /v1/health` returned status `ok`; verification returned terminal NDJSON status 0;
- MCP: protocol `2024-11-05`, six tools listed, verify tool returned the same accepted report;
- card art: the example wrote a complete SVG (the reported path depends on the supplied output argument).

For annotated output, follow [the verify walkthrough](walkthrough-verify.md) and [the serve walkthrough](walkthrough-serve.md).

## Safety boundary

None of these examples contacts the live Blender bridge. Commands that do — `sculpt`, `blender-health`, `animate`, `showcase`, `preview-anim`, or verification with `verify.render:true` — are intentionally not presented as unattended examples because they operate through the current Blender GUI/add-on session.
