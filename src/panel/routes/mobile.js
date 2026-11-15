// Panel routes for the mobile app (027): what Settings → Mobile app shows, and the optional Expo link (owner).
import { getSettings, updateSettings } from '../../core/store.js';
import { listGrants, MOBILE_CLIENT_ID } from '../../core/admin-oauth.js';
import { activity } from '../../core/events.js';
import { baseUrl } from '../http-util.js';

/** Links Expo Go can open: a dev server (exp://host:port), an EAS Update (exp://u.expo.dev/…) or an expo.dev page. */
export function validExpoUrl(u) {
  if (!u) return true;
  let url; try { url = new URL(String(u)); } catch { return false; }
  if (url.username || url.password || String(u).length > 300) return false;
  if (url.protocol === 'exp:' || url.protocol === 'exps:') return !!url.host;
  return url.protocol === 'https:' && /(^|\.)expo\.(dev|io)$/.test(url.hostname);
}

export function mobileRoutes(route) {
  route('GET', '/api/mobile', async (req, res, body, q, p, user) => {
    const serverUrl = baseUrl(req);
    return {
      serverUrl,
      https: serverUrl.startsWith('https://'),
      // Scanned by the app's own QR scanner (works in Expo Go), or opened by the phone camera once the app is installed.
      connectUrl: `duniya://connect?server=${encodeURIComponent(serverUrl)}`,
      expoUrl: getSettings().mobile?.expoUrl || '',
      devices: listGrants(user.role === 'owner' ? {} : { userId: user.id }).filter((g) => g.clientId === MOBILE_CLIENT_ID),
      you: user.id,
    };
  }, { role: 'viewer' });
  route('PUT', '/api/mobile', async (req, res, body, q, p, user) => {
    const expoUrl = String(body.expoUrl || '').trim();
    if (!validExpoUrl(expoUrl)) {
      throw Object.assign(new Error('Paste the exp:// link that `npx expo start` or `eas update` shows, or an expo.dev link'), { status: 400, field: 'expoUrl' });
    }
    updateSettings({ mobile: { ...(getSettings().mobile || {}), expoUrl } });
    activity('config', { summary: `Mobile app: Expo link ${expoUrl ? 'set' : 'removed'} (${user.username})` });
    return { expoUrl };
  }, { role: 'owner' });
}
