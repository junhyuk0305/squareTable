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

import { fetchQuizAssignments, fetchQuizItems, fetchQuizLinks, fetchQuizStats, fetchTrainingCourses } from '@/lib/db';
import {
  useWorkStore,
  courseEntriesOf,
  understandingOf,
  staffWhoUnderstandEntries,
} from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useHubStore } from '@/lib/store/useHubStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { getSectionMeta } from '@/lib/utils/category';
import type { HeatCell, HeatGroup, HeatLevel } from '@/components/blocks/Heatmap';
import type { QuizAssignment, QuizItem, TrainingCourse } from '@/lib/quiz/types';

/** 오답 잦음 판정(0103) — 표본이 이만큼 쌓이고 오답률이 이 선을 넘으면 노하우 결함 신호. */
export const QUIZ_MISS_MIN_ATTEMPTS = 5;
export const QUIZ_MISS_RATE = 0.4;
/**
 * "높은 오답률"(퀴즈 개발계획 §10-4 · 2026-08-27 확정) — **낸 퀴즈에서 절반 넘게 오답**.
 * 인원 하한·최근 발송 기준 없음. 옛 홈의 `missPct > 0`(한 명이 한 번 틀려도 경고)은 오류였다.
 * 위 0103 기준(표본 5·40%)은 노하우 행의 오답률 **표기**용이라 그대로 두고, 경고행·히트맵 테두리는 이걸 쓴다.
 */
export const QUIZ_MISS_HALF_PCT = 50;
/** 히트맵 머리줄 "이번 주 ↑n칸" — 최근 7일에 확인된 칸 수(knowhow_understanding.verified_at 실측, R4). */
const WEEK_MS = 7 * 86_400_000;

/** 퀴즈 홈 경고행·롤업의 재료 — 판정은 전부 여기(§10-2·10-4). 화면은 그리기만 한다. */
export type QuizFixQueue = {
  /** 응시 중(sent·scheduled)인 퀴즈 중 낡은 문항이 있는 것 → 문항을 새로 만든다. */
  staleLive: QuizListRow[];
  /** 응시 중인 퀴즈에 담긴 노하우 중 절반 넘게 틀리는 것 → 노하우 글을 고친다. */
  missLive: QuizRow[];
  /** 경고행 건수 = 위 둘의 합. */
  count: number;
  /** 경고행 미리보기 2줄(갈래별 1건씩 — 블록어휘 §7-3). */
  preview: string[];
  /** 초안·보관 퀴즈의 낡은 문항 — 경고가 아니라 롤업 '손볼 것'(안 나가는 중). */
  staleIdle: { course: TrainingCourse; archived: boolean; staleCount: number }[];
};

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

/**
 * 퀴즈 한 건의 상태(1층 목록). **화면 어휘로 코스는 없다** — 퀴즈 1건 = 코스 1건이다.
 *  · draft     = 아직 안 보냄(예약일도 없음)
 *  · scheduled = 예약해 뒀고 아직 아무에게도 안 나감
 *  · sent      = 한 명이라도 받았다
 */
export type QuizStatus = 'draft' | 'scheduled' | 'sent';

export type QuizListRow = {
  course: TrainingCourse;
  status: QuizStatus;
  /** 담긴 노하우 수. 0이면 아직 재료가 없다. */
  entryCount: number;
  /** 실제로 나가는 활성 문항 수(보관 제외). 0이면 눌러도 낼 게 없다. */
  itemCount: number;
  /** 근거가 바뀐 뒤 다시 안 만든 문항 수(0114). */
  staleCount: number;
  /** 받는 사람 수 = 발송 원장의 사람 수. 아직 발행 전이면 0. */
  recipients: number;
  /** 담긴 노하우를 **전부** 아는 사람 수(업무 통과와 같은 규칙). */
  passed: number;
  /** 목록 한 줄의 부제 — 재고 수가 아니라 **일정**을 말한다. */
  caption: string;
};

/**
 * 퀴즈 홈 상단 지표(2026-08-26). 목록만 있던 화면이 "만든 것의 나열"로만 읽혀 다음에 뭘 할지가 안 보였다.
 *
 * ★고르는 기준: **사장이 다음 행동을 정하는 데 쓰는 값**만 넣는다. 보기 좋은 숫자는 넣지 않는다.
 * ★개인 지표는 없다(감시원칙 D1~D5). `passed/recipients` 는 사람이 아니라 **퀴즈의 진행**이라
 *   n/m명 표기가 허용되는 자리다 — 이름과 붙여 놓지 않는다.
 */
