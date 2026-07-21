import { searchPlaybook, labelSimilarity } from '@/lib/rag';
import type { PlaybookEntry } from '@/types';

/**
 * 노하우·챕터 "겹침 판정" SSOT.
 *
 * 같은 판정이 HandoverImport(대량등록 검수)·등록 확인 시트·챕터 추가 세 곳에 흩어지면
 * 임계값이 서로 어긋나 "여기선 중복인데 저기선 아닌" 상태가 된다 → 규칙은 여기 한 곳.
 *
 * 임계값은 렉시컬 점수 기준이며 파일럿 실사용 분포로 재보정 대상이다(현재값=대량등록 V1 계승).
 */

/** 약한 유사 — "비슷한 게 있어요" 참고 배지용. 저장을 막지 않는다. */
export const SIMILAR_SCORE_MIN = 0.35;
/** 같은 노하우로 의심 — 대량등록 기본 선택 해제 / 등록 시 확인 시트. */
export const SAME_SCORE_MIN = 0.45;
/** 챕터명 겹침(labelSimilarity 0~1) — 새 챕터 만들 때 기존 챕터 제안. */
export const SAME_SECTION_MIN = 0.5;

/** 겹침 판정에 쓰는 질의 텍스트 — 제목+상황(SSOT: 세 호출부가 같은 문자열을 써야 점수가 일관된다). */
export function dedupeQuery(e: Pick<PlaybookEntry, 'title' | 'square'>): string {
  return `${e.title ?? ''} ${e.square?.situation ?? ''}`.trim();
}

export type SimilarHit = { entry: PlaybookEntry; score: number };

/**
 * pool 안에서 가장 비슷한 노하우 1건. minScore 미만이면 null.
 * self 는 자기 자신 제외용(수정 화면에서 자기와 비교하는 것 방지).
 */
export function findSimilarEntry(
  query: string,
  pool: PlaybookEntry[],
  minScore: number,
  selfId?: string,
): SimilarHit | null {
  const q = query.trim();
  if (!q) return null;
  const candidates = selfId ? pool.filter((e) => e.id !== selfId) : pool;
  if (candidates.length === 0) return null;
  const top = searchPlaybook(q, candidates, { topK: 1 }).candidates[0];
  return top && top.score >= minScore ? { entry: top.entry, score: top.score } : null;
}

/** 기존 챕터명 중 가장 비슷한 것. 표기만 다른 챕터 난립(응대/진상응대/클레임)을 막는다. */
export function findSimilarSection(name: string, existing: string[]): string | null {
  const n = name.trim();
  if (!n) return null;
  let best: { name: string; score: number } | null = null;
  for (const s of existing) {
    if (s.trim() === n) return s; // 완전 일치는 곧바로
    const score = labelSimilarity(n, s);
    if (score >= SAME_SECTION_MIN && (!best || score > best.score)) best = { name: s, score };
  }
  return best?.name ?? null;
}
