// 방의 '보이는 모습' 합성 — 전역(work_rooms) 위에 내 개인 덮어쓰기(work_room_prefs)를 얹는다.
// ★한 곳에서만 합성한다. 목록·헤더·서랍이 각자 `pref?.name ?? room.name` 을 쓰면 한 화면만 고쳐도
//   같은 방이 두 이름으로 보이는 상태가 된다.
import type { Room, RoomPref } from '@/lib/store/useRoomStore';
import { CategoryColors, CustomCategoryColor } from '@/lib/theme/colors';
import { tsMs } from '@/lib/utils/attendance';

/** 방 아바타 색 팔레트 — 기존 카테고리 색 그대로 쓴다(새 팔레트 발명 금지). */
export const ROOM_COLORS = [
  CategoryColors.Routine,
  CategoryColors.Event,
  CategoryColors.Context,
  CategoryColors['Know-how'],
  CustomCategoryColor,
] as const;

/** 색을 안 고른 방도 아바타는 있어야 한다 — id 로 팔레트를 안정적으로 고른다(렌더마다 안 바뀐다). */
function fallbackColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ROOM_COLORS[h % ROOM_COLORS.length];
}

export type RoomLook = { name: string; imageUrl?: string; color: string; initial: string };

export function roomLook(room: Room, pref?: RoomPref): RoomLook {
  const name = room.isDefault ? '전체' : (pref?.name ?? room.name);
  const imageUrl = pref?.imageUrl ?? room.imageUrl;
  return {
    name,
    ...(imageUrl ? { imageUrl } : null),
    color: pref?.color ?? room.color ?? fallbackColor(room.id),
    initial: name.trim().slice(0, 1) || '방',
  };
}

/** 이 방의 '할일 완료' 줄을 내 채팅에 띄울지 — 행이 없으면 켜짐이 기본. */
export function showsTaskDone(pref?: RoomPref): boolean {
  return pref?.showTaskDone !== false;
}

/**
 * 이 방의 안 읽은 대화 수 — **배지와 '안 읽은 순' 정렬이 둘 다 이 함수 하나에서 나온다.**
 * 각자 세면 배지에 3이 떠 있는데 정렬은 0으로 취급하는 상태가 된다.
 *
 * 규칙
 * · 사람이 쓴 대화(`message`)만 센다. 할일 완료 줄은 개인이 끌 수 있어(showTaskDone) 숫자의 근거가 안 된다.
 * · **내 메시지는 안 센다** — 내가 쓴 걸 안 읽었다고 하지 않는다.
 * · `lastReadAt` 이 없으면 **0**. 기준이 없을 때 "전부 안 읽음"으로 세면 첫 로그인에 아무도 안 누른
 *   숫자가 방마다 크게 찍힌다(0154 주석의 그 판단). 방을 한 번 열면 기준이 생겨 정확해진다.
 * · 피드 자체가 최근 N일 창(FEED_WINDOW_DAYS)이라 그보다 오래된 것은 애초에 셀 수 없다 — 상한이지 버그가 아니다.
 */
export function unreadCount(
  feed: { kind: string; roomId?: string; authorId: string; createdAt: string }[],
  room: { id: string; isDefault: boolean },
  me: string,
  pref?: RoomPref,
): number {
  if (!pref?.lastReadAt) return 0;
  // ★문자열 비교 금지 — 클라가 쓴 시각은 "…Z", 서버가 돌려주는 timestamptz 는 "…+00:00" 이라
  //   같은 순간인데도 사전순으로는 뒤집힌다. 밀리초로 바꿔서 잰다.
  const since = tsMs(pref.lastReadAt);
  let n = 0;
  for (const f of feed) {
    if (f.kind !== 'message') continue;
    if (f.authorId === me) continue;
    // 레거시 메시지(roomId 미지정)는 기본방 소속으로 본다 — 목록 미리보기와 같은 판정.
    const rid = f.roomId ?? (room.isDefault ? room.id : undefined);
    if (rid !== room.id) continue;
    if (tsMs(f.createdAt) > since) n += 1;
  }
  return n;
}
