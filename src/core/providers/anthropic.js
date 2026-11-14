import Anthropic from '@anthropic-ai/sdk';
import { getSecret, onSecretChange } from '../store.js';

let client = null;
onSecretChange((n) => { if (n === 'ANTHROPIC_API_KEY') client = null; });

export const id = 'anthropic';
export const configured = () => !!getSecret('ANTHROPIC_API_KEY');
export const RECOMMENDED = { bot: 'claude-sonnet-5-5', background: 'claude-haiku-5-5' };

function sdk() {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Anthropic API key is not set (Models)');
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export async function listModels() {
  const out = [];
  for await (const m of sdk().models.list({ limit: 100 })) out.push({ id: m.id, label: m.display_name || m.id });
  return out;
}

export async function chat({ model, system, messages, tools, maxTokens }) {
  const res = await sdk().messages.create({ model, max_tokens: maxTokens, system, tools, messages });
  return { content: res.content, stop_reason: res.stop_reason, usage: res.usage || {} };
}
