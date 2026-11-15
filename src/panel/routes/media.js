// Panel routes for photos & voice (043, #48): capabilities per provider, server settings, on-server speech engines,
// and the small-server state (size, memory, media queue).
import { capabilities, mediaSettings, setMediaSettings, VOICES } from '../../core/media-ai.js';
import { installEngine, removeEngine, localStatus, ENGINES } from '../../core/speech-local.js';
import { serverSize, localEngineCheck, queueState, LOCAL_MIN_TOTAL_MB } from '../../core/resources.js';
import { queueStats } from '../../core/media-queue.js';
import { activity } from '../../core/events.js';

const OWNER = { role: 'owner' };
const ADMIN = { role: 'admin' };

export function mediaRoutes(route) {
  const view = async () => ({ ...(await capabilities()), voices: VOICES, server: serverSize(), localAllowed: localEngineCheck({ forEnable: true }),
    localMinMb: LOCAL_MIN_TOTAL_MB, queue: { ...queueStats(), calls: queueState() } });
  route('GET', '/api/media', async () => view());
  route('PUT', '/api/media/settings', async (req, res, body, q, p, user) => {
    const before = mediaSettings();
    if (body.local && (body.local.listen || body.local.speak)) { // switching an on-server engine on: small servers refuse
      if (user.role !== 'owner') return [403, { error: 'Only the owner can switch on on-server engines' }];
      const ok = localEngineCheck({ forEnable: true });
      if (!ok.ok) return [400, { error: ok.reason, field: 'local' }];
    }
    const s = setMediaSettings(body);
    const changed = Object.keys(body).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(s[k]));
    if (changed.length) activity('config', { summary: `Photos & voice settings changed: ${changed.join(', ')} (${user.username})` });
    return view();
  }, ADMIN);
  route('POST', '/api/media/local/:kind/install', async (req, res, body, q, p, user) => {
    if (!ENGINES[p.kind]) return [404, { error: 'Unknown engine' }];
    const st = installEngine(p.kind);
    activity('config', { summary: `On-server ${p.kind === 'stt' ? 'listening' : 'speaking'} engine: download started (${user.username})` });
    return st;
  }, OWNER);
  route('DELETE', '/api/media/local/:kind', async (req, res, body, q, p, user) => {
    if (!ENGINES[p.kind]) return [404, { error: 'Unknown engine' }];
    const key = p.kind === 'stt' ? 'listen' : 'speak';
    setMediaSettings({ local: { [key]: false } });
    const st = removeEngine(p.kind);
    activity('config', { summary: `On-server ${p.kind === 'stt' ? 'listening' : 'speaking'} engine removed (${user.username})` });
    return st;
  }, OWNER);
  route('GET', '/api/media/local', async () => localStatus());
}
