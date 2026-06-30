import { create } from 'zustand';
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { setUnitId } from '@/lib/db';

type Role = 'owner' | 'junior';
type Status = 'loading' | 'signed_in' | 'signed_out';

type SessionState = {
  status: Status;
  role: Role;
  userId: string;
  userName: string;
  unitId: string;
  storeName: string;
  industry: string; // 매장 업종(노하우 팩 매칭 키) — 온보딩 자동등록에 사용
  inviteCode: string; // 내 매장 초대코드(사장 화면에서 직원에게 공유)
  email: string;
  bio: string; // 한줄 소개

  // 부팅 시 1회: 기존 세션 복원 + 프로필 로드 + auth 변화 구독
  init: () => Promise<void>;
  signInWithPassword: (email: string, pw: string) => Promise<{ error: string | null; role: Role }>;
  signUp: (
    email: string,
    pw: string,
    meta: { name: string; role: Role; phone?: string; phone_last4?: string },
  ) => Promise<{ error: string | null; needsConfirm: boolean }>;
  // 전화번호 중복 사전검사(주키). 비로그인 호출 가능. 실패 시 false(막지 않음 — unique가 최종 방어).
  isPhoneTaken: (phone: string) => Promise<boolean>;
  createStore: (storeName: string, industry: string, bizNo?: string) => Promise<{ error: string | null; inviteCode: string | null }>;
  joinByInvite: (code: string) => Promise<{ error: string | null; storeName: string | null }>;
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
  industry: '카페·디저트',
  inviteCode: '482913',
  email: '',
  bio: '',
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

async function loadProfile(set: (p: Partial<SessionState>) => void, userId: string, email: string) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, role, unit_id, bio')
      .eq('id', userId)
      .maybeSingle();

    const unitId = profile?.unit_id ?? '';
    let storeName = '';
    let inviteCode = '';
    let industry = '';
    if (unitId) {
      const { data: unit } = await supabase
        .from('units')
        .select('store_name, invite_code, industry')
        .eq('id', unitId)
        .maybeSingle();
      storeName = unit?.store_name ?? '';
      inviteCode = unit?.invite_code ?? '';
      industry = unit?.industry ?? '';
    }
    setUnitId(unitId || null);
    set({
      status: 'signed_in',
      userId,
      email,
      inviteCode,
      userName: profile?.name ?? '',
      role: (profile?.role as Role) ?? 'junior',
      unitId,
      storeName,
      industry,
      bio: profile?.bio ?? '',
    });
  } catch (e) {
    // 네트워크 단절(fetch reject)로 프로필 조회가 던지면 앱이 'loading'에 영구히 멈추는 걸 막는다.
    // (supabase-js는 쿼리 에러를 throw하지 않고 {error}로 반환 → 그 경로는 위 try가 빈 unitId로 정상 처리.
    //  여기 catch는 오직 오프라인 등 throw 케이스.) 초기 state가 DEMO 시드(role/unitId='store_001')라
    // 부분 set으로 signed_in 처리하면 가짜 테넌트로 오인되므로, 반드시 깨끗한 signed_out으로 떨군다
    // (테넌트 격리가 최우선). 재접속 시 로그인/재시도로 정상 복구된다.
    console.warn('[session] loadProfile 실패, 로그아웃 처리:', (e as Error)?.message ?? e);
    setUnitId(null);
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', storeName: '', industry: '', inviteCode: '', bio: '' });
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
    if (user) await loadProfile(set, user.id, user.email ?? '');
    else set({ status: 'signed_out' });

    if (!_authSubscribed) {
      _authSubscribed = true;
      supabase.auth.onAuthStateChange((_evt, session) => {
        const u = session?.user;
        if (u) loadProfile(set, u.id, u.email ?? '');
        else set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
      });
    }
  },

  signInWithPassword: async (email, pw) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error || !data.user) return { error: error?.message ?? '로그인 실패', role: get().role };
    await loadProfile(set, data.user.id, data.user.email ?? ''); // 결정적: role 확정 후 반환
    return { error: null, role: get().role };
  },

  signUp: async (email, pw, meta) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: { data: meta }, // 트리거가 user_metadata로 프로필 생성
    });
    if (error) return { error: error.message, needsConfirm: false };
    // 이메일 확인이 켜져 있으면 세션이 없음 → 가게생성/합류 RPC를 못 부름.
    const needsConfirm = !data.session;
    if (data.session?.user) {
      await loadProfile(set, data.session.user.id, data.session.user.email ?? '');
    }
    return { error: null, needsConfirm };
  },

  isPhoneTaken: async (phone) => {
    if (!HAS_SUPABASE) return false;
    const { data, error } = await supabase.rpc('phone_in_use', { p_phone: phone });
    if (error) return false; // 사전검사 실패 시 막지 않음 — unique 제약이 최종 방어선
    return Boolean(data);
  },

  createStore: async (storeName, industry, bizNo) => {
    const { data, error } = await supabase.rpc('create_store', {
      p_store_name: storeName,
      p_industry: industry,
      p_biz_no: bizNo ?? null,
    });
    if (error) {
      const msg = /duplicate_biz_no/.test(error.message)
        ? '이미 등록된 사업자등록번호예요.'
        : error.message;
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
      const msg = /invalid_code/.test(error.message) ? '초대코드가 올바르지 않아요.' : error.message;
      return { error: msg, storeName: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null, storeName: row?.store_name ?? null };
  },

  sendMagicLink: async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error?.message ?? null };
  },

  // 회원가입 '인증' 버튼 — 입력한 이메일로 인증(매직링크/OTP) 메일을 보낸다.
  verifyEmail: async (email) => {
    if (!HAS_SUPABASE) return { status: 'demo' };
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      if (/rate|after|second/i.test(error.message)) return { status: 'rate' };
      return { status: 'error', message: error.message };
    }
    return { status: 'sent' };
  },

  updateProfile: async (patch) => {
    if (!HAS_SUPABASE) {
      const next: Partial<SessionState> = {};
      if (patch.name != null) next.userName = patch.name;
      if (patch.bio != null) next.bio = patch.bio;
      if (patch.email != null) next.email = patch.email;
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
        return { error: error.message };
      }
    }
    // 이메일 변경은 auth 레벨 — 실제로 바뀐 경우에만 호출(확인 메일이 발송될 수 있음).
    if (patch.email != null && patch.email !== get().email) {
      const { error } = await supabase.auth.updateUser({ email: patch.email });
      if (error) return { error: error.message };
    }
    const next: Partial<SessionState> = {};
    if (patch.name != null) next.userName = patch.name;
    if (patch.bio != null) next.bio = patch.bio;
    if (patch.email != null) next.email = patch.email;
    set(next);
    return { error: null };
  },

  changePassword: async (newPw) => {
    if (!HAS_SUPABASE) return { error: null }; // 데모: 실제 변경 없음
    const { error } = await supabase.auth.updateUser({ password: newPw });
    return { error: error?.message ?? null };
  },

  // 회원탈퇴 — 앱스토어/개인정보보호법 필수. 서버에서 auth user + 연관 데이터(cascade) 파기.
  // 0005 마이그레이션의 delete_my_account() RPC가 호출자(auth.uid()) 기준으로만 동작한다.
  deleteAccount: async () => {
    if (!HAS_SUPABASE) {
      // 데모 모드: 실제 삭제 대상 없음 → 세션만 종료.
      set({ status: 'signed_out', unitId: '', userId: '', userName: '', industry: '' });
      return { error: null };
    }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { error: error.message };
    // 계정은 이미 서버에서 파기됨 → signOut이 실패(네트워크 등)해도 로컬 세션은 반드시 종료.
    // (가드 안 하면 예외가 호출부로 튀어 busy가 영구 정지되고, '탈퇴됐는데 로그인 상태'가 됨)
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[session] signOut after delete failed:', e);
    }
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', industry: '' });
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
    if (error) return { error: error.message };
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
    if (info.remaining <= 0) return { error: '가게 이름은 14일 이내 2회까지만 변경할 수 있어요.', remaining: 0 };

    const unitId = get().unitId;
    if (HAS_SUPABASE) {
      if (!unitId) return { error: '매장 정보가 없어요.', remaining: info.remaining };
      const { error } = await supabase.from('units').update({ store_name: trimmed }).eq('id', unitId);
      if (error) return { error: error.message, remaining: info.remaining };
    }
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
      if (error) return { error: error.message };
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
    set({ status: 'signed_out', unitId: '', userId: '', userName: '', industry: '' });
  },

  switchTo: (role) => {
    // 데모 신원으로 완전 복귀 — 데모 매장(store_001)까지 되돌린다.
    setUnitId(DEMO.unitId);
    set(
      role === 'owner'
        ? { role: 'owner', userId: 'u_owner_001', userName: '김영자', unitId: DEMO.unitId, storeName: DEMO.storeName, industry: DEMO.industry, inviteCode: DEMO.inviteCode, email: '', bio: '' }
        : { role: 'junior', userId: 'u_staff_001', userName: '박지원', unitId: DEMO.unitId, storeName: DEMO.storeName, industry: DEMO.industry, inviteCode: DEMO.inviteCode, email: '', bio: '' }
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
      industry: industry ?? '',
      inviteCode: role === 'owner' ? inviteCode : '',
      email: '',
      bio: '',
    });
  },
}));
