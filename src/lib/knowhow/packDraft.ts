// packDraft.ts — 사장 답하기 초안(8번 · 결정 115·117). 직원 질문 글로 업종 노하우팩에서 맞는 항목 하나를 찾는다.
// AI 를 부르지 않는다. 앱 번들의 팩(knowhow-packs.json) 키워드와 질문 글을 견줘 점수를 매긴다.
// 맞는 것이 없거나 애매하면 null = 초안을 안 보인다. 틀린 초안보다 안 보이는 쪽이 낫다.
//
// ★순수 함수다. 런타임 import 를 두지 않는다(검사 scripts/qa-pack-draft.mjs 가 노드로 이 파일을 바로 읽는다).
//   후보 목록은 부르는 쪽이 준다 = templatesForIndustry(업종)(src/data/knowhowPacks.ts).
// 임계값은 아래 PACK_DRAFT 상수 한 곳이다. 바꾸면 qa:pack-draft 를 다시 돌려 숫자를 기록한다.

import type { PlaybookEntry } from '@/types';

/** 임계값 한 곳. qa:pack-draft 에서 "틀린 초안 ≤ 5%" 안에서 맞힌 비율이 가장 큰 값으로 정했다. */
export const PACK_DRAFT = {
  /** 보일 최소 점수(맞은 키워드 희소도 합). */
  minScore: 3,
  /** 1등과 2등의 점수 차 하한. 두 항목이 비슷하게 걸리면 어느 쪽도 확신할 수 없어 안 보인다. */
  minMargin: 0.4,
  /** 키워드가 하나만 맞으면 그 말이 검색어이고 이 길이 이상일 때만 보인다(두 글자 한 단어 = 아무 데나 걸린다). */
  singleMinLen: 4,
} as const;

/**
 * 매장 사실을 묻는 말. 팩은 상황 대처 요령이라 이런 질문에는 답이 없다(어디서 사요 · 번호 · 가격 · 언제 와요 · 쉬는 날).
 * 이 말이 있으면 초안을 안 보인다. 사장은 그대로 직접 답한다.
 */
const STORE_FACT = /(어디서(사|봐|구해)|어디에(맡겨|둬)|번호|가격|얼마|거래처|업체|요일|언제와|언제부터|몇시|레시피|쉬어도|쉬는날)/;

type PackItem = Pick<PlaybookEntry, 'id' | 'title' | 'tags' | 'search_keywords'>;

export type PackDraftHit<T extends PackItem> = { item: T; score: number; matched: string[] };

/** 공백·문장부호를 지우고 소문자로. 한국어는 붙여 쓰기가 흔해 띄어쓰기를 무시해야 같은 말이 맞는다. */
const norm = (s: string): string => s.toLowerCase().replace(/[\s#·,./()\-"'“”‘’!?~…]+/g, '');

type Key = { k: string; search: boolean };

/** 항목의 키워드 = 검색어 + 태그 + 제목 낱말. 정규화 뒤 2자 이상만 쓴다(1자는 아무 데나 걸린다). */
function keysOf(item: PackItem): Key[] {
  const out = new Map<string, boolean>();
  for (const r of item.search_keywords ?? []) { const k = norm(r); if (k.length >= 2) out.set(k, true); }
  for (const r of [...(item.tags ?? []), ...item.title.split(/[\s·/()]+/)]) {
    const k = norm(r);
    if (k.length >= 2 && !out.has(k)) out.set(k, false);
  }
  return [...out].map(([k, search]) => ({ k, search }));
}

/** 점수 = 질문에 들어 있는 키워드의 idf 합. 흔한 말(자리·주문)은 낮고 드문 말(뚝배기·제빙기)은 높다. */
export function rankPackItems<T extends PackItem>(question: string, items: T[]): PackDraftHit<T>[] {
  const q = norm(question);
  if (q.length < 2 || items.length === 0) return [];
  const keyLists = items.map(keysOf);
  const df = new Map<string, number>();
  for (const ks of keyLists) for (const { k } of ks) df.set(k, (df.get(k) ?? 0) + 1);
  const n = items.length;
  const hits: (PackDraftHit<T> & { single: boolean })[] = [];
  items.forEach((item, i) => {
    const matched = keyLists[i].filter(({ k }) => q.includes(k));
    if (matched.length === 0) return;
    // 맞은 키워드끼리 한쪽이 다른 쪽에 들어 있으면 긴 것만 센다(얼음 + 얼음컵 이중 계산 방지).
    const kept = matched.filter((m) => !matched.some((o) => o.k !== m.k && o.k.includes(m.k)));
    const score = kept.reduce((s, { k }) => s + Math.log(1 + n / (df.get(k) ?? 1)), 0);
    hits.push({ item, score, matched: kept.map((m) => m.k), single: kept.length === 1 && !(kept[0].search && kept[0].k.length >= PACK_DRAFT.singleMinLen) });
  });
  // 약한 한 단어 일치는 점수를 반으로 — 순위에서 밀리고 대개 하한 아래로 떨어진다.
  for (const h of hits) if (h.single) h.score /= 2;
  return hits.sort((a, b) => b.score - a.score).map(({ item, score, matched }) => ({ item, score, matched }));
}

/** 초안 하나 또는 null. 매장 사실 질문이거나 점수가 하한 아래거나 2등과 차이가 작으면 null. */
export function packDraftFrom<T extends PackItem>(
  question: string,
  items: T[],
  minScore: number = PACK_DRAFT.minScore,
  minMargin: number = PACK_DRAFT.minMargin,
): PackDraftHit<T> | null {
  if (STORE_FACT.test(norm(question))) return null;
  const ranked = rankPackItems(question, items);
  const top = ranked[0];
  if (!top || top.score < minScore) return null;
  const second = ranked[1];
  if (second && top.score - second.score < minMargin) return null;
  return top;
}
