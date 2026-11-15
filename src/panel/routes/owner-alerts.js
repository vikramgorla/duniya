// Panel routes for spending caps (040, #35) and owner alerts / weekly summary (041, #38).
import { budgetOverview, setCap, getCap, capStatus, CURRENCY, SCOPES } from '../../core/budget.js';
import { chatTitle } from '../../core/contacts.js';
import { ownerNumber, setOwnerNumber } from '../../core/owner-alerts.js';
import { getWeeklySettings, setWeeklySettings, sendWeekly, weeklyText, weeklyData } from '../../core/weekly.js';
import { listAgents, getAgent } from '../../core/agents.js';
import { seenChats } from '../../core/chat-prefs.js';
import { activity } from '../../core/events.js';

const OWNER = { role: 'owner' };

export function ownerAlertRoutes(route, { channel } = {}) {
  const chatNames = async () => {
    const names = new Map(seenChats().map((c) => [c.id, chatTitle(c)]));
    for (const g of await channel?.listChats?.().catch(() => []) || []) names.set(g.id, g.name);
    return names;
  };
  const alertsView = () => ({ alertsTo: ownerNumber(), weekly: getWeeklySettings() });

  // ---------- spending caps ----------
  route('GET', '/api/budget', async () => {
    const chats = await chatNames();
    const agents = new Map(listAgents().map((a) => [a.id, a.name]));
    return { ...budgetOverview({ agentName: (id) => agents.get(id) || `${id} (deleted)`, chatName: (id) => chats.get(id) || id.replace(/@.*/, '') }), alertsTo: ownerNumber() };
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

  // ---------- owner alerts + weekly summary ----------
  route('GET', '/api/alerts', async () => alertsView());
  route('PUT', '/api/alerts', async (req, res, body, q, p, user) => {
    if ('alertsTo' in body) setOwnerNumber(body.alertsTo);
    if (body.weekly) setWeeklySettings(body.weekly);
    const v = alertsView();
    activity('config', { summary: `Owner alerts: ${v.alertsTo ? `to +${v.alertsTo}` : 'no number'}; weekly summary ${v.weekly.active ? `${v.weekly.day} ${v.weekly.at}` : 'off'} (${user.username})` });
    return v;
  }, OWNER);
  route('GET', '/api/alerts/weekly/preview', async () => ({ text: weeklyText(), data: weeklyData() }));
  route('POST', '/api/alerts/weekly/send', async () => sendWeekly({ reason: 'manual' }), OWNER);
}
