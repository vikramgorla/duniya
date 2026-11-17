// @ts-check
import Anthropic from '@anthropic-ai/sdk';
import { getSecret, onSecretChange } from '../store.js';

export const SECRET = 'ANTHROPIC_API_KEY';
export const RECOMMENDED = { agent: 'claude-sonnet-5-5', background: 'claude-haiku-5-5' };

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
    /** onText (047, #83): stream the answer's text; deltas go to onText, the final message (content, usage) is returned. */
    async chat({ model, system, messages, tools, maxTokens, onText = null }) {
      const params = { model, max_tokens: maxTokens, system, tools, messages };
      if (!onText) {
        const res = await sdk().messages.create(params);
        return { content: res.content, stop_reason: res.stop_reason, usage: res.usage || {} };
      }
      const stream = sdk().messages.stream(params);
      stream.on('text', (delta) => { if (delta) onText(delta); });
      const res = await stream.finalMessage();
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage || {} };
    },
  };
}
