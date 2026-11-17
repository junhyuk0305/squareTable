/**
 * 출근 기록 화면의 판정(화면조립표 2026-11-17 11절 2번·4번). 사장이 보는 직원 한 명 출근 기록과
 * 직원 내 출근 기록이 같은 부품(TimesheetView)으로 이 판정 하나를 쓴다. 순수 함수다.
 * 검사 = scripts/qa-attendance-screen-plans.mjs.
 */

export type TimesheetTab = 'records' | 'mismatch';

/**
 * - counts: 맨 위 칸 고르기 [날짜별 기록 n | 근무표와 다른 날 n] 의 숫자. 달을 다 읽기 전에는 0(세지 않는다).
 * - fab: 오른쪽 아래 떠 있는 노란 [출근 기록 추가]. 날짜별 기록 칸에서, 기록이 1개 이상이고 추가 칸이 닫혀 있을 때만.
 * - emptyAdd: 기록이 0개면 떠 있는 버튼 대신 빈 상태의 노란 버튼이 같은 일을 한다(11절 2번 보충).
 */
export function timesheetPlan(v: {
  tab: TimesheetTab;
  monthReady: boolean;
  records: number;
  mismatches: number;
  adding: boolean;
}): { counts: { records: number; mismatch: number }; fab: boolean; emptyAdd: boolean } {
  const counts = v.monthReady ? { records: v.records, mismatch: v.mismatches } : { records: 0, mismatch: 0 };
  const onRecords = v.tab === 'records' && v.monthReady && !v.adding;
  return { counts, fab: onRecords && v.records > 0, emptyAdd: onRecords && v.records === 0 };
}
