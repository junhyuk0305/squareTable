import { useEffect } from 'react';
import { Stack, Redirect, usePathname } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { deriveSubscription } from '@/lib/utils/subscription';

export default function JuniorLayout() {
  const status = useSessionStore((s) => s.status);
  const unitId = useSessionStore((s) => s.unitId);
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const pathname = usePathname();

  // 로그인 + 매장 소속이 확정된 뒤에만 데이터를 당겨오고 실시간 구독한다.
  // ⚠️ unitId를 의존성에 포함: 승인 대기→승인(unitId 부여)·강제 소속해제(unitId 비워짐) 순간
  //    이 effect가 재실행되어 새 소속 기준으로 재하이드레이트/재구독한다(남용 #2·#5).
  useEffect(() => {
    if (status !== 'signed_in' || !unitId) return;
    usePlaybookStore.getState().hydrate();
    useChatStore.getState().hydrate(useSessionStore.getState().userId);
    useWorkStore.getState().hydrate();
    useAttendanceStore.getState().hydrate();
    usePayrollStore.getState().hydrate();
    useStaffStore.getState().hydrate();
    useScheduleStore.getState().hydrate();
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    const offS = useScheduleStore.getState().subscribe();
    return () => {
      offP();
      offW();
      offA();
      offS();
    };
  }, [status, unitId]);

  // 소속 상태를 주기적으로 서버와 재동기화(profiles는 realtime 미구독).
  //  - 승인 대기 중이면 사장 승인이 반영돼 자동으로 홈으로 진입(#2).
  //  - 근무 중 사장이 내보내면(unit_id=null) 즉시 감지해 접근을 끊는다(#5).
  useEffect(() => {
    if (status !== 'signed_in') return;
    const id = setInterval(() => void useSessionStore.getState().refreshMembership(), 20000);
    return () => clearInterval(id);
  }, [status]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 가입은 됐지만 매장 미연결 → 빈 챗으로 떨어뜨리지 않고 개인 허브(hub)로 유도.
  // hub = 마이페이지 + 배너 + 가게 코드 입력이 있는 직원 착지 홈. join은 hub로 리다이렉트되는 레거시 경로.
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    !unitId &&
    pathname !== '/junior/hub' &&
    pathname !== '/junior/join' &&
    pathname !== '/junior/onboarding'
  ) {
    return <Redirect href="/junior/hub" />;
  }
  // 매장 구독 만료 → 직원은 계좌 정보 없이 '사장님 결제 대기' 고지(/billing 이 역할별로 렌더).
  // fail-open: 구독 정보 없음이면 막지 않는다.
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    unitId &&
    !deriveSubscription({ subStatus, trialEndsAt, paidUntil }).entitled &&
    pathname !== '/billing'
  ) {
    return <Redirect href="/billing" />;
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTitleStyle: { fontWeight: '800', color: InkColors.ink, fontSize: 16 },
        headerTintColor: InkColors.ink,
      }}
    >
      {/* 홈 헤더(로고+알림벨)는 home.tsx의 <Stack.Screen>이 단일 소스로 구성한다 — 여기선 등록만. */}
      <Stack.Screen name="home" />
      {/* 메인 탭 메뉴 — 좌상단 로고 없음(홈 화면에만 착착 로고 노출).
          탭 루트는 하단 탭바로만 이동하므로 뒤로가기 화살표를 무조건 끈다
          (headerLeft 미지정 시 react-navigation 기본 back 화살표가 history에 따라 노출됨 → 막다른 컨트롤). */}
      <Stack.Screen name="chat" options={{ title: '노하우', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="attendance" options={{ title: '출퇴근', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="work" options={{ title: '업무', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="settings" options={{ title: '설정', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="timesheet" options={{ title: '내 출퇴근 내역', headerLeft: () => <HeaderBackButton fallback="/junior/attendance" /> }} />
      <Stack.Screen name="schedule" options={{ title: '근무표', headerLeft: () => <HeaderBackButton fallback="/junior/home" /> }} />
      <Stack.Screen name="notifications" options={{ title: '알림', headerLeft: () => <HeaderBackButton fallback="/junior/home" /> }} />
      <Stack.Screen name="hub" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ title: '가게 연결' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}
