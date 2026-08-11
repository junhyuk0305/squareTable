/**
 * 퀴즈 일정 판정 SSOT — 재확인 간격 · 빈도 상한.
 *
 * 근거: `산출물/퀴즈시스템_설계_2026-07-29.html` §06②(주기) · §06 "빈도 상한".
 * 설계서가 빈도 상한을 **"이게 기능의 생사를 가른다"**고 적어 둔 항목이다 —
 * 퀴즈가 쉬는 날에 오거나 하루에 여러 번 오면 직원이 앱을 꺼 버린다.
 *
 * ★ 이 파일에 로직만 둔다. DB 접근·화면 없음(계층 경계).
 * ★ 같은 판정을 화면·크론·엣지가 각자 세면 값이 갈린다 → 전부 여기를 부른다(아키텍처 규칙 ②).
 *   서버(SQL)가 같은 판정을 해야 할 때는 이 파일의 상수를 마이그레이션 주석에 옮겨 적고
 *   **바꿀 때 양쪽을 같이 고친다**(0138에서 겪은 드리프트 방지).
 */

/** 하루(ms). */
const DAY = 86_400_000;

// ── 재확인 간격 (원설계 §06② "까먹을 것 — 주기") ──────────────────────────
/**
 * 통과 후 다음 확인까지의 간격(일). 맞히면 다음 칸으로 넓히고 **틀리면 첫 칸으로 되돌린다**.
 * 사람이 잊는 곡선을 따라가는 값이라 사장이 고르는 것이 아니다 —
 * 화면은 "맡길래요 / 직접 정할래요"만 묻는다(직접이면 `training_courses.due_days` 고정값).
 */
export const REVIEW_INTERVALS_DAYS = [3, 14, 56, 180] as const;

/** 간격 단계의 상한 인덱스. */
export const MAX_INTERVAL_STEP = REVIEW_INTERVALS_DAYS.length - 1;

/** 통과·오답에 따른 다음 단계. 상한에서 더 안 올라가고, 오답은 무조건 0으로. */
export function nextIntervalStep(step: number, passed: boolean): number {
  if (!passed) return 0;
  return Math.min(clampStep(step) + 1, MAX_INTERVAL_STEP);
}

/** 저장된 값이 범위를 벗어나도(마이그레이션 중간 상태·수기 수정) 안전하게 접는다. */
export function clampStep(step: number): number {
  if (!Number.isFinite(step) || step < 0) return 0;
  return Math.min(Math.floor(step), MAX_INTERVAL_STEP);
}

/** 이 단계에서 다음 확인까지 며칠인가. */
export function intervalDays(step: number): number {
  return REVIEW_INTERVALS_DAYS[clampStep(step)];
}

/**
 * 다시 확인할 시각(epoch ms). `verifiedAt` 이 없으면 아직 한 번도 통과 못 한 것 → 지금이 due.
 * `fixedDays` 를 주면(사장이 직접 정한 주기) 간격 확대 대신 그 값을 쓴다.
 */
export function reviewDueAt(verifiedAt: string | null | undefined, step: number, fixedDays?: number | null): number {
  if (!verifiedAt) return 0;
  const t = Date.parse(verifiedAt);
  if (!Number.isFinite(t)) return 0;
  const days = fixedDays && fixedDays > 0 ? fixedDays : intervalDays(step);
  return t + days * DAY;
}

/** 지금 다시 확인할 때가 됐나. */
export function isReviewDue(
  verifiedAt: string | null | undefined,
  step: number,
  now: number,
  fixedDays?: number | null,
): boolean {
  return now >= reviewDueAt(verifiedAt, step, fixedDays);
}

// ── 빈도 상한 (원설계 §06 "빈도 상한 — 이게 기능의 생사를 가른다") ──────────
/** 하루 최대 발송 횟수. */
export const MAX_SENDS_PER_DAY = 1;
/** 주 최대 발송 횟수(7일 슬라이딩 창). */
export const MAX_SENDS_PER_WEEK = 2;
/** 한 번에 낼 문항 수 상한. */
export const MAX_ITEMS_PER_ROUND = 3;
/** 연속으로 이만큼 무시하면 자동으로 멈춘다. 다시 시작은 **그 사람이 열었을 때**. */
export const AUTO_STOP_AFTER_IGNORED = 2;

/** 발송 상한에 걸린 이유. null = 보내도 된다. */
export type SendBlockReason = 'day_cap' | 'week_cap' | 'auto_stopped' | 'not_working';

/**
 * 지금 이 사람에게 퀴즈를 보내도 되나.
 *
 * @param sentAt        그 사람에게 보낸 시각들(ISO). 순서는 상관없다.
 * @param ignoredStreak 연속으로 안 푼 횟수.
 * @param workingToday  오늘 근무인가. **근무 아닌 날에는 절대 보내지 않는다**(원설계 명시).
 *                      판정은 근무표가 한다 — `shiftsOn`(클라) / `workers_at`(서버).
 */
export function sendBlockReason(
  sentAt: string[],
  ignoredStreak: number,
  workingToday: boolean,
  now: number,
): SendBlockReason | null {
  if (!workingToday) return 'not_working';
  if (ignoredStreak >= AUTO_STOP_AFTER_IGNORED) return 'auto_stopped';

  const times = sentAt.map((s) => Date.parse(s)).filter((t) => Number.isFinite(t));
  // '하루'는 24시간 창이 아니라 **날짜**다 — 어제 23시에 보냈다고 오늘 오전이 막히면 안 된다.
  const today = new Date(now).toDateString();
  if (times.filter((t) => new Date(t).toDateString() === today).length >= MAX_SENDS_PER_DAY) return 'day_cap';
  if (times.filter((t) => now - t < 7 * DAY).length >= MAX_SENDS_PER_WEEK) return 'week_cap';
  return null;
}

export function canSend(sentAt: string[], ignoredStreak: number, workingToday: boolean, now: number): boolean {
  return sendBlockReason(sentAt, ignoredStreak, workingToday, now) === null;
}
