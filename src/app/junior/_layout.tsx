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
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    return () => {
      offP();
      offW();
      offA();
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
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="chat" options={{ title: '노하우' }} />
      <Stack.Screen name="attendance" options={{ title: '출퇴근' }} />
      <Stack.Screen name="work" options={{ title: '업무' }} />
      <Stack.Screen name="settings" options={{ title: '설정' }} />
      <Stack.Screen name="timesheet" options={{ title: '내 출퇴근 내역', headerLeft: () => <HeaderBackButton fallback="/junior/work" /> }} />
      <Stack.Screen name="join" options={{ title: '가게 연결' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}
