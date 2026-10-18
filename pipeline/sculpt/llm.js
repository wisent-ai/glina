// llm.js — model access for the pipeline's LLM loop.
//
// Two backends, both OpenAI-compatible /v1/chat/completions:
//   models.brama              Brama, the org model router; requests are
//                             HMAC-signed with the agent identity.
//   models.openai_compatible  any provider the user runs or rents, for a
//                             user without Brama: url, bearer and model,
//                             sent unsigned.
// Credentials come from the pipeline config like everything else (role://
// references, or the owner-only credentials file that answers them without
// Stado) — never from env. Exactly one backend is declared. Brama's address
// is models.brama.url when the config names one, otherwise the address Stado's
// service directory wrote for this machine (~/.stado/forwards/brama.local);
// the model is always the alias the config names.
//
// The transport is one function: complete({ system, messages, maxTokens,
// answer }) → { text, object, stopReason }. Every reply is the arguments of
// one required call of the function `answer` names ({ name, schema }), whose
// parameters are its strict schema, never JSON searched for in prose; `text`
// is those arguments as the model wrote them.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// https://tc39.es/ecma262/#sec-hours-minutes-second-and-milliseconds "msPerSecond = 1000"
const MS_PER_SECOND = 1000;

export class LlmError extends Error {
  /** `details` is { status, cause } when the failure has them. */
  constructor(message, details) {
    super(message);
    this.name = 'LlmError';
    this.status = details?.status;
    this.cause = details?.cause;
  }
}

/**
 * Build the model transport from a resolved pipeline config. `transport` is
 * { fetchImpl } when the caller supplies its own fetch.
 */
