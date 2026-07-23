import type { PlaybookEntry } from '@/types';

/**
 * 노하우 카드·상세의 '출처' 표기 SSOT.
 *  - source.label 이 있으면 그대로(업종 표준 템플릿 등 명시 라벨).
 *  - 없으면 작성 경로로 존댓말을 정한다:
 *     · kind 'owner'(또는 레거시 미지정) = 사장 직접 작성 → "○○ 사장님"
 *     · 그 외(inbox_answer 등, 직원이 답했을 수 있음) = 역할을 단정하지 않고 "○○님"
 *  (작성자 역할이 엔트리에 저장되지 않고, 직원 화면에선 로스터를 못 받으므로 무조건 '사장님'을 붙이지 않는다.)
 */
export function knowhowSourceLabel(entry: Pick<PlaybookEntry, 'creator_name' | 'source'>): string {
  if (entry.source?.label) return entry.source.label;
  const name = entry.creator_name?.trim() || '작성자';
  const ownerAuthored = !entry.source || entry.source.kind === 'owner';
  return ownerAuthored ? `${name} 사장님` : `${name}님`;
}
