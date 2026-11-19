# 086 · Plan

- Website (`docs/site/index.html`, `style.css`): canonical, og:url/type/site_name, absolute og:image `img/share.jpg`
  (1200×630), twitter card; *Is it for me?* (fit / not a fit) and *What it costs*; Docker as a visible install path;
  FAQ *What do I need to start?* and *Something did not work*; videos start only when visible on wide screens without
  data saver (no `autoplay` attribute; `preload="none"`).
- README: CI / release / MIT badges (release badge URL added to `repo-sync` so forks follow), who it is for, costs,
  troubleshooting link, code of conduct.
- Panel first run: checklist step 1 *Link WhatsApp (or Telegram)* done by either; step 1 links to Telegram; the free
  OpenRouter path spelled out; the key box without jargon; Overview during Getting started hides the status chips,
  the WhatsApp card until linked and the Control card until an agent exists; headline *Link WhatsApp or Telegram to begin*.
- Installer: ERR trap with the next step; DNS check for `--domain`; 60 s health wait and an honest message when the app
  has not answered yet; *Next* and *Guide* lines (guide URL derived from the source repository).
- Docs: `docs/troubleshooting.md` (template: promise, do it, In 30 seconds, ten sections, Next); docs index *What is
  Duniya, and is it for me?* and the troubleshooting row; getting-started steps 1–2.
- Community: `.github/ISSUE_TEMPLATE/question.yml`, `config.yml` (contact links, no blank issues), a hint in `bug.yml`;
  `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, private reports through the repository's vulnerability form);
  CONTRIBUTING *Getting help* and *Good first issues*; label `good first issue`.

No new dependencies, timers or routes.
