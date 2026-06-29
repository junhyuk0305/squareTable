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

export default function JuniorLayout() {
  const status = useSessionStore((s) => s.status);
  const unitId = useSessionStore((s) => s.unitId);
  const pathname = usePathname();

  // 로그인되면 매장 데이터를 DB에서 당겨오고 실시간 구독(다른 기기 변경 즉시 반영).
  useEffect(() => {
    if (status !== 'signed_in') return;
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
  }, [status]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 가입은 됐지만 매장 미연결 → 빈 챗으로 떨어뜨리지 않고 가게 연결(join)로 강제 유도.
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    !unitId &&
    pathname !== '/junior/join' &&
    pathname !== '/junior/onboarding'
  ) {
    return <Redirect href="/junior/join" />;
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
      <Stack.Screen name="join" options={{ title: '가게 연결' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}
