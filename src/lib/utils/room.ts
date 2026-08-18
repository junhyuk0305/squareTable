// 방의 '보이는 모습' 합성 — 전역(work_rooms) 위에 내 개인 덮어쓰기(work_room_prefs)를 얹는다.
// ★한 곳에서만 합성한다. 목록·헤더·서랍이 각자 `pref?.name ?? room.name` 을 쓰면 한 화면만 고쳐도
//   같은 방이 두 이름으로 보이는 상태가 된다.
import type { Room, RoomPref } from '@/lib/store/useRoomStore';
import { CategoryColors, CustomCategoryColor } from '@/lib/theme/colors';

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
