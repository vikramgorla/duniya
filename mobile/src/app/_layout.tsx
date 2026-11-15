// Root: sign-in state decides which screens exist (Stack.Protected). Signed out → Connect; locked → Lock.
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { Logo } from '@/components/Logo';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  return <AuthProvider><Navigation /></AuthProvider>;
}

function Navigation() {
  const { state } = useAuth();
  const t = useTheme();
  if (state === 'loading') {
    return <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><Logo size={64} /></View>;
  }
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg, card: t.bg, text: t.ink, border: t.line, primary: t.ink, notification: t.bad } };
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: t.bg }, headerTintColor: t.ink, headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: t.bg }, headerBackButtonDisplayMode: 'minimal',
      }}>
        <Stack.Protected guard={state === 'ready'} redirectTo={state === 'locked' ? '/lock' : '/connect'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="agent/[id]" options={{ title: 'Agent' }} />
          <Stack.Screen name="ai/[id]" options={{ title: 'Change with AI', presentation: 'modal' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="usage" options={{ title: 'Usage' }} />
          <Stack.Screen name="server" options={{ title: 'Server' }} />
          <Stack.Screen name="pending" options={{ title: 'Waiting for you' }} />
          <Stack.Screen name="settings" options={{ title: 'App settings' }} />
          <Stack.Screen name="owner" options={{ title: 'Owner assistant' }} />
        </Stack.Protected>
        <Stack.Protected guard={state === 'locked'} redirectTo={state === 'ready' ? '/' : '/connect'}>
          <Stack.Screen name="lock" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={state === 'signedOut'} redirectTo={state === 'locked' ? '/lock' : '/'}>
          <Stack.Screen name="connect" options={{ headerShown: false }} />
          <Stack.Screen name="scan" options={{ title: 'Scan the panel’s QR code', presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Screen name="oauth" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
