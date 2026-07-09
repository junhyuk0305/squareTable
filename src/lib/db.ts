// lib/db.ts
// 데이터 접근 단일 계층. 스토어/화면은 여기만 호출하고 Supabase를 직접 모름.
// HAS_SUPABASE=false면 전부 no-op/빈배열 → 기존 로컬 시드 스토어로 자연 폴백(프론트 안 끊김).
//
// 행(row) ↔ TS 타입 매핑: 중첩 필드는 JSONB라 거의 그대로. snake_case 컬럼만 살짝 정리.

import { supabase, HAS_SUPABASE } from './supabase';
import { reportError } from '@/lib/analytics/track';
import { useSyncStore } from '@/lib/store/useSyncStore';
import type { PlaybookEntry, PlaybookSuggestion, UnknownQuery, ChatQuery, Owner, Junior } from '@/types';
import type { TaskTemplate, FeedItem, DoneMark } from '@/lib/store/useWorkStore';
import type { Room, RoomMember } from '@/lib/store/useRoomStore';
import type { AttendanceRecord } from '@/lib/store/useAttendanceStore';
import type { StoreConfig, ShiftTemplate, SwapRequest } from '@/lib/store/useScheduleStore';

// 현재 로그인 사용자의 unit_id (RLS가 어차피 막지만, INSERT 시 채워야 함)
let _unitId: string | null = null;
export function setUnitId(id: string | null) {
  _unitId = id;
}

// 같은 토픽 채널을 두 화면이 동시에 구독하면 Realtime 서버가 두 번째 join을 거부해
// 한쪽 실시간이 죽는다. 화면 레벨에서 구독하는 채널은 호출마다 토픽을 유니크하게 만든다.
let _chanSeq = 0;
const uniqueChannel = (base: string) => `${base}_${_chanSeq++}`;

// 쓰기 결과를 호출부(스토어)가 알 수 있게 boolean으로 반환 — 실패 시 낙관적 업데이트를 롤백한다.
// (예전엔 에러를 console.warn으로 삼켜, UI엔 저장된 듯 보이나 서버엔 없는 데이터 유실이 있었음)
async function write(label: string, q: PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
  const { error } = await q;
  if (error) {
    console.warn(`[db] ${label}:`, error.message);
    reportError(`db.write:${label}`, error); // 원격 관측 — 쓰기 실패를 팀이 볼 수 있게(무음 장애 방지)
    return false;
  }
  return true;
}

// 0행 유령 성공 방지(리포트 P1-6): RLS 차단·id 드리프트·동시 삭제로 대상 행이 0개면 PostgREST 는
// error=null 을 준다 → 일반 write() 는 성공(true)으로 오판해 롤백·배너 없이 데이터가 조용히 유실된다.
// writeStrict 는 쓰기 뒤 .select() 로 "실제 영향받은 행"을 받아, 0행이면 false(호출부가 롤백·배너).
// ⚠️ 쓰기 후 그 행을 SELECT 할 수 있는 경로에만 쓴다(RLS SELECT 허용). 아니면 저장됐는데도
//    0행으로 보여 오탐이 난다 → 무결성이 중요하고 재조회가 확실한 경로부터 선별 적용한다.
async function writeStrict(
  label: string,
  q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<boolean> {
  const { data, error } = await q;
  if (error) {
    console.warn(`[db] ${label}:`, error.message);
    reportError(`db.write:${label}`, error);
    return false;
  }
  if (Array.isArray(data) && data.length === 0) {
    console.warn(`[db] ${label}: 0 rows affected (RLS/id/concurrency)`);
    reportError(`db.write.zero:${label}`, { message: '0 rows affected' });
    return false;
  }
  return true;
}

// 읽기 실패를 한 곳에서 처리(리포트 P0-1): 개발자 콘솔 + 원격 관측 + 사용자에게 "불러오지 못했어요" 배너.
// 예전엔 fetch 실패가 조용히 빈배열로 반환돼, 광범위 백엔드 장애가 '내용 없음' 정상화면으로 위장됐다.
// 호출부는 여전히 빈값을 반환하되(프론트 안 끊김), 이 헬퍼가 실패를 사용자·팀 양쪽에 표면화한다.
function readFail(label: string, error: unknown): void {
  console.warn(`[db] ${label}:`, (error as any)?.message ?? String(error));
  reportError(`db.read:${label}`, error);
  useSyncStore.getState().noteError('일부 정보를 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.');
}

// 읽기 실패를 "빈 결과"와 구분하기 위한 반환형(리포트 P0-1의 핵심 수정): 예전엔 fetch가 실패해도
// 빈배열만 돌려줘 스토어가 loaded=true로만 세팅 → "장애"가 "데이터 없음"과 화면상 동일했다.
// error 플래그를 함께 돌려 스토어가 loadError를 세팅하고, 화면이 EmptyState 대신 "다시 시도"를 띄운다.
export type ReadResult<T> = { data: T; error: boolean };

// ── 시계열 fetch 상한 (무한 fetch 방지) ────────────────────────
// 누적되는 운영 데이터는 전체가 아니라 최근 구간만 당긴다(오래된 건 retention으로 정리됨).
// feed/chat 은 날짜창(휘발성), attendance/unknown 은 카운트 상한만(자산·pending 보존).
const FEED_WINDOW_DAYS = 90;
const CHAT_WINDOW_DAYS = 90;
const PAGE_LIMIT = 1000; // 단일 fetch 행 상한 — 현 규모 대비 넉넉, 폭주만 차단.
// date 컬럼(YYYY-MM-DD) / timestamptz 컬럼(ISO) 각각용 'N일 전' 경계값.
function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function sinceTs(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ── 가입/합류·계정 데이터 접근 (세션 스토어 오케스트레이션 전용) ───────────────
// 계층 경계(§3): 스토어/화면은 supabase.from/.rpc 를 직접 부르지 않는다 — 여기로만.
//   단 반환은 boolean(write)이 아니라 {data,error} 원형을 유지한다. 이유 두 가지:
//   ① 가입/합류 RPC 는 named 에러(already_in_store·invalid_code·too_many_attempts·
//      duplicate_biz_no·rename_limit …)로 분기해야 하고, 그 "코드→의미" 판정 SSOT 는 RPC 본문이다.
//      write()는 error.message 를 삼켜 이 분기를 파괴하므로 쓸 수 없다.
//   ② 세션 read 는 error 를 표면화해야(§4.8) 스토어가 일시적 읽기실패에 신원을 무음 강등하지 않는다.
//   (auth.* 세션관리는 '데이터 접근'이 아니므로 스토어가 계속 소유한다 — signIn/signUp/OTP/updateUser 등.)
export type DbErr = { message: string; code?: string } | null;
export type DbResult<T> = { data: T | null; error: DbErr };

export type SessionProfileRow = {
  id: string; name: string | null; role: string | null;
  unit_id: string | null; pending_unit_id: string | null;
  // 다점포(0055): active_unit_id = 현재 활성 매장(auth_unit_id()가 반환). unit_id는 주매장(첫 매장).
  // 클라 세션·db._unitId는 active를 우선 사용해 RLS(auth_unit_id=active)와 일치시킨다(split-brain 방지).
  active_unit_id: string | null;
  bio: string | null; phone: string | null; deleted_at: string | null;
};
export async function fetchSessionProfile(userId: string): Promise<DbResult<SessionProfileRow>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, unit_id, active_unit_id, pending_unit_id, bio, phone, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  return { data: (data as SessionProfileRow) ?? null, error: error as DbErr };
}

export type UnitInfoRow = { store_name: string | null; invite_code: string | null; industry: string | null };
export async function fetchUnitInfo(unitId: string): Promise<DbResult<UnitInfoRow>> {
  const { data, error } = await supabase
    .from('units').select('store_name, invite_code, industry').eq('id', unitId).maybeSingle();
  return { data: (data as UnitInfoRow) ?? null, error: error as DbErr };
}

// ── 다점포(0055) — 매장 목록·활성 전환 (definer RPC). db.ts만 supabase 접근(AGENTS ③) ──
export type MyUnitRow = { unit_id: string; store_name: string; role: string; industry: string | null; is_active: boolean };
/** 내가 속한(소유/직원) 매장 목록 — 매장 선택 홈/헤더 스위처용. units RLS는 활성 매장만 보이므로 definer RPC 필요. */
export async function fetchMyUnits(): Promise<DbResult<MyUnitRow[]>> {
  const { data, error } = await supabase.rpc('my_units');
  return { data: (data as MyUnitRow[]) ?? null, error: error as DbErr };
}
/** 활성 매장 전환(멤버십 검증은 RPC 내부). 성공 시 호출부가 loadProfile+재hydrate로 컨텍스트를 맞춘다. */
export async function switchActiveUnit(unitId: string): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('switch_active_unit', { p_unit_id: unitId });
  return { error: error as DbErr };
}

