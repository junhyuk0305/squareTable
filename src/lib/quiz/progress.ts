/**
 * 발송 퀴즈의 남은 일은 서버 응시 기록으로만 판단한다. 노하우 이해 기록과 섞지 않는다.
 *
 * "할 퀴즈" 판정은 quizTodo 하나다(계획서 P3 · N15). 홈 개수·업무 카드·벨 배지·알림 목록이 전부 이 결과를 쓴다.
 * 서버 짝 = quiz_assignment_state(0332) → progress.state.
 */
import { staffCanSeeCourse } from './schedule';

type Assignment = { id: string; courseId: string; userId: string; sentAt: string | null; completedAt: string | null };
type Progress = {
  assignmentId: string;
  pendingEntryIds: string[];
  totalItems: number;
  answeredItems: number;
  /** 0332 서버 상태. 옛 서버는 없다 → 숫자로 같은 규칙을 다시 적용한다. */
  state?: QuizAssignmentState;
};

/** todo = 남은 문항 있음 · answered = 다 풀었는데 완료 표시 전 · done = 완료 · void = 낼 문항 0개(퀴즈 멈춤). */
export type QuizAssignmentState = 'todo' | 'answered' | 'done' | 'void';

/** 카드 순서와 1회성 규칙에 쓰는 퀴즈. dueDays null = 1회성. 배열 순서가 카드 순서다. */
export type QuizTodoCourse = { id: string; dueDays: number | null };

export type QuizTodo<A, P> = { assignment: A; progress?: P; state: 'todo' | 'answered' };

/**
 * 발송 한 건의 상태. 서버 state 가 있으면 그것이 정답이다.
 * 앱이 방금 완료로 바꾼 행(completedAt)은 서버 행이 오기 전에도 done 이다.
 * progress 행이 없으면 null(모름). 조회 실패를 "안 푼 퀴즈"로 추측하지 않는다.
 */
export function assignmentState(a: Assignment, row: Progress | undefined): QuizAssignmentState | null {
  if (a.completedAt) return 'done';
  if (!row) return null;
  if (row.state) return row.state;
  if (row.totalItems <= 0) return 'void';
  return row.answeredItems >= row.totalItems ? 'answered' : 'todo';
}

/**
 * 나에게 남은 퀴즈 목록. 홈 개수 = 벨 수 = 이 함수의 길이(cardRule 없이). 카드는 cardRule 을 켠 부분집합이다.
 *
 * - 퀴즈 하나 = 하나. 같은 퀴즈를 다시 보냈으면(다시 알리기·재확인) 최신 발송 하나만 본다.
 *   알림이 가리킨 발송(preferredId)이 그 퀴즈의 내 발송이면 그 발송을 본다.
 * - state 가 todo·answered 인 것만 남는다. done·void·모름(progress 없음)은 빠진다.
 *   progress 를 아예 안 넘기면(undefined) 서버 진행을 못 읽는 자리다 → 완료 여부만 본다.
 * - courses 를 넘기면 그 순서대로 놓고, courses 에 없는 퀴즈는 뺀다(외부 사람용 등 · 호출자가 고른다).
 * - cardRule 은 카드에만 켠다(10-23 사용자: 벨은 다른 퀴즈면 각각, 같은 퀴즈 재발송이면 1개).
 *   1회성 퀴즈는 앞선 하나만, 1회성이 남아 있으면 주기 퀴즈는 숨긴다. preferredId 의 퀴즈는 규칙보다 앞선다.
 */
export function quizTodo<A extends Assignment, P extends Progress>(
  assignments: readonly A[],
  progress: readonly P[] | undefined,
  opts: { userId: string; courses?: readonly QuizTodoCourse[]; preferredId?: string; cardRule?: boolean },
): QuizTodo<A, P>[] {
  const mine = assignments.filter((a) => a.userId === opts.userId && !!a.sentAt);
  const courseIds = opts.courses
    ? opts.courses.map((c) => c.id)
    : [...new Set([...mine].sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? '')).map((a) => a.courseId))];
  const picked: (QuizTodo<A, P> & { courseId: string; preferred: boolean })[] = [];
  for (const courseId of courseIds) {
    const sends = mine.filter((a) => a.courseId === courseId).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
    if (sends.length === 0) continue;
    const preferred = opts.preferredId ? sends.find((a) => a.id === opts.preferredId) : undefined;
    const assignment = preferred ?? sends[0];
    const row = progress?.find((p) => p.assignmentId === assignment.id);
    const state = progress ? assignmentState(assignment, row) : assignment.completedAt ? 'done' : 'todo';
    if (state !== 'todo' && state !== 'answered') continue;
    picked.push({ assignment, progress: row, state, courseId, preferred: !!preferred });
  }
  const out = opts.courses && opts.cardRule
    ? (() => {
        const dueOf = new Map(opts.courses.map((c) => [c.id, c.dueDays]));
        const firstOnce = picked.find((t) => dueOf.get(t.courseId) == null);
        return picked.filter((t) => t.preferred || (dueOf.get(t.courseId) == null ? t === firstOnce : !firstOnce));
      })()
    : picked;
  return out.map(({ assignment, progress: row, state }) => (row ? { assignment, progress: row, state } : { assignment, state }));
}

