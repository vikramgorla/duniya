import Anthropic from '@anthropic-ai/sdk';
import { getSecret, onSecretChange } from '../store.js';

export const id = 'anthropic';
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
    async chat({ model, system, messages, tools, maxTokens }) {
      const res = await sdk().messages.create({ model, max_tokens: maxTokens, system, tools, messages });
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage || {} };
    },
  };
}

const primary = anthropicAdapter(SECRET);
export const configured = primary.configured;
export const listModels = primary.listModels;
export const chat = primary.chat;
