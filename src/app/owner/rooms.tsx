import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useRoomStore } from '@/lib/store/useRoomStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

/**
 * 채팅방 관리(사장) — 방 개설 + 직원 초대/관리 + 이름변경/삭제.
 * '전체'(기본방)는 매장 전원이 자동 참여하며 삭제할 수 없다.
 * 라우트는 파일기반 자동등록(_layout 미수정 — hot 회피).
 */
export default function OwnerRoomsScreen() {
  const rooms = useRoomStore((s) => s.rooms);
  const hydrate = useRoomStore((s) => s.hydrate);
  const subscribe = useRoomStore((s) => s.subscribe);
  const createRoom = useRoomStore((s) => s.createRoom);
  const staff = useStaffStore((s) => s.staff);

  useEffect(() => {
    hydrate();
    return subscribe();
  }, [hydrate, subscribe]);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const canCreate = name.trim().length > 0;

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function create() {
    if (!canCreate) return;
    createRoom(name, picked);
    showToast('채팅방을 만들었어요', 'good');
    setName('');
    setPicked([]);
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <Stack.Screen options={{ title: '채팅방 관리' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* 새 방 만들기 */}
        <View style={styles.createCard}>
          <Text style={styles.createTitle}>새 채팅방 만들기</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="방 이름 (예: 주방, 홀, 매니저)"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            maxLength={20}
          />
          {staff.length > 0 ? (
            <>
              <Text style={styles.pickLabel}>참여할 직원 선택</Text>
              <View style={styles.chips}>
                {staff.map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <Pressable key={m.id} onPress={() => toggle(m.id)} style={[styles.pick, on && styles.pickOn]}>
                      <Text style={[styles.pickText, on && styles.pickTextOn]}>{on ? '✓ ' : ''}{m.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.noStaff}>아직 직원이 없어요. 직원이 합류하면 방에 초대할 수 있어요.</Text>
          )}
          <Text style={styles.ownerNote}>사장님은 모든 방에 자동으로 들어가요.</Text>
          <Pressable onPress={create} disabled={!canCreate} style={({ pressed }) => [styles.createBtn, !canCreate && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Ionicons name="add" size={17} color="#FFFFFF" />
            <Text style={styles.createBtnText}>채팅방 만들기</Text>
          </Pressable>
        </View>

        {/* 기존 방 목록 */}
        <Text style={styles.sectionLabel}>채팅방 {rooms.length}개</Text>
        <View style={styles.list}>
          {rooms.map((r) => (
            <RoomRow key={r.id} roomId={r.id} />
          ))}
        </View>
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomRow({ roomId }: { roomId: string }) {
  const room = useRoomStore((s) => s.rooms.find((r) => r.id === roomId));
  const members = useRoomStore((s) => s.members);
  const renameRoom = useRoomStore((s) => s.renameRoom);
  const removeRoom = useRoomStore((s) => s.removeRoom);
  const addMember = useRoomStore((s) => s.addMember);
  const removeMember = useRoomStore((s) => s.removeMember);
  const staff = useStaffStore((s) => s.staff);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room?.name ?? '');
  const [confirmDel, setConfirmDel] = useState(false);

  if (!room) return null;
  const memberIds = members.filter((m) => m.roomId === roomId).map((m) => m.userId);

  return (
    <View style={styles.roomCard}>
      <View style={styles.roomHead}>
        <Ionicons name={room.isDefault ? 'people' : 'chatbubbles-outline'} size={16} color={InkColors.ink2} />
        {editing && !room.isDefault ? (
          <TextInput value={draft} onChangeText={setDraft} style={styles.renameInput} autoFocus maxLength={20} />
        ) : (
          <Text style={styles.roomName} numberOfLines={1}>{room.isDefault ? '전체' : room.name}</Text>
        )}
        {room.isDefault ? (
          <Text style={styles.defaultTag}>기본 · 모두 참여</Text>
        ) : editing ? (
          <Pressable onPress={() => { renameRoom(room.id, draft); setEditing(false); }} hitSlop={6} style={styles.iconBtn}>
            <Text style={styles.saveText}>저장</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => { setDraft(room.name); setEditing(true); }} hitSlop={6} style={styles.iconBtn}>
            <Ionicons name="pencil" size={15} color={InkColors.ink3} />
          </Pressable>
        )}
      </View>

      {room.isDefault ? (
        <Text style={styles.roomSub}>사장님과 모든 직원이 자동으로 참여하는 방이에요.</Text>
      ) : (
        <>
          <Text style={styles.memberLabel}>참여 직원 {memberIds.length}명 — 탭해서 추가/제외</Text>
          <View style={styles.chips}>
            {staff.length === 0 && <Text style={styles.noStaff}>합류한 직원이 없어요.</Text>}
            {staff.map((m) => {
              const on = memberIds.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => (on ? removeMember(room.id, m.id) : addMember(room.id, m.id))}
                  style={[styles.pick, on && styles.pickOn]}
                >
                  <Text style={[styles.pickText, on && styles.pickTextOn]}>{on ? '✓ ' : ''}{m.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {confirmDel ? (
            <View style={styles.delConfirm}>
              <Text style={styles.delConfirmText}>이 방의 대화·공지·할일이 모두 사라져요. 삭제할까요?</Text>
              <View style={styles.delActions}>
                <Pressable onPress={() => setConfirmDel(false)} style={styles.delCancel}>
                  <Text style={styles.delCancelText}>취소</Text>
                </Pressable>
                <Pressable onPress={() => { removeRoom(room.id); showToast('채팅방을 삭제했어요', 'info'); }} style={styles.delGo}>
                  <Text style={styles.delGoText}>삭제</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setConfirmDel(true)} hitSlop={6} style={({ pressed }) => [styles.delLink, pressed && { opacity: 0.6 }]}>
              <Ionicons name="trash-outline" size={14} color={BrandColors.bad} />
              <Text style={styles.delLinkText}>채팅방 삭제</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },

  createCard: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 11, ...Elevation.e1 },
  createTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: InkColors.ink, backgroundColor: InkColors.cream },
  pickLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  pick: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  pickOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  pickText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  pickTextOn: { color: '#FFFFFF' },
  noStaff: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },
  ownerNote: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: InkColors.ink, borderRadius: 12, paddingVertical: 13, marginTop: 2 },
  createBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  list: { gap: 12 },
  roomCard: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 15, gap: 10, ...Elevation.e1 },
  roomHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomName: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  renameInput: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink, borderBottomWidth: 1, borderBottomColor: InkColors.ink, paddingVertical: 2 },
  defaultTag: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink3 },
  iconBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  saveText: { fontSize: 13, fontWeight: '800', color: BrandColors.brand },
  roomSub: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '600' },
  memberLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },

  delLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  delLinkText: { fontSize: 12.5, fontWeight: '700', color: BrandColors.bad },
  delConfirm: { backgroundColor: BrandColors.accentSoft, borderRadius: 11, padding: 12, gap: 9 },
  delConfirmText: { fontSize: 12.5, fontWeight: '700', color: BrandColors.bad, lineHeight: 18 },
  delActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  delCancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  delCancelText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  delGo: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9, backgroundColor: BrandColors.bad },
  delGoText: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },
});
