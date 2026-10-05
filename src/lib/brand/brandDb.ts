// brandDb.ts — 본사(브랜드) 축 RPC 호출부. `db.ts` 와 분리한다(구현계획 §2: 계층 경계).
//
// 전부 정의자 RPC 다 — 클라이언트는 brand_* 테이블을 직접 읽지 않는다(정책 0개라 읽어도 0행).
// 본사 쪽(brand*) 과 점주 쪽(my*·respond*·set*·end*) 이 한 파일에 있는 이유: 같은 축의 양끝이고
// 매장 앱 신규 호출 수가 규칙(brand-boundary)에 고정돼 있다 — P5 기준 **11개**:
//   fetchMyBrandInvites · respondBrandInvite · setBrandVisibility · endBrandUnit · myBrandView
//   · hideBrandCopy · applyBrandPending · myBrandMirror · hideBrandCourse · applyBrandCoursePending
//   (+ proposePayer/acceptPayer 는 양쪽 공용). **P9-2 에서 ackBrandConsent 가 늘어 12개다.**
//   **0250 에서 myBrandHistory(끝난 연결 · Q29)가 늘어 13개다.**
//   (P2 규칙은 6개였다. P3 에서 my_brand_invites 가, P4 에서 숨김·새버전·미러 뷰가, P5 에서 퀴즈 사본의 숨김·새버전이 늘었다.)
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import type { DbResult, DbErr } from '@/lib/db';

export type BrandPayer = 'brand' | 'store';
export type BrandVisibility = 'summary' | 'knowhow' | 'ops';
/**
 * 0223 — 이 매장이 본사와 어떤 관계인가. `direct` 직영(본사 고용) · `franchise` 가맹(독립 사업자).
 * 기능 목록은 같고, 항목마다 **(켤 수 있는가 × 누가 정하는가)** 만 갈린다(정본 02 §1).
 * ⛔쓰기 경로는 클라이언트에 없다 — 우리(내부 콘솔 · service_role)만 바꾼다(정본 §12 R3).
 */
export type BrandRelation = 'direct' | 'franchise';

/** 0212 brand_overview() 한 행 — 수준 밖 컬럼은 서버가 null 로 준다. */
export type BrandOverviewRow = {
  unit_id: string;
  store_name: string;
  industry: string | null;
  /** 0223 — 직영/가맹. 표 배지·필터와 드로어 항목표가 쓴다. */
  relation: BrandRelation;
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
  /** 0223 자리표시 — P9-3 이 채운다(미이수 인원 수). 그때까지 언제나 null. */
  staff_behind: number | null;
  /** 0223 자리표시 — P9-3 이 채운다(오답이 몰린 노하우 건수). 그때까지 언제나 null. */
  weak_entries: number | null;
};

/** 0228 brand_overview_page 정렬 키 — 매장 표 머리글과 1:1. */
export type BrandOverviewSort = 'name' | 'relation' | 'staff' | 'pending_q' | 'mastery';

export type BrandOverviewQuery = {
  limit: number;
  offset: number;
  sort: BrandOverviewSort;
  desc: boolean;
  q?: string | null;
  relation?: BrandRelation | null;
  visibility?: BrandVisibility | null;
  /** 바깥 필터(내 브랜드 결과를 좁히기만 한다) — 상세 한 매장 · '매장 추가'의 내 매장 중 연결된 것. */
  units?: string[] | null;
};

/** 0228 한 행 = brand_overview 행 + 거른 뒤 전체 개수 + 거르기 전 연결 매장 수. */
export type BrandOverviewPageRow = BrandOverviewRow & { total_count: number; total_all: number };

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

/** 0220 brand_quiz_list() 한 행 — 본사 퀴즈 표(§5-2: 제목·문항 수·참조 노하우 수·배포 매장 수·수정일). */
export type BrandQuizRow = {
  id: string;
  name: string;
  /** 실제로 나갈 문항 수(active + 아는 형태 — quiz_item_counts 와 같은 기준). */
  items: number;
  entries: number;
  deployed_units: number;
  /** 몇 번째 배포까지 갔나. 0 = 아직 안 내림. */
  version: number;
  updated_at: string;
};

