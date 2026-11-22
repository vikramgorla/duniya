// @ts-check
// Admin tools for WhatsApp groups (see ../admin-tools.js for how a tool is described and run).
import { enc, str, bool, chatName } from './fields.js';

/** @type {import('../admin-tools.js').AdminTool[]} */
export const GROUP_TOOLS = [
  // ---------- WhatsApp groups (026) ----------
  { name: 'get_group_info', openWorld: true, readOnly: true, calls: [['GET', '/api/chats/x/whatsapp']],
    description: 'A WhatsApp group\'s name, description, settings (only admins send, only admins edit info, join approval) and members with admin badges.',
    input: { chat: str('Group chat id (see list_chats)') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp`) },
  { name: 'get_group_invite_link', openWorld: true, readOnly: true, calls: [['GET', '/api/chats/x/whatsapp/invite']],
    description: 'The invite link of a WhatsApp group (the agent\'s number must be a group admin). Each look is recorded.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    run: (a, x) => x.call('GET', `/api/chats/${enc(a.chat)}/whatsapp/invite`) },
  { name: 'reset_group_invite_link', openWorld: true, risky: true, calls: [['POST', '/api/chats/x/whatsapp/invite/revoke']],
    description: 'Reset a WhatsApp group\'s invite link (the old link stops working). Needs confirm_action.',
    input: { chat: str('Group chat id') }, required: ['chat'],
    preview: async (a, x) => `Reset the invite link of ${await chatName(x, a.chat)}. Anyone holding the old link can no longer join with it; share the new link instead.`,
    run: (a, x) => x.call('POST', `/api/chats/${enc(a.chat)}/whatsapp/invite/revoke`) },
  { name: 'update_group', openWorld: true, calls: [['PUT', '/api/chats/x/whatsapp']],
    description: 'Change a WhatsApp group: name, description, only_admins_send, only_admins_edit_info, join_approval. Give only what changes. The agent\'s number must be a group admin.',
    input: { chat: str('Group chat id'), name: str('New group name (optional)'), description: str('New description (optional, empty clears)'),
      only_admins_send: bool('Only admins can send messages (optional)'), only_admins_edit_info: bool('Only admins can edit name/picture/description (optional)'),
      join_approval: bool('Admins approve new members (optional)') }, required: ['chat'],
    run: (a, x) => x.call('PUT', `/api/chats/${enc(a.chat)}/whatsapp`, { subject: a.name, description: a.description, announcement: a.only_admins_send, locked: a.only_admins_edit_info, joinApproval: a.join_approval }) },

];
