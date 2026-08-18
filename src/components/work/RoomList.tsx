import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { StoredImage } from '@/components/StoredImage';
import { Appear, stagger } from '@/components/Appear';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { type FeedItem } from '@/lib/store/useWorkStore';
import { roomLook } from '@/lib/utils/room';
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
 * ★안 읽음 배지는 아직 없다 — '내가 언제까지 읽었나'를 담는 자리가 스키마에 없어서,
 *   지금 배지를 그리면 근거 없는 숫자가 된다. 마지막 대화·시각만 정직하게 보여준다.
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
  const visible = useRoomStore((s) => s.roomsFor)(me);

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

  const sorted = useMemo(
    () =>
      visible.slice().sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1; // '전체'가 늘 맨 위
        const av = lastByRoom[a.id] ? tsMs(lastByRoom[a.id].createdAt) : 0;
        const bv = lastByRoom[b.id] ? tsMs(lastByRoom[b.id].createdAt) : 0;
        return bv - av;
      }),
    [visible, lastByRoom],
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
                accessibilityLabel={`${look.name} 채팅방 열기`}
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
                {last && <Text style={s.time}>{mdHHmm(last.createdAt)}</Text>}
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
  time: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  empty: { paddingHorizontal: Space.gutter, paddingVertical: 40, fontSize: 15, lineHeight: 22, color: InkColors.ink3, fontWeight: '600', textAlign: 'center' },
  fab: {
    position: 'absolute', right: Space.gutter, bottom: Space.gutter,
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: Radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, ...Elevation.ey,
  },
});
