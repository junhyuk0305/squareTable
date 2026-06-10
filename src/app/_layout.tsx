import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ResponsiveShell } from '@/components/ResponsiveShell';
import { useSessionStore } from '@/lib/store/useSessionStore';

export default function RootLayout() {
  // 아이콘 폰트를 앱 렌더 전에 로드. 빠지면 웹에서 모든 글리프가 깨진 글자로 보임.
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font });

  // 부팅 1회: 저장된 세션 복원 + 프로필 로드 + auth 변화 구독.
  const init = useSessionStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ResponsiveShell>
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="junior" />
          <Stack.Screen name="owner" />
        </Stack>
      </ResponsiveShell>
    </SafeAreaProvider>
  );
}
