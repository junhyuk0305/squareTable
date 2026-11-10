// labels.ts — 제안 상태 → 화면 문구·칩 색. 직원 내 공간·직원 노하우 제안·사장 제안함이 같이 쓴다(AGENTS ②).
// 문구는 명사형이다(2026-11-10 사용자 결정 · '반영됨'·'반영' → '승인').
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import type { PlaybookSuggestion } from '@/types';

type SuggestionStatus = PlaybookSuggestion['status'];

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  approved: '승인',
  rejected: '반려',
  pending: '검토 중',
};

/** 제안 상태 칩 — 면(bg)과 글자(fg)를 한 쌍으로 묶는다. 떨어져 있으면 '승인'에 빨간 틴트가 깔린다. */
export const SUGGESTION_STATUS_CHIP: Record<SuggestionStatus, { bg: string; fg: string }> = {
  approved: { bg: BrandColors.goodSoft, fg: BrandColors.goodText },
  rejected: { bg: InkColors.bgSoft, fg: TextColor.secondary },
  pending: { bg: BrandColors.yellowSoft, fg: BrandColors.warnText },
};
