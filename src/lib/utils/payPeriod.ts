/**
 * 정산 기간(Q11 · PAY-02 · 2026-10-23). 급여 설정의 "정산 시작일"을 실제 기간으로 바꾼다.
 *
 * 규칙
 * - 기간 이름은 "끝나는 달"이다. 25일 시작이면 12월분 = 11/25~12/24. 달마다 기간이 정확히 하나라
 *   달 이동 화면(ym)을 그대로 쓸 수 있다.
 * - 29~31일 시작은 그 달 말일로 맞춘다(31일 시작 · 2월 → 2/28, 윤년 2/29).
 * - 컷오버(PAY_PERIOD_FROM = 이번 빌드 배포일) 뒤에 **시작하는** 기간부터 시작일을 쓴다.
 *   컷오버가 든 달은 이미 시작했으므로 달력 월 그대로다. 그다음 달 1일부터 첫 새 기간 전날까지가 전환 기간이다.
 *   (컷오버가 1일이면 그날부터 전환이다.)
 * - 시작일을 바꾸면 컷오버 뒤 기간은 전부 최신 시작일로 다시 나눈다(이력을 보지 않는다 · 사용자 결정 10-23).
 *   컷오버 앞 달력 월은 시작일과 무관하므로 절대 바뀌지 않는다.
 * - Q9 주휴 컷오버(PAYROLL_V2_FROM)와는 독립이다.
 */

/** ★배포 때 이 값만 배포일로 바꾼다(YYYY-MM-DD). */
export const PAY_PERIOD_FROM = '2026-10-24';

export type PayPeriod = { from: string; to: string; kind: 'calendar' | 'transition' | 'period'; ym: string };

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const clampDay = (n: number) => Math.max(1, Math.min(31, Math.round(n) || 1));
/** 그 달에 기간이 시작하는 날(말일 보정). */
const startIn = (ym: string, startDay: number) => `${ym}-${pad(Math.min(clampDay(startDay), lastDayOf(ym)))}`;
/** 시작일 규칙이 처음 적용되는 달. 컷오버가 1일이면 그 달, 아니면 다음 달. */
const ruleYm = (cutover: string) => (cutover.endsWith('-01') ? cutover.slice(0, 7) : shiftYm(cutover.slice(0, 7), 1));

/** ym월분 정산 기간. */
export function payPeriodFor(ym: string, startDay: number, cutover: string = PAY_PERIOD_FROM): PayPeriod {
  const s = clampDay(startDay);
  const first = ruleYm(cutover);
  const calendar = { from: `${ym}-01`, to: `${ym}-${pad(lastDayOf(ym))}`, ym };
  if (ym < first) return { ...calendar, kind: 'calendar' };
  if (s === 1) return { ...calendar, kind: 'period' };
  if (ym === first) return { from: `${ym}-01`, to: dayBefore(startIn(ym, s)), kind: 'transition', ym };
  return { from: startIn(shiftYm(ym, -1), s), to: dayBefore(startIn(ym, s)), kind: 'period', ym };
}

/** 그 날짜가 든 기간의 이름(ym). 오늘 → "이번 정산 기간". */
export function payLabelOf(date: string, startDay: number, cutover: string = PAY_PERIOD_FROM): string {
  const ym = date.slice(0, 7);
  return date <= payPeriodFor(ym, startDay, cutover).to ? ym : shiftYm(ym, 1);
}

/** 기간 끝(periodTo) 뒤 처음 오는 지급일. 29~31일은 그 달 말일로 맞춘다. */
export function paydayAfter(periodTo: string, payday: number): string {
  const ym = periodTo.slice(0, 7);
  const here = startIn(ym, payday);
  return here > periodTo ? here : startIn(shiftYm(ym, 1), payday);
}

/** "11월 25일~12월 24일" */
export function fmtPeriodRange(p: { from: string; to: string }): string {
  const f = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
  return `${f(p.from)}~${f(p.to)}`;
}
