/**
 * 카테고리 가이드 접근 + 빈 칸 검사 (규칙기반, AI 0콜).
 *
 * 데이터 원천은 `@/data/category-guides`. CellPath는 그 모듈에서 정의되며
 * (순환 import 회피) 여기서 re-export 해 공유 계약으로 노출한다.
 */
import type { Category, SquareBlock } from '@/types';
import {
  CATEGORY_GUIDES,
  type CategoryGuide,
  type CellPath,
  type Followup,
} from '@/data/category-guides';

// CellPath 등 타입은 이 모듈에서도 가져다 쓸 수 있게 re-export.
export type { CellPath, Followup, CategoryGuide };

/** 카테고리의 AI 사전지식 가이드. 알 수 없으면 Routine으로 폴백. */
export function getCategoryGuide(category: Category): CategoryGuide {
  return CATEGORY_GUIDES[category] ?? CATEGORY_GUIDES.Routine;
}

/** 해당 칸에 의미 있는 내용이 없으면 true. (꼬리질문 트리거 판정용) */
export function isCellEmpty(square: SquareBlock, cell: CellPath): boolean {
  switch (cell) {
    case 'action.steps':
      return square.action.steps.length === 0;
    case 'action.scripts':
      return square.action.scripts.length === 0;
    case 'result':
      return !square.result.before && !square.result.after && !square.result.metric;
    case 'extract.do':
      return !square.extract.do;
    case 'extract.dont':
      return !square.extract.dont;
    case 'situation':
      return !square.situation.trim();
    case 'quagmire':
      return !square.quagmire.trim();
    case 'uncover':
      return !square.uncover.trim();
    default:
      return true;
  }
}
