import type { PlaybookEntry } from '@/types';

/**
 * 노하우 검색 매칭(SSOT) — 제목·검색 키워드·태그 부분일치(대소문자·# 무시).
 *
 * 사장 '둘러보기'(OwnerKnowhowBrowse)와 직원 '둘러보기'(JuniorBrowseDashboard)가
 * 같은 검색 판정을 쓰도록 한 곳에 둔다(같은 규칙 복제 금지 — AGENTS 아키텍처 규칙 ②).
 * `q`는 이미 trim + lowercase 된 문자열을 기대한다(호출부에서 정규화). 빈 문자열이면 전부 통과.
 *
 * NOTE: 템플릿 검색(TemplateLibrary)은 대상 타입(PlaybookTemplate)과 필드가 달라(태그 미검색)
 * 별도로 둔다 — 여기는 PlaybookEntry(노하우) 전용.
 */
export function matchesKnowhowQuery(
  e: Pick<PlaybookEntry, 'title' | 'search_keywords' | 'tags'>,
  q: string,
): boolean {
  if (!q) return true;
  if (e.title?.toLowerCase().includes(q)) return true;
  if ((e.search_keywords ?? []).some((k) => k.toLowerCase().includes(q))) return true;
  if ((e.tags ?? []).some((t) => t.replace(/^#/, '').toLowerCase().includes(q))) return true;
  return false;
}
