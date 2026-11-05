// 관리 화면 세트(사장·매니저) 알림의 입력 — 알림 목록(owner/notifications.tsx)·벨(OwnerNotificationBell)·앱 배지(appBadge)가 이 하나를 쓴다.
// 왜 훅인가(오류 탐지 11-03 #7·#11): 세 곳이 인자를 따로 조립해서 벨·배지에 courses·퀴즈 진행이 빠졌다.
//   그래서 매니저 본인 퀴즈가 목록과 배지에서 다르게 셌다(손님용 포함 · 멈춘 퀴즈 포함 · 옛 퀴즈 누락).
// 퀴즈 입력은 직원 벨(NotificationBell)과 같은 처리를 한다: 진행 조회가 실패하면 undefined(완료 여부 폴백) · 옛 퀴즈는 조회 중이면 빈 목록.
import { useMemo } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useStaffStore, memberNameOf } from '@/lib/store/useStaffStore';
import { usePaymentClaimStore } from '@/lib/store/usePaymentClaimStore';
import { useOwnerAlertStore } from '@/lib/store/useOwnerAlertStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useLegacyQuizOpen } from '@/lib/hooks/useLegacyQuizOpen';
import { todayStr } from '@/lib/utils/attendance';
import type { buildOwnerNotifications, ManagerReceivedArgs } from '@/lib/utils/notifications';

const EMPTY_IDS: string[] = [];

export type ManageOwnerArgs = Parameters<typeof buildOwnerNotifications>[0];

export function useManageNotifArgs(): { ownerArgs: ManageOwnerArgs; received: ManagerReceivedArgs } {
  const me = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const ackAt = useMemberPrefsStore((s) => (unitId ? (s.ackByUnit[unitId] ?? null) : null));
  const queue = useUnknownQueueStore((s) => s.queue);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const swaps = useScheduleStore((s) => s.swaps);
  const timeRequests = useScheduleStore((s) => s.timeRequests); // 근무 시간 수정 요청(0243 · 대기만)
  const scheduleNotices = useScheduleStore((s) => s.notices); // 근무 알림·역할 변경·나감·합류(0315·0317·0346)
  const shiftTemplates = useScheduleStore((s) => s.templates); // 받은 교대 요청 본문의 근무 시각
  const staff = useStaffStore((s) => s.staff);
  const owner = useStaffStore((s) => s.owner);
  const pending = useStaffStore((s) => s.pending);
  const joinDone = useStaffStore((s) => s.joinDone); // 처리한 합류 신청(0345) — 목록 내역만 · 안 읽음으로 세지 않는다
  const feed = useWorkStore((s) => s.feed);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const assignments = useWorkStore((s) => s.assignments);
  const courses = useWorkStore((s) => s.courses);
  const quizProgressRaw = useWorkStore((s) => s.quizProgress);
  const quizProgressError = useWorkStore((s) => s.quizProgressError);
  const legacyQuizIds = useLegacyQuizOpen().ids ?? EMPTY_IDS;
  const claims = usePaymentClaimStore((s) => s.claims);
  const alerts = useOwnerAlertStore((s) => s.alerts);
  const today = todayStr();

  return useMemo(() => {
    // 매니저에게 배정한 사람은 사장이다 — 명부 SSOT(memberNameOf · 사장 포함). '직원'은 명부에 없을 때만.
    const nameOf = (id: string) => memberNameOf({ owner, staff }, id) ?? '직원';
    const quizProgress = quizProgressError ? undefined : quizProgressRaw;
    return {
      ownerArgs: { queue, suggestions, swaps, pending, nameOf, feed, userId: me, ackAt, claims, alerts, assignments, courses, timeRequests, joinDone },
      received: { feed, taskTemplates: templates, done, today, suggestions, userId: me, nameOf, ackAt, scheduleNotices, shiftTemplates, quizProgress, legacyQuizIds },
    };
  }, [queue, suggestions, swaps, pending, owner, staff, feed, me, ackAt, claims, alerts, assignments, courses, timeRequests, joinDone, templates, done, today, scheduleNotices, shiftTemplates, quizProgressRaw, quizProgressError, legacyQuizIds]);
}
