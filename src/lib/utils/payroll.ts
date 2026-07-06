/**
 * 급여 계산 엔진 (SSOT) — 지금까지 "급여 설정"(주휴수당·휴게공제·야간·연장·추가수당)이 UI에만 있고
 * 계산엔 하나도 반영되지 않아, 모든 급여가 단순 (근로분 × 시급)으로 표시되던 문제(F1 CRITICAL)를 해소.
 * 화면들은 각자 raw 공식을 쓰지 말고 반드시 computePay()를 호출한다(단일 진실원천).
 *
 * 규칙(2026-07-06 확정 · 토글 ON일 때만 각 항목 적용 — 사장이 사업장 규모/관행에 맞게 On/Off):
 *  - 휴게공제(§54): 한 번 근무가 8h↑이면 60분, 4h↑이면 30분 무급 공제(유급분에서 제외).
 *  - 야간수당: 22:00–06:00(KST)에 겹치는 근로분에 +0.5배 가산.
 *  - 연장수당: 하루 유급 8h 초과분에 +0.5배 가산(일 단위 집계).
 *  - 주휴수당: 한 주 유급 15h↑이면 (min(주근로,40)/40)×8×시급. ※개근 요건은 근무기록만으론 판정 불가라
 *             '주 15h 이상'으로 근사한다(스케줄 연동 시 개근 판정 추가 예정).
 *  - 추가수당: 월 정액 그대로 합산. 기본급은 30분 단위 절삭(payableMinutes) — 기존 정산 관행 유지.
 *  - 가산(야간/연장)은 정밀분으로 계산(절삭 안 함). 5인 미만 의무 아님 → 토글로 사장이 결정.
 */
import { minutesBetween, payableMinutes, MAX_SHIFT_MIN } from './attendance';

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

/** 휴게 공제(무급) 분 — §54: 8h↑ 60분, 4h↑ 30분. */
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

/**
 * 한 직원의 (기간 내) 근무기록 + 시급 + 규칙 → 급여 내역.
 * records 는 이미 원하는 정산기간으로 필터된 것을 넘긴다(기간 산정은 호출부에서).
 */
export function computePay(records: PayRecord[], wage: number, rules: PayrollRules, nowISO?: string): PayBreakdown {
  const now = nowISO ?? new Date().toISOString();
  let workedMin = 0;
  let paidMin = 0;
  let nightMin = 0;
  const dayPaid: Record<string, number> = {};   // 일별 유급분(연장 집계)
  const weekPaid: Record<string, number> = {};   // 주별 유급분(주휴 집계)

  for (const r of records) {
    const worked = shiftWorkedMin(r, now);
    if (worked <= 0) continue;
    const brk = rules.breakDeduction ? breakMinFor(worked) : 0;
    const paid = Math.max(0, worked - brk);
    workedMin += worked;
    paidMin += paid;
    if (rules.nightAllowance) nightMin += nightMinFor(r, now);
    dayPaid[r.date] = (dayPaid[r.date] ?? 0) + paid;
    weekPaid[kstWeekKey(r.date)] = (weekPaid[kstWeekKey(r.date)] ?? 0) + paid;
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
  return { workedMin, paidMin, nightMin, overtimeMin, base, nightPay, overtimePay, weeklyHolidayPay, extra, total };
}
