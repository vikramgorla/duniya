#!/usr/bin/env node
// `duniya` — manage a Duniya server from the command line (029). On an installer server run it as `sudo duniya …`
// (/usr/local/bin/duniya loads /etc/duniya/app.env and runs this file as the app user); in Docker:
// `docker compose exec app duniya …`. Safe while the service runs: SQLite is in WAL mode with a busy timeout, and
// this process never applies a staged restore.
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import dns from 'node:dns/promises';
import net from 'node:net';

process.env.DUNIYA_CLI = '1';
const ROOT = resolve(import.meta.dirname, '..');
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c('1'); const dim = c('2'); const green = c('32'); const yellow = c('33'); const red = c('31');
const out = (...a) => console.log(...a);
/** Shows a secret the operator asked for (a made-up password) on the terminal only; never goes to logs. */
const showSecret = (label, secret) => process.stdout.write(`  ${label}: ${bold(secret)}`);
class UsageError extends Error {}
const fail = (msg) => { throw new Error(msg); };

const HELP = `${bold('duniya')} — manage this Duniya server from the command line

${bold('Accounts')}
  list-users                              Show all panel accounts
  create-user <name> [--role admin|viewer|owner] [--email ADDRESS] [--password PW]
                                          Add an account (a password is made up and printed if you leave it out)
  reset-password <user> [--password PW]   Set a new password (asks for one, or makes one up)
  set-role <user> <owner|admin|viewer>    Change what an account may do
  remove-user <user> [--yes]              Delete an account
  enable-password-login                   Allow passwords again (if "only Google" locked you out)
  show-setup-code                         The one-time code that creates the first owner account

${bold('Server')}
  status                                  Version, uptime, WhatsApp numbers and agents
  doctor                                  Check address, HTTPS, ports, disk and memory, with fixes
  backup-now                              Make an encrypted backup now (to every place set up under Backups)
  restart                                 Restart the service (agents are offline for a few seconds)
  logs [-f]                               Show the service log (-f keeps following it)
  update [--check] [--breaking]           Update to the newest release that needs no decision (--check only looks;
                                          --breaking also installs a breaking release). Backup first when set up
  open-access                             Remove the IP allow-list (if it locked you out of the panel)

Examples
  sudo duniya reset-password admin
  sudo duniya create-user anu --role viewer
  docker compose exec app duniya status
`;

// ---------- argument parsing ----------
function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f') flags.follow = true;
    else if (a === '-y') flags.yes = true;
    else if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (['role', 'email', 'password', 'lines'].includes(k)) { if (argv[i + 1] === undefined) throw new UsageError(`--${k} needs a value`); flags[k] = argv[++i]; } else flags[k] = true;
    } else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), flags };
}

