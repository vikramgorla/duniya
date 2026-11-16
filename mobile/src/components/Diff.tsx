// Friendly diff views for "Change with AI" (#63), the app's version of the panel's review (#32): additions lime with
// a "+", removals red and struck through with a "−" — never colour alone; screen readers hear "added" / "removed".
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Label, Row, Segmented } from '@/components/ui';
import { schedParts, trunc, type ChangeView, type ListView } from '@/lib/ai-review';
import { diffText } from '@/lib/diff';
import { textBlocks, type Segment, type TextDiff, type TextView, type ViewLine } from '@/lib/diff';
import { useTheme } from '@/lib/theme';

function Seg({ s }: { s: Segment }) {
  const t = useTheme();
  if (s.type === 'add') return <Text accessibilityLabel={`added: ${s.text}`} style={{ backgroundColor: t.addBg, color: t.addInk }}>{s.text}</Text>;
  if (s.type === 'del') return <Text accessibilityLabel={`removed: ${s.text}`} style={{ backgroundColor: t.delBg, color: t.delInk, textDecorationLine: 'line-through' }}>{s.text}</Text>;
  return <Text>{s.text}</Text>;
}
function DiffLine({ line }: { line: ViewLine }) {
  const t = useTheme();
  const tone = line.mark === '+' ? t.addInk : line.mark === '−' ? t.delInk : t.muted;
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 1 }}>
      <Text accessible={false} style={{ width: 12, color: tone, fontFamily: t.mono, fontSize: 13, lineHeight: 20, fontWeight: '700' }}>{line.mark}</Text>
      <Text selectable style={{ flex: 1, color: t.ink, fontSize: 14, lineHeight: 20 }}>{line.segs.length ? line.segs.map((s, i) => <Seg key={i} s={s} />) : ' '}</Text>
    </View>
  );
}
function Folded({ lines }: { lines: ViewLine[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  if (open) return <>{lines.map((l, i) => <DiffLine key={i} line={l} />)}</>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Show ${lines.length} unchanged lines`} onPress={() => setOpen(true)}
      style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: t.bg2, opacity: pressed ? 0.6 : 1, marginVertical: 2 })}>
      <Text style={{ color: t.muted, fontFamily: t.mono, fontSize: 12 }}>{`… ${lines.length} unchanged line${lines.length === 1 ? '' : 's'} …`}</Text>
    </Pressable>
  );
}

/** Word diff of a text field; for long instructions a switch: Changes / Before / After (whole texts). */
function TextDiffView({ diff, switcher }: { diff: TextDiff; switcher: boolean }) {
  const [view, setView] = useState<TextView>('changes');
  const blocks = textBlocks(diff, view === 'after' ? 'whole' : view, { context: view === 'changes' ? 2 : 1e9 });
  return (
    <View style={{ gap: 8 }}>
      {switcher ? (
        <Segmented label="How to show the changes" value={view} onChange={setView}
          options={[{ value: 'changes', label: 'Changes' }, { value: 'before', label: 'Before' }, { value: 'after', label: 'After' }]} />
      ) : null}
      <View>
        {blocks.map((b, i) => (b.type === 'skip' ? <Folded key={`${view}${i}`} lines={b.lines} /> : b.lines.map((l, j) => <DiffLine key={`${view}${i}.${j}`} line={l} />)))}
      </View>
    </View>
  );
}

function Chip({ text, kind }: { text: string; kind: 'add' | 'del' }) {
  const t = useTheme();
  return (
    <View accessibilityLabel={`${kind === 'add' ? 'added' : 'removed'}: ${text}`} style={{ backgroundColor: kind === 'add' ? t.addBg : t.delBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '100%' }}>
      <Text style={{ color: kind === 'add' ? t.addInk : t.delInk, fontSize: 13, textDecorationLine: kind === 'del' ? 'line-through' : 'none' }}>{`${kind === 'add' ? '+ ' : '− '}${text}`}</Text>
    </View>
  );
}
function Chips({ title, items, kind }: { title: string; items: string[]; kind: 'add' | 'del' }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 4 }}>
      <Label>{title}</Label>
      <Row wrap gap={6}>{items.map((x, i) => <Chip key={i} text={x} kind={kind} />)}</Row>
    </View>
  );
}
/** "Before → after" in one line, both sides marked. */
function Arrow({ before, after, what }: { before: string; after: string; what?: string }) {
  const t = useTheme();
  return (
    <Text style={{ color: t.ink, fontSize: 14, lineHeight: 21 }}>
      {what ? `${what}: ` : ''}
      <Seg s={{ type: 'del', text: before }} />{' → '}<Seg s={{ type: 'add', text: after }} />
    </Text>
  );
}
/** One scheduled post that changed: "“Post rides…” Time: 18:00 → 18:30", and its text as a word diff. */
function SchedChange({ a, b }: { a: any; b: any }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink, fontSize: 14 }}>{`“${trunc(b?.prompt, 50)}”`}</Text>
      {schedParts(a, b).map((p) => <Arrow key={p.what} what={p.what} before={p.before} after={p.after} />)}
      {a?.prompt !== b?.prompt ? <TextDiffView diff={diffText(a?.prompt || '', b?.prompt || '')} switcher={false} /> : null}
    </View>
  );
}
function ListDiff({ list, sched }: { list: ListView; sched?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Chips title={list.addedTitle} items={list.added.map((x) => x.l)} kind="add" />
      <Chips title={list.removedTitle} items={list.removed.map((x) => x.l)} kind="del" />
      {list.changed.map((c, i) => (
        <View key={i} style={{ gap: 2 }}><Label>± Changed</Label>{sched ? <SchedChange a={c.before.v} b={c.after.v} /> : <Arrow before={c.before.l} after={c.after.l} />}</View>
      ))}
      {list.same.length ? <Text style={{ color: t.muted, fontSize: 13 }}>{`${list.same.length} unchanged: ${list.same.map((x) => x.l).join(', ').slice(0, 120)}`}</Text> : null}
    </View>
  );
}

/** The body of one change card. */
export function ChangeBody({ v }: { v: ChangeView }) {
  if (v.kind === 'text') return <TextDiffView diff={v.diff} switcher={v.switcher} />;
  if (v.kind === 'list') return <ListDiff list={v.list} sched={v.field === 'schedules'} />;
  if (v.kind === 'roles') return <View style={{ gap: 10 }}>{v.roles.map((r) => <View key={r.title} style={{ gap: 4 }}><Label>{r.title}</Label><ListDiff list={r.list} /></View>)}</View>;
  return <Arrow before={v.before} after={v.after} />;
}