// ── 다점포 노하우 가져오기(0059) — 다른 내 매장 노하우를 활성매장으로 복제 ──────────
// RLS는 활성 매장만 노출하므로 "다른 내 매장" 목록/복제는 definer RPC로만 가능(소유검증은 RPC 내부).
export type UnitKnowhowRow = {
  id: string; category: string; subcategory: string | null; title: string;
  tags: string[]; square: Record<string, unknown>; needs_review: boolean; updated_at: string;
};
/** 다른 내 소유 매장(fromUnit)의 발행 노하우 목록 — 가져오기 선택 UI용. 소유 아니면 RPC가 not_owner. */
export async function fetchUnitKnowhow(fromUnit: string): Promise<DbResult<UnitKnowhowRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('list_unit_knowhow', { p_from_unit: fromUnit });
  return { data: (data as UnitKnowhowRow[]) ?? null, error: error as DbErr };
}
/** 선택 노하우를 활성매장으로 복제. 반환=복제된 개수. 소스+대상 이중 소유검증은 RPC 내부(크로스테넌트 방어선). */
export async function copyKnowhow(fromUnit: string, entryIds: string[]): Promise<DbResult<number>> {
  if (!HAS_SUPABASE) return { data: entryIds.length, error: null };
  const { data, error } = await supabase.rpc('copy_knowhow', { p_from_unit: fromUnit, p_entry_ids: entryIds });
  return { data: (data as number) ?? null, error: error as DbErr };
}

// ── 다점포 통합뷰(0060) — 내 전 매장 핵심 지표 집계(소유 매장만, definer). 합계는 클라 파생 ──────
export type OwnerOverviewRow = {
  unit_id: string; store_name: string; is_active: boolean;
  pending_q: number; knowhow: number; staff: number; labor_month: number;
};
/** 내가 소유한 모든 매장의 미답질문·노하우·직원·이번달 인건비를 한 번에. RLS는 활성만 보이므로 definer RPC. */
export async function fetchOwnerOverview(): Promise<DbResult<OwnerOverviewRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('owner_overview');
  return { data: (data as OwnerOverviewRow[]) ?? null, error: error as DbErr };
}

/** 매장 하나 삭제(오너 전용, 안전장치는 RPC 내부: 마지막매장·직원존재 차단·포인터 재지정·cascade). */
export async function rpcDeleteStore(unitId: string): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('delete_store', { p_unit_id: unitId });
  return { error: error as DbErr };
}

// plan = 과금 티어(free|single|multi, 0062). 원시값 그대로 반환 — 해석은 tiers.ts normalizePlan.
export type UnitSubscriptionRow = { status: string | null; trial_ends_at: string | null; paid_until: string | null; plan: string | null };
export async function fetchUnitSubscription(unitId: string): Promise<DbResult<UnitSubscriptionRow>> {
  const { data, error } = await supabase
    .from('unit_subscriptions').select('status, trial_ends_at, paid_until, plan').eq('unit_id', unitId).maybeSingle();
  return { data: (data as UnitSubscriptionRow) ?? null, error: error as DbErr };
}

