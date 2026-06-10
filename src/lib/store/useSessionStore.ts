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
  email: string;

  // 부팅 시 1회: 기존 세션 복원 + 프로필 로드 + auth 변화 구독
  init: () => Promise<void>;
  signInWithPassword: (email: string, pw: string) => Promise<{ error: string | null; role: Role }>;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  // 개발/단일기기 역할 토글 (Supabase 없을 때의 데모 폴백)
  switchTo: (role: Role) => void;
};

// Supabase 미설정(로컬 데모) 기본 신원 — 기존 동작 그대로 유지.
const DEMO = {
  status: 'signed_in' as Status,
  role: 'junior' as Role,
  userId: 'u_staff_001',
  userName: '박지원',
  unitId: 'store_001',
  storeName: '스퀘어 카페 신촌점',
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
  if (unitId) {
    const { data: unit } = await supabase
      .from('units')
      .select('store_name')
      .eq('id', unitId)
      .maybeSingle();
    storeName = unit?.store_name ?? '';
  }
  setUnitId(unitId || null);
  set({
    status: 'signed_in',
    userId,
    email,
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

  sendMagicLink: async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    if (HAS_SUPABASE) await supabase.auth.signOut();
    set({ status: 'signed_out', unitId: '', userId: '', userName: '' });
  },

  switchTo: (role) =>
    set(
      role === 'owner'
        ? { role: 'owner', userId: 'u_owner_001', userName: '김영자' }
        : { role: 'junior', userId: 'u_staff_001', userName: '박지원' }
    ),
}));
