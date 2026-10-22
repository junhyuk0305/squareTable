/**
 * metrics.ts — 퀴즈 화면의 숫자와 상태어는 여기서만 만든다(근본원인 계획 P5 · R4).
 *
 * 함수마다 정의를 적는다: 무엇을 세나 · 누구를 세나 · 언제부터 세나 · 화면 라벨.
 * 화면은 이 함수가 준 숫자와 문구를 그리기만 한다. 배열 길이에 "명"을 붙이지 않는다.
 *
 * 확정 규칙(10-22 사용자, 계획 §6):
 *  · Q2 정답률 = 직원은 사람별 첫 응시만 · 링크 제출은 전부 · 둘을 합친다.
 *  · Q1 업무의 "혼자 할 수 있어요" 응시는 진행·정답률에 넣지 않는다.
 *
 * ⚠️ 순수 함수만 둔다. 런타임 import 를 넣지 않는다(하니스 qa-quiz-owner-state 가 이 파일을 단독 실행한다).
 *    타입도 이 파일 안에 구조로 적는다. db.ts 의 행 타입과 모양이 같아 그대로 넘길 수 있다.
 */

// ── 입력 모양 ────────────────────────────────────────────────────────────

/** 발송 원장 한 줄(QuizAssignment 와 같은 모양). 사람별 최신 발송은 latestQuizAssignments 로 먼저 고른다. */
export type MetricAssignment = { userId: string; sentAt: string | null; completedAt: string | null };

/**
 * 답 한 줄(fetchQuizCourseAttemptItems 의 CourseAttemptItemRow 와 같은 모양).
 * staffId null = 링크 손님.
 * `source` 는 아직 서버에 없다. 서버 열 필요: quiz_course_attempt_items 에 `source`
 * ('assignment' | 'link' | 'self') 또는 제출의 assignment_id. 없으면 업무 자청 응시(Q1)를 가려낼 수 없어
 * 직원 답으로 센다. 열이 생기면 'self' 는 여기서 저절로 빠진다.
 */
export type MetricAnswer = {
  itemId: string;
  staffId: string | null;
  submissionId: string;
  takenAt: string;
  correct: boolean;
  source?: 'assignment' | 'link' | 'self';
};

/** 링크 한 줄(QuizLinkRow 와 같은 모양). */
export type MetricLink = { expiresAt: string; revokedAt: string | null };

// ── 퀴즈 상태 ────────────────────────────────────────────────────────────

export type QuizState = 'draft' | 'scheduled' | 'sending' | 'link_open' | 'archived';

/** 상태어. 배지 자리라 명사형이다. */
export const QUIZ_STATE_LABEL: Record<QuizState, string> = {
  draft: '초안',
  scheduled: '예약',
  sending: '발송 중',
  link_open: '링크 열림',
  archived: '보관',
};

/**
 * 퀴즈 한 건의 지금 상태(N09).
 * 무엇을: 코스 1건. 언제: 지금(now).
 * 순서: 보관(active=false) → 발송 중(한 명이라도 sent_at) → 링크 열림(회수 안 됐고 만료 전 링크 1개 이상)
 *       → 예약(start_at 있음) → 초안.
 * 발송도 했고 링크도 열려 있으면 "발송 중"이다. 링크 열림은 링크 칸(meta)이 따로 말한다.
 */
export function quizState(
  course: { active: boolean; start_at?: string | null },
  sends: readonly MetricAssignment[],
  links: readonly MetricLink[],
  now: number,
): QuizState {
  if (!course.active) return 'archived';
  if (sends.some((a) => !!a.sentAt)) return 'sending';
  if (links.some((l) => !l.revokedAt && Date.parse(l.expiresAt) > now)) return 'link_open';
  if (course.start_at) return 'scheduled';
  return 'draft';
}

// ── 직원 진행(이번 발송) ─────────────────────────────────────────────────

export type PersonState = 'not_sent' | 'not_started' | 'in_progress' | 'done';

/** 사람 줄 배지. */
export const PERSON_STATE_LABEL: Record<PersonState, string> = {
  not_sent: '발송 전',
  not_started: '아직 안 풂',
  in_progress: '푸는 중',
  done: '완료',
};

/**
 * 한 사람의 이번 발송 상태(N17).
 * 누구를: 직원 1명. 언제부터: 그 사람의 최신 발송 sent_at 뒤.
 * 완료 = completed_at(서버 mark_quiz_completed 가 문항 단위로 찍는다).
 * 푸는 중 = 완료 전이고 이번 발송 뒤 답 1개 이상. 아직 안 풂 = 받았고 답 0개.
 * Q1: source='self' 답은 세지 않는다.
 */
export function personState(a: MetricAssignment | undefined, answers: readonly MetricAnswer[]): PersonState {
  if (!a || !a.sentAt) return 'not_sent';
  if (a.completedAt) return 'done';
  const sentAt = a.sentAt;
  const any = answers.some((r) => r.staffId === a.userId && r.source !== 'self' && r.takenAt >= sentAt);
  return any ? 'in_progress' : 'not_started';
}

