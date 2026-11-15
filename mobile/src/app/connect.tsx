// Connect: enter the panel address (or scan the QR in Settings → Mobile app), then sign in with the panel account
// in the system browser (OAuth + PKCE). Deep link: duniya://connect?server=https%3A%2F%2F…
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { Body, Button, Card, Field, Label, Note, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { isInsecure, normalizeServer } from '@/lib/server-url';
import { useTheme } from '@/lib/theme';

export default function Connect() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, startDemo, notice } = useAuth();
  const params = useLocalSearchParams<{ server?: string }>();
  // What was typed, for the address that came in (a new scan replaces it).
  const [typed, setTyped] = useState<{ for?: string; value: string }>({ for: params.server, value: params.server || '' });
  const address = typed.for === params.server ? typed.value : params.server || '';
  const setAddress = (value: string) => setTyped({ for: params.server, value });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const server = normalizeServer(address);

  const go = async () => {
    setBusy(true); setError('');
    try { await signIn(address); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 72, gap: 18, maxWidth: 520, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 10 }}>
          <Logo size={56} />
          <Label>Duniya · WhatsApp agents</Label>
          <Title style={{ fontSize: 30 }}>Your agents, in your pocket.</Title>
          <Body muted>Connect to the Duniya panel you already use. You sign in with the same account, and the app can do what that account can do.</Body>
        </View>
        {notice ? <Note tone="warn">{notice}</Note> : null}
        <Card>
          <Button title="Scan the panel’s QR code" kind="primary" icon={<Icon name="scan" color={t.onPrimary} size={20} />} onPress={() => router.push('/scan')}
            accessibilityHint="Opens the camera. The code is in your panel under Settings, Mobile app." />
          <Body small muted style={{ textAlign: 'center' }}>In the panel: Settings → Mobile app → step 3.</Body>
          <Text style={{ textAlign: 'center', color: t.muted, fontFamily: t.mono, fontSize: 11, letterSpacing: 1.2 }}>— OR TYPE IT —</Text>
          <Field label="Panel address" value={address} onChangeText={setAddress} placeholder="duniya.example.com" autoCapitalize="none" autoCorrect={false}
            keyboardType="url" textContentType="URL" returnKeyType="go" onSubmitEditing={() => server && go()} />
          {server && isInsecure(server) ? <Note tone="warn">This address is not https, so your sign-in would travel unencrypted. Use the panel’s https address.</Note> : null}
          {error ? <Note tone="bad">{error}</Note> : null}
          <Button title={busy ? 'Opening sign-in…' : 'Sign in'} kind={server ? 'primary' : 'secondary'} disabled={!server} busy={busy} onPress={go}
            accessibilityHint="Opens your panel's sign-in page in the browser" />
          <Body small muted>Next, your panel’s sign-in page opens. Sign in, check what the app may do, and tap Approve.</Body>
        </Card>
        <Pressable accessibilityRole="button" onPress={startDemo} style={{ alignSelf: 'center', padding: 12 }}>
          <Text style={{ color: t.muted, textDecorationLine: 'underline', fontSize: 14 }}>No server yet? Look around with demo data</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
