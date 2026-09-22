// brandDb.ts — 본사(브랜드) 축 RPC 호출부. `db.ts` 와 분리한다(구현계획 §2: 계층 경계).
//
// 전부 정의자 RPC 다 — 클라이언트는 brand_* 테이블을 직접 읽지 않는다(정책 0개라 읽어도 0행).
// 본사 쪽(brand*) 과 점주 쪽(my*·respond*·set*·end*) 이 한 파일에 있는 이유: 같은 축의 양끝이고
// 매장 앱 신규 호출은 6개로 고정돼 있다(brand-boundary 규칙). 화면은 P3 에서 붙는다.
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import type { DbResult, DbErr } from '@/lib/db';

export type BrandPayer = 'brand' | 'store';
export type BrandVisibility = 'summary' | 'knowhow' | 'ops';

/** 0212 brand_overview() 한 행 — 수준 밖 컬럼은 서버가 null 로 준다. */
export type BrandOverviewRow = {
  unit_id: string;
  store_name: string;
  industry: string | null;
  payer: BrandPayer;
  visibility: BrandVisibility;
  visibility_requested: 'knowhow' | 'ops' | null;
  payer_proposed: BrandPayer | null;
  payer_proposed_by_brand: boolean;
  accepted_at: string;
  staff: number;
  knowhow_own: number;
  pending_q: number;
  ai_used: number;
  mastery: number | null;
  tasks_done_30d: number | null;
  quiz_courses: number | null;
};

export type BrandInviteRow = {
  id: string;
  kind: 'member' | 'store';
  token: string | null;
  phone: string | null;
  payer: BrandPayer | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  used_at: string | null;
  unit_id: string | null;
};

export type BrandMemberRow = { user_id: string; name: string; joined_at: string; is_me: boolean };

/** 점주에게 온 연결 요청(0210 my_brand_invites). */
export type MyBrandInviteRow = {
  invite_id: string;
  brand_id: string;
  brand_name: string;
  brand_biz_no: string | null;
  payer: BrandPayer;
  expires_at: string;
  created_at: string;
};

/** 점주 설정 > 본사 연결(0211 my_brand_view). */
export type MyBrandViewRow = {
  unit_id: string;
  brand_id: string;
  brand_name: string;
  brand_biz_no: string | null;
  payer: BrandPayer;
  visibility: BrandVisibility;
  visibility_requested: 'knowhow' | 'ops' | null;
  payer_proposed: BrandPayer | null;
  payer_proposed_by_me: boolean;
  accepted_at: string;
};

async function rows<T>(name: string, args?: Record<string, unknown>): Promise<DbResult<T[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc(name, args);
  return { data: error ? null : ((data as T[]) ?? []), error: error as DbErr };
}
async function call(name: string, args?: Record<string, unknown>): Promise<DbErr> {
  if (!HAS_SUPABASE) return null;
  const { error } = await supabase.rpc(name, args);
  return error as DbErr;
}

// ── 본사 쪽 ───────────────────────────────────────────────────────────────
export const fetchBrandOverview = () => rows<BrandOverviewRow>('brand_overview');
export const fetchBrandInvites = () => rows<BrandInviteRow>('brand_invites_list');
export const fetchBrandMembers = () => rows<BrandMemberRow>('brand_members_list');
export const inviteBrandMember = () => rows<{ token: string; expires_at: string }>('brand_invite_member');
export const inviteStore = (phone: string, payer?: BrandPayer) =>
  call('brand_invite_store', { p_phone: phone, p_payer: payer ?? null });
export const connectOwnUnit = (unitId: string, payer?: BrandPayer) =>
  call('brand_connect_own_unit', { p_unit_id: unitId, p_payer: payer ?? null });
export const requestVisibility = (unitId: string, visibility: 'knowhow' | 'ops') =>
  call('request_visibility', { p_unit_id: unitId, p_visibility: visibility });

// ── 점주 쪽(매장 앱 신규 호출 6개) ──────────────────────────────────────────
export const fetchMyBrandInvites = () => rows<MyBrandInviteRow>('my_brand_invites');
export const respondBrandInvite = (inviteId: string, unitIds: string[], visibility: BrandVisibility, accept: boolean) =>
  call('respond_brand_invite', { p_invite_id: inviteId, p_unit_ids: unitIds, p_visibility: visibility, p_accept: accept });
export const setBrandVisibility = (unitId: string, visibility: BrandVisibility) =>
  call('set_brand_visibility', { p_unit_id: unitId, p_visibility: visibility });
export const endBrandUnit = (unitId: string, reason?: string) =>
  call('end_brand_unit', { p_unit_id: unitId, p_reason: reason ?? null });
export const myBrandView = () => rows<MyBrandViewRow>('my_brand_view');

// ── 양쪽 공용 — payer 변경은 제안 → 상대 수락 ────────────────────────────────
export const proposePayer = (unitId: string, payer: BrandPayer) =>
  call('propose_payer', { p_unit_id: unitId, p_payer: payer });
export const acceptPayer = (unitId: string, accept: boolean) =>
  call('accept_payer', { p_unit_id: unitId, p_accept: accept });
