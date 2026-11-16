// 매장별 개인 설정(unit_member_prefs) 스토어 — "직원×매장" 레이어.
// 닉네임·색·매장별 방해금지·음소거를 매장(unit_id)별로 보관한다. 계정 전역 알림 선호(usePreferencesStore)
// 와 별개 축이다. 저장은 원자적 upsert RPC(saveMemberPrefs) 한 번 — 낙관적 반영 후 실패 시 롤백.
import { create } from 'zustand';
import { currentAccountEpoch, isStaleAccountEpoch } from '@/lib/store/tenantEpoch';
import { fetchMemberPrefs, fetchNotifSeen, fetchNotifRowRead, saveMemberPrefs, markNotifsSeen, markNotifRowsRead, type UnitMemberPrefsRow } from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { tsMs } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';

// 연속 진입(허브→설정 등) 순간 이중 fetch 방지 — 이 간격 안의 재호출은 스킵(useCrossNotifStore 와 동일 패턴).
// 저장/ack 는 낙관적 로컬 반영이라 TTL 과 무관하게 즉시 보인다.
const HYDRATE_TTL_MS = 5_000;
let _lastHydrateAt = 0;
/** 계정이 바뀌면 TTL 도 비운다 — 안 비우면 새 계정의 첫 조회가 5초 동안 건너뛰어진다(tenantReset.ts). */
export function resetMemberPrefsHydrateTtl() {
  _lastHydrateAt = 0;
}

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
  /** 자리(매장·공간)별 읽은 시각 — unit_id → ISO. = max(0078 notif_ack_at, 0810 notif_seen.seen_at).
   *  알림 줄은 자기 자리의 이 값 뒤에 왔을 때만 안 읽음이다. MemberPref(저장 RPC 축)와 분리 보관. */
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
  /** 전체 읽음 — 이 앱의 유일한 읽음 쓰기(0810 mark_notifs_seen). unitIds = 그 화면이 담는 자리 전부
   *  (허브 = 내 모든 자리 · 매장 화면 = 그 매장). 서버 시각을 받은 뒤에만 로컬을 바꾸고 성공 문구를 띄운다. 실패면 그대로 두고 실패 문구. */
  markAllSeen: (unitIds: string[], feedIds: string[]) => Promise<boolean>;
  /** 읽은 시각 하나 반영(실시간 · 다른 기기). 늦은 값만 받는다. */
  applySeen: (unitId: string, at: string) => void;
  /** 눌러 본 알림 줄 열쇠(0811 · notifRowKey). 판정은 notifications.ts readOff 하나. */
  rowRead: ReadonlySet<string>;
  /** 줄 하나 읽음(눌러서 들어갈 때) — 바로 끄고 서버에 쓴다. 실패하면 되돌린다(다시 켜진다). */
  markRowRead: (key: string) => void;
  /** 줄 읽음 하나 반영(실시간 · 다른 기기). */
  applyRowRead: (key: string) => void;
  /** 저장 — 낙관적 반영 후 실패 시 롤백하고 error 반환(무음 유실 방지). */
  save: (unitId: string, patch: Partial<MemberPref>) => Promise<{ error: string | null }>;
};

/** 두 시각 중 늦은 것(없으면 있는 쪽). 읽은 시각은 뒤로 가지 않는다. */
const later = (a: string | null | undefined, b: string | null | undefined): string | null =>
  !a ? (b ?? null) : !b ? a : tsMs(b) > tsMs(a) ? b : a;

