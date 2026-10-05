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

/** HH:MM 입력 검사 — 근무 시각 유효성의 SSOT(근무표 편집 시트·출퇴근 기록 보정이 공유한다). */
export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** 퇴근 시각이 자정을 넘겨 **다음 날**인가. 심야 근무(22:00~02:00) 판정의 SSOT. */
export function isOvernight(start: string, end: string): boolean {
  return toMinutes(end) < toMinutes(start);
}

/**
 * 근무 시각 검증의 SSOT — 유효하면 null, 아니면 화면에 그대로 띄울 사유.
 *
 * ★퇴근<출근은 오류가 아니라 **다음 날**이다(심야 매장). `shiftMinutes`·`dayWindow`·
 *   `workers_at`(0138)은 처음부터 자정 넘김을 계산하고 있었고 **입력 검사만 막고 있었다**(감사 #43).
 *   그래서 밤 10시~새벽 2시 근무를 아예 넣을 수 없었다.
 * 무효는 **근무 0분(start === end)** 뿐이다 — 길이 상한은 자정 넘김 해석상 구조적으로
 *   최대 1439분이라(`shiftMinutes`) 따로 검사하지 않는다.
 */
export function checkShiftTime(start: string, end: string): string | null {
  if (!TIME_RE.test(start)) return '출근 시간을 09:00 처럼 넣어 주세요.';
  if (!TIME_RE.test(end)) return '퇴근 시간을 18:00 처럼 넣어 주세요.';
  if (toMinutes(start) === toMinutes(end)) return '출근과 퇴근 시간이 같아요. 근무 시간이 0분이에요.';
  return null;
}

export function isValidShiftTime(start: string, end: string): boolean {
  return checkShiftTime(start, end) === null;
}

/** 근무를 조각으로 쪼갠 결과 한 칸. mine=true 면 원래 담당자 몫, false 면 넘겨받는 사람 몫. */
export type ShiftPiece = { start: string; end: string; mine: boolean };

/**
 * 근무의 **일부 구간만** 넘길 때 생기는 조각들. 구간이 근무 밖이거나 0분이면 null.
 *
 * ★조각은 2개가 아니라 **3개**가 될 수 있다 — 가운데를 떼면 앞(원래)·가운데(받는 사람)·뒤(원래).
 *   가운데를 빠뜨리면 근무가 통째로 사라지거나 겹친다.
 * 자정 넘김은 `shiftMinutes` 규칙을 그대로 따른다(끝이 시작보다 이르면 다음 날).
 *
 * ⚠️ 서버에도 같은 판정이 있다(`transfer_shift`/`shift_span_min`, 0179). 규칙을 두 벌 두려는 게 아니라
 *    **서버가 무결성 경계**라서다 — 클라가 보낸 구간이 근무 안에 있는지는 클라 말을 믿을 수 없다.
 *    여기 것은 화면 미리보기와 저장 전 차단용이고, 최종 판정은 서버가 한다.
 */
