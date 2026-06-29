/** 근무표(스케줄) 공용 날짜·요일 헬퍼. 주는 월요일 시작(한국 근무표 관행). */
import { todayStr } from '@/lib/utils/attendance';

/** 0=일 … 6=토 (Date.getDay() 인덱스). */
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 화면 노출 순서(월요일 시작). 근무표 편집·요일 칩에서 이 순서로 보여준다. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/** YYYY-MM-DD에 n일 더한 날짜 문자열. */
export function addDays(dateStr: string, n: number): string {
  return todayStr(new Date(toDate(dateStr).getTime() + n * 86400000));
}

/** 해당 날짜가 속한 주의 월요일(YYYY-MM-DD). */
export function mondayOf(dateStr: string): string {
  const d = toDate(dateStr);
  const dow = d.getDay(); // 0=일
  const diff = dow === 0 ? -6 : 1 - dow; // 일요일이면 6일 전 월요일로
  return addDays(dateStr, diff);
}

/** 월요일 기준 그 주의 7일(월~일) 날짜 배열. */
export function weekDates(mondayStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayStr, i));
}

/** 날짜의 요일 인덱스(0=일~6=토). */
export function weekdayOf(dateStr: string): number {
  return toDate(dateStr).getDay();
}

/** "6/30" 짧은 표기. */
export function fmtMd(dateStr: string): string {
  const d = toDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** "6월 30일 (화)" 풀 표기. */
export function fmtDateKo(dateStr: string): string {
  const d = toDate(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABELS[d.getDay()]})`;
}

/** "6/23~6/29" 주간 범위. */
export function fmtWeekRange(mondayStr: string): string {
  return `${fmtMd(mondayStr)}~${fmtMd(addDays(mondayStr, 6))}`;
}

/** from(포함) 이후 weekday(0~6)에 처음 해당하는 날짜. */
export function nextDateForWeekday(fromDateStr: string, weekday: number): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(fromDateStr, i);
    if (weekdayOf(d) === weekday) return d;
  }
  return fromDateStr;
}

/** 정기 휴무 요일 배열 → "월·화" 라벨. 없으면 '연중무휴'. */
export function closedDaysLabel(days: number[]): string {
  if (!days.length) return '연중무휴';
  return days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a as 1) - WEEKDAY_ORDER.indexOf(b as 1))
    .map((d) => WEEKDAY_LABELS[d])
    .join('·');
}
