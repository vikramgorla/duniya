import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchSpec } from './mcp-local.js';
import { onSecretChange } from './store.js';
import { onOAuthChange } from './mcp-oauth.js';

/** Pool of MCP connections keyed by url + credential (token, or an OAuth sign-in identity). */
class McpConnection {
  constructor(url, token, authProvider = null, { headers = {}, local = null } = {}) {
    this.url = url;
    this.token = token;
    this.authProvider = authProvider;
    this.headers = headers;
    this.local = local; // { spec, allowScripts, args, env } for a local (stdio) server
    this.stderr = '';
    this.client = null;
    this.tools = null;
    this.toolsAt = 0;
  }

  async connect() {
    let transport;
    if (this.local) {
      const l = await launchSpec(this.local);
      transport = new StdioClientTransport({ command: l.command, args: l.args, env: l.env, cwd: l.cwd, stderr: 'pipe' });
      transport.stderr?.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    } else {
      const headers = { ...this.headers, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
      transport = new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers }, authProvider: this.authProvider || undefined });
    }
    const client = new Client({ name: 'whatsapp-agent-duniya', version: '1.0.0' });
    try { await client.connect(transport); } catch (e) { try { await transport.close(); } catch { /* ignore */ } throw e; }
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
        await this.close();
        const where = this.local ? `local tool service ${this.local.spec}` : `MCP ${this.url}`;
        const tail = this.local && this.stderr ? ` (${this.stderr.trim().split('\n').slice(-3).join(' | ')})` : '';
        if (e.reconnect || attempt === 1) throw new Error(e.reconnect ? e.message : `${where}: ${e.message}${tail}`);
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
        await this.close();
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
  const o = cred && typeof cred === 'object' ? cred : { token: String(cred || '') };
  const key = JSON.stringify([url, o.identity || o.token || '', o.headers || {}, o.local || null]);
  if (!pool.has(key)) pool.set(key, new McpConnection(url, o.token || '', o.authProvider, { headers: o.headers, local: o.local }));
  return pool.get(key);
}

export async function resetMcpPool() {
  const conns = [...pool.values()];
  pool.clear();
  await Promise.all(conns.map((c) => c.close()));
}

onSecretChange(() => { resetMcpPool(); });
onOAuthChange(() => { resetMcpPool(); });
