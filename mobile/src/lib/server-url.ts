// Server address handling for the Connect screen (027). Pure functions: no React Native imports (unit-tested with node).

/** Normalises what a person typed ("duniya.example.com", "https://x.y/#settings") to an origin, or null. */
export function normalizeServer(input: string): string | null {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname || u.username || u.password) return null;
  if (!/^[a-z0-9.-]+$/i.test(u.hostname) && !/^\[[0-9a-f:.]+\]$/i.test(u.hostname)) return null;
  return `${u.protocol}//${u.host}`.toLowerCase();
}

/** True for plain http to something that is not this phone's own network: the token would travel unencrypted. */
export function isInsecure(server: string): boolean {
  try {
    const u = new URL(server);
    if (u.protocol === 'https:') return false;
    return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
  } catch { return true; }
}

/**
 * Reads a scanned QR code: the panel's connect link (duniya://connect?server=…), the same link inside Expo Go
 * (exp://…/--/connect?server=…), or simply the panel's address. Returns the server origin or null.
 */
export function parseScan(data: string): string | null {
  const s = String(data || '').trim();
  const m = /[?&]server=([^&#]+)/.exec(s);
  if (/^(duniya|exps?):\/\//i.test(s)) {
    if (!m) return null;
    try { return normalizeServer(decodeURIComponent(m[1])); } catch { return null; }
  }
  if (/^https?:\/\//i.test(s)) return normalizeServer(s);
  return null;
}
