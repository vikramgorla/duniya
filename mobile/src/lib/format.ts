// Small display helpers (027). Pure.

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function duration(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.round((sec % 86400) / 3600)}h`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** 1234 → "1.2k", 2500000 → "2.5M". */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

/** Dollars; null = no price known. */
export function money(cost: number | null | undefined): string {
  if (cost == null) return 'no price';
  if (cost === 0) return '$0';
  if (cost < 0.01) return '<$0.01';
  return `$${cost < 100 ? cost.toFixed(2) : Math.round(cost)}`;
}

export const pct = (part: number, total: number): number => (total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0);

/** WhatsApp chat id → something a person recognises (used only when no name is known). */
export function chatLabel(id: string, name?: string): string {
  if (name && name !== id) return name;
  const phone = /^(\d{6,})@(s\.whatsapp\.net|lid)$/.exec(id.split('#').pop() || '');
  if (phone) return `+${phone[1]}`;
  if (id.startsWith('panel:')) return 'Panel test';
  return id;
}
