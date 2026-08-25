// 매장별 개인 설정(unit_member_prefs) 스토어 — "직원×매장" 레이어.
// 닉네임·색·매장별 방해금지·음소거를 매장(unit_id)별로 보관한다. 계정 전역 알림 선호(usePreferencesStore)
// 와 별개 축이다. 저장은 원자적 upsert RPC(saveMemberPrefs) 한 번 — 낙관적 반영 후 실패 시 롤백.
import { create } from 'zustand';
import { fetchMemberPrefs, saveMemberPrefs, ackNotifications, type UnitMemberPrefsRow } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { HAS_SUPABASE } from '@/lib/supabase';

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
  /** true = 조회 **시도가 끝남**(성공·실패 무관). 실패 여부는 loadError 로 본다. */
  loaded: boolean;
  /** 마지막 hydrate 가 실패했는가 — 화면이 "전부 꺼짐"과 "못 불러옴"을 구분해 재시도 UI를 띄운다. */
  loadError: boolean;
  /** 로그인/전환 후 1회 — 내 전 매장 개인 설정을 한 번에 당긴다. */
  hydrate: () => Promise<void>;
  /** 재시도 — TTL 을 무시하고 즉시 다시 당긴다(실패 화면의 '다시 시도' 버튼). */
  retry: () => Promise<void>;
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
  // 다른 스토어와 같은 관례 — 백엔드가 없으면(데모) 기다릴 것이 없으므로 처음부터 도착으로 친다.
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: async () => {
    const now = Date.now();
    if (now - _lastHydrateAt < HYDRATE_TTL_MS) return;
    _lastHydrateAt = now;
    const { data, error } = await fetchMemberPrefs();
    if (error || !data) {
      _lastHydrateAt = 0; // 실패는 TTL 미적용 — 다음 진입에서 즉시 재시도
      // ★못 불러왔어도 '기다리기'는 끝났다. 여기서 loaded 를 안 세우면 이 플래그를 게이트에 넣은
      //   화면이 **영영 스피너에 갇힌다**(데모 모드는 error 없이 data=null 이라 항상 이 경로다).
      //   대신 실패는 loadError 로 말한다 — 안 그러면 "전부 꺼짐"으로 위장되고,
      //   그 상태에서 토글 한 번이면 6개 필드가 전부 기본값으로 서버에 덮인다(#47 → save 가 거부).
      set({ loaded: true, loadError: !!error });
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
    set({ byUnit, ackByUnit, loaded: true, loadError: false });
  },

  retry: async () => {
    _lastHydrateAt = 0;
    await get().hydrate();
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
    // ★읽기가 실패한 상태에서는 저장을 거부한다(#47). byUnit 이 비어 있으므로 prev 가 기본값이 되고,
    //   토글 하나를 눌러도 nickname·color·quiet_* 6개 필드 **전부**가 기본값으로 서버에 덮인다 —
    //   사용자가 설정한 적 없는 값이 사용자 것으로 확정되는 조용한 데이터 손상이다.
    if (get().loadError) {
      return { error: '설정을 불러오지 못해 저장할 수 없어요. 새로고침 후 다시 시도해 주세요.' };
    }
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
