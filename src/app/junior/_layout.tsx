import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { HAS_SUPABASE } from '@/lib/supabase';

export default function JuniorLayout() {
  const status = useSessionStore((s) => s.status);

  // 로그인되면 매장 데이터를 DB에서 당겨오고 실시간 구독(다른 기기 변경 즉시 반영).
  useEffect(() => {
    if (status !== 'signed_in') return;
    usePlaybookStore.getState().hydrate();
    useChatStore.getState().hydrate(useSessionStore.getState().userId);
    useWorkStore.getState().hydrate();
    useAttendanceStore.getState().hydrate();
    usePayrollStore.getState().hydrate();
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
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTitleStyle: { fontWeight: '800', color: InkColors.ink, fontSize: 16 },
        headerTintColor: InkColors.ink,
      }}
    >
      <Stack.Screen name="chat" options={{ title: '스퀘어 어시스턴트' }} />
      <Stack.Screen name="attendance" options={{ title: '출퇴근' }} />
      <Stack.Screen name="work" options={{ title: '업무' }} />
    </Stack>
  );
}