// ── 알림 수신 선호(notification_prefs) — 서버(엣지 push 함수)가 발송 직전에 읽는 SSOT ─────────
// 화면/스토어는 여기로만 접근한다(§계층 경계 ③). 저장은 원자적 upsert RPC 한 곳(save_notification_prefs).
// 읽기는 RLS 로 본인 행만 반환(where 없이도 user_id=auth.uid() 로 좁혀짐). 행이 없으면 null → 스토어가 기본값.
export type NotificationPrefsRow = {
  push_enabled: boolean;
  quiet_enabled: boolean;
  quiet_start: string; // "HH:MM"
  quiet_end: string; // "HH:MM"
};
export async function fetchNotificationPrefs(): Promise<DbResult<NotificationPrefsRow>> {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('push_enabled, quiet_enabled, quiet_start, quiet_end')
    .maybeSingle();
  return { data: (data as NotificationPrefsRow) ?? null, error: error as DbErr };
}
export async function saveNotificationPrefs(p: NotificationPrefsRow): Promise<{ error: DbErr }> {
  if (!HAS_SUPABASE) return { error: null };
  const { error } = await supabase.rpc('save_notification_prefs', {
    p_push_enabled: p.push_enabled,
    p_quiet_enabled: p.quiet_enabled,
    p_quiet_start: p.quiet_start,
    p_quiet_end: p.quiet_end,
  });
  return { error: error as DbErr };
}

// 전화번호 중복 사전검사(주키). 비로그인 호출 가능. data=true/false, error=검사 실패.
export async function checkPhoneInUse(phone: string): Promise<DbResult<boolean>> {
  const { data, error } = await supabase.rpc('phone_in_use', { p_phone: phone });
  return { data: (data as boolean) ?? null, error: error as DbErr };
}

export type CreateStoreRow = { unit_id: string; invite_code: string };
export async function rpcCreateStore(storeName: string, industry: string | null, bizNo: string | null): Promise<DbResult<CreateStoreRow>> {
  const { data, error } = await supabase.rpc('create_store', { p_store_name: storeName, p_industry: industry, p_biz_no: bizNo });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: (row as CreateStoreRow) ?? null, error: error as DbErr };
}

export type JoinRow = { unit_id: string; store_name: string };
export async function rpcJoinByInvite(code: string): Promise<DbResult<JoinRow>> {
  const { data, error } = await supabase.rpc('join_by_invite', { p_code: code });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: (row as JoinRow) ?? null, error: error as DbErr };
}

export async function rpcCancelJoinRequest(): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('cancel_join_request');
  return { error: error as DbErr };
}

export async function rpcLeaveStore(): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('leave_store');
  return { error: error as DbErr };
}

export async function rpcDeleteMyAccount(): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('delete_my_account');
  return { error: error as DbErr };
}

// rename_store 는 남은 변경 횟수(number)를 반환한다(서버가 14일 2회 강제).
export async function rpcRenameStore(name: string): Promise<DbResult<number>> {
  const { data, error } = await supabase.rpc('rename_store', { p_name: name });
  return { data: (typeof data === 'number' ? data : null), error: error as DbErr };
}

// 본인 프로필 필드 갱신(name/phone/bio 등). RLS: 본인 행만.
export async function updateProfileFields(userId: string, fields: Record<string, string | null>): Promise<{ error: DbErr }> {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  return { error: error as DbErr };
}

// 매장 업종 갱신(사장 전용). RLS: 소유 매장만.
export async function updateUnitIndustry(unitId: string, industry: string): Promise<{ error: DbErr }> {
  const { error } = await supabase.from('units').update({ industry }).eq('id', unitId);
  return { error: error as DbErr };
}

// ── 직원/사장 프로필 (같은 매장) ───────────────────────────
// 실서비스: profiles에서 내 매장 동료를 읽어 직원/근태/급여 화면을 채운다.
export async function fetchStaffProfiles(): Promise<{ owner: Owner | null; staff: Junior[]; error: boolean }> {
  if (!HAS_SUPABASE) return { owner: null, staff: [], error: false };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, phone_last4, avatar, bio, meta, created_at')
    .order('created_at', { ascending: true });
  if (error) {
    readFail('fetchStaffProfiles', error);
    return { owner: null, staff: [], error: true };
  }
  const rows = (data ?? []) as any[];
  const unit = _unitId ?? '';
  const ownerRow = rows.find((r) => r.role === 'owner');
  const owner: Owner | null = ownerRow
    ? {
        id: ownerRow.id,
        name: ownerRow.name ?? '',
        role: 'owner',
        age: 0,
        phone_last4: ownerRow.phone_last4 ?? '',
        unit_id: unit,
        avatar: ownerRow.avatar ?? undefined,
        bio: ownerRow.bio ?? undefined,
        joined_at: ownerRow.created_at ?? '',
        career_years: ownerRow.meta?.career_years ?? 0,
      }
    : null;
  const staff: Junior[] = rows
    .filter((r) => r.role === 'junior')
    .map((r) => ({
      id: r.id,
      name: r.name ?? '',
      role: 'junior',
      age: 0,
      phone_last4: r.phone_last4 ?? '',
      unit_id: unit,
      avatar: r.avatar ?? undefined,
      bio: r.bio ?? undefined,
      joined_at: r.created_at ?? '',
      career_days: r.meta?.career_days ?? 0,
      shift: r.meta?.shift ?? undefined,
    }));
  return { owner, staff, error: false };
}

// 사장이 직원을 매장에서 내보낸다(소속 해제 + 퇴사자 스냅샷 보관). RPC = 사장만·같은 매장 junior만.
export async function removeStaffMember(staffId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // write() 헬퍼 경유 — 실패 시 reportError로 원격관측까지 남긴다(예전엔 console.warn만 남아 팀이 못 봄).
  return write('removeStaffMember', supabase.rpc('remove_staff', { p_staff_id: staffId }));
}

// 퇴사 6개월 경과분 개인 기록 자동 정리(내 매장 범위). 사장 진입 시 기회적으로 1회 호출 — 실패해도 무해.
export async function purgeExpiredFormerStaff(): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.rpc('purge_expired_former_staff');
  if (error) { console.warn('[db] purgeExpiredFormerStaff:', error.message); reportError('db:purgeExpiredFormerStaff', error); }
}

