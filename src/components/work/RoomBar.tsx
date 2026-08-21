// 채팅방 전환 바 — 업무 채팅 상단에 떠 있는 두 번째 알약 줄. 칩을 탭하면 그 방의 대화로 바뀐다.
// ★가시성 판정은 만들지 않는다 — visibleRooms(0147: is_default or 멤버, 사장 예외 없음) 하나를 쓴다.
//   서버 can_see_room()과 같은 기준이라 좁지도 넓지도 않다.
// ★안 읽음 숫자의 근거도 unreadCount(0154 last_read_at) 하나다. 여기서 따로 세지 않는다.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRoomStore, visibleRooms } from '@/lib/store/useRoomStore';
import { type FeedItem } from '@/lib/store/useWorkStore';
import { roomLook, unreadCount } from '@/lib/utils/room';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { tsMs } from '@/lib/utils/attendance';

/** 떠 있는 헤더(top 10 + 높이 44) 아래로 8 띄운 자리. */
const BAR_TOP = 62;
const BAR_H = 40;
/** 대화 스트림이 이 바에 가리지 않도록 WorkChat 이 더해야 할 상단 여백. */
export const ROOMBAR_INSET = BAR_TOP + BAR_H - 44;

export function RoomBar({
  me,
  feed,
  onCreate,
}: {
  me: string;
  /** 매장 전체 피드 — 다른 방의 안 읽은 수를 세야 해서 현재 방 스트림이 아니라 전체가 들어온다. */
  feed: FeedItem[];
  onCreate: () => void;
}) {
  const rooms = useRoomStore((s) => s.rooms);
  const memberRows = useRoomStore((s) => s.members);
  const prefs = useRoomStore((s) => s.prefs);
  const currentRoomId = useRoomStore((s) => s.currentRoomId);
  // ★스토어 게터(roomsFor)를 호출하지 않는다 — 구독 중인 값에서 파생해야 방이 늘어도 다시 그린다.
  const visible = useMemo(() => visibleRooms(rooms, memberRows, me), [rooms, memberRows, me]);

  // 방별 마지막 '사람이 쓴 말'의 시각 — 칩 순서(최신순)의 근거.
  const lastAt = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of feed) {
      if (f.kind !== 'message') continue;
      const rid = f.roomId ?? rooms.find((r) => r.isDefault)?.id;
      if (!rid) continue;
      const t = tsMs(f.createdAt);
      if (t > (map[rid] ?? 0)) map[rid] = t;
    }
    return map;
  }, [feed, rooms]);

  // 기본방('전체')은 늘 맨 앞 — 모두가 있는 방이라 전환의 원점이다. 나머지는 최신 대화순.
  const sorted = useMemo(
    () =>
      visible.slice().sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return (lastAt[b.id] ?? 0) - (lastAt[a.id] ?? 0);
      }),
    [visible, lastAt],
  );

  // 방을 바꾼다 — 나가는 방과 들어가는 방 **둘 다** 읽음 기준을 지금으로 옮긴다.
  // 나가는 쪽을 안 찍으면, 보고 있는 동안 들어온 말이 그대로 안 읽음으로 남는다.
  const select = (id: string) => {
    if (id === currentRoomId) return;
    if (currentRoomId && me) useRoomStore.getState().markRead(currentRoomId, me);
    useRoomStore.getState().setCurrentRoom(id);
    if (me) useRoomStore.getState().markRead(id, me);
  };

  return (
    <View style={s.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} keyboardShouldPersistTaps="handled">
        {sorted.map((r) => {
          const on = r.id === currentRoomId;
          const look = roomLook(r, prefs.find((p) => p.roomId === r.id));
          // 지금 보고 있는 방에는 배지를 안 그린다 — 읽는 중에 들어온 말을 "안 읽음"이라 하지 않는다.
          const n = on ? 0 : unreadCount(feed, r, me, prefs.find((p) => p.roomId === r.id));
          return (
            <Pressable
              key={r.id}
              onPress={() => select(r.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={n > 0 ? `${look.name} 채팅방 · 안 읽은 대화 ${n}건` : `${look.name} 채팅방`}
              style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>
                {look.name}
              </Text>
              {n > 0 && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{n > 99 ? '99+' : n}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
        {/* 방 만들기는 사장·매니저·직원·알바 전원에게 열려 있다(0148). */}
        <Pressable
          onPress={onCreate}
          accessibilityRole="button"
          accessibilityLabel="채팅방 만들기"
          style={({ pressed }) => [s.add, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="add" size={18} color={InkColors.ink2} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // 헤더와 같은 알약 — 대화 위에 떠 있다. 반투명이면 말풍선이 칩 사이로 비쳐 글자가 읽히지 않는다.
  bar: {
    position: 'absolute', top: BAR_TOP, left: 10, right: 10, zIndex: 6,
    height: BAR_H, borderRadius: Radius.pill, backgroundColor: InkColors.bg, ...Elevation.e2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Space.xs, height: BAR_H },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, maxWidth: 150 },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.bubbleText },
  // 안 읽음 배지 — 흰 글자를 얹는 면이라 500(bad)이 아니라 800 솔리드다(시맨틱 색 표).
  badge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: Radius.pill, backgroundColor: BrandColors.badSolid, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10.5, fontWeight: '800', color: InkColors.bg },
  add: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: InkColors.line, backgroundColor: InkColors.bg },
});
