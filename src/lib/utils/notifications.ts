// 직원 알림 — 단일 진실원천(SSOT).
// 벨 뱃지(개수)와 알림 화면(목록)이 같은 술어/집계를 공유한다.
// UI(아이콘·틴트·onPress)는 화면이 kind로 매핑 — 여기선 순수 데이터만 만든다.
import type { FeedItem, TaskTemplate, DoneMark } from '@/lib/store/useWorkStore';
import { occursOn } from '@/lib/store/useWorkStore';
import type { SwapRequest, ShiftTemplate } from '@/lib/store/useScheduleStore';
import type { PendingMember } from '@/lib/store/useStaffStore';
import type { UnknownQuery, PlaybookSuggestion, PaymentClaim } from '@/types';
import { fmtDateKo } from '@/lib/utils/schedule';
// 요금제 표시명은 tiers.ts 가 SSOT — 알림 문구에서 이름을 재정의하지 않는다.
import { PLANS } from '@/lib/config/tiers';

/** 알림 목록 최대 개수 — 무한 누적 방지(최신 우선). */
export const MAX_NOTIFS = 50;

export type JuniorNotifKind =
  | 'notice' | 'mention' | 'assign' | 'swap' | 'swap_approved' | 'swap_rejected'
  | 'suggestion_approved' | 'suggestion_rejected';
export type JuniorNotifRoute = '/junior/work' | '/junior/schedule' | '/junior/chat';

export type JuniorNotif = {
  id: string;
  kind: JuniorNotifKind;
  title: string;
  body?: string;
  at: string; // ISO — 정렬·상대시간 표기용
  unread: boolean;
  route: JuniorNotifRoute;
  /** 탭 시 읽음처리(read_by)할 feed id. 공지·멘션에 설정. */
  readFeedId?: string;
};

// ── 공유 술어(뱃지·목록이 동일 규칙을 쓰도록 한 곳에서) ──────────────
/** '모두 읽기'(0078 notif_ack_at) 이후 항목인가 — ack 이전(at <= ack) 항목은 배지·강조 제외.
 *  처리형 항목(합류·질문·제안·교대)은 read_by 로 못 읽으므로 이 시각 비교가 유일한 읽음 축. */
export const isAfterAck = (at: string | undefined, ackAt?: string | null): boolean =>
  !ackAt || !at || at > ackAt;

/** 안 읽은 공지(나 기준). */
export const isUnreadNotice = (f: FeedItem, me: string): boolean =>
  f.kind === 'notice' && !(f.read_by ?? []).includes(me);

/** 나를 @언급한 글/댓글(내 글 제외). 공지와 동일하게 read_by로 읽음추적 → 안 읽으면 강조·카운트. */
export const isMentionOf = (f: FeedItem, me: string): boolean =>
  (f.mentions ?? []).includes(me) && f.authorId !== me;
export const isUnreadMention = (f: FeedItem, me: string): boolean =>
  isMentionOf(f, me) && !(f.read_by ?? []).includes(me);

/** 남이 나에게 배정한 할일(내가 작성한 건 제외). date에 뜨고, 아직 완료 안 했으면 '해야 할 배정'. */
export const isAssignedToMe = (t: TaskTemplate, me: string): boolean =>
  t.ownerId === me && !!t.createdBy && t.createdBy !== me;
export const isPendingAssignment = (
  t: TaskTemplate,
  me: string,
  today: string,
  done: Record<string, Record<string, DoneMark>>,
): boolean => isAssignedToMe(t, me) && occursOn(t, today) && !done[today]?.[t.id];

/** 내가 올린 제안의 검토 결과(반영/반려) — 반려 사유 전달 축(0014 owner_note). */
export const isMySuggestionResult = (s: PlaybookSuggestion, me: string): boolean =>
  s.proposer_id === me && s.status !== 'pending' && !!s.reviewed_at;

/** 내가 대응할 수 있는 열린 교대 요청(대타 전체 + 나에게 온 맞교환). 지난 날짜 제외. */
export const isIncomingSwap = (r: SwapRequest, me: string, today: string): boolean =>
  r.status === 'open' &&
  r.requester_id !== me &&
  r.date >= today &&
  (r.kind === 'cover' || r.target_staff_id === me);

