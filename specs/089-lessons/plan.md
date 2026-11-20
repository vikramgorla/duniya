# 089 · Plan

- `src/core/lessons.js`: tables (`lessons`, `lessons_fts`, `judged_answers`, `join_feedback`), CRUD, proposals
  (`lessonFromThumbsDown`, `lessonFromCorrection`, `joinFeedback`), `lessonsContext`, `joinLessonsNote`,
  `noteJudgedAnswer`, `judgedOf`, `forgetChatLessons`.
- Router: correction hook (owner, recent answer) before the addressed check; `deliver` returns the answer id; judged
  answers recorded. Runner: lessons block + join-in note. Memory: erase removes chat lessons.
- Panel: `routes/lessons.js` (list/add/edit/delete, join feedback); rating route proposes on 👎 and counts 👍 on judged
  answers; Review and Messages mark judged answers; `app/lessons.js` (section, loaded on visit); answers.js and quiet.js
  buttons; styles for `.lessons`.
- Admin MCP: five tools. Schema `lessons`.
- Small servers: proposals are event-driven (a rating, a correction, a feedback tap), one background call each, capped
  per day; no timers; lookups by index (`lessons_agent`, FTS); tables tiny.
- No new dependencies (FTS5 is part of node:sqlite).