export type QuizBoardStats = {
  /** 나가고 있는 퀴즈 = 보냈거나 예약된 것. 초안은 아직 아무 일도 안 한다. */
  live: number;
  /** 초안 = 만들다 만 것. 이 값이 크면 "만들기는 되는데 못 내보내고 있다"는 뜻이다. */
  drafts: number;
  /** 나가고 있는 퀴즈들의 통과 인원 합 / 받은 사람 합. */
  passed: number;
  recipients: number;
  /** 문제로 나가는 노하우 수 / 발행된 노하우 수 — "다음에 뭘 퀴즈로 만들까"의 근거다. */
  covered: number;
  publishedEntries: number;
  /** 근거가 바뀐 뒤 안 고친 문항 수 · 그런 문항을 가진 퀴즈 수. */
  staleItems: number;
  staleQuizzes: number;
};

/** 재확인 주기 라벨. 사장이 직접 정한 값(due_days)만 말한다 — 맡긴 경우는 날짜를 주장하지 않는다. */
function cycleLabel(dueDays: number | null | undefined): string | null {
  if (!dueDays || dueDays <= 0) return null;
  if (dueDays % 30 === 0) {
    const m = dueDays / 30;
    return m === 1 ? '한 달마다' : `${m}개월마다`;
  }
  if (dueDays % 7 === 0) return `${dueDays / 7}주마다`;
  return `${dueDays}일마다`;
}

/** "2026-08-12" → "8월 12일". 잘못된 값은 조용히 통째로 돌려준다(날짜를 지어내지 않는다). */
function dayLabel(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd;
}

