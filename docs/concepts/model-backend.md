# Model backend

The model backend (`pipeline/llm.js`) is the sculpt loop's one transport:
`complete({ system, messages, maxTokens }) → { text, stopReason }`. There are
exactly two backends, both OpenAI-compatible `/v1/chat/completions`:

- **Brama** — the org model router. The default and the only fleet path.
- **OpenRouter** — an operator-sanctioned alternative, enabled only by
  explicit config (`models.openrouter` present, `models.backend:
  "openrouter"` to prefer it). The key still comes from Skarbiec.

Direct provider APIs (Anthropic, OpenAI, …) intentionally do not exist in
this package. Configuring one is refused outright:

> `direct provider APIs are not supported in this package — model access goes
> through Brama (models.brama) or, when the operator sanctions it in the
> config, OpenRouter (models.openrouter)`

That sentence fires when `models.anthropic`, `models.openai`, or
`models.direct` appears in the config. The code paths were deleted at the
owner's demand, not gated.

## Selection

`models.backend` (default `"brama"`) chooses a preference, with the following
actual selection order:

- Brama is ready only when `models.brama.url`, `key`, and `bearer` are all
  present. With the default/`brama` preference, a ready Brama is selected.
- Otherwise, a configured `models.openrouter.key` selects OpenRouter — even
  when the preference says `brama`. This lets an incomplete Brama tuple fall
  back to the sanctioned alternative.
- With `openrouter` preferred but no OpenRouter key, a ready Brama is used.
  If Brama is incomplete too, setup fails with
  `backend=brama requested but models.brama.url/key/bearer are not configured`
  (the wording is inherited from the implementation).
- With neither backend usable:
  `no model backend configured — set models.brama.url+key+bearer or
  models.openrouter.key (skarbiec:// references in pipeline.config.json)`.

## Brama transport

- URL: `models.brama.url` + `/v1/chat/completions`; model `models.brama.model`
  (default `any`).
- Auth: `authorization: Bearer <bearer>` plus the HMAC agent identity —
  `x-agent-id`, `x-agent-timestamp`, and `x-agent-signature =
  HMAC-SHA256(key, "<agent_id>:<ts>:<sha256(body)>")`.
- Retries: `attempts` (default 4) on transport failures and HTTP 502/503,
  with linear backoff; a signed refusal (401/403) or routing error never
  retries. Each attempt has a hard deadline (`timeoutMs`, default 120 s) so a
  black-holed connection can never hang the sculpt loop.
- A 200 with empty content (reasoning routes burning the token cap on hidden
  thinking) retries like a 502.
- Exhaustion: `brama unreachable after N attempts: <reason>`; a final HTTP
  error is `brama HTTP <status>: <message>`.

## OpenRouter transport

- URL: `models.openrouter.url` (default `https://openrouter.ai/api/v1`) +
  `/chat/completions`; plain bearer key; `timeoutMs` default 180 s;
  `attempts` default 4.
- 429 and 5xx retry; other 4xx are final (`openrouter HTTP N: <message>`).
  Empty content retries. Exhaustion:
  `openrouter unreachable after N attempts: …` /
  `openrouter exhausted N attempts: …`.

## Message shape

Anthropic-style content blocks are flattened to plain OpenAI messages;
image blocks (viewport screenshots) are replaced by the note
`[viewport screenshot attached]` — neither backend receives raw image bytes.

## Reply parsing

`parseJsonFrom(text)` extracts the sculpt step: a fenced ```json block first,
else a balanced-brace scan that takes the first object that parses. Refusals:
`model reply JSON does not parse: <reason>` and
`model reply contained no JSON object: <prefix>`.
