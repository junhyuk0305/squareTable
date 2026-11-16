/**
 * 공간 홈의 단계 판정(화면조립표 2026-11-17 5절·7절). 위에서부터 먼저 맞는 줄을 쓴다.
 * - answer(운영) = 답할 질문 1건 이상
 * - first(첫날)  = 노하우 0개
 * - ready(준비)  = 노하우 1개 이상 · 교육 링크 0개. 교육 링크 스위치가 꺼져 있으면 이 단계는 없다.
 * - run(운영 · 처리할 것 0) = 그 밖
 * 순수 함수다. 읽기는 화면이 지금 있는 db.ts 함수로 한다. 검사 = scripts/qa-space-home-stage.mjs.
 */
export type SpaceHomeStage = 'answer' | 'first' | 'ready' | 'run';

export function spaceHomeStage(v: { pending: number; knowhow: number; links: number; linksOn: boolean }): SpaceHomeStage {
  if (v.pending > 0) return 'answer';
  if (v.knowhow === 0) return 'first';
  if (v.linksOn && v.links === 0) return 'ready';
  return 'run';
}
