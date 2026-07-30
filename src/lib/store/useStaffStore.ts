// 직원/사장 명부 — 매장 단위. 데모 매장은 시드(users.json), 실계정/신규매장은 실제 profiles.
// 기존엔 화면들이 users.json을 직접 읽어 "새 사장도 가짜 직원(박지원·이수민)을 보는" 문제가 있었다.
import { create } from 'zustand';
import type { Owner, Junior } from '@/types';
import usersData from '@/data/users.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchStaffProfiles, removeStaffMember, subscribeStaff, fetchPendingMembers, approveMember, rejectMember, fetchUnitMemberRoles, setMemberRoleDb } from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { notifyUserRoleChange } from '@/lib/push/notify';
import { PLANS } from '@/lib/config/tiers';
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
  // 매장별 역할 맵(0093, unit_members.role) — 매니저 배지·임명 UI 입력. 키=userId.
  roles: Record<string, string>;
  loaded: boolean;
  loadError: boolean; // 마지막 hydrate 실패 여부 — 명부가 "직원 0명"과 "못 불러옴"을 구분한다.
  hydrate: () => Promise<void>;
  applyMock: (demo: boolean) => void;
  getStaff: (id: string) => Junior | undefined;
  // 사장이 직원을 매장에서 내보낸다(소속 해제). 낙관적 제거 + 실패 시 복원.
  removeStaff: (id: string) => void;
  // 사장이 합류 신청을 승인/거절(남용 #2). 낙관적 제거 후 실패 시 복원 + 승인은 로스터 재조회.
  approve: (id: string) => void;
  reject: (id: string) => void;
  // 사장이 매니저 지정/해제(0093). 낙관적 갱신 + 실패 시 복원. 서버 게이트=set_member_role(소유자만).
  setRole: (id: string, role: 'manager' | 'junior') => void;
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
  roles: {},
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const [staffRes, pendingRes, rolesRes] = await Promise.all([
      fetchStaffProfiles(),
      fetchPendingMembers(),
      fetchUnitMemberRoles(),
    ]);
    set({
      owner: staffRes.owner,
      staff: staffRes.staff,
      pending: pendingRes.data,
      // 역할 맵 읽기 실패는 명부 자체를 막지 않는다 — 배지·임명만 잠시 기본값(junior)으로 보인다.
      roles: rolesRes.data,
      loaded: true,
      loadError: staffRes.error || pendingRes.error,
    });
  },

  applyMock: (demo) =>
    set(
      demo
        ? { owner: demoOwner, staff: demoStaff, pending: [], loaded: true, loadError: false }
        : { owner: sessionOwner(), staff: [], pending: [], loaded: true, loadError: false },
    ),

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
    void approveMember(id).then(({ ok, code }) => {
      if (ok) get().hydrate();
      else {
        set({ pending: before });
        useSyncStore.getState().noteError(
          code === 'staff_limit'
            ? `무료 요금제는 직원 ${PLANS.free.maxStaff}명까지 승인할 수 있어요. 요금제를 올리면 더 승인할 수 있어요.`
            : '승인에 실패했어요. 다시 시도해 주세요.',
        );
      }
    });
  },

  // 매니저 지정/해제(0093): 낙관적 갱신 + 실패 시 복원. 성공 시 토스트 + 대상 본인에게 푸시.
  // 확인 모달 없음(P7) — 같은 버튼으로 즉시 되돌릴 수 있는 동작이라 실행 + 알림으로 충분하다.
  setRole: (id, role) => {
    const before = get().roles;
    if ((before[id] ?? 'junior') === role) return;
    set({ roles: { ...before, [id]: role } });
    void setMemberRoleDb(id, role).then((ok) => {
      if (!ok) {
        set({ roles: before });
        useSyncStore.getState().noteError('역할 변경에 실패했어요. 다시 시도해 주세요.');
        return;
      }
      const name = get().staff.find((s) => s.id === id)?.name || '직원';
      showToast(role === 'manager' ? `${name}님을 매니저로 지정했어요` : `${name}님을 매니저에서 해제했어요`, 'good');
      notifyUserRoleChange(id, useSessionStore.getState().storeName, role === 'manager');
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