/** 퀴즈 교차표 한 칸(0220 brand_course_matrix). 노하우 칸과 같은 상태 어휘 — 원본 id 이름만 다르다. */
export type BrandCourseCell = {
  course_id: string;
  unit_id: string;
  status: BrandDeployCell['status'];
  brand_version: number | null;
  pending_version: number | null;
};

/** 퀴즈 배포 결과 한 매장(0220 brand_deploy_course). entries_added = 없어서 함께 내려간 노하우 수. */
export type BrandCourseDeployResult = { unit_id: string; action: 'created' | 'updated' | 'pending'; entries_added: number };

/** 점주 설정 > 본사 연결(0211 my_brand_view). */
export type MyBrandViewRow = {
  unit_id: string;
  brand_id: string;
  brand_name: string;
  brand_biz_no: string | null;
  /** 0223 — 직영이면 규칙을 본사가 정한다. 점주 화면이 잠금·이유를 그리는 재료. */
  relation: BrandRelation;
  payer: BrandPayer;
  visibility: BrandVisibility;
  /** 0224 — 공개 수준의 하한. 이 아래는 회색 + 자물쇠다(가맹은 언제나 'summary'). */
  visibility_floor: BrandVisibility;
  /** 0224 — false 면 [연결 해제] 버튼을 숨긴다(서버도 `owner_cannot_end` 로 거부). */
  owner_can_end: boolean;
  /** 0224 — true 면 받은 노하우·퀴즈를 숨길 수 없다. */
  content_required: boolean;
  /** 0224 — 가맹은 '동의'(수락/거절) · 직영은 '고지'(확인/문의하기). */
  consent_kind: 'consent' | 'notice';
  /** 0224 — true 면 관계가 바뀌어 동의·고지를 다시 받아야 한다(정본 §8). */
  consent_pending: boolean;
  visibility_requested: 'knowhow' | 'ops' | null;
  payer_proposed: BrandPayer | null;
  payer_proposed_by_me: boolean;
  accepted_at: string;
  /** 0221 — 본사 부담이 시작되는 날(payer=store 면 null). */
  payer_effective_from: string | null;
  /** 0221 — 본사 부담이 끝나는 날. 해제·본사→매장 전환 때 당월 말이 박힌다. */
  brand_paid_through: string | null;
};

/** 0250 my_brand_history 한 줄 — 내 매장의 끝난 본사 연결(180일 안 · 본사마다 마지막 한 줄). */
export type MyBrandHistoryRow = {
  unit_id: string;
  store_name: string;
  brand_name: string;
  ended_at: string;
  /** 누가 끊었나 — owner 점주 · brand 본사 · admin 운영팀. */
  ended_by: 'owner' | 'brand' | 'admin';
  /** 사유 키(END_REASONS · 'brand' · 'consent_declined'). 문구는 endReasonLabel. */
  end_reason: string | null;
};

/** 0250 brand_ended_units 한 줄 — 본사 "연결 끝난 매장". 사유·날짜뿐이고 운영 숫자는 없다. */
export type BrandEndedUnitRow = Omit<MyBrandHistoryRow, 'brand_name'>;

/** 0222 brand_billing_preview 한 줄 — 이번 달 청구 대상 매장. */
export type BrandBillingRow = {
  unit_id: string;
  store_name: string;
  price_krw: number;
  /** 본사 부담 시작일 */
  since: string;
};

/** 0222 brand_invoices_list 한 줄 — 설정 > 결제의 청구서 목록(표시만). */
export type BrandInvoiceRow = {
  id: string;
  period: string;
  unit_count: number;
  amount_krw: number;
  credit_krw: number;
  status: 'issued' | 'paid' | 'credited' | 'refunded';
  issued_at: string;
  paid_at: string | null;
};

/**
 * 0224 brand_unit_rules 한 줄 — 매장 드로어의 직영 전용 값 3개(+동의 상태).
 * ★`brand_overview` 를 넓히지 않는다 — RETURNS TABLE 이 바뀌면 그 위 함수 3개를 또 DROP 해야 한다
 *   (0221 이 `brand_payer_dates` 를 따로 낸 것과 같은 이유).
 */
