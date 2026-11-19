// Server screen: metrics, health, OS updates, maintenance helper, logs, hosting. Module of the panel (063).
import { $, S, ago, api, ask, can, field, h, serverBadge, time, tryApi } from './core.js';
import { docsUrl, SIZE_LABEL, bytes, meter, pct, plural } from './shared.js';
function spark(values, max) {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'spark');
  const v = values.slice(-120); if (v.length < 2) return svg;
  const top = max ?? Math.max(1, ...v);
  const pts = v.map((y, i) => [(i / (v.length - 1)) * 100, 29 - (Math.min(y, top) / top) * 27]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  for (const [cls, d] of [['a', `${line}L100,30L0,30Z`], ['l', line]]) { const pa = document.createElementNS(ns, 'path'); pa.setAttribute('class', cls); pa.setAttribute('d', d); pa.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(pa); }
  return svg;
}
let serverTimer = null; let opsTimer = null; let logUnit = 'whatsapp-agent-duniya'; let lastSys = null;
function serverSizeNote(s, q) {
  if (!s) return null;
  const ram = s.effectiveMb >= 1024 ? `${(s.effectiveMb / 1024).toFixed(s.effectiveMb % 1024 ? 1 : 0)} GB` : `${s.effectiveMb} MB`;
  const waiting = q && (q.queued || q.running) ? h('div', { class: 'small muted', style: 'margin-top:4px' }, `Photos & voice queue: ${q.running} working, ${q.queued} waiting (up to ${q.workers} at once, ${q.max} max).`) : null;
  return h('div', { class: `note ${s.pressure ? 'warn' : s.size === 'small' ? 'info' : ''}`, style: 'margin-top:10px' },
    h('b', {}, `${SIZE_LABEL[s.size]}: `), `${ram} memory${s.cgroupLimitMb ? ' (container limit)' : ''}, ${s.cpus} CPU${s.cpus > 1 ? 's' : ''}, ${s.availableMb} MB free. `,
    s.pressure ? `The app uses ${s.rssMb} MB — above ${s.softLimitMb} MB, so summaries, on-server speech and picture creation are paused until memory frees up. Replies continue.`
      : s.size === 'small' ? (s.smallMode ? 'Small server mode is on: on-server speech and up to 2 local tool services may run, one job at a time and only when memory allows. Photos and voice notes are handled one at a time; agent apps (Claude Code, Codex, GitHub Copilot) answer one at a time.'
        : 'Photos and voice notes are handled one at a time; on-server speech, local tool services and agent apps (Claude Code, Codex, GitHub Copilot) are not available (Small server mode in Settings → Server allows them). Providers (OpenAI, OpenRouter) handle photos and voice fine.')
        : 'Everything is available.',
    waiting);
}
// Hosting help (#56): open the step-by-step guide for where this server runs (update, recreate, remove, console help).
const HOST_GUIDES = {
  oci: ['Oracle Cloud', 'deploy/oci-free-tier.md', 'Update the stack (new zip → Plan → Apply), recreate, remove (Destroy, then Delete), find the IP and console history, out-of-capacity and LimitExceeded.'],
  gcp: ['Google Cloud', 'deploy/google-cloud.md', 'Recreate or remove the VM, firewall rule and IPs, serial console, SSH, resize, what keeps the IP.'],
  server: ['Your own server', 'install.md#managing-your-server', 'Update, change the address, move to a new server, remove, where the logs are.'],
  docker: ['Docker', 'deploy/docker.md', 'Update (pull + up), recreate, remove, logs and the setup code.'],
};
function hostingCard(hosting) {
  const p = hosting?.provider;
  const link = (key, primary) => { const [name, path, what] = HOST_GUIDES[key];
    return h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, name), h('div', { class: 'small muted' }, what)),
      h('a', { class: `btn small${primary ? ' primary' : ''}`, href: docsUrl(path), target: '_blank', rel: 'noopener' }, 'Open guide')); };
  const known = HOST_GUIDES[p];
  return h('div', { class: 'card', id: 'hosting-help' }, h('h2', {}, 'Hosting help'),
    known ? link(p, true) : [h('p', { class: 'small muted', style: 'margin-top:0' }, 'Pick where this server runs.'), link('oci'), link('gcp'), link('server'), link('docker')],
    h('p', { class: 'small muted' }, 'Back up before you recreate or remove a server. App updates: ', h('a', { href: '#settings/updates' }, 'Settings → Updates'), '.'),
    known ? h('details', {}, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Other hosts'), Object.keys(HOST_GUIDES).filter((k) => k !== p).map((k) => link(k))) : null);
}
// 069: Health — how big the data is, what is kept and that the server cleans up by itself. Loaded once per visit.
const day = (ts) => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', ...(new Date(ts).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
const n = (x) => Number(x || 0).toLocaleString();
function healthCard(x, redraw) {
  const r = x.retention; const q = x.queue; const d = x.disk;
  const state = d.level === 'full' ? ['bad', `The disk is almost full (${bytes(d.free)} free): stored messages and backups are paused until space is freed. Agents keep answering.`]
    : d.level === 'low' ? ['warn', `The disk is getting full (${bytes(d.free)} free). Old data is pruned by itself; fewer local backups or a bigger disk help.`]
      : !x.clock.ok ? ['warn', 'The server clock jumped, so nothing old is pruned until it is steady again (usually fixes itself within an hour).']
        : q.queued >= q.max ? ['warn', 'The photos & voice queue is full: new ones are refused for a few minutes and the senders are told.'] : null;
  const rows = [
    ['Database', `${bytes(x.database.bytes)}${x.database.freeBytes > 1048576 ? ` · ${bytes(x.database.freeBytes)} reusable` : ''}`],
    // one row per kind: how many, since when, how long it is kept
    ['Stored messages', `${n(x.database.rows.messages)}${x.oldest.messages ? ` · since ${day(x.oldest.messages)}` : ''} · kept ${r.messagesDays} days`],
    ['Activity', `${n(x.database.rows.activity)}${x.oldest.activity ? ` · since ${day(x.oldest.activity)}` : ''} · kept ${r.activityDays} days`],
    ['Usage detail', `${n(x.database.rows.usage)}${x.oldest.usage ? ` · since ${day(x.oldest.usage)}` : ''} · kept ${r.usageDays} days`],
    ['Last clean-up', x.lastPrune ? `${ago(x.lastPrune.at)} ago · ${((k) => (k ? `${n(k)} old rows removed` : 'nothing old to remove'))(x.lastPrune.removed.messages + x.lastPrune.removed.activity + x.lastPrune.removed.usage)}${x.vacuumAt ? ` · compacted ${day(x.vacuumAt)}` : ''}` : 'soon after the app starts'],
    ['Photos & voice queue', q.queued || q.running ? `${q.running} working · ${q.queued} waiting (at most ${q.max})` : 'empty'],
    // 075: memory per channel (load cost, measured a minute after it starts); a channel that is off or not set up loads nothing
    ...(x.channels || []).map((c) => [c.label, c.state !== 'on' ? `${c.state === 'off' ? 'off' : 'not set up'} · nothing loaded` : c.measuring ? 'on · memory measured a minute after start' : `on · ${c.memoryMb ? `about ${c.memoryMb} MB` : 'under 1 MB'}`]),
  ];
  const owner = can('owner');
  const num = (k, v) => h('input', { type: 'number', inputmode: 'numeric', name: k, value: v, min: r.limits[k][0], max: r.limits[k][1], style: 'max-width:120px' });
  const F = { messagesDays: num('messagesDays', r.messagesDays), messagesPerChat: num('messagesPerChat', r.messagesPerChat), usageDays: num('usageDays', r.usageDays) };
  // 073: one summary line; what is kept and how long behind Details
  const summary = [bytes(x.database.bytes), `${n(x.database.rows.messages)} messages`, x.lastPrune ? `cleaned up ${ago(x.lastPrune.at)} ago` : 'clean-up soon'].join(' · ');
  return h('div', { class: 'card', id: 'health' },
    h('h2', {}, 'Health'),
    state ? h('div', { class: `note ${state[0]}`, role: 'status' }, state[1]) : h('p', { class: 'small muted', style: 'margin:0' }, h('span', { class: 'dot ok', 'aria-hidden': 'true' }), ` ${summary}`),
    h('details', {}, h('summary', { class: 'small' }, 'Details'),
      h('p', { class: 'small muted' }, 'Old data is pruned by itself every hour. Summaries, notes, People and settings are never pruned.'),
      h('div', { class: 'tscroll' }, h('table', {}, h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', { class: 'muted small' }, k), h('td', {}, v))))))),
    owner ? h('details', {}, h('summary', { class: 'small' }, 'Change how long data is kept'),
      field('Stored messages: days', F.messagesDays, 'Agents remember older talk through the chat summary.'), field('Stored messages: at most per chat', F.messagesPerChat),
      field('Usage detail: days', F.usageDays, 'Spending caps and the Usage screen need the last month; the weekly summary keeps its own counts.'),
      h('p', { class: 'small muted' }, 'Activity is kept as set in ', h('a', { href: '#settings/logging' }, 'Settings → Activity log'), '.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => tryApi(async () => {
        redraw(await api('PUT', '/api/server/retention', Object.fromEntries(Object.entries(F).map(([k, i]) => [k, Number(i.value)])))); }, 'Saved: applies on the next clean-up') }, 'Save')) : null);
}
export async function renderServer() {
  clearInterval(serverTimer); clearTimeout(opsTimer);
  const tilesBox = h('div', { class: 'tiles' }); const infoBox = h('div', { class: 'card' }); const opsBox = h('div', { class: 'card' }); const logBox = h('div', { class: 'card', style: 'margin-top:16px' });
  const hostBox = h('div', { style: 'display:grid' }); const healthBox = h('div', { style: 'display:grid' });
  opsBox.append(h('h2', {}, 'OS updates & maintenance'), h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), ' Checking for OS updates…'));
  $('#main').replaceChildren(tilesBox, h('div', { class: 'grid', style: 'margin-top:16px' }, infoBox, healthBox, opsBox, hostBox), can('admin') ? logBox : null);
  async function tiles() {
    if (S.tab !== 'server') return clearInterval(serverTimer);
    const [x, hist] = await Promise.all([api('GET', '/api/system'), api('GET', '/api/system/history')]).catch(() => [null, []]);
    if (!x) return;
    lastSys = x;
    if (!hostBox.childElementCount) hostBox.append(hostingCard(x.hosting));
    const m = x.memory; const d = x.disks[0];
    const tile = (eyebrow, stat, sub, extra) => h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, eyebrow), stat, sub ? h('div', { class: 'small muted' }, sub) : null, extra);
    tilesBox.replaceChildren(
      tile('CPU', h('div', { class: 'stat' }, x.cpu == null ? '…' : `${Math.round(x.cpu)}`, h('small', {}, '%')), `${x.cpus} core${x.cpus > 1 ? 's' : ''} · load ${x.load.join(' / ')}`, spark(hist.map((p) => p.cpu), 100)),
      tile('Memory', h('div', { class: 'stat' }, `${pct(m.used, m.total)}`, h('small', {}, '%')), `${bytes(m.used)} of ${bytes(m.total)} · app ${bytes(x.app.rss)}`, [meter(pct(m.used, m.total)), spark(hist.map((p) => p.mem), 100)]),
      tile('Disk', h('div', { class: 'stat' }, d ? `${pct(d.used, d.total)}` : '–', h('small', {}, '%')), d ? `${bytes(d.free)} free of ${bytes(d.total)}` : '', d ? meter(pct(d.used, d.total)) : null),
      tile('Swap', h('div', { class: 'stat' }, m.swapTotal ? `${pct(m.swapUsed, m.swapTotal)}` : '–', h('small', {}, m.swapTotal ? '%' : '')), m.swapTotal ? `${bytes(m.swapUsed)} of ${bytes(m.swapTotal)}` : 'No swap', m.swapTotal ? meter(pct(m.swapUsed, m.swapTotal)) : null),
      tile('Network', h('div', { class: 'stat' }, bytes(x.network?.rxRate || 0), h('small', {}, '/s in')), `${bytes(x.network?.txRate || 0)}/s out · total ${bytes(x.network?.rx)} in`, spark(hist.map((p) => p.rx + p.tx))),
      tile('Uptime', h('div', { class: 'stat', style: 'font-size:24px' }, ago(Date.now() - x.uptimeSec * 1000)), `since ${time(Date.now() - x.uptimeSec * 1000)}`,
        x.rebootRequired ? h('a', { class: 'note warn', href: '#server', style: 'display:block', onclick: (e) => { e.preventDefault(); document.getElementById('restart-needed')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'Restart needed to finish updates') : null));
    // 073: one muted line (host · system · kernel · Node), not a table
    infoBox.replaceChildren(h('h2', {}, 'This server'),
      h('p', { class: 'small muted', style: 'margin:0;overflow-wrap:anywhere' }, [x.host, x.os, `kernel ${x.kernel} (${x.arch})`, `Node ${x.app.node} · pid ${x.app.pid}`].join(' · ')),
      serverSizeNote(S.status?.server, S.status?.mediaQueue),
      Object.keys(x.services).length ? h('div', {}, h('h3', {}, 'Services'), h('div', { class: 'row' }, Object.entries(x.services).filter(([, v]) => v !== 'inactive' && v !== 'unknown' || true).map(([k, v]) => h('span', { class: `pill ${v === 'active' ? 'ok' : v === 'inactive' ? '' : 'bad'}` }, `${k}: ${v}`)))) : h('p', { class: 'small muted' }, 'Service status is available on installs that use systemd.'));
  }
  async function opsCard() {
    if (S.tab !== 'server') return;
    if (!can('admin')) { opsBox.replaceChildren(h('h2', {}, 'Maintenance'), h('p', { class: 'small muted' }, 'Admins can see OS updates; owners can run maintenance.')); return; }
    const [upd, ops] = await Promise.all([api('GET', '/api/system/os-updates').catch(() => null), can('owner') ? api('GET', '/api/system/ops').catch(() => null) : null]);
    if (S.tab !== 'server') return;
    const run = ops?.status?.state === 'running' ? ops.status : null;
    // 064: each action asks in the panel's own dialog (q: title, text, optional body with the details), named on its button
    const act = (action, label, cls = '', q = null) => h('button', { class: `btn ${cls}`, disabled: !!run || !ops?.available, onclick: async () => (!q || await ask({ ok: label, danger: cls.includes('danger'), ...q })) && tryApi(async () => { await api('POST', '/api/system/ops', { action }); setTimeout(opsCard, 1500); }, 'Started') }, label);
    const pkgList = (items) => (items?.length ? h('ul', { class: 'small' }, items.slice(0, 30).map((p) => h('li', {}, p.name, ver(p))), items.length > 30 ? h('li', {}, `and ${items.length - 30} more`) : null) : null);
    const reboot = ops?.reboot || lastSys?.reboot || { required: !!lastSys?.rebootRequired, packages: lastSys?.rebootPackages || [] };
    if (S.status?.osUpdates && upd?.supported) serverBadge({ ...S.status.osUpdates, count: upd.count, restart: reboot.required });
    const ver = (p) => (p.from || p.to ? ` ${p.from || 'new'} → ${p.to || '?'}` : '');
    const group = (title, items, row, hint, open = false) => (items?.length ? h('details', { class: 'pkgs', open, style: 'margin-top:6px' },
      h('summary', { class: 'small' }, h('b', {}, `${title} (${items.length})`)),
      hint ? h('div', { class: 'small muted', style: 'margin:4px 0' }, hint) : null,
      h('div', { class: 'small' }, items.slice(0, 200).map(row))) : null);
    const restartBanner = reboot.required ? h('div', { class: 'note warn', id: 'restart-needed', style: 'margin:10px 0' },
      h('b', {}, `Restart needed to finish${reboot.kernel ? ' (new kernel)' : ' updates'}`),
      reboot.since ? ` · waiting since ${time(reboot.since)}` : '',
      reboot.packages?.length ? h('div', { class: 'small', style: 'margin-top:4px;overflow-wrap:anywhere' }, `For: ${reboot.packages.slice(0, 12).join(', ')}${reboot.packages.length > 12 ? ` and ${reboot.packages.length - 12} more` : ''}`) : null,
      h('div', { class: 'small muted', style: 'margin-top:4px' }, 'Agents are offline for 1–2 minutes while the server restarts.'),
      can('owner') && ops?.available ? h('div', { class: 'row', style: 'margin-top:8px' }, act('reboot', 'Restart server', 'danger', { title: 'Restart the whole server now?', text: 'This finishes the updates. Agents are offline for 1–2 minutes and catch up on messages afterwards.', body: reboot.packages?.length ? h('div', {}, h('b', { class: 'small' }, 'Waiting for the restart'), h('ul', { class: 'small' }, reboot.packages.slice(0, 30).map((p) => h('li', {}, p)))) : null })) : null) : null;
    const phasedHint = 'Ubuntu rolls these out gradually: it installs them automatically within days. They are not needed now.';
    const updates = !upd ? null : !upd.supported ? h('p', { class: 'small muted' }, 'OS update checks are available on Debian/Ubuntu servers.')
      : h('div', { style: 'margin:10px 0' },
        upd.count || upd.newPackages
          ? h('div', { class: `note ${upd.security ? 'warn' : ''}` }, h('b', {}, `${plural(upd.count, 'update')} to install`), upd.security ? ` · ${upd.security} security` : '',
            upd.newPackages ? ` · ${plural(upd.newPackages, 'new package')}` : '', ` · checked ${ago(upd.at)} ago`)
          : h('div', { class: 'note ok' }, h('b', {}, '✓ Nothing to install now'), upd.phased.length ? ` · ${upd.phased.length} rolling out gradually` : '', ` · checked ${ago(upd.at)} ago`),
        upd.error ? h('div', { class: 'small muted', style: 'margin-top:4px' }, `Check: ${upd.error}`) : null,
        group('Will install', upd.install, (p) => h('div', { class: 'pkg' }, h('b', {}, p.name), ver(p),
          p.security ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'security') : null, p.isNew ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'new') : null)),
        group('Rolling out gradually', upd.phased, (p) => h('div', { class: 'pkg' }, h('b', {}, p.name), ver(p), p.phased != null ? h('span', { class: 'why' }, ` · ${p.phased}% of servers so far`) : null), phasedHint),
        group('Held back', upd.held, (p) => h('div', { class: 'pkg' }, h('b', {}, p.name), ver(p), h('div', { class: 'why' }, p.why))));
    const last = ops?.status && !run ? ops.status : null;
    const lastLine = last ? h('p', { class: 'small', style: 'margin:0 0 6px' }, h('span', { class: 'muted' }, `Last: ${ops.actions[last.action] || last.action} · ${time(last.endedAt)} · `),
      ops.result?.text ? h('b', {}, ops.result.text) : last.state === 'done' ? 'done' : h('b', { style: 'color:var(--bad)' }, 'failed')) : null;
    // 056: the root maintenance helper updates itself from a release (version 3+); older ones need one root run.
    const helperDoc = h('a', { href: docsUrl('upgrading.md#the-maintenance-helper'), target: '_blank', rel: 'noopener' }, 'how to reinstall');
    const oldHelper = !ops?.available || !(ops.helperOutdated || !ops.helperCurrent) ? null
      : ops.helperSelfUpdate ? h('div', { class: 'note info', id: 'helper-update', style: 'margin-top:10px' },
        h('b', {}, 'A newer maintenance helper comes with this release'), ` (version ${ops.helperVersion} → ${ops.helperBundled}). It normally updates itself after an app update; if that did not happen, update it here. It is downloaded from the official repository by the server itself.`,
        h('div', { class: 'row', style: 'margin-top:8px' }, act('update-helper', 'Update maintenance helper', 'primary', { title: 'Update the maintenance helper?', text: 'The server downloads the root maintenance helper of this release from the official repository. Agents keep running.' })))
        : h('div', { class: 'note info', id: 'helper-update', style: 'margin-top:10px' },
          h('b', {}, 'This server has an older maintenance helper'), ' that cannot update itself yet. Run ', h('code', {}, 'sudo duniya update'),
          ' on the server once; after that it updates itself from here. No SSH access (for example an Oracle server created without an SSH key)? Reinstall instead: ', helperDoc, ' (your data comes back from a backup).');
    opsBox.replaceChildren(h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'OS updates & maintenance'),
      h('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; await api('GET', '/api/system/os-updates?refresh=1').catch(() => {}); opsCard(); } }, 'Check')),
      restartBanner, updates,
      can('owner') ? (ops?.available ? h('div', {},
        run ? h('div', { class: 'note' }, h('span', { class: 'spinner' }), h('b', {}, ` ${ops.actions[run.action] || run.action}…`), ` started ${ago(run.startedAt)} ago`) : null,
        lastLine,
        h('div', { class: 'row', style: 'margin-top:8px' },
          act('os-update', 'Install OS updates', 'primary', { title: 'Install the OS updates now?', text: 'The server stays online. Updates Ubuntu is still rolling out gradually wait. A restart may be needed afterwards.', body: pkgList(upd?.install) }),
          upd?.phased?.length && ops.helperCurrent ? act('os-update-all', 'Include gradual updates now', '', { title: `Also install ${plural(upd.phased.length, 'gradual update')}?`, text: 'Ubuntu is still rolling these out gradually; normally they arrive within days.', body: pkgList(upd.phased) }) : null,
          reboot.required ? null : act('reboot', 'Restart server', 'danger', { title: 'Restart the whole server now?', text: 'Agents are offline for 1–2 minutes and catch up on messages afterwards.' })),
        oldHelper,
        h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'More'),
          h('div', { class: 'row', style: 'margin-top:8px' }, act('os-cleanup', 'Remove unused packages'), act('restart-web', 'Restart web server'), act('restart-tunnel', 'Restart tunnel'))),
        ops.log ? h('details', { open: !!run }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Output'), h('pre', {}, ops.log)) : null)
        : h('div', { class: 'note' }, 'Maintenance actions need a one-time setup on this server: re-run the installer, or redeploy. Metrics and update checks work without it.'))
        : h('p', { class: 'small muted' }, 'Only the owner can run maintenance.'));
    if (run) opsTimer = setTimeout(opsCard, 4000);
  }
  async function logsCard() {
    if (!can('admin')) return;
    const r = await api('GET', `/api/system/logs?unit=${encodeURIComponent(logUnit)}&lines=200`).catch((e) => ({ lines: [], note: e.message }));
    const seg = h('div', { class: 'seg' }, [['whatsapp-agent-duniya', 'App'], ['caddy', 'Web server'], ['cloudflared', 'Tunnel'], ['duniya-ops', 'Maintenance']].map(([u, l]) => h('button', { class: logUnit === u ? 'on' : '', onclick: () => { logUnit = u; logsCard(); } }, l)));
    const pre = h('pre', { style: 'max-height:460px' }, r.lines.length ? r.lines.join('\n') : (r.note || 'No log lines.'));
    logBox.replaceChildren(h('details', { class: 'logs', open: true, ontoggle: (e) => { if (!e.target.open) drawLogsRow(); } }, h('summary', {}, h('h2', { style: 'margin:0;display:inline' }, 'Logs')),
      h('div', { class: 'row spread', style: 'margin-top:10px' }, h('div', { style: 'overflow-x:auto' }, seg), h('button', { class: 'btn small', onclick: logsCard }, 'Refresh')), pre));
    pre.scrollTop = pre.scrollHeight;
  }
  /** 073: Logs start as one row; they load when opened. */
  function drawLogsRow() {
    logBox.replaceChildren(h('details', { class: 'logs', ontoggle: (e) => { if (e.target.open) logsCard(); } }, h('summary', {}, h('h2', { style: 'margin:0;display:inline' }, 'Logs'), h('span', { class: 'small muted' }, ' · app, web server, tunnel, maintenance'))));
  }
  const health = (x) => { if (x) healthBox.replaceChildren(healthCard(x, health)); };
  await tiles(); api('GET', '/api/server/health').then(health).catch(() => {}); opsCard(); if (can('admin')) drawLogsRow();
  serverTimer = setInterval(tiles, 10000);
}

