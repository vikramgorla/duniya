# 083 · People step 4b: surveys and campaigns

Issue #186. Builds on 082 (Lists and sending, #184). The design doc is approved; decisions are final.

## Why

Organizers ask the same few questions every time ("which Sunday?", "how many of you?", "what will you bring?") and
chase the same people twice ("did you register?", "did you pay?"). Answers end up scattered in chats; reminders go to
people who already answered. Surveys collect answers in one place; campaigns follow up only where it is needed.

## User stories

1. People → Surveys → New: "Summer picnic" with a single choice, a multiple choice, a number and an optional note.
2. I send it to the Club list: "Hi {first_name}, a few quick questions about {survey}: answer here, or at {survey_link}".
3. Anu opens her link (no sign-in) and answers on the page; Ravi replies in the chat and the agent asks him question by
   question, checking each answer ("Cake" is not a choice).
4. The survey's page shows the counts with bars, the average, the notes, each person's answers, CSV; Anu's page lists
   her answers. The owner assistant answers "what did people answer?".
5. People → Sending → New campaign: a payment reminder, wait 5 days, a last reminder; follow-ups skip people who paid.
   I confirm once; the campaign page shows each step's progress; pause/resume/stop act on its current step.
6. A campaign with a last day stops by itself after it.

## Requirements

- R1 Module `surveys` (`src/modules/surveys/`): `srv_surveys`, `srv_people` (hashed link token), `srv_answers`; refs
  for merge/export/erase. Questions: single, multi, number, text; required flag; ≤ 20; choices 2–12.
- R2 Once answered, questions may be reworded but not added, removed or change kind (409).
- R3 Answers checked in code per kind (choice by words, number or prefix; several by commas/"and"; numbers; text ≤ 500).
- R4 In chat: tools my_surveys and answer_survey (everyone; only surveys the person was sent), survey_results
  (organizers; names only of people the agent may see); the sender card names the open survey and the next question
  (module `card` hook).
- R5 Link page `GET/POST /s/<token>`: public, page CSP, every text escaped, POST only urlencoded with a same-origin
  Origin (server `form` route option), 30 requests a minute per address and per token, 404 for unknown/closed.
- R6 Sends carry a survey (`snd_run_surveys`): `{survey}`, `{survey_link}` (PUBLIC_URL, the domain, else the panel
  address last used); a link is created when the message goes out; no link base → 400 on preview.
- R7 Results: totals, people (≤ 500), CSV formula-safe, person section.
- R8 Campaigns (`snd_campaigns`, `snd_campaign_runs`; 082 tables unchanged): steps message (+ survey) / wait N days;
  stops replied, registered, paid, answered; end day; confirmed once; each message step a run created on the tick
  from the audience with today's facts minus the people the rules take out (skipped with the reason); pause/resume/
  stop follow to the current run; a paused run holds the campaign.
- R9 Admin MCP: list_surveys, get_survey_results, save_survey, delete_survey*, send_to_people(survey),
  start_campaign*, get_campaign, control_campaign.
- R10 check-perf: survey results, campaign page, link page budgets; workload covers previews, answers, the tick.

## Out of scope

Branching questions; anonymous surveys; file uploads; campaign steps other than messages and waits.
