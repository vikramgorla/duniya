import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { onSecretChange } from './store.js';

/** Pool of MCP connections keyed by url + token. */
class McpConnection {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.client = null;
    this.tools = null;
    this.toolsAt = 0;
  }

  async connect() {
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
    const transport = new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers } });
    const client = new Client({ name: 'whatsapp-agent-duniya', version: '1.0.0' });
    await client.connect(transport);
    this.client = client;
  }

  async listTools() {
    if (this.tools && Date.now() - this.toolsAt < 10 * 60 * 1000) return this.tools;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.client) await this.connect();
        const { tools } = await this.client.listTools();
        this.tools = tools;
        this.toolsAt = Date.now();
        return tools;
      } catch (e) {
        this.client = null;
        if (attempt === 1) throw new Error(`MCP ${this.url}: ${e.message}`);
      }
    }
  }

  async call(name, args) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.client) await this.connect();
        const res = await this.client.callTool({ name, arguments: args || {} });
        const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
        return { isError: !!res.isError, text };
      } catch (e) {
        this.client = null;
        if (attempt === 1) return { isError: true, text: `Tool error: ${e.message}` };
      }
    }
  }

  async close() { try { await this.client?.close(); } catch { /* ignore */ } this.client = null; }
}

const pool = new Map();

export function mcpConnection(url, token = '') {
  const key = `${url}\n${token}`;
  if (!pool.has(key)) pool.set(key, new McpConnection(url, token));
  return pool.get(key);
}

export async function resetMcpPool() {
  const conns = [...pool.values()];
  pool.clear();
  await Promise.all(conns.map((c) => c.close()));
}

onSecretChange(() => { resetMcpPool(); });
