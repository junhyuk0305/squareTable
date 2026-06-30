// 업무 채팅방 — 사장이 방을 개설하고 직원을 초대/관리. '전부 방 단위'의 방 메타·멤버십·활성방을 보관.
// 메시지/공지/할일 자체는 useWorkStore가 보관하고 roomId로 묶인다. 이 스토어는 '어떤 방들이 있고
// 누가 속하며 지금 어느 방을 보는가'만 관리한다.
import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchRooms,
  fetchRoomMembers,
  insertRoom,
  updateRoomName,
  deleteRoom as dbDeleteRoom,
  addRoomMember,
  removeRoomMember,
  subscribeRooms,
} from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import { useSessionStore } from '@/lib/store/useSessionStore';

const DEMO_UNIT_ID = 'store_001'; // = mockSeed.DEMO_UNIT_ID (순환 import 방지로 리터럴)
const defaultRoomId = (unitId: string) => `room_main_${unitId}`;

export type Room = {
  id: string;
  unitId: string;
  name: string;
  isDefault: boolean;
  createdBy?: string;
  createdAt?: string;
};
export type RoomMember = { roomId: string; userId: string };

// 데모 시드 — 기본방 '전체' + 비기본방 '주방'(이수민만 멤버).
const seedRooms: Room[] = [
  { id: defaultRoomId(DEMO_UNIT_ID), unitId: DEMO_UNIT_ID, name: '전체', isDefault: true },
  { id: 'room_kitchen', unitId: DEMO_UNIT_ID, name: '주방', isDefault: false },
];
const seedMembers: RoomMember[] = [{ roomId: 'room_kitchen', userId: 'u_staff_002' }];

type State = {
  rooms: Room[];
  members: RoomMember[]; // 비기본방 멤버십(기본방은 전원 → 멤버행 없음)
  currentRoomId: string | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  setCurrentRoom: (id: string) => void;
  /** 기본방('전체')이 없으면 만들어 둔다(mock 신규 매장에서 메시지가 고아 되는 것 방지). */
  ensureDefaultRoom: () => void;
  createRoom: (name: string, memberIds?: string[]) => void;
  renameRoom: (id: string, name: string) => void;
  removeRoom: (id: string) => void;
  addMember: (roomId: string, userId: string) => void;
  removeMember: (roomId: string, userId: string) => void;
  /** 그 사용자가 볼 수 있는 방 목록(사장=전체, 알바=기본방+소속방). */
  roomsFor: (userId: string, isOwner: boolean) => Room[];
  membersOf: (roomId: string) => string[];
  applyMock: (demo: boolean) => void;
};

