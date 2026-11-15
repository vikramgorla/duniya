// "Change with AI": describe the change in plain words; the server's AI helper (/api/ai/agent-draft) proposes edits,
// you see each one as a friendly diff (#63, as in the panel), and nothing is saved until you tap Apply.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ChangeBody } from '@/components/Diff';
import { Body, Button, Card, Field, H2, Label, Note, Row, Screen } from '@/components/ui';
import { plural, review } from '@/lib/ai-review';
import { can, useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import type { Agent, AgentDraft, ModelList } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function ChangeWithAI() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { api, user } = useAuth();
  const models = useData<ModelList>(can(user, 'admin') ? 'models' : null, (a) => a.get('/api/models'));
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [error, setError] = useState('');

  const ask = async () => {
    setBusy(true); setError(''); setDraft(null);
    try { setDraft(await api!.post<AgentDraft>('/api/ai/agent-draft', { agentId: id, request, model: 'auto' })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!draft) return;
    setApplying(true);
    try {
      await api!.put<Agent>(`/api/agents/${encodeURIComponent(id)}`, Object.fromEntries(draft.changes.map((c) => [c.field, c.after])));
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
          {draft.changes.length === 0 ? <Body muted>No changes were needed.</Body> : (() => {
            const r = review(draft.changes, { names: draft.names, models: models.data });
            return (
              <>
                <Row wrap gap={8} style={{ alignItems: 'center' }}>
                  <Body style={{ fontWeight: '700' }}>{r.title}</Body>
                  {r.added ? <Text accessibilityLabel={`${plural(r.added, 'word')} added`} style={{ backgroundColor: t.addBg, color: t.addInk, borderRadius: 6, paddingHorizontal: 6, fontSize: 13 }}>{`+${plural(r.added, 'word')}`}</Text> : null}
                  {r.removed ? <Text accessibilityLabel={`${plural(r.removed, 'word')} removed`} style={{ backgroundColor: t.delBg, color: t.delInk, borderRadius: 6, paddingHorizontal: 6, fontSize: 13 }}>{`−${plural(r.removed, 'word')}`}</Text> : null}
                </Row>
                {r.views.map((v) => (
                  <Card key={v.field}>
                    <View style={{ gap: 2 }}><Label>{v.section}</Label><H2>{v.head}</H2></View>
                    <ChangeBody v={v} />
                  </Card>
                ))}
              </>
            );
          })()}
          {draft.changes.length ? <Button kind="primary" title="Apply these changes" busy={applying} onPress={apply} /> : null}
          <Label style={{ textAlign: 'center' }}>{`drafted with ${draft.model}`}</Label>
        </>
      ) : null}
    </Screen>
  );
}
