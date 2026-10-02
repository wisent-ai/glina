// llm.js — model access for the pipeline's LLM loop.
//
// Two backends, both OpenAI-compatible /v1/chat/completions:
//   models.brama              Brama, the org model router; requests are
//                             HMAC-signed with the agent identity.
//   models.openai_compatible  any provider the user runs or rents, for a
//                             user without Brama: url, bearer and model,
//                             sent unsigned.
// Credentials come from the pipeline config like everything else (skarbiec://
// references, or the owner-only credentials file that answers them without
// Skarbiec) — never from env. Exactly one backend is declared.
//
// The transport is one function: complete({ system, messages, maxTokens })
// → text. Injected as a seam in tests.

import { createHash, createHmac } from 'node:crypto';

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
  const declared = Object.keys(models);
  const unknown = declared.filter((key) => key !== 'brama' && key !== 'openai_compatible');
  if (unknown.length > 0) {
    throw new LlmError(
      `models.${unknown.join(', models.')} is not a model backend: declare models.brama, ` +
        'or models.openai_compatible for a provider without Brama',
    );
  }
  if (declared.length !== 1) {
    throw new LlmError(
      declared.length === 0
        ? 'no model backend is configured: declare models.brama, or models.openai_compatible ' +
            '(url, bearer, model) for a provider without Brama'
        : 'both models.brama and models.openai_compatible are declared: keep the one this pipeline uses',
    );
  }
  if (models.openai_compatible) {
    const cfg = models.openai_compatible;
    requireFields('openai_compatible', cfg, ['url', 'bearer', 'model']);
    return completer(cfg, fetch_, 'the model provider', () => ({}));
  }
  const cfg = models.brama;
  requireFields('brama', cfg, ['url', 'key', 'bearer', 'agent_id']);
  // x-agent-id + x-agent-timestamp + x-agent-signature =
  // HMAC-SHA256(agent_auth_secret, "<agentId>:<ts>:<sha256(body)>"),
  // mirroring weles' signedRouterHeaders.
  const sign = (bodyStr) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const bodyHash = createHash('sha256').update(bodyStr).digest('hex');
    const signature = createHmac('sha256', cfg.key)
      .update(`${cfg.agent_id}:${ts}:${bodyHash}`)
      .digest('hex');
    return { 'x-agent-id': cfg.agent_id, 'x-agent-timestamp': ts, 'x-agent-signature': signature };
  };
  return completer(cfg, fetch_, 'brama', sign);
}

function requireFields(backend, cfg, fields) {
  const missing = fields.filter((key) => !cfg?.[key]);
  if (missing.length > 0) {
    throw new LlmError(
      `models.${backend} is not configured: models.${backend}.${missing.join(`, models.${backend}.`)} missing ` +
        '(skarbiec:// references in pipeline.config.json)',
    );
  }
}

/** One OpenAI-compatible chat completion per call; `sign` adds the backend's own headers. */
function completer(cfg, fetch_, label, sign) {
  const url = `${cfg.url.replace(/\/+$/, '')}/v1/chat/completions`;
  return async function complete({ system, messages, maxTokens = 4096 }) {
    const bodyStr = JSON.stringify({
      model: cfg.model ?? 'any',
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...openAiMessages(messages)],
    });
    // One request. A refusal, an empty answer or a transport failure is
    // returned as that error, naming what the backend said (cli.md rule 8).
    let response;
    try {
      response = await fetch_(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.bearer}`,
          ...sign(bodyStr),
        },
        body: bodyStr,
      });
    } catch (error) {
      throw new LlmError(`${label} unreachable at ${url}: ${error.message}`, { cause: error });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new LlmError(
        `${label} HTTP ${response.status}: ${body?.error?.message ?? 'unknown'}`,
        { status: response.status },
      );
    }
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      throw new LlmError(
        `${label} answered with no content (finish_reason ${body.choices?.[0]?.finish_reason ?? 'none'})`,
        { status: response.status },
      );
    }
    return { text, stopReason: body.choices?.[0]?.finish_reason };
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
