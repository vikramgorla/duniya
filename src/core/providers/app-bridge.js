// @ts-check
// Tool bridge for agent apps (073). Claude Code and Codex run their own agent loop; Duniya's tools reach them as one
// MCP server on 127.0.0.1 (Streamable HTTP, plain JSON answers), opened for one turn with its own random token. A
// tool call from the app is not run here: it is handed to the turn (onCall), which returns it to Duniya's runner as a
// tool_use block, so role allow lists, the confirm gate and activity stay in Duniya's code. The answer goes back to
// the app when the runner's next model call carries the tool_result.
// The listener starts with the first open turn and closes with the last one: nothing listens between turns.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const MAX_BODY = 1024 * 1024;
const PROTOCOL = '2025-06-18';
/** token -> { tools: [{ name, description, inputSchema }], onCall(name, args) → Promise<{ text, isError }> } */
const turns = new Map();
/** @type {http.Server | null} */
let server = null;
/** @type {Promise<number> | null} */
let listening = null;

const reply = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function answer(t, msg) {
  const { id, method, params = {} } = msg || {};
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'duniya', version: '1' } } };
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: t.tools } };
  if (method === 'tools/call') {
    if (!t.tools.some((x) => x.name === params.name)) return rpcError(id, -32602, `Unknown tool ${params.name}`);
    const out = await t.onCall(String(params.name), params.arguments && typeof params.arguments === 'object' ? params.arguments : {});
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out?.text ?? '') }], isError: !!out?.isError } };
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function handle(req, res) {
  const auth = String(req.headers.authorization || '');
  const t = auth.startsWith('Bearer ') ? turns.get(auth.slice(7)) : null;
  if (!t || req.url !== '/mcp') return reply(res, 401, { error: 'unauthorized' });
  if (req.method === 'DELETE') return reply(res, 200);
  if (req.method !== 'POST') return reply(res, 405); // no server-sent stream: answers come as JSON
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, rpcError(null, -32700, 'Parse error')); }
    const list = Array.isArray(msg) ? msg : [msg];
    const calls = list.filter((m) => m && m.id !== undefined && m.id !== null);
    if (!calls.length) return reply(res, 202); // notifications only
    try {
      const out = await Promise.all(calls.map((m) => answer(t, m)));
      reply(res, 200, Array.isArray(msg) ? out : out[0]);
    } catch { reply(res, 200, rpcError(calls[0].id, -32603, 'Internal error')); } // details stay on the server
  });
}

function listen() {
  if (listening) return listening;
  const s = http.createServer(handle);
  server = s;
  listening = new Promise((res, rej) => {
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => res(/** @type {import('node:net').AddressInfo} */ (s.address()).port));
  });
  listening.catch(() => { server = null; listening = null; });
  return listening;
}

/**
 * Open the bridge for one turn. tools: Anthropic-style definitions ({ name, description, input_schema }); names are
 * made MCP-safe and mapped back. onCall(ourName, args) is called for each tool call and must resolve with
 * { text, isError } once the runner answered it. Returns { url, token, close() }.
 * @param {{ tools: Array<{ name: string, description?: string, input_schema?: object }>, onCall: (name: string, args: object) => Promise<{ text: string, isError?: boolean }> }} o
 */
export async function openBridge({ tools, onCall }) {
  const names = new Map();
  const list = tools.map((t) => {
    let safe = String(t.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    while (names.has(safe)) safe += '_';
    names.set(safe, t.name);
    return { name: safe, description: t.description || '', inputSchema: t.input_schema || { type: 'object', properties: {} } };
  });
  const token = randomBytes(32).toString('base64url');
  turns.set(token, { tools: list, onCall: (safe, args) => onCall(names.get(safe) || safe, args) });
  const port = await listen();
  return {
    url: `http://127.0.0.1:${port}/mcp`, token,
    close() {
      turns.delete(token);
      if (!turns.size && server) { server.close(); server.closeAllConnections?.(); server = null; listening = null; }
    },
  };
}
