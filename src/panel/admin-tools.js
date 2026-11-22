// @ts-check
// Admin MCP tools (017). Each tool runs the same panel route handler in-process (not over HTTP), as the signed-in
// panel user, so role gates, validation and activity logging are exactly the panel's. `calls` names the routes a
// tool uses: the minimum role to see and run the tool is the highest role those routes require.
// Risky tools never run directly: they return a plain-language preview and a confirm code for confirm_action.
import { OVERVIEW_TOOLS } from './admin-tools/overview.js';
import { AGENT_TOOLS } from './admin-tools/agents.js';
import { CHAT_TOOLS } from './admin-tools/chats.js';
import { PEOPLE_TOOLS } from './admin-tools/people.js';
import { GROUP_TOOLS } from './admin-tools/groups.js';
import { MODEL_TOOLS } from './admin-tools/models.js';
import { SERVER_TOOLS } from './admin-tools/server.js';

/** Remove bulky or sensitive-looking fields from route output (QR images are for the panel only). */
export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !['qrDataUrl', 'qr'].includes(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

/**
 * 084: the four MCP tool hints, all explicit booleans (directories such as OpenAI's refuse a tool with one missing),
 * derived from what a tool calls so they cannot drift: read-only tools are neither destructive nor open-world-writing
 * and are idempotent; a write is destructive when it is risky (confirm gate) or overwrites/deletes (PUT, DELETE),
 * idempotent when it only PUTs/DELETEs. `destructive` / `idempotent` on a tool override the derivation (a POST that
 * sets a value); `openWorld` marks tools that reach outside this server (WhatsApp/Telegram, a model, GitHub, apt…).
 * @param {{ readOnly?: boolean, risky?: boolean, destructive?: boolean, idempotent?: boolean, openWorld?: boolean, calls?: string[][] }} t
 */
export function toolHints(t) {
  const writes = (t.calls || []).map(([m]) => m).filter((m) => m !== 'GET');
  const readOnlyHint = !!t.readOnly;
  return {
    readOnlyHint,
    destructiveHint: !readOnlyHint && (t.destructive ?? (!!t.risky || writes.some((m) => m === 'PUT' || m === 'DELETE'))),
    idempotentHint: readOnlyHint || (t.idempotent ?? writes.every((m) => m === 'PUT' || m === 'DELETE')),
    openWorldHint: !!t.openWorld,
  };
}
/** A tool's human-readable title from its name: list_agents → "List agents". */
export const toolTitle = (name) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * One admin tool. noConfirm: the owner assistant runs it without a confirm code (logged).
 * @typedef {{ name: string, description: string, input: object, required?: string[], calls: string[][], readOnly?: boolean,
 *   risky?: boolean | ((args: any) => boolean), destructive?: boolean, idempotent?: boolean, openWorld?: boolean, noConfirm?: boolean,
 *   run: (args: any, x: any) => any, preview?: (args: any, x: any) => any }} AdminTool
 */
/** Every admin tool, one file per area in admin-tools/. @type {AdminTool[]} */
export const TOOLS = [...OVERVIEW_TOOLS, ...AGENT_TOOLS, ...CHAT_TOOLS, ...PEOPLE_TOOLS, ...GROUP_TOOLS, ...MODEL_TOOLS, ...SERVER_TOOLS];
