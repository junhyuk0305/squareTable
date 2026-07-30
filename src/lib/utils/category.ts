import { CategoryColors, CategoryColorsSoft, CustomCategoryColor, CustomCategoryColorSoft } from '@/lib/theme/colors';
import { getCustomCategoryRegistry, type CustomCategory } from '@/lib/store/knowhowCategories';
import type { Category } from '@/types';

type CategoryMeta = {
  key: string;       // 기본 4종 키 또는 커스텀 id
  label: string;     // 한국어
  color: string;
  soft: string;
  description: string;
};

// 카테고리 표시는 (색점 + 이름) — 이모지 사용 안 함(2026-07-31, 그림 이모지 금지 표준).
export const CATEGORY_META: Record<Category, CategoryMeta> = {
  Routine: {
    key: 'Routine',
    label: '루틴',
    color: CategoryColors.Routine,
    soft: CategoryColorsSoft.Routine,
    description: '매일 반복되는 일',
  },
  Event: {
    key: 'Event',
    label: '돌발',
    color: CategoryColors.Event,
    soft: CategoryColorsSoft.Event,
    description: '갑자기 생기는 일',
  },
  Context: {
    key: 'Context',
    label: '원칙',
    color: CategoryColors.Context,
    soft: CategoryColorsSoft.Context,
    description: '매장의 룰·위치',
  },
  'Know-how': {
    key: 'Know-how',
    label: '꿀팁',
    color: CategoryColors['Know-how'],
    soft: CategoryColorsSoft['Know-how'],
    description: '일 잘하는 비법',
  },
};

/**
 * 카테고리 메타 조회 — 기본 4종 + 매장 커스텀(0096).
 * customs 를 안 넘기면 usePlaybookStore 가 hydrate 시 채우는 레지스트리에서 찾는다
 * (기존 소비처 20여 곳이 인자 하나로 그대로 동작). 삭제된 커스텀 id 는 '기타'로 폴백.
 */
export function getCategoryMeta(category: string, customs?: CustomCategory[]): CategoryMeta {
  const base = (CATEGORY_META as Record<string, CategoryMeta>)[category];
  if (base) return base;
  const list = customs ?? getCustomCategoryRegistry();
  const custom = list.find((c) => c.id === category);
  return {
    key: category,
    label: custom?.label ?? '기타',
    color: CustomCategoryColor,
    soft: CustomCategoryColorSoft,
    description: '매장에서 만든 종류',
  };
}

export const ALL_CATEGORIES: Category[] = ['Routine', 'Event', 'Context', 'Know-how'];
