/**
 * 재직 기간(member_tenures · 0246) 화면 판정. 사장만 읽는다(RLS = 같은 매장 사장).
 * 들어올 때 기간이 열리고 나갈 때 닫힌다. 다시 들어오면 새 기간이 열리고 예전 기록은 표시돼 앱에서 안 보인다.
 */
import type { ShiftTemplate, ShiftException, SwapRequest } from '@/lib/store/useScheduleStore';
import { liveMinutes } from './attendance';
import { computePay, payWindow, shiftsToPayRecords, type PayrollRules } from './payroll';
import { monthDates, scheduledShiftsFor } from './schedule';

export type MemberTenure = {
  id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  name_snapshot: string | null;
  final_hourly_wage: number | null;
};

/** 재입사 승인 경고 문구(계획 P4-7 글자 그대로). */
export const REJOIN_NOTICE = '예전에 일했던 직원이에요. 새 직원으로 들어와요. 예전 기록은 보관만 하고 앱에서는 안 보여요.';
export const REJOIN_SETTLE_FIRST = '이번 기간 정산을 먼저 마치고 승인해 주세요.';

/** 이 사람의 가장 최근 닫힌 기간. 없으면 null. */
function latestClosed(tenures: MemberTenure[], userId: string): MemberTenure | null {
  let out: MemberTenure | null = null;
  for (const t of tenures) {
    if (t.user_id !== userId || !t.left_at) continue;
    if (!out || t.left_at > (out.left_at as string)) out = t;
  }
  return out;
}

/**
 * 이번 정산 기간 퇴사자. 닫힌 기간이 있고, 지금 멤버가 아니고, 이번 기간에 근무(출퇴근 또는 근무표)가 있는 사람.
 * 사람마다 가장 최근 닫힌 기간 하나를 돌려준다(이름 · 마지막 시급 스냅샷).
 * worked = 이번 기간에 근무가 있는 사람 id. 화면이 기존 급여 계산과 같은 입력으로 만든다.
 */
export function departedInPeriod(tenures: MemberTenure[], memberIds: string[], worked: Set<string>): MemberTenure[] {
  const members = new Set(memberIds);
  const users = new Set(tenures.filter((t) => t.left_at).map((t) => t.user_id));
  const out: MemberTenure[] = [];
  for (const uid of users) {
    if (members.has(uid) || !worked.has(uid)) continue;
    const t = latestClosed(tenures, uid);
    if (t) out.push(t);
  }
  return out;
}

/** 퇴사자 줄 · 재입사 경고가 쓰는 이번 정산 기간 입력. 직원·급여 화면이 들고 있는 값 그대로다. */
export type PeriodInputs = {
  ym: string; // YYYY-MM
  records: { staff_id: string; date: string; check_in: string | null; check_out: string | null; work_minutes: number }[];
  templates: ShiftTemplate[];
  swaps: SwapRequest[];
  exceptions: ShiftException[];
};

/** 이번 정산 기간에 근무가 있나 — 출퇴근 기록 또는 근무표(교대로 넘긴 근무는 scheduledShiftsFor 가 뺀다). */
export function workedInPeriod(uid: string, p: PeriodInputs): boolean {
  return p.records.some((r) => r.staff_id === uid && r.date.startsWith(p.ym))
    || scheduledShiftsFor(p.templates, p.swaps, p.exceptions, uid, monthDates(p.ym)).length > 0;
}

export type DepartedPayRow = { id: string; name: string; min: number; schedMin: number; wage: number | null; pay: number | null };

/**
 * 직원·급여 화면의 "이번 정산 기간 퇴사자" 줄. 금액은 지금 직원과 같은 계산(근무표 기준 computePay)이다.
 * 시급은 남아 있는 wages 를 먼저 쓰고, 없으면 나갈 때 남긴 final_hourly_wage 를 쓴다. 둘 다 없으면 pay = null(0원과 구별).
 * min = 실제 출퇴근 분(확인용) · schedMin = 근무표 분.
 */
export function departedPayRows(p: PeriodInputs & {
  tenures: MemberTenure[];
  memberIds: string[];
  wages: Record<string, number>;
  settings: PayrollRules;
}): DepartedPayRow[] {
  const worked = new Set(p.tenures.filter((t) => t.left_at && workedInPeriod(t.user_id, p)).map((t) => t.user_id));
  // 주휴는 그 주 일요일이 속한 달에 붙인다(Q9) — 급여 입력은 첫 주 월요일부터 편다.
  const payWin = payWindow(p.ym);
  return departedInPeriod(p.tenures, p.memberIds, worked).map((t) => {
    const uid = t.user_id;
    const min = p.records.filter((r) => r.staff_id === uid && r.date.startsWith(p.ym)).reduce((sum, r) => sum + liveMinutes(r), 0);
    const shiftRecs = shiftsToPayRecords(scheduledShiftsFor(p.templates, p.swaps, p.exceptions, uid, payWin.inputDates));
    const schedMin = shiftRecs.reduce((sum, r) => sum + (r.date >= payWin.from ? r.work_minutes : 0), 0);
    const wage = Object.prototype.hasOwnProperty.call(p.wages, uid) ? p.wages[uid] : t.final_hourly_wage;
    return { id: uid, name: t.name_snapshot || '퇴사자', min, schedMin, wage, pay: wage == null ? null : computePay(shiftRecs, wage, p.settings, undefined, payWin).total };
  });
}

/**
 * 합류 신청 승인 전 재입사 경고. 이 매장에 닫힌 기간이 있으면 문구 줄을, 아니면 null 을 준다.
 * 이번 기간에 예전 근무가 있으면 정산을 먼저 마치라는 줄을 더한다. 승인은 막지 않는다.
 */
export function rejoinNotice(tenures: MemberTenure[], userId: string, workedThisPeriod: boolean): string[] | null {
  if (!latestClosed(tenures, userId)) return null;
  return workedThisPeriod ? [REJOIN_NOTICE, REJOIN_SETTLE_FIRST] : [REJOIN_NOTICE];
}

/** 입사일 = 열린 기간의 joined_at. 열린 기간이 없으면 null 이고 호출부가 기존 값으로 폴백한다. */
export function openJoinedAt(tenures: MemberTenure[], userId: string): string | null {
  return tenures.find((t) => t.user_id === userId && !t.left_at)?.joined_at ?? null;
}
