import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { PlaybookEntry } from '@/types';

/**
 * 검증 3-state 배지 메타 — 단일 진실원천(SSOT).
 * SquareCard·BrowseList·knowledge 세 곳에 "동일 매핑" 주석과 함께 복붙돼 드리프트 위험이 있던 것을 통합.
 *
 * ▸ 2026-08-05: **경고가 아니라 자랑으로 뒤집었다.**
 *   3-state 매핑은 그대로 두고 **배지 모양만** 바꾼다 — 검증된 둘은 파랑(mention) 계열로 통일하고,
 *   미검증은 회색을 유지한다. 미검증 '개수'를 알리는 책임은 목록 상단 <AlertRow>(레드)가 진다.
 *   기존 노랑(사장 검증)은 브랜드 CTA 노랑과 섞여 '검증됨'이 강조로 읽히지 않았다.
 *   dot = 원형 아이콘의 면 색(500) — 그 위 체크는 흰색이다. fg/bg는 칩(50/800) 짝.
 */
export type VerifyState = NonNullable<PlaybookEntry['verification']>['state'];
export type VerifyMeta = {
  label: string;
  fg: string;
  bg: string;
  icon: string;
  /** 원형 배지의 면 색 */
  dot: string;
  /** 검증된 상태인가 — 체크(✓)를 채울지, 흐린 점(·)을 둘지 결정 */
  verified: boolean;
};

export function verifyMeta(state?: VerifyState): VerifyMeta {
  switch (state) {
    case 'owner_verified':
      return {
        label: '사장님 검증',
        fg: BrandColors.mentionText,
        bg: BrandColors.mentionSoft,
        icon: '✓',
        dot: BrandColors.mention,
        verified: true,
      };
    case 'field_tested':
      return {
        label: '현장 검증',
        fg: BrandColors.mentionText,
        bg: BrandColors.mentionSoft,
        icon: '✓',
        dot: BrandColors.mention,
        verified: true,
      };
    default:
      return {
        label: '확인 필요',
        fg: InkColors.ink3,
        bg: InkColors.bgSoft,
        icon: '·',
        dot: InkColors.ink3,
        verified: false,
      };
  }
}
