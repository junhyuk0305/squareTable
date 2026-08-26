/**
 * 급여 계산 엔진 (SSOT) — 지금까지 "급여 설정"(주휴수당·휴게공제·야간·연장·추가수당)이 UI에만 있고
 * 계산엔 하나도 반영되지 않아, 모든 급여가 단순 (근로분 × 시급)으로 표시되던 문제(F1 CRITICAL)를 해소.
 * 화면들은 각자 raw 공식을 쓰지 말고 반드시 computePay()를 호출한다(단일 진실원천).
 *
 * 규칙(2026-07-06 확정 · 토글 ON일 때만 각 항목 적용 — 사장이 사업장 규모/관행에 맞게 On/Off):
 *  - 휴게공제(§54): **하루 합계** 근로가 8h↑이면 60분, 4h↑이면 30분 무급 공제(유급분에서 제외).
 *    ★2026-08-26 변경: 예전엔 **근무 1건마다** 계산해, 같은 하루 6시간인데 기록이 1건이면 휴게 30분이
 *    빠지고 3+3 두 건이면 0 분이 빠져 **지급액이 달라졌다**. 근로기준법 §54 는 "1일 근로시간" 기준이다.
 *    → 하루에 출퇴근을 두 번 이상 찍는 직원의 지급액이 **줄어든다**. 화면이 그 이유를 말해야 한다.
 *  - 야간수당: 22:00–06:00(KST)에 겹치는 근로분에 +0.5배 가산.
 *  - 연장수당: 하루 유급 8h 초과분에 +0.5배 가산(일 단위 집계).
 *  - 주휴수당: 한 주 유급 15h↑이면 (min(주근로,40)/40)×8×시급. ※개근 요건은 근무기록만으론 판정 불가라
 *             '주 15h 이상'으로 근사한다(스케줄 연동 시 개근 판정 추가 예정).
 *  - 추가수당: 월 정액 그대로 합산. 기본급은 30분 단위 절삭(payableMinutes) — 기존 정산 관행 유지.
 *  - 가산(야간/연장)은 정밀분으로 계산(절삭 안 함). 5인 미만 의무 아님 → 토글로 사장이 결정.
 */
import { minutesBetween, payableMinutes, nowISO, MAX_SHIFT_MIN } from './attendance';
import { addDays, fmtDateKo, fmtMinutes, isOvernight, shiftMinutes, toMinutes } from './schedule';

export type PayrollRules = {
  breakDeduction: boolean;
  nightAllowance: boolean;
  overtimeAllowance: boolean;
  weeklyHolidayPay: boolean;
  extraAllowance: number; // 월 정액(원)
};

// 구조적 타입 — store 순환 의존 없이 어디서나 재사용(liveMinutes 패턴과 동일).
export type PayRecord = {
  date: string;              // "YYYY-MM-DD"
  check_in: string | null;   // ISO
  check_out: string | null;  // ISO
  work_minutes: number;
};

export type PayBreakdown = {
  workedMin: number;         // 총 근로(분, 24h 절상 후)
  paidMin: number;           // 휴게공제 후 유급(분)
  breakMin: number;          // 무급 휴게 공제(분) — 금액이 줄면 화면이 이유를 말할 수 있게 밖으로 낸다
  nightMin: number;          // 야간 겹침(분)
  overtimeMin: number;       // 연장(일 8h 초과, 분)
  base: number;              // 기본급(30분 절삭)
  nightPay: number;          // 야간 가산(+0.5)
  overtimePay: number;       // 연장 가산(+0.5)
  weeklyHolidayPay: number;  // 주휴수당
  extra: number;             // 추가수당(월 정액)
  total: number;             // 합계(세전)
};

const H = 60;
const KST_OFFSET_MS = 9 * 3600 * 1000;

/**
 * 한 근무의 실제 근로분. 24h 절상.
 *  - 퇴근함: 확정 work_minutes(없으면 in↔out).
 *  - 진행 중(미퇴근): 출근시각↔now 실시간 경과(liveMinutes와 동일) — '예상' 화면들이 진행 중 근무를
 *    반영하도록. now 를 주입받아 테스트 결정성 확보.
 */
function shiftWorkedMin(r: PayRecord, nowISO: string): number {
  if (!r.check_in) return 0;
  const out = r.check_out ?? nowISO;
  const min = r.check_out && r.work_minutes ? r.work_minutes : minutesBetween(r.check_in, out);
  return Math.min(MAX_SHIFT_MIN, min);
}

/** 휴게 공제(무급) 분 — §54: **하루 합계** 8h↑ 60분, 4h↑ 30분. */
function breakMinFor(workedMin: number): number {
  if (workedMin >= 8 * H) return 60;
  if (workedMin >= 4 * H) return 30;
  return 0;
}

