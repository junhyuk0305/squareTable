import { useEffect, useRef, useState } from 'react';
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
import { TextScaleTransition } from '@/components/settings/TextScaleTransition';
import { FreeUntilNotice } from '@/components/FreeUntilNotice';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, TEXT_SCALE_FACTOR } from '@/lib/store/usePreferencesStore';
import { patchTextScaling, setTextScaleFactor } from '@/lib/theme/textScale';
import { InkColors } from '@/lib/theme/colors';
import { injectPwaHead } from '@/lib/pwa/head';
import { usePushBootstrap } from '@/lib/push/usePushBootstrap';
import { useAppBadgeSync } from '@/lib/push/appBadge';
import { initAnalytics, installGlobalErrorHandlers, track } from '@/lib/analytics/track';

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
    // 안 잡힌 예외/Promise reject 를 원격 관측으로 흘려보낸다(리포트 P0-2).
    installGlobalErrorHandlers();
    // PostHog(웹 전용, 키 없으면 no-op) — autocapture/pageview 를 위해 부팅 시 초기화.
    initAnalytics();
  }, [init]);

  // 리텐션/DAU 측정 — 로그인 세션이 열릴 때 1회 기록(계측 컨텍스트가 채워진 뒤).
  const sessionLogged = useRef(false);
  useEffect(() => {
    if (signedIn && !sessionLogged.current) {
      sessionLogged.current = true;
      track('session_open');
    }
  }, [signedIn]);

  // 웹푸시: 서비스워커 등록 + 로그인 시 자동 구독 보장 + 알림 클릭 라우팅.
  usePushBootstrap();
  // 앱 아이콘 배지(숫자) — 안 읽은 알림 수를 OS 아이콘에 동기화(Android PWA/데스크톱, iOS는 no-op).
  useAppBadgeSync();

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
        {/* 글자 크기 전환 로딩 오버레이 — Stack 바깥이라 key 리마운트에도 살아남아 깜빡임을 가린다. */}
        <TextScaleTransition />
        {splashDone && signedIn && <FreeUntilNotice />}
        <ErrorBoundary>
          <Stack
            key={textScale}
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              // 화면 컨테이너 기본 배경 — 미지정 시 RN/네비게이션 기본 흰색이 화면 전환(slide)
              // 중·SafeArea 인셋에서 새어 나온다. 디자인시스템 페이퍼톤으로 깔아 통일.
              contentStyle: { backgroundColor: InkColors.cream },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="signup" />
            <Stack.Screen name="stores" />
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
