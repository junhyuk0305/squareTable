import { useEffect, useMemo, useState } from 'react';

import { fetchMySubmittedEntries } from '@/lib/db';
import { legacyOpenQuizIds } from '@/lib/quiz/progress';
import { staffCanSeeCourse } from '@/lib/quiz/schedule';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore, trainingCourseViews } from '@/lib/store/useWorkStore';

/** 같은 요청을 홈·벨·앱 배지·알림 목록이 동시에 부른다 → 진행 중인 조회 하나를 나눠 쓴다. */
let inflight: { key: string; tick: unknown; promise: Promise<Record<string, Set<string>> | null> } | null = null;
function submittedOf(key: string, tick: unknown, userId: string, courseIds: string[]) {
  if (!inflight || inflight.key !== key || inflight.tick !== tick) {
    inflight = { key, tick, promise: fetchMySubmittedEntries(userId, courseIds) };
  }
  return inflight.promise;
}

/**
 * 발송 원장 없는 옛 퀴즈 중 아직 할 일인 퀴즈 id(P4 · progress.legacyOpenQuizIds).
 * 홈 개수·벨·앱 배지·알림 목록이 같은 값을 openQuizzes 에 넘긴다(홈 = 벨 = 할 퀴즈 수).
 * ids = 판정 결과(조회 중에는 null · 옛 퀴즈가 없으면 []). error = 내 제출 조회 실패(이때도 할 일로 남긴다).
 * 퀴즈별로 내 제출을 읽는다(최근 200행 목록에 기대지 않는다). 응시 목록이 다시 오면(제출 뒤) 다시 읽는다.
 */
export function useLegacyQuizOpen(): { ids: string[] | null; error: boolean } {
  const userId = useSessionStore((s) => s.userId);
  const courses = useWorkStore((s) => s.courses);
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  const assignments = useWorkStore((s) => s.assignments);
  const attemptsTick = useWorkStore((s) => s.quizAttempts);
  const legacyIds = useMemo(
    () => trainingCourseViews(courses)
      .filter((c) => !assignments.some((a) => a.courseId === c.id) && staffCanSeeCourse(c, 0))
      .map((c) => c.id)
      .sort()
      .join(','),
    [courses, assignments],
  );
  const key = userId && legacyIds ? `${userId}|${legacyIds}` : '';
  const [result, setResult] = useState<{ key: string; data: Record<string, Set<string>> | null } | null>(null);
  useEffect(() => {
    if (!key || !userId) return;
    let alive = true;
    void submittedOf(key, attemptsTick, userId, legacyIds.split(',')).then((data) => {
      if (alive) setResult({ key, data });
    });
    return () => { alive = false; };
  }, [key, userId, legacyIds, attemptsTick]);
  return useMemo(() => {
    if (!key) return { ids: [], error: false };
    if (result?.key !== key) return { ids: null, error: false };
    return { ids: legacyOpenQuizIds(courses, assignments, courseEntries, quizCounts, result.data), error: result.data == null };
  }, [key, result, courses, assignments, courseEntries, quizCounts]);
}
