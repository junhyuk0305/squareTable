import { CategoryColors, CategoryColorsSoft } from '@/lib/theme/colors';
import type { Category } from '@/types';

type CategoryMeta = {
  key: Category;
  emoji: string;
  label: string;     // 한국어
  color: string;
  soft: string;
  description: string;
};

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  Routine: {
    key: 'Routine',
    emoji: '🔁',
    label: '루틴',
    color: CategoryColors.Routine,
    soft: CategoryColorsSoft.Routine,
    description: '매일 반복되는 일',
  },
  Event: {
    key: 'Event',
    emoji: '⚠',
    label: '돌발',
    color: CategoryColors.Event,
    soft: CategoryColorsSoft.Event,
    description: '갑자기 생기는 일',
  },
  Context: {
    key: 'Context',
    emoji: '📜',
    label: '원칙',
    color: CategoryColors.Context,
    soft: CategoryColorsSoft.Context,
    description: '매장의 룰·위치',
  },
  'Know-how': {
    key: 'Know-how',
    emoji: '💡',
    label: '꿀팁',
    color: CategoryColors['Know-how'],
    soft: CategoryColorsSoft['Know-how'],
    description: '일 잘하는 비법',
  },
};

export function getCategoryMeta(category: Category): CategoryMeta {
  return CATEGORY_META[category];
}

export const ALL_CATEGORIES: Category[] = ['Routine', 'Event', 'Context', 'Know-how'];
