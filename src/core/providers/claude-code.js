// Claude Code (074): the official Claude Code CLI as a model provider, signed in with the owner's Claude subscription
// (Pro / Max) through a long-lived token from `claude setup-token` (Anthropic's documented way to use a subscription
// on a machine without a browser). Each agent turn runs `claude -p` in stream-json mode: no built-in tools (no shell,
// files or web), no settings, plugins or MCP servers of its own, nothing saved; Duniya's tools come through the bridge
// (app-bridge.js) as the MCP server "duniya". Measured on Linux x64, 2.1.326: about 200 MB RSS while it answers,
// about 0.5 s from start to the first request; nothing runs between turns.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSecret, setSecret } from '../store.js';
import { fail } from '../config.js';
import { appDir, installApp, removeApp, appChat } from './apps.js';
import { toPrompt } from './copilot.js';

export const SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';
const SPEC = '@anthropic-ai/claude-code@2.1.326';
const NAME = 'Claude Code';
const bin = () => join(appDir('claudecode'), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
export const installed = () => existsSync(bin());
const configured = (secret = SECRET) => !!getSecret(secret);
/** Claude Code takes model aliases; it maps them to the newest model of each family for the subscription. */
const MODELS = [{ id: 'sonnet', label: 'Claude Sonnet' }, { id: 'opus', label: 'Claude Opus' }, { id: 'haiku', label: 'Claude Haiku' }];

/** A token from `claude setup-token` (sk-ant-oat01-…). API keys belong to the Claude (API) provider. */
export function checkToken(token) {
  const t = String(token || '').trim();
  if (!t) throw fail('Paste the token that `claude setup-token` printed', 400, { field: 'token' });
  if (/^sk-ant-api/.test(t)) throw fail('That is an API key: add it under Claude instead. Here, paste the token from `claude setup-token` (sk-ant-oat01-…).', 400, { field: 'token' });
  if (!/^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/.test(t)) throw fail('That doesn’t look like a Claude subscription token. It starts with sk-ant-oat01-', 400, { field: 'token' });
  return t;
}

export const install = () => installApp({ id: 'claudecode', name: NAME, spec: SPEC, ready: installed });

const def = (secret) => ({
  id: 'claudecode', name: NAME, needMb: 220, ready: installed, bin,
  launch: ({ model, systemFile, bridge }) => ({
    cmd: bin(),
    args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--system-prompt-file', systemFile,
      '--mcp-config', JSON.stringify({ mcpServers: { duniya: { type: 'http', url: bridge.url, headers: { Authorization: `Bearer ${bridge.token}` } } } }),
      '--strict-mcp-config', '--setting-sources', '', '--tools', '', '--allowedTools', 'mcp__duniya', '--permission-mode', 'dontAsk',
      '--no-session-persistence', '--disable-slash-commands'],
    env: { CLAUDE_CODE_OAUTH_TOKEN: getSecret(secret), DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', MCP_TOOL_TIMEOUT: '300000' },
  }),
  parse(j, turn) {
    if (j.type === 'assistant' && !j.parent_tool_use_id) {
      const blocks = j.message?.content || [];
      if (j.message?.model === '<synthetic>') return; // an error the result line repeats
      turn.text(blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
      const calls = blocks.filter((b) => b.type === 'tool_use' && String(b.name).startsWith('mcp__duniya__')).length;
      if (calls) turn.expect(calls);
    } else if (j.type === 'rate_limit_event' && j.rate_limit_info?.status === 'rejected') {
      const at = Number(j.rate_limit_info.resetsAt) * 1000;
      turn.fail(Object.assign(new Error(`Claude usage limit reached${at ? ` (resets ${new Date(at).toISOString()})` : ''}`), { code: 'usage_limit_reached', ...(at > Date.now() ? { retryAfterMs: at - Date.now() } : {}) }));
    } else if (j.type === 'result') {
      if (j.usage) turn.usage({ input_tokens: (j.usage.input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0), output_tokens: j.usage.output_tokens || 0 });
      if (j.is_error) turn.fail(resultError(String(j.result || j.subtype || 'error')));
      else turn.end();
    }
  },
});

/** Claude Code's error sentence as an error the fallback understands. */
function resultError(text) {
  const e = new Error(`Claude Code: ${text.slice(0, 300)}`);
  if (/hit your .{0,40}limit|usage limit|out of (extra )?usage/i.test(text)) return Object.assign(e, { code: 'usage_limit_reached' });
  if (/authenticat|invalid bearer|oauth token|\/login|401/i.test(text)) return Object.assign(e, { code: 'authentication_error', status: 401 });
  if (/not your usage limit|rate limit|overloaded|529/i.test(text)) return Object.assign(e, { code: 'rate_limit_exceeded' });
  return e;
}

export function disconnect(secret = SECRET, { last = true } = {}) {
  setSecret(secret, '');
  if (last) removeApp('claudecode');
}

/** Adapter for one Claude Code account. */
export const claudeCodeAdapter = (secret = SECRET) => ({
  configured: () => configured(secret),
  listModels: async () => { if (!installed()) throw fail(`${NAME} is not downloaded on this server yet: connect it again`); return MODELS; },
  chat: (args) => appChat(def(secret), args, toPrompt),
});
