// @ts-check
import Anthropic from '@anthropic-ai/sdk';
import { getSecret, onSecretChange } from '../store.js';

export const SECRET = 'ANTHROPIC_API_KEY';
export const RECOMMENDED = { agent: 'claude-sonnet-5-5', background: 'claude-haiku-5-5' };
// 2.58: built-in web search (a server tool Anthropic runs): at most this many searches per model call, at Anthropic's
// published price of $10 per 1,000 searches (tokens of the results are billed as input as usual)
const WEB_SEARCH = { type: 'web_search_20250305', name: 'web_search' };
const SEARCHES_PER_CALL = 3;
const SEARCH_PRICE_USD = 0.01;

const clients = new Map(); // secret name -> { key, client }
onSecretChange((n) => clients.delete(n));

/** Adapter for one Anthropic account (042): its API key lives in the secret `secret`. */
export function anthropicAdapter(secret = SECRET) {
  const sdk = () => {
    const apiKey = getSecret(secret);
    if (!apiKey) throw Object.assign(new Error('Anthropic API key is not set (Models)'), { code: 'no_model' });
    const hit = clients.get(secret);
    if (hit?.key === apiKey) return hit.client;
    // maxRetries 0: the fallback chain (042) decides what happens after a failure, not the SDK.
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    clients.set(secret, { key: apiKey, client });
    return client;
  };
  return {
    configured: () => !!getSecret(secret),
    async listModels() {
      const out = [];
      for await (const m of sdk().models.list({ limit: 100 })) out.push({ id: m.id, label: m.display_name || m.id });
      return out;
    },
    streams: true,
    natives: ['web_search'], searchPrice: SEARCH_PRICE_USD,
    /** onText (047, #83): stream the answer's text; deltas go to onText, the final message (content, usage) is returned. */
    async chat({ model, system, messages, tools, natives = [], maxTokens, onText = null, signal = undefined }) {
      const all = natives.includes('web_search') ? [...(tools || []), { ...WEB_SEARCH, max_uses: SEARCHES_PER_CALL }] : tools;
      const params = { model, max_tokens: maxTokens, system, tools: all, messages };
      let res;
      if (!onText) res = await sdk().messages.create(params);
      else {
        const stream = sdk().messages.stream(params, { signal }); // 066: Stop in the Ask box ends the call
        stream.on('text', (delta) => { if (delta) onText(delta); });
        res = await stream.finalMessage();
      }
      return answerOf(res);
    },
  };
}

/** The adapter's answer: content (server-tool blocks kept for the next call), stop reason, usage with web searches, sources. */
function answerOf(res) {
  const searches = res.usage?.server_tool_use?.web_search_requests || 0;
  const usage = { ...(res.usage || {}), ...(searches ? { web_searches: searches } : {}) };
  const sources = res.content.flatMap((b) => (b.type === 'text' ? b.citations || [] : [])).filter((c) => c.url).map((c) => ({ url: c.url, title: c.title || '' }));
  return { content: res.content, stop_reason: res.stop_reason, usage, sources };
}