export function useQuizBoard() {
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const workLoaded = useWorkStore((s) => s.loaded);
  const entries = usePlaybookStore((s) => s.entries);
  const playbookLoaded = usePlaybookStore((s) => s.loaded);
  // 히트맵(§10-1) — 칸의 분모는 직원 수, 머리줄 비율은 허브 링과 **같은 값**(owner_knowhow_stats).
  const staff = useStaffStore((s) => s.staff);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const knowhowStats = useHubStore((s) => s.knowhowStats);
  const knowhowStatsLoaded = useHubStore((s) => s.knowhowStatsLoaded);
  const unitId = useSessionStore((s) => s.unitId);

  useEffect(() => {
    void useWorkStore.getState().hydrate();
    void usePlaybookStore.getState().hydrate();
    void useStaffStore.getState().hydrate();
    void useHubStore.getState().hydrateKnowhowStats();
  }, []);

  // "최근 30일 확인" 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성), 마운트 시 1회로 충분.
  const [now] = useState(() => Date.now());

  // ── 코스(0108) ───────────────────────────────────────────────────────
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  /**
   * 보관한 퀴즈(active=false) — 2026-08-26 신설.
   * 그 전에는 보관하면 여기서 걸러지기만 하고 **다시 볼 자리가 코드에 없어** 사실상 삭제였다.
   * 목록·되돌리기가 쓰는 값이라 여기서 같이 내준다(화면이 fetch 를 다시 조립하지 않는다).
   */
  const [archived, setArchived] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [courseReload, setCourseReload] = useState(0);
  const reloadCourses = useCallback(() => setCourseReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void fetchTrainingCourses().then(({ data }) => {
      if (!alive) return;
      const all = data ?? [];
      setCourses(all.filter((c) => c.active).sort((a, b) => a.position - b.position));
      setArchived(all.filter((c) => !c.active).sort((a, b) => a.position - b.position));
      setCoursesLoaded(true);
    });
    return () => { alive = false; };
  }, [courseReload]);

  // ── 문항(0107)·오답 집계(0103) ────────────────────────────────────────
  const trainedEntryIds = useMemo(() => [...new Set(courseEntries.map((e) => e.entryId))], [courseEntries]);
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [quizItemsLoaded, setQuizItemsLoaded] = useState(false);
  const [quizReload, setQuizReload] = useState(0);
  const bumpQuiz = useCallback(() => setQuizReload((v) => v + 1), []);
  useEffect(() => {
    if (trainedEntryIds.length === 0) return; // 담긴 게 없으면 읽을 것도 없다
    let alive = true;
    void fetchQuizItems(trainedEntryIds).then(({ data }) => {
      if (alive) { setQuizItems(data ?? []); setQuizItemsLoaded(true); }
    });
    return () => { alive = false; };
  }, [trainedEntryIds, quizReload]);

  const [quizStats, setQuizStats] = useState<Record<string, { attempts: number; misses: number }>>({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchQuizStats().then((s) => { if (alive) { setQuizStats(s); setStatsLoaded(true); } });
    return () => { alive = false; };
  }, []);

  // ── 발송 원장(0139) ───────────────────────────────────────────────────
  // 사장은 매장 전체, 직원은 본인 것만 내려온다(RLS qz_select) — 화면이 다시 거르지 않는다.
  const [assignments, setAssignments] = useState<QuizAssignment[]>([]);
  const [sendsLoaded, setSendsLoaded] = useState(false);
  const [sendReload, setSendReload] = useState(0);
  const bumpSends = useCallback(() => setSendReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void fetchQuizAssignments().then((rows) => { if (alive) { setAssignments(rows); setSendsLoaded(true); } });
    return () => { alive = false; };
  }, [sendReload]);

  // ── 링크 원장(0113) ───────────────────────────────────────────────────
  // 어느 퀴즈가 '외부용'인지는 **링크가 있느냐**로 안다 — 코스에 새 플래그를 두지 않는다(이미 있는 사실).
  const [linkedCourseIds, setLinkedCourseIds] = useState<Set<string>>(new Set());
  const [openLinkCourseIds, setOpenLinkCourseIds] = useState<Set<string>>(new Set());
  const [linksLoaded, setLinksLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchQuizLinks().then((rows) => {
      if (!alive) return;
      setLinkedCourseIds(new Set(rows.map((l) => l.courseId)));
      setOpenLinkCourseIds(
        new Set(rows.filter((l) => !l.revokedAt && Date.parse(l.expiresAt) > now).map((l) => l.courseId)),
      );
      setLinksLoaded(true);
    });
    return () => { alive = false; };
  }, [now]);

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

  /** 원시 오답률 % (표본 하한 없음). "높은 오답률" 판정(§10-4)은 `> QUIZ_MISS_HALF_PCT` 하나다. */
  const missPctOf = useCallback(
    (entryId: string) => {
      const qs = quizStats[entryId];
      return qs && qs.attempts > 0 ? Math.round((qs.misses / qs.attempts) * 100) : 0;
    },
    [quizStats],
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

  const sendsByCourse = useMemo(() => {
    const m = new Map<string, QuizAssignment[]>();
    for (const a of assignments) {
      const list = m.get(a.courseId);
      if (list) list.push(a);
      else m.set(a.courseId, [a]);
    }
    return m;
  }, [assignments]);

  /**
   * 1층 목록 한 줄 = 퀴즈 하나.
   *
   * ★부제는 **일정**이다(데모 A2). 재고 수("노하우 n개·문항 n개")는 만들 때나 궁금하고,
   *   평상시 사장이 알고 싶은 건 다음이 언제인가다.
   * ★"다음 확인 ○월 ○일"은 쓰지 않는다 — 재확인 시점은 사람마다 다르고(간격 확대는
   *   knowhow_understanding.interval_step 이 사람별로 벌어진다) 목록 한 줄이 대표할 수 없다.
   *   사장이 직접 정한 고정 주기(due_days)만 "N개월마다"로 말한다.
   */
  const buildQuizzes = useCallback((): QuizListRow[] => {
    return courses.map((c) => {
      const entryIds = courseEntriesOf(courseEntries, c.id).map((r) => r.entryId);
      const sends = sendsByCourse.get(c.id) ?? [];
      const sent = sends.filter((a) => !!a.sentAt);
      const status: QuizStatus = sent.length > 0 ? 'sent' : c.start_at ? 'scheduled' : 'draft';

      const cycle = cycleLabel(c.due_days);
      let caption: string;
      if (status === 'draft') {
        caption = '아직 안 보냄';
      } else if (status === 'scheduled') {
        caption = `${dayLabel(c.start_at)}에 보내요`;
      } else {
        // 가장 최근 발송일. sentAt 은 timestamptz 라 앞 10자가 UTC 날짜다 → 한국 날짜로 옮겨 읽는다.
        const last = sent
          .map((a) => a.sentAt as string)
          .sort()
          .at(-1) as string;
        const d = new Date(Date.parse(last));
        const kst = new Date(d.getTime() + 9 * 3600_000);
        const sentDay = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
        caption = c.answer_days ? `${sentDay} 보냄 · ${c.answer_days}일 안에` : `${sentDay} 보냄`;
        if (cycle) caption = `${cycle} · ${caption}`;
      }

      return {
        course: c,
        status,
        entryCount: entryIds.length,
        itemCount: entryIds.reduce((n, id) => n + quizCountOf(id), 0),
        staleCount: entryIds.reduce((n, id) => n + staleCountOf(id), 0),
        recipients: new Set(sends.map((a) => a.userId)).size,
        passed: staffWhoUnderstandEntries(understanding, entryIds, { now, dueDays: c.due_days ?? null }).length,
        caption,
      };
    });
  }, [courses, courseEntries, sendsByCourse, understanding, now, quizCountOf, staleCountOf]);

  /**
   * 홈 상단 지표 — `buildQuizzes()` 결과에서만 센다. 화면이 다시 세지 않는다(판정 복제 금지).
   * ★'덮인 노하우'는 **문항이 실제로 있는** 노하우다. 코스에 담기만 하고 문항이 0이면 안 나간다.
   */
  const buildStats = useCallback(
    (rows: QuizListRow[]): QuizBoardStats => {
      const live = rows.filter((r) => r.status !== 'draft');
      const published = entries.filter((e) => e.status !== 'draft');
      const covered = published.filter((e) => quizCountOf(e.id) > 0).length;
      return {
        live: live.length,
        drafts: rows.length - live.length,
        passed: live.reduce((n, r) => n + r.passed, 0),
        recipients: live.reduce((n, r) => n + r.recipients, 0),
        covered,
        publishedEntries: published.length,
        staleItems: rows.reduce((n, r) => n + r.staleCount, 0),
        staleQuizzes: rows.filter((r) => r.staleCount > 0).length,
      };
    },
    [entries, quizCountOf],
  );

  /**
   * 히트맵(H5 · §10-1) — 발행 노하우 1개 = 상자 1개, 카테고리(section)별 그룹.
   * 색 = **아는 직원 비율**(understandingOf / staff) · 0 = 문항 없음 · stale = 낡은 문항 · miss = 절반 넘게 오답.
   * 그룹 순서 = 옅은 칸(0~1단계) 비율 높은 순 — 손볼 곳이 위로.
   * ★직원 0명이면 비율이 없다 — 화면이 히트맵 대신 빈 상태 문구를 그린다(호출부 판단).
   */
  const buildHeatmap = useCallback((): HeatGroup[] => {
    const n = staff.length;
    const by = new Map<string, HeatCell[]>();
    for (const e of entries) {
      if (e.status === 'draft') continue;
      const known = understandingOf(understanding, e.id, { now, dueDays: null }).length;
      const items = quizCountOf(e.id);
      let level: HeatLevel = 0;
      if (items > 0) {
        const r = n > 0 ? known / n : 0;
        level = r >= 1 ? 4 : r >= 0.67 ? 3 : r >= 0.34 ? 2 : 1;
      }
      const stale = items > 0 && staleCountOf(e.id) > 0;
      const miss = items > 0 && missPctOf(e.id) > QUIZ_MISS_HALF_PCT;
      const status =
        items === 0 ? '문항 없음' : `${n}명 중 ${known}명 앎${stale ? ' · 노하우 변경됨' : miss ? ' · 높은 오답률' : ''}`;
      const name = getSectionMeta(e.section).label;
      const list = by.get(name) ?? [];
      list.push({ id: e.id, title: e.title, level, status, stale, miss });
      by.set(name, list);
    }
    const pale = (cells: HeatCell[]) => cells.filter((c) => c.level <= 1).length / Math.max(1, cells.length);
    return [...by]
      .map(([name, cells]) => ({ name, cells }))
      .sort((a, b) => pale(b.cells) - pale(a.cells) || a.name.localeCompare(b.name, 'ko'));
  }, [entries, staff.length, understanding, now, quizCountOf, staleCountOf, missPctOf]);

  /** 머리줄 값 — 허브 링과 같은 원장(owner_knowhow_stats). 이번 주 ↑n = 최근 7일 확인 기록 수. */
  const heatHead = useMemo(() => {
    const row = knowhowStats.find((s) => s.unit_id === unitId);
    const cells = row ? row.entries * row.staff : 0;
    const known = row ? row.understood : 0;
    const weekUp = understanding.filter((u) => now - Date.parse(u.verifiedAt) < WEEK_MS).length;
    return { cells, known, pct: cells > 0 ? Math.round((known / cells) * 100) : 0, weekUp };
  }, [knowhowStats, unitId, understanding, now]);

  /**
   * 경고행·롤업 재료(§10-2 · §10-4). **응시 중(sent·scheduled)인 퀴즈만** 경고다 —
   * 안 나가는 퀴즈의 낡은 문항은 급하지 않다(롤업 '손볼 것'으로 내린다).
   */
  const buildFixQueue = useCallback(
    (rows: QuizListRow[]): QuizFixQueue => {
      const live = rows.filter((r) => r.status !== 'draft');
      const staleLive = live.filter((r) => r.staleCount > 0);
      const liveEntryIds = new Set(live.flatMap((r) => courseEntriesOf(courseEntries, r.course.id).map((x) => x.entryId)));
      const missLive = buildRows(null).filter((r) => liveEntryIds.has(r.entryId) && missPctOf(r.entryId) > QUIZ_MISS_HALF_PCT);
      const preview: string[] = [];
      if (staleLive[0]) preview.push(`${staleLive[0].course.name} — 옛 정답이 나가는 중`);
      if (missLive[0]) preview.push(`${missLive[0].text} — 오답 ${missPctOf(missLive[0].entryId)}%`);
      const staleOf = (c: TrainingCourse) =>
        courseEntriesOf(courseEntries, c.id).reduce((k, x) => k + staleCountOf(x.entryId), 0);
      const staleIdle = [
        ...rows.filter((r) => r.status === 'draft' && r.staleCount > 0).map((r) => ({ course: r.course, archived: false, staleCount: r.staleCount })),
        ...archived.map((c) => ({ course: c, archived: true, staleCount: staleOf(c) })).filter((x) => x.staleCount > 0),
      ];
      return { staleLive, missLive, count: staleLive.length + missLive.length, preview, staleIdle };
    },
    [courseEntries, buildRows, missPctOf, staleCountOf, archived],
  );

  /**
   * 이 훅이 내놓는 **모든** 값이 확정됐는가 — 화면은 이것 하나만 보고 로딩을 건다.
   *
   * ★`coursesLoaded` 만으로 그리면 안 된다. 한 줄의 알약("초안"/"3/5명"/"낡음 2")은 코스가 아니라
   *   발송원장·이해기록·노하우·문항까지 다 있어야 정해진다. 코스만 기다리면 사장이 **"초안"을 먼저
   *   보고 잠시 뒤 "3/5명"으로 뒤바뀌는 것**을 본다(= 아직 안 온 것을 없는 것처럼 말한 셈이다).
   * ★문항은 담긴 노하우가 없으면 읽을 것도 없어서 fetch 자체를 안 한다 — 그 경우는 도착한 것으로 친다.
   */
  const boardLoaded =
    coursesLoaded &&
    sendsLoaded &&
    linksLoaded &&
    statsLoaded &&
    workLoaded &&
    playbookLoaded &&
    // 히트맵은 직원 수·이해 기록·문항이 **셋 다** 와야 그린다 — 하나만 오면 0%가 잠깐 스친다.
    staffLoaded &&
    knowhowStatsLoaded &&
    (trainedEntryIds.length === 0 || quizItemsLoaded);

  return {
    now,
    entries,
    entryById,
    courses,
    archived,
    setCourses,
    coursesLoaded,
    boardLoaded,
    reloadCourses,
    quizReload,
    bumpQuiz,
    quizStats,
    quizCountOf,
    staleCountOf,
    buildRows,
    assignments,
    sendsByCourse,
    bumpSends,
    buildQuizzes,
    buildStats,
    buildHeatmap,
    heatHead,
    buildFixQueue,
    missPctOf,
    staffCount: staff.length,
    linkedCourseIds,
    openLinkCourseIds,
  };
}