/** 벨 뱃지 개수 = 안 읽은 공지 + 안 읽은 멘션 + 나에게 배정된(미완료) 할일 + 받은 교대 요청. */
export function juniorUnreadCount(
  feed: FeedItem[],
  swaps: SwapRequest[],
  me: string,
  today: string,
  taskTemplates: TaskTemplate[] = [],
  done: Record<string, Record<string, DoneMark>> = {},
  ackAt?: string | null,
  suggestions: PlaybookSuggestion[] = [],
): number {
  return (
    feed.filter((f) => isUnreadNotice(f, me) && isAfterAck(f.createdAt, ackAt)).length +
    feed.filter((f) => isUnreadMention(f, me) && isAfterAck(f.createdAt, ackAt)).length +
    // 배정 시각 폴백은 목록(buildJuniorNotifications)과 동일하게 — 카운트·목록 강조가 어긋나지 않게.
    taskTemplates.filter((t) => isPendingAssignment(t, me, today, done) && isAfterAck(t.createdAt ?? `${today}T08:00:00`, ackAt)).length +
    swaps.filter((r) => isIncomingSwap(r, me, today) && isAfterAck(r.created_at, ackAt)).length +
    // 내 제안 검토 결과(반영/반려) — read 개념이 없어 '모두 읽기'(ack) 전까지 새 소식으로 센다.
    suggestions.filter((sg) => isMySuggestionResult(sg, me) && isAfterAck(sg.reviewed_at, ackAt)).length
  );
}

