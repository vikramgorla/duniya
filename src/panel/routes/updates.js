// @ts-check
// Panel routes for updates (008, 045; owner only) and the installed release notes (065; everyone signed in).
import { recordFailure } from '../../core/events.js';
import { getUpdateSettings, setUpdateSettings, updateStatus, checkForUpdate, applyUpdate, installKind, updateRunning, backupConfigured, installedReleases, runningVersion, markSeen, updateSource, setUpdateSource } from '../../core/updates.js';
import { restartSoon } from '../../core/config.js';
import { releaseRange } from '../../core/releases.js';
import { pendingDecision, snoozeDecision, runConfirmedUpdate, setUpdateRestart } from '../../core/update-decision.js';

const OWNER = { role: 'owner' };

export function updateRoutes(route, { restart = () => restartSoon(500) } = {}) {
  setUpdateRestart(restart);
  route('GET', '/api/updates', async () => {
    const install = installKind();
    return { settings: getUpdateSettings(), status: updateStatus(), install, running: updateRunning(), decision: pendingDecision(), backup: backupConfigured(),
      source: install === 'docker' ? null : await updateSource() }; // 084: where updates come from
  }, OWNER);
  // 084: switch the update source (owner/name or a GitHub https URL); fetched first, put back when that fails
  route('PUT', '/api/updates/source', async ({ body, user }) => {
    if (updateRunning()) return [409, { error: 'An update is running: change the source when it has finished' }];
    return setUpdateSource(body.repo, { by: user?.username || '' });
  }, OWNER);
  // 065: release notes of the installed version: all of them, or the versions after `from` up to `to` (newest first)
  route('GET', '/api/releases', async ({ query }) => ({ running: runningVersion(), versions: releaseRange(installedReleases(), query.get('from') || '', query.get('to') || '') }));
  route('POST', '/api/releases/seen', async ({ user }) => markSeen(user), { role: 'viewer' });
  route('PUT', '/api/updates/settings', async ({ body }) => setUpdateSettings(body), OWNER);
  route('POST', '/api/updates/check', async () => checkForUpdate(), OWNER);
  /**
   * Install an update. Without `breaking: true` it installs the newest release that needs no decision (safeTarget) and
   * answers 409 when only a breaking release is left. With `breaking: true` (the owner confirmed in the dialog) it
   * installs the newest release. `backup: false` skips the backup before the update.
   */
  route('POST', '/api/updates/apply', async ({ body, user }) => {
    if (installKind() === 'docker') return [400, { error: 'Docker install: pull the new image (docker compose pull && docker compose up -d)' }];
    if (updateRunning()) return { started: false, running: updateRunning() };
    const st = await checkForUpdate();
    if (!st.available) return [400, { error: 'Already up to date' }];
    const backup = body.backup !== false;
    if (body.breaking === true) {
      // Runs in the background; the panel polls GET /api/updates (running → new version after the restart).
      runConfirmedUpdate({ by: user?.username || 'owner', backup }).catch(recordFailure('The update'));
      await new Promise((r) => setImmediate(r));
      return { started: true, target: st.target, running: updateRunning() };
    }
    const target = st.breaking ? st.safeTarget : st.target;
    if (!target) return [409, { error: `${st.decisionVersion ? `Version v${st.decisionVersion}` : 'This update'} needs your decision: review it and confirm.`, decision: pendingDecision() }];
    applyUpdate({ target, backup, by: user?.username || '' }).then((r) => { if (r.code === 0) restart(); });
    return { started: true, target, running: updateRunning() };
  }, OWNER);
  route('POST', '/api/updates/decision', async ({ body, user }) => {
    if (!['snooze', 'dismiss'].includes(body.action)) return [400, { error: 'action: snooze or dismiss', field: 'action' }];
    return snoozeDecision({ action: body.action, by: user?.username || '' });
  }, OWNER);
}
