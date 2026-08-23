// llm.js — model access for the pipeline's LLM loop.
//
// ONE backend, no exceptions: Brama, the org model router
// (OpenAI-compatible /v1/chat/completions). Credentials come from the
// pipeline config via skarbiec:// refs like everything else — never
// from env. There is intentionally NO direct provider API code in this
// package (no Anthropic/OpenAI/etc. endpoints): the user has explicitly
// rejected direct provider calls for this pipeline.
//
// The transport is one function: complete({ system, messages, maxTokens })
// → text. Injected as a seam in tests.

export class LlmError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.cause = cause;
  }
}

/** Build the model transport from a resolved pipeline config. */
export function buildCompleter(models = {}, { fetchImpl } = {}) {
  const fetch_ = fetchImpl ?? fetch;
  if (models.anthropic || models.openai || models.direct) {
    throw new LlmError(
      'direct provider APIs are not supported in this package — model access goes ' +
        'only through Brama (models.brama.url + models.brama.key)',
    );
  }
  if (models.brama?.url && models.brama?.key && models.brama?.bearer) {
    return bramaCompleter(models.brama, fetch_);
  }
  throw new LlmError(
    'no model backend configured — set models.brama.url + key + bearer ' +
      '(skarbiec:// references in pipeline.config.json). Brama requires the ' +
      'client bearer AND the agent HMAC signature on every call.',
  );
}

/** Brama router shape — HMAC-signed requests (mirrors weles' signedRouterHeaders). */
function bramaCompleter(cfg, fetch_) {
  const url = `${cfg.url.replace(/\/+$/, '')}/v1/chat/completions`;
  return async function complete({ system, messages, maxTokens = 4096 }) {
    const bodyStr = JSON.stringify({
      model: cfg.model ?? 'any',
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...openAiMessages(messages)],
    });
    // x-agent-id + x-agent-timestamp + x-agent-signature =
    // HMAC-SHA256(agent_auth_secret, "<agentId>:<ts>:<sha256(body)>").
    const { createHash, createHmac } = await import('node:crypto');
    // The fleet path to Brama can flap (a resolver adapter re-dials its
    // upstream per connection), so transport-level failures retry; a signed
    // refusal (401/403) or a routing error never does.
    const attempts = cfg.attempts ?? 4;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const ts = String(Math.floor(Date.now() / 1000));
      const bodyHash = createHash('sha256').update(bodyStr).digest('hex');
      const signature = createHmac('sha256', cfg.key)
        .update(`${cfg.agent_id}:${ts}:${bodyHash}`)
        .digest('hex');
      try {
        const response = await fetch_(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.bearer}`,
            'x-agent-id': cfg.agent_id,
            'x-agent-timestamp': ts,
            'x-agent-signature': signature,
          },
          body: bodyStr,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new LlmError(
            `brama HTTP ${response.status}: ${body?.error?.message ?? 'unknown'}`,
            { status: response.status },
          );
          if ((response.status === 502 || response.status === 503) && attempt < attempts) {
            lastError = error;
            await new Promise((r) => setTimeout(r, attempt * 1500));
            continue;
          }
          throw error;
        }
        const text = body.choices?.[0]?.message?.content ?? '';
        return { text, stopReason: body.choices?.[0]?.finish_reason };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        lastError = error;
        if (attempt >= attempts) break;
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    throw new LlmError(`brama unreachable after ${attempts} attempts: ${lastError?.message ?? 'unknown'}`);
  };
}

/** Anthropic content-block messages → plain OpenAI messages (images dropped with a note). */
function openAiMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message;
    const parts = (message.content ?? []).map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image') return '[viewport screenshot attached]';
      return '';
    });
    return { role: message.role, content: parts.join('\n') };
  });
}

/** Pull the first JSON object out of a model reply (fences / prose tolerated). */
export function parseJsonFrom(text) {
  const fence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch (error) {
      throw new LlmError(`model reply JSON does not parse: ${error.message}`, { cause: error });
    }
  }
  // Balanced-brace scan: the model may emit prose, multiple objects, or a
  // trailing duplicate — take the first object that actually parses.
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // try the next '{' further along
          }
        }
        if (depth < 0) break;
      }
    }
  }
  throw new LlmError(`model reply contained no JSON object: ${text.slice(0, 200)}`);
}
