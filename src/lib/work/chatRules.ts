// 업무 채팅 규칙(J15 ①② · 2026-10-05) — 순수 함수. 검증 = scripts/qa-j15.mjs.
// FeedItem 은 타입만 읽는다(스토어 코드는 읽지 않는다).
import type { FeedItem } from '@/lib/store/useWorkStore';

/** 내 메시지를 고칠 수 있는 기간. 서버(0252 edit_feed_text · work_feed 트리거)와 같은 값이다. */
export const FEED_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 이 메시지를 내가 고칠 수 있나. 내 글 · 일반 메시지 · 글자 있음 · 보낸 지 24시간 안 · 전송 실패 아님. */
export function canEditMessage(item: FeedItem, me: string, now: number = Date.now()): boolean {
  if (item.kind !== 'message' || item.authorId !== me || item.sendState === 'failed') return false;
  if (!item.text.trim()) return false;
  const at = Date.parse(item.createdAt);
  return !Number.isNaN(at) && now - at < FEED_EDIT_WINDOW_MS;
}

/** 지우기 전 확인 문구. 남의 글(사장·매니저가 지울 때)은 모두에게서 사라진다고 말한다. */
export function deleteConfirmText(item: FeedItem, me: string): { title: string; message: string } {
  return item.authorId === me
    ? { title: '메시지 삭제', message: '이 메시지를 지울까요?' }
    : { title: '메시지 삭제', message: '다른 사람의 메시지예요. 모두에게서 사라져요.' };
}

/** 전송 실패 — 글을 지우지 않고 실패로 표시한다(로컬 전용 표시 · 서버에는 싣지 않는다). */
export function markSendFailed(feed: FeedItem[], id: string): FeedItem[] {
  return feed.map((f) => (f.id === id ? { ...f, sendState: 'failed' as const } : f));
}

/** 서버 피드로 바꿀 때 서버에 아직 없는 실패·전송 중 메시지를 다시 얹는다(논리 점검 D4).
 *  안 얹으면 새로고침 한 번에 [다시 보내기]와 함께 흔적 없이 사라진다. 서버에 이미 있으면 서버 것을 쓴다. */
export function carryUnsent(server: FeedItem[], local: FeedItem[], sending: ReadonlySet<string>): FeedItem[] {
  const onServer = new Set(server.map((f) => f.id));
  const keep = local.filter((f) => !onServer.has(f.id) && (f.sendState === 'failed' || sending.has(f.id)));
  return keep.length ? [...server, ...keep] : server;
}

/** 다시 보낼 때는 지금 시각·오늘 날짜로 새로 찍는다(id 는 그대로라 두 번 들어가지 않는다).
 *  처음 시각을 쓰면 대화 중간 지난 자리에 끼어 동료가 못 보고, 자정을 넘기면 어제 날짜로 들어간다. */
export function restampForResend(item: FeedItem, nowIso: string, today: string): FeedItem {
  const { sendState: _s, ...rest } = item;
  return { ...rest, createdAt: nowIso, date: today };
}
