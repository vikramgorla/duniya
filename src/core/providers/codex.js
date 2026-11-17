// Codex (074): OpenAI's official Codex CLI as a model provider, signed in with the owner's ChatGPT plan through its own
// device sign-in (`codex login --device-auth`: a link and a one-time code shown in the panel). Each agent turn runs
// `codex exec --json`, ephemeral, read-only sandbox, with its shell, patch, web, image, plugin, skill and goal tools
// switched off and a model catalog without tool search, so the model sees only Duniya's tools (the bridge, MCP server
// "duniya", calls approved here because Duniya's runner decides). Codex keeps its sign-in in DATA_DIR/apps/codex/home
// (auth.json, refreshed by Codex itself). Measured on Linux x64, 0.169.0: about 140 MB RSS while it answers, about
// 0.3 s from start to the first request; nothing runs between turns.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fail } from '../config.js';
import { netEnv } from '../mcp-local.js';
import { appDir, appHome, installApp, removeApp, appChat, appExec, startCheck } from './apps.js';
import { toPrompt } from './copilot.js';

const SPEC = '@openai/codex@0.169.0';
const NAME = 'Codex';
const ID = 'codex';
const codexHome = () => join(appHome(ID), 'codex');
const catalogFile = () => join(codexHome(), 'duniya-models.json');
/** The native binary inside the platform package (the npm `codex` command is a Node wrapper we skip: one process less). */
function bin() {
  const base = join(appDir(ID), 'node_modules', '@openai');
  try {
    for (const pkg of readdirSync(base).filter((d) => d.startsWith('codex-'))) {
      const vendor = join(base, pkg, 'vendor');
      for (const triple of readdirSync(vendor)) {
        const f = join(vendor, triple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
        if (existsSync(f)) return f;
      }
    }
  } catch { /* not downloaded */ }
  return join(base, 'codex', 'bin', 'codex');
}
export const installed = () => existsSync(bin());
const authFile = () => join(codexHome(), 'auth.json');
const readAuth = () => { try { return JSON.parse(readFileSync(authFile(), 'utf8')); } catch { return null; } };
export const configured = () => installed() && !!readAuth()?.tokens;
const env = () => { mkdirSync(codexHome(), { recursive: true, mode: 0o700 }); return { CODEX_HOME: codexHome() }; };
const app = { id: ID, bin };

export const install = () => installApp({ id: ID, name: NAME, spec: SPEC, ready: installed });

/** Signed-in account from the ID token Codex stored: "email · Plus" (shown to the owner only). */
export function account() {
  const tok = readAuth()?.tokens?.id_token;
  if (!tok) return '';
  try {
    const claims = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8'));
    const plan = claims['https://api.openai.com/auth']?.chatgpt_plan_type;
    return [claims.email, plan ? plan[0].toUpperCase() + plan.slice(1) : ''].filter(Boolean).join(' · ');
  } catch { return ''; }
}

// ---------- device sign-in ----------
let login = null; // { child, url, code, at, error, done }
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'); // colour codes in Codex's output
/**
 * Start `codex login --device-auth`; resolves with { url, code } once Codex printed them. The process keeps waiting
 * (up to 15 minutes) for the owner to finish in their browser; onDone(ok, message) is called when it ends.
 */
export function startLogin(onDone) {
  if (!installed()) throw fail(`${NAME} is not downloaded yet`, 400);
  if (login?.child && login.url && !login.done) return Promise.resolve({ url: login.url, code: login.code, expiresIn: Math.max(0, 900 - Math.round((Date.now() - login.at) / 1000)) });
  startCheck(NAME, 60);
  return new Promise((resolve, reject) => {
    const child = spawn(bin(), ['login', '--device-auth'], { cwd: appHome(ID), env: { PATH: process.env.PATH || '/usr/bin:/bin', ...netEnv(), HOME: appHome(ID), ...env() }, stdio: ['ignore', 'pipe', 'pipe'] });
    const cur = { child, url: '', code: '', at: Date.now(), error: '', done: false };
    login = cur;
    let out = '';
    const onData = (d) => {
      out = (out + String(d).replace(ANSI, '')).slice(-8000);
      if (!cur.url) cur.url = out.match(/https:\/\/\S+\/device\S*/)?.[0] || '';
      if (!cur.code) cur.code = out.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0] || '';
      if (cur.url && cur.code && !cur.sent) { cur.sent = true; resolve({ url: cur.url, code: cur.code, expiresIn: 900 }); }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', (e) => { cur.done = true; reject(fail(`Could not start the Codex sign-in: ${e.message}`)); });
    child.on('exit', (code) => {
      cur.done = true;
      const ok = code === 0 && !!readAuth()?.tokens;
      const lines = out.trim().split('\n').map((l) => l.trim()).filter((l) => l && !/^WARNING:/.test(l));
      const msg = lines.reverse().find((l) => /error|fail|expired|denied|cancel/i.test(l)) || lines[0] || '';
      if (!cur.sent) reject(fail(`The Codex sign-in did not start: ${msg.slice(0, 200) || `code ${code}`}`, 502));
      if (login === cur) login = null;
      try { onDone?.(ok, ok ? '' : msg.slice(0, 200)); } catch { /* reporting only */ }
    });
  });
}
function cancelLogin() { try { login?.child?.kill('SIGTERM'); } catch { /* gone */ } login = null; }

export async function disconnect() {
  cancelLogin();
  if (installed()) await appExec(app, ['logout'], { env: env(), timeoutMs: 20000 }).catch(() => {});
  removeApp(ID);
}

// ---------- models ----------
/**
 * Codex's model catalog (`codex debug models`, refreshed for the signed-in plan). A copy without tool search, patch,
 * web search and the coding-agent extras is kept for turns, so the model sees only Duniya's tools.
 */
async function listModels() {
  if (!installed()) throw fail(`${NAME} is not downloaded on this server yet: connect it again`);
  const { stdout } = await appExec(app, ['debug', 'models'], { env: env(), timeoutMs: 30000 });
  const cat = JSON.parse(stdout);
  for (const m of cat.models || []) {
    m.supports_search_tool = false;
    delete m.apply_patch_tool_type; delete m.web_search_tool_type;
    m.include_skills_usage_instructions = false; m.include_plugin_usage_instructions = false; m.include_apps_usage_instructions = false;
  }
  writeFileSync(catalogFile(), JSON.stringify(cat), { mode: 0o600 });
  return (cat.models || []).filter((m) => m.slug && m.visibility === 'list')
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
}

const OFF = ['shell_tool', 'unified_exec', 'shell_snapshot', 'goals', 'view_image', 'image_generation', 'apps', 'plugins', 'computer_use', 'browser_use',
  'in_app_browser', 'multi_agent', 'hooks', 'skill_search', 'tool_suggest', 'sleep_tool'];
const def = {
  id: ID, name: NAME, needMb: 160, ready: installed, bin,
  launch: ({ model, systemFile, bridge, home }) => ({
    cmd: bin(),
    args: ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', home, '-m', model,
      ...OFF.flatMap((f) => ['--disable', f]),
      '-c', 'web_search="disabled"', '-c', `model_catalog_json=${JSON.stringify(catalogFile())}`, '-c', `model_instructions_file=${JSON.stringify(systemFile)}`,
      '-c', `mcp_servers.duniya={url=${JSON.stringify(bridge.url)},bearer_token_env_var="DUNIYA_TOOLS_TOKEN",default_tools_approval_mode="approve",tool_timeout_sec=300}`, '-'],
    env: { ...env(), DUNIYA_TOOLS_TOKEN: bridge.token },
  }),
  parse(j, turn) {
    const it = j.item;
    if (j.type === 'item.started' && it?.type === 'mcp_tool_call' && it.server === 'duniya') turn.expect(turn.expected + 1);
    else if (j.type === 'item.completed' && it?.type === 'agent_message') turn.text(it.text || '');
    else if (j.type === 'turn.completed') { turn.usage({ input_tokens: j.usage?.input_tokens || 0, output_tokens: j.usage?.output_tokens || 0 }); turn.end(); }
    else if (j.type === 'turn.failed' || (j.type === 'error' && !/^Reconnecting/i.test(j.message || ''))) turn.fail(turnError(String(j.error?.message || j.message || 'error')));
  },
};

/** Codex's error message as an error the fallback understands ("You've hit your usage limit… try again in 2 hours"). */
function turnError(text) {
  const e = new Error(`Codex: ${text.slice(0, 300)}`);
  if (/usage limit|usage_limit/i.test(text)) return Object.assign(e, { code: 'usage_limit_reached' });
  if (/401|unauthori[sz]ed|log ?in again|sign in again|refresh token|token (is )?expired/i.test(text)) return Object.assign(e, { code: 'authentication_error', status: 401 });
  return e;
}

/** Adapter for the Codex account. */
export const codexAdapter = () => ({
  configured,
  listModels,
  chat: async (args) => {
    if (!existsSync(catalogFile())) await listModels();
    return appChat(def, args, toPrompt);
  },
});
