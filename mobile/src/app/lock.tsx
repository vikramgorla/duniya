// Biometric unlock (App settings → Unlock with Face ID / fingerprint).
import { useEffect } from 'react';
import { View } from 'react-native';
import { Logo } from '@/components/Logo';
import { Body, Button, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function Lock() {
  const t = useTheme();
  const { unlock, signOut, server } = useAuth();
  useEffect(() => { unlock(); }, [unlock]);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
      <Logo size={64} />
      <Title>Duniya is locked</Title>
      <Body muted style={{ textAlign: 'center' }}>{server.replace(/^https?:\/\//, '')}</Body>
      <Button kind="primary" title="Unlock" onPress={unlock} style={{ alignSelf: 'stretch' }} />
      <Button kind="ghost" title="Sign out instead" onPress={() => signOut()} />
    </View>
  );
}