export type StaffProgress = { recipients: number; done: number; started: number; notStarted: number; notDone: number };

/**
 * 이번 발송의 직원 진행 숫자(N11 · N17).
 * 입력: 사람별 최신 발송(latestQuizAssignments 결과).
 * recipients = 실제로 받은 사람(sent_at 있음). 예약만 된 사람은 분모에 안 넣는다.
 * done = 완료. started = 푸는 중. notStarted = 받았고 답 0개. notDone = 받았고 완료 전(= started + notStarted).
 * 라벨: doneLabel → "완료 3/5명", startedLabel → "푸는 중 N명". 다시 알리기 대상은 notDone 이다.
 */
export function staffProgress(latest: readonly MetricAssignment[], answers: readonly MetricAnswer[]): StaffProgress {
  const out: StaffProgress = { recipients: 0, done: 0, started: 0, notStarted: 0, notDone: 0 };
  for (const a of latest) {
    const s = personState(a, answers);
    if (s === 'not_sent') continue;
    out.recipients += 1;
    if (s === 'done') out.done += 1;
    else if (s === 'in_progress') out.started += 1;
    else out.notStarted += 1;
  }
  out.notDone = out.started + out.notStarted;
  return out;
}

/** "완료 3/5명". 받은 사람이 없으면 빈 문자열(링크만 낸 퀴즈는 이 줄이 없다). */
export function doneLabel(p: StaffProgress): string {
  return p.recipients > 0 ? `완료 ${p.done}/${p.recipients}명` : '';
}

/** "푸는 중 N명". 0명이면 빈 문자열. */
export function startedLabel(p: StaffProgress): string {
  return p.started > 0 ? `푸는 중 ${p.started}명` : '';
}

/** 받은 사람 전원이 완료했나. 받은 사람 0명(링크만)은 완료가 아니다. 탭 "응시 완료" 판정. */
export function allDone(p: StaffProgress): boolean {
  return p.recipients > 0 && p.done >= p.recipients;
}

// ── 정답률(Q2) ───────────────────────────────────────────────────────────

/** 직원은 사람·문항마다 가장 이른 답 하나. 같은 문항을 다시 풀어도 처음 답만 남는다. */
function staffFirstAnswers(answers: readonly MetricAnswer[]): MetricAnswer[] {
  const first = new Map<string, MetricAnswer>();
  for (const r of answers) {
    if (r.staffId == null || r.source === 'self') continue;
    const key = `${r.staffId}:${r.itemId}`;
    const prev = first.get(key);
    if (!prev || r.takenAt < prev.takenAt) first.set(key, r);
  }
  return [...first.values()];
}

export type QuizRate = { asked: number; correct: number; pct: number | null };

/**
 * 퀴즈 정답률(Q2 확정안).
 * 무엇을: 답(문항 1개 = 1). 누구를: 직원 첫 응시 + 링크 손님 전부. 업무 자청(source='self')은 뺀다.
 * 언제부터: 누적(퀴즈가 생긴 뒤 전부). 직원 "첫 응시" = 사람·문항마다 가장 이른 답.
 * 표본 0이면 pct=null 이다(0%는 "다 틀렸다"는 주장이라 미응시와 섞지 않는다).
 * 라벨: rateLabel → "정답률 N%" / "정답률 —".
 *
 * 목록 화면(training.tsx)은 답 행이 없고 quiz_course_stats 집계만 받는다. 그 집계는 지금 제출 단위 누적이라
 * 이 정의로 바꿀 수 없다. 서버 열 필요: quiz_course_stats.first_asked / first_correct
 * (직원 첫 응시 + 손님 전부, 자청 제외). 생기면 rateFromStat 을 쓴다.
 */
export function quizRate(answers: readonly MetricAnswer[]): QuizRate {
  const counted = [...staffFirstAnswers(answers), ...answers.filter((r) => r.staffId == null)];
  const correct = counted.filter((r) => r.correct).length;
  return { asked: counted.length, correct, pct: counted.length > 0 ? Math.round((correct / counted.length) * 100) : null };
}

/**
 * 목록용 정답률 — 서버 집계 열에서. 정의는 quizRate 와 같다.
 * first_asked 가 없는 서버(열 추가 전)는 null 을 돌린다. 옛 누적 asked/correct 로 대신하지 않는다.
 */
export function rateFromStat(stat: { firstAsked?: number; firstCorrect?: number } | undefined): QuizRate {
  const asked = stat?.firstAsked ?? 0;
  const correct = stat?.firstCorrect ?? 0;
  return { asked, correct, pct: asked > 0 ? Math.round((correct / asked) * 100) : null };
}

