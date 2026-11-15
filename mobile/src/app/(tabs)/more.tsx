// More: the rest of the panel that makes sense on a phone.
import { useRouter } from 'expo-router';
import { Alert, Linking } from 'react-native';
import { Icon } from '@/components/Icon';
import { Body, Button, Card, Divider, Label, ListRow, Pill, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import type { Pending } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { server, user, demo, signOut } = useAuth();
  const pending = useData<Pending[]>('pending', (a) => a.get('/api/pending'));
  const n = pending.data?.length || 0;
  return (
    <Screen onRefresh={pending.refresh} refreshing={pending.refreshing}>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <ListRow title="Waiting for you" subtitle="Changes agents prepared that need a yes" left={<Icon name="pending" color={t.ink} />} right={n ? <Pill tone="warn">{String(n)}</Pill> : undefined} onPress={() => router.push('/pending')} />
        <Divider />
        <ListRow title="Owner assistant" subtitle="Your WhatsApp link, its model, who is linked" left={<Icon name="ai" color={t.ink} />} onPress={() => router.push('/owner')} />
        <Divider />
        <ListRow title="Usage" subtitle="Messages, tokens and cost by agent and model" left={<Icon name="usage" color={t.ink} />} onPress={() => router.push('/usage')} />
        <Divider />
        <ListRow title="Server" subtitle="Health, memory, disk and updates" left={<Icon name="server" color={t.ink} />} onPress={() => router.push('/server')} />
        <Divider />
        <ListRow title="App settings" subtitle="Unlock with biometrics, sign out" left={<Icon name="settings" color={t.ink} />} onPress={() => router.push('/settings')} />
      </Card>
      <Card>
        <Label>Signed in</Label>
        <Body>{demo ? 'Demo data (nothing is sent anywhere)' : `${user?.username || '…'} · ${user?.role || ''}`}</Body>
        {!demo ? <Body small muted selectable>{server}</Body> : null}
        {!demo ? <Button title="Open the web panel" onPress={() => Linking.openURL(server)} accessibilityHint="For things the app does not do: models, secrets, backups, users" /> : null}
        <Button kind="danger" title={demo ? 'Leave the demo' : 'Sign out'} onPress={() => (demo ? signOut() : Alert.alert('Sign out?', 'This phone forgets the sign-in. You can sign in again any time.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => signOut() }]))} />
      </Card>
      <Body small muted style={{ textAlign: 'center' }}>Models, secrets, backups, users and tool services stay in the web panel.</Body>
    </Screen>
  );
}
