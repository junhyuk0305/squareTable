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
  inviteCode: string; // 내 매장 초대코드(사장 화면에서 직원에게 공유)
  email: string;

  // 부팅 시 1회: 기존 세션 복원 + 프로필 로드 + auth 변화 구독
  init: () => Promise<void>;
  signInWithPassword: (email: string, pw: string) => Promise<{ error: string | null; role: Role }>;
  signUp: (
    email: string,
    pw: string,
    meta: { name: string; role: Role; phone_last4?: string },
  ) => Promise<{ error: string | null; needsConfirm: boolean }>;
  createStore: (storeName: string, bizNo?: string) => Promise<{ error: string | null; inviteCode: string | null }>;
  joinByInvite: (code: string) => Promise<{ error: string | null; storeName: string | null }>;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  updateProfile: (patch: { name?: string; phone_last4?: string }) => Promise<{ error: string | null }>;
  changePassword: (newPw: string) => Promise<{ error: string | null }>;
  deleteAccount: () => Promise<{ error: string | null }>;
  leaveStore: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  // 개발/단일기기 역할 토글 (Supabase 없을 때의 데모 폴백)
  switchTo: (role: Role) => void;
  // mock 모드에서 "새 계정/새 사업장"으로 입장 (데모 데이터 없이 빈 매장에서 시작)
  enterMockStore: (name: string, role: Role, storeName: string) => void;
};

// Supabase 미설정(로컬 데모) 기본 신원 — 기존 동작 그대로 유지.
const DEMO = {
  status: 'signed_in' as Status,
  role: 'junior' as Role,
  userId: 'u_staff_001',
  userName: '박지원',
  unitId: 'store_001',
  storeName: '스퀘어 카페 신촌점',
  inviteCode: '482913',
  email: '',
};

async function loadProfile(set: (p: Partial<SessionState>) => void, userId: string, email: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, role, unit_id')
    .eq('id', userId)
    .maybeSingle();

  const unitId = profile?.unit_id ?? '';
  let storeName = '';
  let inviteCode = '';
  if (unitId) {
    const { data: unit } = await supabase
      .from('units')
      .select('store_name, invite_code')
      .eq('id', unitId)
      .maybeSingle();
    storeName = unit?.store_name ?? '';
    inviteCode = unit?.invite_code ?? '';
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
  });
}

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

    supabase.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user;
      if (u) loadProfile(set, u.id, u.email ?? '');
      else set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
    });
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

  createStore: async (storeName, bizNo) => {
    const { data, error } = await supabase.rpc('create_store', {
      p_store_name: storeName,
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

  updateProfile: async (patch) => {
    if (!HAS_SUPABASE) {
      if (patch.name) set({ userName: patch.name });
      return { error: null };
    }
    const uid = get().userId;
    if (!uid) return { error: '로그인이 필요해요.' };
    const fields: Record<string, string> = {};
    if (patch.name != null) fields.name = patch.name;
    if (patch.phone_last4 != null) fields.phone_last4 = patch.phone_last4;
    const { error } = await supabase.from('profiles').update(fields).eq('id', uid);
    if (error) return { error: error.message };
    if (patch.name != null) set({ userName: patch.name });
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
      set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
      return { error: null };
    }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { error: error.message };
    await supabase.auth.signOut();
    set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
    return { error: null };
  },

  // 매장 나가기 — 알바가 현재 매장 소속을 해제(로그아웃과 구분). unit_id만 null로.
  leaveStore: async () => {
    if (!HAS_SUPABASE) {
      set({ unitId: '', storeName: '' });
      setUnitId(null);
      return { error: null };
    }
    const { error } = await supabase.rpc('leave_store');
    if (error) return { error: error.message };
    const uid = get().userId;
    if (uid) await loadProfile(set, uid, get().email);
    return { error: null };
  },

  signOut: async () => {
    if (HAS_SUPABASE) await supabase.auth.signOut();
    set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
  },

  switchTo: (role) => {
    // 데모 신원으로 완전 복귀 — 데모 매장(store_001)까지 되돌린다.
    setUnitId(DEMO.unitId);
    set(
      role === 'owner'
        ? { role: 'owner', userId: 'u_owner_001', userName: '김영자', unitId: DEMO.unitId, storeName: DEMO.storeName, inviteCode: DEMO.inviteCode, email: '' }
        : { role: 'junior', userId: 'u_staff_001', userName: '박지원', unitId: DEMO.unitId, storeName: DEMO.storeName, inviteCode: DEMO.inviteCode, email: '' }
    );
  },

  enterMockStore: (name, role, storeName) => {
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
      inviteCode: role === 'owner' ? inviteCode : '',
      email: '',
    });
  },
}));
