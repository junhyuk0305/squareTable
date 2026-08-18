// 업무 채팅방 — 사장이 방을 개설하고 직원을 초대/관리. '전부 방 단위'의 방 메타·멤버십·활성방을 보관.
// 메시지/공지/할일 자체는 useWorkStore가 보관하고 roomId로 묶인다. 이 스토어는 '어떤 방들이 있고
// 누가 속하며 지금 어느 방을 보는가'만 관리한다.
import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchRooms,
  fetchRoomMembers,
  fetchRoomPrefs,
  upsertRoomPref,
  markRoomRead,
  insertRoom,
  softDeleteRoom,
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
  /** 전역 외형 — **만들 때 한 번만** 정해진다(0149). 이후 변경은 전부 RoomPref 로 간다. */
  imageUrl?: string;
  color?: string;
  createdBy?: string;
  createdAt?: string;
};
export type RoomMember = { roomId: string; userId: string };
/**
 * (나 × 방) 개인 설정(0149). 이름·사진·색은 **나에게만** 적용되는 덮어쓰기고,
 * showTaskDone 은 이 방 채팅에 '할일 완료' 줄을 띄울지다. 행이 없으면 전역 값 + true.
 */
export type RoomPref = {
  roomId: string;
  name?: string;
  imageUrl?: string;
  color?: string;
  /** 이 방을 마지막으로 연 시각(0154) — 안 읽은 개수의 기준. 없으면 '기준 없음'이라 0으로 센다. */
  lastReadAt?: string;
  showTaskDone: boolean;
};

// 데모 시드 — 기본방 '전체' + 비기본방 '주방'(이수민만 멤버).
const seedRooms: Room[] = [
  { id: defaultRoomId(DEMO_UNIT_ID), unitId: DEMO_UNIT_ID, name: '전체', isDefault: true },
  { id: 'room_kitchen', unitId: DEMO_UNIT_ID, name: '주방', isDefault: false },
];
const seedMembers: RoomMember[] = [{ roomId: 'room_kitchen', userId: 'u_staff_002' }];

/**
 * 내가 볼 수 있는 방 = 기본방 + 내가 멤버인 방. **서버 `can_see_room()`(0147)과 같은 판정**이어야 한다 —
 * 넓으면 열리지 않는 방이 목록에 뜨고, 좁으면 들어가 있는 방을 못 연다.
 *
 * ★인자를 받는 **순수 함수**로 둔다. 화면에서 `useRoomStore((s) => s.roomsFor)(me)` 처럼 게터를 꺼내
 *   호출하면, 함수 참조와 `me` 가 둘 다 안 변하므로 **React Compiler 가 첫 렌더의 결과를 캐시하고
 *   다시 계산하지 않는다** — 방이 도착해도 목록이 영원히 빈 채로 남는다(2026-08-19 실측).
 *   화면은 구독 중인 `rooms`·`members` 를 인자로 넘겨 `useMemo` 로 파생한다.
 */
export function visibleRooms(rooms: Room[], members: RoomMember[], userId: string): Room[] {
  return rooms.filter((r) => r.isDefault || members.some((m) => m.roomId === r.id && m.userId === userId));
}

