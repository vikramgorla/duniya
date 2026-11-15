// Bottom tabs: Overview, Agents, Chats, Activity, More (Usage, Server, Waiting changes, App settings).
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';

import { useTheme } from '@/lib/theme';

const icon = (name: IconName) => function TabIcon({ color }: { color: ColorValue }) { return <Icon name={name} color={String(color)} />; };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: t.bg }, headerShadowVisible: false, headerTintColor: t.ink, headerTitleStyle: { fontWeight: '700' },
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
      tabBarActiveTintColor: t.ink, tabBarInactiveTintColor: t.muted,
      tabBarLabelStyle: { fontFamily: t.mono, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '600' },
      sceneStyle: { backgroundColor: t.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Overview', headerShown: false, tabBarIcon: icon('overview') }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents', tabBarIcon: icon('agents') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('chats') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('activity') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('more') }} />
    </Tabs>
  );
}
