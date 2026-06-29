import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { PlaybookEntry } from '@/types';

/**
 * 검증 3-state 배지 메타 — 단일 진실원천(SSOT).
 * SquareCard·BrowseList·knowledge 세 곳에 "동일 매핑" 주석과 함께 복붙돼 드리프트 위험이 있던 것을 통합.
 * 노랑=사장 검증 / good=현장 검증 / 회색=미검증.
 */
export type VerifyState = NonNullable<PlaybookEntry['verification']>['state'];
export type VerifyMeta = { label: string; fg: string; bg: string; icon: string };

export function verifyMeta(state?: VerifyState): VerifyMeta {
  switch (state) {
    case 'owner_verified':
      return { label: '사장님 검증', fg: InkColors.ink, bg: BrandColors.yellowSoft, icon: '✓' };
    case 'field_tested':
      return { label: '현장 검증', fg: BrandColors.good, bg: '#E6F1EA', icon: '✓' };
    default:
      return { label: '미검증', fg: InkColors.ink3, bg: InkColors.bgSoft, icon: '·' };
  }
}
