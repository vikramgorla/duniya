# Plan 076

- `src/core/group-replies.js` (new): mode list, in-memory follow-up window per chat (`agentSpoke`, `shouldJudge`,
  `closeFollowups`), `JUDGE_NOTE`, `verdictOf` ([quiet] / [done]). No timers; bounded by count and age.
- `schema.js`: `groupReplies` (`wake` | `followups` | `auto`, default `followups`).
- `router.js`: unaddressed text in a group → `shouldJudge`; per-chat rate limit; `runTurn(..., judge)` logs the message
  only when answered, maps [quiet]/[done] to the silence reason `not_for_me`, never sends error text for judged turns;
  `deliver` opens follow-ups when the agent posts in a group.
- `runner.js`: `ctx.unaddressed` adds `JUDGE_NOTE` to the turn.
- `silences.js`: `not_for_me` (“not for it”).
- Panel (`agent-editor.js`, `styles.css`): tags input, *In groups* select; budget +0.5 KB.
- AI helper (`ai-builder.js`, `ai-helper.js`) and admin MCP `update_agent` know `groupReplies`.
- Small servers: no new timers, memory O(chats on); cost bounded as above.
- Tests: `test/group-replies.test.js`; older wake-word tests pin `groupReplies: 'wake'`; responsive state
  `agent-wake-words`.
