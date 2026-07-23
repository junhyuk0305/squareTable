// 매장별 개인 설정(unit_member_prefs) 스토어 — "직원×매장" 레이어.
// 닉네임·색·매장별 방해금지·음소거를 매장(unit_id)별로 보관한다. 계정 전역 알림 선호(usePreferencesStore)
// 와 별개 축이다. 저장은 원자적 upsert RPC(saveMemberPrefs) 한 번 — 낙관적 반영 후 실패 시 롤백.
import { create } from 'zustand';
import { fetchMemberPrefs, saveMemberPrefs, ackNotifications, type UnitMemberPrefsRow } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';

// 연속 진입(허브→설정 등) 순간 이중 fetch 방지 — 이 간격 안의 재호출은 스킵(useCrossNotifStore 와 동일 패턴).
// 저장/ack 는 낙관적 로컬 반영이라 TTL 과 무관하게 즉시 보인다.
const HYDRATE_TTL_MS = 5_000;
let _lastHydrateAt = 0;

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
  /** 알림 '모두 읽기' 기준 시각(0078) — unit_id → ISO. MemberPref(저장 RPC 축)와 분리 보관. */
  ackByUnit: Record<string, string | null>;
  loaded: boolean;
  /** 로그인/전환 후 1회 — 내 전 매장 개인 설정을 한 번에 당긴다(읽기 실패 시 조용히 기존 유지). */
  hydrate: () => Promise<void>;
  /** unit_id 의 설정(없으면 기본값). */
  prefFor: (unitId: string) => MemberPref;
  /** unit_id 의 알림 ack 시각(없으면 null = 전체 미ack). */
  ackFor: (unitId: string) => string | null;
  /** 알림 모두 읽기 — 낙관적 반영 후 실패 시 롤백+배너(guardWrite). */
  ackNotifs: (unitId: string) => Promise<void>;
  /** 저장 — 낙관적 반영 후 실패 시 롤백하고 error 반환(무음 유실 방지). */
  save: (unitId: string, patch: Partial<MemberPref>) => Promise<{ error: string | null }>;
};

export const useMemberPrefsStore = create<State>((set, get) => ({
  byUnit: {},
  ackByUnit: {},
  loaded: false,

  hydrate: async () => {
    const now = Date.now();
    if (now - _lastHydrateAt < HYDRATE_TTL_MS) return;
    _lastHydrateAt = now;
    const { data, error } = await fetchMemberPrefs();
    if (error || !data) {
      _lastHydrateAt = 0; // 실패는 TTL 미적용 — 다음 진입에서 즉시 재시도
      return;
    }
    const byUnit: Record<string, MemberPref> = {};
    const ackByUnit: Record<string, string | null> = {};
    for (const r of data) {
      byUnit[r.unit_id] = {
        nickname: r.nickname,
        color: r.color,
        muted: r.muted,
        quiet_enabled: r.quiet_enabled,
        quiet_start: r.quiet_start,
        quiet_end: r.quiet_end,
      };
      ackByUnit[r.unit_id] = r.notif_ack_at ?? null;
    }
    set({ byUnit, ackByUnit, loaded: true });
  },

  prefFor: (unitId) => get().byUnit[unitId] ?? DEFAULT_MEMBER_PREF,

  ackFor: (unitId) => get().ackByUnit[unitId] ?? null,

  ackNotifs: async (unitId) => {
    const prev = get().ackByUnit[unitId] ?? null;
    set({ ackByUnit: { ...get().ackByUnit, [unitId]: new Date().toISOString() } });
    await guardWrite(
      ackNotifications(unitId),
      () => set({ ackByUnit: { ...get().ackByUnit, [unitId]: prev } }),
      '모두 읽음 처리에 실패했어요.',
    );
  },

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
