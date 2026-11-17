/**
 * 공간 화면 두 곳의 판정(화면조립표 2026-11-17 10절·11절). 화면에 흩지 않고 여기 한 곳에 둔다.
 * 순수 함수다. 검사 = scripts/qa-space-screen-plans.mjs.
 */

/** 첫 5분(/space/first) 단계. 10절 4번 = 3단계 그대로. */
export type FirstStep = 'write' | 'ask' | 'link';

const FIRST_ORDER: FirstStep[] = ['write', 'ask', 'link'];

/**
 * 첫 5분의 맨 아래 고정 노란 버튼(11절 3번) + 머리 뒤로.
 * - 버튼 = 다음 단계로 간다. 이름은 다음 단계 이름이다. 마지막 단계에는 다음 단계가 없어 그 단계의 일(교육 링크 만들기)을 한다.
 * - 뒤로 = 앞 단계. 첫 단계에서만 null(화면을 나간다).
 */
export function firstStepPlan(step: FirstStep): { dock: { kind: 'go'; to: FirstStep } | { kind: 'link' }; back: FirstStep | null } {
  const i = FIRST_ORDER.indexOf(step);
  const next = FIRST_ORDER[i + 1];
  return {
    dock: next ? { kind: 'go', to: next } : { kind: 'link' },
    back: i > 0 ? FIRST_ORDER[i - 1] : null,
  };
}

/**
 * 공간 교육 탭(/space/teach)의 교육 링크 카드와 질문 0건 빈 상태(10절 1번 · 1차 추천대로).
 * - linkCard: 링크가 1개 이상일 때만 그린다. 노란 [새 교육 링크]가 카드 맨 위다. 링크가 0개면 버튼만 든 카드가 되므로 그리지 않는다(11절 4번).
 * - emptyNext: 질문 0건일 때 빈 상태의 다음 행동. 노하우 0 = 노하우 쓰기 · 링크 0(스위치 켜짐) = 교육 링크 만들기 · 둘 다 했으면 없음.
 * - emptyTone: 링크 카드의 노란 버튼이 화면에 있으면 보조 모양, 없으면 노랑(주 버튼 하나).
 */
export function spaceTeachPlan(v: { knowhow: number; links: number; linksOn: boolean }): {
  linkCard: boolean;
  emptyNext: 'write' | 'link' | null;
  emptyTone: 'yellow' | 'secondary';
} {
  const linkCard = v.linksOn && v.links > 0;
  const emptyNext = v.knowhow === 0 ? 'write' : v.linksOn && v.links === 0 ? 'link' : null;
  return { linkCard, emptyNext, emptyTone: linkCard ? 'secondary' : 'yellow' };
}
