// daypartLabels.ts — 데이파트(시간대) 라벨 해석 SSOT: 매장 커스텀 이름 vs 기본 폴백.
//
// 왜 별도 파일인가: 이 폴백 규칙(빈값·공백은 기본으로)이 useDaypartLabels 훅과 DaypartSettingsSheet
//   저장부 두 곳에 복제돼 있었다(AGENTS.md ② SSOT 위반). 한 곳으로 모으고, RN/zustand 의존이 없는
//   순수함수라 node 로 진리표를 회귀 테스트한다(scripts/qa-daypart-labels.mjs · npm run qa:daypart).

export type DaypartKey = 'open' | 'mid' | 'close' | 'etc';

/** 커스텀이 없을 때 쓰는 기본 시간대 이름. */
export const DEFAULT_DAYPART_LABELS: Record<DaypartKey, string> = {
  open: '오픈',
  mid: '미들',
  close: '마감',
  etc: '기타',
};

/**
 * 매장 커스텀 라벨(schedule_config.dayparts)을 기본값과 병합해 최종 4개 이름을 만든다.
 * 빈 문자열·공백만 입력은 "설정 안 함"으로 보고 기본 이름으로 폴백한다(trim 후 falsy → 기본).
 */
export function resolveDaypartLabels(
  dp: Partial<Record<DaypartKey, string>> | null | undefined,
): Record<DaypartKey, string> {
  return {
    open: dp?.open?.trim() || DEFAULT_DAYPART_LABELS.open,
    mid: dp?.mid?.trim() || DEFAULT_DAYPART_LABELS.mid,
    close: dp?.close?.trim() || DEFAULT_DAYPART_LABELS.close,
    etc: dp?.etc?.trim() || DEFAULT_DAYPART_LABELS.etc,
  };
}
