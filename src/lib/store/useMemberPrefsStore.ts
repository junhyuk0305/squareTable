// 매장별 개인 설정(unit_member_prefs) 스토어 — "직원×매장" 레이어.
// 닉네임·색·매장별 방해금지·음소거를 매장(unit_id)별로 보관한다. 계정 전역 알림 선호(usePreferencesStore)
// 와 별개 축이다. 저장은 원자적 upsert RPC(saveMemberPrefs) 한 번 — 낙관적 반영 후 실패 시 롤백.
import { create } from 'zustand';
import { fetchMemberPrefs, saveMemberPrefs, type UnitMemberPrefsRow } from '@/lib/db';

export type MemberPref = {
  nickname: string | null;
  color: string | null; // null 이면 storeColor(unitId) 자동색
  muted: boolean;
  quiet_enabled: boolean;
  quiet_start: string; // "HH:MM"
  quiet_end: string; // "HH:MM"
};

export const DEFAULT_MEMBER_PREF: MemberPref = {
  nickname: null,
  color: null,
  muted: false,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '08:00',
};

type State = {
  byUnit: Record<string, MemberPref>;
  loaded: boolean;
  /** 로그인/전환 후 1회 — 내 전 매장 개인 설정을 한 번에 당긴다(읽기 실패 시 조용히 기존 유지). */
  hydrate: () => Promise<void>;
  /** unit_id 의 설정(없으면 기본값). */
  prefFor: (unitId: string) => MemberPref;
  /** 저장 — 낙관적 반영 후 실패 시 롤백하고 error 반환(무음 유실 방지). */
  save: (unitId: string, patch: Partial<MemberPref>) => Promise<{ error: string | null }>;
};

export const useMemberPrefsStore = create<State>((set, get) => ({
  byUnit: {},
  loaded: false,

  hydrate: async () => {
    const { data, error } = await fetchMemberPrefs();
    if (error || !data) return;
    const byUnit: Record<string, MemberPref> = {};
    for (const r of data) {
      byUnit[r.unit_id] = {
        nickname: r.nickname,
        color: r.color,
        muted: r.muted,
        quiet_enabled: r.quiet_enabled,
        quiet_start: r.quiet_start,
        quiet_end: r.quiet_end,
      };
    }
    set({ byUnit, loaded: true });
  },

  prefFor: (unitId) => get().byUnit[unitId] ?? DEFAULT_MEMBER_PREF,

  save: async (unitId, patch) => {
    const prev = get().byUnit[unitId] ?? DEFAULT_MEMBER_PREF;
    const next: MemberPref = { ...prev, ...patch };
    set({ byUnit: { ...get().byUnit, [unitId]: next } });
    const row: UnitMemberPrefsRow = { unit_id: unitId, ...next };
    const { error } = await saveMemberPrefs(row);
    if (error) {
      set({ byUnit: { ...get().byUnit, [unitId]: prev } }); // 롤백
      return { error: error.message };
    }
    return { error: null };
  },
}));
