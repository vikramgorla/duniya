// App settings: biometric unlock, which server, sign out.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Body, Button, Card, H2, Label, Note, Screen, Spread, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Settings() {
  const { biometric, setBiometric, server, user, demo, signOut } = useAuth();
  const [error, setError] = useState('');
  return (
    <Screen>
      <Card>
        <Spread>
          <View style={{ flex: 1 }}><H2>Unlock with Face ID or fingerprint</H2><Body small muted>Asks when you open the app and after 2 minutes away.</Body></View>
          <Toggle label="Unlock with biometrics" value={biometric} onChange={async (v) => { setError(''); try { await setBiometric(v); } catch (e) { setError((e as Error).message); } }} />
        </Spread>
        {Constants.executionEnvironment === ExecutionEnvironment.StoreClient && Platform.OS === 'ios'
          ? <Body small muted>In Expo Go the iPhone asks for its passcode instead of Face ID; the store version uses Face ID.</Body> : null}
        {error ? <Note tone="warn">{error}</Note> : null}
      </Card>
      <Card>
        <Label>Server</Label><Body selectable>{demo ? 'Demo data' : server}</Body>
        <Label>Account</Label><Body>{user ? `${user.username} (${user.role})` : '…'}</Body>
        <Body small muted>The sign-in is stored in this phone’s secure storage. To sign this phone out from elsewhere: web panel → Settings → Mobile app → Sign out.</Body>
        <Button kind="danger" title="Sign out" onPress={() => Alert.alert('Sign out?', 'This phone forgets the sign-in.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => signOut() }])} />
      </Card>
      <Label style={{ textAlign: 'center' }}>{`Duniya app ${Constants.expoConfig?.version || ''}`}</Label>
    </Screen>
  );
}
