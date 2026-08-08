import type { PlaybookEntry } from '@/types';
import { honorific } from './roles';

/**
 * 노하우 카드·상세의 '출처' 표기 SSOT.
 *  - source.label 이 있으면 그대로(업종 표준 템플릿 등 명시 라벨).
 *  - creator_role(0101, 작성 시점 스냅샷)이 있으면 그걸로 존칭을 정한다:
 *     · 'manager' → "○○ 매니저" (권한체계 정본 §5-3 #2 저자 크레딧)
 *     · 'owner'   → "○○ 사장님"
 *  - 레거시(역할 미저장)는 기존 규칙: 작성 경로 kind 'owner'(또는 미지정) → "○○ 사장님",
 *    그 외(inbox_answer 등) = 역할을 단정하지 않고 "○○님".
 * 호칭 문자열 자체는 roles.honorific 이 SSOT — 여기선 "어느 역할로 볼지"만 정한다.
 */
export function knowhowSourceLabel(
  entry: Pick<PlaybookEntry, 'creator_name' | 'creator_role' | 'source'>,
): string {
  if (entry.source?.label) return entry.source.label;
  const name = entry.creator_name?.trim() || '작성자';
  if (entry.creator_role) return honorific(name, entry.creator_role);
  const ownerAuthored = !entry.source || entry.source.kind === 'owner';
  return honorific(name, ownerAuthored ? 'owner' : 'junior');
}
