/**
 * 퀴즈 1건의 **응시 기준** 숫자 — 정답률·응시인원(2026-09-13 사장 요청).
 *
 * ★`useQuizBoard` 와 나눠 둔 이유: 저건 **발송 원장**(quiz_assignments)에서 나오는 값
 * (받은 사람·통과 인원·일정)의 SSOT 다. 여기 값은 **응시 기록**(quiz_attempts)에서만 나온다 —
 * 출처가 다르고, 게스트 링크 응시는 발송 원장에 아예 없다. 같은 훅에 섞으면 "받은 사람 0명인데
 * 응시 12명" 같은 행을 설명할 수 없다. 대신 **여기도 판정은 한 곳뿐이다** — 화면은 세지 않는다.
 *
 * 집계 자체는 서버(0199 `quiz_course_stats`)가 한다. 클라가 응시 원장을 훑으면 최근 200행 상한에
 * 걸려 표본이 조용히 잘린다(= 틀린 정답률을 자신있게 말한다).
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchQuizCourseStats, type QuizCourseStat } from '@/lib/db';
import type { QuizAssignment } from '@/lib/quiz/types';

export type { QuizCourseStat };

/** 수신자별 최신 예약·발송. 과거 완료가 새 발송의 상태를 덮지 않는다. */
export function latestQuizAssignments(rows: readonly QuizAssignment[]): QuizAssignment[] {
  const latest = new Map<string, QuizAssignment>();
  for (const row of rows) {
    const key = `${row.courseId}:${row.userId}`;
    const prev = latest.get(key);
    if (!prev || row.scheduledOn > prev.scheduledOn ||
      (row.scheduledOn === prev.scheduledOn && (row.sentAt ?? '') > (prev.sentAt ?? ''))) latest.set(key, row);
  }
  return [...latest.values()];
}

/** 한 코스를 여러 번 나눠 푼 답안 중 문항별 마지막 답. null은 아직 발송 전이다. */
export function latestCourseAnswers<T extends { itemId: string; takenAt: string }>(rows: readonly T[], sentAt?: string | null): T[] {
  if (sentAt === null) return [];
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (sentAt && row.takenAt < sentAt) continue;
    const prev = latest.get(row.itemId);
    if (!prev || row.takenAt > prev.takenAt) latest.set(row.itemId, row);
  }
  return [...latest.values()];
}

// 정답률·응시 문구는 metrics.ts(rateFromStat·doneLabel·guestSubmissionsLabel)가 만든다(P5).

export function useQuizCourseStats() {
  const [byCourse, setByCourse] = useState<Record<string, QuizCourseStat>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void fetchQuizCourseStats(true).then((m) => {
      if (!alive) return;
      setByCourse(m);
      setError(false);
      setLoaded(true);
    }).catch(() => { if (alive) { setError(true); setLoaded(true); } });
    return () => { alive = false; };
  }, [nonce]);

  const statOf = useCallback((courseId: string): QuizCourseStat | undefined => byCourse[courseId], [byCourse]);

  return { byCourse, statOf, loaded, error, reload };
}
