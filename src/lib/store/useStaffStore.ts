// 직원/사장 명부 — 매장 단위. 데모 매장은 시드(users.json), 실계정/신규매장은 실제 profiles.
// 기존엔 화면들이 users.json을 직접 읽어 "새 사장도 가짜 직원(박지원·이수민)을 보는" 문제가 있었다.
import { create } from 'zustand';
import type { Owner, Junior } from '@/types';
import usersData from '@/data/users.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchStaffProfiles, removeStaffMember, subscribeStaff, fetchPendingMembers, approveMember, rejectMember, setMemberRoleDb, fetchMemberTenures, fetchJoinNotices, fetchJoinHistory } from '@/lib/db';
import { openJoinedAt, type MemberTenure } from '@/lib/utils/tenure';
import { showToast } from '@/lib/store/useToastStore';
import { PLANS } from '@/lib/config/tiers';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { currentTenantEpoch, isStaleEpoch } from '@/lib/store/tenantEpoch';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { router } from 'expo-router';
import { showUpgradeHint } from '@/lib/config/store-policy';
import { workErrorCode, workErrorMessage } from '@/lib/work/errors';

const demoOwner = (usersData as any).owner as Owner;
const demoStaff = (usersData as any).staff as Junior[];

/** 다른 기기에서 이미 승인·거절한 신청(not_pending) — 오류가 아니다. 중립 안내 뒤 서버 상태로 목록을 맞춘다(승인·거절 공용). */
const alreadyDecided = (get: () => StaffState) => {
  showToast('이미 처리된 신청이에요. 목록을 새로 불러올게요.');
  void get().hydrate();
};

/** 역할 변경이 서버에 가 있는 직원(M18) — 끝나기 전 다시 누름은 보내지 않는다(연타·옛 화면 값으로 두 번 바뀌는 것 방지). */
const roleSaving = new Set<string>();

/** 합류 신청자(승인 대기, 남용 #2) — 아직 소속 아님. 이름·전화뒷4만 노출. */
export type PendingMember = { id: string; name: string; phone_last4: string; created_at: string };

/** 내 합류 결과(0247 member_notices · approved·rejected) — 서버가 승인·반려 때 넣는다. 푸시는 크론이 같은 행을 보낸다. 벨 항목의 원천. */
// 0317: removed = 사장이 나를 내보냄(0247 · 계정 단위 · 그 매장은 이미 내 매장이 아니다).
// 0460 공간(4번 덩이): join_approved = 공간 멤버 요청이 수락됨(N8 · 새 종류 값) · space_join_request = 내 공간에 온 대기 요청(N7 ·
//   요청 행 파생 · id = 요청 번호 · actor_id = 요청한 사람). unit_id = 그 공간 번호.
export type JoinNotice = {
  id: number | string; unit_id: string; kind: 'approved' | 'rejected' | 'removed' | 'join_approved' | 'space_join_request';
  store_name: string | null; body: string; created_at: string; actor_id?: string;
};
/** 처리한 합류 신청(0345 join_history_rows · 사장 매장). 사장 목록의 '처리함' 내역. actor = 처리한 사람(0345 전 행은 null). */
export type JoinDone = {
  id: number; unit_id: string; kind: 'approved' | 'rejected';
  applicant_id: string; applicant_name: string; actor_id: string | null; actor_name: string; created_at: string;
};

