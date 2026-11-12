/**
 * 근무표 vs 출퇴근 기록 대조 — 근무 내역 화면의 "근무표와 다른 날 N건".
 * 기준은 근무표다(2026-08-26 사용자 확정). 출퇴근 기록은 확인용이다.
 *
 * ★attendance.ts 가 아니라 따로 둔다(2026-11-02 급여 제거). 대조는 schedule.ts 헬퍼를 쓰는데
 *   schedule.ts 가 attendance.ts 를 import 해서, attendance.ts 에 두면 두 파일이 서로 부르는 순환이 된다.
 *   attendance.ts 는 의존 없는 파일로 남아 순수 함수 하니스(qa-open-record)가 그대로 읽는다.
 */
import { nowISO } from './attendance';
import { addDays, fmtDateKo, fmtMinutes, isOvernight, shiftMinutes, toMinutes } from './schedule';

// 구조적 타입 — store 순환 의존 없이 어디서나 재사용(liveMinutes 패턴과 동일).
export type WorkRecord = {
  date: string;              // "YYYY-MM-DD"
  check_in: string | null;   // ISO
  check_out: string | null;  // ISO
  work_minutes: number;
};

/** 근무표 한 칸 — 그 날짜에 그 사람이 서기로 된 근무. */
export type ScheduledShift = { date: string; start: string; end: string };

/** 근무표와 출퇴근 기록이 이만큼(분) 넘게 어긋나면 화면이 말한다. */
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
 *  · 근무표에 **없는 날** 출근을 찍음 → 근무표에 추가하라고 말한다.
 *  · 근무표엔 **있는데** 출근을 안 찍음 → 안 찍었다고만 말한다(근무표가 기준, 출퇴근은 참고용).
 * 같은 날 근무가 여러 개면 시작 시각 순으로 짝지어 비교한다.
 * ★아직 안 끝난 근무(내일 이후·오늘 진행 중)는 "출퇴근을 안 찍었어요"로 세지 않는다(라이브 QA 결함 1 · 2026-10-07).
 */
export function reconcileSchedule(
  shifts: ScheduledShift[],
  records: WorkRecord[],
  now: string = new Date().toISOString(),
): ShiftMismatch[] {
  const nowMs = new Date(now).getTime();
  const ended = (sh: ScheduledShift) =>
    new Date(nowISO(isOvernight(sh.start, sh.end) ? addDays(sh.date, 1) : sh.date, sh.end)).getTime() <= nowMs;
  const byDate = new Map<string, { sh: ScheduledShift[]; rec: WorkRecord[] }>();
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
      if (!shifts_.some(ended)) continue;
      out.push({ date, kind: 'no_record', message: `${fmtDateKo(date)} 근무는 출퇴근을 안 찍었어요.` });
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
