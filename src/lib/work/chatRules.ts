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