/** 알림 목록(시간 역순, MAX_NOTIFS 상한). 공지·멘션·받은 교대요청·내 교대요청 결과. */
export function buildJuniorNotifications(args: {
  feed: FeedItem[];
  swaps: SwapRequest[];
  templates: ShiftTemplate[];
  nameOf: (id: string) => string;
  userId: string;
  today: string;
  /** 업무 할일 템플릿(배정 알림용). 없으면 배정 알림 없음. */
  taskTemplates?: TaskTemplate[];
  /** 완료 상태(date → templateId → 마크). 배정 미완료 판정용. */
  done?: Record<string, Record<string, DoneMark>>;
  /** '모두 읽기' 기준 시각(0078). 이전 항목은 unread=false 로 강조 해제. */
  ackAt?: string | null;
  /** 내 제안 검토 결과(반영/반려 + 반려 사유) 알림용. 없으면 해당 알림 없음. */
  suggestions?: PlaybookSuggestion[];
}): JuniorNotif[] {
  const { feed, swaps, templates, nameOf, userId: me, today, taskTemplates = [], done = {}, ackAt, suggestions = [] } = args;
  const tplById = (id: string) => templates.find((t) => t.id === id);
  const out: JuniorNotif[] = [];

  // 공지 — 안 읽은 건 강조, 읽은 건 이력으로 함께
  for (const f of feed) {
    if (f.kind !== 'notice') continue;
    out.push({
      id: `notice_${f.id}`,
      kind: 'notice',
      title: `${f.authorName}님의 공지`,
      body: f.text,
      at: f.createdAt,
      unread: isUnreadNotice(f, me) && isAfterAck(f.createdAt, ackAt),
      route: '/junior/work',
      readFeedId: f.id,
    });
  }

  // 멘션 — 누군가 글/댓글에서 나를 @언급(내 글 제외). 공지처럼 read_by로 읽음추적 → 안 읽으면 강조.
  for (const f of feed) {
    if (!isMentionOf(f, me)) continue;
    out.push({
      id: `mention_${f.id}`,
      kind: 'mention',
      title: `${f.authorName}님이 나를 언급했어요`,
      body: f.text,
      at: f.createdAt,
      unread: isUnreadMention(f, me) && isAfterAck(f.createdAt, ackAt),
      route: '/junior/work',
      readFeedId: f.id,
    });
  }

  // 배정 — 남이 나에게 배정한 할일. 오늘 떠야 하고 아직 완료 안 했으면 '해야 할 배정'(강조).
  for (const t of taskTemplates) {
    if (!isAssignedToMe(t, me) || !occursOn(t, today)) continue;
    const at = t.createdAt ?? `${today}T08:00:00`;
    out.push({
      id: `assign_${t.id}`,
      kind: 'assign',
      title: `${nameOf(t.createdBy ?? '')}님이 할 일을 배정했어요`,
      body: t.text,
      // 실제 배정(생성) 시각으로 정렬 → 오래된 배정은 자연히 아래로. createdAt 없는 레거시/목업만
      // today 로 폴백(과거 전량-today 고정이 "최신 아닌데 상단 고정" 버그의 원인이었다).
      at,
      unread: !done[today]?.[t.id] && isAfterAck(at, ackAt),
      route: '/junior/work',
    });
  }

  // 받은 교대 요청
  for (const r of swaps) {
    if (!isIncomingSwap(r, me, today)) continue;
    const tpl = tplById(r.template_id);
    out.push({
      id: `swap_${r.id}`,
      kind: 'swap',
      title: `${nameOf(r.requester_id)}님이 ${r.kind === 'cover' ? '대타' : '맞교환'}을 요청했어요`,
      body: `${fmtDateKo(r.date)}${tpl ? ` ${tpl.start}~${tpl.end}` : ''}`,
      at: r.created_at,
      unread: isAfterAck(r.created_at, ackAt),
      route: '/junior/schedule',
    });
  }

  // 내 제안 검토 결과 — 반영/반려(반려 사유 포함). 탭하면 물어보기 탭(내가 보낸 제안 목록이 있는 내공간)으로.
  for (const sg of suggestions) {
    if (!isMySuggestionResult(sg, me)) continue;
    const ok = sg.status === 'approved';
    out.push({
      id: `sugres_${sg.id}`,
      kind: ok ? 'suggestion_approved' : 'suggestion_rejected',
      title: ok ? '내 노하우 제안이 반영됐어요' : '내 노하우 제안이 반려됐어요',
      body: !ok && sg.owner_note ? `${sg.text}\n사유: ${sg.owner_note}` : sg.text,
      at: sg.reviewed_at as string,
      unread: isAfterAck(sg.reviewed_at, ackAt),
      route: '/junior/chat',
    });
  }

  // 내 교대 요청 결과 — 확정/반려
  for (const r of swaps) {
    if (!(r.requester_id === me && (r.status === 'approved' || r.status === 'rejected'))) continue;
    const ok = r.status === 'approved';
    out.push({
      id: `swapres_${r.id}`,
      kind: ok ? 'swap_approved' : 'swap_rejected',
      title: `교대 요청이 ${ok ? '확정됐어요' : '반려됐어요'}`,
      body: fmtDateKo(r.date),
      at: r.updated_at,
      unread: false,
      route: '/junior/schedule',
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS);
}

// ── 사장 알림 (직원 모델과 동일 SSOT 구조) ───────────────────────────
// 사장이 대응해야 할 것: 합류 승인 대기 · 답변 대기 질문 · 알바가 올린 제안 · 승인 대기 교대.
// + 입금 신고 검토 결과(0083) — 처리 대기가 아니라 "우리가 답한 결과"라 사장이 반드시 봐야 한다.
export type OwnerNotifKind =
  | 'join_request' | 'question' | 'suggestion' | 'swap_approval' | 'mention'
  | 'payment_approved' | 'payment_rejected';
export type OwnerNotifRoute =
  | '/owner/inbox' | '/owner/suggestions' | '/owner/schedule' | '/owner/staff' | '/owner/work' | '/billing';

export type OwnerNotif = {
  id: string;
  kind: OwnerNotifKind;
  title: string;
  body?: string;
  at: string;
  unread: boolean;
  route: OwnerNotifRoute;
  /** 탭 시 읽음처리(read_by)할 feed id. 멘션에 설정. */
  readFeedId?: string;
};

// ── 공유 술어(뱃지·목록 동일 규칙) ──
/** 아직 사장이 답 안 한 받은질문. */
export const isPendingQuestion = (u: UnknownQuery): boolean => u.status === 'pending_owner_answer';
/** 검토 대기 중인 알바 제안. */
export const isPendingSuggestion = (s: PlaybookSuggestion): boolean => s.status === 'pending';
/** 직원이 수락해 사장 승인만 남은 교대. */
export const isSwapAwaitingApproval = (r: SwapRequest): boolean => r.status === 'accepted';
/** 검토가 끝난 입금 신고(승인/반려) — 반려 사유 전달 축(0083 reject_reason).
 *  claimed_by 로 좁히지 않는다: 결제는 매장 단위 소식이라 공동 사장 모두가 알아야 한다
 *  (RLS 가 이미 '그 매장 사장'으로 좁혀 놓았다 — 여기서 또 좁히면 두 번째 사장이 결과를 영영 못 본다). */
export const isPaymentResult = (c: PaymentClaim): boolean => c.status !== 'pending' && !!c.reviewed_at;

/** 벨 뱃지 개수 = 합류 승인대기 + 답변대기 질문 + 검토대기 제안 + 승인대기 교대.
 *  pending은 이미 "승인 대기"만 담긴 목록(fetchPendingMembers)이라 그대로 센다. */
export function ownerUnreadCount(
  queue: UnknownQuery[],
  suggestions: PlaybookSuggestion[],
  swaps: SwapRequest[],
  pending: PendingMember[],
  feed: FeedItem[] = [],
  me?: string,
  ackAt?: string | null,
  /** 입금 신고(0083). 통합 알림(cross-store)은 이 축을 공급하지 않으므로 기본 빈 배열. */
  claims: PaymentClaim[] = [],
): number {
  return (
    pending.filter((p) => isAfterAck(p.created_at, ackAt)).length +
    queue.filter((u) => isPendingQuestion(u) && isAfterAck(u.asked_at, ackAt)).length +
    suggestions.filter((s) => isPendingSuggestion(s) && isAfterAck(s.created_at, ackAt)).length +
    swaps.filter((r) => isSwapAwaitingApproval(r) && isAfterAck(r.updated_at, ackAt)).length +
    (me ? feed.filter((f) => isUnreadMention(f, me) && isAfterAck(f.createdAt, ackAt)).length : 0) +
    // 입금 검토 결과 — read 개념이 없어 '모두 읽기'(ack) 전까지 새 소식으로 센다(제안 결과와 동일).
    claims.filter((c) => isPaymentResult(c) && isAfterAck(c.reviewed_at ?? undefined, ackAt)).length
  );
}

/** 사장 알림 목록(시간 역순, MAX_NOTIFS 상한). */
export function buildOwnerNotifications(args: {
  queue: UnknownQuery[];
  suggestions: PlaybookSuggestion[];
  swaps: SwapRequest[];
  pending: PendingMember[];
  nameOf: (id: string) => string;
  /** 사장이 채팅에서 @언급됐는지 판정용(직원 모델과 동일). 없으면 멘션 없음으로 동작. */
  feed?: FeedItem[];
  userId?: string;
  /** '모두 읽기' 기준 시각(0078). 이전 항목은 unread=false 로 강조 해제. */
  ackAt?: string | null;
  /** 입금 신고 검토 결과(0083) 알림용. 없으면 해당 알림 없음. */
  claims?: PaymentClaim[];
}): OwnerNotif[] {
  const { queue, suggestions, swaps, pending, nameOf, feed = [], userId: me, ackAt, claims = [] } = args;
  const out: OwnerNotif[] = [];

  // 멘션 — 직원/동료가 채팅·댓글에서 사장(나)을 @언급(내 글 제외). 탭하면 업무 채팅으로.
  if (me) {
    for (const f of feed) {
      if (!isMentionOf(f, me)) continue;
      out.push({
        id: `mention_${f.id}`,
        kind: 'mention',
        title: `${f.authorName}님이 나를 언급했어요`,
        body: f.text,
        at: f.createdAt,
        unread: isUnreadMention(f, me) && isAfterAck(f.createdAt, ackAt),
        route: '/owner/work',
        readFeedId: f.id,
      });
    }
  }

  // 합류 승인 대기 — 사람이 기다리는 시간민감 항목. 탭하면 직원 관리(승인/거절)로.
  for (const p of pending) {
    out.push({
      id: `join_${p.id}`,
      kind: 'join_request',
      title: `${p.name}님이 합류를 신청했어요`,
      body: '승인하면 우리 매장 직원으로 합류해요',
      at: p.created_at,
      unread: isAfterAck(p.created_at, ackAt),
      route: '/owner/staff',
    });
  }

  for (const u of queue) {
    if (!isPendingQuestion(u)) continue;
    out.push({
      id: `q_${u.id}`,
      kind: 'question',
      title: '답변을 기다리는 질문이 있어요',
      body: u.query_text,
      at: u.asked_at,
      unread: isAfterAck(u.asked_at, ackAt),
      route: '/owner/inbox',
    });
  }

  for (const s of suggestions) {
    if (!isPendingSuggestion(s)) continue;
    out.push({
      id: `s_${s.id}`,
      kind: 'suggestion',
      title: `${s.proposer_name}님의 ${s.kind === 'improve' ? '노하우 개선' : '새 노하우'} 제안`,
      body: s.text,
      at: s.created_at,
      unread: isAfterAck(s.created_at, ackAt),
      route: '/owner/suggestions',
    });
  }

  for (const r of swaps) {
    if (!isSwapAwaitingApproval(r)) continue;
    out.push({
      id: `swap_${r.id}`,
      kind: 'swap_approval',
      title: `${nameOf(r.requester_id)}님 교대가 승인을 기다려요`,
      body: fmtDateKo(r.date),
      at: r.updated_at,
      unread: isAfterAck(r.updated_at, ackAt),
      route: '/owner/schedule',
    });
  }

  // 입금 신고 검토 결과(0083) — 승인이면 "이용이 열렸다", 반려면 **사유**가 본문이다.
  // 반려 사유를 못 보면 사장은 무엇을 고쳐 다시 입금해야 하는지 알 수 없다(무음 구간 재발).
  for (const c of claims) {
    if (!isPaymentResult(c)) continue;
    const ok = c.status === 'approved';
    out.push({
      id: `pay_${c.id}`,
      kind: ok ? 'payment_approved' : 'payment_rejected',
      title: ok ? '입금이 확인돼 이용이 열렸어요' : '입금 확인이 어려웠어요',
      body: ok
        ? `${PLANS[c.plan].name} 요금제로 ${c.months}개월 활성화됐어요`
        : (c.reject_reason ?? '입금 내역을 확인하지 못했어요. 다시 알려주세요.'),
      at: c.reviewed_at as string,
      unread: isAfterAck(c.reviewed_at ?? undefined, ackAt),
      route: '/billing',
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS);
}
