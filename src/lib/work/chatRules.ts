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

/** 지우기 전 확인 문구. 남의 글(사장·매니저가 지울 때)은 모두에게서 사라진다고 말한다. 공지 댓글도 같은 문구를 쓴다. */
export function deleteConfirmText(item: FeedItem, me: string): { title: string; message: string } {
  if (item.kind === 'comment') {
    return item.authorId === me
      ? { title: '댓글 삭제', message: '이 댓글을 지울까요?' }
      : { title: '댓글 삭제', message: '다른 사람의 댓글이에요. 모두에게서 사라져요.' };
  }
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

/** realtime payload 로 받은 피드 행 1건을 제자리 반영한다(M4 2차 · 2026-11-05 · 채팅 1건에 재조회 0).
 *  같은 id 가 있으면 서버 행으로 바꾼다(내 낙관 항목도 이 길로 서버 것이 된다). 없으면 INSERT 만 뒤에 붙인다 —
 *  UPDATE 로 온 모르는 행(90일 창·상한 밖의 옛 행)은 끌어오지 않는다(fetchFeed 가 안 주던 행을 패치가 들이면 목록 창이 깨진다).
 *  순서는 소비자(WorkBoard)가 createdAt 으로 다시 정렬하므로 붙이는 위치는 뒤면 된다. */
export function upsertFeedItem(feed: FeedItem[], item: FeedItem, event: 'INSERT' | 'UPDATE'): FeedItem[] {
  const i = feed.findIndex((f) => f.id === item.id);
  if (i >= 0) {
    const next = feed.slice();
    next[i] = item;
    return next;
  }
  return event === 'INSERT' ? [...feed, item] : feed;
}

/** 도착한 패치 기록 — 스냅샷 역전 방어의 재료. arrivedAt = 이 기기에 도착한 시각(Date.now · 조회 시작 시각과 같은 시계). */
export type FeedPatch = { item: FeedItem; event: 'INSERT' | 'UPDATE'; arrivedAt: number };

/** 서버 스냅샷(fetchedAt 에 조회 시작) 위에 **그보다 늦게 도착한** 패치를 다시 얹는다(역전 방어).
 *  ★없으면: 재조회가 돌던 사이(조회 시작 → 응답 set) 도착한 채팅이 응답 스냅샷에 없을 때 set 이 그 메시지를 지운다 —
 *    다음 이벤트가 올 때까지 상대 화면에서 사라진다. 다시 얹기는 id 교체라 스냅샷에 이미 있어도 두 번 들어가지 않는다.
 *  조회 시작 전에 온 패치는 서버가 이미 스냅샷에 담았으므로 로그에서 뺀다(로그가 영영 자라지 않게). */
export function replayLatePatches(feed: FeedItem[], log: Map<string, FeedPatch>, fetchedAt: number): FeedItem[] {
  let out = feed;
  for (const [id, p] of log) {
    if (p.arrivedAt <= fetchedAt) {
      log.delete(id);
      continue;
    }
    out = upsertFeedItem(out, p.item, p.event);
  }
  return out;
}

/** 다시 보낼 때는 지금 시각·오늘 날짜로 새로 찍는다(id 는 그대로라 두 번 들어가지 않는다).
 *  처음 시각을 쓰면 대화 중간 지난 자리에 끼어 동료가 못 보고, 자정을 넘기면 어제 날짜로 들어간다. */
export function restampForResend(item: FeedItem, nowIso: string, today: string): FeedItem {
  const { sendState: _s, ...rest } = item;
  return { ...rest, createdAt: nowIso, date: today };
}
