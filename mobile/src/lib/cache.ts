// Last good API responses, kept in memory so screens stay useful offline (027).
export const cache = new Map<string, unknown>();
export const clearCache = () => cache.clear();
