// 훈련 퀴즈 v2 — 혼동쌍 탐지 (⑦ scale_pick "더 큰 쪽 고르기"의 재료 찾기)
//
// 07-29 가 "숨은 차별점"으로 지목한 자리다: "레귤러 3펌프 / 라지 4펌프"처럼 **비슷한데 값이 다른**
// 두 노하우를 짚어 주는 것. 렌더러·채점·FormatSpec 은 0158 에서 다 만들었고, 비어 있던 건
// 그 쌍을 자동으로 찾아 주는 이쪽 절반이다.
//
// ★ 왜 pgvector 임베딩을 안 쓰나
//   임베딩은 실재한다(0012 playbook_embeddings, 768차원, 엣지 task:'embed'). 다만 쓸 수 있는
//   창구가 match_playbook(query_embedding, unit) 하나뿐이다 — **질의 벡터**를 받는 검색이지
//   "저장된 노하우 A와 B의 코사인" 을 돌려주는 창구가 아니다. 그걸 쓰려면 (a) 새 RPC 마이그레이션
//   (b) 순수·동기인 pickFormats 를 async 로 바꾸기 (c) 엣지 임베딩 호출로 AI 캡 차감 —
//   셋 다 이 작업의 스코프 밖이다. 벡터를 클라로 내리지 않는 건 0012 의 의도적 결정이기도 하다.
//
// ★ 그리고 여기서 필요한 판정은 애초에 의미 유사도가 아니다. 거르는 일의 대부분을
//   **"같은 단위의 값을 서로 다르게 갖고 있나"** 라는 구조 조건이 한다. 그 뒤에 남는
//   "둘이 같은 것을 재고 있나"만 제목 겹침으로 본다 — 혼동쌍은 대개 재는 대상 이름
//   ("시럽")을 공유하기 때문이다. 겹침 판정은 이미 있는 labelSimilarity 를 그대로 쓴다
//   (findSimilarSection 과 같은 수단·같은 눈금).
//
// ★ Math.random 없음. 같은 노하우·같은 풀이면 언제나 같은 쌍이 나온다.

import { labelSimilarity } from '@/lib/rag';
import type { PlaybookEntry } from '@/types';
import { numericValues, type NumericValue } from './detect';

/**
 * 제목 겹침 하한(labelSimilarity 0~1).
 * 근거: "레귤러 시럽 양" vs "라지 시럽 양" → 공유 토큰 1/최소토큰수 2 = 0.5. 이 정도가 하한이고,
 * 한쪽 제목이 다른 쪽을 포함하면("시럽 양" ⊂ "라지 시럽 양") 1.0 이라 당연히 통과한다.
 * 챕터명 겹침(SAME_SECTION_MIN)이 같은 눈금에서 0.5 를 쓰는 것과도 맞춘다.
 * ⚠️ 파일럿 실사용 분포로 재보정 대상(knowhowSimilarity.ts 의 임계값들과 같은 성격).
 */
export const PAIR_SIM_MIN = 0.5;

/**
 * 두 값의 배율 상한(큰 값 / 작은 값).
 * 근거: 실제로 헷갈리는 쌍은 바로 옆 단계다 — 3펌프/4펌프(1.33) · 3분/5분(1.67) · 2장/3장(1.5).
 * 3배를 넘어가면(60도 vs 4도) 누구나 어느 쪽이 큰지 알아서 문항이 성립하지 않는다.
 * 값이 **같은** 쌍은 애초에 고를 게 없으므로 배율과 무관하게 뺀다.
 * ⚠️ 이 숫자도 실사용 문항 정답률로 재보정 대상이다.
 */
export const PAIR_MAX_RATIO = 3;

export type ConfusionPair = [PlaybookEntry, PlaybookEntry];

/** 같은 단위인데 값이 다르고, 그 차이가 "헷갈릴 만한" 범위 안인 조합이 하나라도 있나. */
function valuesConfusable(a: NumericValue[], b: NumericValue[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.unit !== y.unit || x.value === y.value) continue;
      const ratio = Math.max(x.value, y.value) / Math.min(x.value, y.value);
      if (ratio <= PAIR_MAX_RATIO) return true;
    }
  }
  return false;
}

/**
 * seeds 중 한 건과 pool 안의 다른 한 건으로 이루어진 혼동쌍 1개. 없으면 **null**.
 *
 * 억지로 만들지 않는다(07-29) — 조건을 못 채우면 그냥 없는 것이고, 호출부는 다른 형태로 간다.
 *
 * ★ 쌍마다 문항은 한 번만 나와야 한다. quiz-new 는 고른 노하우를 하나씩 돌며 문항을 만들기 때문에,
 *   A 차례와 B 차례가 각각 같은 쌍을 찾아내면 똑같은 "레귤러 vs 라지" 문항이 두 번 나간다.
 *   그래서 **id 가 작은 쪽이 seed 일 때만** 쌍으로 인정한다(호출 사이에 상태를 두지 않는 규칙).
 */
export function findConfusionPair(seeds: PlaybookEntry[], pool: PlaybookEntry[]): ConfusionPair | null {
  const cache = new Map<string, NumericValue[]>();
  const valuesOf = (e: PlaybookEntry): NumericValue[] => {
    let v = cache.get(e.id);
    if (!v) {
      v = numericValues(e);
      cache.set(e.id, v);
    }
    return v;
  };

  for (const seed of seeds) {
    const sv = valuesOf(seed);
    if (sv.length === 0) continue;

    let best: { entry: PlaybookEntry; score: number } | null = null;
    for (const cand of pool) {
      if (!cand || cand.id <= seed.id) continue;   // 자기 자신 제외 + 위 "id 작은 쪽" 규칙
      if (!valuesConfusable(sv, valuesOf(cand))) continue;
      const score = labelSimilarity(seed.title ?? '', cand.title ?? '');
      if (score < PAIR_SIM_MIN) continue;
      // 동점이면 id 가 작은 쪽 — 풀 순서가 바뀌어도 결과가 흔들리지 않게.
      if (!best || score > best.score || (score === best.score && cand.id < best.entry.id)) {
        best = { entry: cand, score };
      }
    }
    if (best) return [seed, best.entry];
  }
  return null;
}