/** "정답률 N%" / "정답률 —". */
export function rateLabel(r: QuizRate): string {
  return `정답률 ${r.pct == null ? '—' : `${r.pct}%`}`;
}

// ── 링크 제출 ────────────────────────────────────────────────────────────

/**
 * 링크 제출 수(N16).
 * 무엇을: 제출(submission). 같은 손님이 두 번 내면 2건이다. 사람 수가 아니다.
 * 누구를: 손님(staffId null). 언제부터: 누적.
 * 라벨: guestSubmissionsLabel → "링크 제출 N건". "명"을 쓰지 않는다.
 */
export function guestSubmissions(answers: readonly MetricAnswer[]): number {
  return new Set(answers.filter((r) => r.staffId == null).map((r) => r.submissionId)).size;
}

export function guestSubmissionsLabel(n: number): string {
  return `링크 제출 ${n}건`;
}

// ── 문항별 ───────────────────────────────────────────────────────────────

/** 오답 경고 기준 하나(N18). 답 5건 이상이고 오답 40% 이상. */
export const ITEM_MISS_MIN_ANSWERS = 5;
export const ITEM_MISS_RATE = 0.4;

export type ItemAnswers = { answers: number; missRate: number; warn: boolean };

/**
 * 문항 하나의 답 수와 오답률.
 * 무엇을: 답(응답 1개 = 1건). 누구를: 직원 + 손님, 자청 제외. 언제부터: 누적. 재응시도 센다.
 * warn = ITEM_MISS_MIN_ANSWERS 이상 · ITEM_MISS_RATE 이상. 상세 경고와 목록 경고가 같은 기준을 쓴다.
 * 라벨: itemAnswersLabel → "답안 N건 · 오답 N%".
 */
export function itemAnswers(answers: readonly MetricAnswer[], itemId: string): ItemAnswers {
  const mine = answers.filter((r) => r.itemId === itemId && r.source !== 'self');
  const missRate = mine.length ? mine.filter((r) => !r.correct).length / mine.length : 0;
  return { answers: mine.length, missRate, warn: mine.length >= ITEM_MISS_MIN_ANSWERS && missRate >= ITEM_MISS_RATE };
}

export function itemAnswersLabel(s: ItemAnswers): string {
  if (s.answers === 0) return '아직 답 없음';
  if (s.answers < ITEM_MISS_MIN_ANSWERS) return `답안 ${s.answers}건`;
  return `답안 ${s.answers}건 · 오답 ${Math.round(s.missRate * 100)}%`;
}

// ── 개인 ─────────────────────────────────────────────────────────────────

/**
 * 한 사람의 이번 발송 점수 줄(N17 분모).
 * 무엇을: 이번 발송 뒤 문항별 마지막 답(latestCourseAnswers 결과). 분모는 퀴즈 문항 수다. 낸 답 수가 아니다.
 * 라벨: "6문제 중 2개 맞힘".
 */
export function roundLabel(latestAnswers: readonly { correct: boolean }[], quizItemCount: number): string {
  return `${quizItemCount}문제 중 ${latestAnswers.filter((r) => r.correct).length}개 맞힘`;
}

export type PersonBoard = { rate: QuizRate; wrongItems: number; submissions: number };

/**
 * 개인 상세 대시보드(N05 · N16).
 * 누구를: 직원 1명. 무엇을: rate = 그 사람의 첫 응시 정답률(문항마다 가장 이른 답).
 * wrongItems = 첫 응시에서 틀린 문항 수(같은 문항을 여러 번 세지 않는다). submissions = 제출 수.
 * 라벨: "정답률 N%" · "틀린 문항 N개" · "제출 N번".
 * 입력은 답 행(fetchQuizCourseAttemptItems 를 그 사람으로 거른 것). 지금 person.tsx 가 받는 quiz_course_person
 * (제출 단위 asked/correct)로는 문항별 첫 답을 알 수 없다. 서버 열은 필요 없고 화면이 답 행을 읽으면 된다.
 */
export function personBoard(answers: readonly MetricAnswer[], staffId: string): PersonBoard {
  const mine = answers.filter((r) => r.staffId === staffId && r.source !== 'self');
  const first = staffFirstAnswers(mine);
  const rate = quizRate(first);
  return { rate, wrongItems: first.length - rate.correct, submissions: new Set(mine.map((r) => r.submissionId)).size };
}

export function submissionsLabel(n: number): string {
  return `제출 ${n}번`;
}

// ── 결과 탭 빈 상태 ──────────────────────────────────────────────────────

/**
 * 결과 탭이 비었나(N10). 받은 직원도 없고 답(직원·손님)도 없을 때만 비었다.
 * 링크로만 5명이 풀었으면 비지 않았다.
 */
export function resultsEmpty(sends: readonly MetricAssignment[], answers: readonly MetricAnswer[]): boolean {
  return !sends.some((a) => !!a.sentAt) && !answers.some((r) => r.source !== 'self');
}
