import { useEffect, useMemo, useState } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore, occursOn, type FeedItem } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { todayStr, liveMinutes, payFor, DEFAULT_HOURLY_WAGE, tsMs } from '@/lib/utils/attendance';
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
  todayMin: number;
  todayPay: number;
  // 오늘 할일
  taskTotal: number;
  taskDone: number;
  taskRemain: number;
  tasksAllDone: boolean;
  // 안 읽은 공지
  unreadCount: number;
  latestNotice: FeedItem | undefined;
  // 근무표
  myShiftCount: number;
  incomingSwaps: number;
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
  const wages = usePayrollStore((s) => s.wages);
  const wage = wages[userId] ?? DEFAULT_HOURLY_WAGE;

  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);

  // 근무표 — 이번 주 내 근무 횟수 + 내가 대응할 교대 요청 수.
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);

  const [, setTick] = useState(0);
  const today = todayStr();

  const myShiftCount = useMemo(
    () => shiftTemplates.filter((t) => t.staff_id === userId).length,
    [shiftTemplates, userId],
  );
  const incomingSwaps = useMemo(
    () =>
      swaps.filter(
        (r) =>
          r.status === 'open' &&
          r.requester_id !== userId &&
          r.date >= today &&
          (r.kind === 'cover' || r.target_staff_id === userId),
      ).length,
    [swaps, userId, today],
  );

  const todayRecs = useMemo(
    () => records.filter((r) => r.staff_id === userId && r.date === today),
    [records, userId, today],
  );
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const working = !!openRec;
  const todayMin = todayRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  const todayPay = payFor(todayMin, wage);

  // 근무 중이면 경과시간 30초마다 갱신.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

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

  // 안 읽은 공지 — feed의 notice 중 read_by에 본인이 없는 것. 핀 공지·최신 우선.
  const unreadNotices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice' && !(f.read_by ?? []).includes(userId))
        .sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return tsMs(b.createdAt) - tsMs(a.createdAt);
        }),
    [feed, userId],
  );
  const unreadCount = unreadNotices.length;
  const latestNotice = unreadNotices[0];

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
    todayMin,
    todayPay,
    taskTotal,
    taskDone,
    taskRemain,
    tasksAllDone,
    unreadCount,
    latestNotice,
    myShiftCount,
    incomingSwaps,
    popularKnowhow,
    submitChat,
  };
}
