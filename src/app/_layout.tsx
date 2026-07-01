import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ResponsiveShell } from '@/components/ResponsiveShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SplashAnimation } from '@/components/SplashAnimation';
import { SyncBanner } from '@/components/SyncBanner';
import { Toast } from '@/components/Toast';
import { DialogHost } from '@/components/DialogHost';
import { FreeUntilNotice } from '@/components/FreeUntilNotice';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, TEXT_SCALE_FACTOR } from '@/lib/store/usePreferencesStore';
import { patchTextScaling, setTextScaleFactor } from '@/lib/theme/textScale';
import { injectPwaHead } from '@/lib/pwa/head';

// 전역 글자 크기 패치는 앱 모듈 로드 시 1회만.
patchTextScaling();

export default function RootLayout() {
  // 아이콘 폰트를 앱 렌더 전에 로드. 빠지면 웹에서 모든 글리프가 깨진 글자로 보임.
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font });

  // 글자 크기 설정 → 전역 배율에 반영. 렌더 중 동기로 적용해 자식이 새 배율로 그려진다.
  const textScale = usePreferencesStore((s) => s.textScale);
  setTextScaleFactor(TEXT_SCALE_FACTOR[textScale]);

  // 부팅 1회: 저장된 세션 복원 + 프로필 로드 + auth 변화 구독.
  const init = useSessionStore((s) => s.init);
  // 무료 공지 팝업은 로그인 화면이 아니라 로그인 후(홈 진입)에만 띄운다.
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    init();
    // 웹: '홈 화면에 추가'/푸시용 PWA 헤드 태그 주입 (output=single 이라 +html 미반영)
    injectPwaHead();
  }, [init]);

  // 진입 스플래시 모션(~1.9s). 이 구간에 폰트/세션 체크 시간을 숨긴다.
  const [splashDone, setSplashDone] = useState(false);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ResponsiveShell>
        {!splashDone && <SplashAnimation onDone={() => setSplashDone(true)} />}
        <SyncBanner />
        <Toast />
        <DialogHost />
        {splashDone && signedIn && <FreeUntilNotice />}
        <ErrorBoundary>
          <Stack key={textScale} screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="signup" />
            <Stack.Screen name="privacy" />
            <Stack.Screen name="terms" />
            <Stack.Screen name="legal/[doc]" />
            <Stack.Screen name="business-info" />
            <Stack.Screen name="account-edit" />
            <Stack.Screen name="junior" />
            <Stack.Screen name="owner" />
            <Stack.Screen name="billing" />
          </Stack>
        </ErrorBoundary>
      </ResponsiveShell>
    </SafeAreaProvider>
  );
}
