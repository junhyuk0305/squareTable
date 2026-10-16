import { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';

import { RoleTabBar } from '@/components/RoleTabBar';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
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
  // ?uqId=<미답질문 id> — 알림(레지스트리 q_answered·question route)에서 들어온 질문(역 ⑤).
  const { seed, uqId } = useLocalSearchParams<{ seed?: string; uqId?: string }>();
  const entries = usePlaybookStore((s) => s.entries);
  const me = useSessionStore((s) => s.userId);
  const queue = useUnknownQueueStore((s) => s.queue);
  const history = useChatStore((s) => s.history);

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
  const playbookLoadError = usePlaybookStore((s) => s.loadError);
  const hydratePlaybook = usePlaybookStore((s) => s.hydrate);
  const queueLoaded = useUnknownQueueStore((s) => s.loaded);
  const suggestionLoaded = useSuggestionStore((s) => s.loaded);
  const chatLoaded = useChatStore((s) => s.loaded);
  const ready = playbookLoaded && queueLoaded && suggestionLoaded && chatLoaded;

  // ?uqId= 의 질문이 내 것이면 물어보기 탭의 그 답변 카드(대화 기록은 문장으로 잇는다 — 미답질문 id 와 대화 id 는 다르다 ·
  // enqueue 의 중복 판정과 같은 trim 비교). 동료 질문(question)이면 '내 공간'(도와줄 수 있는 질문)으로 연다.
  // 세그먼트는 ready 뒤에 세워지므로 이 판정 때는 큐·대화가 다 와 있다.
  const focusUq = useMemo(() => (uqId ? queue.find((u) => u.id === uqId) : undefined), [uqId, queue]);
  const focusTurnId = useMemo(
    () => (focusUq && focusUq.junior_id === me ? history.find((q) => q.query_text.trim() === focusUq.query_text.trim())?.id : undefined),
    [focusUq, me, history],
  );
  const initialSeg = focusUq && !focusTurnId ? 'mine' : 'ask';

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* 상단은 직접 그린다 — 왼쪽 정렬 평문 제목은 네이티브 헤더로 못 낸다(ScreenTitleHeader 주석).
          헤더를 끄는 선언은 junior/_layout 에 있다(마운트 뒤에 끄면 한 프레임 깜빡인다). */}
      <ScreenTitleHeader title="물어보기" storeLine />
      {!ready ? (
        <ScreenLoading label="노하우를 불러오고 있어요…" />
      ) : playbookLoadError ? (
        // ★노하우 목록 읽기 실패를 "아직 매장에 없는 질문이에요"라는 **거짓 단정**으로 바꾸지 않는다(#23).
        //   그 문구는 사장이 답을 안 올려놨다는 뜻이라, 실제로는 있는 답을 없다고 말하는 셈이 된다.
        <LoadErrorState title="노하우를 불러오지 못했어요" onRetry={() => void hydratePlaybook()} />
      ) : (
        <KnowhowSegment
          role="junior"
          initial={initialSeg}
          browse={
            <JuniorBrowseDashboard
              entries={publishedEntries}
              emptyHint="아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요."
            />
          }
          ask={<JuniorAsk seed={seed} focusId={focusTurnId} />}
          mine={<JuniorMySpace me={me} />}
          mineCount={answerableCount}
        />
      )}
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}
