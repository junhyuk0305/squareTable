import { useEffect, useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useHubStore } from '@/lib/store/useHubStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useWorkStore, occursOn, taskVisibleTo } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import { todayStr } from '@/lib/utils/attendance';
import { gradableTasks, staffBehind, type StaffBehind } from '@/lib/utils/taskProgress';
import { sortByUrgency } from '@/lib/utils/unknownQuery';
import type { UnknownQuery } from '@/types';

export type OwnerDashboardData = {
  /**
   * 이 화면이 "0건"이라고 **판단해도 되는가**.
   *
   * Supabase 모드에서 스토어는 전부 `[]` + `loaded:false` 로 시작한다. 즉 배열 길이만 보면
   * "정말 0건"과 "아직 안 옴"이 같은 값이라, 노하우 18개인 매장에서도 온보딩 블록이 0.3초 스친다.
   * 빈 상태·온보딩·"없어요" 같은 **단정**은 이 값이 true 일 때만 그린다.
   *
   * 읽기 '실패'는 여기서 로딩으로 위장하지 않는다 — 실패해도 loaded 는 true 가 되고(스토어 계약),
   * 표면화는 전역 SyncBanner(db.ts readFail)와 화면별 loadError 가 맡는다.
   */
  loaded: boolean;
  userName: string;
  storeName: string;
  entriesCount: number;
  needsReviewCount: number;
  working: number;
  /** 오늘 떠야 하는 업무 — 홈 목록(3건 + 전체보기)용. 완료 여부까지 붙여 표시 전용으로 내보낸다. */
  todayTasks: { id: string; text: string; done: boolean }[];
  pending: number;
  /** 사장 홈 히어로 = 가장 오래 기다린 미답변 질문 1건. 받은질문 화면의 hero와 **같은 1건**(sortByUrgency SSOT). */
  heroQuery?: UnknownQuery;
  /** heroQuery 작성자의 입사 경과일 — 익명이면 undefined. */
  heroCareerDays?: number;
  /**
   * 이번 달(KST) 이 매장의 AI 답변 사용 건수 — 허브 현황의 'AI 답변 사용'과 **같은 원천**(owner_overview.ai_used).
   *
   * ★2026-08-07: 옛 '30일간 대신 답함'(Σ query_hits_30d)을 대체한다. 두 숫자는 정의가 달랐는데
   *   (롤링 30일 vs 이번 달 · 노하우가 쓰인 답만 vs 모든 AI 답변 · 현재 매장 vs 전체 매장)
   *   이름이 그 차이를 안 알려줘 같은 말로 읽혔다. 이름과 정의를 'AI 답변 사용' 하나로 통일했다.
   *   잃은 '가치 증명'은 숫자가 아니라 **목록**이 맡는다 — 받은질문의 'AI가 답함' 세그먼트.
   */
  aiUsedMonth: number;
  /** 사장이 아직 답 안 한 직원 제안 건수 — 홈 '다음 행동' 2순위. */
  pendingSuggestions: number;
  /** 퀴즈에서 오답이 몰린 노하우 수 — 3순위. 판정 기준(표본 5·오답률 40%)의 SSOT는 useQuizBoard. */
  missedKnowhowCount: number;
  /** 진도가 가장 많이 밀린 직원 1명 — 4순위. 없으면 undefined. */
  behindStaff?: StaffBehind;
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

  // 빈 상태 판정의 전제 — 이 화면이 읽는 스토어 4개가 전부 도착했는가.
  // (staff·suggestion·quiz 는 이 화면에서 "0건"을 단정하는 자리가 없어 게이트에 넣지 않는다.)
  const playbookLoaded = usePlaybookStore((s) => s.loaded);
  const queueLoaded = useUnknownQueueStore((s) => s.loaded);
  const workLoaded = useWorkStore((s) => s.loaded);
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const loaded = playbookLoaded && queueLoaded && workLoaded && attendanceLoaded;

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

  // AI 답변 사용(이번 달) — 허브와 같은 definer RPC(owner_overview, 0081)를 그대로 읽는다.
  // 새 권한 경로가 아니고, 같은 화면 두 곳이 다른 말을 하지 않게 원천을 하나로 둔다.
  const overview = useHubStore((s) => s.overview);
  const activeUnitId = useSessionStore((s) => s.unitId);
  useEffect(() => { void useHubStore.getState().hydrateOwner(); }, []);
  const aiUsedMonth = useMemo(
    () => overview.find((r) => r.unit_id === activeUnitId)?.ai_used ?? 0,
    [overview, activeUnitId],
  );

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  const pending = pendingList.length;

  // 홈 히어로 1건 — 받은질문 화면과 같은 정렬을 쓴다(sortByUrgency = 판정 SSOT).
  // 두 화면이 다른 질문을 가리키면 "가장 오래 기다린 질문"이라는 말이 거짓이 된다.
  const heroQuery = useMemo(() => sortByUrgency(pendingList)[0], [pendingList]);
  const heroCareerDays = useMemo(() => {
    if (!heroQuery || heroQuery.anonymous) return undefined;
    return staff.find((s) => s.id === heroQuery.junior_id)?.career_days;
  }, [heroQuery, staff]);

  // 미검증(needs_review) 노하우 — 템플릿/업종팩 fork 등 사장이 아직 우리 매장 기준으로 안 다듬은 것.
  // 0보다 크면 대시보드 최상단 배너로 먼저 노출(검증 유도).
  const needsReviewCount = useMemo(() => entries.filter((e) => e.needs_review === true).length, [entries]);

  // ── 홈 '다음 행동' 한 자리를 채우는 나머지 신호들 ──────────────────────────
  // 스토어는 전부 owner/_layout에서 이미 hydrate·subscribe 중이라 여기서 새로 부르지 않는다.
  const pendingSuggestions = useSuggestionStore(
    (s) => s.suggestions.filter((x) => x.status === 'pending').length,
  );

  // 오답 판정(표본 5회·오답률 40%)은 useQuizBoard가 SSOT다 — 여기서 다시 정의하면
  // 홈과 퀴즈 화면이 같은 노하우를 두고 다른 말을 하게 된다.
  // ⚠️ 비용: 이 훅은 마운트 시 코스·문항·오답집계 3쿼리를 스스로 친다(홈 진입마다).
  const { buildRows } = useQuizBoard();
  const missedKnowhowCount = useMemo(
    () => buildRows(null).filter((r) => r.missPct > 0).length,
    [buildRows],
  );

  // 진도가 밀린 직원 — 판정 대상 게이트(노하우≥1 ∧ 문항≥1)를 반드시 통과시킨다.
  // 게이트가 없으면 노하우 안 붙은 업무에서 전원이 '못 함'으로 나온다.
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const understanding = useWorkStore((s) => s.understanding);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  const behindStaff = useMemo(
    () =>
      staffBehind(
        staff,
        gradableTasks(templates, knowhowLinks, quizCounts),
        understanding,
        knowhowLinks,
      )[0],
    [staff, templates, knowhowLinks, quizCounts, understanding],
  );

  return {
    loaded,
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
    aiUsedMonth,
    pendingSuggestions,
    missedKnowhowCount,
    behindStaff,
  };
}
