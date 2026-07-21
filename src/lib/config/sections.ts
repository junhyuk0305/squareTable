// 매뉴얼 챕터(= playbook_entries.section) 표준 세트.
//
// 왜 표준을 두는가: 챕터명을 자유 텍스트로 받으면 같은 뜻인데 표기가 갈린 챕터가 난립한다.
// (실제로 시드 데이터의 subcategory에 '응대'·'진상응대'·'클레임'이 이미 따로 존재한다.)
// 표준에서 고르게 하고, 직접 추가는 허용하되 유사 챕터가 있으면 되묻는다(findSimilarSection).
//
// 업종 매핑은 knowhowPacks.INDUSTRY_PACKS와 같은 모양 — 1차는 카페만 전용, 나머지는 공통 폴백.

/** 업종 무관 공통 챕터. 순서 = 매뉴얼에 실릴 기본 순서(오픈→운영→마감→관리). */
const COMMON_SECTIONS = [
  '오픈',
  '마감',
  '고객 응대',
  '위생·청소',
  '기기·설비',
  '재고·발주',
  '결제·정산',
  '근무·인사',
  '비상 상황',
] as const;

/** 업종 전용 추가 챕터(공통 뒤에 붙는다). */
const INDUSTRY_SECTIONS: Record<string, string[]> = {
  '카페·디저트': ['음료 제조'],
};

/** 미분류 노하우가 매뉴얼에서 묶이는 이름. 표준 목록에는 넣지 않는다(고를 수 있는 챕터가 아님). */
export const UNSECTIONED = '기타';

/** 이 매장에서 고를 수 있는 표준 챕터. 미지의 업종은 공통으로 폴백. */
export function standardSections(industry: string | undefined): string[] {
  return [...COMMON_SECTIONS, ...(INDUSTRY_SECTIONS[industry ?? ''] ?? [])];
}

/**
 * 챕터 선택지 = 표준 + 이 매장이 실제로 쓰고 있는 챕터(직접 추가분·인수인계서 소제목 유래).
 * 표준을 앞에, 매장 고유 챕터를 뒤에 둔다. '기타'는 선택지에서 제외.
 */
export function sectionOptions(industry: string | undefined, used: (string | null | undefined)[]): string[] {
  const std = standardSections(industry);
  const known = new Set(std);
  const extra: string[] = [];
  for (const raw of used) {
    const s = raw?.trim();
    if (!s || s === UNSECTIONED || known.has(s)) continue;
    known.add(s);
    extra.push(s);
  }
  return [...std, ...extra.sort((a, b) => a.localeCompare(b, 'ko'))];
}
