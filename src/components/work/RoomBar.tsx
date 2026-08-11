// 채팅방 전환 바 — 업무 채팅 상단. 방 칩을 탭하면 그 방의 대화/공지/할일로 전환된다.
// 사장은 모든 방, 매니저·직원은 기본방 '전체' + 자기가 속한 방만 본다. '방 관리' 진입은 관리자(사장·매니저).
// ★가시성 판정은 서버 can_see_room()·wr_select(0126)와 같은 기준이어야 한다 — 좁으면 볼 수 있는 방을
//   못 열고, 넓으면 빈 방이 열린다(0122 이전 매니저가 그랬다). 그래서 화면 세트가 아니라 **역할**을 받는다.
// ★0126: 매니저를 '모든 방'에서 뺐다. 방을 만들 수는 있고(만든 방엔 서버 트리거가 자동으로 넣어 준다),
//   자기가 들어간 방만 보인다.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { canManage } from '@/lib/utils/roles';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

export function RoomBar({ role, me }: { role: string; me: string }) {
  const router = useRouter();
  const rooms = useRoomStore((s) => s.rooms);
  const members = useRoomStore((s) => s.members);
  const currentRoomId = useRoomStore((s) => s.currentRoomId);
  const setCurrentRoom = useRoomStore((s) => s.setCurrentRoom);
  const manages = canManage(role); // '방 관리' 진입 권한(방 만들기)은 매니저도 가진다
  const isOwner = role === 'owner'; // 모든 방을 보는 것은 사장뿐 — 서버 can_see_room 과 같은 기준

  const visible = useMemo(
    () => (isOwner ? rooms : rooms.filter((r) => r.isDefault || members.some((m) => m.roomId === r.id && m.userId === me))),
    [rooms, members, isOwner, me],
  );

  // 직원인데 방이 '전체' 하나뿐이면 굳이 바를 띄우지 않는다(분리가 의미 없을 때 노이즈 제거).
  if (!manages && visible.length <= 1) return null;

  return (
    <View style={s.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} keyboardShouldPersistTaps="handled">
        {visible.map((r) => {
          const on = r.id === currentRoomId;
          return (
            <Pressable key={r.id} onPress={() => setCurrentRoom(r.id)} style={[s.chip, on && s.chipOn]}>
              <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>
                {r.isDefault ? '전체' : r.name}
              </Text>
            </Pressable>
          );
        })}
        {manages && (
          <Pressable onPress={() => router.push('/owner/rooms')} style={({ pressed }) => [s.manage, pressed && { opacity: 0.7 }]}>
            <Ionicons name="settings-outline" size={14} color={InkColors.ink2} />
            <Text style={s.manageText}>방 관리</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { backgroundColor: InkColors.bg, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, maxWidth: 140 },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF' },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, borderStyle: 'dashed', backgroundColor: InkColors.bg },
  manageText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
});
