// Panel routes for updates (008). Owner only.
import { getUpdateSettings, setUpdateSettings, updateStatus, checkForUpdate, applyUpdate, installKind } from '../../core/updates.js';

const OWNER = { role: 'owner' };

export function updateRoutes(route, { restart = () => setTimeout(() => process.exit(0), 500) } = {}) {
  route('GET', '/api/updates', async () => ({ settings: getUpdateSettings(), status: updateStatus(), install: installKind() }), OWNER);
  route('PUT', '/api/updates/settings', async (req, res, body) => setUpdateSettings(body), OWNER);
  route('POST', '/api/updates/check', async () => checkForUpdate(), OWNER);
  route('POST', '/api/updates/apply', async () => {
    if (installKind() === 'docker') return [400, { error: 'Docker install: pull the new image (docker compose pull && docker compose up -d)' }];
    const st = await checkForUpdate();
    const r = await applyUpdate({ target: st.target });
    if (r.code === 0) restart();
    return r;
  }, OWNER);
}
