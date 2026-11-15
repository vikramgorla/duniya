// Shapes of the panel API responses the app reads (src/panel/server.js and routes/*). Only the fields used here.

export type Role = 'viewer' | 'admin' | 'owner';
export interface User { id: number; username: string; email: string; role: Role }

export interface WaNumber {
  id: string; label: string; status: string; me?: string | null; since?: number; lastError?: string | null; dmAgent?: string;
}
export interface Status {
  user: User;
  channel: WaNumber & { numbers?: WaNumber[] };
  settings: { paused?: boolean; defaultDmAgent?: string };
  version: string; uptimeSec: number; memoryMb: number; node: string;
  agents: { id: string; name: string; enabled: boolean; chats: number }[];
  pending: number;
}

export interface AgentConfig {
  name: string; description?: string; prompt?: string; model?: string; enabled?: boolean;
  triggers?: string[]; dm?: string; respondToMentions?: boolean;
  mcpServers?: Record<string, { type?: string; url?: string; auth?: string; package?: string }>;
  tools?: { participant?: string[]; organizer?: string[]; deny?: string[] };
  organizers?: string[]; participants?: string[]; chats?: string[];
  schedules?: { id: string; at: string; days?: string; enabled?: boolean; prompt?: string }[];
  memory?: { enabled?: boolean };
  globalMcp?: { disabled?: string[] };
  plugins?: string[];
}
/** A tool service defined once for all agents (Settings → Tool services in the web panel). */
export interface GlobalTool { name: string; type: string; on: boolean; replaced: boolean; defaults?: { organizer?: string[]; participant?: string[] } }
export interface Agent {
  id: string; name: string; description?: string; enabled: boolean; config: AgentConfig; needs: string[];
  updatedAt?: number; localTools: string[]; missingPlugins: string[]; globalTools?: GlobalTool[];
}

export interface Chat {
  id: string; name: string; size?: number; isGroup: boolean; number: string; numberLabel: string;
  agent: string; model: string; logging: string; phone?: string; lastAt?: number;
}
export interface StoredMessage { id: number; ts: number; sender?: string; name?: string; text: string; quoted?: string; fromAgent: boolean; addressed?: boolean }

export interface Activity { id: number; ts: number; type: string; agent: string | null; chat: string | null; summary: string }

export interface UsageRow { key: string; calls: number; input: number; output: number; cost: number | null; unpriced: number; plan: number }
export interface UsageReport { from: number; to: number; groupBy: string; total: UsageRow; rows: UsageRow[] }

export interface Pending { code: string; agent: string; tool: string; chat: string; requester: string; summary: string; expires: number }

export interface SystemSnapshot {
  host: string; os: string; uptimeSec: number; cpus: number; load: number[]; cpu: number | null;
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
  disks: { path: string; total: number; used: number; free: number }[];
  app: { rss: number; node: string };
  rebootRequired: boolean;
}
export interface UpdateInfo {
  settings: { mode: string; channel: string; at: string };
  status: { current?: string; latest?: string; available?: boolean; target?: string; checkedAt?: number } | null;
  install: string;
  running: { target: string; startedAt: number } | null;
}

export interface ModelList { models: { ref: string; provider: string; label: string }[]; defaultModel: string; resolvedDefault?: string; problem?: string }

export interface AgentDraft {
  summary: string; questions: string[]; changes: { field: string; before: unknown; after: unknown }[];
  proposed: AgentConfig; warnings?: string[]; model: string;
}
