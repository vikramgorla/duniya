// Backups screen (owner): schedule, GitHub, S3, download and restore. Module of the panel (063).
// ---------- backups (owner) ----------
import { $, S, api, extLink, field, h, kb, meterEl, time, toast, tryApi, uploadFile, waitForRestart } from './core.js';
const backupTime = (f) => { const m = f.match(/(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/); return m ? time(Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6])) : f; };
function downloadFile(href, name) { const a = h('a', { href, download: name, class: 'hide' }); document.body.append(a); a.click(); a.remove(); }
let ghPollTimer = null; let ghAutoChecked = 0;

export async function renderBackups() {
  clearTimeout(ghPollTimer); ghPollTimer = null;
  const b = await api('GET', '/api/backups'); const s = b.settings;
  const pass = h('input', { type: 'password', placeholder: b.passphraseSet ? '•••• set — enter a new one to change' : 'At least 12 characters — keep it safe!' });
  const sched = h('select', { 'aria-label': 'How often' }, [['hourly', 'Every hour'], ['6h', 'Every 6 hours'], ['daily', 'Daily'], ['weekly', 'Weekly']].map(([v, l]) => h('option', { value: v, selected: s.schedule === v }, l)));
  const at = h('input', { value: s.at, 'aria-label': 'At (time)', style: 'max-width:90px' }); const wd = h('select', { 'aria-label': 'Weekday', style: 'max-width:90px' }, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => h('option', { value: d, selected: s.weekday === d }, d)));
  const keep = h('input', { type: 'number', 'aria-label': 'Backups to keep', value: s.keep, style: 'max-width:90px' });
  const en = h('input', { type: 'checkbox', checked: s.enabled }); const wa = h('input', { type: 'checkbox', checked: s.includeWhatsApp });
  const saveSettings = (patch) => tryApi(async () => { await api('PUT', '/api/backups/settings', patch); renderBackups(); }, 'Saved');
  const last = b.last;
  const busyBtn = (label, cls, fn) => h('button', { class: `btn ${cls}`, disabled: !b.passphraseSet, title: b.passphraseSet ? '' : 'Set a passphrase first', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Backing up…');
    const r = await tryApi(() => api('POST', '/api/backups/run')); btn.disabled = false; btn.textContent = label;
    if (r) { await fn(r); renderBackups(); }
  } }, label);
  const runNow = busyBtn('Back up now', '', async (r) => toast(`Backup ${r.file}: ${Object.entries(r.results).map(([k, v]) => `${k} ${v}`).join(', ')}`));
  const runDl = busyBtn('Back up now & download', '', async (r) => { if (r.results.local === 'ok') downloadFile(`/api/backups/download/${r.file}`, r.file); });

  const scheduleCard = h('div', { class: 'card' }, h('h2', {}, 'Schedule'),
    h('p', { class: 'small muted' }, 'Backups include agents, users, settings, secrets, chat memory and (optionally) the WhatsApp link. They are encrypted with your passphrase before leaving the server — without it they cannot be restored, so write it down somewhere safe (not on this server).'),
    field('Passphrase', h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('PUT', '/api/backups/passphrase', { passphrase: pass.value }), 'Passphrase saved')) renderBackups(); } }, pass, h('button', { class: 'btn' }, 'Save'))),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('label', { class: 'inline' }, en, 'Scheduled backups'), h('label', { class: 'inline' }, wa, 'Include WhatsApp link')),
    h('div', { class: 'row' }, sched, at, wd, h('span', { class: 'small muted' }, 'keep'), keep),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: () => saveSettings({ enabled: en.checked, includeWhatsApp: wa.checked, schedule: sched.value, at: at.value, weekday: wd.value, keep: Number(keep.value) }) }, 'Save'), runNow),
    last ? h('p', { class: 'small' }, `Last: ${time(last.at)} · ${kb(last.size)} · `, Object.entries(last.results).map(([k, v]) => h('span', { class: `pill ${v.startsWith('ok') ? 'ok' : 'bad'}`, style: 'margin-right:4px' }, `${k}: ${v}`))) : null);

  const localCard = h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', {}, 'On this server'), h('span', { class: 'pill' }, `${b.local.length} ${b.local.length === 1 ? 'backup' : 'backups'}`)),
    h('p', { class: 'small muted', style: 'margin-top:0' }, `The newest ${s.keep} backups stay here. Download one to keep a copy on your computer or to move to a new server — the file is already encrypted with your backup passphrase.`),
    b.local.length ? h('div', {}, b.local.slice(0, 6).map((f) => h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, backupTime(f.file)), h('div', { class: 'small muted' }, `${f.file} · ${kb(f.size)}`)),
      h('a', { class: 'btn small', href: `/api/backups/download/${encodeURIComponent(f.file)}`, download: f.file }, 'Download'))),
      b.local.length > 6 ? h('details', {}, h('summary', { class: 'small muted' }, `${b.local.length - 6} older`), b.local.slice(6).map((f) => h('div', { class: 'list-row' }, h('div', { class: 'grow small' }, `${backupTime(f.file)} · ${kb(f.size)}`), h('a', { class: 'btn small', href: `/api/backups/download/${encodeURIComponent(f.file)}`, download: f.file }, 'Download')))) : null)
      : h('p', { class: 'muted small' }, b.passphraseSet ? 'No backups yet.' : 'Set a passphrase, then make your first backup.'),
    h('div', { class: 'row', style: 'margin-top:8px' }, runDl),
    h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small muted' }, 'Moving to a new server?'),
      h('ol', { class: 'small', style: 'padding-left:18px' },
        h('li', {}, 'Click “Back up now & download” and keep the file.'),
        h('li', {}, 'Install Duniya on the new server (installer or the OCI stack).'),
        h('li', {}, 'On its first screen choose “Restore a backup”, upload the file and type the backup passphrase. You need the passphrase there — the new server cannot open the file without it.'),
        h('li', {}, 'Once the new server shows your agents, turn the old one off.'))));

  // S3
  const se = h('input', { value: s.s3.endpoint, placeholder: 'https://<account>.r2.cloudflarestorage.com' });
  const sr = h('input', { value: s.s3.region, placeholder: 'auto / us-east-1 / eu-zurich-1' });
  const sb = h('input', { value: s.s3.bucket, placeholder: 'bucket' }); const sp = h('input', { value: s.s3.prefix, placeholder: 'duniya/' });
  const ak = h('input', { placeholder: b.s3.keysSet ? '•••• saved' : 'Access key id' }); const sk = h('input', { type: 'password', placeholder: b.s3.keysSet ? '•••• saved' : 'Secret access key' });
  const s3Card = h('div', { class: 'card' }, h('h2', {}, 'S3-compatible storage'),
    h('p', { class: 'small muted' }, 'Cloudflare R2, OCI Object Storage (S3 API), AWS S3, MinIO…'),
    field('Endpoint', se), h('div', { class: 'row' }, field('Region', sr), field('Bucket', sb), field('Prefix', sp)),
    h('div', { class: 'row', style: 'margin-top:8px' }, ak, sk, h('button', { class: 'btn', onclick: () => tryApi(() => api('PUT', '/api/backups/s3/keys', { accessKeyId: ak.value, secretAccessKey: sk.value }), 'Keys saved') }, 'Save keys')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.s3.enabled, id: 's3on' }), 'Back up to S3'),
      h('button', { class: 'btn primary', onclick: () => saveSettings({ s3: { enabled: $('#s3on').checked, endpoint: se.value.trim(), region: sr.value.trim() || 'auto', bucket: sb.value.trim(), prefix: sp.value.trim() } }) }, 'Save'),
      h('button', { class: 'btn', onclick: async () => { const r = await api('POST', '/api/backups/test/s3'); toast(r.ok ? 'S3 OK' : r.error); } }, 'Test')));

  $('#main').replaceChildren(h('div', { class: 'grid' }, scheduleCard, localCard, githubCard(b, s, saveSettings), s3Card, restoreCard(b, s)));
  if (b.github.app.app && !b.github.app.installed && Date.now() - ghAutoChecked > 15000) { ghAutoChecked = Date.now(); checkGithubApp(true); }
}

