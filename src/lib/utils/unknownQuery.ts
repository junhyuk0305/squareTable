import type { UnknownQuery } from '@/types';

/**
 * 미답변 질문의 '시급한 순' 정렬 — 이 판정의 단일 진실원천.
 *
 * 기준: AI 자신감 낮은 순(= 노하우로 못 덮은 것) → 같으면 최근 질문 순.
 * 받은질문 화면의 hero와 사장 홈의 hero가 **같은 1건**을 가리켜야 하므로
 * 화면마다 정렬을 다시 쓰지 않는다. (2026-08-05 사장 홈이 이 정렬을 함께 쓰게 되면서 승격)
 */
export function sortByUrgency(list: UnknownQuery[]): UnknownQuery[] {
  return [...list].sort((a, b) => {
    if (a.best_match_confidence !== b.best_match_confidence) {
      return a.best_match_confidence - b.best_match_confidence;
    }
    return new Date(b.asked_at).getTime() - new Date(a.asked_at).getTime();
  });
}