export type BrandUnitRulesRow = {
  unit_id: string;
  visibility_floor: BrandVisibility;
  owner_can_end: boolean;
  content_required: boolean;
  consent_kind: 'consent' | 'notice';
  consent_pending: boolean;
};

/** 0221 brand_payer_dates 한 줄 — 매장 드로어의 "적용일 · 본사 부담 종료일". */
export type BrandPayerDateRow = {
  unit_id: string;
  payer_effective_from: string | null;
  brand_paid_through: string | null;
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
/** 0228 — 검색·필터·정렬·쪽을 서버에서. 클라가 한 쪽만 받아 정렬하면 전체 순위가 아니라 그 쪽 안 순위가 된다. */
export const fetchBrandOverviewPage = (q: BrandOverviewQuery) =>
  rows<BrandOverviewPageRow>('brand_overview_page', {
    p_limit: q.limit,
    p_offset: q.offset,
    p_sort: q.sort,
    p_desc: q.desc,
    p_q: q.q ?? null,
    p_relation: q.relation ?? null,
    p_visibility: q.visibility ?? null,
    p_units: q.units ?? null,
  });
/** 0250 — 연결이 끝난 매장과 사유(끝난 뒤 운영 데이터는 주지 않는다). */
export const fetchBrandEndedUnits = () => rows<BrandEndedUnitRow>('brand_ended_units');
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
export const deployBrandEntries = (entryIds: string[], unitIds: string[], required = false) =>
  rows<BrandDeployResult>('brand_deploy_entries', { p_entry_ids: entryIds, p_unit_ids: unitIds, p_required: required });

// ── 본사 퀴즈 · 배포(P5) ─────────────────────────────────────────────────
export const fetchBrandQuizzes = () => rows<BrandQuizRow>('brand_quiz_list');
export const fetchBrandCourseMatrix = () => rows<BrandCourseCell>('brand_course_matrix');
/**
 * 퀴즈 1건 → 매장 m곳(0220). 그 매장에 없는 참조 노하우는 서버가 **먼저** 내리고, 사본 퀴즈의 항목·문항은
 * 그 매장 사본 id 로 재매핑된다. ⛔발송(`quiz_assignments`)은 만들지 않는다 — 점주가 받는 사람을 고르면 매장 엔진이 보낸다.
 */
export const deployBrandCourse = (courseId: string, unitIds: string[], required = false) =>
  rows<BrandCourseDeployResult>('brand_deploy_course', { p_course_id: courseId, p_unit_ids: unitIds, p_required: required });

// ── 본사 결제 · 정산(P6) — 전부 **표시만**. 발행·승인은 내부 콘솔(service_role)이 한다 ──
/**
 * 이번 달(또는 지정 기간) 청구 대상 매장. ★내부 콘솔의 발행과 **같은 함수**(`brand_billing_preview`)를
 * 지난다 — 화면이 따로 세면 "화면엔 3곳, 청구서엔 2곳"이 된다(0222 주석).
 */
export const fetchBrandBilling = (period?: string) =>
  rows<BrandBillingRow>('brand_billing_preview_mine', { p_period: period ?? null });
export const fetchBrandInvoices = () => rows<BrandInvoiceRow>('brand_invoices_list');
export const fetchBrandPayerDates = () => rows<BrandPayerDateRow>('brand_payer_dates');

// ── 본사: 직영 전용 규칙(P9-2) — ⛔가맹에서는 서버가 거부한다(관계는 우리만 바꾼다) ──
export const fetchBrandUnitRules = () => rows<BrandUnitRulesRow>('brand_unit_rules');
/** 직영의 공개 수준 **하한**을 정한다(0224). 점장은 이 위로만 움직인다. 바꾸면 점장에게 고지 알림 1건. */
export const setVisibilityFloor = (unitId: string, floor: BrandVisibility) =>
  call('set_visibility_floor', { p_unit_id: unitId, p_floor: floor });
/**
 * 직영의 '필수 배포'를 켜고 끈다(0224). true 면 점주가 받은 노하우·퀴즈를 숨길 수 없다.
 * ★배포는 이 값을 **켜기만** 한다 — 끄는 것은 상태가 보이는 여기(매장 드로어)뿐이다.
 *   배포가 체크 값을 그대로 반영하면 체크를 깜빡한 재배포 한 번이 제약을 조용히 푼다.
 */
export const setContentRequired = (unitId: string, required: boolean) =>
  call('set_content_required', { p_unit_id: unitId, p_required: required });
/**
 * 직영의 '점주 해제권'을 켜고 끈다(0227). false 면 점주가 연결을 못 끊는다(서버가 `owner_cannot_end` 거부).
 * ★0224 가 컬럼·방어선·자물쇠 분기만 만들고 setter 를 빠뜨려 도달 불가였던 자리다(2026-09-26 실측).
 */
export const setOwnerCanEnd = (unitId: string, canEnd: boolean) =>
  call('set_owner_can_end', { p_unit_id: unitId, p_can_end: canEnd });

// ── 점주 쪽(매장 앱 신규 호출 6개) ──────────────────────────────────────────
export const fetchMyBrandInvites = () => rows<MyBrandInviteRow>('my_brand_invites');
export const respondBrandInvite = (inviteId: string, unitIds: string[], visibility: BrandVisibility, accept: boolean) =>
  call('respond_brand_invite', { p_invite_id: inviteId, p_unit_ids: unitIds, p_visibility: visibility, p_accept: accept });
export const setBrandVisibility = (unitId: string, visibility: BrandVisibility) =>
  call('set_brand_visibility', { p_unit_id: unitId, p_visibility: visibility });
export const endBrandUnit = (unitId: string, reason?: string) =>
  call('end_brand_unit', { p_unit_id: unitId, p_reason: reason ?? null });
export const myBrandView = () => rows<MyBrandViewRow>('my_brand_view');
/** 0250 — 내 매장의 끝난 본사 연결. 연결이 없을 때 brand-link 가 '끝난 연결' 카드로 그린다(Q29). */
export const myBrandHistory = () => rows<MyBrandHistoryRow>('my_brand_history');
/**
 * 관계가 바뀌어 다시 받는 동의·고지에 답한다(0224 · 정본 §7·§8).
 * 가맹(`consent_kind='consent'`) = 수락/거절(거절하면 연결이 끝난다) · 직영(`'notice'`) = 확인만.
 * ★매장 앱 신규 호출이 11 → **12** 로 늘어난 줄이다(brand-boundary.md 고정 목록을 같은 커밋에서 고쳤다).
 */
export const ackBrandConsent = (unitId: string, accept: boolean) =>
  call('ack_brand_consent', { p_unit_id: unitId, p_accept: accept });
/** 이 매장에서 숨기기 / 되살리기(0217). 사본만 — 매장 자체 노하우엔 이 길이 없다. */
export const hideBrandCopy = (entryId: string, hidden: boolean) =>
  call('hide_brand_copy', { p_entry_id: entryId, p_hidden: hidden });
/** 새 버전에 답한다(0217) — replace=true 새 버전으로 교체(내 수정 버림) / false 내 수정 유지. */
export const applyBrandPending = (entryId: string, replace: boolean) =>
  call('apply_brand_pending', { p_entry_id: entryId, p_replace: replace });
/** 퀴즈 사본 숨기기/되살리기(0220). 숨기면 아직 안 나간 발송은 취소된다(나간 것은 기록으로 남는다). */
export const hideBrandCourse = (courseId: string, hidden: boolean) =>
  call('hide_brand_course', { p_course_id: courseId, p_hidden: hidden });
/** 퀴즈 사본의 새 버전에 답한다(0220) — replace=true 원본(항목·문항 포함)으로 교체 / false 내 수정 유지. */
export const applyBrandCoursePending = (courseId: string, replace: boolean) =>
  call('apply_brand_course_pending', { p_course_id: courseId, p_replace: replace });
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
