// lib/push/notify.ts
// 인앱 이벤트 → 웹푸시 발송 트리거. db.ts/스토어의 쓰기 성공 직후 호출한다.
//
// 설계: fire-and-forget. 알림 발송 실패가 원래 작업(공지 등록·교대 신청)을 막으면 안 되므로
//   절대 throw 하지 않고, UI 흐름을 블록하지 않는다(await 하지 않아도 됨). 실제 발송/대상 해석/
//   테넌트 격리는 서버(supabase/functions/push)가 담당 — 여기선 "무엇을 누구에게" 만 넘긴다.
//
// 인앱 알림(벨 뱃지·목록)은 기존 SSOT(lib/utils/notifications.ts)가 그대로 담당한다.
// 이 파일은 그 위에 "앱이 꺼져 있어도 오는 OS 알림" 만 얹는다 — 두 경로가 같은 이벤트를 가리킨다.

import { supabase, HAS_SUPABASE } from '@/lib/supabase';

export type PushAudience = 'owners' | 'staff' | 'user' | 'join_owners';

type NotifyArgs = {
  audience: PushAudience;
  /** audience='user' 일 때 대상 사용자 id. */
  userId?: string;
  title: string;
  body?: string;
  /** 클릭 시 열 앱 내부 경로(예: '/owner/inbox'). */
  url?: string;
  /** 같은 알림 덮어쓰기용 태그(중복 누적 방지). */
  tag?: string;
};

/** 웹푸시 발송(비차단). 서버가 호출자 매장 안으로만 발송하도록 강제한다. */
export function pushNotify(args: NotifyArgs): void {
  if (!HAS_SUPABASE) return;
  // await 하지 않는다 — 발송은 배경에서. 실패는 조용히 삼킨다(인앱 알림이 폴백).
  void supabase.functions
    .invoke('push', { body: args })
    .catch((e) => console.warn('[push] notify 실패:', e?.message ?? e));
}

// ── 이벤트별 헬퍼 (호출부가 문자열을 안 틀리게 얇게 감싼다) ────────────────
// 사장이 받는 것들 (직원 행동 → 사장)
// 합류 신청은 신청자가 아직 그 매장 소속이 아니다(pending). 서버가 신청자의 pending_unit_id 를
// 해석해 그 매장 사장에게만 보낸다 → 신청한 매장 밖으로는 절대 못 보낸다(테넌트 안전).
export const notifyOwnersJoinRequest = (name: string) =>
  pushNotify({
    audience: 'join_owners',
    title: '합류 신청',
    body: `${name}님이 합류를 신청했어요`,
    url: '/owner/staff',
    tag: 'join',
  });

export const notifyOwnersQuestion = (q: string) =>
  pushNotify({
    audience: 'owners',
    title: '답변 대기 질문',
    body: q,
    url: '/owner/inbox',
    tag: 'question',
  });

export const notifyOwnersSuggestion = (name: string, text: string) =>
  pushNotify({
    audience: 'owners',
    title: `${name}님의 노하우 제안`,
    body: text,
    url: '/owner/suggestions',
    tag: 'suggestion',
  });

export const notifyOwnersSwapApproval = (when: string) =>
  pushNotify({
    audience: 'owners',
    title: '교대 승인 대기',
    body: `교대 요청이 승인을 기다려요 · ${when}`,
    url: '/owner/schedule',
    tag: 'swap-approval',
  });

// 직원이 받는 것들 (사장/동료 행동 → 직원)
export const notifyStaffNotice = (author: string, text: string) =>
  pushNotify({
    audience: 'staff',
    title: `${author}님의 공지`,
    body: text,
    url: '/junior/work',
    tag: 'notice',
  });

/** 대타 요청 — 아무나 수락 가능하므로 매장 직원 전체에게. */
export const notifyStaffSwapRequest = (when: string) =>
  pushNotify({
    audience: 'staff',
    title: '대타 요청',
    body: `교대 대타를 찾고 있어요 · ${when}`,
    url: '/junior/schedule',
    tag: 'swap-req',
  });

/** 맞교환 요청 — 상대가 지정된 경우 그 직원에게만. */
export const notifyUserSwapRequest = (userId: string, when: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: '맞교환 요청',
    body: `나에게 맞교환을 요청했어요 · ${when}`,
    url: '/junior/schedule',
    tag: 'swap-req',
  });

export const notifyUserSwapResult = (userId: string, ok: boolean, when: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: ok ? '교대 확정' : '교대 반려',
    body: when,
    url: '/junior/schedule',
    tag: 'swap-result',
  });

export const notifyUserMention = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: `${author}님이 나를 언급했어요`,
    body: text,
    url: '/junior/work',
    tag: 'mention',
  });

/** 할일 배정 — 사장/동료가 나에게 할일을 배정했을 때 그 담당자에게만. */
export const notifyUserAssign = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: `${author}님이 할 일을 배정했어요`,
    body: text,
    url: '/junior/work',
    tag: 'assign',
  });
