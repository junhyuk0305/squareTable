import { CategoryColors, CategoryColorsSoft, CustomCategoryColor, CustomCategoryColorSoft, InkColors } from '@/lib/theme/colors';
import { getCustomCategoryRegistry, type CustomCategory } from '@/lib/store/knowhowCategories';
import { UNSECTIONED } from '@/lib/config/sections';
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

// ── 사용자 표면 카테고리(= playbook_entries.section) 색 ──────────────────
// 2026-07-31 단일화: 사용자에게 보이는 분류는 섹션(매뉴얼 챕터) 하나뿐이다.
// 기본 4종(루틴/돌발/원칙/꿀팁)은 AI 내부 비계로만 남고 UI에 라벨을 노출하지 않는다.
// 표준 챕터는 고정색(인접 챕터 색 충돌 방지), 매장이 만든 챕터는 이름 해시로 결정적 배정.

const SECTION_FIXED_COLORS: Record<string, string> = {
  '오픈': '#3E92D9',      // 블루
  '마감': '#8A63D2',      // 퍼플
  '고객 응대': '#F26A50', // 코랄
  '위생·청소': '#2FAF6B', // 그린
  '기기·설비': '#2FA79B', // 틸
  '재고·발주': '#C77D3A', // 브론즈
  '결제·정산': '#F2A83C', // 앰버골드
  '근무·인사': '#D2637F', // 로즈
  '비상 상황': '#c44b4b', // 레드 — 비상은 경고색
};

/**
 * 매장이 만든 카테고리에 줄 수 있는 색 — 새 카테고리는 **여기서 안 쓰인 색을 골라 저장**한다
 * (`pickCategoryColor`). 저장색이 없는 옛 항목만 이름 해시로 폴백한다.
 */
export const SECTION_PALETTE = ['#3E92D9', '#F26A50', '#2FAF6B', '#F2A83C', '#8A63D2', '#D2637F', '#2FA79B', '#C77D3A'];

/** 표준 챕터가 이미 점유한 색 — 새 카테고리가 '오픈'의 파랑을 다시 쓰지 않게 taken 에 넣는다. */
export const FIXED_SECTION_COLORS = Object.values(SECTION_FIXED_COLORS);

export type SectionMeta = { label: string; color: string };

/** 섹션(사용자 표면의 "카테고리") 표시 메타. null/빈 값/'기타'는 회색 '기타'. */
export function getSectionMeta(section: string | null | undefined): SectionMeta {
  const name = section?.trim();
  if (!name || name === UNSECTIONED) return { label: UNSECTIONED, color: InkColors.ink3 };
  const fixed = SECTION_FIXED_COLORS[name];
  if (fixed) return { label: name, color: fixed };
  // 매장이 만든 카테고리는 만들 때 고른 색이 레지스트리에 저장돼 있다 — 그게 우선이다.
  // (이름 해시는 카테고리가 넷만 돼도 색이 겹쳐서, 색점이 분류를 구분하지 못했다.)
  const saved = getCustomCategoryRegistry().find((c) => c.label === name)?.color;
  if (saved) return { label: name, color: saved };
  // 저장색이 없는 옛 항목 폴백 — 같은 이름이면 언제나 같은 색.
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum = (sum + name.charCodeAt(i)) % SECTION_PALETTE.length;
  return { label: name, color: SECTION_PALETTE[sum] };
}