/** Ask the server whether the GitHub app is installed yet; redraw when something changed. */
async function checkGithubApp(quiet) {
  const r = await api('POST', '/api/backups/github-app/check').catch((e) => { if (!quiet) toast(e.message, { bad: true }); return null; });
  if (r?.installed) { if (S.tab === 'backups') renderBackups(); if (!quiet) toast(r.repo ? `Installed — backing up to ${r.repo}` : 'Installed'); }
  else if (r && !quiet) toast('Not installed yet');
  return r;
}
function pollGithubApp(statusEl, n = 0) {
  clearTimeout(ghPollTimer);
  if (S.tab !== 'backups' || n > 60) { statusEl.replaceChildren(); return; }
  statusEl.replaceChildren(h('div', { class: 'note' }, h('span', { class: 'spinner' }), ' Waiting for the installation on GitHub… this page checks every 5 seconds.'));
  ghPollTimer = setTimeout(async () => { const r = await checkGithubApp(true); if (!r?.installed) pollGithubApp(statusEl, n + 1); }, 5000);
}

function githubCard(b, s, saveSettings) {
  const G = b.github; const A = G.app;
  const pill = G.connected ? h('span', { class: 'pill ok' }, G.via === 'app' ? `app · ${G.login || '?'}` : `token · ${G.login || '?'}`)
    : A.app ? h('span', { class: 'pill warn' }, 'almost there') : h('span', { class: 'pill' }, 'not connected');
  const testBtn = h('button', { class: 'btn small', onclick: async () => { const r = await api('POST', '/api/backups/test/github'); toast(r.ok ? 'GitHub OK' : r.error); } }, 'Test');
  const onOff = h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.github.enabled, onchange: (e) => saveSettings({ github: { enabled: e.target.checked } }) }), 'Back up to GitHub');
  let body;
  if (A.app && G.via === 'app' && s.github.repo) {
    const repoSel = A.repos.length > 1 ? h('select', { onchange: (e) => tryApi(async () => { await api('PUT', '/api/backups/github-app/repo', { repo: e.target.value }); renderBackups(); }, 'Repository changed') }, A.repos.map((r) => h('option', { value: r, selected: r === s.github.repo }, r))) : null;
    body = [h('div', { class: 'note ok' }, '✓ Backups go to ', h('b', {}, s.github.repo), ' through your GitHub app “', A.app.name, '”.'),
      repoSel ? field('Repository', repoSel) : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, onOff, testBtn, extLink(`${A.app.htmlUrl || A.app.settingsUrl}`, 'App on GitHub'),
        h('button', { class: 'btn small danger', onclick: () => confirm('Disconnect the GitHub app? Backups stop going to GitHub; the backups already there stay. You can delete the app on GitHub afterwards.') && tryApi(async () => { const r = await api('DELETE', '/api/backups/github-app'); if (r.deleteUrl) window.open(r.deleteUrl, '_blank', 'noopener'); renderBackups(); }, 'Disconnected') }, 'Disconnect'))];
  } else if (A.app) {
    const statusEl = h('div', {});
    const chooseSel = h('select', {}, A.repos.map((r) => h('option', { value: r }, r)));
    body = [h('ol', { class: 'steps' },
      h('li', { class: 'done' }, h('b', { class: 't' }, 'GitHub app created'), h('span', { class: 'small muted' }, `“${A.app.name}”${A.app.owner ? ` owned by ${A.app.owner}` : ''}`)),
      h('li', { class: A.installed ? 'done' : 'now' }, h('b', { class: 't' }, 'Create a private repository'),
        h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'GitHub opens with the name “duniya-backup” and Private already chosen: click Create repository. Already have a private repository for this? Skip to the next step.'),
        extLink(A.newRepoUrl, 'Create private repository')),
      h('li', { class: A.installed ? 'done' : '' }, h('b', { class: 't' }, 'Install the app on that repository'),
        h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Choose “Only select repositories”, pick the backup repository and click Install. The app can then write only there.'),
        h('div', { class: 'row', style: 'flex-wrap:wrap' }, h('a', { class: 'btn small primary', href: A.installUrl, target: '_blank', rel: 'noopener', onclick: () => pollGithubApp(statusEl) }, 'Install the app ↗'),
          h('button', { class: 'btn small', onclick: () => checkGithubApp(false) }, 'Check now')), statusEl),
      h('li', { class: A.installed ? 'now' : '' }, h('b', { class: 't' }, 'Choose the repository'),
        !A.installed ? h('span', { class: 'small muted' }, 'Done automatically when the app can see one repository.')
          : !A.repos.length ? h('div', { class: 'note warn' }, 'The app is installed but cannot see any repository. On GitHub, open the app’s installation and add the backup repository, then click Check now.')
            : h('div', { class: 'row' }, chooseSel, h('button', { class: 'btn primary', onclick: () => tryApi(async () => { await api('PUT', '/api/backups/github-app/repo', { repo: chooseSel.value }); renderBackups(); }, 'Backing up to GitHub') }, 'Use')))),
    h('button', { class: 'btn small danger', onclick: () => confirm('Start over? This forgets the GitHub app here; you can delete it on GitHub afterwards.') && tryApi(async () => { const r = await api('DELETE', '/api/backups/github-app'); if (r.deleteUrl) window.open(r.deleteUrl, '_blank', 'noopener'); renderBackups(); }) }, 'Start over')];
  } else if (G.via === 'token') {
    const ghRepo = h('input', { value: s.github.repo, placeholder: 'owner/duniya-backups' });
    body = [field('Repository', h('div', { class: 'row' }, ghRepo, h('button', { class: 'btn', onclick: () => saveSettings({ github: { enabled: true, repo: ghRepo.value.trim() } }) }, 'Use'))),
      !s.github.repo ? h('button', { class: 'btn primary', style: 'margin-top:8px', onclick: () => tryApi(async () => { await api('POST', '/api/backups/github/create-repo', {}); renderBackups(); }, 'Private repo created') }, 'Create private repo “duniya-backups”') : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, onOff, testBtn,
        h('button', { class: 'btn small danger', onclick: () => confirm('Disconnect GitHub? Backups stop going there; the backups already there stay.') && tryApi(async () => { await api('DELETE', '/api/backups/github'); renderBackups(); }) }, 'Disconnect'))];
  } else {
    const org = h('input', { placeholder: 'organization name' });
    body = [h('p', { class: 'small muted', style: 'margin-top:0' }, 'Keep encrypted copies in a private GitHub repository. One click creates a small GitHub app owned by you that can only write to the repository you choose — no keys to copy.'),
      h('a', { class: 'btn primary', href: '/backups/github-app/new' }, 'Create GitHub app'),
      h('p', { class: 'small muted' }, 'No GitHub account? ', h('a', { href: G.signupUrl, target: '_blank', rel: 'noopener' }, 'Create one'), ' (free), then come back.'),
      h('details', {}, h('summary', { class: 'small muted' }, 'Create it for an organization instead'),
        h('div', { class: 'row', style: 'margin-top:8px' }, org, h('button', { class: 'btn', onclick: () => { if (org.value.trim()) location.href = `/backups/github-app/new?org=${encodeURIComponent(org.value.trim())}`; } }, 'Create for organization')))];
  }
  // the older ways: a personal access token, or device login with your own OAuth app
  let tokenWays = null;
  if (G.via !== 'token' && !(A.app && G.via === 'app')) {
    const ghToken = h('input', { type: 'password', placeholder: 'GitHub token (fine-grained: repo contents read/write)' });
    const clientId = h('input', { value: s.githubClientId, placeholder: 'GitHub OAuth app client id (Device Flow enabled)' });
    const ghFlow = h('div', {});
    const pollLoop = async (interval) => {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        const r = await api('POST', '/api/backups/github/poll').catch((e) => ({ status: 'error', error: e.message }));
        if (r.status === 'connected') { toast(`Connected as ${r.login}`); return renderBackups(); }
        if (r.status !== 'pending') { ghFlow.replaceChildren(h('div', { class: 'note warn' }, `GitHub: ${r.status}${r.error ? ` (${r.error})` : ''}`)); return; }
      }
    };
    tokenWays = h('details', { style: 'margin-top:12px' }, h('summary', { class: 'small muted' }, 'Use a personal access token instead'),
      h('form', { class: 'row', style: 'margin-top:8px', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('PUT', '/api/backups/github/token', { token: ghToken.value }), 'Token saved')) renderBackups(); } }, ghToken, h('button', { class: 'btn' }, 'Use token')),
      G.clientIdSet ? h('button', { class: 'btn small', style: 'margin-top:8px', onclick: async () => {
        const r = await tryApi(() => api('POST', '/api/backups/github/device')); if (!r) return;
        ghFlow.replaceChildren(h('p', {}, 'Open ', h('a', { href: r.verificationUri, target: '_blank', rel: 'noopener' }, r.verificationUri), ' and enter:'), h('p', { class: 'code' }, r.userCode), h('p', { class: 'small muted' }, 'Waiting for approval…'));
        pollLoop(r.interval || 5);
      } }, 'Device login') : null, ghFlow,
      h('p', { class: 'small muted' }, 'Device login needs your own GitHub OAuth app with “Enable Device Flow”. Client id:'),
      h('div', { class: 'row' }, clientId, h('button', { class: 'btn', onclick: () => tryApi(async () => { await api('PUT', '/api/backups/github/client-id', { clientId: clientId.value }); renderBackups(); }, 'Saved') }, 'Save')));
  }
  return h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', {}, 'GitHub (private repository)'), pill), body, tokenWays);
}

