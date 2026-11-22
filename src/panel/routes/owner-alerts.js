// Panel routes for spending caps (040, #35). Owner alerts and the weekly summary (041) belong to the built-in owner
// assistant (059): its Alerts section and its weekly-summary schedule in the agent editor.
import { budgetOverview, setCap, getCap, capStatus, listCaps, CURRENCY, SCOPES } from '../../core/budget.js';
import { chatLabels } from '../../core/chat-names.js';
import { ownerNumber } from '../../core/owner-alerts.js';
import { listAgents, getAgent } from '../../core/agents.js';
import { activity } from '../../core/events.js';

export function ownerAlertRoutes(route, { channel } = {}) {
  // ---------- spending caps ----------
  route('GET', '/api/budget', async () => {
    const chats = chatLabels(listCaps().filter((c) => c.scope === 'chat').map((c) => c.id));
    const agents = new Map(listAgents().map((a) => [a.id, a.name]));
    return { ...budgetOverview({ agentName: (id) => agents.get(id) || `${id} (deleted)`, chatName: (id) => chats.get(id) }), alertsTo: ownerNumber() };
  });
  route('GET', '/api/budget/:scope/:id', async (req, res, body, q, p) => {
    if (!SCOPES.includes(p.scope)) return [404, { error: 'Not found' }];
    const cap = getCap(p.scope, decodeURIComponent(p.id));
    return { currency: CURRENCY, cap: cap ? capStatus(cap) : null };
  });
  route('PUT', '/api/budget/:scope/:id', async (req, res, body, q, p, user) => {
    const id = decodeURIComponent(p.id);
    if (p.scope === 'agent' && !getAgent(id)) return [404, { error: 'Agent not found' }];
    const cap = setCap(p.scope, id, { cost: body.cost, tokens: body.tokens, fallback: body.fallback });
    const what = p.scope === 'agent' ? `agent ${id}` : `chat ${id}`;
    activity('config', { agent: p.scope === 'agent' ? id : '', chat: p.scope === 'chat' ? id : '',
      summary: cap ? `Monthly cap for ${what}: ${[cap.cost ? `$${cap.cost}` : '', cap.tokens ? `${cap.tokens} tokens` : ''].filter(Boolean).join(' / ')}${cap.fallback ? `, then ${cap.fallback}` : ', then quiet'} (${user.username})` : `Monthly cap for ${what} removed (${user.username})` });
    return { currency: CURRENCY, cap: cap ? capStatus(cap) : null };
  });
}
