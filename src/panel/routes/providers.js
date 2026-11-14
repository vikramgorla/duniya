// Panel routes for model providers (006).
import { status, allModels, addCompatible, removeCompatible, clearModelCache, resolveModel, addOpenRouter, setFreeOnly, testProvider, clearCopilotExtras, providerModels, providers, OPENROUTER_ID } from '../../core/providers/index.js';
import * as chatgpt from '../../core/providers/chatgpt.js';
import * as copilot from '../../core/providers/copilot.js';
import { setSecret, getSecret } from '../../core/store.js';
import { getSettings, updateSettings } from '../../core/store.js';
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
    const prov = addOpenRouter({ key: body.key, freeOnly: body.freeOnly });
    activity('system', { summary: `OpenRouter ${body.key ? 'connected' : 'updated'} by ${user.username} (free models only: ${prov.freeOnly ? 'on' : 'off'})` });
    const [row] = (await status({ refresh: true })).filter((x) => x.id === OPENROUTER_ID);
    return row;
  });
  route('POST', '/api/providers/compatible/:id/free-only', async (req, res, body, q, p, user) => {
    const prov = setFreeOnly(p.id, !!body.on);
    if (!prov) return [404, { error: 'No such endpoint' }];
    activity('system', { summary: `Free models only ${prov.freeOnly ? 'on' : 'off'} for "${p.id}" by ${user.username}` });
    return prov;
  });

  // GitHub Copilot via the official SDK (018): owner pastes a fine-grained token; checked before it is kept.
  route('POST', '/api/providers/copilot', async (req, res, body, q, p, user) => {
    const token = copilot.checkToken(body.token);
    const previous = getSecret(copilot.SECRET);
    setSecret(copilot.SECRET, token);
    clearModelCache('copilot'); clearCopilotExtras();
    const prov = providers().find((x) => x.id === 'copilot');
    const m = await providerModels(prov, { refresh: true });
    if (m.error) {
      setSecret(copilot.SECRET, previous || '');
      clearModelCache('copilot');
      return [400, { error: m.error, field: 'token' }];
    }
    activity('system', { summary: `GitHub Copilot connected by ${user.username} (${m.models.length} models)` });
    const [row] = (await status()).filter((x) => x.id === 'copilot');
    return row;
  }, { role: 'owner' });
  route('DELETE', '/api/providers/copilot', async (req, res, body, q, p, user) => {
    copilot.disconnect();
    clearModelCache('copilot'); clearCopilotExtras();
    activity('system', { summary: `GitHub Copilot disconnected by ${user.username}` });
    return { ok: true };
  }, { role: 'owner' });

  // "Test" button: sends "Say hi" and shows the reply and how long it took.
  route('POST', '/api/providers/:id/test', async (req, res, body, q, p, user) => {
    const r = await testProvider(p.id, body.model ? String(body.model) : '');
    activity(r.ok ? 'system' : 'error', { summary: `Model test ${r.model || p.id} by ${user.username}: ${r.ok ? `ok in ${r.ms} ms` : r.error}` });
    return r;
  });

  route('POST', '/api/providers/chatgpt/start', async () => chatgpt.startSignIn(), { role: 'owner' });
  route('POST', '/api/providers/chatgpt/complete', async (req, res, body, q, p, user) => {
    const { email } = await chatgpt.completeSignIn(body.callbackUrl);
    clearModelCache('chatgpt');
    activity('system', { summary: `ChatGPT plan connected (${email || 'account'}) by ${user.username}` });
    const models = (await allModels({ refresh: true })).filter((m) => m.provider === 'chatgpt').length;
    return { ok: true, email, models };
  }, { role: 'owner' });
  route('DELETE', '/api/providers/chatgpt', async (req, res, body, q, p, user) => {
    await chatgpt.disconnect();
    clearModelCache('chatgpt');
    activity('system', { summary: `ChatGPT plan disconnected by ${user.username}` });
    return { ok: true };
  }, { role: 'owner' });

  route('GET', '/api/models', async (req, res, body, q) => {
    const s = getSettings();
    const out = { models: await allModels({ refresh: q.get('refresh') === '1' }), defaultModel: s.defaultModel || 'auto', backgroundModel: s.backgroundModel || 'auto' };
    try { out.resolvedDefault = resolveModel('auto', 'bot').ref; } catch (e) { out.problem = e.message; }
    try { out.resolvedBackground = resolveModel('auto', 'background').ref; } catch { /* same problem */ }
    return out;
  });
  route('POST', '/api/models/defaults', async (req, res, body, q, p, user) => {
    const patch = {};
    for (const k of ['defaultModel', 'backgroundModel']) {
      if (k in body) {
        const v = String(body[k] || 'auto');
        if (v !== 'auto' && !/^[a-z][a-z0-9-]*:.+$/.test(v)) return [400, { error: `${k} must be "auto" or provider:model`, field: k }];
        patch[k] = v;
      }
    }
    activity('system', { summary: `Model defaults by ${user.username}: ${JSON.stringify(patch)}` });
    return updateSettings(patch);
  });
}
