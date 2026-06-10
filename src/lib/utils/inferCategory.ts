import type { Category } from '@/types';

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Event:     ['클레임', '환불', '오류', '에러', '문제', '진상', '화내', '큰소리', '정전', '외상', '단골', '안 돼', '고장', '머리카락', '이물질', '벌레'],
  Routine:   ['청소', '마감', '오픈', '음악', '진열', '발주', '재고', '시간대', '음향', '루틴', '피크', '닫', '열', '준비'],
  Context:   ['어디', '위치', '비밀번호', '비번', '와이파이', '있어요', '룰', '규칙', '몇 시', '연락처'],
  'Know-how':['어떻게', '비법', '꿀팁', '추천', '분쇄도', '원두', '제조', '잘 만드', '맛있게', '예쁘게'],
};

type Candidate = { entry: { category: string }; score: number };

/**
 * 질의의 추정 카테고리.
 * 1) 가장 높은 점수의 candidate가 0.3 이상이면 그 카테고리
 * 2) 키워드 매칭 (우선순위: Event > Routine > Context > Know-how)
 * 3) 기본값 Event
 */
export function inferCategoryFromQuery(query: string, candidates: Candidate[] = []): Category {
  if (candidates.length > 0 && candidates[0].score > 0.3) {
    return candidates[0].entry.category as Category;
  }
  const order: Category[] = ['Event', 'Routine', 'Context', 'Know-how'];
  for (const cat of order) {
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (query.includes(kw)) return cat;
    }
  }
  return 'Event';
}
