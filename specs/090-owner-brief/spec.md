# 090 · Owner assistant: morning brief, ask your data, suggested next steps, catch-up

Issue #207 (intelligence features 4, 5, 6 and 7, owner-approved).

## User stories
- As the owner, I get one short message each morning with what needs me (payments, questions to me, birthdays, stuck
  things, new people), and nothing when there is nothing.
- As the owner, the brief and the panel suggest next steps ("2 people have not paid — send reminders?") that I approve
  with one code or one tap; nothing is sent or changed before that; dismissed suggestions do not come back.
- As the owner or an organizer, I ask questions across events ("who came last year but hasn't registered?", "who
  usually volunteers for cooking?") and get names, not ids.
- As the owner, I ask "what did I miss in <group>?" and get decisions, open questions and what was asked of me, with
  links to the messages.

## Acceptance
- Brief: daily at its time in the owner assistant's time zone, inside the sending hours (else at their start); once
  per day; to linked owners and admins in their own chat; sections switchable; preview in the panel; no model call.
- Suggestions: deterministic keys; WhatsApp approval through the owner assistant's confirm code; panel approval opens
  the draft send preview (nothing sent), resumes a paused send, or opens Updates; dismissed stays dismissed.
- Read tools: organizers only; hidden people shown as "(hidden)"; no free-form SQL; queries pass check-perf.
- Catch-up: chats that are on and not private only; since the owner's last message there (≤ 7 days) or 24 h; ≤ 120
  messages of ≤ 300 characters; ≤ 600 output tokens; usage kind `catch-up`.
