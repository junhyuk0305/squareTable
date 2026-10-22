/** 발송 퀴즈의 남은 일은 서버 응시 기록으로만 판단한다. 노하우 이해 기록과 섞지 않는다. */
type Assignment = { id: string; courseId: string; userId: string; sentAt: string | null; completedAt: string | null };
type Progress = { assignmentId: string; pendingEntryIds: string[]; totalItems: number; answeredItems: number };

export function pendingCourseAssignment<A extends Assignment, P extends Progress>(
  courseId: string,
  userId: string,
  assignments: A[],
  progress: P[],
  preferredId?: string,
): { assignment: A; progress: P } | null {
  const mine = assignments.filter((a) => a.courseId === courseId && a.userId === userId && !!a.sentAt);
  const preferred = preferredId ? mine.find((a) => a.id === preferredId) : undefined;
  const candidates = preferred ? [preferred] : [...mine].sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  for (const assignment of candidates) {
    if (assignment.completedAt) continue;
    const row = progress.find((p) => p.assignmentId === assignment.id);
    // 실패·미도착을 '아직 안 풀었다'로 추측하지 않는다. 조회 오류는 화면에서 따로 안내한다.
    if (row && row.totalItems > 0 && (row.pendingEntryIds.length > 0 || row.answeredItems >= row.totalItems)) return { assignment, progress: row };
  }
  return null;
}

/** 홈의 기존 숫자 nonce만 '다음 퀴즈'로 해석한다. 알림의 없는 발송 ID는 다른 퀴즈로 바꾸지 않는다. */
export function isNextQuizRequest(value: string): boolean {
  return /^\d{13}$/.test(value);
}