type State = {
  rooms: Room[];
  members: RoomMember[]; // 비기본방 멤버십(기본방은 전원 → 멤버행 없음)
  prefs: RoomPref[]; // 내 것만 내려온다(RLS: 본인 행)
  currentRoomId: string | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  setCurrentRoom: (id: string) => void;
  /** 기본방('전체')이 없으면 만들어 둔다(mock 신규 매장에서 메시지가 고아 되는 것 방지). */
  ensureDefaultRoom: () => void;
  /** 서버 확인까지 기다린 결과를 돌려준다 — 화면이 이 값을 보고 성공 토스트를 띄운다(낙관적 토스트 금지). */
  createRoom: (name: string, memberIds?: string[], look?: { imageUrl?: string; color?: string }) => Promise<boolean>;
  /** 위와 같음. 실패면 false — 화면은 "삭제했어요"를 띄우면 안 된다. soft delete(대화는 남는다). */
  removeRoom: (id: string) => Promise<boolean>;
  /** 방 나가기 = 내 멤버 행 삭제. 서버 확인까지 기다린다(나가지도 않았는데 목록에서 사라지면 안 된다). */
  leaveRoom: (id: string, userId: string) => Promise<boolean>;
  addMember: (roomId: string, userId: string) => void;
  removeMember: (roomId: string, userId: string) => void;
  /** 내 개인 설정 저장(부분 갱신). 안 넘긴 칸은 그대로 둔다. */
  setPref: (roomId: string, userId: string, patch: Partial<Omit<RoomPref, 'roomId'>>) => void;
  /** 개인이 바꾼 이름·사진·색을 지워 전역 값으로 되돌린다(showTaskDone 은 유지 — 다른 축이다). */
  resetLook: (roomId: string, userId: string) => void;
  /** 이 방을 여기까지 읽었다고 표시(0154). 방을 열 때·나올 때 부른다. */
  markRead: (roomId: string, userId: string) => void;
  /** 그 사용자가 볼 수 있는 방 목록 = 기본방 + 내가 멤버인 방. 사장도 예외가 아니다(0147). */
  roomsFor: (userId: string) => Room[];
  membersOf: (roomId: string) => string[];
  applyMock: (demo: boolean) => void;
};

