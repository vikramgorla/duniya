# 071 · Plan

1. Audit: read every page, README and website; screenshots of the demo panel (1440, 393). Findings in the issue's plan
   comment.
2. Remove the startup step in `src/core/backup/index.js` (and its fs imports); release note text; version 2.31.1.
3. Docs IA: new pages, moved sections, deleted pages; fix links (docs, panel help links, `releases.json` GitHub
   links); `node scripts/check-doc-links.mjs`.
4. README and website rewrite; `site-shots.mjs`: tour video with Ask and a search, a WhatsApp numbers card, unused
   shots dropped; `doc-thumbs.mjs`: thumbs for WhatsApp and Chats.
5. Diagrams re-rendered and checked by eye (`--grid`).
6. Checks: test, lint, typecheck, check:panel, ci-checks; the site at 375/393/1440 light/dark by eye.
