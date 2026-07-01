// 직원/사장 명부 — 매장 단위. 데모 매장은 시드(users.json), 실계정/신규매장은 실제 profiles.
// 기존엔 화면들이 users.json을 직접 읽어 "새 사장도 가짜 직원(박지원·이수민)을 보는" 문제가 있었다.
import { create } from 'zustand';
import type { Owner, Junior } from '@/types';
import usersData from '@/data/users.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchStaffProfiles, removeStaffMember, subscribeStaff, fetchPendingMembers, approveMember, rejectMember } from '@/lib/db';
import { subscribeDebounced } from '@/lib/store/realtimeSync';
import { optimisticRemove } from '@/lib/store/crudHelpers';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

const demoOwner = (usersData as any).owner as Owner;
const demoStaff = (usersData as any).staff as Junior[];

/** 합류 신청자(승인 대기, 남용 #2) — 아직 소속 아님. 이름·전화뒷4만 노출. */
export type PendingMember = { id: string; name: string; phone_last4: string; created_at: string };

type StaffState = {
  owner: Owner | null;
  staff: Junior[];
  pending: PendingMember[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  applyMock: (demo: boolean) => void;
  getStaff: (id: string) => Junior | undefined;
  // 사장이 직원을 매장에서 내보낸다(소속 해제). 낙관적 제거 + 실패 시 복원.
  removeStaff: (id: string) => void;
  // 사장이 합류 신청을 승인/거절(남용 #2). 낙관적 제거 후 실패 시 복원 + 승인은 로스터 재조회.
  approve: (id: string) => void;
  reject: (id: string) => void;
  // profiles 실시간 구독 — 신규 합류/탈퇴가 사장 화면에 즉시 반영. 해제 함수 반환.
  subscribe: () => () => void;
};

// 신규(비데모) 매장: 사장 본인만 세션에서 구성, 직원은 아직 없음.
function sessionOwner(): Owner | null {
  const s = useSessionStore.getState();
  if (s.role !== 'owner') return null;
  return {
    id: s.userId,
    name: s.userName,
    role: 'owner',
    age: 0,
    phone_last4: '',
    unit_id: s.unitId,
    joined_at: '',
    career_years: 0,
  };
}

export const useStaffStore = create<StaffState>((set, get) => ({
  // 데모 모드면 시드 명부로 즉시 시작(데모 끊김 방지). Supabase면 빈 채로 → hydrate.
  owner: HAS_SUPABASE ? null : demoOwner,
  staff: HAS_SUPABASE ? [] : demoStaff,
  pending: [],
  loaded: !HAS_SUPABASE,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const [{ owner, staff }, pending] = await Promise.all([fetchStaffProfiles(), fetchPendingMembers()]);
    set({ owner, staff, pending, loaded: true });
  },

  applyMock: (demo) =>
    set(demo ? { owner: demoOwner, staff: demoStaff, pending: [], loaded: true } : { owner: sessionOwner(), staff: [], pending: [], loaded: true }),

  getStaff: (id) => get().staff.find((s) => s.id === id),

  removeStaff: (id) => {
    optimisticRemove(set, get, 'staff', id, () => removeStaffMember(id), '직원 내보내기에 실패했어요. 다시 시도해 주세요.');
  },

  // 승인: 신청자를 낙관적으로 pending에서 빼고 승인 RPC 호출. 성공하면 로스터를 재조회(새 직원 반영),
  // 실패하면 pending을 복원한다.
  approve: (id) => {
    const before = get().pending;
    const target = before.find((p) => p.id === id);
    if (!target) return;
    set({ pending: before.filter((p) => p.id !== id) });
    void approveMember(id).then((ok) => {
      if (ok) get().hydrate();
      else {
        set({ pending: before });
        useSyncStore.getState().noteError('승인에 실패했어요. 다시 시도해 주세요.');
      }
    });
  },

  // 거절: 낙관적 제거 + 실패 시 복원.
  reject: (id) => {
    const before = get().pending;
    if (!before.some((p) => p.id === id)) return;
    set({ pending: before.filter((p) => p.id !== id) });
    void rejectMember(id).then((ok) => {
      if (!ok) {
        set({ pending: before });
        useSyncStore.getState().noteError('거절 처리에 실패했어요. 다시 시도해 주세요.');
      }
    });
  },

  subscribe: () => subscribeDebounced(subscribeStaff, () => get().hydrate()),
}));
