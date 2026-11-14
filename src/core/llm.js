import Anthropic from '@anthropic-ai/sdk';
import { getSecret, onSecretChange } from './config.js';

let client = null;
onSecretChange((name) => { if (name === 'ANTHROPIC_API_KEY') client = null; });

/** Shared Anthropic client (created lazily from the panel-managed secret). */
export function claude() {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (Panel → Secrets)');
  if (!client) client = new Anthropic({ apiKey });
  return client;
}
