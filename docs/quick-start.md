# Quick start

The non-mutating evidence blocks below were executed against this repository
with Node v22 on macOS. Generation commands are interface examples: they
require configured external systems and operate on the current Blender or
browser session.

## Use a checkout

This repository is the current artifact; registry availability is not assumed.
From the checkout:

```sh
npm install
node pipeline/cli.js help
```

The package defines two bins for an installed or linked copy: `glina` (the
CLI, `pipeline/cli.js`) and `glina-mcp` (the MCP stdio server,
`pipeline/mcp.js`). The rest of this page uses the checkout form where
captured output matters.

## See the surface

```console
$ node pipeline/cli.js help
usage: node pipeline/cli.js <command> [args]

commands:
  create <prompt> [--race r] [--out dir] [--config path]
  sculpt <prompt> [--out dir] [--filename f.glb] [--rounds n] [--config path]
                                  LLM (Opus) iteratively builds the model in Blender
  preview-anim <file.glb> [--clip name] [--frames n] [--fps n] [--out f.gif]
                                  render an animated GIF of one clip through Blender
  animate <file.glb> [--preset dragon] [--out animated.glb]
                                  apply deterministic, visibly moving actions
  showcase dragon [--out dragon.glb]
                                  build a cohesive animated reference asset
  verify <file.glb> [--config path]   structural + optional render gate
  check-config [--config path]
  weles-tools
  serve [--port n] [--config path]   loopback HTTP/JSON backend for desktop apps
  blender-health              MCP handshake + execute_blender_code probe
  setup [--check] [--dry-run] provision Blender + uv + blender-mcp
```

## Run the quality gate — no config, no vault, no Blender

`verify` works with defaults when the config file is absent:

```console
$ node pipeline/cli.js verify assets/models/smok.glb --config /nonexistent.json
{
  "ok": true,
  "errors": [],
  "stats": {
    "meshes": 38,
    "primitives": 38,
    "triangles": 748,
    "materials": 5,
    "animations": 2,
    "animationNames": [ "flap", "idle" ],
    ...
  },
  "thresholds": { "triTarget": 6000, "triTolerancePct": 100, ... },
  "path": "assets/models/smok.glb"
}
$ echo $?
0
```

A failing gate exits 1 and names every reason in `errors` — see the
[verify walkthrough](walkthrough-verify.md).

## Check the toolchain

`setup --check` only probes (`which`), never installs:

```console
$ node pipeline/cli.js setup --check
{
  "healthy": true,
  "steps": [
    { "step": "blender", "status": "present", "path": "/opt/homebrew/bin/blender" },
    { "step": "uv", "status": "present", "path": "/opt/homebrew/bin/uvx" }
  ]
}
```

Plain `setup` provisions Blender + uv (brew on macOS, apt/snap on Linux) and
resolves the `blender-mcp` package through uvx.

## Configure for generation

Sculpting and studio generation need `pipeline.config.json` (default path:
the repo/package root; override with `--config`):

```sh
cp pipeline.config.example.json pipeline.config.json   # then edit
```

Every secret in it must be a `skarbiec://<item>/<field>` reference — the
loader refuses inline values:

```console
$ node pipeline/cli.js check-config --config inline.json
error: config key 'credentials.password' holds an inline value; secrets must be skarbiec://<item>/<field> references
```

Store studio credentials once in the vault:

```sh
skarbiec set TEXT2GAME_ACCOUNT --type login \
  --field login_email=you@example.com --field login_password=...
```

`check-config` then validates the file, resolves every reference against the
vault, and prints the config with resolved secrets replaced by
`<resolved: ok>`. See [configuration](configuration.md) for every key.

## Generate

```sh
glina sculpt "gothic dwarven tower, low-poly"        # LLM drives Blender
glina create "dwarven axe warrior" --race dwarves    # studio flow via Weles browser
glina blender-health                                 # probe the Blender session first
```

Both flows end in the verification gate; a broken or off-budget asset fails
the job. For agent hosts run `glina-mcp` ([MCP reference](mcp.md)); for the
desktop app the backend is `glina serve`
([serve walkthrough](walkthrough-serve.md)).
