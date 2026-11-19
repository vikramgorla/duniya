# 086 · Ready for other people

Issue #198. Someone who is not the author finds Duniya, understands it in ten seconds, installs it on a fresh free
server and gets a first agent answering in a group, without help.

## User stories
- As a visitor of the website or README, I see in one line what it is, who it is for (and not for), what it costs and
  how to install it; a link preview shows a proper image.
- As a stranger on a fresh install, Getting started works whether my groups are on WhatsApp or Telegram, tells me how
  to get a free model key step by step, and the first screen is not a row of red chips and duplicate cards.
- As a stranger running the installer, a failure tells me what to do next, a domain that does not point to the server
  is named before HTTPS fails, the final lines say exactly where to go and what comes next, and a slow first start is
  not reported as "already set up".
- As a newcomer reading the docs, I find "What is Duniya / Is it for me", and a troubleshooting page for the top ten
  first-day problems.
- As a would-be contributor, I find issue templates (bug, feature, question), where to get help, a code of conduct and
  what "good first issue" means.

## Acceptance
- Website: no external requests; first view on a phone ≤ 150 KB (videos load only on wide screens, when visible);
  `og:image` absolute, 1200×630; checked at 375 / 393 / 1440, light and dark.
- Checklist step 1 is done when a WhatsApp number or a Telegram bot is connected.
- `shellcheck -S warning` clean; `install.sh --dry-run` unchanged in behaviour.
