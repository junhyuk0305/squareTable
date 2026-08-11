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

/** "07:00"→"7", "07:30"→"7:30". 좁은 그리드 칸에서 시각을 짧게. */
export function hourLabel(t: string): string {
  const [h, m] = t.split(':');
  const hh = String(Number(h));
  return m === '00' ? hh : `${hh}:${m}`;
}

/** "07:00"~"13:00" → "7-13". 요일 그리드 칩의 시간 표기. */
export function compactRange(start: string, end: string): string {
  return `${hourLabel(start)}-${hourLabel(end)}`;
}

/** "13:00" + "19:00" → "13:00 ~ 19:00". 근무 시각 표준 표기(좁은 칸의 짧은 표기는 compactRange). */
export function fmtRange(start: string, end: string): string {
  return `${start} ~ ${end}`;
}

/** 자정을 넘기는 근무(22:00~02:00)를 음수로 만들지 않기 위한 하루 분(分). */
const MINUTES_PER_DAY = 1440;

/** "07:30" → 450(분). */
export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 450(분) → "07:30". 24시를 넘으면 다음 날로 돈다. */
export function fmtMinutes(min: number): string {
  const m = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 근무 길이(분). 자정을 넘기면 하루를 더한다. */
export function shiftMinutes(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return diff < 0 ? diff + MINUTES_PER_DAY : diff;
}

/** "6시간" · "6.5시간". */
export function hoursLabel(min: number): string {
  return `${Math.round((min / 60) * 10) / 10}시간`;
}

/** HH:MM 입력 검사 — 근무 시각 유효성의 SSOT(근무표 편집 시트가 공유한다). */
export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function isValidShiftTime(start: string, end: string): boolean {
  return TIME_RE.test(start) && TIME_RE.test(end) && start < end;
}

/** 하루 타임라인의 시간 창(분). 자정을 넘겨 닫는 매장은 close에 하루를 더해 편다. */
export type DayWindow = { from: number; to: number };

/** 심야영업(자정 넘겨 닫음) 매장에서, 개점 시각보다 이른 근무는 '다음 날 새벽'으로 편다. */
function startMinutes(start: string, openMin: number, overnight: boolean): number {
  const s = toMinutes(start);
  return overnight && s < openMin ? s + MINUTES_PER_DAY : s;
}

/**
 * 하루 타임라인이 덮어야 할 시간 창 — 운영시간 **과** 그날 실제 근무를 모두 담는다.
 *
 * ★운영시간만으로 자르지 않는다: 개점 전 준비·마감 후 정리처럼 운영시간 밖 근무가 흔하고
 *   (2026-08-11 실측 피드백), 잘라내면 그 근무가 축 끝에 붙어 길이가 거짓이 된다.
 */
export function dayWindow(
  shifts: { start: string; end: string }[],
  open: string,
  close: string,
): DayWindow {
  const openMin = toMinutes(open);
  let closeMin = toMinutes(close);
  if (closeMin <= openMin) closeMin += MINUTES_PER_DAY;
  const overnight = closeMin > MINUTES_PER_DAY;

  let from = openMin;
  let to = closeMin;
  for (const sh of shifts) {
    const s = startMinutes(sh.start, openMin, overnight);
    const e = s + shiftMinutes(sh.start, sh.end);
    if (s < from) from = s;
    if (e > to) to = e;
  }
  return { from, to };
}

/** 창 안에서 근무 구간이 차지하는 비율. dayWindow가 근무를 이미 품으므로 잘리지 않는다. */
export function spanIn(
  win: DayWindow,
  start: string,
  end: string,
  open: string,
  close: string,
): { left: number; width: number } {
  const openMin = toMinutes(open);
  let closeMin = toMinutes(close);
  if (closeMin <= openMin) closeMin += MINUTES_PER_DAY;
  const s = startMinutes(start, openMin, closeMin > MINUTES_PER_DAY);
  const len = Math.max(win.to - win.from, 1);
  return { left: (s - win.from) / len, width: shiftMinutes(start, end) / len };
}

/** YYYY-MM-DD의 '일(day-of-month)' 숫자. */
export function dayOfMonth(dateStr: string): number {
  return toDate(dateStr).getDate();
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
