// "Change with AI": describe the change in plain words; the server's AI helper (/api/ai/bot-draft) proposes edits,
// you see each one, and nothing is saved until you tap Apply.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Body, Button, Card, Field, H2, Label, Mono, Note, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Bot, BotDraft } from '@/lib/types';

const FIELD: Record<string, string> = { name: 'Name', description: 'Description', prompt: 'Instructions', triggers: 'Triggers', respondToMentions: 'Reply when @mentioned', dm: 'Who may message it directly',
  organizers: 'Organizers', participants: 'Extra participants', mcpServers: 'Tool services', tools: 'Tool rules', confirm: 'Confirmation', schedules: 'Scheduled posts', memory: 'Group memory',
  model: 'Model', timezone: 'Timezone', historySize: 'Recent messages in context', maxTokens: 'Max reply tokens', plugins: 'Plugins', enabled: 'Enabled' };
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 1));

export default function ChangeWithAI() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<BotDraft | null>(null);
  const [error, setError] = useState('');

  const ask = async () => {
    setBusy(true); setError(''); setDraft(null);
    try { setDraft(await api!.post<BotDraft>('/api/ai/bot-draft', { botId: id, request, model: 'auto' })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!draft) return;
    setApplying(true);
    try {
      await api!.put<Bot>(`/api/bots/${encodeURIComponent(id)}`, Object.fromEntries(draft.changes.map((c) => [c.field, c.after])));
      router.back();
    } catch (e) { Alert.alert('Not saved', (e as Error).message); } finally { setApplying(false); }
  };
  return (
    <Screen>
      <Card>
        <Field label="What should change?" value={request} onChangeText={setRequest} multiline style={{ minHeight: 110 }}
          placeholder="e.g. Also answer in French. Post the driving plan on Sundays at 18:00 instead of Mondays." />
        <Button kind="primary" title={busy ? 'Thinking… (up to a minute)' : 'Draft the change'} disabled={request.trim().length < 3} busy={busy} onPress={ask} />
        <Body small muted>The AI only proposes. You see every change below and decide.</Body>
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}
      {draft ? (
        <>
          <Note tone="ok" title="Draft ready">{draft.summary || `${draft.changes.length} change(s)`}</Note>
          {draft.questions?.length ? <Note title="The AI asks">{draft.questions.join(' ')}</Note> : null}
          {draft.warnings?.length ? <Note tone="warn">{draft.warnings.join(' ')}</Note> : null}
          {draft.changes.length === 0 ? <Body muted>No changes were needed.</Body> : draft.changes.map((c) => (
            <Card key={c.field}>
              <H2>{FIELD[c.field] || c.field}</H2>
              <View style={{ gap: 4 }}><Label>Before</Label><Mono size={12}>{show(c.before).slice(0, 1200)}</Mono></View>
              <View style={{ gap: 4 }}><Label>After</Label><Mono size={12}>{show(c.after).slice(0, 2400)}</Mono></View>
            </Card>
          ))}
          {draft.changes.length ? <Button kind="primary" title="Apply these changes" busy={applying} onPress={apply} /> : null}
          <Label style={{ textAlign: 'center' }}>{`drafted with ${draft.model}`}</Label>
        </>
      ) : null}
    </Screen>
  );
}
