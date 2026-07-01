import { create } from 'zustand';
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { setUnitId } from '@/lib/db';
import { friendlyError } from '@/lib/utils/userError';
import type { SubStatusRaw } from '@/lib/utils/subscription';

type Role = 'owner' | 'junior';
type Status = 'loading' | 'signed_in' | 'signed_out';

type SessionState = {
  status: Status;
  role: Role;
  userId: string;
  userName: string;
  unitId: string;
  storeName: string;
  // 합류 승인 대기(남용 #2) — 코드는 입력했으나 사장 승인 전. unitId는 아직 비어 데이터가 격리된다.
  pendingUnitId: string; // 신청한 매장 id(승인 전). 있으면 '승인 대기' 상태.
  pendingStoreName: string; // 신청한 매장 이름(대기 화면 표시용 — join 응답에서 채움, 재로드 시 유실 가능).
  industry: string; // 매장 업종(노하우 팩 매칭 키) — 온보딩 자동등록에 사용
  // 매장 단위 구독상태(유료 게이팅). 원시값만 저장하고 화면은 deriveSubscription 으로 '지금' 기준 계산.
  subStatus: SubStatusRaw; // '' | 'trialing' | 'active' | 'expired'
  trialEndsAt: string; // ISO — 무료체험 만료
  paidUntil: string; // ISO — 유료 활성 만료(빈값=무기한)
  inviteCode: string; // 내 매장 초대코드(사장 화면에서 직원에게 공유)
  email: string;
  bio: string; // 한줄 소개
  phone: string; // 전화번호(전체) — 프로필 편집에서 표시·수정(뒷4자리만 아님)

  // 부팅 시 1회: 기존 세션 복원 + 프로필 로드 + auth 변화 구독
  init: () => Promise<void>;
  signInWithPassword: (email: string, pw: string) => Promise<{ error: string | null; role: Role }>;
  signUp: (
    email: string,
    pw: string,
    // store_name/industry/biz_no 는 사장 가입 시 user_metadata 에 실어둔다 — 이메일 인증으로
    // 세션 확보가 지연돼 가입 시점에 create_store 를 못 불러도, 인증 후 첫 로그인에서 자동 복원하기 위함.
    meta: { name: string; role: Role; phone?: string; phone_last4?: string; store_name?: string; industry?: string; biz_no?: string },
    // emailTaken: 이미 가입된 이메일이면 true — 화면이 "로그인 유도" 안내로 분기(원문 파싱 대신 플래그로).
  ) => Promise<{ error: string | null; needsConfirm: boolean; emailTaken?: boolean }>;
  // 전화번호 중복 사전검사(주키). 비로그인 호출 가능.
  //   'taken'=이미 사용 / 'free'=사용 가능 / 'unknown'=검사 실패(네트워크/권한).
  //   ⚠️ 'unknown'을 'free'로 뭉뚱그리면 사전검사가 뚫려 트리거로 떨어진다 → 호출부가 'unknown'을 차단해야 함.
  isPhoneTaken: (phone: string) => Promise<'taken' | 'free' | 'unknown'>;
  createStore: (storeName: string, industry: string, bizNo?: string) => Promise<{ error: string | null; inviteCode: string | null }>;
  // 합류는 이제 '신청'(pending) — 성공 시 pending=true. 사장 승인 후에야 unitId가 붙는다(남용 #2).
  joinByInvite: (code: string) => Promise<{ error: string | null; storeName: string | null; pending?: boolean }>;
  // 승인 대기 중 본인 신청 철회. 다른 매장에 다시 신청 가능.
  cancelJoinRequest: () => Promise<{ error: string | null }>;
  // 현재 로그인 사용자의 소속을 서버에서 재확인(승인 반영·강제 소속해제 감지). 대기화면 폴링/직원홈 가드에 사용.
  refreshMembership: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  // 이메일 인증 메일 발송(회원가입 화면의 '인증' 버튼). 데모는 발송 생략.
  verifyEmail: (email: string) => Promise<{ status: 'demo' | 'sent' | 'rate' | 'error'; message?: string }>;
  updateProfile: (patch: { name?: string; phone?: string; phone_last4?: string; bio?: string; email?: string }) => Promise<{ error: string | null }>;
  changePassword: (newPw: string) => Promise<{ error: string | null }>;
  deleteAccount: () => Promise<{ error: string | null }>;
  leaveStore: () => Promise<{ error: string | null }>;
  // 가게 이름 변경(사장 전용) — 14일 이내 2회 제한. 변경 이력은 기기 로컬에 보관(파일럿).
  renameStore: (name: string) => Promise<{ error: string | null; remaining: number }>;
  storeRenameInfo: () => { remaining: number; nextAvailableAt: number | null };
  // 업종 변경(사장 전용) — 노하우팩 매칭 키. 가게 이름과 같은 unit 속성.
  updateIndustry: (industry: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  // 개발/단일기기 역할 토글 (Supabase 없을 때의 데모 폴백)
  switchTo: (role: Role) => void;
  // mock 모드에서 "새 계정/새 사업장"으로 입장 (데모 데이터 없이 빈 매장에서 시작)
  enterMockStore: (name: string, role: Role, storeName: string, industry?: string) => void;
};

// Supabase 미설정(로컬 데모) 기본 신원 — 기존 동작 그대로 유지.
const DEMO = {
  status: 'signed_in' as Status,
  role: 'junior' as Role,
  userId: 'u_staff_001',
  userName: '박지원',
  unitId: 'store_001',
  storeName: '착착 카페 신촌점',
  pendingUnitId: '',
  pendingStoreName: '',
  industry: '카페·디저트',
  subStatus: 'active' as SubStatusRaw, // 데모는 항상 사용 가능(무기한 active)
  trialEndsAt: '',
  paidUntil: '',
  inviteCode: '482913',
  email: '',
  bio: '',
  phone: '',
};

// 가게 이름 변경 제한 — 14일 이내 2회. 이력(타임스탬프)은 기기 로컬에 unit별로 보관.
const RENAME_LIMIT = 2;
const RENAME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const renameStorage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
const renameKey = (unitId: string) => `sqt.storeRename.${unitId}`;
function recentRenameTimes(unitId: string): number[] {
  try {
    const raw = renameStorage?.getItem(renameKey(unitId));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - RENAME_WINDOW_MS;
    return (Array.isArray(arr) ? arr : []).filter((n): n is number => typeof n === 'number' && n >= cutoff);
  } catch {
    return [];
  }
}
function pushRenameTime(unitId: string) {
  try {
    renameStorage?.setItem(renameKey(unitId), JSON.stringify([...recentRenameTimes(unitId), Date.now()]));
  } catch {
    /* noop */
  }
}

// 사장 가입 시 user_metadata 에 실어둔 매장 생성 의도. 이메일 인증 후 첫 로드에서 매장 자동 복원에 사용.
type PendingOwnerMeta = { role?: string; store_name?: string; industry?: string; biz_no?: string };
function pendingOwnerMeta(user: { user_metadata?: Record<string, unknown> } | null | undefined): PendingOwnerMeta | undefined {
  const m = user?.user_metadata;
  if (!m) return undefined;
  return {
    role: typeof m.role === 'string' ? m.role : undefined,
    store_name: typeof m.store_name === 'string' ? m.store_name : undefined,
    industry: typeof m.industry === 'string' ? m.industry : undefined,
    biz_no: typeof m.biz_no === 'string' ? m.biz_no : undefined,
  };
}

// 동시 호출(init + onAuthStateChange 가 거의 동시에 발화) 시 매장이 2개 생성되는 레이스를 막는 가드.
let _resumingOwnerStore = false;

async function loadProfile(
  set: (p: Partial<SessionState>) => void,
  userId: string,
  email: string,
  meta?: PendingOwnerMeta,
) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, role, unit_id, pending_unit_id, bio, phone, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    // 소프트삭제(탈퇴) 계정은 재로그인 차단(남용 #29) — 유예 기간 동안 데이터는 서버에 남아있되
    // 사용자는 로그인 불가. 세션 토큰도 정리한다(fire-and-forget: signOut→onAuthStateChange는 재귀 안 함).
    if (profile?.deleted_at) {
      setUnitId(null);
      set({ status: 'signed_out', unitId: '', userId: '', userName: '', storeName: '', pendingUnitId: '', pendingStoreName: '', industry: '', inviteCode: '', bio: '', phone: '' });
      void supabase.auth.signOut().catch(() => {});
      return;
    }

    let unitId = profile?.unit_id ?? '';
    let role: Role = (profile?.role as Role) ?? 'junior';

    // 이메일 인증 경로 복원: 세션 확보 전이라 가입 시점에 create_store 를 못 부른 사장 →
    // unit_id 없음 + metadata 가 사장 가게 생성 의도를 담고 있으면, 인증 후 첫 로드에서 자동 생성.
    // (create_store 는 auth.uid() 기준 '자기 매장' 생성이라 테넌트 주입 위험 없음 — 0010 하드닝과 무관.)
    if (!unitId && !_resumingOwnerStore && meta?.role === 'owner' && (meta.store_name ?? '').trim()) {
      _resumingOwnerStore = true;
      try {
        const { data: created, error: createErr } = await supabase.rpc('create_store', {
          p_store_name: meta.store_name,
          p_industry: meta.industry ?? null,
          p_biz_no: meta.biz_no ?? null,
        });
        if (!createErr) {
          const row = Array.isArray(created) ? created[0] : created;
          unitId = row?.unit_id ?? unitId;
          role = 'owner';
        } else {
          // 실패(중복 사업자번호 등)는 치명적이지 않다 — unit_id 없는 채로 진행하면
          // owner/_layout 가드가 '가게 만들기' 화면으로 유도해 수동 복구된다.
          console.warn('[session] 매장 자동 복원 실패:', createErr.message);
        }
      } finally {
        _resumingOwnerStore = false;
      }
    }

    let storeName = '';
    let inviteCode = '';
    let industry = '';
    let subStatus: SubStatusRaw = '';
    let trialEndsAt = '';
    let paidUntil = '';
    if (unitId) {
      const { data: unit } = await supabase
        .from('units')
        .select('store_name, invite_code, industry')
        .eq('id', unitId)
        .maybeSingle();
      storeName = unit?.store_name ?? '';
      inviteCode = unit?.invite_code ?? '';
      industry = unit?.industry ?? '';

      // 구독상태(별도 테이블, 읽기 전용). 없으면 빈값 → deriveSubscription 이 fail-open('none')으로 처리.
      const { data: sub } = await supabase
        .from('unit_subscriptions')
        .select('status, trial_ends_at, paid_until')
        .eq('unit_id', unitId)
        .maybeSingle();
      subStatus = (sub?.status as SubStatusRaw) ?? '';
      trialEndsAt = sub?.trial_ends_at ?? '';
      paidUntil = sub?.paid_until ?? '';
    }
    setUnitId(unitId || null);
    set({
      status: 'signed_in',
      userId,
      email,
      inviteCode,
      userName: profile?.name ?? '',
      role,
      unitId,
      storeName,
      // 승인 대기 상태 반영(남용 #2). 승인돼 unitId가 붙으면 pending은 비운다(pendingStoreName도 정리).
      pendingUnitId: unitId ? '' : (profile?.pending_unit_id ?? ''),
      ...(unitId ? { pendingStoreName: '' } : {}),
      industry,
      subStatus,
      trialEndsAt,
      paidUntil,
      bio: profile?.bio ?? '',
      phone: profile?.phone ?? '',
    });
  } catch (e) {
    // 네트워크 단절(fetch reject)로 프로필 조회가 던지면 앱이 'loading'에 영구히 멈추는 걸 막는다.
    // (supabase-js는 쿼리 에러를 throw하지 않고 {error}로 반환 → 그 경로는 위 try가 빈 unitId로 정상 처리.
    //  여기 catch는 오직 오프라인 등 throw 케이스.) 초기 state가 DEMO 시드(role/unitId='store_001')라
    // 부분 set으로 signed_in 처리하면 가짜 테넌트로 오인되므로, 반드시 깨끗한 signed_out으로 떨군다
    // (테넌트 격리가 최우선). 재접속 시 로그인/재시도로 정상 복구된다.
    console.warn('[session] loadProfile 실패, 로그아웃 처리:', (e as Error)?.message ?? e);
    setUnitId(null);
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', storeName: '', pendingUnitId: '', pendingStoreName: '', industry: '', inviteCode: '', bio: '' });
  }
}