/** 스토어 training_courses 행에서 판정에 쓰는 열(useWorkStore.courses · 허브 notif courses). */
export type QuizCourseRow = { id: string; due_days?: number | null; audience?: string | null };

/**
 * 직원 화면 세 곳(홈 개수·벨·업무 카드)의 입구. 스토어 값을 그대로 넘긴다.
 * 손님용(audience guest) 퀴즈는 직원에게 안 뜬다(schedule.staffCanSeeCourse 와 같은 뜻 · 발송이 있는 퀴즈만 본다).
 * courses 를 모르면(옛 허브 서버) 내 발송 전부를 최신 순으로 본다.
 */
export function staffQuizTodo<A extends Assignment, P extends Progress>(
  assignments: readonly A[],
  progress: readonly P[] | undefined,
  courses: readonly QuizCourseRow[] | undefined,
  opts: { userId: string; preferredId?: string; cardRule?: boolean },
): QuizTodo<A, P>[] {
  const visible = courses
    ?.filter((c) => c.audience !== 'guest')
    .map((c) => ({ id: c.id, dueDays: c.due_days ?? null }));
  return quizTodo(assignments, progress, { ...opts, courses: visible });
}

/** 옛 퀴즈 판정에 쓰는 courses 열(스토어 training_courses 행). */
export type LegacyCourseRow = QuizCourseRow & { min_items?: number | null; created_at?: string | null };

/**
 * 발송 원장 없는 옛 퀴즈(0139 이전) 중 아직 할 일인 퀴즈 id. 홈·벨·앱 배지·알림 목록이 같은 판정을 쓴다.
 * ① 발송 행이 하나도 없고 직원에게 보이는 퀴즈(staffCanSeeCourse) ② 낼 문항이 있는 노하우가 하한(min_items) 이상
 * ③ 이 퀴즈에서 내 제출이 없는 노하우가 있다(legacyQuizOpen · submitted = 퀴즈별 내 제출 · null 은 조회 실패 → 할 일로 남김).
 */
export function legacyOpenQuizIds(
  courses: readonly LegacyCourseRow[],
  assignments: readonly { courseId: string }[],
  courseEntries: readonly { courseId: string; entryId: string }[],
  quizCounts: Record<string, number>,
  submitted: Record<string, Set<string>> | null,
): string[] {
  const out: string[] = [];
  for (const c of courses) {
    if (assignments.some((a) => a.courseId === c.id)) continue;
    if (!staffCanSeeCourse({ audience: c.audience ?? null, createdAt: c.created_at ?? null }, 0)) continue;
    const list = courseEntries.filter((e) => e.courseId === c.id).map((e) => e.entryId).filter((id) => (quizCounts[id] ?? 0) > 0);
    if (list.length < (c.min_items ?? 0)) continue;
    if (legacyQuizOpen(list, submitted ? submitted[c.id] ?? new Set<string>() : null)) out.push(c.id);
  }
  return out;
}

export type OpenQuiz<A, P> = { kind: 'sent'; todo: QuizTodo<A, P> } | { kind: 'legacy'; courseId: string };

/**
 * 할 퀴즈 목록 = 발송 퀴즈(staffQuizTodo · 퀴즈별 최신 하나 · 1회성 규칙 없음) + 열린 옛 퀴즈.
 * 홈 개수 = 벨 = 앱 배지 = 이 목록(벨·배지는 '모두 읽기' 시각 뒤 것만 센다).
 * legacyOpenIds 를 모르면(허브 · 옛 퀴즈 판정 입력 없음) 발송 퀴즈만 센다.
 */
export function openQuizzes<A extends Assignment, P extends Progress>(
  assignments: readonly A[],
  progress: readonly P[] | undefined,
  courses: readonly QuizCourseRow[] | undefined,
  userId: string,
  legacyOpenIds: readonly string[] | undefined,
): OpenQuiz<A, P>[] {
  return [
    ...staffQuizTodo(assignments, progress, courses, { userId }).map((todo): OpenQuiz<A, P> => ({ kind: 'sent', todo })),
    ...(legacyOpenIds ?? []).map((courseId): OpenQuiz<A, P> => ({ kind: 'legacy', courseId })),
  ];
}

/** 홈의 기존 숫자 nonce만 '다음 퀴즈'로 해석한다. 알림의 없는 발송 ID는 다른 퀴즈로 바꾸지 않는다. */
export function isNextQuizRequest(value: string): boolean {
  return /^\d{13}$/.test(value);
}

/**
 * 발송 원장 없는 옛 퀴즈가 아직 할 일인가(P4). 낼 노하우 중 내 제출이 없는 것이 있으면 할 일이다.
 * submitted 가 없으면(조회 실패) 할 일로 남긴다. 퀴즈가 사라지지 않게.
 * 조회 중에는 부르는 쪽이 숫자를 그리지 않는다(useJuniorHomeData.quizCountReady).
 */
export function legacyQuizOpen(entryIds: string[], submitted: Set<string> | null | undefined): boolean {
  if (!submitted) return entryIds.length > 0;
  return entryIds.some((id) => !submitted.has(id));
}
