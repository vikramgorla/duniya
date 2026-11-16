// Fallback chain values (042), validated without touching providers (used by agent config and chat prefs too).
import { bad } from '../config.js';
export const REF_RE = /^[a-z][a-z0-9-]{1,30}:[A-Za-z0-9._:/@+-]{1,120}$/;
export const FALLBACK_MODES = ['inherit', 'on', 'off'];

/** Validate a chain of model refs ("account:model" or "account:auto"; max 10, no duplicates). */
export function cleanChain(chain, field = 'chain') {
  if (chain == null || chain === '') return [];
  const list = Array.isArray(chain) ? chain : String(chain).split(/[\s,]+/);
  const out = [];
  for (const r of list.map((x) => String(x || '').trim()).filter(Boolean)) {
    if (!REF_RE.test(r)) throw bad(`“${r}” must look like provider:model or provider:auto`, field);
    if (!out.includes(r)) out.push(r);
  }
  if (out.length > 10) throw bad('At most 10 models in a fallback chain', field);
  return out;
}

/** Validate an override { mode: inherit | on | off, chain } (agent config, chat prefs). */
export function cleanOverride(v, field = 'fallback') {
  if (v == null || v === '') return { mode: 'inherit', chain: [] };
  if (typeof v === 'string') v = { mode: v };
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('must be { mode, chain }', field);
  const mode = v.mode || 'inherit';
  if (!FALLBACK_MODES.includes(mode)) throw bad('mode must be inherit, on or off', `${field}.mode`);
  return { mode, chain: cleanChain(v.chain, `${field}.chain`) };
}
