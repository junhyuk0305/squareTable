import { useSessionStore } from '@/lib/store/useSessionStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { isPendingSuggestionToReview } from '@/lib/utils/notifications';
import type { PlaybookSuggestion, UnknownQuery } from '@/types';

/**
 * 노하우 탭 '할 일' = 답할 질문 + 검토할 제안.
 * 탭 배지·세그먼트 카운트·실제 목록이 **같은 수**를 말해야 하므로 판정을 여기 하나로 둔다.
 * (2026-08-07 받은질문 탭 흡수 — 탭이 사라진 대신 배지가 "밀린 게 있다"를 알린다.)
 *
 * 목록을 그리는 쪽(OwnerTodoSegment)은 카운트가 아니라 **아래 술어 두 개**를 그대로 import 해서
 * 거른다 — 같은 조건을 다시 쓰면 배지와 목록이 조용히 어긋난다.
 */

/** 사장이 답해야 하는 질문 = 아직 대기 중인 미답질문. */
export const isTodoQuestion = (u: UnknownQuery) => u.status === 'pending_owner_answer';

/** 검토해야 하는 제안 = 아직 승인·반려하지 않았고 **내가 올린 게 아닌** 것.
 *  판정 본체는 알림 축과 같은 함수(notifications.isPendingSuggestionToReview) — 배지·목록·알림이
 *  같은 술어를 봐야 "알림엔 없는데 배지엔 있다"가 안 생긴다. 매니저가 승격 전 올린 제안이 그 케이스다. */
export const isTodoSuggestion = (s: PlaybookSuggestion, me?: string) => isPendingSuggestionToReview(s, me);

export function useOwnerTodoCount(): { questions: number; suggestions: number; total: number } {
  // ★셀렉터는 배열이 아니라 **수**를 돌려준다 — filter 결과(새 배열)를 돌려주면 참조가 매번 달라져
  //   zustand가 상태 변화로 오인하고 무한 재렌더로 간다.
  const me = useSessionStore((s) => s.userId);
  const questions = useUnknownQueueStore((s) => s.queue.filter(isTodoQuestion).length);
  const suggestions = useSuggestionStore((s) => s.suggestions.filter((x) => isTodoSuggestion(x, me)).length);
  return { questions, suggestions, total: questions + suggestions };
}
