import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ResponsiveShell } from '@/components/ResponsiveShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SwipeBack } from '@/components/SwipeBack';
import { SplashAnimation } from '@/components/SplashAnimation';
import { SyncBanner } from '@/components/SyncBanner';
import { StoreEnterCover } from '@/components/StoreEnterCover';
import { Toast } from '@/components/Toast';
import { DialogHost } from '@/components/DialogHost';
import { TextScaleTransition } from '@/components/settings/TextScaleTransition';
import { FreeUntilNotice } from '@/components/FreeUntilNotice';
import { VoiceRecorderBinder } from '@/components/VoiceRecorderBinder';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePreferencesStore, TEXT_SCALE_FACTOR } from '@/lib/store/usePreferencesStore';
import { patchTextScaling, setTextScaleFactor } from '@/lib/theme/textScale';
import { InkColors } from '@/lib/theme/colors';
import { injectPwaHead } from '@/lib/pwa/head';
import { usePushBootstrap } from '@/lib/push/usePushBootstrap';
import { useAppBadgeSync } from '@/lib/push/appBadge';
import { initAnalytics, installGlobalErrorHandlers, track } from '@/lib/analytics/track';
import { guardMarketingRoutes } from '@/lib/web/marketingGuard';

// 마케팅 경로(/features·/pricing·/cafe…)로 앱이 뜨는 것을 렌더 전에 차단하고 정적 웹으로 돌려보낸다.
// 개발 서버엔 vercel rewrite 가 없어 여기서만 막힌다. 반드시 렌더 전(모듈 평가 시)에 호출할 것.
guardMarketingRoutes();

// 전역 글자 크기 패치는 앱 모듈 로드 시 1회만.
patchTextScaling();

/**
 * 세션이 확정되기를 기다리는 상한(ms). 스플래시 모션이 끝나도 세션이 안 오면 이만큼 더 붙잡는다.
 * 상한이 없으면 세션 복원이 멈춰 선 순간 스플래시가 영영 안 걷혀 **앱 전체가 잠긴다** — 그때만 풀어 준다.
 */
const BOOT_HOLD_MAX_MS = 5000;

