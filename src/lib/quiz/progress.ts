/**
 * 발송 퀴즈의 남은 일은 서버 응시 기록으로만 판단한다. 노하우 이해 기록과 섞지 않는다.
 *
 * "할 퀴즈" 판정은 quizTodo 하나다(계획서 P3 · N15). 홈 개수·업무 카드·벨 배지·알림 목록이 전부 이 결과를 쓴다.
 * 서버 짝 = quiz_assignment_state(0332) → progress.state.
 */
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
 * 나에게 남은 퀴즈 목록. 홈 개수 = 카드 수 = 벨 수다(같은 함수의 길이).
 *
 * - 퀴즈 하나 = 하나. 같은 퀴즈를 다시 보냈으면(다시 알리기·재확인) 최신 발송 하나만 본다.
 *   알림이 가리킨 발송(preferredId)이 그 퀴즈의 내 발송이면 그 발송을 본다.
 * - state 가 todo·answered 인 것만 남는다. done·void·모름(progress 없음)은 빠진다.
 *   progress 를 아예 안 넘기면(undefined) 서버 진행을 못 읽는 자리다 → 완료 여부만 본다.
 * - courses 를 넘기면 카드 규칙을 적용한다: 그 순서대로, 1회성 퀴즈는 앞선 하나만.
 *   1회성이 남아 있으면 주기 퀴즈는 숨긴다. preferredId 의 퀴즈는 규칙보다 앞선다(그 퀴즈를 열러 왔다).
 *   courses 에 없는 퀴즈는 보여 줄 수 없는 퀴즈라 뺀다(외부 사람용 등 · 호출자가 고른다).
 */
export function quizTodo<A extends Assignment, P extends Progress>(
  assignments: readonly A[],
  progress: readonly P[] | undefined,
  opts: { userId: string; courses?: readonly QuizTodoCourse[]; preferredId?: string },
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
  const out = opts.courses
    ? (() => {
        const dueOf = new Map(opts.courses.map((c) => [c.id, c.dueDays]));
        const firstOnce = picked.find((t) => dueOf.get(t.courseId) == null);
        return picked.filter((t) => t.preferred || (dueOf.get(t.courseId) == null ? t === firstOnce : !firstOnce));
      })()
    : picked;
  return out.map(({ assignment, progress: row, state }) => (row ? { assignment, progress: row, state } : { assignment, state }));
}

/**
 * 한 퀴즈의 남은 발송(카드·시트가 그 퀴즈를 열 때). quizTodo 와 같은 판정이다.
 * @deprecated 카드 목록은 quizTodo 를 쓴다. WorkBoard 가 quizTodo 로 옮기면 지운다.
 */
export function pendingCourseAssignment<A extends Assignment, P extends Progress>(
  courseId: string,
  userId: string,
  assignments: A[],
  progress: P[],
  preferredId?: string,
): { assignment: A; progress: P } | null {
  const hit = quizTodo(assignments.filter((a) => a.courseId === courseId), progress, { userId, preferredId })[0];
  return hit?.progress ? { assignment: hit.assignment, progress: hit.progress } : null;
}

/** 홈의 기존 숫자 nonce만 '다음 퀴즈'로 해석한다. 알림의 없는 발송 ID는 다른 퀴즈로 바꾸지 않는다. */
export function isNextQuizRequest(value: string): boolean {
  return /^\d{13}$/.test(value);
}