export function splitShift(
  baseStart: string,
  baseEnd: string,
  partStart: string,
  partEnd: string,
): ShiftPiece[] | null {
  const total = shiftMinutes(baseStart, baseEnd);
  const offset = shiftMinutes(baseStart, partStart);
  const length = shiftMinutes(partStart, partEnd);
  if (length === 0 || offset + length > total) return null; // 0분이거나 근무 밖
  const out: ShiftPiece[] = [];
  if (offset > 0) out.push({ start: baseStart, end: partStart, mine: true });
  out.push({ start: partStart, end: partEnd, mine: false });
  if (offset + length < total) out.push({ start: partEnd, end: baseEnd, mine: true });
  return out;
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

/** "YYYY-MM" 의 모든 날짜(YYYY-MM-DD). 급여·근무표 월 집계의 날짜 축. */
export function monthDates(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 다음 달 0일 = 이번 달 마지막 날
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
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

/**
 * 근무 한 칸이 그날 서는지 판정하는 데 필요한 모양(0242).
 * 기간 칸이 없으면(옛 데이터·데모·허브 v1) 기간 제한이 없는 것으로 본다.
 */
export type DatedShift = {
  weekday: number | null;
  date: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

/**
 * 이 근무가 그날 서는가 — 날짜 지정은 그 날짜, 반복은 요일과 적용 기간(valid_from ~ valid_to)(0242).
 * 서버 `workers_at`·`request_shift_time` 과 같은 규칙이다. 그날 예외(0178)는 shiftsOn 이 따로 본다.
 * ★기간을 안 보면 지난 구간 복사본과 원래 행이 둘 다 잡혀 그 주 근무가 두 벌이 되고 급여도 두 배가 된다.
 */
export function shiftAppliesOn(t: DatedShift, date: string): boolean {
  if (t.date) return t.date === date;
  if (t.weekday !== weekdayOf(date)) return false;
  if (t.valid_from && date < t.valid_from) return false;
  if (t.valid_to && date > t.valid_to) return false;
  return true;
}

/**
 * 반복 근무 저장 한 건. edit = 그 행을 from 부터 고친다. end = 그 행을 from 부터 그만둔다(from 이 시작일 이하면 서버가 지운다).
 * add = from 부터 새로 넣고, endBefore 가 있으면 그 전날로 닫는다.
 */
export type SeriesSaveOp =
  | { kind: 'edit'; id: string; from: string }
  | { kind: 'end'; id: string; from: string }
  | { kind: 'add'; weekday: number; from: string; endBefore?: string };

type SeriesRow = DatedShift & { id: string; staff_id: string; start: string; end: string };

/**
 * 같은 직원·같은 요일 반복 중 date 뒤에 시작하는 행. "이 날부터 계속"으로 나눠 저장하면 한 요일이 여러 행이 된다.
 * "이 날부터"는 이 뒤 구간까지 바꾼다. 안 바꾸면 뒤 구간이 그 날부터 옛 시각으로 다시 선다.
 */
function laterSegments(templates: SeriesRow[], staffId: string, weekday: number, date: string): SeriesRow[] {
  return templates
    .filter((t) => t.staff_id === staffId && !t.date && t.weekday === weekday && (t.valid_from ?? '') > date)
    .sort((a, b) => (a.valid_from ?? '').localeCompare(b.valid_from ?? ''));
}

/**
 * 반복 근무 저장 계획 — "이 직원의 한 요일 반복은 하나"를 **그 요일 첫 날에 적용 중인 행** 기준으로 판정한다(0242).
 * from = date(포함) 이후 그 요일의 첫 날이다.
 *  · 그날 적용 중인 행이 있으면 그 행을 from 부터 고친다. 뒤 구간도 각자 시작일부터 고친다. 시각이 같으면 건너뛴다.
 *  · 없으면 새로 넣는다. 끝난 행은 기록이라 고치지 않는다.
 *  · 그 뒤에 시작하는 행이 이미 있으면 새 행을 그 전날로 닫는다. 안 닫으면 그날부터 근무가 두 벌이 된다.
 */
export function planSeriesSave(
  templates: SeriesRow[],
  staffId: string,
  weekdays: number[],
  date: string,
  start: string,
  end: string,
): SeriesSaveOp[] {
  const ops: SeriesSaveOp[] = [];
  for (const wd of weekdays) {
    const from = nextDateForWeekday(date, wd);
    const series = templates.filter((t) => t.staff_id === staffId && !t.date && t.weekday === wd);
    const live = series.find((t) => shiftAppliesOn(t, from));
    if (live) {
      for (const t of [live, ...laterSegments(templates, staffId, wd, from)]) {
        if (t.start !== start || t.end !== end) ops.push({ kind: 'edit', id: t.id, from: t === live ? from : t.valid_from! });
      }
      continue;
    }
    const later = series
      .map((t) => t.valid_from ?? '')
      .filter((v) => v > from)
      .sort()[0];
    ops.push(later ? { kind: 'add', weekday: wd, from, endBefore: later } : { kind: 'add', weekday: wd, from });
  }
  return ops;
}

/**
 * 사장 근무 시트의 "이 날부터 계속"(times) · "이 날부터 그만"(null) 계획. 누른 행은 date 부터, 같은 직원·요일의 뒤 구간은 각자 시작일부터다.
 * 날짜 지정 근무는 누른 행 하나다.
 */
export function planFromScope(
  templates: SeriesRow[],
  id: string,
  date: string,
  times: { start: string; end: string } | null,
): SeriesSaveOp[] {
  const kind = times ? 'edit' : 'end';
  const ops: SeriesSaveOp[] = [{ kind, id, from: date }];
  const row = templates.find((t) => t.id === id);
  if (!row || row.date || row.weekday === null) return ops;
  for (const t of laterSegments(templates, row.staff_id, row.weekday, date)) {
    if (times && t.start === times.start && t.end === times.end) continue;
    ops.push({ kind, id: t.id, from: t.valid_from! });
  }
  return ops;
}

/** 반복 근무 RPC(db.ts 래퍼). runSeriesOps 가 이 순서로 부른다. */
export type SeriesApi = {
  add: (staffId: string, weekday: number, from: string, start: string, end: string, confirmPast: boolean) => Promise<string | null>;
  edit: (id: string, from: string, start: string, end: string, confirmPast: boolean) => Promise<boolean>;
  end: (id: string, from: string, confirmPast: boolean) => Promise<boolean>;
};

/**
 * 저장 계획을 차례로 보낸다. 하나가 실패하면 거기서 멈추고 false 다(앞 단계는 이미 저장됐다).
 * ★새 행을 나중 행 앞에서 닫을 때도 사장이 확인한 confirmPast 를 넘긴다. 닫는 날이 지난 날짜면 서버가 확인을 요구한다.
 *   닫기가 실패하면 방금 넣은 행을 시작일부터 그만둔다(= 지운다). 남기면 그날부터 매주 근무가 두 벌이고 급여도 두 배다.
 */
export async function runSeriesOps(
  api: SeriesApi,
  staffId: string,
  ops: SeriesSaveOp[],
  start: string,
  end: string,
  confirmPast: boolean,
): Promise<boolean> {
  for (const op of ops) {
    if (op.kind === 'edit') {
      if (!(await api.edit(op.id, op.from, start, end, confirmPast))) return false;
      continue;
    }
    if (op.kind === 'end') {
      if (!(await api.end(op.id, op.from, confirmPast))) return false;
      continue;
    }
    const id = await api.add(staffId, op.weekday, op.from, start, end, confirmPast);
    if (!id) return false;
    if (op.endBefore && !(await api.end(id, op.endBefore, confirmPast))) {
      await api.end(id, op.from, confirmPast);
      return false;
    }
  }
  return true;
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

/** 교대 승인 판정에 필요한 요청 모양. 스토어 타입(SwapRequest)을 끌어오지 않으려고 필요한 칸만 적는다. */
export type SwapLike = {
  kind: string;
  status: string;
  requester_id: string;
  accepted_by?: string;
  date: string;
  target_date?: string;
};

/** 지난 교대를 승인할 수 있는 기간(일). 서버 approve_swap(0242)의 `kst_today() - 35` 와 같다. */
export const PAST_SWAP_DAYS = 35;

/** 교대 하나가 실제로 옮기는 근무들. 날짜 · 원래 담당자 · 받는 사람. 서버 approve_swap 의 두 transfer_shift 와 같은 순서다. */
function swapLegs(r: SwapLike): { date: string; from: string; to: string }[] {
  const legs = [{ date: r.date, from: r.requester_id, to: r.accepted_by ?? '' }];
  if (r.kind === 'swap' && r.target_date) legs.push({ date: r.target_date, from: r.accepted_by ?? '', to: r.requester_id });
  return legs;
}

/**
 * 사장 승인만 남은 교대인가(Q10). 직원끼리 수락(accepted)이 끝났고, 가장 이른 근무일이 오늘-35일 이후다.
 * 서버 approve_swap 이 같은 경계로 거부하므로 그보다 오래된 요청은 목록에 두지 않는다.
 */
export function swapApprovable(r: SwapLike, today: string): boolean {
  if (r.status !== 'accepted') return false;
  const earliest = swapLegs(r).reduce((min, l) => (l.date < min ? l.date : min), r.date);
  return earliest >= addDays(today, -PAST_SWAP_DAYS);
}

/**
 * 지난 근무가 든 교대를 승인하기 전 확인창(Q10). 지난 근무가 없으면 null 이다.
 * 승인하면 그 근무 급여가 받는 사람에게 간다. 원래 담당자가 그날 출근을 찍었으면 경고를 더한다(clockedIn).
 * 확인창을 거쳤으면 서버에 p_confirm_past=true 를 보낸다.
 */
export function pastSwapNotice(
  r: SwapLike,
  today: string,
  nameOf: (id: string) => string,
  records: { staff_id: string; date: string }[],
): { title: string; message: string; clockedIn: boolean } | null {
  const past = swapLegs(r).filter((l) => l.date < today);
  if (past.length === 0) return null;
  const head = past.length === 1
    ? `승인하면 이 근무 급여가 ${nameOf(past[0].to)}님에게 가요.`
    : '승인하면 두 근무 급여가 서로 바뀌어요.';
  const clocked = past.filter((l) => records.some((rec) => rec.staff_id === l.from && rec.date === l.date));
  const warn = clocked.map((l) => `${nameOf(l.from)}님이 그날 출근을 찍었어요. 누가 일했는지 확인해 주세요.`);
  return { title: '지난 근무예요', message: [head, ...warn].join('\n\n'), clockedIn: clocked.length > 0 };
}
