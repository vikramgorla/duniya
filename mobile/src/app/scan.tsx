// In-app QR scanner (works in Expo Go): reads the panel's connect code and returns to Connect with the address.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Body, Button, Note, Screen } from '@/components/ui';
import { parseScan } from '@/lib/server-url';
import { useTheme } from '@/lib/theme';

export default function Scan() {
  const t = useTheme();
  const router = useRouter();
  const [perm, request] = useCameraPermissions();
  const [wrong, setWrong] = useState(false);
  const done = useRef(false);

  if (!perm) return <Screen><Body muted>Checking camera access…</Body></Screen>;
  if (!perm.granted) {
    return (
      <Screen>
        <Body>Duniya needs the camera only to read the QR code in your panel (Settings → Mobile app).</Body>
        {perm.canAskAgain ? <Button kind="primary" title="Allow the camera" onPress={request} />
          : <><Note tone="warn">Camera access is off for Duniya.</Note><Button title="Open phone settings" onPress={() => Linking.openSettings()} /></>}
        <Button kind="ghost" title="Type the address instead" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          const server = parseScan(data);
          if (!server) { setWrong(true); return; }
          done.current = true;
          router.dismissTo({ pathname: '/connect', params: { server } });
        }} />
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 40, gap: 10 }}>
        {wrong ? <Note tone="warn">That QR code is not a Duniya panel code. Use the one in Settings → Mobile app → step 3.</Note>
          : <View style={{ backgroundColor: t.card, borderRadius: t.radiusS, padding: 12 }}><Body small>Point the camera at the QR code in your panel: Settings → Mobile app → step 3.</Body></View>}
      </View>
    </View>
  );
}
