import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
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
      }}
    >
      <Stack.Screen name="dashboard" options={{ title: '홈' }} />
      <Stack.Screen name="settings" options={{ title: '설정' }} />
      <Stack.Screen name="inbox" options={{ title: '받은 질문' }} />
      <Stack.Screen name="attendance" options={{ title: '근무·급여' }} />
      <Stack.Screen name="staff" options={{ title: '직원 관리' }} />
      <Stack.Screen name="timesheet/[staffId]" options={{ title: '출근 기록' }} />
      <Stack.Screen name="payroll" options={{ title: '급여 설정' }} />
      <Stack.Screen name="knowledge" options={{ title: '내 노하우' }} />
      <Stack.Screen name="edit/[id]" options={{ title: '노하우 수정' }} />
      <Stack.Screen name="work" options={{ title: '업무' }} />
      <Stack.Screen name="categories" options={{ title: '노하우 추가' }} />
      <Stack.Screen name="answer/[uqId]" options={{ title: '음성 답변' }} />
      <Stack.Screen name="add/[category]" options={{ title: '노하우 추가' }} />
    </Stack>
  );
}