// ── 합류 승인(남용 #2) ─────────────────────────────────────
// 우리 매장에 합류 '신청'한(pending_unit_id = 내 매장) 프로필 목록. RLS가 신청자만 통과시킨다.
export async function fetchPendingMembers(): Promise<ReadResult<{ id: string; name: string; phone_last4: string; created_at: string }[]>> {
  if (!HAS_SUPABASE || !_unitId) return { data: [], error: false };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone_last4, created_at')
    .eq('pending_unit_id', _unitId)
    .order('created_at', { ascending: true });
  if (error) {
    readFail('fetchPendingMembers', error);
    return { data: [], error: true };
  }
  return {
    data: (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name ?? '',
      phone_last4: r.phone_last4 ?? '',
      created_at: r.created_at ?? '',
    })),
    error: false,
  };
}

// 사장이 신청자를 승인 → unit_id 부여(소속 확정). RPC가 '내 매장 신청자'만 통과시킨다.
// staff_limit(무료 플랜 좌석 캡, 0062)은 일반 실패와 구분해 반환 — 호출부가 업그레이드 안내로 매핑.
export async function approveMember(uid: string): Promise<{ ok: boolean; code: 'staff_limit' | null }> {
  if (!HAS_SUPABASE) return { ok: true, code: null };
  const { error } = await supabase.rpc('approve_member', { p_uid: uid });
  if (error) {
    console.warn('[db] approveMember:', error.message);
    reportError('db.write:approveMember', error);
    return { ok: false, code: /staff_limit/.test(error.message) ? 'staff_limit' : null };
  }
  return { ok: true, code: null };
}

// 사장이 신청 거절 → pending만 비운다(계정은 유지).
export async function rejectMember(uid: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('rejectMember', supabase.rpc('reject_member', { p_uid: uid }));
}

// ── 초대코드 재발급(남용 #31) ──────────────────────────────
// 새 6자리 코드 + 7일 만료. 유출/교체용. 성공 시 새 코드 반환(세션·화면 갱신용).
export async function rotateInviteCode(): Promise<{ inviteCode: string; expiresAt: string } | null> {
  if (!HAS_SUPABASE) return null;
  const { data, error } = await supabase.rpc('rotate_invite_code');
  if (error) {
    console.warn('[db] rotateInviteCode:', error.message); reportError('db:rotateInviteCode', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_code) return null;
  return { inviteCode: String(row.invite_code), expiresAt: String(row.invite_expires_at ?? '') };
}

// ── 플레이북 ───────────────────────────────────────────────
export async function fetchEntries(): Promise<ReadResult<PlaybookEntry[]>> {
  if (!HAS_SUPABASE) return { data: [], error: false };
  const { data, error } = await supabase
    .from('playbook_entries')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    readFail('fetchEntries', error);
    return { data: [], error: true };
  }
  return { data: (data ?? []) as PlaybookEntry[], error: false };
}

// source/verification 은 현재 스키마에 컬럼이 없다(타입엔 있으나 0001 테이블 미포함).
// 그대로 보내면 PostgREST가 "column does not exist"로 insert 전체를 거부 → 발행 실패.
// 스키마에 없는 키는 떼고 보낸다(컬럼 추가 시 이 strip만 풀면 됨).
function stripNonColumns<T extends Record<string, unknown>>(obj: T): Omit<T, 'source' | 'verification'> {
  const { source: _s, verification: _v, ...rest } = obj as any;
  return rest;
}

export async function insertEntry(entry: PlaybookEntry): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row = { ...stripNonColumns(entry), unit_id: entry.unit_id || _unitId };
  return write('insertEntry', supabase.from('playbook_entries').insert(row));
}

export async function updateEntry(id: string, patch: Partial<PlaybookEntry>): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 노하우 수정이 0행(RLS/id드리프트)이면 사장이 고친 내용이 조용히 원복된다 → 실제 갱신 확인(P1-6).
  return writeStrict(
    'updateEntry',
    supabase
      .from('playbook_entries')
      .update({ ...stripNonColumns(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
  );
}

export async function deleteEntry(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteEntry', supabase.from('playbook_entries').delete().eq('id', id).select('id'));
}

// ── 노하우 제안/신청(알바 → 사장) ─────────────────────────
export async function fetchSuggestions(): Promise<PlaybookSuggestion[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('playbook_suggestions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    readFail('fetchSuggestions', error);
    return [];
  }
  return (data ?? []) as PlaybookSuggestion[];
}

export async function insertSuggestion(s: PlaybookSuggestion): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row = { ...s, unit_id: s.unit_id || _unitId };
  return write('insertSuggestion', supabase.from('playbook_suggestions').insert(row));
}

// 승인/반려 등 검토 결과 반영. status + 검토 메타만 갱신.
export async function reviewSuggestion(
  id: string,
  patch: Partial<Pick<PlaybookSuggestion, 'status' | 'owner_note' | 'resulting_entry_id' | 'reviewed_by' | 'reviewed_at'>>,
): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 제안 승인/반려는 상태 전이(무결성) — 0행이면 유령 승인/반려 대신 실패로(P1-6).
  return writeStrict('reviewSuggestion', supabase.from('playbook_suggestions').update(patch).eq('id', id).select('id'));
}

export function subscribeSuggestions(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('playbook_suggestions'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playbook_suggestions' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ── 미답변 큐(사장님 인박스) ───────────────────────────────
export async function fetchUnknownQueue(): Promise<ReadResult<UnknownQuery[]>> {
  if (!HAS_SUPABASE) return { data: [], error: false };
  const { data, error } = await supabase
    .from('unknown_queries')
    .select('*')
    .order('asked_at', { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) {
    readFail('fetchUnknownQueue', error);
    return { data: [], error: true };
  }
  return { data: (data ?? []) as UnknownQuery[], error: false };
}

export async function insertUnknown(uq: UnknownQuery): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row = { ...uq, unit_id: (uq as any).unit_id || _unitId };
  return write('insertUnknown', supabase.from('unknown_queries').insert(row));
}

export async function bumpUnknownSimilar(id: string, count: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('bumpUnknownSimilar', supabase.from('unknown_queries').update({ similar_queries_count: count }).eq('id', id).select('id'));
}

// 받은질문 상태 전이(보관/자동응답/대기로 되돌리기). status 컬럼만 갱신.
export async function updateUnknownStatus(id: string, status: UnknownQuery['status']): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 상태 전이는 무결성 핵심(pending↔resolved) — 0행이면 유령 성공 대신 실패로(P1-6).
  return writeStrict('updateUnknownStatus', supabase.from('unknown_queries').update({ status }).eq('id', id).select('id'));
}

export async function resolveUnknown(id: string, newEntryId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 질문 해결 표시가 0행이면 알바 챗봇 학습 루프가 조용히 끊긴다 → 반드시 실제 갱신 확인(P1-6).
  return writeStrict(
    'resolveUnknown',
    supabase
      .from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: newEntryId })
      .eq('id', id)
      .select('id'),
  );
}

