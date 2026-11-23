// Sign-in, first-run setup, one-time sign-up and secret links. Module of the panel (063).
// ---------- login & first-run setup ----------
import { $, S, api, boot, field, gLogo, h, logo, meterEl, show, uploadFile, waitForRestart } from './core.js';
export async function renderLogin() {
  S.es?.close(); S.es = null;
  const app = $('#app'); app.replaceChildren();
  // 063: the session answer carries the status when signed in, so the first screen waits for one round trip, not two
  let info = {}; try { info = await (await fetch('/api/session?status=1')).json(); } catch {}
  S.google = !!info.google;
  const brand = () => [h('div', { style: 'display:flex;justify-content:center;margin:4px 0 6px' }, Object.assign(logo(true), { style: 'width:76px;height:76px' })),
    h('h2', { style: 'text-align:center;font-size:24px;margin-bottom:2px' }, 'Duniya')];
  const signup = /^#signup=([a-f0-9]{64})$/.exec(location.hash);
  if (signup) return renderSignup(app, brand, signup[1]);
  if (/^#secret=/.test(location.hash)) sessionStorage.setItem('duniya.link', location.hash); // survives Sign in with Google
  if (info.authed) { S.user = info.user; return boot(info.status); }
  const err = h('div', { class: 'small', style: 'color:var(--bad);min-height:20px;margin-top:6px' });
  if (info.needsSetup) return renderSetup(app, brand);
  if (info.google && info.passwordLogin === false) { // 028: the owner allows only Sign in with Google
    app.append(h('div', { class: 'center' }, h('div', { class: 'card', style: 'width:min(360px,92vw)' }, brand(),
      h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 6px' }, 'Your WhatsApp agents'),
      h('a', { class: 'btn google', href: '/auth/google/start', style: 'width:100%;justify-content:center;margin-top:10px' }, gLogo(), 'Sign in with Google'),
      h('p', { class: 'small muted', style: 'text-align:center;margin:14px 0 0' }, 'This panel only allows Sign in with Google.'),
      h('details', { class: 'small muted', style: 'margin-top:8px' }, h('summary', { style: 'cursor:pointer' }, 'Owner locked out?'),
        h('p', { style: 'margin:6px 0 0' }, 'On the server, run ', h('code', {}, 'sudo duniya enable-password-login'), ' (Docker: ', h('code', {}, 'docker compose exec app duniya enable-password-login'), '), then sign in with your password.')))));
    return;
  }
  const user = h('input', { placeholder: 'Username', value: 'admin', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  app.append(h('div', { class: 'center' }, h('form', { class: 'card', style: 'width:min(360px,92vw)', onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api('POST', '/api/login', { username: user.value, password: pw.value }); S.user = r.user; boot(); } catch (x) { err.textContent = x.message; }
  } }, brand(), h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 6px' }, 'Your WhatsApp agents'),
    info.google ? [h('a', { class: 'btn google', href: '/auth/google/start', style: 'width:100%;justify-content:center;margin-top:10px' }, gLogo(), 'Sign in with Google'), h('div', { class: 'or' }, 'or with your password')] : null,
    field('Username', user), field('Password', pw), err,
    h('button', { class: `btn ${info.google ? '' : 'primary'}`, style: 'width:100%;margin-top:10px;justify-content:center' }, 'Sign in'))));
  if (!info.google) pw.focus();
}

/** 060: a new user's one-time sign-up link (/#signup=…): they choose their own password and are signed in. */
async function renderSignup(app, brand, token) {
  const err = h('div', { class: 'small', style: 'color:var(--bad);min-height:20px;margin-top:6px' });
  const card = h('form', { class: 'card', style: 'width:min(380px,92vw)' }, brand());
  app.append(h('div', { class: 'center' }, card));
  const done = () => { history.replaceState(null, '', location.pathname); renderLogin(); };
  let u;
  try { u = await api('POST', '/api/signup/open', { token }); } catch (x) {
    return card.append(h('p', { class: 'small', style: 'text-align:center' }, x.message), h('button', { class: 'btn', type: 'button', style: 'width:100%;justify-content:center', onclick: done }, 'Go to sign-in'));
  }
  const pw = h('input', { type: 'password', placeholder: '12+ characters', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', placeholder: 'the same again', autocomplete: 'new-password' });
  card.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    if (pw.value !== pw2.value) return (err.textContent = 'The two passwords differ');
    try { const r = await api('POST', '/api/signup', { token, password: pw.value }); S.user = r.user; history.replaceState(null, '', location.pathname); boot(); } catch (x) { err.textContent = x.message; }
  };
  card.append(h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 6px' }, `Welcome, ${u.username}! Choose your password for this panel (${u.role}).`),
    h('input', { type: 'text', value: u.username, autocomplete: 'username', hidden: true }), field('Password', pw), field('Password again', pw2), err,
    h('button', { class: 'btn primary', style: 'width:100%;margin-top:10px;justify-content:center' }, 'Set password and sign in'),
    h('p', { class: 'small muted', style: 'text-align:center;margin:10px 0 0' }, 'This link works once.'));
  pw.focus();
}

/** 060: a one-time secret link (/#secret=…): a signed-in owner or admin pastes a key; it never passes through a chat. */
export async function renderSecretLink(token, backTo = 'settings/secrets') {
  history.replaceState(null, '', `#${backTo}`); // the token leaves the address bar and the history
  const main = $('#main');
  const card = h('form', { class: 'card', style: 'max-width:520px;margin:0 auto' }, h('h2', {}, 'Enter a secret'));
  main.replaceChildren(card);
  const back = h('button', { class: 'btn', type: 'button', onclick: () => show(backTo.split('/')[0]) }, 'Back to the panel');
  let d;
  try { d = await api('POST', '/api/secret-links/open', { token }); } catch (x) { return card.append(h('p', { class: 'small' }, x.message), back); }
  const val = h('input', { type: 'password', placeholder: 'paste the value', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Value for ${d.for}` });
  const err = h('div', { class: 'small', style: 'color:var(--bad);min-height:18px;margin-top:6px' });
  card.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('POST', '/api/secret-links/use', { token, value: val.value }); card.replaceChildren(h('h2', {}, 'Saved ✓'), h('p', { class: 'small muted' }, `${d.for} is stored encrypted on the server. You can close this page.`), back); } catch (x) { err.textContent = x.message; }
  };
  card.append(h('p', { class: 'small muted', style: 'margin-top:0' }, `Asked by ${d.askedBy}. The value goes straight to the server, encrypted, and is never shown again. This link works once, until ${new Date(d.expiresAt).toLocaleTimeString()}.`),
    field(d.for, val), err, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn primary' }, 'Save'), back));
  val.focus();
}

/** First run: create the owner, or move in from another server by restoring a backup file. */
function renderSetup(app, brand) {
  const err = h('div', { class: 'small', style: 'color:var(--bad);min-height:20px;margin-top:6px' });
  const code = h('input', { placeholder: 'Setup code', autocomplete: 'one-time-code', style: 'text-transform:uppercase' });
  const box = h('div', {});
  let mode = 'create';
  const seg = h('div', { class: 'seg', style: 'width:100%;display:flex;margin:6px 0 4px' }, [['create', 'New setup'], ['restore', 'Restore a backup']].map(([v, l]) => h('button', { type: 'button', class: v === mode ? 'on' : '', style: 'flex:1',
    onclick: (e) => { mode = v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); err.textContent = ''; draw(); } }, l)));
  function draw() {
    if (mode === 'create') {
      const user = h('input', { placeholder: 'Username', value: 'admin', autocomplete: 'username' });
      const pw = h('input', { type: 'password', placeholder: 'Password (12+ characters)', autocomplete: 'new-password' });
      box.replaceChildren(h('p', { class: 'small muted' }, 'Create the owner account. You can add other people later (with Google or a password).'),
        field('Username', user), field('Password', pw),
        h('button', { class: 'btn primary', style: 'width:100%;margin-top:12px;justify-content:center', onclick: async (e) => {
          e.preventDefault();
          try { const r = await api('POST', '/api/setup', { code: code.value, username: user.value, password: pw.value }); S.user = r.user; boot(); } catch (x) { err.textContent = x.message; }
        } }, 'Create account'));
    } else {
      const file = h('input', { type: 'file', accept: '.dbk,application/octet-stream' });
      const pass = h('input', { type: 'password', placeholder: 'Backup passphrase', autocomplete: 'off' });
      const meter = meterEl(); const status = h('span', { class: 'small' });
      const prog = h('div', { class: 'hide', style: 'margin-top:10px' }, meter, h('div', { class: 'small muted' }, h('span', { class: 'spinner' }), status));
      const go = h('button', { class: 'btn primary', style: 'width:100%;margin-top:12px;justify-content:center', onclick: async (e) => {
        e.preventDefault(); err.textContent = '';
        const f = file.files[0];
        if (!code.value.trim()) return (err.textContent = 'Enter the setup code first');
        if (!f) return (err.textContent = 'Choose the backup file (.dbk) you downloaded from the old server');
        if (!pass.value) return (err.textContent = 'Enter the backup passphrase');
        go.disabled = true; prog.classList.remove('hide'); status.textContent = ' Uploading…';
        try {
          const up = await uploadFile('/api/setup/upload', f, { 'x-setup-code': code.value.trim() }, (x) => { meter.set(x); status.textContent = ` Uploading… ${Math.round(x * 100)} %`; });
          status.textContent = ' Checking the passphrase…';
          await api('POST', '/api/setup/restore', { code: code.value, upload: up.upload, passphrase: pass.value, name: f.name });
          meter.set(1); waitForRestart(status);
        } catch (x) { err.textContent = x.message; go.disabled = false; prog.classList.add('hide'); }
      } }, 'Upload and restore');
      box.replaceChildren(
        h('p', { class: 'small muted' }, 'Bring everything over from your old server: agents, users, settings, secrets, chat memory and the WhatsApp link.'),
        h('ol', { class: 'small', style: 'padding-left:18px;margin:6px 0' }, h('li', {}, 'On the old server: Backups → “Back up now & download”.'), h('li', {}, 'Here: choose that file and type the backup passphrase.'), h('li', {}, 'This server restarts; sign in with your usual account.')),
        h('div', { class: 'filepick', style: 'margin-top:10px' }, file), field('Backup passphrase', pass, 'The passphrase you set under Backups on the old server. Without it the file cannot be opened.'),
        go, prog,
        h('div', { class: 'note warn', style: 'margin-top:10px' }, 'Turn the old server off (or log WhatsApp out there) once this one runs: the same WhatsApp link should not run in two places.'));
    }
  }
  draw();
  app.append(h('div', { class: 'center' }, h('form', { class: 'card', style: 'width:min(440px,94vw)', onsubmit: (e) => e.preventDefault() }, brand(),
    h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 10px' }, 'Welcome! Let’s set up this server.'),
    field('Setup code', code, 'Shown by the installer, or in the server log: journalctl -u whatsapp-agent-duniya'), seg, box, err)));
  code.focus();
}

