import { useMemo } from 'react';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useWorkStore, useDayparts, daypartRoutineTemplates, occursOn, taskVisibleTo } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useScheduleStore, shiftsOn, pendingApprovals } from '@/lib/store/useScheduleStore';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import { todayStr, hhmm } from '@/lib/utils/attendance';
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
  entriesCount: number;
  needsReviewCount: number;
  /**
   * 오늘 떠야 하는 업무 — 홈 목록(3건 + 전체보기)용. 완료 여부까지 붙여 표시 전용으로 내보낸다.
   * ★완료자·완료시각을 같이 낸다 — 감시원칙 D1이 "완료 시각 노출은 감시 위반이 아니라 의도된 기능"으로
   *   정한 값이다. 예전엔 `!!`로 boolean 으로 눌러 DoneMark 의 byName·at 을 버리고 있었다.
   */
  todayTasks: { id: string; text: string; done: boolean; doneBy?: string; doneAt?: string; assignee?: string }[];
  /** 오늘 출근한 사람(출근 시각순) — 홈 '오늘' 카드 머리줄. */
  duty: { staffId: string; name: string; at: string }[];
  /**
   * 오늘 근무 예정인데 아직 출근 전인 인원 **수**.
   * ★이름을 내지 않는다 — 개인 근태 지적은 홈이 할 일이 아니다(D1이 연 것은 완료 시각까지다).
   *   누가 안 왔는지는 근무표에서 본다.
   */
  dutyPlanned: number;
  /** 근무표·출퇴근이 둘 다 도착했는가 — duty 줄을 그려도 되는지(0명 단정 방지). */
  dutyLoaded: boolean;
  /** 직원끼리 합의가 끝나 사장 승인만 남은 교대 — 홈 '다음 행동' 1순위. */
  pendingSwaps: number;
  pending: number;
  /** 사장 홈 히어로 = 가장 오래 기다린 미답변 질문 1건. 받은질문 화면의 hero와 **같은 1건**(sortByUrgency SSOT). */
  heroQuery?: UnknownQuery;
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

  const queue = useUnknownQueueStore((s) => s.queue);
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
  // 2026-08-07: 같은 이유로 근무 중 인원(working)·userName·storeName·heroCareerDays도 제거했다 —
  // MiniStats가 사라진 뒤 사장 홈에서 읽는 곳이 하나도 없었다(출퇴근 현황은 /owner/attendance가 소유).
  // 매장 진행률: 오늘 떠야 하는 것 중 가게 전체(shared) + 내 private(대상=나 or 내가 배정). (직원 자가등록은 제외)
  //
  // ★2026-08-12: 홈이 `work_templates` 만 보고 있어 **매장 공통 루틴(schedule_config.dayparts)이 통째로
  //   빠져 있었다.** 온보딩이 심어준 오픈·마감 루틴은 업무 탭에서만 보이고, 직접 만든 업무가 0건인
  //   신규 매장은 홈 '오늘' 카드가 조건에 안 걸려 **섹션째로 사라졌다**(빈 화면으로 보이던 그 증상).
  //   파생 함수는 업무 탭(boardTemplates)과 **같은 daypartRoutineTemplates 하나**를 쓴다 — 규칙을 두 벌로 만들지 않는다.
  //   방(roomId) 필터는 걸지 않는다: 사장 홈이 말하는 것은 "오늘 이 매장의 업무 전부"다.
  const dayparts = useDayparts();
  const allTemplates = useMemo(() => [...daypartRoutineTemplates(dayparts), ...templates], [dayparts, templates]);
  const todaysTasks = useMemo(
    () => allTemplates.filter((t) => occursOn(t, today) && taskVisibleTo(t, userId)),
    [allTemplates, today, userId],
  );
  // 홈 목록용 — 남은 일이 먼저 보이도록 미완료를 위로. todaysTasks(가시성 필터)를 그대로 재사용한다.
  const todayTasks = useMemo(() => {
    const doneToday = doneMap[today] ?? {};
    // 담당자 이름 — 아직 아무도 안 끝낸 일이 "누구 몫인지"를 홈에서 바로 읽게 한다(완료 후엔 완료자가 그 자리를 쓴다).
    const nameOfMember = (id: string) => (id === userId ? '나' : staff.find((x) => x.id === id)?.name ?? '직원');
    return todaysTasks
      .map((t) => {
        const mark = doneToday[t.id];
        return {
          id: t.id,
          text: t.text,
          done: !!mark,
          doneBy: mark?.byName,
          doneAt: mark?.at ? hhmm(mark.at) : undefined,
          assignee: t.ownerId ? nameOfMember(t.ownerId) : undefined,
        };
      })
      .sort((a, b) => Number(a.done) - Number(b.done));
  }, [todaysTasks, doneMap, today, staff, userId]);

  // ── 오늘 근무 ──────────────────────────────────────────────────────────────
  // 2026-08-12: 홈에서 '출근 현황'을 별도 블록으로 되살리지 않고 '오늘' 카드 머리줄로 흡수했다.
  // (블록 수는 그대로, 정보만 는다. 08-07에 뺐던 것을 같은 형태로 되돌리지 않기 위한 선택.)
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const scheduleLoaded = useScheduleStore((s) => s.loaded);
  const records = useAttendanceStore((s) => s.records);

  // 오늘 실제 근무자 — 승인된 교대까지 반영된 shiftsOn 이 판정 SSOT다(근무표 화면과 같은 것).
  const todayShifts = useMemo(
    () => shiftsOn(shiftTemplates, swaps, today),
    [shiftTemplates, swaps, today],
  );

  // 출근 = check_in 이 찍힌 오늘 기록. 퇴근한 사람도 포함한다("오늘 나온 사람"이 홈이 말하는 것).
  const duty = useMemo(() => {
    const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';
    return records
      .filter((r) => r.date === today && r.check_in)
      .sort((a, b) => a.check_in!.localeCompare(b.check_in!))
      .map((r) => ({ staffId: r.staff_id, name: nameOf(r.staff_id), at: hhmm(r.check_in!) }));
  }, [records, today, staff]);

  // 근무 예정인데 아직 안 찍은 인원 수. 한 사람이 하루 두 타임이어도 1명으로 센다(Set).
  const dutyPlanned = useMemo(() => {
    const arrived = new Set(duty.map((d) => d.staffId));
    return new Set(todayShifts.map((s) => s.workerStaffId).filter((id) => !arrived.has(id))).size;
  }, [todayShifts, duty]);

  // 사장 승인만 남은 교대 — 근무표 화면과 같은 판정(pendingApprovals).
  const pendingSwaps = useMemo(() => pendingApprovals(swaps, today).length, [swaps, today]);

  // 2026-08-06: 담당자별 배정 요약(assign)은 홈에서 OwnerWorkValueCard가 사라지며 소비자가 없어져 제거했다.
  // "누가 무슨 일"은 /owner/work(AssignBoard)가 담당한다.

  // 2026-08-07: 'AI 답변 사용(이번 달)'은 홈에 소비자가 없어 제거했다. 그것 하나 때문에
  // 홈에 들어올 때마다 useHubStore.hydrateOwner()(owner_overview RPC)를 한 번씩 더 쳤다.
  // 이 숫자가 필요한 곳은 허브 현황(/hub#owner)이고, 거기서 같은 스토어를 그대로 읽는다.

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  // ★히어로 큰 수는 **대기열 전체 규모**다 → 목록 길이가 아니라 서버 집계를 쓴다.
  //   목록은 상한(PAGE_LIMIT)까지만 불러오므로, 길이로 세면 1,200건 매장이 "1000건"이 된다(2026-08-08 실측).
  //   못 셌으면(null) 목록 길이로 물러난다 — 없는 수를 지어내지 않는다.
  const pendingTotal = useUnknownQueueStore((s) => s.pendingTotal);
  const pending = pendingTotal ?? pendingList.length;

  // 홈 히어로 1건 — 받은질문 화면과 같은 정렬을 쓴다(sortByUrgency = 판정 SSOT).
  // 두 화면이 다른 질문을 가리키면 "가장 오래 기다린 질문"이라는 말이 거짓이 된다.
  const heroQuery = useMemo(() => sortByUrgency(pendingList)[0], [pendingList]);

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
    // 검토 대기(draft·인수인계서 파이프라인 초안)는 자산 카운트에서 제외 —
    // 발행 전 초안이 "노하우 N개"를 부풀리면 지표가 정직하지 않다(검수는 handover 배너가 담당).
    entriesCount: entries.filter((e) => e.status !== 'draft').length,
    needsReviewCount,
    todayTasks,
    duty,
    dutyPlanned,
    // 두 축이 다 와야 "0명"이 참이 된다 — 위 loaded 에 섞지 않는다(섞으면 홈 전체가 근무표를 기다린다).
    dutyLoaded: scheduleLoaded && attendanceLoaded,
    pendingSwaps,
    pending,
    heroQuery,
    pendingSuggestions,
    missedKnowhowCount,
    behindStaff,
  };
}
