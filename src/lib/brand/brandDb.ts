// brandDb.ts — 본사(브랜드) 축 RPC 호출부. `db.ts` 와 분리한다(구현계획 §2: 계층 경계).
//
// 전부 정의자 RPC 다 — 클라이언트는 brand_* 테이블을 직접 읽지 않는다(정책 0개라 읽어도 0행).
// 본사 쪽(brand*) 과 점주 쪽(my*·respond*·set*·end*) 이 한 파일에 있는 이유: 같은 축의 양끝이고
// 매장 앱 신규 호출 수가 규칙(brand-boundary)에 고정돼 있다 — P4 기준 **9개**:
//   fetchMyBrandInvites · respondBrandInvite · setBrandVisibility · endBrandUnit · myBrandView
//   · hideBrandCopy · applyBrandPending · myBrandMirror (+ proposePayer/acceptPayer 는 양쪽 공용).
//   (P2 규칙은 6개였다. P3 에서 my_brand_invites 가, P4 에서 숨김·새버전·미러 뷰가 늘었다.)
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

/** 0212 my_brand() 확장 행 — 설정 화면(브랜드 정보·결제 표시)용. 세션은 brand_id·brand_name 만 쓴다(db.ts). */
export type MyBrandFullRow = {
  brand_id: string;
  brand_name: string;
  biz_no: string | null;
  default_payer: BrandPayer;
  price_per_store_krw: number | null;
  paid_until: string | null;
  workspace_unit_id: string | null;
};

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

/** 0217 brand_knowhow_list() 한 행 — 본사 노하우 표(§5-2: 제목·섹션·버전·배포 매장 수·수정일). */
export type BrandKnowhowRow = {
  id: string;
  title: string;
  section: string | null;
  category: string;
  subcategory: string;
  photos: number;
  deployed_units: number;
  /** 몇 번째 배포까지 갔나. 0 = 아직 안 내림. */
  version: number;
  updated_at: string;
};

/** 교차표 한 칸(0217 brand_deploy_matrix). 사본이 없는 칸은 **행이 없다** = 미배포. */
export type BrandDeployCell = {
  entry_id: string;
  unit_id: string;
  status: 'current' | 'modified' | 'pending' | 'hidden';
  brand_version: number | null;
  pending_version: number | null;
};

/** 배포 결과 한 칸(0217 brand_deploy_entries). */
export type BrandDeployResult = { unit_id: string; entry_id: string; action: 'created' | 'updated' | 'pending' };

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
export const fetchMyBrandFull = async (): Promise<DbResult<MyBrandFullRow | null>> => {
  const r = await rows<MyBrandFullRow>('my_brand');
  return { data: r.error ? null : (r.data?.[0] ?? null), error: r.error };
};
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
/** 대기 중인 초대 취소(0214) — 자기 브랜드의 pending 만. 점주 카드는 즉시 사라진다. */
export const revokeInvite = (inviteId: string) => call('brand_revoke_invite', { p_invite_id: inviteId });
/** 담당자 초대 수락(0210) — 가입은 기존 흐름 그대로, 뒤에 이것 하나만 더 부른다(`/hq/join`). */
export const acceptBrandMemberInvite = (token: string) => call('accept_brand_member_invite', { p_token: token });

// ── 본사 노하우 · 배포(P4) ────────────────────────────────────────────────
/**
 * 작업실을 활성 매장으로 세우고 그 id 를 돌려준다(0215). **편집기·표가 열릴 때 먼저 부른다.**
 *
 * 왜 필요한가: 노하우 저작은 매장 앱과 **같은 서버 경로**를 쓴다(정본 §4-B). 그 경로의 RLS 가
 * `unit_id = auth_unit_id()`(= profiles.active_unit_id) 라서, 활성 매장이 작업실이 아니면
 * `db.ts` 의 insert/update·사진 업로드가 0행·42501 로 조용히 실패한다.
 * 겸직 담당자가 '내 매장으로' 갔다 돌아오는 왕복도 이 호출 한 번으로 복구된다(멱등).
 */
export const enterBrandWorkspace = async (): Promise<DbResult<string | null>> => {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase.rpc('brand_enter_workspace');
  return { data: error ? null : ((data as string) ?? null), error: error as DbErr };
};
export const fetchBrandKnowhow = () => rows<BrandKnowhowRow>('brand_knowhow_list');
export const fetchBrandDeployMatrix = () => rows<BrandDeployCell>('brand_deploy_matrix');
/** 노하우 n건 → 매장 m곳. 서버가 한 트랜잭션에 사본·임베딩·알림까지 끝낸다(정본 §6-3). */
export const deployBrandEntries = (entryIds: string[], unitIds: string[]) =>
  rows<BrandDeployResult>('brand_deploy_entries', { p_entry_ids: entryIds, p_unit_ids: unitIds });

// ── 점주 쪽(매장 앱 신규 호출 6개) ──────────────────────────────────────────
export const fetchMyBrandInvites = () => rows<MyBrandInviteRow>('my_brand_invites');
export const respondBrandInvite = (inviteId: string, unitIds: string[], visibility: BrandVisibility, accept: boolean) =>
  call('respond_brand_invite', { p_invite_id: inviteId, p_unit_ids: unitIds, p_visibility: visibility, p_accept: accept });
export const setBrandVisibility = (unitId: string, visibility: BrandVisibility) =>
  call('set_brand_visibility', { p_unit_id: unitId, p_visibility: visibility });
export const endBrandUnit = (unitId: string, reason?: string) =>
  call('end_brand_unit', { p_unit_id: unitId, p_reason: reason ?? null });
export const myBrandView = () => rows<MyBrandViewRow>('my_brand_view');
/** 이 매장에서 숨기기 / 되살리기(0217). 사본만 — 매장 자체 노하우엔 이 길이 없다. */
export const hideBrandCopy = (entryId: string, hidden: boolean) =>
  call('hide_brand_copy', { p_entry_id: entryId, p_hidden: hidden });
/** 새 버전에 답한다(0217) — replace=true 새 버전으로 교체(내 수정 버림) / false 내 수정 유지. */
export const applyBrandPending = (entryId: string, replace: boolean) =>
  call('apply_brand_pending', { p_entry_id: entryId, p_replace: replace });
/**
 * 미러 뷰 "본사가 보는 화면 그대로"(0217) — `brand_overview` 와 **같은 본문**을 자기 매장으로만 지난다
 * (정본 §4-A 대칭 가시성). 그래서 타입도 본사 쪽 행과 같은 것을 쓴다.
 */
export const myBrandMirror = () => rows<BrandOverviewRow>('my_brand_mirror');

// ── 양쪽 공용 — payer 변경은 제안 → 상대 수락 ────────────────────────────────
export const proposePayer = (unitId: string, payer: BrandPayer) =>
  call('propose_payer', { p_unit_id: unitId, p_payer: payer });
export const acceptPayer = (unitId: string, accept: boolean) =>
  call('accept_payer', { p_unit_id: unitId, p_accept: accept });
