// 공지 정렬·읽음 판정 SSOT(2026-10-16) — 공지 패널(WorkBoard notices) · 채팅 상단 고정 1줄(WorkChat topNotice) ·
// 햄버거 안 읽은 점이 전부 이 두 함수를 쓴다. 공지는 벨·푸시 알림이 아니다 — 채팅방마다 맨 위 1건으로 보인다.
import type { FeedItem } from '@/lib/store/useWorkStore';
import { tsMs } from '@/lib/utils/attendance';

/** 고정 공지 먼저, 그다음 최신순. 맨 앞 1건이 채팅 상단 줄이다. */
export function sortNotices(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return tsMs(b.createdAt) - tsMs(a.createdAt);
  });
}

/** 안 읽은 공지 — 역할이 아니라 **작성자** 기준(0177: 공지는 누구나 쓴다). 내가 쓴 공지는 읽은 것이다. */
export const isNoticeUnreadFor = (n: FeedItem, me: string): boolean =>
  n.authorId !== me && !(n.read_by ?? []).includes(me);