export default function RootLayout() {
  // 아이콘 폰트를 앱 렌더 전에 로드. 빠지면 웹에서 모든 글리프가 깨진 글자로 보임.
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font });

  // 글자 크기 설정 → 전역 배율에 반영. 렌더 중 동기로 적용해 자식이 새 배율로 그려진다.
  const textScale = usePreferencesStore((s) => s.textScale);
  setTextScaleFactor(TEXT_SCALE_FACTOR[textScale]);
  // 기기에 저장된 설정(글자 크기 등)은 네이티브에서 **비동기**로 온다 — 오기 전에 그리면
  // 기본 배율로 한 번 그렸다가 튄다. 스플래시를 이것까지 기다리게 해 통째로 등장시킨다.
  const prefsLoaded = usePreferencesStore((s) => s.loaded);
  const hydrateLocalPrefs = usePreferencesStore((s) => s.hydrateLocal);

  // 부팅 1회: 저장된 세션 복원 + 프로필 로드 + auth 변화 구독.
  const init = useSessionStore((s) => s.init);
  // 무료 공지 팝업은 로그인 화면이 아니라 로그인 후(홈 진입)에만 띄운다.
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    void hydrateLocalPrefs();
    init();
    // 웹: '홈 화면에 추가'/푸시용 PWA 헤드 태그 주입 (output=single 이라 +html 미반영)
    injectPwaHead();
    // 안 잡힌 예외/Promise reject 를 원격 관측으로 흘려보낸다(리포트 P0-2).
    installGlobalErrorHandlers();
    // PostHog(웹 전용, 키 없으면 no-op) — autocapture/pageview 를 위해 부팅 시 초기화.
    initAnalytics();
  }, [init, hydrateLocalPrefs]);

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
  //
  // ★모션이 끝났다고 걷지 않는다 — **세션이 확정된 뒤에** 걷는다.
  //   예전엔 고정 타이머라 세션이 1.9초를 넘기면 스플래시가 먼저 사라졌고, 그 아래 화면들은
  //   `status==='loading'` 이라 null 을 반환해 **빈 크림 화면**이 드러났다(반대로 세션이 0.3초에
  //   끝나도 1.6초를 더 기다렸다). 화면은 다 준비된 뒤에 나온다 = 스플래시도 그때 걷힌다.
  const [splashDone, setSplashDone] = useState(false);
  const booted = useSessionStore((s) => s.status !== 'loading') && prefsLoaded;
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    if (booted) return;
    const t = setTimeout(() => setBootTimedOut(true), BOOT_HOLD_MAX_MS);
    return () => clearTimeout(t);
  }, [booted]);
  // onDone 은 신원이 고정돼야 한다 — 인라인 화살표면 ready 가 바뀔 때마다 페이드가 다시 시작돼 안 끝난다.
  const handleSplashDone = useCallback(() => setSplashDone(true), []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ResponsiveShell>
        {!splashDone && <SplashAnimation ready={booted || bootTimedOut} onDone={handleSplashDone} />}
        <SyncBanner />
        {/* 매장 진입 커버 — 어느 자리에서 눌렀든(허브 카드·상단바 매장 칸) 같은 커버를 여기서 그린다. */}
        <StoreEnterCover />
        {/* 네이티브 음성 녹음 인스턴스 주입(웹에선 .web 구현이 null 을 렌더). 화면은 안 그린다. */}
        <VoiceRecorderBinder />
        <Toast />
        <DialogHost />
        {/* 글자 크기 전환 로딩 오버레이 — Stack 바깥이라 key 리마운트에도 살아남아 깜빡임을 가린다. */}
        <TextScaleTransition />
        {splashDone && signedIn && <FreeUntilNotice />}
        <ErrorBoundary>
          {/* 왼쪽 가장자리 스와이프 → 이전 화면(Android). 제스처 루트도 여기서 제공한다. */}
          <SwipeBack>
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
            {/* 허브 탭 루트 3개(현황·노하우·매장) — 탭 전환(replace)은 슬라이드하지 않는다(owner/junior 탭 루트와 같은 규칙).
                ★stores 는 08-08 A2 때 '층 이동' 신호로 slide_from_left 를 줬으나, 실기기(2026-09-03)에선
                매장 탭 전환이 옆으로 밀리는 것으로만 보였다 → 웹과 같이 화면 교체 + Appear 등장으로 통일. */}
            <Stack.Screen name="stores" options={{ animation: 'none' }} />
            <Stack.Screen name="hub" options={{ animation: 'none' }} />
            <Stack.Screen name="hub-growth" options={{ animation: 'none' }} />

            <Stack.Screen name="privacy" />
            <Stack.Screen name="terms" />
            <Stack.Screen name="legal/[doc]" />
            <Stack.Screen name="business-info" />
            <Stack.Screen name="account-edit" />
            {/* 매장 진입(stores → 역할 홈 replace)도 슬라이드 없이 — 커버(StoreEnterCover)가 걷히고
                화면이 Appear 로 등장하는 것이 전환이다(2026-09-03 실기기). 매장 안 서브화면은 owner/junior
                _layout 의 자체 Stack 이 슬라이드를 맡으므로 여기 값과 무관하다. */}
            <Stack.Screen name="junior" options={{ animation: 'none' }} />
            <Stack.Screen name="owner" options={{ animation: 'none' }} />
            <Stack.Screen name="billing" />
            {/* 체험 종료 → 무엇을 남길지 고르는 가로막는 화면(0142). 허브·매장과 **같은 층**이다 —
                owner/ 안에 두면 활성 매장이 잠긴 순간 진입 자체가 막혀 계정이 갇힌다. */}
            <Stack.Screen name="downgrade" />
          </Stack>
          </SwipeBack>
        </ErrorBoundary>
      </ResponsiveShell>
    </SafeAreaProvider>
  );
}