// ── 채팅 기록 ──────────────────────────────────────────────
export async function fetchChatQueries(juniorId: string): Promise<ChatQuery[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('chat_queries')
    .select('*')
    .eq('junior_id', juniorId)
    .gte('asked_at', sinceTs(CHAT_WINDOW_DAYS))
    .order('asked_at', { ascending: true })
    .limit(PAGE_LIMIT);
  if (error) {
    readFail('fetchChatQueries', error);
    return [];
  }
  return (data ?? []) as ChatQuery[];
}

export async function insertChatQuery(cq: ChatQuery): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // candidate_entry_ids는 클라 UI 전용(비영속) — DB 컬럼이 없으므로 insert에서 제외.
  const { candidate_entry_ids: _drop, ...persisted } = cq;
  const row = { ...persisted, unit_id: (cq as any).unit_id || _unitId };
  return write('insertChatQuery', supabase.from('chat_queries').insert(row));
}

export async function updateChatSatisfaction(id: string, vote: 'up' | 'down'): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('updateChatSatisfaction', supabase.from('chat_queries').update({ satisfaction: vote }).eq('id', id).select('id'));
}

// 노하우 사용 통계 재계산 — 답변 서빙/평가가 "영속된 뒤" 영향받은 entry id들로 호출(fire-and-forget·비치명).
// 진실원천 chat_queries에서 30일 윈도우를 서버가 재평가해 playbook_entries.stats(query_hits_30d/
// resolution_rate/thumbs/last_used_at)를 통째 갱신한다 → 클라 카운터 경쟁·권한경계 훼손 없음.
// 0037_knowhow_usage_stats.sql 의 recompute_playbook_stats RPC. 미적용 환경이면 함수 부재로
// 에러가 나지만 답변 흐름과 무관하므로 조용히 경고만 남긴다(stats가 0으로 남을 뿐, 서빙은 정상).
export async function recomputePlaybookStats(entryIds: string[]): Promise<void> {
  if (!HAS_SUPABASE || !entryIds.length) return;
  const { error } = await supabase.rpc('recompute_playbook_stats', { p_entry_ids: entryIds });
  if (error) { console.warn('[db] recomputePlaybookStats:', error.message); reportError('db:recomputePlaybookStats', error); }
}

// ── 사진 업로드(Storage) ───────────────────────────────────
// blob: URL은 같은 브라우저에서만 보임 → Storage에 올려 공개 URL로 영속·공유.
// Supabase 없으면 로컬 object URL을 그대로 반환(데모 폴백).
const PHOTO_BUCKET = 'playbook-photos';

// canvas.toBlob이 WebP를 실제로 뱉는지 1회 확인(런타임 캐시). 사파리 구버전 등 미지원이면 JPEG로 폴백.
// toDataURL이 'data:image/webp'로 시작하면 인코더 있음 — toBlob도 같은 인코더를 쓴다.
let _webpOk: boolean | null = null;
function supportsWebp(): boolean {
  if (_webpOk !== null) return _webpOk;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    _webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    _webpOk = false;
  }
  return _webpOk;
}

// 업로드 전 이미지 압축(웹) — 폰 사진 수 MB를 긴 변 1600px로 다운스케일 + 재인코딩.
// 현업 표준 용량 절감:
//   · WebP(q0.82) 우선 — 동일 화질에서 JPEG 대비 ~25~35% 작음. 미지원 브라우저는 JPEG(q0.8) 폴백.
//   · canvas 재인코딩이 EXIF 등 메타데이터를 통째로 떨궈 용량↓ + 위치정보 프라이버시.
// 비웹(document 없음)·비이미지·이미 충분히 작은 파일·실패 시 원본 그대로(업로드가 절대 안 깨지게).
async function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
  // GIF는 재인코딩하면 애니메이션이 죽으므로 손대지 않는다.
  if (file.type === 'image/gif') return file;
  if (file.size < 300_000) return file; // 이미 충분히 작으면 재인코딩 이득<CPU비용 → 스킵
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const webp = supportsWebp();
    const mime = webp ? 'image/webp' : 'image/jpeg';
    const ext = webp ? 'webp' : 'jpg';
    const quality = webp ? 0.82 : 0.8;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality));
    if (!blob || blob.size >= file.size) return file; // 압축 이득 없으면 원본
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.' + ext, { type: mime });
  } catch {
    return file;
  }
}

