import { useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore, occursOn, taskVisibleTo } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { todayStr, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';
import { computePay } from '@/lib/utils/payroll';
import type { UnknownQuery } from '@/types';

export type OwnerDashboardData = {
  userName: string;
  storeName: string;
  entriesCount: number;
  needsReviewCount: number;
  working: number;
  monthPay: number;
  taskTotal: number;
  taskDoneCount: number;
  pending: number;
  topFaq: UnknownQuery[];
  /** 최근 30일 노하우가 알바 질문에 '대신 답한' 실카운트(Σ query_hits_30d). 히어로 가치 지표. */
  answeredHits30d: number;
  /** 오늘 배정 요약 — 담당자별 그룹(누가 무슨 일). */
  assign: AssignSummary;
  isSolo: boolean;
};

export type AssignGroup = { key: string; name: string; total: number; done: number };
export type AssignSummary = { total: number; done: number; groups: AssignGroup[] };

/** 사장 대시보드 화면의 뷰모델 — 스토어 셀렉터 읽기 + 파생값 계산을 한곳에 모은다. */
export function useOwnerDashboardData(): OwnerDashboardData {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  // 실매장 이름은 세션(프로필→unit)에서.
  const storeName = useSessionStore((s) => s.storeName) || '내 매장';

  const queue = useUnknownQueueStore((s) => s.queue);
  const records = useAttendanceStore((s) => s.records);
  const wages = usePayrollStore((s) => s.wages);
  const settings = usePayrollStore((s) => s.settings);
  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const { working, monthPay } = useMemo(() => {
    const working = records.filter((r) => r.date === today && r.check_in && !r.check_out).length;
    // 급여 규칙(주휴·휴게·야간·연장·추가수당)을 반영한 실제 예상 인건비 — computePay SSOT(F1).
    const monthPay = staff.reduce((sum, s) => {
      const recs = records.filter((r) => r.staff_id === s.id && r.date.startsWith(ym));
      return sum + computePay(recs, wages[s.id] ?? DEFAULT_HOURLY_WAGE, settings).total;
    }, 0);
    return { working, monthPay };
  }, [records, wages, today, ym, staff, settings]);
  // 매장 진행률: 오늘 떠야 하는 것 중 가게 전체(shared) + 내 private(대상=나 or 내가 배정). (직원 자가등록은 제외)
  const todaysTasks = useMemo(
    () => templates.filter((t) => occursOn(t, today) && taskVisibleTo(t, userId)),
    [templates, today, userId],
  );
  const taskTotal = todaysTasks.length;
  const taskDoneCount = todaysTasks.filter((t) => (doneMap[today] ?? {})[t.id]).length;

  // 오늘 배정 요약 — 담당자별 그룹(private=대상자 ownerId / shared=매장 공통). "누가 무슨 일"의 홈 요약.
  // todaysTasks(occursOn+가시성 필터)를 SSOT로 재사용해 배정 판정을 복제하지 않는다.
  const assign = useMemo<AssignSummary>(() => {
    const doneToday = doneMap[today] ?? {};
    const map = new Map<string, AssignGroup>();
    for (const t of todaysTasks) {
      const key = (t.scope ?? 'shared') === 'private' ? (t.ownerId ?? 'me') : 'shared';
      const name = key === 'shared' ? '매장 공통' : (staff.find((s) => s.id === key)?.name ?? '나');
      const g = map.get(key) ?? { key, name, total: 0, done: 0 };
      g.total += 1;
      if (doneToday[t.id]) g.done += 1;
      map.set(key, g);
    }
    // 미완료 많은 순 → 사장이 볼 것(남은 일)을 먼저. 공통은 뒤로.
    const groups = [...map.values()].sort((a, b) => {
      if (a.key === 'shared') return 1;
      if (b.key === 'shared') return -1;
      return (b.total - b.done) - (a.total - a.done);
    });
    return { total: todaysTasks.length, done: groups.reduce((s, g) => s + g.done, 0), groups };
  }, [todaysTasks, doneMap, today, staff]);

  // 최근 30일 노하우 자동응답 실카운트 — 발행된 노하우의 query_hits_30d 합.
  // "사장님 대신 답한 횟수"의 정직한 근거(0037 노하우 사용통계). 지어낸 값 아님.
  const answeredHits30d = useMemo(
    () =>
      entries.reduce(
        (sum, e) => sum + ((e.status === 'published' || !e.status) ? (e.stats?.query_hits_30d ?? 0) : 0),
        0,
      ),
    [entries],
  );

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  const pending = pendingList.length;

  const isSolo = staff.length === 0; // 직원 미합류 = 혼자 모드

  // 미검증(needs_review) 노하우 — 템플릿/업종팩 fork 등 사장이 아직 우리 매장 기준으로 안 다듬은 것.
  // 0보다 크면 대시보드 최상단 배너로 먼저 노출(검증 유도).
  const needsReviewCount = useMemo(() => entries.filter((e) => e.needs_review === true).length, [entries]);

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
    // 검토 대기(draft·인수인계서 파이프라인 초안)는 자산 카운트에서 제외 —
    // 발행 전 초안이 "노하우 N개"를 부풀리면 지표가 정직하지 않다(검수는 handover 배너가 담당).
    entriesCount: entries.filter((e) => e.status !== 'draft').length,
    needsReviewCount,
    working,
    monthPay,
    taskTotal,
    taskDoneCount,
    pending,
    topFaq,
    answeredHits30d,
    assign,
    isSolo,
  };
}
