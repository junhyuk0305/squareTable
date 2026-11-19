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

/** 같은 질문의 다른 답이 승인돼 서버가 자동 반려한 제안(0582 tg_uq_close_pending_suggestions).
 *  판정 = 서버 _suggestion_auto_rejected(0631)와 같다: 반려 · 검토한 사람 없음 · 서버 메모 문구. */
const AUTO_REJECT_NOTE = '다른 답으로 해결된 질문이에요.';
export const OTHER_ANSWER_APPROVED = '다른 답이 승인됐어요';
export const isOtherAnswerApproved = (s: PlaybookSuggestion): boolean =>
  s.status === 'rejected' && !s.reviewed_by && s.owner_note === AUTO_REJECT_NOTE;

/** 제안 상태 칩 — 면(bg)과 글자(fg)를 한 쌍으로 묶는다. 떨어져 있으면 '승인'에 빨간 틴트가 깔린다. */
export const SUGGESTION_STATUS_CHIP: Record<SuggestionStatus, { bg: string; fg: string }> = {
  approved: { bg: BrandColors.goodSoft, fg: BrandColors.goodText },
  rejected: { bg: InkColors.bgSoft, fg: TextColor.secondary },
  pending: { bg: BrandColors.yellowSoft, fg: BrandColors.warnText },
};
