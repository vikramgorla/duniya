# Troubleshooting

**The ten things that most often stop a first day, each with what you see and the fix.**

**Do it:** find what you see below. On your own server, `sudo duniya doctor` checks DNS, HTTPS, ports, disk, memory and
swap and prints the fix.

**In 30 seconds**
- Agent did not answer? **Overview → Why agents stayed quiet** names the reason and the fix, per chat.
- Panel not opening? [Where is my panel?](install.md#where-is-my-panel-find-the-ip--url), then `sudo duniya doctor`.
- Locked out? `sudo duniya reset-password admin` on the server.

## 1. I can't find the panel or the setup code

- The address is in the installer's last lines (Oracle: the stack's **Application information**; Google Cloud: the
  `Ready: https://…` line). Per host: [Where is my panel?](install.md#where-is-my-panel-find-the-ip--url).
- Setup code lost: `sudo duniya show-setup-code`. Already set up and the password is lost:
  `sudo duniya reset-password admin`. More: [Command line](cli.md).

## 2. The QR code does not scan

- Scan from the phone of the **agents' number**: *WhatsApp → Settings → Linked devices → Link a device*. The code
  renews itself every few seconds: wait for the new one rather than reloading.
- Same phone, or the camera won't focus? Under the QR code: **Link with a pairing code** → your number → **Get code**,
  then *Link with phone number instead* on the phone. [Link a number](whatsapp.md#link-a-number)
- WhatsApp allows four linked devices: remove an old one on the phone if it says the limit is reached.

## 3. WhatsApp says "logged out" or the phone was offline

A linked device keeps working while the phone is off, but WhatsApp logs it out after about two weeks without the
phone online, or when someone removes it on the phone. **Settings → Channels → WhatsApp** then shows the number as not
connected with a new QR code: scan it again (or **New QR code**). Chats, agents and memory stay. Keep the phone online when you switch a group on, so its recent messages load.

## 4. The model key is "invalid" or answers stop

- Copy the **whole** key again (no spaces); OpenRouter keys start with `sk-or-`, Claude with `sk-ant-`, OpenAI with
  `sk-`. **Models → the provider → Test** says what the provider answered.
- Free models have daily limits; a paused account shows *usage limit reached, tries again at…* and Duniya switches to
  the backup model if you set one. [Usage limits](models.md#usage-limits) · [Fallback](models.md#fallback-and-several-accounts)

## 5. The agent stays silent in the group

**Overview → Why agents stayed quiet** lists the reason per chat with a fix: the chat is **Off** (every chat starts
off), nobody **mentioned** the agent or used its wake word, the sender is not allowed, a spending cap is reached, a
model error. [Why didn't it answer?](everyday.md#why-didnt-it-answer)

## 6. My own domain shows a certificate error

The domain must point to the server (a DNS **A record** to its public IP) and ports **80** and **443** must be open
(Oracle: the stack opens them; other clouds: their firewall). Check with `sudo duniya doctor`; HTTPS starts by itself
once the domain points here. [Does the domain lead here?](domains-and-access.md#does-the-domain-lead-here) ·
[HTTPS](domains-and-access.md#https)

## 7. The server is slow or runs out of memory

On 1 GB, Duniya uses about 180 MB and adds swap. **Server → Health** shows what is kept and how big it is; heavy
extras (on-server speech, local tool services) stay off unless you turn on **Small server mode** deliberately.
[Small servers](small-servers.md) · [Small server mode](small-servers.md#small-server-mode)

## 8. An update is waiting or did not install

**Settings → Updates** shows the state. A **breaking** release never installs by itself: it waits for your OK on the
panel or in WhatsApp, with what to do. A failed update keeps the previous version running. A release that cannot
start on your server is put back by itself after three tries, and the page says so. On the server:
`sudo duniya update`. [Updates](backups-and-updates.md#updates) ·
[A release that does not start](backups-and-updates.md#a-release-that-does-not-start) ·
[Breaking releases](backups-and-updates.md#breaking-releases-need-your-decision)

## 9. The Telegram bot ignores messages in a group

By default a bot sees only messages that mention it, reply to it or start with `/`. To let agents follow the whole
conversation, turn privacy mode off in @BotFather and add the bot to the group again, or make it a group admin.
[Privacy mode](telegram.md#privacy-mode)

## 10. Something else

1. `sudo duniya doctor`, and `sudo duniya logs` for the last 200 lines (Docker: `docker compose logs --tail 200`).
2. **Activity** in the panel shows what the agents read, answered and changed, live.
3. Ask on GitHub: [Discussions or an issue](../CONTRIBUTING.md#getting-help) with what you did, what you saw and the
   last lines of the log (remove keys and phone numbers first).

---
**Next:** [Getting started](getting-started.md) · [Everyday use](everyday.md) · [Command line](cli.md) · [Docs index](README.md)
