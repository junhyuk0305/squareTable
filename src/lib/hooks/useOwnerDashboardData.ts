import { useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useWorkStore, occursOn, taskVisibleTo } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { todayStr } from '@/lib/utils/attendance';
import { sortByUrgency } from '@/lib/utils/unknownQuery';
import type { UnknownQuery } from '@/types';

export type OwnerDashboardData = {
  userName: string;
  storeName: string;
  entriesCount: number;
  needsReviewCount: number;
  working: number;
  /** 오늘 떠야 하는 업무 — 홈 목록(3건 + 전체보기)용. 완료 여부까지 붙여 표시 전용으로 내보낸다. */
  todayTasks: { id: string; text: string; done: boolean }[];
  pending: number;
  /** 사장 홈 히어로 = 가장 시급한 미답변 질문 1건. 받은질문 화면의 hero와 **같은 1건**(sortByUrgency SSOT). */
  heroQuery?: UnknownQuery;
  /** heroQuery 작성자의 입사 경과일 — 익명이면 undefined. */
  heroCareerDays?: number;
  /** 최근 30일 노하우가 알바 질문에 '대신 답한' 실카운트(Σ query_hits_30d). 히어로 가치 지표. */
  answeredHits30d: number;
};

/** 사장 대시보드 화면의 뷰모델 — 스토어 셀렉터 읽기 + 파생값 계산을 한곳에 모은다. */
export function useOwnerDashboardData(): OwnerDashboardData {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  // 실매장 이름은 세션(프로필→unit)에서.
  const storeName = useSessionStore((s) => s.storeName) || '내 매장';

  const queue = useUnknownQueueStore((s) => s.queue);
  const records = useAttendanceStore((s) => s.records);
  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);

  const today = todayStr();

  // 2026-08-06: 인건비(monthPay)는 홈 KPI가 MiniStats로 흡수되며 소비자가 사라져 제거했다.
  // 인건비는 /owner/staff·/owner/payroll이 각자 computePay로 계산한다(SSOT는 그대로 computePay).
  const working = useMemo(
    () => records.filter((r) => r.date === today && r.check_in && !r.check_out).length,
    [records, today],
  );
  // 매장 진행률: 오늘 떠야 하는 것 중 가게 전체(shared) + 내 private(대상=나 or 내가 배정). (직원 자가등록은 제외)
  const todaysTasks = useMemo(
    () => templates.filter((t) => occursOn(t, today) && taskVisibleTo(t, userId)),
    [templates, today, userId],
  );
  // 홈 목록용 — 남은 일이 먼저 보이도록 미완료를 위로. todaysTasks(가시성 필터)를 그대로 재사용한다.
  const todayTasks = useMemo(() => {
    const doneToday = doneMap[today] ?? {};
    return todaysTasks
      .map((t) => ({ id: t.id, text: t.text, done: !!doneToday[t.id] }))
      .sort((a, b) => Number(a.done) - Number(b.done));
  }, [todaysTasks, doneMap, today]);

  // 2026-08-06: 담당자별 배정 요약(assign)은 홈에서 OwnerWorkValueCard가 사라지며 소비자가 없어져 제거했다.
  // "누가 무슨 일"은 /owner/work(AssignBoard)가 담당한다.

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

  // 홈 히어로 1건 — 받은질문 화면과 같은 정렬을 쓴다(sortByUrgency = 판정 SSOT).
  // 두 화면이 다른 질문을 가리키면 "가장 시급"이라는 말이 거짓이 된다.
  const heroQuery = useMemo(() => sortByUrgency(pendingList)[0], [pendingList]);
  const heroCareerDays = useMemo(() => {
    if (!heroQuery || heroQuery.anonymous) return undefined;
    return staff.find((s) => s.id === heroQuery.junior_id)?.career_days;
  }, [heroQuery, staff]);

  // 미검증(needs_review) 노하우 — 템플릿/업종팩 fork 등 사장이 아직 우리 매장 기준으로 안 다듬은 것.
  // 0보다 크면 대시보드 최상단 배너로 먼저 노출(검증 유도).
  const needsReviewCount = useMemo(() => entries.filter((e) => e.needs_review === true).length, [entries]);

  return {
    userName,
    storeName,
    // 검토 대기(draft·인수인계서 파이프라인 초안)는 자산 카운트에서 제외 —
    // 발행 전 초안이 "노하우 N개"를 부풀리면 지표가 정직하지 않다(검수는 handover 배너가 담당).
    entriesCount: entries.filter((e) => e.status !== 'draft').length,
    needsReviewCount,
    working,
    todayTasks,
    pending,
    heroQuery,
    heroCareerDays,
    answeredHits30d,
  };
}