/** 한 근무가 22:00–06:00(KST)와 겹치는 분. 자정/멀티데이 넘김도 분 단위로 정확히 집계. 진행 중이면 now 까지. */
function nightMinFor(r: PayRecord, nowISO: string): number {
  if (!r.check_in) return 0;
  const start = new Date(r.check_in).getTime();
  const end = new Date(r.check_out ?? nowISO).getTime();
  if (!(end > start)) return 0;
  let night = 0;
  // 분 단위 스텝(한 근무 최대 24h=1440스텝) — 야간창(22–24, 0–6)을 KST 시각으로 판정해 정확·명료.
  for (let t = start; t < end; t += 60000) {
    const kstHour = Math.floor((t + KST_OFFSET_MS) / 3600000) % 24;
    if (kstHour >= 22 || kstHour < 6) night += 1;
  }
  return Math.min(night, MAX_SHIFT_MIN);
}

/** KST 기준 ISO주(월요일 시작) 키 "YYYY-Www". 주휴 집계용. */
function kstWeekKey(dateStr: string): string {
  // dateStr("YYYY-MM-DD")를 KST 자정 기준으로 해석 → 그 주 월요일.
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const dow = (k.getUTCDay() + 6) % 7; // 월=0
  k.setUTCDate(k.getUTCDate() - dow);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 급여의 **기준은 근무표**다 (2026-08-26 사용자 확정)
//
// 사용자 원문: "출퇴근 찍는 것은 그것의 확인용임 … 최종은 근무표에 입력한 내용대로 계산되도록."
// → 출퇴근 기록은 **급여 계산에 직접 들어가지 않는다.** 대조(확인)에만 쓴다.
//
// ★규칙 자체(30분 절삭·휴게·야간·연장·주휴)는 computePay 그대로 재사용한다. 바뀌는 것은 **입력 소스**뿐이다.
//   규칙을 여기에 다시 쓰면 두 벌이 되고, 한쪽만 고치는 순간 금액이 갈라진다.
// ═══════════════════════════════════════════════════════════════════════════

/** 근무표 한 칸 — 그 날짜에 그 사람이 서기로 된 근무. */
export type ScheduledShift = { date: string; start: string; end: string };

/**
 * 근무표 시프트 → computePay 입력.
 * 자정을 넘기면 **퇴근을 다음 날로** 붙인다(감사 #43 에서 합친 규칙) — 안 그러면 근무가 0분이 된다.
 * 급여의 날짜 귀속은 **출근일**이다(작업 7 과 같은 축).
 */
export function shiftsToPayRecords(shifts: ScheduledShift[]): PayRecord[] {
  return shifts.map((sh) => {
    const outDate = isOvernight(sh.start, sh.end) ? addDays(sh.date, 1) : sh.date;
    return {
      date: sh.date,
      check_in: nowISO(sh.date, sh.start),
      check_out: nowISO(outDate, sh.end),
      work_minutes: shiftMinutes(sh.start, sh.end),
    };
  });
}

/** 근무표와 출퇴근 기록이 이만큼(분) 넘게 어긋나면 화면이 말한다. 이 제품은 30분 단위로 절삭한다. */
export const RECONCILE_THRESHOLD_MIN = 30;

export type ShiftMismatch = {
  date: string;
  kind: 'no_schedule' | 'no_record' | 'time_diff';
  /** 화면에 그대로 띄우는 문장. */
  message: string;
};

/** ISO → 그날 KST 벽시계 분(자정 넘김이면 1440 이상). 대조 전용. */
function kstMinOfDay(iso: string, baseDate: string): number {
  const base = new Date(`${baseDate}T00:00:00+09:00`).getTime();
  return Math.round((new Date(iso).getTime() - base) / 60000);
}

/**
 * 근무표 vs 출퇴근 기록 대조 — **어긋난 것만** 돌려준다.
 *
 * 경계 케이스(2026-08-26 사용자 확정):
 *  · 근무표에 **없는 날** 출근을 찍음 → 급여에 **안 들어간다**. 근무표에 추가하라고 말한다.
 *  · 근무표엔 **있는데** 출근을 안 찍음 → 급여에 **들어간다**(근무표가 기준, 출퇴근은 참고용).
 * 같은 날 근무가 여러 개면 시작 시각 순으로 짝지어 비교한다.
 */
export function reconcileSchedule(
  shifts: ScheduledShift[],
  records: PayRecord[],
): ShiftMismatch[] {
  const byDate = new Map<string, { sh: ScheduledShift[]; rec: PayRecord[] }>();
  for (const sh of shifts) {
    const e = byDate.get(sh.date) ?? { sh: [], rec: [] };
    e.sh.push(sh);
    byDate.set(sh.date, e);
  }
  for (const r of records) {
    if (!r.check_in) continue;
    const e = byDate.get(r.date) ?? { sh: [], rec: [] };
    e.rec.push(r);
    byDate.set(r.date, e);
  }

  const out: ShiftMismatch[] = [];
  for (const [date, { sh, rec }] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const shifts_ = [...sh].sort((a, b) => a.start.localeCompare(b.start));
    const recs = [...rec].sort((a, b) => (a.check_in ?? '').localeCompare(b.check_in ?? ''));
    if (shifts_.length === 0) {
      out.push({ date, kind: 'no_schedule', message: `${fmtDateKo(date)}은 근무표에 없는 근무예요. 근무표에 추가해 주세요.` });
      continue;
    }
    if (recs.length === 0) {
      out.push({ date, kind: 'no_record', message: `${fmtDateKo(date)} 근무는 출퇴근을 안 찍었어요. 급여는 근무표 기준으로 계산돼요.` });
      continue;
    }
    for (let i = 0; i < Math.min(shifts_.length, recs.length); i++) {
      const s = shifts_[i];
      const r = recs[i];
      const planIn = toMinutes(s.start);
      const planOut = planIn + shiftMinutes(s.start, s.end);
      const realIn = kstMinOfDay(r.check_in!, date);
      if (Math.abs(realIn - planIn) >= RECONCILE_THRESHOLD_MIN) {
        out.push({
          date,
          kind: 'time_diff',
          message: `${fmtDateKo(date)} 근무표는 ${s.start} 출근인데 ${fmtMinutes(realIn)}에 출근을 찍었어요. 근무표를 고쳐 주세요.`,
        });
      }
      if (r.check_out) {
        const realOut = kstMinOfDay(r.check_out, date);
        if (Math.abs(realOut - planOut) >= RECONCILE_THRESHOLD_MIN) {
          out.push({
            date,
            kind: 'time_diff',
            message: `${fmtDateKo(date)} 근무표는 ${s.end} 퇴근인데 ${fmtMinutes(realOut)}에 퇴근을 찍었어요. 근무표를 고쳐 주세요.`,
          });
        }
      }
    }
    if (recs.length > shifts_.length) {
      out.push({ date, kind: 'no_schedule', message: `${fmtDateKo(date)}에 근무표보다 출퇴근 기록이 많아요. 근무표를 확인해 주세요.` });
    }
  }
  return out;
}

/**
 * 한 직원의 (기간 내) 근무기록 + 시급 + 규칙 → 급여 내역.
 * records 는 이미 원하는 정산기간으로 필터된 것을 넘긴다(기간 산정은 호출부에서).
 */
export function computePay(records: PayRecord[], wage: number, rules: PayrollRules, nowISO?: string): PayBreakdown {
  const now = nowISO ?? new Date().toISOString();
  let workedMin = 0;
  let paidMin = 0;
  let breakMin = 0;
  let nightMin = 0;
  const dayWorked: Record<string, number> = {};  // 일별 **근로**분 — 휴게는 여기서 한 번만 뗀다
  const dayPaid: Record<string, number> = {};    // 일별 유급분(연장 집계)
  const weekPaid: Record<string, number> = {};   // 주별 유급분(주휴 집계)

  // ── 1차: 근무 건별 집계 ──────────────────────────────────────────────
  // 야간(nightMin)만 건별로 정확히 센다 — 22:00–06:00 과의 **구간 겹침**이라 하루 합계로는 못 바꾼다.
  for (const r of records) {
    const worked = shiftWorkedMin(r, now);
    if (worked <= 0) continue;
    workedMin += worked;
    if (rules.nightAllowance) nightMin += nightMinFor(r, now);
    dayWorked[r.date] = (dayWorked[r.date] ?? 0) + worked;
  }

  // ── 2차: 날짜마다 **한 번만** 휴게를 뗀다(§54 = 1일 근로시간 기준) ────
  // ⚠️ 자정을 넘는 근무를 어느 날에 넣을지는 r.date 기준 그대로다 — 여기서 바꾸지 않는다.
  for (const [date, worked] of Object.entries(dayWorked)) {
    const brk = rules.breakDeduction ? breakMinFor(worked) : 0;
    const paid = Math.max(0, worked - brk);
    breakMin += brk;
    paidMin += paid;
    dayPaid[date] = paid;
    weekPaid[kstWeekKey(date)] = (weekPaid[kstWeekKey(date)] ?? 0) + paid;
  }

  // 연장: 하루 유급 8h 초과분 합.
  let overtimeMin = 0;
  if (rules.overtimeAllowance) {
    for (const m of Object.values(dayPaid)) overtimeMin += Math.max(0, m - 8 * H);
  }

  const base = Math.round((payableMinutes(paidMin) * wage) / H);           // 기본급(30분 절삭)
  const nightPay = Math.round((nightMin * wage * 0.5) / H);                 // 야간 +0.5
  const overtimePay = Math.round((overtimeMin * wage * 0.5) / H);          // 연장 +0.5

  // 주휴: 주 유급 15h↑ → (min(주,40)/40)×8×시급.
  let weeklyHolidayPay = 0;
  if (rules.weeklyHolidayPay) {
    for (const m of Object.values(weekPaid)) {
      const weekH = m / H;
      if (weekH >= 15) weeklyHolidayPay += Math.round((Math.min(weekH, 40) / 40) * 8 * wage);
    }
  }

  const extra = Math.max(0, Math.round(rules.extraAllowance || 0));
  const total = base + nightPay + overtimePay + weeklyHolidayPay + extra;
  return { workedMin, paidMin, breakMin, nightMin, overtimeMin, base, nightPay, overtimePay, weeklyHolidayPay, extra, total };
}
