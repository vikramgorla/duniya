# Agent tools `whatsapp__*` (026)

Rule names follow the `whatsapp:<tool>` pattern. Defaults:

- **Participant** (P): send_media, send_location, react, reply, create_poll, poll_results, group_info, profile_info.
- **Organizer**: all tools.
- **Org-only** tools cannot be given to participants at all, whatever the rules say.

Every tool except block and unblock takes an optional `chat`: a group name or chat id bound to the same bot. Block
and unblock act on the current chat's number.

| Tool | Input | Default |
|---|---|---|
| send_media | kind, url \| base64 (+mimetype), caption, file_name | P |
| send_location | latitude, longitude, name, address | P |
| send_contact | name, phone, org | organizer |
| react | emoji, message (id or words; default: the current message) | P |
| reply | text, message (default: the current message) | P |
| edit_message | text, message (default: the bot's last message) | organizer |
| delete_message | message (default: the bot's last message) | org-only |
| create_poll | question, options[2..12], multiple | P |
| poll_results | poll (id or words; default: the latest poll) | P |
| group_info | — (phone numbers for organizers only) | P |
| group_invite_link | — | organizer |
| revoke_invite_link | — | org-only |
| add_participants, remove_participants, promote, demote | people[] | org-only |
| set_group_subject | subject | org-only |
| set_group_description | description | org-only |
| set_group_picture | url | org-only |
| set_group_settings | only_admins_send, only_admins_edit_info, join_approval | org-only |
| profile_info | person (default: the sender) | P |
| block, unblock | person | org-only |

All actions are applied immediately, with no confirm code (owner decision on issue #2), and logged as
`whatsapp.action`.