export const useMemberPrefsStore = create<State>((set, get) => ({
  byUnit: {},
  ackByUnit: {},
  rowRead: new Set<string>(),
  // 다른 스토어와 같은 관례 — 백엔드가 없으면(데모) 기다릴 것이 없으므로 처음부터 도착으로 친다.
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: async () => {
    const epoch = currentAccountEpoch();
    const now = Date.now();
    if (now - _lastHydrateAt < HYDRATE_TTL_MS) return;
    _lastHydrateAt = now;
    const [{ data, error }, seen, rows] = await Promise.all([fetchMemberPrefs(), fetchNotifSeen(), fetchNotifRowRead()]);
    if (isStaleAccountEpoch(epoch)) return;
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
    // 읽은 시각은 로컬 값과 합친다(늦은 쪽) — 조회가 나간 뒤 전체 읽음·실시간으로 받은 값을 옛 응답이 덮으면 읽은 줄이 다시 켜진다.
    //   계정이 바뀌면 tenantReset 이 이 스토어를 비우므로 남의 값이 섞이지 않는다.
    const ackByUnit: Record<string, string | null> = { ...get().ackByUnit };
    for (const r of data) {
      byUnit[r.unit_id] = {
        nickname: r.nickname,
        color: r.color,
        muted: r.muted,
        quiet_enabled: r.quiet_enabled,
        quiet_start: r.quiet_start,
        quiet_end: r.quiet_end,
      };
      ackByUnit[r.unit_id] = later(ackByUnit[r.unit_id], r.notif_ack_at);
    }
    // 0810 자리별 읽은 시각 — 멤버가 아닌 자리도 있다. 못 읽었으면 다음 진입에서 바로 다시 읽는다(TTL 미적용).
    //   그동안은 로컬에 이미 있던 값을 지킨다(위 합치기) — 없던 자리만 안 읽음으로 남는다.
    if (seen.error || rows.error) _lastHydrateAt = 0;
    for (const r of seen.data ?? []) ackByUnit[r.unit_id] = later(ackByUnit[r.unit_id], r.seen_at);
    // 눌러 본 줄 — 로컬과 합친다(조회 사이에 누른 줄이 다시 켜지지 않게).
    const rowRead = new Set(get().rowRead);
    for (const k of rows.data ?? []) rowRead.add(k);
    set({ byUnit, ackByUnit, rowRead, loaded: true, loadError: false });
  },

  retry: async () => {
    _lastHydrateAt = 0;
    await get().hydrate();
  },

  prefFor: (unitId) => get().byUnit[unitId] ?? DEFAULT_MEMBER_PREF,

  ackFor: (unitId) => get().ackByUnit[unitId] ?? null,

  markAllSeen: async (unitIds, feedIds) => {
    const epoch = currentAccountEpoch();
    const ids = [...new Set(unitIds.filter(Boolean))];
    if (ids.length === 0) return false;
    // 기기 시계를 쓰지 않는다 — 줄 시각은 서버 시각이라 기기 시계가 어긋나면 방금 온 줄이 숨거나 남는다.
    const at = await markNotifsSeen(ids, [...new Set(feedIds)]);
    if (isStaleAccountEpoch(epoch)) return false;
    if (!at) {
      showToast('모두 읽음 처리에 실패했어요. 다시 눌러 주세요.', 'warn');
      return false;
    }
    const next = { ...get().ackByUnit };
    for (const u of ids) next[u] = later(next[u], at);
    set({ ackByUnit: next });
    showToast('모두 읽음 처리했어요', 'good');
    return true;
  },

  markRowRead: (key) => {
    if (!key || get().rowRead.has(key)) return;
    const epoch = currentAccountEpoch();
    set({ rowRead: new Set(get().rowRead).add(key) });
    void markNotifRowsRead([key]).then((ok) => {
      if (ok || isStaleAccountEpoch(epoch)) return;
      const next = new Set(get().rowRead);
      next.delete(key);
      set({ rowRead: next });
    });
  },

  applyRowRead: (key) => {
    if (!get().rowRead.has(key)) set({ rowRead: new Set(get().rowRead).add(key) });
  },

  applySeen: (unitId, at) => {
    const cur = get().ackByUnit[unitId];
    const v = later(cur, at);
    if (v !== cur) set({ ackByUnit: { ...get().ackByUnit, [unitId]: v } });
  },

  save: async (unitId, patch) => {
    const epoch = currentAccountEpoch();
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
    if (isStaleAccountEpoch(epoch)) return { error: '계정이 바뀌었어요. 현재 계정에서 다시 확인해 주세요.' };
    if (error) {
      set({ byUnit: { ...get().byUnit, [unitId]: prev } }); // 롤백
      return { error: error.message };
    }
    return { error: null };
  },
}));
