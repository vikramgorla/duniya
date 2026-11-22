// @ts-check
// Survey agent tools (083), exposed as surveys__<name>. Decided here, in code:
//   everyone      my_surveys (the sender's open surveys and the next question), answer_survey (records one or more
//                 answers, checked per question kind; returns the next question) — only surveys the sender was sent
//   organizers    survey_results (totals per question; names only of people the agent may see)
import { fail } from '../../core/config.js';
import { canSee, peopleScope } from '../../core/people-access.js';
import { answer, findSurvey, openFor, results, skip } from './index.js';

const ask = (q, n) => (q ? { number: n, id: q.id, question: q.text, kind: q.kind, ...(q.options.length ? { choices: q.options } : {}), ...(q.required ? {} : { optional: true }) } : null);
const mine = (ctx, ref) => {
  if (!ctx.personId) throw fail('I do not know who you are on this app yet.');
  const open = openFor(ctx.personId);
  const o = ref ? open.find((x) => x.survey.id === ref || x.survey.title.toLowerCase().includes(String(ref).toLowerCase())) : open[0];
  if (!o) throw fail(open.length ? 'Which survey? ' + open.map((x) => x.survey.title).join(', ') : 'You have no open survey.');
  return o;
};

export const surveyTools = [
  {
    name: 'my_surveys', annotations: { readOnlyHint: true }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'The surveys the sender was asked to answer and has not finished, each with the next question (text, kind, choices). Ask questions one at a time.',
    input_schema: { type: 'object', properties: {} },
    async run(args, ctx) {
      if (!ctx.personId) return 'I do not know who you are on this app yet.';
      const open = openFor(ctx.personId);
      return open.length ? open.map((o) => ({ survey: o.survey.title, intro: o.survey.intro, answered: `${o.answered} of ${o.of}`, next: ask(o.next, o.answered + 1) })) : 'No open surveys.';
    },
  },
  {
    name: 'answer_survey', annotations: { readOnlyHint: false, destructiveHint: false }, roles: ['organizer', 'participant'], participantDefault: true,
    description: 'Record the sender\'s answer to a survey question (one at a time, as they say it: a choice by its words or number, several choices separated by commas, a short text or a number), or skip an optional one. Returns the next question to ask, or that they are done (thank them).',
    input_schema: { type: 'object', properties: { survey: { type: 'string', description: 'Survey title (optional when they have one open)' }, question: { type: 'string', description: 'Question id, e.g. q1' },
      answer: { type: 'string' }, skip: { type: 'boolean', description: 'Skip an optional question' } }, required: ['question'] },
    async run({ survey, question, answer: value = '', skip: skipIt = false }, ctx) {
      const o = mine(ctx, survey);
      const r = skipIt ? skip(o.survey.id, ctx.personId, question) : answer(o.survey.id, ctx.personId, { [question]: value }, 'chat');
      return r.done ? `Recorded. ${o.survey.title} is complete: thank them.` : { recorded: true, answered: `${r.answered} of ${r.of}`, next: ask(r.next, r.answered + 1) };
    },
  },
  {
    name: 'survey_results', annotations: { readOnlyHint: true }, roles: ['organizer'],
    description: 'Results of a survey (organizers): how many were asked, started and finished; per question the counts per choice, the average of numbers, the latest short texts; and who answered what (people this agent may see).',
    input_schema: { type: 'object', properties: { survey: { type: 'string', description: 'Survey title or id' } }, required: ['survey'] },
    async run({ survey }, ctx) {
      const r = results(findSurvey(survey).id);
      const scope = peopleScope(ctx.agent, { owner: !!ctx.ownerTurn });
      return { survey: r.survey.title, counts: r.counts, totals: r.totals, people: r.people.filter((p) => canSee(scope, p.person)).slice(0, 100).map((p) => ({ name: p.name, done: !!p.doneAt, answers: p.answers })) };
    },
  },
];
