# 072 · Plan

- **Server:** `listMessages` returns `agent` and takes `around` (two indexed queries). `ratingsOf(ids)` in
  `review.js` is one query over `reply_ratings`. `router.deliver` puts the stored id in `message.out` details (an id,
  never text). The activity route joins ratings. The runner names models with `names.js`.
- **Panel:** new `answers.js`, loaded with Chats, Agents and on demand from Activity. It holds `answerActions()`,
  `teachText()` and `entryOpen()`. `changeWithAi()` moves to `ai-helper.js` so Teach works away from the agent page; the
  agent page passes its own save. `chats.js`: the chat page draws its home or a section (`CHAT_SECTIONS`). The old
  Messages & memory card and the Recent messages block are deleted. `pending.js` is rows with names and links.
  `usage.js` gets links and model names.
- **Small servers:** no new timers. The existing #91 status check runs only while the phone sends history. Each query
  is bounded (at most 50 messages, 500 ratings).
- **Privacy:** messages stay admin-only and each look is logged. Answers in private chats are not rated. Activity
  details hold an id only.
- **Budgets:** first screen +0.8 KB, total +4.6 KB (reasons in `scripts/check-panel.mjs`).
