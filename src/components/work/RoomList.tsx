import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { StoredImage } from '@/components/StoredImage';
import { Appear, stagger } from '@/components/Appear';
import { useRoomStore, visibleRooms } from '@/lib/store/useRoomStore';
import { type FeedItem } from '@/lib/store/useWorkStore';
import { roomLook, unreadCount } from '@/lib/utils/room';
import { usePreferencesStore } from '@/lib/store/usePreferencesStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { mdHHmm, tsMs } from '@/lib/utils/attendance';

/** 우하단 '+' = 이 화면의 Primary. 노하우 탭 FAB(56)과 같은 크기·같은 노랑을 쓴다. */
const FAB_SIZE = 56;

/**
 * RoomList — 업무 탭의 루트. **내가 들어간 방만** 보인다(0147: 사장 자동참여 폐지).
 * 방을 탭하면 그 방의 대화로 들어가고, 대화방에서 나오는 길은 뒤로가기 하나다(방 전환 UI 없음).
 *
 * 안 읽음 배지의 근거는 `work_room_prefs.last_read_at`(0154) 하나다 — 방을 열면 그 시각이 기준이 되고,
 * 그 뒤 남이 쓴 대화만 센다. 정렬(최신순·안 읽은 순)도 같은 숫자에서 나온다(`unreadCount` 가 SSOT).
 */
export function RoomList({
  me,
  memberCount,
  feed,
  onOpen,
  onCreate,
}: {
  me: string;
  /** 매장 전원 수 — 기본방('전체')은 멤버 행이 없어 이 값으로 센다. */
  memberCount: number;
  feed: FeedItem[];
  onOpen: (roomId: string) => void;
  onCreate: () => void;
}) {
  const rooms = useRoomStore((s) => s.rooms);
  const memberRows = useRoomStore((s) => s.members);
  const prefs = useRoomStore((s) => s.prefs);
  const roomSort = usePreferencesStore((s) => s.roomSort);
  // ★스토어 게터를 호출하지 않는다 — 구독 중인 값에서 파생한다(visibleRooms 주석의 그 함정).
  const visible = useMemo(() => visibleRooms(rooms, memberRows, me), [rooms, memberRows, me]);

  // 방별 마지막 대화 — 완료 알림·공지가 아니라 '사람이 쓴 말'만 미리보기로 쓴다.
  const lastByRoom = useMemo(() => {
    const map: Record<string, FeedItem> = {};
    for (const f of feed) {
      if (f.kind !== 'message') continue;
      const rid = f.roomId ?? rooms.find((r) => r.isDefault)?.id;
      if (!rid) continue;
      const cur = map[rid];
      if (!cur || tsMs(f.createdAt) > tsMs(cur.createdAt)) map[rid] = f;
    }
    return map;
  }, [feed, rooms]);

  // 방별 안 읽은 수 — 배지와 정렬이 같은 값을 봐야 한다(따로 세면 배지 3 · 정렬 0 인 상태가 생긴다).
  const unreadBy = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of visible) map[r.id] = unreadCount(feed, r, me, prefs.find((p) => p.roomId === r.id));
    return map;
  }, [visible, feed, me, prefs]);

  // '전체'를 맨 위로 고정하던 것은 뺐다 — 정렬을 고를 수 있게 된 이상, 고른 기준을 방 하나가 무시하면
  // 안 읽은 방이 '전체' 아래로 밀려 정렬이 거짓말이 된다.
  const sorted = useMemo(
    () =>
      visible.slice().sort((a, b) => {
        if (roomSort === 'unread') {
          const d = (unreadBy[b.id] ?? 0) - (unreadBy[a.id] ?? 0);
          if (d !== 0) return d; // 동수면 아래 최신순으로 떨어진다(안 읽은 게 없는 방들의 순서도 뜻이 있게)
        }
        const av = lastByRoom[a.id] ? tsMs(lastByRoom[a.id].createdAt) : 0;
        const bv = lastByRoom[b.id] ? tsMs(lastByRoom[b.id].createdAt) : 0;
        return bv - av;
      }),
    [visible, lastByRoom, roomSort, unreadBy],
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {sorted.map((room, i) => {
          const look = roomLook(room, prefs.find((p) => p.roomId === room.id));
          const count = room.isDefault ? memberCount : memberRows.filter((m) => m.roomId === room.id).length;
          const last = lastByRoom[room.id];
          return (
            <Appear key={room.id} delay={stagger(i)}>
              <Pressable
                onPress={() => onOpen(room.id)}
                style={({ pressed }) => [s.row, pressed && { backgroundColor: InkColors.paper }]}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadBy[room.id] > 0 ? `${look.name} 채팅방 열기 · 안 읽은 대화 ${unreadBy[room.id]}건` : `${look.name} 채팅방 열기`
                }
              >
                {look.imageUrl ? (
                  <StoredImage stored={look.imageUrl} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, { backgroundColor: look.color }]}>
                    <Text style={s.avatarText}>{look.initial}</Text>
                  </View>
                )}
                <View style={s.body}>
                  <View style={s.titleRow}>
                    <Text style={s.name} numberOfLines={1}>{look.name}</Text>
                    <Text style={s.count}>{count}</Text>
                  </View>
                  <Text style={s.preview} numberOfLines={1}>
                    {last ? (last.text.trim() || '사진') : '아직 대화가 없어요'}
                  </Text>
                </View>
                <View style={s.tail}>
                  {last && <Text style={s.time}>{mdHHmm(last.createdAt)}</Text>}
                  {unreadBy[room.id] > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{unreadBy[room.id] > 99 ? '99+' : unreadBy[room.id]}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Appear>
          );
        })}
        {sorted.length === 0 && (
          <Text style={s.empty}>들어가 있는 채팅방이 없어요. 아래 ＋로 방을 만들어 보세요.</Text>
        )}
        <View style={{ height: FAB_SIZE + 24 }} />
      </ScrollView>

      {/* 방 만들기는 사장·매니저·직원·알바 전원에게 열려 있다(0148). */}
      <Pressable
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityLabel="채팅방 만들기"
        style={({ pressed }) => [s.fab, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="add" size={26} color={InkColors.ink} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { paddingVertical: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.gutter, paddingVertical: Space.md, minHeight: 64 },
  avatar: { width: 46, height: 46, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 19, fontWeight: '800', color: InkColors.bubbleText },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  name: { flexShrink: 1, fontSize: 15.5, fontWeight: '800', color: InkColors.ink },
  // 인원수·시각은 위치·상태 꼬리표(보조) — 15sp 하한 대상이 아니다.
  count: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  preview: { fontSize: 15, lineHeight: 21, color: InkColors.ink2, fontWeight: '600' },
  tail: { alignItems: 'flex-end', gap: 4, minWidth: 40 },
  time: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  // 안 읽음 배지 — 흰 글자를 얹는 면이라 500(bad)이 아니라 800 솔리드다(시맨틱 색 표).
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: Radius.pill, backgroundColor: BrandColors.badSolid, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11.5, fontWeight: '800', color: InkColors.bg },
  empty: { paddingHorizontal: Space.gutter, paddingVertical: 40, fontSize: 15, lineHeight: 22, color: InkColors.ink3, fontWeight: '600', textAlign: 'center' },
  fab: {
    position: 'absolute', right: Space.gutter, bottom: Space.gutter,
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: Radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, ...Elevation.ey,
  },
});