export function buildCompleter(models, transport) {
  const fetch_ = transport?.fetchImpl ?? fetch;
  if (models === undefined) {
    throw new LlmError(
      'no model backend is configured: declare models.brama, or models.openai_compatible ' +
        '(url, bearer, model) for a provider without Brama',
    );
  }
  const declared = Object.keys(models);
  const unknown = declared.filter((key) => key !== 'brama' && key !== 'openai_compatible');
  if (unknown.length) {
    throw new LlmError(
      `models.${unknown.join(', models.')} is not a model backend: declare models.brama, ` +
        'or models.openai_compatible for a provider without Brama',
    );
  }
  const [backend, ...more] = declared;
  if (!backend) {
    throw new LlmError(
      'no model backend is configured: declare models.brama, or models.openai_compatible ' +
        '(url, bearer, model) for a provider without Brama',
    );
  }
  if (more.length) {
    throw new LlmError('both models.brama and models.openai_compatible are declared: keep the one this pipeline uses');
  }
  if (models.openai_compatible) {
    const cfg = models.openai_compatible;
    requireFields('openai_compatible', cfg, ['url', 'bearer', 'model']);
    return completer(cfg, fetch_, 'the model provider', () => ({}));
  }
  const declaredBrama = models.brama;
  requireFields('brama', declaredBrama, ['key', 'bearer', 'agent_id', 'model']);
  const cfg = { ...declaredBrama, url: bramaUrl(declaredBrama) };
  // x-agent-id + x-agent-timestamp + x-agent-signature =
  // HMAC-SHA256(agent_auth_secret, "<agentId>:<ts>:<sha256(body)>"),
  // mirroring weles' signedRouterHeaders; the timestamp is Unix seconds.
  const sign = (bodyStr) => {
    const ts = String(Math.floor(Date.now() / MS_PER_SECOND));
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
  if (missing.length) {
    throw new LlmError(
      `models.${backend} is not configured: models.${backend}.${missing.join(`, models.${backend}.`)} missing ` +
        '(role:// references for secrets, the model alias as text, in pipeline.config.json)',
    );
  }
}

/** models.brama.url, or the address Stado's service directory published for this machine. */
function bramaUrl(cfg) {
  if (cfg.url) return cfg.url;
  const marker = join(homedir(), '.stado', 'forwards', 'brama.local');
  const unset =
    `no Brama address: models.brama.url is unset and Stado's service directory has written no ${marker} ` +
    'for this machine (run `stado service directory publish`, or set models.brama.url)';
  let contents;
  try {
    contents = readFileSync(marker, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new LlmError(unset, { cause: error });
    throw new LlmError(`cannot read ${marker}: ${error.message}`, { cause: error });
  }
  const [published] = contents.split('\n');
  if (!published.trim()) throw new LlmError(unset);
  return published.trim();
}

/**
 * One OpenAI-compatible chat completion per call, answered by one required
 * call of `answer`; `sign` adds the backend's own headers. A refusal, an
 * answer without exactly that call, arguments that are not one JSON object,
 * or a transport failure is returned as that error, naming what the backend
 * said (cli.md rule 8).
 */
function completer(cfg, fetch_, label, sign) {
  const url = `${cfg.url.replace(/\/+$/, '')}/v1/chat/completions`;
  return async function complete({ system, messages, maxTokens, answer }) {
    if (!Number.isInteger(maxTokens)) throw new LlmError(`${label}: no reply length given: the caller states max_tokens`);
    const bodyStr = JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...openAiMessages(messages)],
      tools: [{ type: 'function', function: { name: answer.name, description: `The ${answer.name} answer, as its parameters describe it.`, strict: true, parameters: answer.schema } }],
      tool_choice: { type: 'function', function: { name: answer.name } },
    });
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
    let raw;
    try {
      raw = await response.text();
    } catch (error) {
      throw new LlmError(
        `${label} HTTP ${response.status} at ${url}: reading response failed: ${error.message}`,
        { status: response.status, cause: error },
      );
    }
    if (!response.ok) {
      throw new LlmError(
        `${label} HTTP ${response.status} ${response.statusText} at ${url}; response body: ${JSON.stringify(raw)}`,
        { status: response.status },
      );
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      throw new LlmError(
        `${label} HTTP ${response.status} at ${url}: invalid JSON: ${error.message}; response: ${raw}`,
        { status: response.status, cause: error },
      );
    }
    if (!Array.isArray(body?.choices)) {
      throw new LlmError(`${label} HTTP ${response.status} at ${url}: no choices list; response: ${raw}`, { status: response.status });
    }
    const [choice] = body.choices;
    const calls = choice?.message?.tool_calls;
    if (!Array.isArray(calls)) {
      throw new LlmError(`${label} HTTP ${response.status} at ${url}: answered without calling ${answer.name}; response: ${raw}`, { status: response.status });
    }
    const [call, ...others] = calls;
    if (!call || others.length || call.function?.name !== answer.name || typeof call.function.arguments !== 'string') {
      throw new LlmError(`${label} did not answer by exactly one call of ${answer.name} with arguments text; response: ${raw}`, { status: response.status });
    }
    const text = call.function.arguments;
    let object;
    try {
      object = JSON.parse(text);
    } catch (error) {
      throw new LlmError(`${label} called ${answer.name} with arguments that are not JSON: ${error.message}; arguments: ${text}`, { cause: error });
    }
    if (object === null || typeof object !== 'object' || Array.isArray(object)) {
      throw new LlmError(`${label} called ${answer.name} with ${text}, not one JSON object`);
    }
    return { text, object, stopReason: choice.finish_reason };
  };
}

/**
 * Anthropic content-block messages → plain OpenAI messages. An image block
 * becomes a note that a viewport screenshot was taken, because the request
 * carries text only; any other block type is refused by name.
 */
function openAiMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message;
    const parts = message.content.map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image') return '[viewport screenshot attached]';
      throw new LlmError(`a ${message.role} message holds a ${JSON.stringify(block.type)} block, which a text-only request cannot carry`);
    });
    return { role: message.role, content: parts.join('\n') };
  });
}
