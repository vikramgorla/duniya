// Panel routes for model providers (006).
import { heavyCheck } from '../../core/resources.js';
import { status, allModels, addCompatible, removeCompatible, clearModelCache, resolveModel, addOpenRouter, setFreeOnly, testProvider, clearCopilotExtras, providerModels, providers, OPENROUTER_ID,
  addAccount, renameAccount, removeAccount, newAccountId, secretFor, accountById, fallbackSettings, setFallbackSettings, strategies, setStrategy } from '../../core/providers/index.js';
import * as breaker from '../../core/providers/breaker.js';
import * as chatgpt from '../../core/providers/chatgpt.js';
import * as copilot from '../../core/providers/copilot.js';
import { setSecret, getSecret, getSettings, updateSettings } from '../../core/store.js';
import { REF_RE } from '../../core/providers/fallback-config.js';
import { activity } from '../../core/events.js';

export function providerRoutes(route) {
  route('GET', '/api/providers', async (req, res, body, q) => status({ refresh: q.get('refresh') === '1' }));

  route('POST', '/api/providers/compatible', async (req, res, body, q, p, user) => {
    const prov = addCompatible({ id: body.id, name: body.name, baseUrl: body.baseUrl, key: body.key });
    activity('system', { summary: `Model provider "${prov.id}" saved by ${user.username}` });
    return prov;
  });
  route('DELETE', '/api/providers/compatible/:id', async (req, res, body, q, p, user) => {
    removeCompatible(p.id);
    activity('system', { summary: `Model provider "${p.id}" removed by ${user.username}` });
    return { ok: true };
  });

  // OpenRouter preset (018): one tap, key stored as a secret, "Free models only" switch.
  route('POST', '/api/providers/openrouter', async (req, res, body, q, p, user) => {
    const prov = addOpenRouter({ key: body.key, freeOnly: body.freeOnly, label: body.label });
    activity('system', { summary: `OpenRouter${prov.label ? ` — ${prov.label}` : ''} ${body.key ? 'connected' : 'updated'} by ${user.username} (free models only: ${prov.freeOnly ? 'on' : 'off'})` });
    const [row] = (await status({ refresh: true })).filter((x) => x.id === (prov.id || OPENROUTER_ID));
    return row;
  });
  route('POST', '/api/providers/compatible/:id/free-only', async (req, res, body, q, p, user) => {
    const prov = setFreeOnly(p.id, !!body.on);
    if (!prov) return [404, { error: 'No such endpoint' }];
    activity('system', { summary: `Free models only ${prov.freeOnly ? 'on' : 'off'} for "${p.id}" by ${user.username}` });
    return prov;
  });

  // GitHub Copilot via the official SDK (018): owner pastes a fine-grained token; checked before it is kept.
  // body.label (042): connect another Copilot account with its own token; body.account: replace that account's token.
  route('POST', '/api/providers/copilot', async (req, res, body, q, p, user) => {
    const token = copilot.checkToken(body.token);
    // Small servers (043): the Copilot helper is a ~400 MB download running its own process; refuse it below 2 GB.
    if (!copilot.sdkInstalled()) { const heavy = heavyCheck('GitHub Copilot'); if (!heavy.ok) return [400, { error: heavy.reason, field: 'token' }]; }
    const existing = body.account ? accountById(String(body.account)) : null;
    if (body.account && existing?.type !== 'copilot') return [404, { error: 'No such Copilot account' }];
    const label = String(body.label || '').trim();
    const id = existing ? existing.id : label ? newAccountId('copilot', label) : 'copilot';
    const secret = secretFor('copilot', id);
    const previous = getSecret(secret);
    if (id !== 'copilot' && !existing) addAccount({ type: 'copilot', label, id });
    setSecret(secret, token);
    clearModelCache(id); clearCopilotExtras(id);
    const prov = providers().find((x) => x.id === id);
    const m = await providerModels(prov, { refresh: true });
    if (m.error) {
      if (id !== 'copilot' && !existing) await removeAccount(id);
      else setSecret(secret, previous || '');
      clearModelCache(id);
      return [400, { error: m.error, field: 'token' }];
    }
    activity('system', { summary: `GitHub Copilot${id === 'copilot' ? '' : ` (${prov.name})`} connected by ${user.username} (${m.models.length} models)` });
    const [row] = (await status()).filter((x) => x.id === id);
    return row;
  }, { role: 'owner' });
  route('DELETE', '/api/providers/copilot', async (req, res, body, q, p, user) => {
    copilot.disconnect();
    clearModelCache('copilot'); clearCopilotExtras('copilot');
    activity('system', { summary: `GitHub Copilot disconnected by ${user.username}` });
    return { ok: true };
  }, { role: 'owner' });

  // "Test" button: sends "Say hi" and shows the reply and how long it took.
  route('POST', '/api/providers/:id/test', async (req, res, body, q, p, user) => {
    const r = await testProvider(p.id, body.model ? String(body.model) : '');
    activity(r.ok ? 'system' : 'error', { summary: `Model test ${r.model || p.id} by ${user.username}: ${r.ok ? `ok in ${r.ms} ms` : r.error}` });
    return r;
  });

  // body.label (042): sign in another ChatGPT account; body.account: sign that account in again (reconnect).
  route('POST', '/api/providers/chatgpt/start', async (req, res, body) => {
    const existing = body?.account ? accountById(String(body.account)) : null;
    if (body?.account && existing?.type !== 'chatgpt') return [404, { error: 'No such ChatGPT account' }];
    const label = String(body?.label || '').trim().slice(0, 40);
    const id = existing ? existing.id : label ? newAccountId('chatgpt', label) : 'chatgpt';
    return chatgpt.startSignIn({ secret: secretFor('chatgpt', id), meta: { id, label: existing ? '' : label } });
  }, { role: 'owner' });
  route('POST', '/api/providers/chatgpt/complete', async (req, res, body, q, p, user) => {
    const { email, meta = {} } = await chatgpt.completeSignIn(body.callbackUrl);
    const id = meta.id || 'chatgpt';
    if (id !== 'chatgpt' && meta.label && !accountById(id)?.label) addAccount({ type: 'chatgpt', label: meta.label, id });
    clearModelCache(id); breaker.reset(id);
    const name = accountById(id)?.name || 'ChatGPT plan';
    activity('system', { summary: `${name} connected (${email || 'account'}) by ${user.username}` });
    const models = (await allModels({ refresh: true })).filter((m) => m.provider === id).length;
    return { ok: true, email, models, account: id };
  }, { role: 'owner' });
  route('DELETE', '/api/providers/chatgpt', async (req, res, body, q, p, user) => {
    await chatgpt.disconnect();
    clearModelCache('chatgpt');
    activity('system', { summary: `ChatGPT plan disconnected by ${user.username}` });
    return { ok: true };
  }, { role: 'owner' });

  // ---------- accounts (042) ----------
  // Another API-key account of Anthropic or OpenAI (Copilot, ChatGPT and OpenRouter use their own routes with a label).
  route('POST', '/api/accounts', async (req, res, body, q, p, user) => {
    const type = String(body.type || '');
    if (!['anthropic', 'openai'].includes(type)) return [400, { error: 'Use the ChatGPT, Copilot or OpenRouter buttons for those accounts', field: 'type' }];
    if (!String(body.key || '').trim()) return [400, { error: 'Paste the API key of the other account', field: 'key' }];
    const acc = addAccount({ type, label: body.label, key: String(body.key).trim() });
    activity('system', { summary: `Model account “${acc.name}” added by ${user.username}` });
    const [row] = (await status({ refresh: true })).filter((x) => x.id === acc.id);
    return row || acc;
  });
  route('PUT', '/api/accounts/:id', async (req, res, body, q, p, user) => {
    const acc = renameAccount(p.id, body.label);
    activity('system', { summary: `Model account ${p.id} renamed to “${acc.name}” by ${user.username}` });
    return { id: acc.id, name: acc.name, label: acc.label };
  });
  route('PUT', '/api/accounts/:id/key', async (req, res, body, q, p, user) => {
    const acc = accountById(p.id);
    if (!acc || !['anthropic', 'openai', 'openrouter', 'compatible'].includes(acc.type)) return [404, { error: 'No such API-key account' }];
    if (!String(body.key || '').trim()) return [400, { error: 'Paste the key first', field: 'key' }];
    setSecret(acc.secret, String(body.key).trim());
    clearModelCache(acc.id);
    activity('system', { summary: `Key replaced for ${acc.name} by ${user.username}` });
    const [row] = (await status({ refresh: true })).filter((x) => x.id === acc.id);
    return row;
  });
  route('DELETE', '/api/accounts/:id', async (req, res, body, q, p, user) => {
    const acc = accountById(p.id);
    await removeAccount(p.id);
    activity('system', { summary: `Model account “${acc?.name || p.id}” removed by ${user.username}` });
    return { ok: true };
  }, { role: 'owner' });
  route('POST', '/api/accounts/:id/retry', async (req, res, body, q, p, user) => {
    const acc = accountById(p.id);
    if (!acc) return [404, { error: 'No such account' }];
    breaker.reset(acc.id);
    activity('system', { summary: `${acc.name}: pause cleared by ${user.username}; it is tried again on the next message` });
    return { ok: true };
  });

  // ---------- fallback (042) ----------
  route('GET', '/api/fallback', async () => ({ ...fallbackSettings(), strategies: strategies(), health: breaker.allStates() }));
  route('PUT', '/api/fallback', async (req, res, body, q, p, user) => {
    const out = setFallbackSettings({ enabled: body.enabled, chain: body.chain });
    activity('config', { summary: `Fallback ${out.enabled ? 'on' : 'off'}${out.chain.length ? `: ${out.chain.join(' → ')}` : ' (any other connected provider)'} (${user.username})` });
    return { ...out, strategies: strategies() };
  });
  route('PUT', '/api/fallback/strategy', async (req, res, body, q, p, user) => {
    const out = setStrategy(String(body.group || ''), String(body.strategy || ''));
    activity('config', { summary: `Accounts of ${body.group}: ${body.strategy === 'spread' ? 'spread across accounts' : 'in order'} (${user.username})` });
    return { strategies: out };
  });

  route('GET', '/api/models', async (req, res, body, q) => {
    const s = getSettings();
    const out = { models: await allModels({ refresh: q.get('refresh') === '1' }), defaultModel: s.defaultModel || 'auto', backgroundModel: s.backgroundModel || 'auto', fallback: fallbackSettings() };
    try { out.resolvedDefault = resolveModel('auto', 'agent').ref; } catch (e) { out.problem = e.message; }
    try { out.resolvedBackground = resolveModel('auto', 'background').ref; } catch { /* same problem */ }
    return out;
  });
  route('POST', '/api/models/defaults', async (req, res, body, q, p, user) => {
    const patch = {};
    for (const k of ['defaultModel', 'backgroundModel']) {
      if (k in body) {
        const v = String(body[k] || 'auto');
        if (v !== 'auto' && !REF_RE.test(v)) return [400, { error: `${k} must be "auto" or provider:model`, field: k }];
        patch[k] = v;
      }
    }
    activity('system', { summary: `Model defaults by ${user.username}: ${JSON.stringify(patch)}` });
    return updateSettings(patch);
  });
}
