import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { onSecretChange } from './store.js';
import { onOAuthChange } from './mcp-oauth.js';

/** Pool of MCP connections keyed by url + credential (token, or an OAuth sign-in identity). */
class McpConnection {
  constructor(url, token, authProvider = null) {
    this.url = url;
    this.token = token;
    this.authProvider = authProvider;
    this.client = null;
    this.tools = null;
    this.toolsAt = 0;
  }

  async connect() {
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
    const transport = new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers }, authProvider: this.authProvider || undefined });
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
        if (e.reconnect || attempt === 1) throw new Error(e.reconnect ? e.message : `MCP ${this.url}: ${e.message}`);
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
        if (e.reconnect || attempt === 1) return { isError: true, text: `Tool error: ${e.message}` };
      }
    }
  }

  async close() { try { await this.client?.close(); } catch { /* ignore */ } this.client = null; }
}

const pool = new Map();

/**
 * mcpConnection(url, token) or mcpConnection(url, { authProvider, identity }) for OAuth sign-ins
 * (identity = a stable key such as "oauth:<bot>:<server>:<role>").
 */
export function mcpConnection(url, cred = '') {
  const oauth = cred && typeof cred === 'object' ? cred : null;
  const token = oauth ? '' : String(cred || '');
  const key = `${url}\n${oauth ? oauth.identity : token}`;
  if (!pool.has(key)) pool.set(key, new McpConnection(url, token, oauth?.authProvider));
  return pool.get(key);
}

export async function resetMcpPool() {
  const conns = [...pool.values()];
  pool.clear();
  await Promise.all(conns.map((c) => c.close()));
}

onSecretChange(() => { resetMcpPool(); });
onOAuthChange(() => { resetMcpPool(); });