let restoreMode = 'local';
function restoreCard(b, s) {
  const box = h('div', {});
  const err = h('div', { class: 'small', style: 'color:var(--bad);min-height:18px;margin-top:6px' });
  const modes = [['local', 'This server'], s.github.enabled && ['github', 'GitHub'], s.s3.enabled && ['s3', 'S3'], ['upload', 'A file']].filter(Boolean);
  if (!modes.some(([v]) => v === restoreMode)) restoreMode = 'local';
  const seg = h('div', { class: 'seg', style: 'margin-bottom:8px;flex-wrap:wrap' }, modes.map(([v, l]) => h('button', { class: v === restoreMode ? 'on' : '', onclick: (e) => { restoreMode = v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); err.textContent = ''; draw(); } }, l)));
  const rpass = h('input', { type: 'password', placeholder: b.passphraseSet ? 'Backup passphrase (empty: this server’s)' : 'Backup passphrase', autocomplete: 'off' });
  const confirmText = (what) => `Restore ${what}? Agents, users, settings, secrets, memory and the WhatsApp link are replaced by the backup and the server restarts (1–2 minutes). The current data is kept aside on the server.`;
  function draw() {
    if (restoreMode === 'upload') {
      const file = h('input', { type: 'file', accept: '.dbk,application/octet-stream' });
      const meter = meterEl(); const status = h('span', { class: 'small' });
      const prog = h('div', { class: 'hide', style: 'margin-top:10px' }, meter, h('div', { class: 'small muted' }, h('span', { class: 'spinner' }), status));
      const go = h('button', { class: 'btn danger', style: 'margin-top:8px', onclick: async () => {
        err.textContent = ''; const f = file.files[0];
        if (!f) return (err.textContent = 'Choose a backup file (.dbk) first');
        if (!rpass.value && !b.passphraseSet) return (err.textContent = 'Enter the passphrase the backup was made with');
        if (!confirm(confirmText(f.name))) return;
        go.disabled = true; prog.classList.remove('hide');
        try {
          const up = await uploadFile('/api/backups/upload', f, {}, (x) => { meter.set(x); status.textContent = ` Uploading… ${Math.round(x * 100)} %`; });
          status.textContent = ' Checking the passphrase…';
          await api('POST', '/api/backups/restore', { source: 'upload', upload: up.upload, passphrase: rpass.value, name: f.name });
          meter.set(1); waitForRestart(status);
        } catch (x) { err.textContent = x.message; go.disabled = false; prog.classList.add('hide'); }
      } }, 'Upload and restore');
      box.replaceChildren(h('p', { class: 'small muted', style: 'margin-top:0' }, `A .dbk file you downloaded earlier, from this or another server (up to ${b.uploadMaxMb} MB). You need the passphrase that server used.`),
        h('div', { class: 'filepick' }, file), h('div', { style: 'margin-top:8px' }, rpass), go, prog);
    } else {
      const files = h('select', { 'aria-label': 'Backup to restore' }, h('option', {}, 'Loading…'));
      const go = h('button', { class: 'btn danger', style: 'margin-top:8px', onclick: async () => {
        err.textContent = '';
        if (!files.value) return (err.textContent = 'Pick a backup');
        if (!confirm(confirmText(files.value))) return;
        const status = h('span', { class: 'small' }); go.disabled = true;
        try { await api('POST', '/api/backups/restore', { source: restoreMode, file: files.value, passphrase: rpass.value }); go.after(h('div', { class: 'note' }, h('span', { class: 'spinner' }), status)); waitForRestart(status); } catch (x) { err.textContent = x.message; go.disabled = false; }
      } }, 'Restore');
      box.replaceChildren(files, h('div', { style: 'margin-top:6px' }, rpass), go);
      api('GET', `/api/backups/list?source=${restoreMode}`).then((l) => files.replaceChildren(...(l.length ? l.map((f) => h('option', { value: f.file }, `${backupTime(f.file)} · ${kb(f.size)}`)) : [h('option', { value: '' }, 'No backups here yet')])))
        .catch((e) => { files.replaceChildren(h('option', { value: '' }, 'Could not list backups')); err.textContent = e.message; });
    }
  }
  draw();
  return h('div', { class: 'card' }, h('h2', {}, 'Restore'),
    h('div', { class: 'note warn' }, 'Restoring replaces agents, users, settings, secrets, memory and the WhatsApp link with the backup, then restarts. The current data is kept aside on the server.'),
    seg, box, err);
}

