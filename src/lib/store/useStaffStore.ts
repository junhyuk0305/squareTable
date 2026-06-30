// 직원/사장 명부 — 매장 단위. 데모 매장은 시드(users.json), 실계정/신규매장은 실제 profiles.
// 기존엔 화면들이 users.json을 직접 읽어 "새 사장도 가짜 직원(박지원·이수민)을 보는" 문제가 있었다.
import { create } from 'zustand';
import type { Owner, Junior } from '@/types';
import usersData from '@/data/users.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchStaffProfiles, removeStaffMember } from '@/lib/db';
import { optimisticRemove } from '@/lib/store/crudHelpers';
import { useSessionStore } from '@/lib/store/useSessionStore';

const demoOwner = (usersData as any).owner as Owner;
const demoStaff = (usersData as any).staff as Junior[];

type StaffState = {
  owner: Owner | null;
  staff: Junior[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  applyMock: (demo: boolean) => void;
  getStaff: (id: string) => Junior | undefined;
  // 사장이 직원을 매장에서 내보낸다(소속 해제). 낙관적 제거 + 실패 시 복원.
  removeStaff: (id: string) => void;
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
  loaded: !HAS_SUPABASE,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const { owner, staff } = await fetchStaffProfiles();
    set({ owner, staff, loaded: true });
  },

  applyMock: (demo) =>
    set(demo ? { owner: demoOwner, staff: demoStaff, loaded: true } : { owner: sessionOwner(), staff: [], loaded: true }),

  getStaff: (id) => get().staff.find((s) => s.id === id),

  removeStaff: (id) => {
    optimisticRemove(set, get, 'staff', id, () => removeStaffMember(id), '직원 내보내기에 실패했어요. 다시 시도해 주세요.');
  },
}));
