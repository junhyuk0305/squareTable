import type { PlaybookEntry } from '@/types';

/**
 * 노하우 카드·상세의 '출처' 표기 SSOT.
 *  - source.label 이 있으면 그대로(업종 표준 템플릿 등 명시 라벨).
 *  - creator_role(0101, 작성 시점 스냅샷)이 있으면 그걸로 존칭을 정한다:
 *     · 'manager' → "○○ 매니저" (권한체계 정본 §5-3 #2 저자 크레딧)
 *     · 'owner'   → "○○ 사장님"
 *  - 레거시(역할 미저장)는 기존 규칙: 작성 경로 kind 'owner'(또는 미지정) → "○○ 사장님",
 *    그 외(inbox_answer 등) = 역할을 단정하지 않고 "○○님".
 */
export function knowhowSourceLabel(
  entry: Pick<PlaybookEntry, 'creator_name' | 'creator_role' | 'source'>,
): string {
  if (entry.source?.label) return entry.source.label;
  const name = entry.creator_name?.trim() || '작성자';
  if (entry.creator_role === 'manager') return `${name} 매니저`;
  if (entry.creator_role === 'owner') return `${name} 사장님`;
  const ownerAuthored = !entry.source || entry.source.kind === 'owner';
  return ownerAuthored ? `${name} 사장님` : `${name}님`;
}
