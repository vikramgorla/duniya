// Friendly diff for the "Change with AI" review (#63): a TypeScript port of the panel's src/panel/public/diff.js (#32).
// Word-level text diff, line hunks with folded unchanged stretches, list and key diffs. Pure functions, no React;
// diff.test.ts checks that it gives the same results as the web module.

export type OpType = 'eq' | 'add' | 'del';
export interface Op { type: OpType; text: string }
export interface Segment { type: OpType; text: string; newline?: boolean }
export type Line = Segment[];
export type Hunk = { type: 'lines' | 'skip'; lines: Line[] };
export interface TextDiff { ops: Op[]; mode: 'words' | 'lines'; added: number; removed: number; changed: boolean }

/** Words, runs of whitespace and single punctuation marks; joining the tokens gives the text back. */
export const tokenize = (text: unknown): string[] => String(text ?? '').match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) || [];
const lines = (text: unknown): string[] => { const s = String(text ?? ''); return s ? (s.match(/[^\n]*\n|[^\n]+$/g) || []) : []; };
export const countWords = (text: unknown): number => (String(text ?? '').match(/[\p{L}\p{N}]+/gu) || []).length;

/** Myers' O((N+M)·D) shortest edit script over two token arrays → [{ type, items }] in order. */
function myers(a: string[], b: string[]): { type: OpType; items: string[] }[] {
  let start = 0; let endA = a.length; let endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA); const B = b.slice(start, endB);
  const n = A.length; const m = B.length; const max = n + m; const off = max + 1;
  const out: { type: OpType; items: string[] }[] = [];
  if (start) out.push({ type: 'eq', items: a.slice(0, start) });
  if (!n && m) out.push({ type: 'add', items: B });
  else if (n && !m) out.push({ type: 'del', items: A });
  else if (n && m) {
    const v = new Int32Array(2 * max + 3); const trace: Int32Array[] = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { found = true; break; }
      }
    }
    // walk back through the saved frontiers
    const steps: [OpType, string][] = []; let x = n; let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vv = trace[d]; const k = x - y;
      const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
      const px = d === 0 ? 0 : vv[off + prevK]; const py = px - prevK;
      while (x > px && y > py) { steps.push(['eq', A[x - 1]]); x--; y--; }
      if (d > 0) { if (x === px) steps.push(['add', B[y - 1]]); else steps.push(['del', A[x - 1]]); }
      x = px; y = py;
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      const [type, item] = steps[i]; const last = out[out.length - 1];
      if (last && last.type === type) last.items.push(item); else out.push({ type, items: [item] });
    }
  }
  if (endA < a.length) out.push({ type: 'eq', items: a.slice(endA) });
  return out;
}

/** A pure insertion or removal that spans lines is slid (when the text around it allows) so that it ends at a line
 *  break: "- New rule.\n" reads better than "New rule.\n- ". The text of both sides stays the same. */
function slide(ops: Op[]): Op[] {
  const out = ops.map((o) => ({ ...o }));
  for (let i = 1; i < out.length - 1; i++) {
    const p = out[i - 1]; const x = out[i]; const n = out[i + 1];
    if (x.type === 'eq' || p.type !== 'eq' || n.type !== 'eq' || !x.text.includes('\n') || x.text.endsWith('\n')) continue;
    for (let k = 1; k <= Math.min(p.text.length, x.text.length - 1); k++) { // slide left by k characters
      if (p.text.slice(-k) !== x.text.slice(-k)) break;
      if (x.text.slice(0, -k).endsWith('\n')) { const moved = x.text.slice(-k); x.text = moved + x.text.slice(0, -k); p.text = p.text.slice(0, -k); n.text = moved + n.text; break; }
    }
    if (x.text.endsWith('\n')) continue;
    for (let k = 1; k <= Math.min(n.text.length, x.text.length - 1); k++) { // or right
      if (n.text.slice(0, k) !== x.text.slice(0, k)) break;
      if (n.text[k - 1] === '\n') { const moved = x.text.slice(0, k); x.text = x.text.slice(k) + moved; p.text += moved; n.text = n.text.slice(k); break; }
    }
  }
  return out.filter((o) => o.text);
}

