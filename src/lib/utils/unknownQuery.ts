import type { UnknownQuery } from '@/types';

/**
 * 미답변 질문의 '오래 기다린 순' 정렬 — 이 판정의 단일 진실원천.
 *
 * 기준: 오래 기다린 순(asked_at 오름차순) → 같으면 AI 자신감 낮은 순(= 노하우로 못 덮은 것).
 * 받은질문 화면의 hero와 사장 홈의 hero가 **같은 1건**을 가리켜야 하므로
 * 화면마다 정렬을 다시 쓰지 않는다. (2026-08-05 사장 홈이 이 정렬을 함께 쓰게 되면서 승격)
 *
 * ★2026-08-06 1차 기준 교체(confidence → 대기시간). 근거는 자산화 효율이 아니라 **설명 가능성**이다:
 *  ① 히어로 카드에는 "2시간 전"이 찍히는데 정렬은 confidence였다 — 화면에 보이는 값과 순서 기준이
 *     다르면 사장이 순서를 이해할 수 없다. 정렬은 화면에 표시되는 값으로 한다.
 *  ② best_match_confidence 는 0001_init 기본값이 0이라 노하우가 적은 매장은 pending 이 전부 0으로
 *     몰린다 → 동점 tiebreak(최신순)만 남아 **가장 오래 기다린 질문이 영영 안 뜬다**(정본 §2의 정반대).
 * confidence 는 버리지 않고 동시각 tiebreak 로 남긴다.
 */
export function sortByUrgency(list: UnknownQuery[]): UnknownQuery[] {
  return [...list].sort((a, b) => {
    const at = new Date(a.asked_at).getTime();
    const bt = new Date(b.asked_at).getTime();
    if (at !== bt) return at - bt;
    return a.best_match_confidence - b.best_match_confidence;
  });
}