export const useRoomStore = create<State>((set, get) => ({
  rooms: HAS_SUPABASE ? [] : seedRooms,
  members: HAS_SUPABASE ? [] : seedMembers,
  currentRoomId: HAS_SUPABASE ? null : defaultRoomId(DEMO_UNIT_ID),
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const session = useSessionStore.getState();
    let [rooms, members] = await Promise.all([fetchRooms(), fetchRoomMembers()]);
    // 자가치유: 마이그레이션 backfill 이후 생성된 새 매장엔 기본방이 없을 수 있다.
    // 사장이 들어오면 기본방('전체')을 한 번 만들어 둔다(알바는 권한 없어 패스).
    if (session.role === 'owner' && session.unitId && !rooms.some((r) => r.isDefault)) {
      const def: Room = { id: defaultRoomId(session.unitId), unitId: session.unitId, name: '전체', isDefault: true, createdBy: session.userId };
      if (await insertRoom(def)) rooms = [def, ...rooms];
    }
    const cur = get().currentRoomId;
    const fallback = rooms.find((r) => r.isDefault)?.id ?? rooms[0]?.id ?? null;
    set({ rooms, members, loaded: true, currentRoomId: cur && rooms.some((r) => r.id === cur) ? cur : fallback });
  }),

  subscribe: () => subscribeDebounced(subscribeRooms, () => get().hydrate()),

  setCurrentRoom: (id) => set({ currentRoomId: id }),

  ensureDefaultRoom: () => {
    const s = get();
    if (s.rooms.some((r) => r.isDefault)) return;
    const session = useSessionStore.getState();
    const unit = session.unitId || DEMO_UNIT_ID;
    const def: Room = { id: defaultRoomId(unit), unitId: unit, name: '전체', isDefault: true, createdBy: session.userId };
    set((st) => ({ rooms: [def, ...st.rooms], currentRoomId: st.currentRoomId ?? def.id }));
    void insertRoom(def); // Supabase면 영속(고정 id + 충돌무시), mock이면 no-op
  },

  createRoom: (name, memberIds = []) => {
    const session = useSessionStore.getState();
    const room: Room = {
      id: genId('room'),
      unitId: session.unitId || DEMO_UNIT_ID,
      name: name.trim() || '새 채팅방',
      isDefault: false,
      createdBy: session.userId,
      createdAt: new Date().toISOString(),
    };
    const newMembers: RoomMember[] = memberIds.map((userId) => ({ roomId: room.id, userId }));
    set((s) => ({ rooms: [...s.rooms, room], members: [...s.members, ...newMembers], currentRoomId: room.id }));
    void guardWrite(
      insertRoom(room).then(async (ok) => {
        if (!ok) return false;
        const rs = await Promise.all(newMembers.map((m) => addRoomMember(m.roomId, m.userId)));
        return rs.every(Boolean);
      }),
      () => set((s) => ({ rooms: s.rooms.filter((r) => r.id !== room.id), members: s.members.filter((m) => m.roomId !== room.id) })),
      '채팅방 만들기에 실패했어요.',
    );
  },

  renameRoom: (id, name) => {
    const before = get().rooms.find((r) => r.id === id);
    if (!before) return;
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, name: name.trim() || r.name } : r)) }));
    void guardWrite(
      updateRoomName(id, name.trim() || before.name),
      () => set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? before : r)) })),
      '방 이름 변경에 실패했어요.',
    );
  },

  removeRoom: (id) => {
    const room = get().rooms.find((r) => r.id === id);
    if (!room || room.isDefault) return; // 기본방은 삭제 불가
    const prevRooms = get().rooms;
    const prevMembers = get().members;
    set((s) => {
      const rooms = s.rooms.filter((r) => r.id !== id);
      const fallback = rooms.find((r) => r.isDefault)?.id ?? rooms[0]?.id ?? null;
      return {
        rooms,
        members: s.members.filter((m) => m.roomId !== id),
        currentRoomId: s.currentRoomId === id ? fallback : s.currentRoomId,
      };
    });
    void guardWrite(
      dbDeleteRoom(id),
      () => set({ rooms: prevRooms, members: prevMembers }),
      '채팅방 삭제에 실패했어요.',
    );
  },

  addMember: (roomId, userId) => {
    if (get().members.some((m) => m.roomId === roomId && m.userId === userId)) return;
    set((s) => ({ members: [...s.members, { roomId, userId }] }));
    void guardWrite(
      addRoomMember(roomId, userId),
      () => set((s) => ({ members: s.members.filter((m) => !(m.roomId === roomId && m.userId === userId)) })),
      '직원 초대에 실패했어요.',
    );
  },

  removeMember: (roomId, userId) => {
    if (!get().members.some((m) => m.roomId === roomId && m.userId === userId)) return;
    set((s) => ({ members: s.members.filter((m) => !(m.roomId === roomId && m.userId === userId)) }));
    void guardWrite(
      removeRoomMember(roomId, userId),
      () => set((s) => ({ members: [...s.members, { roomId, userId }] })),
      '직원 내보내기에 실패했어요.',
    );
  },

  roomsFor: (userId, isOwner) => {
    const { rooms, members } = get();
    if (isOwner) return rooms;
    return rooms.filter((r) => r.isDefault || members.some((m) => m.roomId === r.id && m.userId === userId));
  },
  membersOf: (roomId) => get().members.filter((m) => m.roomId === roomId).map((m) => m.userId),

  applyMock: (demo) =>
    set(
      demo
        ? { rooms: seedRooms, members: seedMembers, currentRoomId: defaultRoomId(DEMO_UNIT_ID), loaded: true }
        : { rooms: [], members: [], currentRoomId: null, loaded: true },
    ),
}));