// onAuthStateChange는 앱 생애 1회만 등록한다. init()이 재마운트/핫리로드로 여러 번 불려도
// 리스너가 중복 등록돼 매 인증 이벤트마다 loadProfile이 N번 도는 걸 막는다.
let _authSubscribed = false;

export const useSessionStore = create<SessionState>((set, get) => ({
  ...(HAS_SUPABASE ? { ...DEMO, status: 'loading' } : DEMO),

  init: async () => {
    if (!HAS_SUPABASE) {
      setUnitId(DEMO.unitId);
      set({ ...DEMO });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) await loadProfile(set, user.id, user.email ?? '', pendingOwnerMeta(user));
    else set({ status: 'signed_out' });

    if (!_authSubscribed) {
      _authSubscribed = true;
      supabase.auth.onAuthStateChange((_evt, session) => {
        const u = session?.user;
        if (u) loadProfile(set, u.id, u.email ?? '', pendingOwnerMeta(u));
        else set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
      });
    }
  },

  signInWithPassword: async (email, pw) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error || !data.user)
      return {
        error: friendlyError(error?.message, '이메일 또는 비밀번호를 다시 확인해 주세요.'),
        role: get().role,
      };
    // 이메일 인증으로 가입 시 가게 생성이 지연된 사장은 여기서 metadata 기반으로 매장이 자동 복원된다.
    await loadProfile(set, data.user.id, data.user.email ?? '', pendingOwnerMeta(data.user)); // 결정적: role 확정 후 반환
    return { error: null, role: get().role };
  },

  signUp: async (email, pw, meta) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: { data: meta }, // 트리거가 user_metadata로 프로필 생성
    });
    if (error) {
      // 중복 이메일은 원문(already/registered/exists)으로만 식별 가능 → 데이터 계층에서 플래그로 변환.
      if (/already|registered|exists/i.test(error.message)) {
        return { error: null, needsConfirm: false, emailTaken: true };
      }
      return {
        error: friendlyError(error.message, '가입 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
        needsConfirm: false,
      };
    }
    // 이메일 열거 방지(enumeration protection)가 켜진 프로젝트는 이미 가입된 이메일도 error 없이
    // "가짜 성공"으로 돌려준다 — 이때 user.identities가 빈 배열인 게 유일한 신호다.
    // 문자열 매칭(already/registered/exists)만 의존하면 이 환경에서 emailTaken을 놓쳐
    // '인증 메일 보냈어요'로 안내돼 사용자가 영영 갇힌다 → identities 신호로 보강.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { error: null, needsConfirm: false, emailTaken: true };
    }
    // 이메일 확인이 켜져 있으면 세션이 없음 → 가게생성/합류 RPC를 못 부름.
    const needsConfirm = !data.session;
    if (data.session?.user) {
      // PKCE 플로우 함정: signUp 응답엔 session이 담겨 오지만 클라이언트의 '활성 세션'으로
      // attach 되지 않는다(원래 이메일 링크 코드교환 시점에 세션 생성). autoconfirm(이메일 인증 OFF)이라
      // 교환할 링크가 없어, 명시적으로 setSession 하지 않으면 직후 create_store/join_by_invite RPC가
      // JWT 없이 나가 auth.uid()=null → not_authenticated 로 막힌다. → 여기서 세션을 강제 활성화.
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      await loadProfile(set, data.session.user.id, data.session.user.email ?? '');
    }
    return { error: null, needsConfirm };
  },

  isPhoneTaken: async (phone) => {
    if (!HAS_SUPABASE) return 'free';
    const { data, error } = await supabase.rpc('phone_in_use', { p_phone: phone });
    if (error) return 'unknown'; // 검사 실패 — 우회 금지(호출부가 차단). unique 제약이 최종 방어선
    return data ? 'taken' : 'free';
  },

  createStore: async (storeName, industry, bizNo) => {
    const { data, error } = await supabase.rpc('create_store', {
      p_store_name: storeName,
      p_industry: industry,
      p_biz_no: bizNo ?? null,
    });
    if (error) {
      // 이미 매장이 있음(이전 시도로 생성됐거나 중복 제출) → 데드엔드 대신 기존 매장으로 진입.
      // (가입 직후 createStore가 한 번 성공했는데 네트워크 등으로 재시도되면 여기로 떨어진다.)
      if (/already_in_store/.test(error.message)) {
        const uid0 = get().userId;
        if (uid0) await loadProfile(set, uid0, get().email);
        return { error: null, inviteCode: get().inviteCode || null };
      }
      const msg = /duplicate_biz_no/.test(error.message)
        ? '이미 등록된 사업자등록번호예요.'
        : friendlyError(error.message, '가게를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
      return { error: msg, inviteCode: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    // 프로필 unit_id가 바뀌었으니 세션 상태 갱신
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null, inviteCode: row?.invite_code ?? null };
  },

  joinByInvite: async (code) => {
    const { data, error } = await supabase.rpc('join_by_invite', { p_code: code });
    if (error) {
      // 이미 어느 매장에 소속됨(중복 제출/이전 합류 성공) → 데드엔드 대신 그대로 진입.
      if (/already_in_store/.test(error.message)) {
        const uid0 = get().userId;
        if (uid0) await loadProfile(set, uid0, get().email);
        return { error: null, storeName: get().storeName || null };
      }
      // 이미 신청해 승인 대기 중(0032) → 대기 상태로 안내.
      if (/already_pending/.test(error.message)) {
        const uid0 = get().userId;
        if (uid0) await loadProfile(set, uid0, get().email);
        return { error: null, storeName: get().pendingStoreName || null, pending: true };
      }
      const msg = /invalid_code/.test(error.message)
        ? '초대코드가 올바르지 않아요.'
        : /too_many_attempts/.test(error.message)
        ? '시도가 많아 잠시 잠겼어요. 10분 후 다시 시도해 주세요.'
        : friendlyError(error.message, '매장에 합류하지 못했어요. 코드를 확인하고 다시 시도해 주세요.');
      return { error: msg, storeName: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    // 0행 반환 = invalid_code 신호(0031: 감사기록 보존을 위해 raise 대신 빈 반환).
    if (!row?.unit_id) {
      return { error: '초대코드가 올바르지 않아요.', storeName: null };
    }
    // 0032: 즉시 합류가 아니라 '승인 대기' 신청. row.unit_id=신청 대상, unit_id는 아직 안 붙는다.
    // 대기 화면에 보여줄 매장 이름을 세션에 심고, 프로필 재로드로 pendingUnitId를 반영한다.
    set({ pendingStoreName: row?.store_name ?? '' });
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null, storeName: row?.store_name ?? null, pending: true };
  },

  cancelJoinRequest: async () => {
    if (!HAS_SUPABASE) {
      set({ pendingUnitId: '', pendingStoreName: '' });
      return { error: null };
    }
    const { error } = await supabase.rpc('cancel_join_request');
    if (error) return { error: friendlyError(error.message, '신청을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.') };
    set({ pendingUnitId: '', pendingStoreName: '' });
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null };
  },

  refreshMembership: async () => {
    if (!HAS_SUPABASE) return;
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
  },

  sendMagicLink: async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error ? friendlyError(error.message, '인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.') : null };
  },

  // 회원가입 '인증' 버튼 — 입력한 이메일로 인증(매직링크/OTP) 메일을 보낸다.
  verifyEmail: async (email) => {
    if (!HAS_SUPABASE) return { status: 'demo' };
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      if (/rate|after|second/i.test(error.message)) return { status: 'rate' };
      return { status: 'error', message: friendlyError(error.message, '인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.') };
    }
    return { status: 'sent' };
  },

  updateProfile: async (patch) => {
    if (!HAS_SUPABASE) {
      const next: Partial<SessionState> = {};
      if (patch.name != null) next.userName = patch.name;
      if (patch.bio != null) next.bio = patch.bio;
      if (patch.email != null) next.email = patch.email;
      if (patch.phone != null) next.phone = patch.phone;
      set(next);
      return { error: null };
    }
    const uid = get().userId;
    if (!uid) return { error: '로그인이 필요해요.' };
    const fields: Record<string, string> = {};
    if (patch.name != null) fields.name = patch.name;
    if (patch.phone != null) {
      // 주키(전화번호) 갱신 — 전체 phone 저장(생성컬럼 phone_norm이 unique 강제) + 표시용 last4 파생.
      fields.phone = patch.phone;
      fields.phone_last4 = patch.phone.slice(-4);
    } else if (patch.phone_last4 != null) {
      fields.phone_last4 = patch.phone_last4;
    }
    if (patch.bio != null) fields.bio = patch.bio;
    if (Object.keys(fields).length) {
      const { error } = await supabase.from('profiles').update(fields).eq('id', uid);
      if (error) {
        if (/duplicate|unique|phone_norm/i.test(error.message)) return { error: '이미 가입된 번호예요.' };
        return { error: friendlyError(error.message, '정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.') };
      }
    }
    // 이메일 변경은 auth 레벨 — 실제로 바뀐 경우에만 호출(확인 메일이 발송될 수 있음).
    if (patch.email != null && patch.email !== get().email) {
      const { error } = await supabase.auth.updateUser({ email: patch.email });
      if (error) return { error: friendlyError(error.message, '이메일을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.') };
    }
    const next: Partial<SessionState> = {};
    if (patch.name != null) next.userName = patch.name;
    if (patch.bio != null) next.bio = patch.bio;
    if (patch.email != null) next.email = patch.email;
    if (patch.phone != null) next.phone = patch.phone;
    set(next);
    return { error: null };
  },

  changePassword: async (newPw) => {
    if (!HAS_SUPABASE) return { error: null }; // 데모: 실제 변경 없음
    const { error } = await supabase.auth.updateUser({ password: newPw });
    return { error: error ? friendlyError(error.message, '비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.') : null };
  },

  // 회원탈퇴 — 앱스토어/개인정보보호법 필수. 0035부터 '소프트삭제'(deleted_at 표시 + 소속해제).
  // 즉시 cascade 파기 대신 30일 유예 후 purge_deleted_accounts가 실제 파기 → 홧김 탈퇴로 직원 기록까지
  // 순삭되는 비가역 손실 방지(남용 #29). 유예 동안 재로그인은 loadProfile의 deleted_at 가드가 차단.
  deleteAccount: async () => {
    if (!HAS_SUPABASE) {
      // 데모 모드: 실제 삭제 대상 없음 → 세션만 종료.
      set({ status: 'signed_out', unitId: '', userId: '', userName: '', pendingUnitId: '', pendingStoreName: '', industry: '' });
      return { error: null };
    }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { error: friendlyError(error.message, '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.') };
    // 계정은 이미 서버에서 파기됨 → signOut이 실패(네트워크 등)해도 로컬 세션은 반드시 종료.
    // (가드 안 하면 예외가 호출부로 튀어 busy가 영구 정지되고, '탈퇴됐는데 로그인 상태'가 됨)
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[session] signOut after delete failed:', e);
    }
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', pendingUnitId: '', pendingStoreName: '', industry: '' });
    return { error: null };
  },

  // 매장 나가기 — 알바가 현재 매장 소속을 해제(로그아웃과 구분). unit_id만 null로.
  leaveStore: async () => {
    if (!HAS_SUPABASE) {
      set({ unitId: '', storeName: '', industry: '' });
      setUnitId(null);
      return { error: null };
    }
    const { error } = await supabase.rpc('leave_store');
    if (error) return { error: friendlyError(error.message, '매장에서 나가지 못했어요. 잠시 후 다시 시도해 주세요.') };
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null };
  },

  storeRenameInfo: () => {
    const unitId = get().unitId;
    if (!unitId) return { remaining: RENAME_LIMIT, nextAvailableAt: null };
    const times = recentRenameTimes(unitId);
    const remaining = Math.max(0, RENAME_LIMIT - times.length);
    const nextAvailableAt = remaining > 0 || times.length === 0 ? null : Math.min(...times) + RENAME_WINDOW_MS;
    return { remaining, nextAvailableAt };
  },

  renameStore: async (name) => {
    const trimmed = name.trim();
    if (get().role !== 'owner') return { error: '사장님만 변경할 수 있어요.', remaining: 0 };
    if (!trimmed) return { error: '가게 이름을 입력해주세요.', remaining: get().storeRenameInfo().remaining };
    if (trimmed === get().storeName) return { error: '기존과 같은 이름이에요.', remaining: get().storeRenameInfo().remaining };
    const info = get().storeRenameInfo();

    const unitId = get().unitId;
    if (HAS_SUPABASE) {
      if (!unitId) return { error: '매장 정보가 없어요.', remaining: info.remaining };
      // 제한은 서버가 강제(남용 #28) — localStorage 카운터는 표시용 힌트일 뿐, 진짜 게이트는 rename_store RPC.
      // (재설치/다른 기기/데브툴로 로컬 힌트를 지워도 서버가 14일 2회를 막는다.)
      const { data, error } = await supabase.rpc('rename_store', { p_name: trimmed });
      if (error) {
        const msg = /rename_limit/.test(error.message)
          ? '가게 이름은 14일 이내 2회까지만 변경할 수 있어요.'
          : /store_name_required/.test(error.message)
          ? '가게 이름을 입력해주세요.'
          : friendlyError(error.message, '가게 이름을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return { error: msg, remaining: /rename_limit/.test(error.message) ? 0 : info.remaining };
      }
      pushRenameTime(unitId); // 로컬 힌트 동기화
      set({ storeName: trimmed });
      // 서버가 반환한 남은 횟수를 신뢰(로컬 힌트보다 정확).
      const remaining = typeof data === 'number' ? data : get().storeRenameInfo().remaining;
      return { error: null, remaining };
    }
    // 데모(Supabase 없음): 기존 로컬 제한 유지.
    if (info.remaining <= 0) return { error: '가게 이름은 14일 이내 2회까지만 변경할 수 있어요.', remaining: 0 };
    if (unitId) pushRenameTime(unitId);
    set({ storeName: trimmed });
    return { error: null, remaining: get().storeRenameInfo().remaining };
  },

  updateIndustry: async (industry) => {
    const trimmed = industry.trim();
    if (get().role !== 'owner') return { error: '사장님만 변경할 수 있어요.' };
    if (!trimmed) return { error: '업종을 선택해주세요.' };
    if (trimmed === get().industry) return { error: null };

    const unitId = get().unitId;
    if (HAS_SUPABASE) {
      if (!unitId) return { error: '매장 정보가 없어요.' };
      const { error } = await supabase.from('units').update({ industry: trimmed }).eq('id', unitId);
      if (error) return { error: friendlyError(error.message, '업종을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.') };
    }
    set({ industry: trimmed });
    return { error: null };
  },

  signOut: async () => {
    // signOut 실패가 화면 핸들러로 튀지 않게 가드 — 어떤 경우든 로컬 세션은 종료한다.
    if (HAS_SUPABASE) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('[session] signOut failed:', e);
      }
    }
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', pendingUnitId: '', pendingStoreName: '', industry: '' });
  },

  switchTo: (role) => {
    // 데모 신원으로 완전 복귀 — 데모 매장(store_001)까지 되돌린다.
    setUnitId(DEMO.unitId);
    set(
      role === 'owner'
        ? { role: 'owner', userId: 'u_owner_001', userName: '김영자', unitId: DEMO.unitId, storeName: DEMO.storeName, pendingUnitId: '', pendingStoreName: '', industry: DEMO.industry, inviteCode: DEMO.inviteCode, email: '', bio: '', phone: '' }
        : { role: 'junior', userId: 'u_staff_001', userName: '박지원', unitId: DEMO.unitId, storeName: DEMO.storeName, pendingUnitId: '', pendingStoreName: '', industry: DEMO.industry, inviteCode: DEMO.inviteCode, email: '', bio: '', phone: '' }
    );
  },

  enterMockStore: (name, role, storeName, industry) => {
    // 데모와 구분되는 새 매장 id → 스토어들이 빈 상태로 시작(가짜 데이터 없음).
    const unitId = 'store_new';
    const inviteCode = String(Math.floor(100000 + (Date.now() % 900000)));
    setUnitId(unitId);
    set({
      status: 'signed_in',
      role,
      userId: role === 'owner' ? 'u_new_owner' : 'u_new_staff',
      userName: name || (role === 'owner' ? '사장님' : '직원'),
      unitId,
      storeName: storeName || (role === 'owner' ? '내 매장' : ''),
      pendingUnitId: '',
      pendingStoreName: '',
      industry: industry ?? '',
      inviteCode: role === 'owner' ? inviteCode : '',
      email: '',
      bio: '',
      phone: '',
    });
  },
}));
