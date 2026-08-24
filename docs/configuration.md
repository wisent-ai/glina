# Configuration reference

The default file is `pipeline.config.json` beside the package root. CLI `--config`, MCP tool argument `config`, and the HTTP server's launch-time `--config` select another path. The file is plain JSON; there is no layer merge and no environment-variable substitution.

Start from `pipeline.config.example.json`. The tables below cover every key read by the pipeline.

## Secret policy

A secret value must be a reference of the exact form `skarbiec://<item>/<field>`. Item characters may be letters, digits, `.`, `_`, `:`, or `-`; field characters may also contain `.`, `_`, or `-`. The loader recursively resolves every such string with `skarbiec get <item>`.

Inside the top-level `credentials` and `models` trees, string values under keys matching token, secret, password/passwd, credential, cookie, API key, or private key are refused unless they are Skarbiec references:

```text
config key 'credentials.password' holds an inline value; secrets must be skarbiec://<item>/<field> references
```

`check-config` prints resolved configuration with secret-shaped `credentials` and `models` fields replaced by `<resolved: ok>`. `SKARBIEC_BIN` is the only operational environment override actually read by this version; it changes the vault CLI binary. `PATH` and `HOME` are forwarded to MCP child processes. Credential environment variables are not a configuration path.

## Browser and studio

| Key | Type | Default | Used by |
|---|---|---:|---|
| `browser.engine` | string | `chromium` | Browser name passed to `weles_browser_start`. |
| `browser.headless` | boolean | `true` | Headless flag passed to Weles. |
| `credentials.username` | Skarbiec ref | required for `create` | Filled into the login-user selector. |
| `credentials.password` | Skarbiec ref | required for `create` | Filled into the login-password selector. |
| `studio.loginUrl` | URL string | required for `create` | First navigation. |
| `studio.generateUrl` | URL string | required for `create` | Generation page. |
| `studio.selectors.loginUser` | CSS selector | required | Username field. |
| `studio.selectors.loginPassword` | CSS selector | required | Password field. |
| `studio.selectors.loginSubmit` | CSS selector | required | Login submit control. |
| `studio.selectors.promptInput` | CSS selector | required | Prompt field. |
| `studio.selectors.generateSubmit` | CSS selector | required | Generation submit control. |
| `studio.artifact.pollExpression` | JavaScript expression | required | Evaluated until it returns an `http…` string. |
| `studio.artifact.timeoutMs` | number | `300000` | Maximum artifact wait. |
| `studio.artifact.intervalMs` | number | `5000` | Poll interval. |
| `artifact.downloadHeaders` | object of string values | `{}` | Headers added to the final artifact download. This is top-level `artifact`, not `studio.artifact`. |

The example config targets Hunyuan3D selectors, but the workflow itself has no provider-specific URL or selector.

## Model routing

`models.backend` is `brama` by default. Values are not separately schema-validated; selection depends on the presence rules below.

| Key | Type | Default / requirement |
|---|---|---|
| `models.backend` | `brama` or `openrouter` | `brama`; selects preferred backend. |
| `models.brama.url` | URL string | Required for a ready Brama config; `/v1/chat/completions` is appended. |
| `models.brama.key` | Skarbiec ref | Required HMAC agent-auth secret. |
| `models.brama.bearer` | Skarbiec ref | Required bearer token. |
| `models.brama.agent_id` | Skarbiec ref/string | Used in `x-agent-id` and HMAC input; operationally required. |
| `models.brama.model` | string | `any`. |
| `models.brama.attempts` | integer | `4`. |
| `models.brama.timeoutMs` | number | `120000` per attempt. |
| `models.openrouter.url` | URL string | `https://openrouter.ai/api/v1`; `/chat/completions` is appended. |
| `models.openrouter.key` | Skarbiec ref | Presence makes OpenRouter ready. |
| `models.openrouter.model` | string | No code default; configure it when using OpenRouter. |
| `models.openrouter.attempts` | integer | `4`. |
| `models.openrouter.timeoutMs` | number | `180000` per attempt. |
| `llm.maxRounds` | integer | `12`. |
| `llm.maxTokens` | integer | `8192` in sculpt jobs. |

`models.anthropic`, `models.openai`, and `models.direct` are reserved refusals, not supported backends. If any is present, model setup fails with the direct-provider refusal documented in [model backend](concepts/model-backend.md).

## Verification

| Key | Type | Default | Meaning |
|---|---|---:|---|
| `verify.enabled` | boolean | enabled unless exactly `false` | Controls the gate inside `create` and `sculpt`; standalone `verify` always runs. |
| `verify.triTarget` | number | `6000` | Nominal triangle target. |
| `verify.triTolerancePct` | number | `100` | Extra percentage accepted; maximum is target × `(100 + tolerance)/100`. |
| `verify.requireMaterials` | boolean | `true` | Require at least one material. |
| `verify.requireAnimations` | boolean | `false` | Require clips and at least one changing float channel. |
| `verify.minAnimationClips` | integer | `0` | Minimum clip count. |
| `verify.minBytes` | integer | `100` | Minimum file bytes. |
| `verify.maxBytes` | integer | `67108864` | Maximum file bytes (64 MiB). |
| `verify.render` | boolean | `false` | Import through Blender and render a 512×512 smoke frame. |
| `verify.throwOnFail` | boolean | `false` for direct API use | Internal job mode: turn an `ok:false` report into `VerifyError`. Jobs force it to `true`; operators normally should not set it. |

## Blender

| Key | Type | Default | Meaning |
|---|---|---:|---|
| `blender.enabled` | boolean | `false` in example | Enables post-processing for studio (`create`) jobs. Sculpting always needs Blender regardless of this flag. |
| `blender.processCode` | string | none | Python body after studio GLB import; receives `INPUT_PATH` and `OUTPUT_PATH` globals. Export still happens afterward. |
| `blender.mcp.command` | string | none | Explicit MCP command. When set, `args` below are used. |
| `blender.mcp.args` | string array | `[]` | Arguments for explicit `command`. |
| `blender.mcp.uvx` | boolean | `true` | With no explicit command, `false` selects bare `blender-mcp`; otherwise uvx is used. |
| `blender.mcp.uvxBin` | string | `uvx` | uvx executable name/path. |

With defaults, the spawn is `uvx blender-mcp`. There is no config key for the Blender add-on's `127.0.0.1:9876`; that belongs to `blender-mcp`/Blender.

## Resolved handoff files

The hidden operational command `glina export-config --config input.json --out resolved.json` resolves references locally, adds `"_resolved": true`, and writes mode 0600. The marker tells the loader the inline values came from the vault and prevents the inline-secret guard from rejecting that file. The file contains real secrets: use it only as a short-lived worker handoff and delete it after use.
