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

// ── 빈도 (원설계 §06) ──────────
// ★0931(2026-11-19 사용자 결정): 하루 1회 · 7일 2회 · 연속 무시 자동 정지 · 근무일에만 보내기를 지웠다. 판정은 서버 quiz_send_block 한 곳이다.
/** 한 번에 낼 문항 수 상한. */
export const MAX_ITEMS_PER_ROUND = 3;
/**
 * 다시 알리기를 보낸 뒤 같은 (퀴즈, 사람)에게 다시 보낼 수 없는 시간(분). 판정은 서버 quiz_resend_cooldown()(0348 · 0931 에서 1분) 한 곳이다.
 * 여기 값은 화면 문구에만 쓴다. qa:quiz-resend 가 서버 값과 대조한다(한쪽만 고치면 RED).
 */
export const RESEND_COOLDOWN_MINUTES = 1;

// 노하우가 바뀌면 시스템이 만들던 재확인 발송(0169)은 0931 에서 멈췄다(재확인 기능 없앰 · 2026-11-19 사용자 결정).

// 입사 즉시 첫 퀴즈 배정(JOIN_FIRST_QUIZ_COURSES · 0169)은 0348 에서 없앴다(2026-11-04 사용자 결정 · 사장이 보내야 받는다).

/**
 * 발송 원장(0139)이 생기기 전 코스의 경계. 이보다 먼저 만든 코스는 원장 0건이어도 직원에게 보인다(하위 호환).
 * ★SQL 사본: 0273 approve_member·enqueue_knowhow_rechecks 의 `timestamptz '2026-08-11 00:00:00+09'`.
 */
export const QUIZ_LEDGER_SINCE = '2026-08-11T00:00:00+09:00';

/**
 * 이 퀴즈가 직원 카드에 나올 수 있는가(E1). 누구에게 갔는지는 원장 행이 따로 가른다.
 *  · 외부 사람용(guest)은 링크로만 푼다 — 직원 카드에 안 나온다.
 *  · 원장 0건 = 아직 아무에게도 안 보냄(만들던 퀴즈·본사 사본). 0139 이전 코스만 예전처럼 보인다.
 * ★SQL 사본: 0273 의 `coalesce(c.audience,'staff')='staff'` + 초안 제외 조건. 바꿀 때 양쪽을 같이 고친다.
 */
export function staffCanSeeCourse(
  c: { audience?: string | null; createdAt?: string | null },
  sendCount: number,
): boolean {
  if (c.audience === 'guest') return false;
  if (sendCount > 0) return true;
  return !!c.createdAt && Date.parse(c.createdAt) < Date.parse(QUIZ_LEDGER_SINCE);
}

/**
 * 재확인 발송(origin='recheck', 0169)이 와 있을 때 이 노하우를 다시 풀어야 하나(E2).
 * 서버(enqueue_knowhow_rechecks)와 같은 기준 — 통과한 뒤에 노하우가 바뀌었다(updated_at > verified_at).
 * 발송이 없으면 띄우지 않는다. 언제 다시 물을지(주 1회 상한·문항 검수)는 서버가 정한다.
 */
export function recheckEntryDue(
  verifiedAt: string | undefined,
  entryUpdatedAt: string | undefined,
  pendingRecheck: boolean,
): boolean {
  if (!pendingRecheck || !verifiedAt || !entryUpdatedAt) return false;
  return Date.parse(entryUpdatedAt) > Date.parse(verifiedAt);
}

// ── 날짜 도구(KST 고정) ────────────────────────────────────────────────────
/**
 * 이 셋은 화면 세 곳(`quiz-new`·`quiz/[id]`·설정 패널)에 **각자 복붙돼 있었다**.
 * 같은 축(KST)을 세 번 적으면 한 곳만 고치는 순간 "오늘"이 화면마다 달라진다 —
 * 서버(`due_quiz_sends`)도 KST 고정이라 축이 어긋나면 발송일이 하루 밀린다.
 * 판정이 아니라 표기라도, 축은 한 곳에서만 정한다(아키텍처 규칙 ②).
 */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** KST 오늘 "YYYY-MM-DD". */
export function todayKst(): string {
  const k = new Date(Date.now() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

/** "YYYY-MM-DD" + n일. */
export function addDaysKst(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 두 날짜 사이 일수. DB 는 '며칠 안에'(answer_days)로 세므로 달력 값을 여기서 되돌린다. */
export function daysBetweenKst(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+09:00`);
  const b = Date.parse(`${to}T00:00:00+09:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "2026-09-16" → "9월 16일". 잘못된 값은 통째로 돌려준다(날짜를 지어내지 않는다). */
export function dayLabelKst(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd;
}

/**
 * 링크 만료 시각 → 마지막으로 열린 한국 날짜("11월 10일"). 만료는 고른 날의 끝(다음 날 0시)이라 1ms 앞을 읽는다.
 * 퀴즈 목록(useQuizBoard)과 상세(QuizDeployPanel)가 같은 값을 써야 하루 어긋나지 않는다(2026-11-03 QA F4).
 */
export function linkLastDayLabel(expiresAt: string): string {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 1 + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/**
 * 재확인 주기 라벨 —사장이 직접 정한 값(due_days)만 말한다. 맡긴 경우는 날짜를 주장하지 않는다(null).
 * 퀴즈 목록(useQuizBoard)과 상세 기본정보가 같은 값을 써야 화면끼리 어긋나지 않는다.
 */
export function cycleLabel(dueDays: number | null | undefined): string | null {
  if (!dueDays || dueDays <= 0) return null;
  if (dueDays % 30 === 0) {
    const m = dueDays / 30;
    return m === 1 ? '한 달마다' : `${m}개월마다`;
  }
  if (dueDays % 7 === 0) return `${dueDays / 7}주마다`;
  return `${dueDays}일마다`;
}
