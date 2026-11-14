// Panel routes for updates (008). Owner only.
import { getUpdateSettings, setUpdateSettings, updateStatus, checkForUpdate, applyUpdate, installKind, updateRunning } from '../../core/updates.js';

const OWNER = { role: 'owner' };

export function updateRoutes(route, { restart = () => setTimeout(() => process.exit(0), 500) } = {}) {
  route('GET', '/api/updates', async () => ({ settings: getUpdateSettings(), status: updateStatus(), install: installKind(), running: updateRunning() }), OWNER);
  route('PUT', '/api/updates/settings', async (req, res, body) => setUpdateSettings(body), OWNER);
  route('POST', '/api/updates/check', async () => checkForUpdate(), OWNER);
  route('POST', '/api/updates/apply', async () => {
    if (installKind() === 'docker') return [400, { error: 'Docker install: pull the new image (docker compose pull && docker compose up -d)' }];
    if (updateRunning()) return { started: false, running: updateRunning() };
    const st = await checkForUpdate();
    if (!st.available) return [400, { error: 'Already up to date' }];
    // Runs in the background; the panel polls GET /api/updates (running → new version after the restart).
    applyUpdate({ target: st.target }).then((r) => { if (r.code === 0) restart(); });
    return { started: true, running: updateRunning() };
  }, OWNER);
}