export const useRoomStore = create<State>((set, get) => ({
  rooms: HAS_SUPABASE ? [] : seedRooms,
  members: HAS_SUPABASE ? [] : seedMembers,
  prefs: [],
  currentRoomId: HAS_SUPABASE ? null : defaultRoomId(DEMO_UNIT_ID),
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const session = useSessionStore.getState();
    let [rooms, members, prefs] = await Promise.all([fetchRooms(), fetchRoomMembers(), fetchRoomPrefs()]);
    // 자가치유: 마이그레이션 backfill 이후 생성된 새 매장엔 기본방이 없을 수 있다.
    // 사장이 들어오면 기본방('전체')을 한 번 만들어 둔다(알바는 권한 없어 패스).
    if (session.role === 'owner' && session.unitId && !rooms.some((r) => r.isDefault)) {
      const def: Room = { id: defaultRoomId(session.unitId), unitId: session.unitId, name: '전체', isDefault: true, createdBy: session.userId };
      if (await insertRoom(def)) rooms = [def, ...rooms];
    }
    const cur = get().currentRoomId;
    const fallback = rooms.find((r) => r.isDefault)?.id ?? rooms[0]?.id ?? null;
    set({ rooms, members, prefs, loaded: true, currentRoomId: cur && rooms.some((r) => r.id === cur) ? cur : fallback });
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

  createRoom: async (name, memberIds = [], look) => {
    const session = useSessionStore.getState();
    const room: Room = {
      id: genId('room'),
      unitId: session.unitId || DEMO_UNIT_ID,
      name: name.trim() || '새 채팅방',
      isDefault: false,
      ...(look?.imageUrl ? { imageUrl: look.imageUrl } : null),
      ...(look?.color ? { color: look.color } : null),
      createdBy: session.userId,
      createdAt: new Date().toISOString(),
    };
    // ★내 멤버 행을 **반드시 같이** 넣는다. 서버 트리거(wr_add_creator_member)가 만들어 주지만,
    //   그건 다음 hydrate 때나 로컬에 도착한다. 목록은 이제 멤버십으로만 거르므로(0147) 그 사이
    //   **내가 방금 만든 방이 내 목록에서 사라진다**(2026-08-19 실제 증상).
    const mine: RoomMember = { roomId: room.id, userId: session.userId };
    const newMembers: RoomMember[] = memberIds.filter((id) => id !== session.userId).map((userId) => ({ roomId: room.id, userId }));
    set((s) => ({ rooms: [...s.rooms, room], members: [...s.members, mine, ...newMembers], currentRoomId: room.id }));
    return guardWrite(
      insertRoom(room).then(async (ok) => {
        if (!ok) return false;
        const rs = await Promise.all(newMembers.map((m) => addRoomMember(m.roomId, m.userId)));
        return rs.every(Boolean);
      }),
      () => set((s) => ({ rooms: s.rooms.filter((r) => r.id !== room.id), members: s.members.filter((m) => m.roomId !== room.id) })),
      '채팅방 만들기에 실패했어요.',
    );
  },

  removeRoom: async (id) => {
    const room = get().rooms.find((r) => r.id === id);
    if (!room || room.isDefault) return false; // 기본방은 삭제 불가
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
    return guardWrite(
      softDeleteRoom(id),
      () => set({ rooms: prevRooms, members: prevMembers }),
      '채팅방 삭제에 실패했어요.',
    );
  },

  leaveRoom: async (id, userId) => {
    const room = get().rooms.find((r) => r.id === id);
    if (!room || room.isDefault) return false; // 기본방('전체')은 나갈 수 없다
    const prevRooms = get().rooms;
    const prevMembers = get().members;
    set((s) => {
      const rooms = s.rooms.filter((r) => r.id !== id); // 나가면 그 방은 더 이상 안 보인다
      const fallback = rooms.find((r) => r.isDefault)?.id ?? rooms[0]?.id ?? null;
      return {
        rooms,
        members: s.members.filter((m) => !(m.roomId === id && m.userId === userId)),
        currentRoomId: s.currentRoomId === id ? fallback : s.currentRoomId,
      };
    });
    return guardWrite(
      removeRoomMember(id, userId),
      () => set({ rooms: prevRooms, members: prevMembers }),
      '채팅방 나가기에 실패했어요.',
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

  setPref: (roomId, userId, patch) => {
    const before = get().prefs.find((p) => p.roomId === roomId);
    const next: RoomPref = { showTaskDone: true, ...before, ...patch, roomId };
    set((s) => ({ prefs: [...s.prefs.filter((p) => p.roomId !== roomId), next] }));
    void guardWrite(
      upsertRoomPref(userId, next),
      () => set((s) => ({ prefs: before ? [...s.prefs.filter((p) => p.roomId !== roomId), before] : s.prefs.filter((p) => p.roomId !== roomId) })),
      '방 설정 저장에 실패했어요.',
    );
  },

  // 되돌리기 = 이름·사진·색만 비운다. 완료 알림 스위치는 외형과 다른 축이라 건드리지 않는다.
  // 읽음 표시는 사용자가 '한' 일이 아니라 화면이 파생시킨 부수효과라 토스트를 띄우지 않는다.
  // 대신 실패하면 낙관적 갱신을 되돌린다 — 안 그러면 배지가 사라진 채 서버엔 안 읽음으로 남는다.
  markRead: (roomId, userId) => {
    const before = get().prefs.find((p) => p.roomId === roomId);
    const at = new Date().toISOString();
    const next: RoomPref = { showTaskDone: true, ...before, roomId, lastReadAt: at };
    set((s) => ({ prefs: [...s.prefs.filter((p) => p.roomId !== roomId), next] }));
    void markRoomRead(userId, roomId, at).then((ok) => {
      if (ok) return;
      set((s) => ({ prefs: before ? [...s.prefs.filter((p) => p.roomId !== roomId), before] : s.prefs.filter((p) => p.roomId !== roomId) }));
    });
  },
  resetLook: (roomId, userId) => {
    get().setPref(roomId, userId, { name: undefined, imageUrl: undefined, color: undefined });
  },

  roomsFor: (userId) => visibleRooms(get().rooms, get().members, userId),
  membersOf: (roomId) => get().members.filter((m) => m.roomId === roomId).map((m) => m.userId),

  applyMock: (demo) =>
    set(
      demo
        ? { rooms: seedRooms, members: seedMembers, prefs: [], currentRoomId: defaultRoomId(DEMO_UNIT_ID), loaded: true }
        : { rooms: [], members: [], prefs: [], currentRoomId: null, loaded: true },
    ),
}));