export async function uploadPhoto(file: File): Promise<string | null> {
  if (!HAS_SUPABASE) {
    return typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
  }
  const compressed = await compressImage(file);
  const ext = compressed.name.split('.').pop() || 'jpg';
  const path = `${_unitId ?? 'unknown'}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, compressed, {
    contentType: compressed.type || 'image/jpeg',
    // 경로가 매번 유니크(타임스탬프+난수)라 내용이 바뀔 일이 없다 → 1년 immutable 캐싱으로
    // CDN이 재조회를 흡수해 Storage egress(Pro 대역폭)를 아낀다.
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    console.warn('[db] uploadPhoto:', error.message); reportError('db:uploadPhoto', error);
    return null;
  }
  // 비공개 버킷 — 영구 공개URL(getPublicUrl) 대신 '오브젝트 경로'만 저장한다.
  // 표시 시 resolvePhotoUri 가 본인 매장 권한으로 단기 서명URL을 발급(타 매장 URL 열람 차단).
  return path;
}

// 저장된 사진 참조를 표시용 단기 서명URL로 변환.
//  - 신규 저장값 = 오브젝트 경로('<unit_id>/<ts>-<rand>.ext')
//  - 레거시 저장값 = 공개URL('.../playbook-photos/<path>') → path 추출해 동일하게 서명(버킷 비공개 후에도 표시됨)
//  - mock/로컬 프리뷰(blob:/data:/file:) 및 외부 http URL 은 그대로 반환
const _signCache = new Map<string, { url: string; exp: number }>();
export async function resolvePhotoUri(stored?: string | null): Promise<string | null> {
  if (!stored) return null;
  if (/^(blob:|data:|file:)/.test(stored)) return stored;
  if (!HAS_SUPABASE) return stored;
  const marker = `/${PHOTO_BUCKET}/`;
  const mi = stored.indexOf(marker);
  if (mi < 0 && /^https?:\/\//.test(stored)) return stored; // 스토리지 밖 URL — 방어적으로 그대로
  const path = (mi >= 0 ? stored.slice(mi + marker.length) : stored).split('?')[0];
  const now = Date.now();
  const cached = _signCache.get(path);
  if (cached && cached.exp > now) return cached.url;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) { reportError('db:resolvePhotoUri', error ?? new Error('sign failed')); return null; }
  _signCache.set(path, { url: data.signedUrl, exp: now + 50 * 60 * 1000 }); // 서명 1h · 캐시 50m
  return data.signedUrl;
}

// ── Realtime 구독 ──────────────────────────────────────────
// 사장님 인박스: 다른 기기(알바 폰)에서 질문이 들어오면 즉시 onChange 호출.
export function subscribeUnknownQueue(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('unknown_queue'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'unknown_queries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// 알바 채팅: 사장님이 답변을 발행(playbook_entries insert)하면 즉시 갱신.
export function subscribePlaybook(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('playbook'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playbook_entries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ── 업무 채팅방 ────────────────────────────────────────────
export async function fetchRooms(): Promise<Room[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('work_rooms').select('*').order('created_at');
  if (error) {
    readFail('fetchRooms', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    unitId: r.unit_id,
    name: r.name,
    isDefault: !!r.is_default,
    ...(r.created_by ? { createdBy: r.created_by as string } : null),
    ...(r.created_at ? { createdAt: r.created_at as string } : null),
  })) as Room[];
}
export async function fetchRoomMembers(): Promise<RoomMember[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('work_room_members').select('room_id, user_id');
  if (error) {
    readFail('fetchRoomMembers', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({ roomId: r.room_id, userId: r.user_id })) as RoomMember[];
}
export async function insertRoom(room: Room): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'insertRoom',
    supabase.from('work_rooms').insert({
      id: room.id,
      unit_id: room.unitId || _unitId,
      name: room.name,
      is_default: room.isDefault,
      created_by: room.createdBy ?? null,
    }),
  );
}
export async function updateRoomName(id: string, name: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('updateRoomName', supabase.from('work_rooms').update({ name }).eq('id', id).select('id'));
}
export async function deleteRoom(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteRoom', supabase.from('work_rooms').delete().eq('id', id).select('id'));
}
export async function addRoomMember(roomId: string, userId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('addRoomMember', supabase.from('work_room_members').upsert({ room_id: roomId, user_id: userId }));
}
export async function removeRoomMember(roomId: string, userId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('removeRoomMember', supabase.from('work_room_members').delete().eq('room_id', roomId).eq('user_id', userId));
}
export function subscribeRooms(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('work_rooms'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_rooms' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_room_members' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ── 업무보드: 할일 템플릿 ──────────────────────────────────
export async function fetchTemplates(): Promise<TaskTemplate[]> {
  if (!HAS_SUPABASE) return [];
  // select('*') — 0013 마이그레이션 적용 전후 모두 안전(없는 컬럼은 undefined).
  const { data, error } = await supabase.from('work_templates').select('*').order('created_at');
  if (error) {
    readFail('fetchTemplates', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    section: r.section,
    text: r.text,
    ...(r.room_id ? { roomId: r.room_id as string } : null),
    ...(r.section_note ? { sectionNote: r.section_note as string } : null),
    scope: (r.scope as 'shared' | 'private') ?? 'shared',
    ...(r.owner_id ? { ownerId: r.owner_id as string } : null),
    ...(r.created_by ? { createdBy: r.created_by as string } : null),
    ...(r.recurrence ? { recurrence: r.recurrence } : null),
    // date(신규) 우선, 없으면 due_date(레거시) → date로 흡수.
    ...(r.date ? { date: r.date as string } : r.due_date ? { date: r.due_date as string } : null),
    // 배정 시각 — 배정 알림 정렬 기준(없으면 매일 상단 고정 버그). DB default now() 라 항상 존재.
    ...(r.created_at ? { createdAt: r.created_at as string } : null),
  })) as TaskTemplate[];
}
export async function insertTemplate(t: TaskTemplate): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'insertTemplate',
    supabase.from('work_templates').insert({
      id: t.id,
      section: t.section,
      text: t.text,
      room_id: t.roomId ?? null,
      section_note: t.sectionNote ?? null,
      scope: t.scope ?? 'shared',
      owner_id: t.ownerId ?? null,
      // created_by 미지정 시 DB default auth.uid()가 채운다(삽입한 본인).
      ...(t.createdBy ? { created_by: t.createdBy } : null),
      recurrence: t.recurrence ?? null,
      date: t.date ?? t.dueDate ?? null,
      // due_date 컬럼은 NOT NULL 제약이 없으니 신규 경로에선 사용 안 함(date로 통일).
      unit_id: _unitId,
    }),
  );
}
export async function updateTemplate(t: TaskTemplate): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict(
    'updateTemplate',
    supabase
      .from('work_templates')
      .update({
        section: t.section,
        text: t.text,
        section_note: t.sectionNote ?? null,
        scope: t.scope ?? 'shared',
        owner_id: t.ownerId ?? null,
        recurrence: t.recurrence ?? null,
        date: t.date ?? t.dueDate ?? null,
      })
      .eq('id', t.id)
      .select('id'),
  );
}
export async function deleteTemplate(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteTemplate', supabase.from('work_templates').delete().eq('id', id).select('id'));
}

// ── 업무보드: 완료 체크 ────────────────────────────────────
export async function fetchDone(): Promise<Record<string, Record<string, DoneMark>>> {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase.from('work_done').select('work_date, template_id, data');
  if (error) {
    readFail('fetchDone', error);
    return {};
  }
  const out: Record<string, Record<string, DoneMark>> = {};
  for (const r of (data ?? []) as any[]) {
    (out[r.work_date] ??= {})[r.template_id] = r.data as DoneMark;
  }
  return out;
}
export async function setDone(date: string, templateId: string, mark: DoneMark, roomId?: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'setDone',
    supabase.from('work_done').upsert({ unit_id: _unitId, work_date: date, template_id: templateId, room_id: roomId ?? null, data: mark }),
  );
}
export async function clearDone(date: string, templateId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict(
    'clearDone',
    supabase.from('work_done').delete().eq('unit_id', _unitId).eq('work_date', date).eq('template_id', templateId).select('template_id'),
  );
}

// ── 업무보드: 피드(공지/메시지/완료) ──────────────────────
export async function fetchFeed(): Promise<FeedItem[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('work_feed')
    .select('data')
    .gte('feed_date', sinceDate(FEED_WINDOW_DAYS))
    .order('created_at')
    .limit(PAGE_LIMIT);
  if (error) {
    readFail('fetchFeed', error);
    return [];
  }
  return (data ?? []).map((r: any) => r.data as FeedItem);
}
export async function upsertFeed(item: FeedItem): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'upsertFeed',
    supabase.from('work_feed').upsert({ id: item.id, unit_id: _unitId, feed_date: item.date, room_id: item.roomId ?? null, data: item }),
  );
}
// 이미 존재하는 피드 행의 data 를 "제자리 수정(UPDATE)". insert 판정을 타지 않는 게 핵심.
// ⚠️ 직원이 공지를 읽음표시(read_by 추가)할 때 upsertFeed(=upsert)를 쓰면, upsert 의 INSERT 경로가
//    wf_insert 정책(`notice 는 사장만 insert`)에 걸려 42501(RLS 위반)로 저장이 조용히 실패했다
//    → 읽음이 영구 반영 안 되고 안읽음 배지도 안 지워졌다. UPDATE 는 wf_update(같은 매장 허용)만
//    평가하므로 남이 만든 공지 행이라도 같은 매장이면 정상 저장된다. (테넌트 격리는 USING 절이 유지.)
export async function updateFeed(item: FeedItem): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('updateFeed', supabase.from('work_feed').update({ data: item }).eq('id', item.id).select('id'));
}
export async function deleteFeed(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteFeed', supabase.from('work_feed').delete().eq('id', id).select('id'));
}

// ── 출퇴근 ─────────────────────────────────────────────────
export async function fetchAttendance(): Promise<AttendanceRecord[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('attendance')
    .select('id, staff_id, date, check_in, check_out, work_minutes, edited_by')
    .order('date', { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) {
    readFail('fetchAttendance', error);
    return [];
  }
  return (data ?? []) as AttendanceRecord[];
}
export async function upsertAttendance(rec: AttendanceRecord): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 출퇴근=급여 직결 무결성 경로 — 0행(RLS/경합)이면 유령 성공 대신 실패로 롤백·배너(P1-6).
  return writeStrict('upsertAttendance', supabase.from('attendance').upsert({ ...rec, unit_id: _unitId }).select('id'));
}
export async function deleteAttendance(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 출퇴근=급여 직결 — upsert만 writeStrict였고 delete가 빠져 있었다. 0행 삭제가 "지워짐"으로 보이나
  // 서버 잔존하면 급여 총액이 어긋난다 → delete도 실제 영향행 확인(P1-6).
  return writeStrict('deleteAttendance', supabase.from('attendance').delete().eq('id', id).select('id'));
}

// ── 시급 ───────────────────────────────────────────────────
export async function fetchWages(): Promise<Record<string, number>> {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase.from('wages').select('staff_id, hourly_wage');
  if (error) {
    readFail('fetchWages', error);
    return {};
  }
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) out[r.staff_id] = r.hourly_wage;
  return out;
}
export async function setWageDb(staffId: string, wage: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 시급=돈 직결 — 0행(RLS/경합)이면 새 시급이 화면엔 보이나 급여는 옛 값으로 계산된다 → 실제 반영 확인(P1-6).
  return writeStrict(
    'setWageDb',
    supabase.from('wages').upsert({ unit_id: _unitId, staff_id: staffId, hourly_wage: wage }).select('staff_id'),
  );
}

// ── 급여 규칙(매장 단위, units.payroll_settings jsonb) ──────
// 직원은 읽기(급여계산), 사장만 쓰기 — units RLS(units_read/units_write)가 그대로 강제.
export async function fetchPayrollSettings(): Promise<Record<string, unknown> | null> {
  if (!HAS_SUPABASE) return null;
  const { data, error } = await supabase.from('units').select('payroll_settings').eq('id', _unitId).maybeSingle();
  if (error) {
    readFail('fetchPayrollSettings', error);
    return null;
  }
  return (data?.payroll_settings as Record<string, unknown> | null) ?? null;
}
export async function savePayrollSettings(settings: Record<string, unknown>): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 급여 규칙=돈 직결 — 0행(사장 아님·RLS·경합)이면 화면엔 바뀐 듯 보이나 계산은 옛 규칙 → 실제 반영 확인.
  return writeStrict('savePayrollSettings', supabase.from('units').update({ payroll_settings: settings }).eq('id', _unitId).select('id'));
}

// ── 업무보드/출퇴근 Realtime 구독 ─────────────────────────
export function subscribeWork(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('work'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_feed' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_done' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_templates' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}
export function subscribeAttendance(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('attendance'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ── 근무표(운영설정 · 시프트 템플릿 · 교대 요청) ───────────────
// 컬럼 매핑: closed_days(jsonb)↔closedDays, start_time/end_time↔start/end. unit_id는 RLS가 막지만 INSERT 시 채운다.
export async function fetchScheduleConfig(): Promise<StoreConfig | null> {
  if (!HAS_SUPABASE) return null;
  const { data, error } = await supabase
    .from('schedule_config')
    .select('open, close, closed_days, note, dayparts')
    .maybeSingle();
  if (error) {
    readFail('fetchScheduleConfig', error);
    return null;
  }
  if (!data) return null;
  return {
    open: data.open ?? '09:00',
    close: data.close ?? '22:00',
    closedDays: Array.isArray(data.closed_days) ? (data.closed_days as number[]) : [],
    note: data.note ?? '',
    ...(data.dayparts && typeof data.dayparts === 'object' ? { dayparts: data.dayparts as StoreConfig['dayparts'] } : null),
  };
}

export async function upsertScheduleConfig(c: StoreConfig): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'upsertScheduleConfig',
    supabase.from('schedule_config').upsert({
      unit_id: _unitId,
      open: c.open,
      close: c.close,
      closed_days: c.closedDays,
      note: c.note,
      dayparts: c.dayparts ?? null,
      updated_at: new Date().toISOString(),
    }),
  );
}

function shiftRow(t: ShiftTemplate) {
  return {
    id: t.id,
    unit_id: _unitId,
    staff_id: t.staff_id,
    weekday: t.weekday,
    start_time: t.start,
    end_time: t.end,
  };
}

export async function fetchShiftTemplates(): Promise<ShiftTemplate[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('shift_templates')
    .select('id, staff_id, weekday, start_time, end_time');
  if (error) {
    readFail('fetchShiftTemplates', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    staff_id: r.staff_id,
    weekday: r.weekday,
    start: r.start_time,
    end: r.end_time,
  }));
}

export async function insertShiftTemplate(t: ShiftTemplate): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('insertShiftTemplate', supabase.from('shift_templates').insert(shiftRow(t)));
}

export async function updateShiftTemplate(id: string, patch: Partial<ShiftTemplate>): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row: Record<string, unknown> = {};
  if (patch.staff_id !== undefined) row.staff_id = patch.staff_id;
  if (patch.weekday !== undefined) row.weekday = patch.weekday;
  if (patch.start !== undefined) row.start_time = patch.start;
  if (patch.end !== undefined) row.end_time = patch.end;
  return writeStrict('updateShiftTemplate', supabase.from('shift_templates').update(row).eq('id', id).select('id'));
}

export async function deleteShiftTemplate(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteShiftTemplate', supabase.from('shift_templates').delete().eq('id', id).select('id'));
}

/**
 * 한 직원의 주간 시프트를 교체. 실제로 없어진 시프트만 삭제(removeIds)하고 나머지는 upsert.
 * 유지되는 시프트는 id를 재사용하므로 그 시프트를 참조하던 교대 요청(FK)이 깨지지 않는다.
 * (전체 delete→insert는 ON DELETE CASCADE로 진행 중 교대까지 날려서 금지.) RLS가 매장·사장 권한을 강제.
 */
export async function saveStaffShifts(
  staffId: string,
  rows: ShiftTemplate[],
  removeIds: string[],
): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 원자성 개선(비트랜잭션): upsert(유지·신규)를 먼저 커밋하고 그다음 remove 삭제한다.
  //   - upsert 실패 시 삭제 전에 중단 → 편집 손실 없음(최악=변화 없음 + 배너로 재시도).
  //   - 삭제가 뒤에서 실패해도 없어질 시프트가 잠깐 남을 뿐(과다)이라 편집이 사라지진 않는다(과소 방지).
  //   - 둘 다 writeStrict — 0행(RLS 차단·동시성)을 성공으로 오판하지 않는다.
  //   ※ 완전 원자성은 단일 트랜잭션 RPC 가 정답(후속). 지금은 실패 '방향'을 안전한 쪽으로 뒤집는다.
  //   (rows 는 유지 id 재사용 + 신규, removeIds 는 사라진 id — 서로 겹치지 않아 순서 교체가 안전.)
  if (rows.length > 0) {
    const up = await writeStrict('saveStaffShifts.upsert', supabase.from('shift_templates').upsert(rows.map(shiftRow)).select('id'));
    if (!up) return false;
  }
  if (removeIds.length > 0) {
    return writeStrict('saveStaffShifts.delete', supabase.from('shift_templates').delete().in('id', removeIds).select('id'));
  }
  return true;
}

export async function fetchSwaps(): Promise<SwapRequest[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('swap_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    readFail('fetchSwaps', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    requester_id: r.requester_id,
    date: r.date,
    template_id: r.template_id,
    target_staff_id: r.target_staff_id ?? undefined,
    target_date: r.target_date ?? undefined,
    target_template_id: r.target_template_id ?? undefined,
    note: r.note ?? '',
    status: r.status,
    accepted_by: r.accepted_by ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  })) as SwapRequest[];
}

export async function insertSwap(r: SwapRequest): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'insertSwap',
    supabase.from('swap_requests').insert({
      id: r.id,
      unit_id: _unitId,
      kind: r.kind,
      requester_id: r.requester_id,
      date: r.date,
      template_id: r.template_id,
      target_staff_id: r.target_staff_id ?? null,
      target_date: r.target_date ?? null,
      target_template_id: r.target_template_id ?? null,
      note: r.note,
      status: r.status,
      accepted_by: r.accepted_by ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }),
  );
}

export async function updateSwap(id: string, patch: Partial<SwapRequest>): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.accepted_by !== undefined) row.accepted_by = patch.accepted_by ?? null;
  if (patch.updated_at !== undefined) row.updated_at = patch.updated_at;
  // 교대 승인/수락/취소는 "누가 그 근무를 서는가"를 정하는 무결성 핵심 상태 전이 — 0행(RLS/경합)이면
  // 유령 성공 대신 실패로(P1-6). 안 그러면 UI는 "승인됨" + 거짓 푸시가 나가는데 DB는 그대로 남는다.
  return writeStrict('updateSwap', supabase.from('swap_requests').update(row).eq('id', id).select('id'));
}

export function subscribeSchedule(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('schedule'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_config' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_templates' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'swap_requests' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// 직원 명부(profiles) 실시간 — 직원이 초대코드로 합류(profiles.unit_id 갱신)하면 사장 화면에
// 즉시 반영되게. 이게 없으면 사장이 앱을 켜둔 채로는 신규 합류가 재진입 전까지 안 보여
// "초대했는데 안 들어왔네?" 오해가 난다. (RLS가 같은 매장 행만 흘려보낸다.)
export function subscribeStaff(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('staff'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}