/** Readable groups: a lone space (or very short unchanged bit) between two changes joins both sides, and inside each
 *  run of changes the removed text comes before the added text. */
function tidy(ops: Op[]): Op[] {
  const isGlue = (o: Op, i: number) => o.type === 'eq' && i > 0 && i < ops.length - 1 && ops[i - 1].type !== 'eq' && ops[i + 1].type !== 'eq'
    && /^\s*\S{0,1}\s*$/.test(o.text) && !o.text.includes('\n');
  type Run = { type: 'eq'; text: string } | { type?: undefined; del: string; add: string };
  const runs: Run[] = []; let cur: { del: string; add: string } | null = null;
  ops.forEach((o, i) => {
    const glue = isGlue(o, i);
    if (o.type === 'eq' && !glue) { cur = null; runs.push({ type: 'eq', text: o.text }); return; }
    if (!cur) { cur = { del: '', add: '' }; runs.push(cur); }
    if (glue) { cur.del += o.text; cur.add += o.text; } else cur[o.type as 'del' | 'add'] += o.text;
  });
  const out: Op[] = [];
  const push = (type: OpType, text: string) => { if (!text) return; const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
  for (const r of runs) { if (r.type === 'eq') push('eq', r.text); else { push('del', r.del); push('add', r.add); } }
  return out;
}

/** Word-level diff of two texts; line-level when the texts are very long (keeps the phone responsive). */
export function diffText(before: unknown, after: unknown, { maxTokens = 6000 } = {}): TextDiff {
  const a0 = String(before ?? ''); const b0 = String(after ?? '');
  let mode: 'words' | 'lines' = 'words';
  let a = tokenize(a0); let b = tokenize(b0);
  if (a.length + b.length > maxTokens) { mode = 'lines'; a = lines(a0); b = lines(b0); }
  const raw = myers(a, b).map((g) => ({ type: g.type, text: g.items.join('') }));
  const ops = mode === 'words' ? slide(tidy(raw)) : raw;
  let added = 0; let removed = 0;
  for (const o of ops) { if (o.type === 'add') added += countWords(o.text); else if (o.type === 'del') removed += countWords(o.text); }
  return { ops, mode, added, removed, changed: ops.some((o) => o.type !== 'eq') };
}

/** Split ops into lines of segments; unchanged lines further than `context` lines from a change are folded into
 *  { type: 'skip' } blocks (only when the fold hides at least `minSkip` lines). */
export function hunks(ops: Op[], { context = 2, minSkip = 3 } = {}): Hunk[] {
  const rows: Line[] = [[]];
  for (const o of ops) {
    const parts = o.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) rows.push([]);
      if (p) rows[rows.length - 1].push({ type: o.type, text: p });
      if (i < parts.length - 1 && o.type !== 'eq') rows[rows.length - 1].push({ type: o.type, text: '\n', newline: true });
    });
  }
  if (rows.length > 1 && !rows[rows.length - 1].length) rows.pop();
  const changed = rows.map((r) => r.some((s) => s.type !== 'eq'));
  const near = changed.map((_, i) => { for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) if (changed[j]) return true; return false; });
  const out: Hunk[] = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j < rows.length && near[j] === near[i]) j++;
    const block = rows.slice(i, j);
    if (!near[i] && block.length >= minSkip) out.push({ type: 'skip', lines: block });
    else { const last = out[out.length - 1]; if (last && last.type === 'lines') last.lines.push(...block); else out.push({ type: 'lines', lines: block }); }
    i = j;
  }
  return out;
}

