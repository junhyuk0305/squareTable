import { useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { useWorkStore, occursOn, trainingCourseViews, courseEntriesOf } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { todayStr } from '@/lib/utils/attendance';
import type { PlaybookEntry } from '@/types';

export type JuniorHomeData = {
  userName: string;
  // 출퇴근
  checkIn: (staffId: string) => void;
  checkOut: (staffId: string) => void;
  userId: string;
  todayRecs: AttendanceRecord[];
  openRec: AttendanceRecord | undefined;
  working: boolean;
  // 오늘 할일
  taskTotal: number;
  taskDone: number;
  taskRemain: number;
  tasksAllDone: boolean;
  /** 오늘 내가 해야 하는 업무 — 홈 히어로 목록(3건 + 전체보기)용. 미완료가 먼저. */
  todayTasks: { id: string; text: string; done: boolean }[];
  /** 아직 통과 못 한 퀴즈(노하우) 수 — 홈 경고행(AlertRow)용. 0이면 행이 안 그려진다. */
  openQuizCount: number;
  // 많이 물어본 노하우
  popularKnowhow: PlaybookEntry[];
  submitChat: (text: string, opts?: { anonymous?: boolean }) => Promise<void>;
};

/** 직원 홈 화면의 뷰모델 — 스토어 셀렉터 읽기 + 파생값 계산 + 30초 틱을 한곳에 모은다. */
export function useJuniorHomeData(): JuniorHomeData {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);

  const records = useAttendanceStore((s) => s.records);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);

  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);

  const today = todayStr();

  const todayRecs = useMemo(
    () => records.filter((r) => r.staff_id === userId && r.date === today),
    [records, userId, today],
  );
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const working = !!openRec;

  // 오늘 할일 진행 — 오늘 떠야 하는 것(occursOn) + 본인이 볼 수 있는 것(shared/내 private)만.
  const dayDone = doneMap[today] ?? {};
  const myTodaysTasks = useMemo(
    () => templates.filter((t) => occursOn(t, today) && (t.scope !== 'private' || t.ownerId === userId || t.createdBy === userId)),
    [templates, today, userId],
  );
  const taskTotal = myTodaysTasks.length;
  const taskDone = myTodaysTasks.filter((t) => dayDone[t.id]).length;
  const taskRemain = taskTotal - taskDone;
  const tasksAllDone = taskTotal > 0 && taskDone >= taskTotal;

  // 홈 히어로 목록용 — 남은 것이 먼저. myTodaysTasks(가시성 필터)를 그대로 재사용해 판정을 복제하지 않는다.
  const todayTasks = useMemo(
    () =>
      myTodaysTasks
        .map((t) => ({ id: t.id, text: t.text, done: !!dayDone[t.id] }))
        .sort((a, b) => Number(a.done) - Number(b.done)),
    // dayDone은 doneMap[today]의 파생이라 doneMap·today를 의존성으로 든다(객체 신원 불안정 회피).
    [myTodaysTasks, doneMap, today], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 안 푼 퀴즈 — 홈 경고행(AlertRow)에 쓸 **개수 하나**만 만든다.
  //  카드 렌더 판정(어느 코스 카드를 몇 장 띄울지·요청 예외·1회성 우선)은 WorkBoard 가 SSOT다.
  //  여기서 그 판정을 복제하지 않으려고, "눌러서 갈 곳이 실제로 있는 것"만 최소 조건으로 센다:
  //   ① 코스에 담긴 노하우이고 ② 낼 문항이 있고(0109: 문항 0건 = 의도된 미노출)
  //   ③ 코스가 하한(min_items)을 채워 직원에게 열려 있고 ④ 내 통과 기록이 아직 없는 것.
  //  주기 코스의 '다시 확인'(due)은 안 푼 게 아니라 재확인이라 여기서 세지 않는다.
  const courses = useWorkStore((s) => s.courses);
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  const openQuizCount = useMemo(() => {
    const passed = new Set(understanding.filter((u) => u.staffId === userId).map((u) => u.entryId));
    const open = new Set<string>();
    for (const c of trainingCourseViews(courses)) {
      const list = courseEntriesOf(courseEntries, c.id)
        .map((e) => e.entryId)
        .filter((id) => (quizCounts[id] ?? 0) > 0);
      if (list.length < c.minItems) continue;
      for (const id of list) if (!passed.has(id)) open.add(id);
    }
    return open.size;
  }, [courses, courseEntries, understanding, quizCounts, userId]);

  // 직원들이 많이 물어본 노하우 — 발행된 것 중 인용수(query_hits_30d) 상위 3개.
  // 첫날 신입에게 '다들 이걸 묻더라'를 보여줘 발견성을 높인다(가게 두뇌 미리보기).
  const entries = usePlaybookStore((s) => s.entries);
  const submitChat = useChatStore((s) => s.submit);
  const popularKnowhow = useMemo(
    () =>
      entries
        .filter((e) => (e.status === 'published' || !e.status) && (e.stats?.query_hits_30d ?? 0) > 0)
        .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0))
        .slice(0, 3),
    [entries],
  );

  return {
    userName,
    checkIn,
    checkOut,
    userId,
    todayRecs,
    openRec,
    working,
    taskTotal,
    taskDone,
    taskRemain,
    tasksAllDone,
    todayTasks,
    openQuizCount,
    popularKnowhow,
    submitChat,
  };
}
