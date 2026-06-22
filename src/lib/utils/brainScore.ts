// 매장 두뇌 완성도 (혼자 모드 후킹 F3).
// 전략: "내 매장 매뉴얼 23% 완성 · 다음 빈칸 추천" — 입력 동기가 약한 사장이
// 게이지를 채우고 싶게 만드는 가시적 진척 지표. 게이미피케이션은 담백하게.
import type { PlaybookEntry, Category } from '@/types';
import { ALL_CATEGORIES, getCategoryMeta } from '@/lib/utils/category';

// 각 카테고리에서 "충분히 채워졌다"고 보는 목표 노하우 수.
// 4 카테고리 × 5 = 20개를 채우면 게이지 100%. (성숙 매장 시드가 카테고리당 5~8개)
export const TARGET_PER_CATEGORY = 5;

export type BrainLevel = 'seed' | 'growing' | 'solid' | 'rich';

export type BrainScore = {
  pct: number; // 0~100
  total: number; // 등록된 노하우 총수
  perCategory: Record<Category, number>;
  weakest: Category | null; // 가장 비어 있는 카테고리(다음 추천 대상). 모두 목표 달성 시 null
  nextHint: string; // 추천 문구
  level: BrainLevel;
};

export function computeBrainScore(entries: PlaybookEntry[]): BrainScore {
  const perCategory: Record<Category, number> = {
    Routine: 0,
    Event: 0,
    Context: 0,
    'Know-how': 0,
  };
  for (const e of entries) {
    perCategory[e.category] = (perCategory[e.category] ?? 0) + 1;
  }

  const total = entries.length;
  const goal = TARGET_PER_CATEGORY * ALL_CATEGORIES.length;
  // 한 카테고리에 몰아넣어도 100%가 안 되도록 카테고리별 상한(목표치)으로 캡.
  const capped = ALL_CATEGORIES.reduce(
    (sum, c) => sum + Math.min(perCategory[c], TARGET_PER_CATEGORY),
    0,
  );
  const pct = Math.round((capped / goal) * 100);

  // 가장 적은 카테고리를 추천(동률이면 카테고리 정의 순서가 빠른 쪽).
  let weakest: Category | null;
  if (total === 0) {
    weakest = 'Routine'; // 콜드스타트: 루틴부터 채우면 효과가 가장 빠름
  } else if (ALL_CATEGORIES.every((c) => perCategory[c] >= TARGET_PER_CATEGORY)) {
    weakest = null; // 모든 칸이 목표 달성
  } else {
    weakest = ALL_CATEGORIES.reduce(
      (min, c) => (perCategory[c] < perCategory[min] ? c : min),
      ALL_CATEGORIES[0],
    );
  }

  const nextHint = weakest
    ? `‘${getCategoryMeta(weakest).label}’ 노하우를 더 알려주면 빈틈이 줄어요`
    : '4개 카테고리가 골고루 채워졌어요 👍';

  const level: BrainLevel =
    pct >= 100 ? 'rich' : pct >= 60 ? 'solid' : pct >= 25 ? 'growing' : 'seed';

  return { pct, total, perCategory, weakest, nextHint, level };
}