/** Text of one side: 'before' keeps eq + del, 'after' keeps eq + add. */
export const sideText = (ops: Op[], side: 'before' | 'after') => ops.filter((o) => o.type === 'eq' || o.type === (side === 'before' ? 'del' : 'add')).map((o) => o.text).join('');

/** Set difference keeping order. key(item) identifies an item (default: strings as-is, objects as JSON). */
export function diffList<T>(before: T[] | T | null | undefined, after: T[] | T | null | undefined, key: (x: T) => string = (x) => (typeof x === 'string' ? x : JSON.stringify(x))) {
  const a: T[] = Array.isArray(before) ? before : before == null ? [] : [before];
  const b: T[] = Array.isArray(after) ? after : after == null ? [] : [after];
  const ka = new Set(a.map(key)); const kb = new Set(b.map(key));
  return { added: b.filter((x) => !ka.has(key(x))), removed: a.filter((x) => !kb.has(key(x))), kept: b.filter((x) => ka.has(key(x))) };
}

/** Keyed objects ({ key: value }) → { added: [keys], removed: [keys], changed: [keys], kept: [keys] }. */
export function diffKeys(before: unknown, after: unknown) {
  const a = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const b = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return {
    added: keys.filter((k) => !(k in a) && k in b), removed: keys.filter((k) => k in a && !(k in b)),
    changed: keys.filter((k) => k in a && k in b && !same(a[k], b[k])), kept: keys.filter((k) => k in a && k in b && same(a[k], b[k])),
  };
}

// ---------- the review screen's model (no React): what each change looks like ----------

/** A line of the "Changes only" / "Side by side" / "Whole new text" views: marker and kept segments. */
export interface ViewLine { mark: '' | '+' | '−' | '±'; segs: Segment[] }
export type ViewBlock = { type: 'lines'; lines: ViewLine[] } | { type: 'skip'; lines: ViewLine[] };
export type TextView = 'changes' | 'before' | 'after' | 'whole';

const markOf = (segs: Segment[]): ViewLine['mark'] => {
  const add = segs.some((s) => s.type === 'add' && s.text.trim()); const del = segs.some((s) => s.type === 'del' && s.text.trim());
  return add && del ? '±' : add ? '+' : del ? '−' : '';
};
/** Blocks for one view of a text diff, as the panel draws them (folded unchanged stretches stay folded). */
export function textBlocks(d: TextDiff, view: TextView, { context = 2 } = {}): ViewBlock[] {
  const keep = (s: Segment) => !s.newline && (view === 'before' ? s.type !== 'add' : view === 'after' || view === 'whole' ? s.type !== 'del' : true)
    && !(s.type === 'del' && !s.text.trim());
  const blocks = view === 'whole' ? hunks(d.ops.filter((o) => o.type !== 'del'), { context: 1e9 }) : hunks(d.ops, { context });
  return blocks.map((b) => {
    const rows = b.lines.map((l) => l.filter(keep)).filter((l, i) => l.length || !b.lines[i].length);
    return { type: b.type, lines: rows.map((segs) => ({ mark: markOf(segs), segs })) };
  });
}

export interface ListItem { k: string; l: string; v?: unknown }
/** Added / removed / changed items with readable labels ("2 added, 1 removed"). */
export function listChange(before: ListItem[], after: ListItem[]) {
  const r = diffList(before, after, (x) => x.k);
  const changed = r.kept.filter((x) => JSON.stringify(before.find((y) => y.k === x.k)?.v ?? null) !== JSON.stringify(x.v ?? null))
    .map((x) => ({ before: before.find((y) => y.k === x.k)!, after: x }));
  const same = r.kept.filter((x) => !changed.some((c) => c.after === x));
  const n = [r.added.length && `${r.added.length} added`, r.removed.length && `${r.removed.length} removed`, changed.length && `${changed.length} changed`].filter(Boolean).join(', ') || 'reordered';
  return { added: r.added, removed: r.removed, changed, same, n };
}
