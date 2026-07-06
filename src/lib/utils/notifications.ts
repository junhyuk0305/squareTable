// 직원 알림 — 단일 진실원천(SSOT).
// 벨 뱃지(개수)와 알림 화면(목록)이 같은 술어/집계를 공유한다.
// UI(아이콘·틴트·onPress)는 화면이 kind로 매핑 — 여기선 순수 데이터만 만든다.
import type { FeedItem, TaskTemplate, DoneMark } from '@/lib/store/useWorkStore';
import { occursOn } from '@/lib/store/useWorkStore';
import type { SwapRequest, ShiftTemplate } from '@/lib/store/useScheduleStore';
import type { PendingMember } from '@/lib/store/useStaffStore';
import type { UnknownQuery, PlaybookSuggestion } from '@/types';
import { fmtDateKo } from '@/lib/utils/schedule';

/** 알림 목록 최대 개수 — 무한 누적 방지(최신 우선). */
export const MAX_NOTIFS = 50;

export type JuniorNotifKind = 'notice' | 'mention' | 'assign' | 'swap' | 'swap_approved' | 'swap_rejected';
export type JuniorNotifRoute = '/junior/work' | '/junior/schedule';

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
  /** @deprecated readFeedId로 대체. 하위호환용. */
  noticeId?: string;
};

// ── 공유 술어(뱃지·목록이 동일 규칙을 쓰도록 한 곳에서) ──────────────
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
): number {
  return (
    feed.filter((f) => isUnreadNotice(f, me)).length +
    feed.filter((f) => isUnreadMention(f, me)).length +
    taskTemplates.filter((t) => isPendingAssignment(t, me, today, done)).length +
    swaps.filter((r) => isIncomingSwap(r, me, today)).length
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
}): JuniorNotif[] {
  const { feed, swaps, templates, nameOf, userId: me, today, taskTemplates = [], done = {} } = args;
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
      unread: isUnreadNotice(f, me),
      route: '/junior/work',
      readFeedId: f.id,
      noticeId: f.id,
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
      unread: isUnreadMention(f, me),
      route: '/junior/work',
      readFeedId: f.id,
    });
  }

  // 배정 — 남이 나에게 배정한 할일. 오늘 떠야 하고 아직 완료 안 했으면 '해야 할 배정'(강조).
  for (const t of taskTemplates) {
    if (!isAssignedToMe(t, me) || !occursOn(t, today)) continue;
    out.push({
      id: `assign_${t.id}`,
      kind: 'assign',
      title: `${nameOf(t.createdBy ?? '')}님이 할 일을 배정했어요`,
      body: t.text,
      at: `${today}T08:00:00`, // 템플릿엔 생성시각이 없어 오늘 기준으로 정렬(배정 발생시각은 푸시가 정확).
      unread: !done[today]?.[t.id],
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
      unread: true,
      route: '/junior/schedule',
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
export type OwnerNotifKind = 'join_request' | 'question' | 'suggestion' | 'swap_approval' | 'mention';
export type OwnerNotifRoute = '/owner/inbox' | '/owner/suggestions' | '/owner/schedule' | '/owner/staff' | '/owner/work';

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

/** 벨 뱃지 개수 = 합류 승인대기 + 답변대기 질문 + 검토대기 제안 + 승인대기 교대.
 *  pending은 이미 "승인 대기"만 담긴 목록(fetchPendingMembers)이라 그대로 센다. */
export function ownerUnreadCount(
  queue: UnknownQuery[],
  suggestions: PlaybookSuggestion[],
  swaps: SwapRequest[],
  pending: PendingMember[],
  feed: FeedItem[] = [],
  me?: string,
): number {
  return (
    pending.length +
    queue.filter(isPendingQuestion).length +
    suggestions.filter(isPendingSuggestion).length +
    swaps.filter(isSwapAwaitingApproval).length +
    (me ? feed.filter((f) => isUnreadMention(f, me)).length : 0)
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
}): OwnerNotif[] {
  const { queue, suggestions, swaps, pending, nameOf, feed = [], userId: me } = args;
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
        unread: isUnreadMention(f, me),
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
      unread: true,
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
      unread: true,
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
      unread: true,
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
      unread: true,
      route: '/owner/schedule',
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTIFS);
}
