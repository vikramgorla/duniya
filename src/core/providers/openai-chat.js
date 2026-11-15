// OpenAI Chat Completions adapter: used for OpenAI API keys and any OpenAI-compatible endpoint.
// Internal message format is Anthropic-style blocks; this converts both ways.

export function toChatMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      const results = blocks.filter((b) => b.type === 'tool_result');
      for (const r of results) {
        const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
        out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.is_error ? `ERROR: ${content}` : content });
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

export const toChatTools = (tools = []) => tools.map((t) => ({
  type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } },
}));

export function fromChatResponse(json) {
  const choice = json.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const c of msg.tool_calls || []) {
    let input;
    try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { _raw: c.function?.arguments }; }
    content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input });
  }
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { content, stop_reason: stop, usage: { input_tokens: json.usage?.prompt_tokens || 0, output_tokens: json.usage?.completion_tokens || 0 } };
}

async function request(url, key, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `${res.status} ${text.slice(0, 200)}`);
    // status, code and headers let the fallback chain (042) classify the failure and respect Retry-After.
    err.status = res.status; err.code = json?.error?.code || json?.error?.type; err.headers = res.headers; err.error = json;
    throw err;
  }
  return json;
}

/** Create an adapter for a base URL ("https://api.openai.com/v1", "https://openrouter.ai/api/v1", …). */
export function chatCompletionsProvider({ baseUrl, key, official = false }) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async listModels() {
      const json = await request(`${base}/models`, key());
      // OpenRouter-style listings publish prices (USD per token): keep them as USD per 1M tokens for usage costs.
      const per1M = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) || Number(v) < 0 ? undefined : Number(v) * 1e6);
      return (json.data || json.models || []).map((m) => {
        const pin = per1M(m.pricing?.prompt); const pout = per1M(m.pricing?.completion);
        return { id: m.id || m.slug, label: m.name || m.display_name || m.id || m.slug, ...(pin !== undefined && pout !== undefined ? { price: { in: pin, out: pout } } : {}) };
      }).filter((m) => m.id);
    },
    async chat({ model, system, messages, tools, maxTokens }) {
      const body = {
        model, messages: toChatMessages(system, messages),
        ...(tools?.length ? { tools: toChatTools(tools) } : {}),
        ...(official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      };
      return fromChatResponse(await request(`${base}/chat/completions`, key(), body));
    },
  };
}
