// 직원 알림 — 단일 진실원천(SSOT).
// 벨 뱃지(개수)와 알림 화면(목록)이 같은 술어/집계를 공유한다.
// UI(아이콘·틴트·onPress)는 화면이 kind로 매핑 — 여기선 순수 데이터만 만든다.
import type { FeedItem } from '@/lib/store/useWorkStore';
import type { SwapRequest, ShiftTemplate } from '@/lib/store/useScheduleStore';
import { fmtDateKo } from '@/lib/utils/schedule';

/** 알림 목록 최대 개수 — 무한 누적 방지(최신 우선). */
export const MAX_NOTIFS = 50;

export type JuniorNotifKind = 'notice' | 'mention' | 'swap' | 'swap_approved' | 'swap_rejected';
export type JuniorNotifRoute = '/junior/work' | '/junior/schedule';

export type JuniorNotif = {
  id: string;
  kind: JuniorNotifKind;
  title: string;
  body?: string;
  at: string; // ISO — 정렬·상대시간 표기용
  unread: boolean;
  route: JuniorNotifRoute;
  /** notice일 때 탭 시 읽음처리용 feed id. */
  noticeId?: string;
};

// ── 공유 술어(뱃지·목록이 동일 규칙을 쓰도록 한 곳에서) ──────────────
/** 안 읽은 공지(나 기준). */
export const isUnreadNotice = (f: FeedItem, me: string): boolean =>
  f.kind === 'notice' && !(f.read_by ?? []).includes(me);

/** 내가 대응할 수 있는 열린 교대 요청(대타 전체 + 나에게 온 맞교환). 지난 날짜 제외. */
export const isIncomingSwap = (r: SwapRequest, me: string, today: string): boolean =>
  r.status === 'open' &&
  r.requester_id !== me &&
  r.date >= today &&
  (r.kind === 'cover' || r.target_staff_id === me);

/** 벨 뱃지 개수 = 안 읽은 공지 + 받은 교대 요청. (staff/templates 불필요 — 가벼움) */
export function juniorUnreadCount(
  feed: FeedItem[],
  swaps: SwapRequest[],
  me: string,
  today: string,
): number {
  return (
    feed.filter((f) => isUnreadNotice(f, me)).length +
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
}): JuniorNotif[] {
  const { feed, swaps, templates, nameOf, userId: me, today } = args;
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
      noticeId: f.id,
    });
  }

  // 멘션 — 누군가 글/댓글에서 나를 @언급(내 글 제외)
  for (const f of feed) {
    if (!(f.mentions ?? []).includes(me) || f.authorId === me) continue;
    out.push({
      id: `mention_${f.id}`,
      kind: 'mention',
      title: `${f.authorName}님이 나를 언급했어요`,
      body: f.text,
      at: f.createdAt,
      unread: false,
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
