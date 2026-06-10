import { useEffect } from 'react';
import { Stack, Redirect } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { HAS_SUPABASE } from '@/lib/supabase';

export default function JuniorLayout() {
  const status = useSessionStore((s) => s.status);

  // 로그인되면 매장 노하우를 당겨오고 구독(사장님 새 답변이 채팅 RAG에 즉시 반영).
  // + 내 채팅 기록도 DB에서 복원(새로고침해도 대화 유지).
  useEffect(() => {
    if (status !== 'signed_in') return;
    usePlaybookStore.getState().hydrate();
    useChatStore.getState().hydrate(useSessionStore.getState().userId);
    const offP = usePlaybookStore.getState().subscribe();
    return () => offP();
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
