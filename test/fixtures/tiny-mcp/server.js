#!/usr/bin/env node
// Dependency-free stdio MCP server used by test/mcp-more.test.js (local tool services).
import { createInterface } from 'node:readline';
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const tools = [
  { name: 'env_report', description: 'Report environment', inputSchema: { type: 'object', properties: {} } },
  { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
];
process.stderr.write('tiny-mcp ready\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notification
  const ok = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') return ok({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'tiny', version: '1.2.3' } });
  if (m.method === 'tools/list') return ok({ tools });
  if (m.method === 'ping') return ok({});
  if (m.method === 'tools/call') {
    const text = m.params.name === 'env_report'
      ? JSON.stringify({ greeting: process.env.GREETING || '', args: process.argv.slice(2), keys: Object.keys(process.env).sort() })
      : String(m.params.arguments?.text || '');
    return ok({ content: [{ type: 'text', text }] });
  }
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method' } });
});
