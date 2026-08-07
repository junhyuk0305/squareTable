/**
 * 퀴즈 화면 공용 파생(2026-08-07) — 1층 대시보드(`/owner/training`)와 2층 목록(`/owner/quiz-list`)이
 * 같은 숫자를 말하게 하는 SSOT.
 *
 * 두 화면이 각자 세면 같은 노하우의 '문항 n개'·'확인 n명'·'오답률'이 서로 다른 값을 말한다
 * (아키텍처 규칙 ② 판정 복제 금지). 그래서 읽기·집계는 전부 여기 한 곳이고,
 * 화면은 `buildRows(course)` 가 돌려준 행을 거르고 그리기만 한다.
 *
 * ★ 로직만 있고 화면은 없다. 정렬·필터·문구는 각 화면의 몫이다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchQuizItems, fetchQuizStats, fetchTrainingCourses } from '@/lib/db';
import { useWorkStore, courseEntriesOf, understandingOf } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import type { QuizItem, TrainingCourse } from '@/lib/quiz/types';

/** 오답 잦음 판정(0103) — 표본이 이만큼 쌓이고 오답률이 이 선을 넘으면 노하우 결함 신호. */
export const QUIZ_MISS_MIN_ATTEMPTS = 5;
export const QUIZ_MISS_RATE = 0.4;

/** 목록·대시보드가 공통으로 쓰는 노하우 한 줄. 화면 문구는 여기 값에서 파생된다. */
export type QuizRow = {
  entryId: string;
  text: string;
  /** 이 노하우가 담긴 코스 이름들 — 2층 목록의 '노하우 연결 표시'. */
  courseNames: string[];
  /** 그 노하우로 실제 나가는 활성 문항 수(보관 제외). 0이면 직원에게 안 나간다. */
  quizCount: number;
  /** 근거가 바뀐 뒤 다시 안 만든 문항 수(0114). 옛 정답이 계속 나가는 상태. */
  staleCount: number;
  /** 오답률 % — 표본·기준 미달이면 0(= 말하지 않는다). */
  missPct: number;
  /** 오답률 표본 수. 0 = 아직 아무도 안 풀었다. */
  attempts: number;
  passedIds: string[];
  passedNames: string[];
  /** 그 노하우에 '하면 안 되는 것'이 적혀 있다 — 사장이 정하는 게 아니라 글에서 읽는다. */
  risky: boolean;
};

export function useQuizBoard() {
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const entries = usePlaybookStore((s) => s.entries);

  useEffect(() => {
    void useWorkStore.getState().hydrate();
    void usePlaybookStore.getState().hydrate();
  }, []);

  // "최근 30일 확인" 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성), 마운트 시 1회로 충분.
  const [now] = useState(() => Date.now());

  // ── 코스(0108) ───────────────────────────────────────────────────────
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [courseReload, setCourseReload] = useState(0);
  const reloadCourses = useCallback(() => setCourseReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void fetchTrainingCourses().then(({ data }) => {
      if (!alive) return;
      setCourses((data ?? []).filter((c) => c.active).sort((a, b) => a.position - b.position));
      setCoursesLoaded(true);
    });
    return () => { alive = false; };
  }, [courseReload]);

  // ── 문항(0107)·오답 집계(0103) ────────────────────────────────────────
  const trainedEntryIds = useMemo(() => [...new Set(courseEntries.map((e) => e.entryId))], [courseEntries]);
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [quizReload, setQuizReload] = useState(0);
  const bumpQuiz = useCallback(() => setQuizReload((v) => v + 1), []);
  useEffect(() => {
    if (trainedEntryIds.length === 0) return; // 담긴 게 없으면 읽을 것도 없다
    let alive = true;
    void fetchQuizItems(trainedEntryIds).then(({ data }) => { if (alive) setQuizItems(data ?? []); });
    return () => { alive = false; };
  }, [trainedEntryIds, quizReload]);

  const [quizStats, setQuizStats] = useState<Record<string, { attempts: number; misses: number }>>({});
  useEffect(() => {
    let alive = true;
    void fetchQuizStats().then((s) => { if (alive) setQuizStats(s); });
    return () => { alive = false; };
  }, []);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const quizCountOf = useCallback(
    (entryId: string) =>
      trainedEntryIds.includes(entryId)
        ? quizItems.filter((q) => q.status === 'active' && (q.entry_ids ?? []).includes(entryId)).length
        : 0,
    [quizItems, trainedEntryIds],
  );

  const staleCountOf = useCallback(
    (entryId: string) => {
      const cur = entryById.get(entryId)?.updated_at;
      if (!cur) return 0;
      return quizItems.filter(
        (q) =>
          q.status === 'active' &&
          (q.entry_ids ?? []).includes(entryId) &&
          // null = 스냅샷 이전 행 → 모르는 것을 "바뀌었다"고 말하지 않는다.
          !!q.source_updated_at &&
          Date.parse(q.source_updated_at) < Date.parse(cur),
      ).length;
    },
    [quizItems, entryById],
  );

  const courseNameById = useMemo(() => new Map(courses.map((c) => [c.id, c.name])), [courses]);

  /**
   * 행 만들기. `course` 를 주면 **그 코스의 순서(position)대로** — 직원이 배우는 순서다.
   * null 이면 소속 코스와 무관하게 담긴 노하우 전부(중복 제거, 제목순).
   *
   * ★ 재확인 주기(dueDays)는 코스 속성이라 '전체'에서는 적용하지 않는다 —
   *   주기가 다른 코스의 통과 기록을 한 잣대로 재면 어느 쪽도 맞지 않는다.
   */
  const buildRows = useCallback(
    (course: TrainingCourse | null): QuizRow[] => {
      const dueDays = course?.due_days ?? null;
      const ids = course
        ? courseEntriesOf(courseEntries, course.id).map((r) => r.entryId)
        : [...new Set(courseEntries.map((r) => r.entryId))];

      const rows = ids
        .map((entryId) => {
          const e = entryById.get(entryId);
          if (!e) return null;
          const passedRows = understandingOf(understanding, entryId, { now, dueDays });
          const qs = quizStats[entryId];
          const attempts = qs?.attempts ?? 0;
          const missRate = qs && attempts >= QUIZ_MISS_MIN_ATTEMPTS ? qs.misses / attempts : 0;
          return {
            entryId,
            text: e.title,
            courseNames: [
              ...new Set(
                courseEntries
                  .filter((r) => r.entryId === entryId)
                  .map((r) => courseNameById.get(r.courseId))
                  .filter((n): n is string => !!n),
              ),
            ],
            quizCount: quizCountOf(entryId),
            staleCount: staleCountOf(entryId),
            missPct: missRate >= QUIZ_MISS_RATE ? Math.round(missRate * 100) : 0,
            attempts,
            passedIds: passedRows.map((u) => u.staffId),
            passedNames: passedRows.map((u) => u.staffName),
            risky: !!String(e.square?.extract?.dont ?? '').trim(),
          };
        })
        .filter((x): x is QuizRow => !!x);

      // 코스가 없으면 순서에 뜻이 없다 → 매번 같은 순서가 나오게 제목으로 정렬(결정적).
      return course ? rows : rows.sort((a, b) => a.text.localeCompare(b.text, 'ko'));
    },
    [courseEntries, entryById, understanding, now, quizStats, quizCountOf, staleCountOf, courseNameById],
  );

  return {
    now,
    entries,
    entryById,
    courses,
    setCourses,
    coursesLoaded,
    reloadCourses,
    quizReload,
    bumpQuiz,
    quizStats,
    quizCountOf,
    staleCountOf,
    buildRows,
  };
}
