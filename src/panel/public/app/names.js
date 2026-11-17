// @ts-check
// Display names (064), shared by the server (src/core/providers) and the panel (this file is also a panel module): the one source of the names people see for providers, accounts and models — in the panel (it
// shows the `name` and `label` the API returns), the admin MCP tools and activity summaries. Rules (DESIGN.md, Names):
// short and familiar, no explanations in brackets, how you connect belongs on the provider's page, an account label
// only when there are several ("ChatGPT · work"), models as people know them ("GPT-5.5", "Claude Sonnet 4.5"); the
// raw id stays available as small print.

/** Provider names by type. */
export const PROVIDER_NAMES = Object.freeze({
  anthropic: 'Claude', openai: 'OpenAI', chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', openrouter: 'OpenRouter', compatible: 'Custom (OpenAI-compatible)',
});

/** "ChatGPT", or "ChatGPT · work" for a labelled account. */
export const accountName = (/** @type {string} */ type, label = '', fallback = '') => `${PROVIDER_NAMES[type] || fallback || type}${label ? ` · ${label}` : ''}`;

/**
 * A model as people know it. The provider's own display name wins; a raw id is tidied: "gpt-5.1-codex" → "GPT-5.1
 * Codex", "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5", "deepseek/deepseek-v4:free" → "Deepseek V4 · free".
 */
export function modelName(/** @type {string} */ id, label = '') {
  if (label && label !== id) return label;
  const raw = String(id || '').split('/').pop() || '';
  const free = /:free$/.test(raw);
  const words = [];
  for (const w of raw.replace(/:free$/, '').replace(/[-_]\d{8}$/, '').split(/[-_\s]+/).filter(Boolean)) {
    const prev = words.at(-1);
    if (/^\d+$/.test(w) && prev && /^\d+(\.\d+)?$/.test(prev)) words[words.length - 1] = `${prev}.${w}`; // 4-5 → 4.5
    else words.push(w);
  }
  const nice = words.map((w) => (/^\d|^o\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
  const text = nice[0] === 'Gpt' ? `GPT-${nice.slice(1).join(' ')}`.replace(/^GPT-$/, 'GPT') : nice.join(' ');
  return `${text || raw}${free ? ' · free' : ''}`;
}
