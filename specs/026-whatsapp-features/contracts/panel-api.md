# Panel API (026)

All routes need the admin role (viewers get 403). Each change is logged as `whatsapp.action` with the panel user.

| Route | Purpose |
|---|---|
| `GET /api/whatsapp/tools` | Catalog for the editor: `[{ name, description, organizerOnly, participantDefault }]` |
| `GET /api/chats/:chat/whatsapp` | Group info. Participants come with `name`, sorted owner/admins first. A chat that is not a group gets 400. |
| `GET /api/chats/:chat/whatsapp/invite` | `{ link }`. The look is logged. |
| `POST /api/chats/:chat/whatsapp/invite/revoke` | Resets the link; returns `{ link }`. |
| `PUT /api/chats/:chat/whatsapp` | Body `{ subject?, description?, announcement?, locked?, joinApproval? }` → `{ ok, changed }`. An empty body or an empty subject gets 400. |

Admin MCP tools: `get_group_info`, `get_group_invite_link`, `reset_group_invite_link` (risky: needs
confirm_action) and `update_group`.