type StaffState = {
  owner: Owner | null;
  staff: Junior[];
  pending: PendingMember[];
  // 내 합류 결과(계정 단위 · 본인 행만). 신청자의 profiles 행이 바뀌면(승인·반려) subscribe 가 hydrate 를 다시 불러 곧 따라온다.
  joinNotices: JoinNotice[];
  // 이 매장에서 처리한 합류 신청(0345) — 사장 목록의 '처리함' 내역. 사장만 읽는다. 못 읽으면 빈 배열.
  joinDone: JoinDone[];
  // 매장별 역할 맵(0093, unit_members.role) — 매니저 배지·임명 UI 입력. 키=userId.
  roles: Record<string, string>;
  // 이 매장 재직 기간(0246) — 사장만 읽는다. 입사일 · 이번 기간 퇴사자 줄 · 재입사 경고의 입력. 못 읽으면 빈 배열.
  tenures: MemberTenure[];
  loaded: boolean;
  loadError: boolean; // 마지막 hydrate 실패 여부 — 명부가 "직원 0명"과 "못 불러옴"을 구분한다.
  hydrate: () => Promise<void>;
  /** 마지막 hydrate 시작 시각(ms · 0 = 아직). 화면 포커스의 "다시 읽기"가 이 값으로 생략 여부를 정한다(M4). */
  fetchedAt: number;
  /** fetchedAt 이 maxAgeMs 보다 오래됐을 때만 hydrate — 합류 신청(pending) 표는 publication 밖이라 포커스가 최신화 시점이다. */
  hydrateIfStale: (maxAgeMs: number) => Promise<void>;
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

/** 매장 멤버 이름 — 사장 포함(unit_members 명부). 알림 목록의 nameOf 가 쓴다.
 *  직원 목록(staff)만 보면 사장이 배정한 할일이 '동료님이 할 일을 배정했어요'로 뜬다(2026-10-16 F4).
 *  모르는 id(탈퇴·다른 매장)는 undefined → 호출부가 폴백('동료'·'직원')을 정한다. */
export const memberNameOf = (s: Pick<StaffState, 'owner' | 'staff'>, id: string): string | undefined =>
  s.owner?.id === id ? s.owner.name || undefined : s.staff.find((x) => x.id === id)?.name;

export const useStaffStore = create<StaffState>((set, get) => ({
  // 데모 모드면 시드 명부로 즉시 시작(데모 끊김 방지). Supabase면 빈 채로 → hydrate.
  owner: HAS_SUPABASE ? null : demoOwner,
  staff: HAS_SUPABASE ? [] : demoStaff,
  pending: [],
  joinNotices: [],
  joinDone: [],
  roles: {},
  tenures: [],
  loaded: !HAS_SUPABASE,
  loadError: false,
  fetchedAt: 0,

  // ★겹친 재조회는 합친다(M12 · coalesce) — 포커스·승인 성공·실시간이 동시에 부르면 늦게 끝난 옛 응답이 새 명부를 덮었다.
  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    // 화면 포커스·승인 성공·실시간 이벤트도 이 길로 다시 당긴다 — 전부 같은 가드를 지난다.
    const epoch = currentTenantEpoch();
    set({ fetchedAt: Date.now() });
    // 재직 기간은 사장에게만 행이 온다(RLS). 0246 이 없는 서버에서는 실패한다 — 실패는 명부 실패로 보지 않고 이전 기간(처음이면 빈 기간)으로 둔다.
    const isOwner = useSessionStore.getState().role === 'owner';
    const [staffRes, pendingRes, tenRes, joinRes, doneRes] = await Promise.all([
      fetchStaffProfiles(),
      fetchPendingMembers(),
      isOwner ? fetchMemberTenures() : Promise.resolve({ data: [] as MemberTenure[], error: false }),
      // 합류 결과는 읽기 실패를 명부 실패로 보지 않는다(벨 항목 하나가 빠질 뿐이다).
      fetchJoinNotices(),
      // 처리한 합류 신청도 사장만(0345 · 서버도 사장 매장만 준다). 실패는 내역이 빌 뿐이다.
      isOwner ? fetchJoinHistory() : Promise.resolve({ data: [] as JoinDone[], error: false }),
    ]);
    if (isStaleEpoch(epoch)) return; // 그 사이 매장이 바뀌었다 — 이전 매장 명부를 쓰지 않는다
    // ★읽기가 실패하면 이전 값을 둔다(M11) — 빈 명부로 덮으면 "직원 0명"이 사실인 양 굳는다. 실패는 loadError 로 말한다.
    //   역할 맵은 명부와 같은 멤버십 읽기에서 온다 — 그 읽기가 실패하면 명부도 실패(loadError)다.
    //   재직 기간·합류 결과·처리 내역도 실패면 이전 값을 둔다(L-4). loadError 에는 넣지 않는다(명부 실패가 아니다).
    set((s) => {
      const tenures = tenRes.error ? s.tenures : tenRes.data;
      return {
      ...(staffRes.error
        ? null
        : {
            owner: staffRes.owner,
            // 입사일 = 열린 재직 기간의 joined_at(이 매장에 들어온 날). 기간이 없으면 기존 값(profiles.created_at) 그대로.
            staff: staffRes.staff.map((m) => ({ ...m, joined_at: openJoinedAt(tenures, m.id) ?? m.joined_at })),
            roles: staffRes.roles,
          }),
      tenures,
      pending: pendingRes.error ? s.pending : pendingRes.data,
      joinNotices: joinRes.error ? s.joinNotices : joinRes.data,
      joinDone: doneRes.error ? s.joinDone : doneRes.data,
      loaded: true,
      loadError: staffRes.error || pendingRes.error,
      };
    });
  }),

  applyMock: (demo) =>
    set(
      demo
        ? { owner: demoOwner, staff: demoStaff, pending: [], loaded: true, loadError: false }
        : { owner: sessionOwner(), staff: [], pending: [], loaded: true, loadError: false },
    ),

  getStaff: (id) => get().staff.find((s) => s.id === id),

  // ★S5-2: 서버 staff_not_found = 이미 나간 직원(다른 기기에서 먼저 내보냄) → already. 원하던 상태라 되돌리지 않고 다시 읽는다.
  //   그 밖의 실패만 원위치로 복원 + "못 했어요". 쓰기 중 매장이 바뀌었으면 복원하지 않는다(이전 매장 직원이다).
  removeStaff: (id) => {
    const arr = get().staff;
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const removed = arr[idx];
    const epoch = currentTenantEpoch();
    set((s) => ({ staff: s.staff.filter((x) => x.id !== id) }));
    void removeStaffMember(id).then((d) => {
      if (d === 'ok') return;
      if (d === 'already') { void get().hydrate(); return; }
      if (!isStaleEpoch(epoch))
        set((s) => {
          if (s.staff.some((x) => x.id === id)) return s;
          const next = s.staff.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return { staff: next };
        });
      useSyncStore.getState().noteError('직원 내보내기에 실패했어요. 다시 시도해 주세요.');
    });
  },

  // 승인: 신청자를 낙관적으로 pending에서 빼고 승인 RPC 호출. 성공하면 로스터를 재조회(새 직원 반영),
  // 실패하면 pending을 복원한다.
  // ★not_pending(이미 처리됨) 은 실패가 아니다 — 두 기기가 같은 신청을 잇달아 누르면 뒤 기기가 받는다(K5-b).
  //   복원하면 이미 승인된 사람이 대기 목록에 되살아난다. 뺀 줄은 그대로 두고 서버 상태로 다시 읽는다.
  approve: (id) => {
    const before = get().pending;
    const target = before.find((p) => p.id === id);
    if (!target) return;
    // 쓰기 중 매장이 바뀌면 before(이전 매장 신청자 목록)로 되돌리지 않는다 — 새 매장 hydrate 가 채운다.
    const epoch = currentTenantEpoch();
    set({ pending: before.filter((p) => p.id !== id) });
    void approveMember(id).then(({ decision, code }) => {
      if (decision === 'ok') {
        showToast(`${target.name}님의 합류를 승인했어요`, 'good');
        get().hydrate();
      } else if (decision === 'already') alreadyDecided(get);
      else {
        if (!isStaleEpoch(epoch)) set({ pending: before });
        const limitMsg = `무료 요금제는 직원 ${PLANS.free.maxStaff}명까지 승인할 수 있어요.`;
        // 결제 화면으로 갈 수 있는 사장에게만 길을 준다(매니저·직원은 요금제를 못 바꾼다 · 판정 store-policy).
        // ★행 이름이 채널마다 달라(웹 '요금제' · iOS '이용권') 문구로 위치를 말하지 않고 버튼으로 보낸다.
        if (code === 'staff_limit' && showUpgradeHint(useSessionStore.getState())) {
          showToast(`${limitMsg} 바꾸면 더 승인할 수 있어요.`, undefined, { label: '바꾸러 가기', onPress: () => router.push('/billing') });
          return;
        }
        useSyncStore.getState().noteError(code === 'staff_limit' ? limitMsg : '승인에 실패했어요. 다시 시도해 주세요.');
      }
    });
  },

  // 매니저 지정/해제(0093): 낙관적 갱신 + 실패 시 복원. 성공 시 토스트.
  // 확인 모달은 화면(staff.tsx)이 지정할 때 띄운다. 이 함수는 확인이 끝난 뒤 불린다.
  // 대상 본인 알림은 서버가 보낸다(0315 · set_member_role → member_notices). 앱은 푸시를 쏘지 않는다.
  setRole: (id, role) => {
    const before = get().roles;
    if ((before[id] ?? 'junior') === role) return;
    if (roleSaving.has(id)) return; // M18: 진행 중이면 다음 누름을 막는다
    roleSaving.add(id);
    const epoch = currentTenantEpoch(); // approve 와 같은 이유 — 이전 매장 역할 맵으로 되돌리지 않는다
    set({ roles: { ...before, [id]: role } });
    void setMemberRoleDb(id, role).then((err) => {
      roleSaving.delete(id);
      if (err) {
        if (!isStaleEpoch(epoch)) set({ roles: before });
        // staff_not_found = 그 사이 나간 직원(S5-1 문구 표) · 그 밖은 지금 문구
        useSyncStore.getState().noteError(workErrorMessage(err, '역할 변경에 실패했어요. 다시 시도해 주세요.'));
        if (workErrorCode(err) === 'staff_not_found' && !isStaleEpoch(epoch)) void get().hydrate();
        return;
      }
      const name = get().staff.find((s) => s.id === id)?.name || '직원';
      showToast(role === 'manager' ? `${name}님을 매니저로 지정했어요` : `${name}님을 매니저에서 해제했어요`, 'good');
    });
  },

  // 거절: 낙관적 제거 + 실패 시 복원. not_pending 은 approve 와 같은 길(이미 처리됨 → 다시 읽기).
  reject: (id) => {
    const before = get().pending;
    const target = before.find((p) => p.id === id);
    if (!target) return;
    const epoch = currentTenantEpoch(); // approve 와 같은 이유
    set({ pending: before.filter((p) => p.id !== id) });
    void rejectMember(id).then(({ decision }) => {
      if (decision === 'ok') return showToast(`${target.name}님의 합류를 거절했어요`, 'info');
      if (decision === 'already') return alreadyDecided(get);
      if (!isStaleEpoch(epoch)) set({ pending: before });
      useSyncStore.getState().noteError('거절 처리에 실패했어요. 다시 시도해 주세요.');
    });
  },

  hydrateIfStale: (maxAgeMs) => {
    const { fetchedAt } = get();
    if (fetchedAt === 0 || Date.now() - fetchedAt > maxAgeMs) return get().hydrate();
    return Promise.resolve();
  },

  // 구독은 레이아웃 한 곳(이름 = __DEV__ 중복 계측).
  subscribe: () => subscribeDebounced(subscribeStaff, () => get().hydrate(), 300, 'staff'),
}));
