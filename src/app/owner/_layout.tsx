import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { HAS_SUPABASE } from '@/lib/supabase';

export default function OwnerLayout() {
  const status = useSessionStore((s) => s.status);

  // 로그인되면 DB에서 당겨오고 실시간 구독(인박스·업무보드·출퇴근이 다른 기기 변경에 즉시 반응).
  useEffect(() => {
    if (status !== 'signed_in') return;
    usePlaybookStore.getState().hydrate();
    useUnknownQueueStore.getState().hydrate();
    useWorkStore.getState().hydrate();
    useAttendanceStore.getState().hydrate();
    usePayrollStore.getState().hydrate();
    useStaffStore.getState().hydrate();
    useScheduleStore.getState().hydrateLocal();
    const offQ = useUnknownQueueStore.getState().subscribe();
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    return () => {
      offQ();
      offP();
      offW();
      offA();
    };
  }, [status]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTitleStyle: { fontWeight: '800', color: InkColors.ink, fontSize: 16 },
        headerTintColor: InkColors.ink,
        // 기본: 모든 서브화면에 항상 뒤로가기 보장(웹 새로고침/딥링크 포함).
        headerLeft: () => <HeaderBackButton />,
      }}
    >
      {/* 탭 루트 5개는 뒤로가기 없이 기본(탭바로 이동) — 받은질문이 탭으로 승격됨 */}
      <Stack.Screen name="dashboard" options={{ title: '홈', headerLeft: undefined }} />
      <Stack.Screen name="categories" options={{ title: '노하우 추가', headerLeft: undefined }} />
      <Stack.Screen name="inbox" options={{ title: '받은 질문', headerLeft: undefined }} />
      <Stack.Screen name="work" options={{ title: '업무', headerLeft: undefined }} />
      <Stack.Screen name="settings" options={{ title: '설정', headerLeft: undefined }} />
      {/* 서브화면 — 전역 headerLeft(HeaderBackButton) 사용 */}
      <Stack.Screen name="staff" options={{ title: '직원 관리' }} />
      <Stack.Screen name="schedule" options={{ title: '근무표' }} />
      <Stack.Screen name="store-config" options={{ title: '가게 기본 정보' }} />
      <Stack.Screen name="attendance" options={{ title: '근무·급여' }} />
      <Stack.Screen name="timesheet/[staffId]" options={{ title: '출근 기록' }} />
      <Stack.Screen name="payroll" options={{ title: '급여 설정' }} />
      <Stack.Screen name="knowledge" options={{ title: '내 노하우' }} />
      <Stack.Screen name="edit/[id]" options={{ title: '노하우 수정' }} />
      {/* 대화형 입력 단일 화면 — 기존 answer/[uqId]·add/[category]·capture 위저드를 대체 */}
      <Stack.Screen name="coach" options={{ title: '노하우 알려주기' }} />
    </Stack>
  );
}