// ---------- small helpers ----------
const ago = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s}s`; const m = Math.round(s / 60); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 48) return `${h}h ${m % 60}m`; return `${Math.floor(h / 24)}d ${h % 24}h`; };
const gb = (n) => `${(n / 1073741824).toFixed(n < 10737418240 ? 1 : 0)} GB`;
function makePassword() {
  const A = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(16);
  return Array.from(b, (x, i) => A[x % A.length] + (i % 4 === 3 && i < 15 ? '-' : '')).join('');
}
function ask(question, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (s === '\r\n' || s === '\n') rl.output.write('\n'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); });
  });
}
const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

async function core() {
  const store = await import('../src/core/store.js');
  const { activity } = await import('../src/core/events.js');
  return { ...store, activity };
}
async function findUser(store, who) {
  if (!who) throw new UsageError('Say which account, e.g. duniya reset-password admin');
  const all = store.listUsers();
  const key = String(who).trim().toLowerCase();
  const u = all.find((x) => x.username === key) || all.find((x) => x.email && x.email.toLowerCase() === key) || (/^\d+$/.test(key) ? all.find((x) => x.id === Number(key)) : null);
  if (!u) fail(`There is no account "${who}". See: duniya list-users`);
  return u;
}
const installKind = () => process.env.DUNIYA_INSTALL || (existsSync(resolve(ROOT, '.git')) ? 'dev' : 'unknown');
const pkgVersion = () => { try { return `v${JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version}`; } catch { return 'unknown'; } };

// ---------- commands ----------
const commands = {
  async 'list-users'() {
    const s = await core();
    const users = s.listUsers();
    if (!users.length) { out('No accounts yet. Create the owner in the panel with the setup code (duniya show-setup-code).'); return; }
    const rows = users.map((u) => [u.username, u.role, [u.hasPassword ? 'password' : '', u.google ? 'Google' : ''].filter(Boolean).join(' + ') || '—', u.email || '', u.disabled ? 'disabled' : '']);
    const w = [0, 1, 2, 3].map((i) => Math.max(['USER', 'ROLE', 'SIGNS IN WITH', 'EMAIL'][i].length, ...rows.map((r) => r[i].length)));
    out(dim(['USER', 'ROLE', 'SIGNS IN WITH', 'EMAIL'].map((h, i) => h.padEnd(w[i])).join('  ')));
    for (const r of rows) out(`${bold(r[0].padEnd(w[0]))}  ${r[1].padEnd(w[1])}  ${r[2].padEnd(w[2])}  ${r[3].padEnd(w[3])}  ${r[4] ? yellow(r[4]) : ''}`.trimEnd());
  },

  async 'create-user'([name], f) {
    if (!name) throw new UsageError('Usage: duniya create-user <name> [--role admin|viewer|owner] [--email ADDRESS] [--password PW]');
    const s = await core();
    const role = f.role || 'admin';
    const password = typeof f.password === 'string' ? f.password : makePassword();
    const u = s.createUser({ username: name, email: typeof f.email === 'string' ? f.email : '', role, password });
    s.activity('system', { summary: `User ${u.username} (${u.role}) added from the server command line` });
    out(green(`✓ Added ${u.username} (${u.role}).`));
    if (typeof f.password !== 'string') { showSecret('Password', password); out('   (give it to them; they can change it under Settings)'); }
    await passwordHint();
  },

  async 'reset-password'([who], f) {
    const s = await core();
    const u = await findUser(s, who);
    let pw = typeof f.password === 'string' ? f.password : '';
    let generated = false;
    if (!pw && interactive()) {
      pw = await ask(`New password for ${u.username} (12+ characters, Enter = make one up): `, { hidden: true });
      if (pw && pw !== await ask('Type it again: ', { hidden: true })) fail('The two passwords are different. Nothing changed.');
    }
    if (!pw) { pw = makePassword(); generated = true; }
    s.updateUser(u.id, { password: pw });
    s.activity('system', { summary: `Password reset for ${u.username} from the server command line (signed out everywhere)` });
    out(green(`✓ New password set for ${u.username}. They were signed out everywhere.`));
    if (generated) { showSecret('Password', pw); out(''); }
    if (u.disabled) out(yellow('  Note: this account is disabled. Enable it in the panel (Settings → Users) to use it.'));
    await passwordHint();
  },

  async 'set-role'([who, role]) {
    if (!who || !role) throw new UsageError('Usage: duniya set-role <user> <owner|admin|viewer>');
    const s = await core();
    const u = await findUser(s, who);
    const n = s.updateUser(u.id, { role: String(role).toLowerCase() });
    s.activity('system', { summary: `Role of ${n.username}: ${u.role} → ${n.role} (server command line)` });
    out(green(`✓ ${n.username} is now ${n.role}.`));
  },

  async 'remove-user'([who], f) {
    const s = await core();
    const u = await findUser(s, who);
    if (!f.yes) {
      if (!interactive()) fail(`Add --yes to remove ${u.username} without a question.`);
      if (!/^y(es)?$/i.test(await ask(`Remove ${u.username} (${u.role})? They can no longer sign in. [y/N] `))) { out('Nothing changed.'); return; }
    }
    s.deleteUser(u.id);
    s.activity('system', { summary: `User ${u.username} removed from the server command line` });
    out(green(`✓ Removed ${u.username}.`));
  },

  async 'enable-password-login'() {
    await core();
    const { setGoogleOnly, passwordLoginAllowed } = await import('../src/core/google-signin.js');
    const was = !passwordLoginAllowed();
    setGoogleOnly(false, { by: 'server command line', source: 'cli' });
    out(green(was ? '✓ Password sign-in is on again. Sign in with your username and password.' : '✓ Password sign-in was already on.'));
    out('  Forgot the password? Run: duniya reset-password <user>');
  },

  async 'show-setup-code'() {
    const s = await core();
    const { DATA_DIR } = await import('../src/core/config.js');
    if (s.countUsers() > 0) { out('This server is already set up, so there is no setup code. Lost your password? Run: duniya reset-password <user>'); return; }
    const f = resolve(DATA_DIR, 'setup-code.txt');
    if (!existsSync(f)) fail('No setup code yet: start the service once (duniya restart), then try again.');
    out(`Setup code: ${bold(readFileSync(f, 'utf8').trim())}`);
    out('Open the admin panel and enter it to create the owner account.');
  },

  async status() {
    const s = await core();
    const { readRuntime } = await import('../src/core/runtime.js');
    const { passwordLoginAllowed, googleReady } = await import('../src/core/google-signin.js');
    const rt = readRuntime();
    const disk = pkgVersion();
    const line = (k, v) => out(`${dim(k.padEnd(10))}${v}`);
    out(bold(`Duniya ${rt?.version || disk}`) + (rt?.version && rt.version !== disk ? yellow(`  (${disk} on disk: restart to use it)`) : ''));
    line('Service', !rt ? yellow('not seen yet (is it running? try: duniya restart)')
      : rt.running ? green(`running · up ${ago(Date.now() - rt.startedAt)} · pid ${rt.pid} · ${rt.rssMb} MB`) : red(`not running · last seen ${ago(Date.now() - rt.at)} ago`));
    line('Address', process.env.PUBLIC_URL || dim('only on this machine (http://127.0.0.1:8080)'));
    const nums = rt?.numbers || [];
    if (!nums.length) line('WhatsApp', dim('no numbers yet'));
    nums.forEach((n, i) => line(i ? '' : 'WhatsApp', `${n.label}: ${n.status === 'open' ? green(`connected${n.me ? ` as +${n.me}` : ''}`) : yellow(n.status === 'qr' ? 'waiting for the QR scan / pairing code' : n.status)}${rt.running ? '' : dim(' (last known)')}`));
    const agents = s.listAgentRows();
    line('Agents', agents.length ? `${agents.filter((b) => b.config.enabled).length} on, ${agents.filter((b) => !b.config.enabled).length} off` : dim('none yet (Agents → New agent in the panel)'));
    for (const b of agents) line('', `${b.config.enabled ? green('●') : dim('○')} ${b.config.name || b.id} ${dim(`· ${(b.config.chats || []).length} chat${(b.config.chats || []).length === 1 ? '' : 's'}`)}`);
    line('Accounts', `${s.listUsers().length} · sign-in: ${!passwordLoginAllowed() ? 'Google only' : googleReady() ? 'Google and password' : 'password'}`);
    if (s.getSetting('paused', false)) line('Paused', yellow('all agents are paused (Overview → Resume)'));
    const { kvGet } = await import('../src/core/db.js');
    try { const last = JSON.parse(kvGet('backup:last') || 'null'); line('Backup', last ? `${ago(Date.now() - last.at)} ago · ${Object.entries(last.results).map(([k, v]) => `${k} ${v}`).join(', ')}` : dim('none yet')); } catch { /* none */ }
  },

  async 'backup-now'() {
    await core();
    const { runBackup } = await import('../src/core/backup/index.js');
    out('Making a backup…');
    try {
      const r = await runBackup({ reason: 'cli', appVersion: pkgVersion() });
      const bad = Object.entries(r.results).filter(([, v]) => v.startsWith('error'));
      out((bad.length ? yellow : green)(`${bad.length ? '!' : '✓'} ${r.file} (${Math.round(r.size / 1024)} KB): ${Object.entries(r.results).map(([k, v]) => `${k} ${v}`).join(', ')}`));
      if (bad.length) process.exitCode = 1;
    } catch (e) {
      if (/passphrase/.test(e.message)) fail('Set a backup passphrase first: panel → Backups.');
      throw e;
    }
  },

  async restart() {
    const kind = installKind();
    if (kind === 'docker') { out('Restarting the app (the container restarts it)…'); process.kill(1, 'SIGTERM'); return; }
    if (kind === 'systemd') {
      try { execFileSync('systemctl', ['restart', 'whatsapp-agent-duniya'], { stdio: 'inherit' }); out(green('✓ Restarted.')); } catch { fail('Could not restart. Run it with sudo: sudo duniya restart'); }
      return;
    }
    fail('Restart the process you started (npm start).');
  },

  async logs(args, f) {
    const kind = installKind();
    if (kind === 'docker') { out('In Docker, logs are shown by Docker: docker compose logs -f app'); return; }
    const a = ['-u', 'whatsapp-agent-duniya', '-n', String(Number(f.lines) || 200), '--no-pager', '-o', 'short-iso'];
    if (f.follow) a.push('-f');
    await new Promise((res) => spawn('journalctl', a, { stdio: 'inherit' }).on('close', res).on('error', () => { out('journalctl is not available here.'); res(); }));
  },

  async update(args, f) {
    const kind = installKind();
    if (kind === 'docker') { out('In Docker, update the image on the host: docker compose pull && docker compose up -d'); return; }
    await core();
    const u = await import('../src/core/updates.js');
    const st = await u.checkForUpdate();
    if (!st.available) { out(green(`✓ Up to date: ${st.current}${st.channel === 'main' ? ' (main)' : ''}`)); process.exitCode = f.check ? 0 : 3; return; }
    out(`Update available: ${bold(st.latest)} · running ${st.current}`);
    for (const s of st.steps || []) {
      out(`${bold(`⚠ v${s.version} is a breaking release`)}: ${s.title}`);
      if (s.summary) out(`  ${s.summary}`);
      for (const a of s.actions) out(`  - ${a}`);
    }
    const target = st.breaking && !f.breaking ? st.safeTarget : st.target;
    if (f.check) { out(st.breaking ? `Install ${st.safeTarget || 'nothing safe yet'} with: sudo duniya update · the breaking release with: sudo duniya update --breaking` : 'Install it with: sudo duniya update'); return; }
    if (!target) { out(`Nothing to install without a decision. Read the notes above, then: sudo duniya update --breaking`); process.exitCode = 3; return; }
    out(`Updating to ${target}${u.backupConfigured() ? ' (local backup first)' : ''}…`);
    const r = await u.applyUpdate({ target, by: 'command line' });
    process.stdout.write(r.log.endsWith('\n') ? r.log : `${r.log}\n`);
    if (r.code !== 0) fail('Update failed; the previous version is kept.');
    out(green(`✓ Updated to ${target}.`) + (process.env.DUNIYA_WRAPPER ? ' Restarting…' : ' Now restart: sudo duniya restart'));
  },

  async 'open-access'() {
    await core();
    const { openAccess } = await import('../src/core/webaccess.js');
    const r = await openAccess('server command line');
    out(r.requested ? green('✓ IP allow-list removed. The web server is being updated (about 10 seconds).') : green(`✓ ${r.message}`));
  },

  async doctor() {
    const results = [];
    const ok = (t) => results.push(['ok', t]); const warn = (t, fix) => results.push(['warn', t, fix]); const bad = (t, fix) => results.push(['bad', t, fix]);
    const s = await core();
    const { readRuntime } = await import('../src/core/runtime.js');
    const { DATA_DIR } = await import('../src/core/config.js');
    const kind = installKind();
    const rt = readRuntime();
    const fixRestart = kind === 'docker' ? 'docker compose up -d' : 'sudo duniya restart, then sudo duniya logs';
    if (rt?.running) ok(`Service running (up ${ago(Date.now() - rt.startedAt)})`); else bad('Service is not running', fixRestart);
    const port = Number(process.env.PANEL_PORT || 8080);
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) }); r.ok ? ok(`Panel answers on 127.0.0.1:${port}`) : bad(`Panel answered ${r.status}`, fixRestart); } catch { bad(`Panel does not answer on 127.0.0.1:${port}`, fixRestart); }
    const nums = rt?.numbers || [];
    for (const n of nums) n.status === 'open' ? ok(`WhatsApp ${n.label} connected`) : warn(`WhatsApp ${n.label}: ${n.status}`, 'Open the panel → Overview and link the number again (QR or pairing code)');

    const pub = String(process.env.PUBLIC_URL || '').trim();
    if (!pub) warn('No public address: the panel is only reachable on this machine', kind === 'docker' ? 'Set DOMAIN and use the https profile (docs/deploy/docker.md)' : 'Re-run the installer with --ip-https or --domain NAME');
    else {
      const host = new URL(pub).hostname;
      const { publicIp, providerOf, PROVIDERS } = await import('../src/core/webaccess.js');
      const ip = await publicIp().catch(() => '');
      let addrs = [];
      try { addrs = [...await dns.resolve4(host).catch(() => []), ...await dns.resolve6(host).catch(() => [])]; } catch { /* none */ }
      const prov = addrs.length ? providerOf(addrs[0]) : null;
      if (process.env.DUNIYA_EXPOSURE === 'tailscale') ok(`${host} (Tailscale: only reachable inside your tailnet)`);
      else if (!addrs.length) bad(`${host} does not resolve`, `Create a DNS record: A ${host} → ${ip || 'this server\'s public IP'}`);
      else if (ip && addrs.includes(ip)) ok(`${host} points to this server (${ip})`);
      else if (process.env.DUNIYA_EXPOSURE === 'tunnel') ok(`${host} resolves (Cloudflare Tunnel)`);
      else if (prov) ok(`${host} is behind a proxy/CDN (looks like ${PROVIDERS[prov].name})`);
      else warn(`${host} points to ${addrs.join(', ')}${ip ? `, but this server is ${ip}` : ''}`, `If it goes through a proxy/CDN that is fine (the HTTPS check below tells); otherwise change the DNS record: A ${host} → ${ip || 'this server\'s public IP'}`);
      try {
        const r = await fetch(`${pub.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(10000) });
        r.ok ? ok(`HTTPS works: ${pub}`) : warn(`${pub} answered ${r.status}`, 'Check the web server: sudo duniya logs, and Server → Logs → Web server');
      } catch (e) {
        const why = String(e.cause?.code || e.cause?.message || e.message);
        bad(`HTTPS does not work at ${pub} (${why})`, /CERT|SSL|TLS/i.test(why) ? 'The certificate is missing: check that ports 80 and 443 are open in your cloud firewall, then sudo systemctl restart caddy'
          : 'Open ports 80 and 443 in your cloud provider\'s firewall (security list / firewall rules) and check the DNS record');
      }
    }
    if (kind === 'systemd' && ['ip', 'domain'].includes(process.env.DUNIYA_EXPOSURE || 'ip') && pub) {
      for (const p of [80, 443]) (await listening(p)) ? ok(`Port ${p} is listening`) : bad(`Nothing listens on port ${p}`, 'sudo systemctl restart caddy (or re-run the installer)');
    }
    try {
      const st = statfsSync(DATA_DIR); const free = st.bavail * st.bsize; const total = st.blocks * st.bsize;
      if (free < 300 * 1048576) bad(`Disk almost full: ${gb(free)} free of ${gb(total)}`, 'Panel → Server → Remove unused packages; delete old backups (Backups); enlarge the disk');
      else if (free < 1073741824) warn(`Disk low: ${gb(free)} free of ${gb(total)}`, 'Panel → Server → Remove unused packages; keep fewer backups');
      else ok(`Disk: ${gb(free)} free of ${gb(total)}`);
    } catch { /* no statfs */ }
    try {
      const m = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => { const [k, v] = l.split(':'); return [k, parseInt(v, 10) * 1024]; }));
      const avail = m.MemAvailable; const total = m.MemTotal;
      if (avail < 80 * 1048576) bad(`Memory almost full: ${Math.round(avail / 1048576)} MB available of ${Math.round(total / 1048576)} MB`, 'Restart the service, or move to a VM with more memory');
      else ok(`Memory: ${Math.round(avail / 1048576)} MB available of ${Math.round(total / 1048576)} MB`);
      if (total < 2147483648 && !m.SwapTotal) warn('No swap on a small machine', 'Re-run the installer (it adds 2 GB swap), or: sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile');
    } catch { /* not Linux */ }
    if (kind === 'systemd') {
      existsSync('/usr/local/sbin/duniya-ops') ? ok('Server maintenance helper installed') : warn('Server maintenance helper missing', 'Re-run the installer once');
      if (!existsSync('/usr/local/lib/duniya-ops/webconfig.mjs')) warn('Web address & access settings need a newer helper', 'Re-run the installer once');
    }
    const { passwordLoginAllowed } = await import('../src/core/google-signin.js');
    if (!passwordLoginAllowed()) ok('Sign-in: only Google (if that fails: duniya enable-password-login)');
    if (!s.listUsers().some((u) => u.role === 'owner' && !u.disabled)) bad('No owner account', s.countUsers() ? 'duniya set-role <user> owner' : 'duniya show-setup-code, then create the owner in the panel');
    const major = Number(process.versions.node.split('.')[0]);
    major >= 22 ? ok(`Node.js ${process.version}`) : bad(`Node.js ${process.version} is too old`, 'Re-run the installer (installs Node.js 22)');

    for (const [k, t, fix] of results) {
      out(`${k === 'ok' ? green('✓') : k === 'warn' ? yellow('!') : red('✗')} ${t}`);
      if (fix) out(dim(`    → ${fix}`));
    }
    const nBad = results.filter((r) => r[0] === 'bad').length; const nWarn = results.filter((r) => r[0] === 'warn').length;
    out(nBad ? red(`\n${nBad} problem${nBad > 1 ? 's' : ''} found.`) : nWarn ? yellow(`\nWorks, with ${nWarn} thing${nWarn > 1 ? 's' : ''} to look at.`) : green('\nEverything looks good.'));
    if (nBad) process.exitCode = 1;
  },
};

