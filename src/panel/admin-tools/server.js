// @ts-check
// Admin tools for pending confirmations, settings, updates, the server, backups, users, channels, photos and voice (see ../admin-tools.js for how a tool is described and run).
import { fail } from '../../core/config.js';
import { notAfter, iso, enc, str, bool, int, obj, numbers } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const SERVER_TOOLS = [
  // ---------- pending confirmations ----------
  { name: 'list_pending_confirmations', readOnly: true, calls: [['GET', '/api/pending']], description: 'Changes that agents prepared and that wait for a human to confirm in WhatsApp or the panel.', input: {},
    run: async (a, x) => (await x.call('GET', '/api/pending')).map((p) => ({ ...p, expires: iso(p.expires) })) },
  { name: 'cancel_pending_confirmation', calls: [['DELETE', '/api/pending/x']], description: 'Cancel a waiting change so it can no longer be confirmed.',
    input: { code: str('Its code (see list_pending_confirmations)') }, required: ['code'],
    run: (a, x) => x.call('DELETE', `/api/pending/${enc(a.code)}`) },

  // ---------- settings ----------
  { name: 'set_agents_paused', destructive: true, idempotent: true, calls: [['POST', '/api/settings']], description: 'Pause (true) or resume (false) all agents at once.',
    input: { paused: bool('true = pause all agents') }, required: ['paused'],
    run: async (a, x) => ({ paused: !!(await x.call('POST', '/api/settings', { paused: !!a.paused })).paused }) },
  { name: 'set_small_server_mode', risky: true, calls: [['GET', '/api/server/small-mode'], ['PUT', '/api/server/small-mode']],
    description: 'Small server mode (owner only): on a small server (under 2 GB or 1 CPU) allow heavier features anyway: on-server speech, local tool services and agent apps (Claude Code, Codex, GitHub Copilot) — one voice note / at most 2 services / one agent app at a time, started only when memory allows and stopped when it is tight. Slower and may be refused at busy moments. Needs confirm_action.',
    input: { enabled: bool('true = allow heavier features on this small server') }, required: ['enabled'],
    preview: async (a, x) => {
      const cur = await x.call('GET', '/api/server/small-mode');
      const size = `${cur.server.size} server, ${cur.server.effectiveMb} MB, ${cur.server.cpus} CPU`;
      return a.enabled ? `Switch Small server mode on (${size}; now ${cur.enabled ? 'on' : 'off'}). Allows: ${cur.covers.join('; ')}. Slower; heavier work waits or is refused when memory is tight.`
        : `Switch Small server mode off (${size}; now ${cur.enabled ? 'on' : 'off'}). On a small server, on-server speech stops being used and local tool services stop starting (they stay saved).`;
    },
    run: (a, x) => x.call('PUT', '/api/server/small-mode', { enabled: !!a.enabled }) },
  { name: 'get_logging_settings', readOnly: true, calls: [['GET', '/api/logging']], description: 'What the activity log records: level, categories, retention.', input: {},
    run: (a, x) => x.call('GET', '/api/logging') },
  { name: 'set_logging_settings', calls: [['PUT', '/api/logging']],
    description: 'Change what the activity log records. level: minimal | normal | verbose; categories: { name: true/false } (see get_logging_settings); retention_days; max_entries.',
    input: { level: { type: 'string', enum: ['minimal', 'normal', 'verbose'], description: 'Level (optional)' }, categories: obj('Category switches (optional)'),
      retention_days: int('Keep for days (1–365, optional)'), max_entries: int('At most entries (500–100000, optional)') },
    run: (a, x) => x.call('PUT', '/api/logging', { level: a.level, categories: a.categories, retentionDays: a.retention_days, maxEntries: a.max_entries }) },

  // ---------- updates ----------
  { name: 'get_update_status', readOnly: true, calls: [['GET', '/api/updates']],
    description: 'Running version, last update check, whether an update is available or running. status.notes: every release between the running version and the target, newest first (version, title, summary, breaking, actions, changes: [{ type new | improved | fixed | removed, text }]); tell the owner the key changes before updating. When a breaking release is waiting: breaking, steps (title, summary, actions the owner must take), safeTarget (newest release that needs no decision) and decision. rolledBack: a release that did not start on this server and was put back by itself (from: the version that did not start, to: the version running again, text: what to tell the owner); automatic updates skip that version.', input: {},
    run: (a, x) => x.call('GET', '/api/updates') },
  { name: 'get_release_notes', readOnly: true, calls: [['GET', '/api/releases']],
    description: 'Release notes of the installed version and the ones before it (what is new, improved, fixed or removed per version, newest first). Optional from (exclusive) and to (inclusive), e.g. from v2.24.0 to v2.26.0 for "what changed in the last update".',
    input: { from: str('Versions after this one (optional, e.g. v2.24.0)'), to: str('Up to this version (optional)') },
    run: (a, x) => x.call('GET', `/api/releases?${new URLSearchParams({ from: a.from || '', to: a.to || '' })}`) },
  { name: 'check_for_updates', idempotent: true, openWorld: true, calls: [['POST', '/api/updates/check']], description: 'Check GitHub for a newer version now.', input: {},
    run: (a, x) => x.call('POST', '/api/updates/check') },
  { name: 'set_update_source', openWorld: true, risky: true, calls: [['GET', '/api/updates'], ['PUT', '/api/updates/source']],
    description: 'Change where updates come from: another GitHub repository (owner/name or https://github.com/owner/name), e.g. a fork, or back to the project (source.project in get_update_status). Its releases are read first; nothing changes if that fails. The root maintenance helper keeps its own source (sudo duniya source on the server changes both). Needs confirm_action.',
    input: { repo: str('owner/name or https://github.com/owner/name') }, required: ['repo'],
    preview: async (a, x) => {
      const cur = (await x.call('GET', '/api/updates')).source;
      if (!cur) throw fail('Docker install: the image comes from the registry, not a git source');
      return `Switch updates from ${cur.repo || cur.url || 'the current source'} to ${String(a.repo).trim()}: future updates install that repository's releases`;
    },
    run: (a, x) => x.call('PUT', '/api/updates/source', { repo: a.repo }) },
  { name: 'apply_update', openWorld: true, risky: true, calls: [['POST', '/api/updates/apply']],
    description: 'Install an update and restart; a local backup is made first when a backup passphrase is set. By default installs the newest release that needs no decision. breaking: true also crosses a breaking release (show its steps to the owner first). Needs confirm_action.',
    input: { breaking: bool('Also install a breaking release (owner decision)'), backup: bool('Make a backup first (default true)') },
    preview: async (a, x) => {
      const st = await x.call('POST', '/api/updates/check');
      if (!st.available) throw fail(`Already up to date (${st.current || 'current version'})`);
      const target = st.breaking && !a.breaking ? st.safeTarget : st.target || st.latest;
      if (!target) throw fail(`Version v${st.decisionVersion} is a breaking release: call again with breaking: true after the owner read its steps`, 409);
      const steps = a.breaking && st.breaking ? ` BREAKING: ${st.steps.map((s) => `v${s.version} ${s.title}${s.actions.length ? ` (you must: ${s.actions.join(' ')})` : ''}`).join('; ')}.` : '';
      const notes = (st.notes || []).filter((n) => notAfter(n.version, target));
      const what = notes.length ? ` What changes: ${notes.slice(0, 5).map((n) => `v${n.version} ${n.title}`).join('; ')}${notes.length > 5 ? `; and ${notes.length - 5} earlier releases` : ''}.` : '';
      return `Update from ${st.current} to ${target}.${what}${steps}${a.backup === false ? ' No backup first.' : ''} The app restarts: agents are offline for 1–2 minutes.`;
    },
    run: (a, x) => x.call('POST', '/api/updates/apply', { breaking: a.breaking === true, backup: a.backup !== false }) },
  { name: 'snooze_update_decision', calls: [['POST', '/api/updates/decision']],
    description: 'A breaking release waits for the owner: snooze the reminder for 7 days (action snooze) or dismiss it until a newer breaking release (action dismiss).',
    input: { action: { type: 'string', enum: ['snooze', 'dismiss'], description: 'snooze or dismiss' } }, required: ['action'],
    run: (a, x) => x.call('POST', '/api/updates/decision', { action: a.action }) },

  // ---------- server ----------
  { name: 'get_server_metrics', readOnly: true, calls: [['GET', '/api/system']], description: 'Server CPU, memory, disk, load and uptime right now, and where it is hosted (hosting.provider: oci, gcp, docker, server or unknown) so you can point to the matching hosting guide in docs/deploy/.', input: {},
    run: (a, x) => x.call('GET', '/api/system') },
  { name: 'get_server_health', readOnly: true, calls: [['GET', '/api/server/health']], description: 'Server → Health: database size (bytes, reusable bytes), rows and the oldest kept date of stored messages, activity and usage detail, how long each is kept (retention), the last automatic clean-up (rows removed), free disk (level ok | low | full; at full, stored messages and backups pause), the photos & voice queue and whether the server clock looks steady. Old data is pruned automatically every hour.', input: {},
    run: (a, x) => x.call('GET', '/api/server/health') },
  { name: 'set_retention', risky: true, calls: [['GET', '/api/server/health'], ['PUT', '/api/server/retention']],
    description: 'Owner only: how long data is kept. messages_days (7–3650) and messages_per_chat (200–50000) for stored chat messages, usage_days (30–3650) for model-call detail. Shorter values delete older data on the next clean-up (within the hour); summaries, notes and contacts are never pruned. Activity retention is set with set_logging_settings. Needs confirm_action.',
    input: { messages_days: { type: 'number' }, messages_per_chat: { type: 'number' }, usage_days: { type: 'number' } },
    preview: async (a, x) => {
      const r = (await x.call('GET', '/api/server/health')).retention;
      const parts = [['messages_days', 'messagesDays', 'stored messages kept', 'days'], ['messages_per_chat', 'messagesPerChat', 'stored messages per chat', ''], ['usage_days', 'usageDays', 'usage detail kept', 'days']]
        .filter(([k]) => a[k] !== undefined).map(([k, f, what, unit]) => `${what}: ${r[f]} → ${a[k]}${unit ? ` ${unit}` : ''}${Number(a[k]) < r[f] ? ' (older data is deleted on the next clean-up)' : ''}`);
      return parts.length ? `Change ${parts.join('; ')}.` : 'Nothing to change.';
    },
    run: (a, x) => x.call('PUT', '/api/server/retention', { messagesDays: a.messages_days, messagesPerChat: a.messages_per_chat, usageDays: a.usage_days }) },
  { name: 'list_os_updates', openWorld: true, readOnly: true, calls: [['GET', '/api/system/os-updates']], description: 'Operating-system package updates, grouped: install (will install now; count = how many), phased (Ubuntu is rolling them out gradually: they install automatically within days, or now with run_maintenance os-update-all) and held (kept back, with the reason in why).',
    input: { refresh: bool('Check again now (slower)') },
    run: (a, x) => x.call('GET', `/api/system/os-updates${a.refresh ? '?refresh=1' : ''}`) },
  { name: 'get_maintenance_status', readOnly: true, calls: [['GET', '/api/system/ops']], description: 'Available server maintenance actions, the state of the last one, result.text (summary of the last OS update), reboot (whether a restart is needed to finish updates, and for which packages) and the maintenance helper: helperVersion, helperBundled (the one this release ships), helperOutdated, helperSelfUpdate (it can update itself with run_maintenance update-helper; otherwise sudo duniya update once or a reinstall).', input: {},
    run: (a, x) => x.call('GET', '/api/system/ops') },
  { name: 'run_maintenance', openWorld: true, risky: true, calls: [['POST', '/api/system/ops']],
    description: 'Run a server maintenance action: os-update (install OS updates; Ubuntu\'s gradual roll-outs wait), os-update-all (also the updates Ubuntu is still rolling out gradually), os-cleanup, restart-web, restart-tunnel, reboot (also finishes updates that need a restart) or update-helper (the root maintenance helper fetches the copy of this app\'s release from the repository it was installed from and installs it; get_maintenance_status shows helperOutdated / helperSelfUpdate). Needs confirm_action.',
    input: { action: { type: 'string', enum: ['os-update', 'os-update-all', 'os-cleanup', 'restart-web', 'restart-tunnel', 'reboot', 'update-helper'], description: 'Action' } }, required: ['action'],
    preview: async (a, x) => {
      const ops = await x.call('GET', '/api/system/ops');
      const label = ops.actions?.[a.action];
      if (!label) throw fail('Unknown action');
      const effect = { reboot: 'The whole server restarts: agents and the panel are offline for a few minutes.', 'os-update': 'Takes a few minutes; services may restart.',
        'os-update-all': 'Takes a few minutes; services may restart. Also installs updates Ubuntu is still rolling out gradually (normally they come within days).',
        'update-helper': `The root helper downloads its own files of this app's release (helper ${ops.helperVersion} → ${ops.helperBundled}) from the repository it was installed from and installs them; agents keep running.`,
        'restart-web': 'The panel and AI-assistant access are unreachable for a few seconds.', 'restart-tunnel': 'The panel and AI-assistant access are unreachable for a few seconds.' }[a.action] || '';
      return `${label}. ${effect}`.trim();
    },
    run: (a, x) => x.call('POST', '/api/system/ops', { action: a.action }) },
  { name: 'restart_app', risky: true, calls: [['POST', '/api/system/restart']], description: 'Restart the app. Needs confirm_action.', input: {},
    preview: async () => 'Restart the app. Agents are offline for about a minute and this connection drops briefly.',
    run: (a, x) => x.call('POST', '/api/system/restart') },

  // ---------- backups ----------
  { name: 'get_backup_status', readOnly: true, calls: [['GET', '/api/backups']], description: 'Backup settings, where backups go, and the last backup.', input: {},
    run: (a, x) => x.call('GET', '/api/backups') },
  { name: 'list_backups', readOnly: true, calls: [['GET', '/api/backups/list']], description: 'Backups available in one place: local (default), github or s3.',
    input: { source: { type: 'string', enum: ['local', 'github', 's3'], description: 'Where (default local)' } },
    run: (a, x) => x.call('GET', `/api/backups/list?source=${enc(a.source || 'local')}`) },
  { name: 'run_backup', openWorld: true, calls: [['POST', '/api/backups/run']], description: 'Make an encrypted backup now and send it to the configured places.', input: {},
    run: (a, x) => x.call('POST', '/api/backups/run') },
  { name: 'restore_backup', openWorld: true, risky: true, calls: [['POST', '/api/backups/restore']],
    description: 'Restore a backup (replaces all current data) and restart. Uses the backup passphrase stored on this server (never ask for one); a backup made elsewhere or with another passphrase cannot be restored here: the error gives the panel link to restore it there. Needs confirm_action.',
    input: { source: { type: 'string', enum: ['local', 'github', 's3'], description: 'Where the backup is' }, file: str('Backup file name (see list_backups)') },
    required: ['source', 'file'],
    preview: async (a, x) => {
      const b = await x.call('POST', '/api/backups/restore', { source: a.source, file: a.file, check: true }); // opens it, restores nothing
      return `Restore backup ${a.file} from ${a.source} (made ${iso(b.createdAt) || 'at an unknown time'}). Everything now on the server (agents, chats, memory, settings, users) is replaced by the backup, then the app restarts (agents offline 1–2 minutes).`;
    },
    run: (a, x) => x.call('POST', '/api/backups/restore', { source: a.source, file: a.file }) },

  // ---------- users ----------
  { name: 'list_users', readOnly: true, calls: [['GET', '/api/users']], description: 'Panel users and their roles (owner, admin, viewer).', input: {},
    run: (a, x) => x.call('GET', '/api/users') },
  { name: 'add_user', calls: [['POST', '/api/users']],
    description: 'Add a panel user (role owner | admin | viewer) who sets their own password: returns a one-time sign-up link (48 hours, single use) to forward to that person only. Whoever opens it chooses the password, so never post it in a group. A new link: send_signup_link.',
    input: { username: str('Username (2–40 letters, digits, . _ -)'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'Role' }, email: str('Email (optional)') },
    required: ['username', 'role'],
    run: async (a, x) => {
      const u = await x.call('POST', '/api/users', { username: a.username, role: a.role, email: a.email });
      return { username: u.username, role: u.role, link: u.signup.link, expires: iso(u.signup.expiresAt), note: 'Forward the link to them only: they set their own password (one use, 48 hours).' };
    } },
  { name: 'send_signup_link', risky: true, calls: [['GET', '/api/users'], ['POST', '/api/users/x/signup-link']],
    description: 'A new one-time link (48 hours, single use) where a user sets their own password: for a new user whose link expired, or a forgotten password. Earlier links of that user stop working. Needs confirm_action.',
    input: { user_id: int('User id (see list_users)') }, required: ['user_id'],
    preview: async (a, x) => {
      const u = (await x.call('GET', '/api/users')).find((r) => r.id === Number(a.user_id));
      if (!u) throw fail('User not found', 404);
      return `Make a one-time link where the ${u.role} "${u.username}" sets ${u.hasPassword ? 'a new' : 'their'} password (48 hours).${u.hasPassword ? ' Their current password keeps working until the link is used.' : ''} Whoever opens it can choose the password: send it to them only.`;
    },
    run: async (a, x) => {
      const r = await x.call('POST', `/api/users/${enc(a.user_id)}/signup-link`);
      return { username: r.username, link: r.link, expires: iso(r.expiresAt) };
    } },
  { name: 'update_user', calls: [['PUT', '/api/users/x']], description: 'Change a user\'s role, or disable/enable their account.',
    input: { user_id: int('User id (see list_users)'), role: { type: 'string', enum: ['owner', 'admin', 'viewer'], description: 'New role (optional)' }, disabled: bool('Disable (true) or enable (false) (optional)') },
    required: ['user_id'],
    run: (a, x) => x.call('PUT', `/api/users/${enc(a.user_id)}`, { role: a.role, disabled: a.disabled }) },
  { name: 'remove_user', risky: true, calls: [['DELETE', '/api/users/x']], description: 'Remove a panel user. Needs confirm_action.',
    input: { user_id: int('User id') }, required: ['user_id'],
    preview: async (a, x) => {
      const u = (await x.call('GET', '/api/users')).find((r) => r.id === Number(a.user_id));
      if (!u) throw fail('User not found', 404);
      return `Remove the ${u.role} "${u.username}". They are signed out everywhere and their AI-assistant connections stop working.`;
    },
    run: (a, x) => x.call('DELETE', `/api/users/${enc(a.user_id)}`) },

  // ---------- channels (075, 077) and WhatsApp numbers ----------
  { name: 'list_channels', readOnly: true, calls: [['GET', '/api/channels']],
    description: 'The chat channels of this server (WhatsApp, Telegram) with their state (on, off, not set up), accounts connected, memory used and, for Telegram, the bot (@username, whether it sees every group message, its add-to-group link). Telegram is set up with set_secret name TELEGRAM_BOT_TOKEN (the user pastes the token from @BotFather on the one-time link).', input: {},
    run: (a, x) => x.call('GET', '/api/channels') },
  { name: 'set_channel_enabled', openWorld: true, calls: [['PUT', '/api/channels/x']], risky: (a) => a.enabled === false,
    description: 'Switch a channel on or off. Off closes its connections and frees its memory: agents stop answering there until it is on again (stays linked). Switching off needs confirm_action.',
    input: { channel: str('Channel id: "whatsapp" or "telegram" (see list_channels)'), enabled: { type: 'boolean' } }, required: ['channel', 'enabled'],
    preview: async (a) => `Switch ${a.channel} off: its connections close and agents stop answering on it until it is switched on again. Nothing is unlinked.`,
    run: (a, x) => x.call('PUT', `/api/channels/${enc(a.channel)}`, { enabled: !!a.enabled }) },
  { name: 'set_telegram_dm_agent', calls: [['PUT', '/api/channels/telegram/settings']],
    description: 'Choose the agent that answers direct messages to the Telegram bot (empty: the default agent for direct messages).',
    input: { agent: str('Agent id (see list_agents), or empty for the default') },
    run: (a, x) => x.call('PUT', '/api/channels/telegram/settings', { dmAgent: a.agent || '' }) },
  { name: 'list_whatsapp_numbers', readOnly: true, calls: [['GET', '/api/status']], description: 'WhatsApp numbers and their connection state. Linking a number (QR code / pairing) is done in the panel.', input: {},
    run: async (a, x) => (await numbers(x)).map((n) => ({ id: n.id, label: n.label, status: n.status, me: n.me, dmAgent: n.dmAgent || '' })) },
  { name: 'add_whatsapp_number', openWorld: true, calls: [['POST', '/api/whatsapp/numbers']],
    description: 'Add another WhatsApp number. Afterwards, open the panel (Settings → WhatsApp) on a computer to link it with the phone (QR code).',
    input: { label: str('Name shown in the panel, e.g. "Carpool phone"'), id: str('Short id (optional, lowercase letters, digits, -)') }, required: ['label'],
    run: async (a, x) => ({ ...(await x.call('POST', '/api/whatsapp/numbers', { id: a.id, label: a.label })), next: 'Open the panel → Settings → WhatsApp to link this number with its phone.' }) },
  { name: 'remove_whatsapp_number', risky: true, calls: [['DELETE', '/api/whatsapp/numbers/x']], description: 'Remove an extra WhatsApp number. Needs confirm_action.',
    input: { number_id: str('Number id (see list_whatsapp_numbers)') }, required: ['number_id'],
    preview: async (a, x) => {
      const n = (await numbers(x)).find((r) => r.id === a.number_id);
      if (!n) throw fail('Unknown number', 404);
      return `Remove the WhatsApp number "${n.label}" (${n.id}). It is unlinked from this app and its chats stop getting replies.`;
    },
    run: (a, x) => x.call('DELETE', `/api/whatsapp/numbers/${enc(a.number_id)}`) },
  // ---------- photos & voice (043) ----------
  { name: 'get_photos_and_voice', readOnly: true, calls: [['GET', '/api/media']],
    description: 'What the connected providers can do beyond text (sees images / hears voice notes / creates images / speaks), with how to enable what is missing; the on-server speech engines; the server size (small servers refuse on-server engines) and the media queue.',
    input: {},
    run: async (a, x) => { const r = await x.call('GET', '/api/media'); return { summary: r.summary, providers: r.providers, settings: r.settings, onServer: r.local, server: r.server, localAllowed: r.localAllowed, queue: r.queue }; } },
  { name: 'set_photos_and_voice_settings', calls: [['PUT', '/api/media/settings']],
    description: 'Server-wide photo & voice settings: vision_fallback (provider:model used when an agent\'s model cannot see photos; empty = none), image_model (provider:model for pictures; empty = automatic), voice (OpenAI voice for spoken replies), max_voice_seconds (longest voice note to transcribe), image_price (USD per picture for image_model, for usage and caps), local_listen / local_speak (owner only: use the on-server engines; refused on servers under 2 GB of memory).',
    input: { vision_fallback: str('provider:model or empty (optional)'), image_model: str('provider:model or empty (optional)'), voice: str('alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar (optional)'),
      max_voice_seconds: int('10–1800 (optional)', { minimum: 10, maximum: 1800 }), image_price: { type: 'number', description: 'USD per picture for image_model (optional)' },
      local_listen: bool('Use the on-server listening engine (optional)'), local_speak: bool('Use the on-server speaking engine (optional)') },
    run: async (a, x) => {
      const body = {};
      if (a.vision_fallback !== undefined) body.visionFallback = a.vision_fallback;
      if (a.image_model !== undefined) body.imageModel = a.image_model;
      if (a.voice) body.voice = a.voice;
      if (a.max_voice_seconds) body.maxVoiceSeconds = a.max_voice_seconds;
      if (a.image_price !== undefined) {
        const cur = await x.call('GET', '/api/media');
        const ref = a.image_model || cur.settings.imageModel;
        if (!ref) throw fail('Give image_model with image_price');
        body.imagePrices = { ...cur.settings.imagePrices, [ref]: a.image_price };
      }
      if (a.local_listen !== undefined || a.local_speak !== undefined) body.local = { ...(a.local_listen !== undefined ? { listen: a.local_listen } : {}), ...(a.local_speak !== undefined ? { speak: a.local_speak } : {}) };
      const r = await x.call('PUT', '/api/media/settings', body);
      return { settings: r.settings, summary: r.summary };
    } },
  { name: 'install_speech_engine', openWorld: true, calls: [['POST', '/api/media/local/x/install']],
    description: 'Owner only. Download an on-server speech engine (stt = listening, Whisper tiny ~115 MB; tts = speaking, Piper voice ~65 MB) into the data folder. Needs a server with 2 GB+ of memory. Runs in the background; check get_photos_and_voice for progress.',
    input: { engine: { type: 'string', enum: ['stt', 'tts'], description: 'stt (listening) or tts (speaking)' } }, required: ['engine'],
    run: (a, x) => x.call('POST', `/api/media/local/${enc(a.engine)}/install`) },
  { name: 'set_agent_photos_and_voice', calls: [['PUT', '/api/agents/x']],
    description: 'An agent\'s "Photos & voice" switches: photos (look at photos), documents (read PDFs), stickers, voice_notes (listen to voice notes), voice_reply (never | voice = when they sent a voice note | always), organizers_create_images, participants_create_images.',
    input: { agent_id: str('Agent id'), photos: bool('optional'), documents: bool('optional'), stickers: bool('optional'), voice_notes: bool('optional'),
      voice_reply: { type: 'string', enum: ['never', 'voice', 'always'] }, organizers_create_images: bool('optional'), participants_create_images: bool('optional') }, required: ['agent_id'],
    run: async (a, x) => {
      const cur = (await x.call('GET', `/api/agents/${enc(a.agent_id)}`)).config?.media || {};
      const media = { ...cur, createImages: { ...(cur.createImages || {}) } };
      for (const [k, f] of [['photos', 'photos'], ['documents', 'documents'], ['stickers', 'stickers'], ['voice_notes', 'voiceNotes'], ['voice_reply', 'voiceReply']]) if (a[k] !== undefined) media[f] = a[k];
      if (a.organizers_create_images !== undefined) media.createImages.organizer = a.organizers_create_images;
      if (a.participants_create_images !== undefined) media.createImages.participant = a.participants_create_images;
      const r = await x.call('PUT', `/api/agents/${enc(a.agent_id)}`, { media });
      return { agent: r.id, media: r.config?.media };
    } },
];
