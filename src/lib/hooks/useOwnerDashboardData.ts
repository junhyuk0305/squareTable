import { useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore, occursOn } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { computeBrainScore, type BrainScore } from '@/lib/utils/brainScore';
import { todayStr, liveMinutes, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';
import type { UnknownQuery } from '@/types';

export type OwnerDashboardData = {
  userName: string;
  storeName: string;
  entriesCount: number;
  working: number;
  monthPay: number;
  taskTotal: number;
  taskDoneCount: number;
  pending: number;
  topFaq: UnknownQuery[];
  brain: BrainScore;
  isSolo: boolean;
};

/** 사장 대시보드 화면의 뷰모델 — 스토어 셀렉터 읽기 + 파생값 계산을 한곳에 모은다. */
export function useOwnerDashboardData(): OwnerDashboardData {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  // 실매장 이름은 세션(프로필→unit)에서.
  const storeName = useSessionStore((s) => s.storeName) || '내 매장';

  const queue = useUnknownQueueStore((s) => s.queue);
  const records = useAttendanceStore((s) => s.records);
  const wages = usePayrollStore((s) => s.wages);
  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const { working, monthPay } = useMemo(() => {
    const working = records.filter((r) => r.date === today && r.check_in && !r.check_out).length;
    const monthPay = staff.reduce((sum, s) => {
      const min = records
        .filter((r) => r.staff_id === s.id && r.date.startsWith(ym))
        .reduce((a, r) => a + liveMinutes(r), 0);
      return sum + Math.round((min * (wages[s.id] ?? DEFAULT_HOURLY_WAGE)) / 60);
    }, 0);
    return { working, monthPay };
  }, [records, wages, today, ym, staff]);
  // 매장 진행률: 오늘 떠야 하는 것 중 가게 전체(shared) + 내 private(대상=나 or 내가 배정). (직원 자가등록은 제외)
  const todaysTasks = useMemo(
    () => templates.filter((t) => occursOn(t, today) && (t.scope !== 'private' || t.ownerId === userId || t.createdBy === userId)),
    [templates, today, userId],
  );
  const taskTotal = todaysTasks.length;
  const taskDoneCount = todaysTasks.filter((t) => (doneMap[today] ?? {})[t.id]).length;

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  const pending = pendingList.length;

  // 혼자 모드 후킹 F3 — 매장 두뇌 완성도. 가장 빈 카테고리를 한 탭으로 채우러 보냄.
  const brain = useMemo(() => computeBrainScore(entries), [entries]);
  const isSolo = staff.length === 0; // 직원 미합류 = 혼자 모드

  const topFaq = useMemo(
    () =>
      [...pendingList]
        .sort((a, b) => b.similar_queries_count - a.similar_queries_count)
        .slice(0, 3),
    [pendingList],
  );

  return {
    userName,
    storeName,
    entriesCount: entries.length,
    working,
    monthPay,
    taskTotal,
    taskDoneCount,
    pending,
    topFaq,
    brain,
    isSolo,
  };
}