/** Is something listening on this TCP port (any address)? Read from /proc so no root is needed. */
async function listening(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try { if (readFileSync(f, 'utf8').split('\n').some((l) => { const p = l.trim().split(/\s+/); return p[1]?.endsWith(`:${hex}`) && p[3] === '0A'; })) return true; } catch { /* none */ }
  }
  return new Promise((res) => { const sck = net.connect(port, '127.0.0.1'); sck.on('connect', () => { sck.destroy(); res(true); }); sck.on('error', () => res(false)); sck.setTimeout(1500, () => { sck.destroy(); res(false); }); });
}

async function passwordHint() {
  const { passwordLoginAllowed } = await import('../src/core/google-signin.js');
  if (!passwordLoginAllowed()) out(yellow('  Note: password sign-in is switched off (only Google). To use passwords: duniya enable-password-login'));
}

// ---------- main ----------
const ALIASES = { users: 'list-users', 'add-user': 'create-user', 'delete-user': 'remove-user', backup: 'backup-now', 'setup-code': 'show-setup-code', passwd: 'reset-password' };
async function main() {
  let p;
  try { p = parse(process.argv.slice(2)); } catch (e) { console.error(red(e.message)); return 2; }
  const name = ALIASES[p.cmd] || p.cmd;
  if (name === 'version' || (!name && p.flags.version)) { out(pkgVersion()); return 0; }
  if (!name || name === 'help' || p.flags.help) { out(HELP); return 0; }
  const fn = commands[name];
  if (!fn) { console.error(red(`Unknown command "${p.cmd}".`)); out(`\n${HELP}`); return 2; }
  try { await fn(p.args, p.flags); return process.exitCode ?? 0; } catch (e) {
    if (e instanceof UsageError) { console.error(red(e.message)); return 2; }
    console.error(red(`✗ ${e.message}`));
    if (/SQLITE_CANTOPEN|EACCES|permission denied/i.test(e.message)) console.error(dim('    → Run it as the app user: sudo duniya …'));
    return 1;
  }
}
const code = await main();
process.exit(code);
