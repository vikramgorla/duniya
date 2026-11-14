// Panel routes for model providers (006).
import { status, allModels, addCompatible, removeCompatible, clearModelCache, resolveModel } from '../../core/providers/index.js';
import * as chatgpt from '../../core/providers/chatgpt.js';
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
