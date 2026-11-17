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

// 066: what a tool did, in plain words ("get_maintenance_status" → "Checked maintenance status"), for Activity and the
// Ask step chips. One mapping for the admin tools (verb_object names) and any other tool (MCP "server:tool" names).
const TOOL_VERBS = Object.freeze({
  get: 'Checked', list: 'Looked at', set: 'Changed', update: 'Updated', create: 'Created', add: 'Added', remove: 'Removed', delete: 'Deleted',
  run: 'Ran', send: 'Sent', test: 'Tested', refresh: 'Refreshed', rebuild: 'Rebuilt', restore: 'Restored', install: 'Installed', apply: 'Applied',
  erase: 'Erased', confirm: 'Confirmed', cancel: 'Cancelled', check: 'Checked', search: 'Searched', draft: 'Drafted', export: 'Exported',
  duplicate: 'Duplicated', assign: 'Assigned', load: 'Loaded', preview: 'Previewed', prepare: 'Prepared', reset: 'Reset', snooze: 'Snoozed',
  retry: 'Retried', restart: 'Restarted', save: 'Saved',
});
const TOOL_WORDS = Object.freeze({ mcp: 'tool service', os: 'OS', ai: 'AI', whatsapp: 'WhatsApp', faq: 'FAQ', dm: 'direct chat', url: 'URL', id: 'ID' });
/** "get_server_metrics" → "Checked server metrics"; "transport:connections" → "Connections (transport)". */
export function toolPhrase(/** @type {string} */ name) {
  const raw = String(name || '');
  const [server, tool] = raw.includes(':') ? raw.split(/:(.*)/s) : ['', raw];
  const words = tool.split(/[_\s-]+/).filter(Boolean).map((w) => TOOL_WORDS[w.toLowerCase()] || w.toLowerCase());
  const verb = !server && words.length > 1 ? TOOL_VERBS[words[0]] : '';
  const text = verb ? `${verb} ${words.slice(1).join(' ')}` : words.join(' ');
  const nice = text ? text[0].toUpperCase() + text.slice(1) : raw;
  return server ? `${nice} (${server})` : nice;
}
