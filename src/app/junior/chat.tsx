import { useEffect, useMemo } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoleTabBar } from '@/components/RoleTabBar';
import { ScreenLoading } from '@/components/ScreenLoading';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { JuniorBrowseDashboard } from '@/components/JuniorBrowseDashboard';
import { JuniorAsk } from '@/components/junior/JuniorAsk';
import { JuniorMySpace } from '@/components/junior/JuniorMySpace';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore, answerableQuestions } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { styles } from '@/styles/juniorChatStyles';

/**
 * 노하우 탭(주니어) — KnowhowSegment 컨테이너.
 *  · 둘러보기: 발행된 노하우를 카드로 보여주고, 탭하면 원본 노하우 전체를 읽기 전용으로 연다.
 *  · 물어보기: 기존 AI 어시스턴트 챗(RAG·useChatStore·만족도 100% 보존)
 *
 * 크롬(SafeArea·헤더·탭바) 소유권은 이 컨테이너가 가진다 — 임베드된 챗(JuniorAsk)은
 * 자체 SafeAreaView/RoleTabBar를 갖지 않는다(중복 방지).
 */
export default function JuniorChatScreen() {
  // 홈의 예시 질문 칩이 넘긴 문구 — 입력칸을 채우기만 한다(전송은 직원이).
  const { seed } = useLocalSearchParams<{ seed?: string }>();
  const entries = usePlaybookStore((s) => s.entries);
  const me = useSessionStore((s) => s.userId);
  const queue = useUnknownQueueStore((s) => s.queue);

  // '내 공간' 배지·리스트가 항상 최신이도록 미답질문 큐를 컨테이너에서 hydrate·subscribe(D4).
  useEffect(() => {
    const uq = useUnknownQueueStore.getState();
    void uq.hydrate();
    return uq.subscribe();
  }, []);

  // 둘러보기에 노출할 발행 노하우. status 없는 시드도 안전하게 통과(published 우선, 미정이면 노출).
  const publishedEntries = useMemo(
    () => entries.filter((e) => e.status === 'published' || !e.status),
    [entries],
  );
  // '내 공간' 탭 배지 = 내가 도와줄 수 있는 매장 미답질문 수(SSOT: answerableQuestions).
  // 제안을 함께 넘겨 "이미 누가 답을 올려 승인 대기 중"인 질문은 배지에서도 빠지게 한다(리스트와 동일 축).
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const answerableCount = useMemo(
    () => answerableQuestions(queue, me, suggestions).length,
    [queue, me, suggestions],
  );

  // ★세 뷰가 읽는 소스가 **전부** 와야 세그먼트를 세운다 — 하나라도 늦으면 '내 공간' 배지가
  //   0 이었다가 n 으로 튀고, 둘러보기가 "아직 등록된 노하우가 없어요"로 먼저 뜬다.
  //   훅은 각각 부른 뒤 AND 한다(&& 안에서 훅 호출 금지 — 렌더마다 훅 개수가 달라진다).
  const playbookLoaded = usePlaybookStore((s) => s.loaded);
  const queueLoaded = useUnknownQueueStore((s) => s.loaded);
  const suggestionLoaded = useSuggestionStore((s) => s.loaded);
  const chatLoaded = useChatStore((s) => s.loaded);
  const ready = playbookLoaded && queueLoaded && suggestionLoaded && chatLoaded;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '물어보기' }} />
      {!ready ? (
        <ScreenLoading label="노하우를 불러오고 있어요…" />
      ) : (
        <KnowhowSegment
          role="junior"
          initial="ask"
          browse={
            <JuniorBrowseDashboard
              entries={publishedEntries}
              emptyHint="아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요."
            />
          }
          ask={<JuniorAsk seed={seed} />}
          mine={<JuniorMySpace me={me} />}
          mineCount={answerableCount}
        />
      )}
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}
