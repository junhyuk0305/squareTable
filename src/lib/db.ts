// lib/db.ts
// 데이터 접근 단일 계층. 스토어/화면은 여기만 호출하고 Supabase를 직접 모름.
// HAS_SUPABASE=false면 전부 no-op/빈배열 → 기존 로컬 시드 스토어로 자연 폴백(프론트 안 끊김).
//
// 행(row) ↔ TS 타입 매핑: 중첩 필드는 JSONB라 거의 그대로. snake_case 컬럼만 살짝 정리.

import { supabase, HAS_SUPABASE } from './supabase';
import { reportError } from '@/lib/analytics/track';
import { useSyncStore } from '@/lib/store/useSyncStore';
import type { PlaybookEntry, PlaybookSuggestion, UnknownQuery, ChatQuery, Owner, Junior, PaymentClaim } from '@/types';
import type { TaskTemplate, FeedItem, DoneMark, Recurrence } from '@/lib/store/useWorkStore';
import type { Room, RoomMember } from '@/lib/store/useRoomStore';
import type { AttendanceRecord } from '@/lib/store/useAttendanceStore';
import type { StoreConfig, ShiftTemplate, SwapRequest } from '@/lib/store/useScheduleStore';
import type { CustomCategory } from '@/lib/store/knowhowCategories';
// 훈련 v2(0107·0108). ★TrainingCourse 는 이 파일이 이미 0099 의 문자열 유니온으로 쓰고 있어(아래)
// 이름이 겹친다 → 코스 테이블 행 타입은 TrainingCourseRow 로 별칭한다. 구조는 동일하므로
// 다른 화면이 '@/lib/quiz/types' 에서 TrainingCourse 를 직접 import 해 넘겨도 그대로 맞는다.
import type {
  QuizItem,
  QuizResponse,
  QuizGrade,
  TrainingCourse as TrainingCourseRow,
} from '@/lib/quiz/types';

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
/** 활성매장에서 방금 발행한 노하우를 "다른 내 매장(toUnit)"으로 밀어넣기(발행 넛지, S3 #1). 방향만 반대·이중 소유검증은 RPC 내부. */
export async function copyKnowhowTo(toUnit: string, entryIds: string[]): Promise<DbResult<number>> {
  if (!HAS_SUPABASE) return { data: entryIds.length, error: null };
  const { data, error } = await supabase.rpc('copy_knowhow_to', { p_to_unit: toUnit, p_entry_ids: entryIds });
  return { data: (data as number) ?? null, error: error as DbErr };
}

// ── 다점포 통합뷰(0060) — 내 전 매장 핵심 지표 집계(소유 매장만, definer). 합계는 클라 파생 ──────
export type OwnerOverviewRow = {
  unit_id: string; store_name: string; is_active: boolean;
  pending_q: number; knowhow: number; staff: number; labor_month: number;
  uncovered: number; // 첨부 노하우 없는 업무 수(커버리지, 0074). 매장 단위 결과물 카운트
  sugg_pending: number; // 검토 대기 제안 수(0081) — 허브 현황 '확인 필요'
  needs_review: number; // 검증 필요 노하우 수(발행본, 0081)
  ai_used: number; // 이번달(KST) AI답변 사용량(0081, ai_usage_monthly)
  asked_ever: boolean; // AI 질문 1건 이상(ever, 0086) — 시작 체크리스트. 월 리셋되는 ai_used로 판정 금지
  done_ever: boolean; // 업무 완료 기록 1건 이상(ever, 0086) — 시작 체크리스트
  stale: number; // 90일 넘게 수정 없는 발행 노하우 수(0091) — 허브 노하우 탭
};
/** 내가 소유한 모든 매장의 미답질문·노하우·직원·이번달 인건비를 한 번에. RLS는 활성만 보이므로 definer RPC. */
export async function fetchOwnerOverview(): Promise<DbResult<OwnerOverviewRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('owner_overview');
  return { data: (data as OwnerOverviewRow[]) ?? null, error: error as DbErr };
}

// ── 허브 대시보드(0081) — 사장 현황 탭·직원 오늘 탭 데이터 (definer, 0074/0077 패턴) ─────────
export type OwnerTodayRow = { unit_id: string; working_now: number; scheduled: number };
/** 소유 매장별 지금 근무중/오늘 근무 예정 "카운트" — 현황 탭 오늘 스냅샷. 명단은 매장 출퇴근 화면 담당. */
export async function fetchOwnerToday(): Promise<DbResult<OwnerTodayRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('owner_today');
  if (error) readFail('fetchOwnerToday', error);
  return { data: (data as OwnerTodayRow[]) ?? null, error: error as DbErr };
}

export type MyShiftRow = { id: string; weekday: number; start: string; end: string };
export type MyCrossSummaryRow = {
  unit_id: string; store_name: string; shifts: MyShiftRow[]; month_minutes: number; hourly_wage: number;
};
/** 본인의 소속 매장별 근무표·이번달 근무분·시급 — 직원 오늘 탭. 본인 행만(RPC 내부 강제).
 *  "오늘/다음 근무" 판정은 클라가 weekday 로 파생 — 승인된 교대 반영은 매장 근무표 화면이 정본(v1 미반영). */
export async function fetchMyCrossSummary(): Promise<DbResult<MyCrossSummaryRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('my_cross_summary');
  if (error) readFail('fetchMyCrossSummary', error);
  return { data: (data as MyCrossSummaryRow[]) ?? null, error: error as DbErr };
}

export type MyGrowthRow = {
  unit_id: string; store_name: string;
  my_knowhow: number; // 내가 만든 발행 노하우 수(0089)
  my_hits: number; // 그 노하우들의 최근 30일 참조 합
  taught: number; // 내 제안이 노하우로 채택된 수(실적)
  done_kinds: number; // 내 완료 기록의 업무 종류 수(경험 — 완료≠숙련)
};
/** 본인의 매장별 축적(노하우·참조·채택·해본 업무) — 직원 허브 '성장' 탭. 전부 본인 데이터만(RPC 내부 강제). */
export async function fetchMyGrowth(): Promise<DbResult<MyGrowthRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('my_growth');
  if (error) readFail('fetchMyGrowth', error);
  return { data: (data as MyGrowthRow[]) ?? null, error: error as DbErr };
}

/** 내 노하우 원문 목록(0094) — my_growth 카운트와 동일 술어(직접 작성 or 제안 채택). 본인 귀속만(RPC 내부 강제). */
export async function fetchMyKnowhowEntries(): Promise<DbResult<PlaybookEntry[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('my_knowhow_entries');
  if (error) readFail('fetchMyKnowhowEntries', error);
  return { data: (data as PlaybookEntry[]) ?? null, error: error as DbErr };
}

// ── 통합 알림(0077) — 소속 전 매장의 알림 '원시 행' → 매장별 도메인 타입 묶음 ──────────
// 판정(안읽음·대기)은 클라 notifications.ts SSOT — 여기선 행→타입 매핑만(기존 매퍼 재사용).
// RLS 가 활성 매장만 노출하므로 definer RPC 로만 가능(멤버십 검증·방 격리는 RPC 내부).
export type UnitNotifData = {
  unitId: string;
  feed: FeedItem[];
  swaps: SwapRequest[];
  taskTemplates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  /** userId → 이름(nameOf 용, 소속 매장 명부와 동일 노출 범위). */
  names: Record<string, string>;
  // 사장 매장만 채워짐(직원 매장은 빈 배열).
  queue: UnknownQuery[];
  suggestions: PlaybookSuggestion[];
  pending: { id: string; name: string; phone_last4: string; created_at: string }[];
};
export async function fetchCrossStoreNotifData(): Promise<DbResult<UnitNotifData[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('my_units_notif_data');
  if (error) {
    // 비활성 매장 처리 큐(합류·질문 등)의 유일 경로 — 실패를 빈 뱃지로 위장하지 않는다(readFail SSOT).
    readFail('fetchCrossStoreNotifData', error);
    return { data: null, error: error as DbErr };
  }
  const byUnit = new Map<string, UnitNotifData>();
  const bundle = (unitId: string): UnitNotifData => {
    let b = byUnit.get(unitId);
    if (!b) {
      b = { unitId, feed: [], swaps: [], taskTemplates: [], done: {}, names: {}, queue: [], suggestions: [], pending: [] };
      byUnit.set(unitId, b);
    }
    return b;
  };
  for (const r of (data ?? []) as { unit_id: string; source: string; payload: any }[]) {
    const b = bundle(r.unit_id);
    const p = r.payload;
    switch (r.source) {
      case 'feed': b.feed.push(p as FeedItem); break;
      case 'swap': b.swaps.push(mapSwapRow(p)); break;
      case 'template': b.taskTemplates.push(mapTemplateRow(p)); break;
      case 'done': (b.done[p.work_date] ??= {})[p.template_id] = p.data as DoneMark; break;
      case 'member': b.names[p.id] = p.name ?? ''; break;
      case 'uq': b.queue.push(p as UnknownQuery); break;
      case 'sugg': b.suggestions.push(p as PlaybookSuggestion); break;
      case 'join': b.pending.push({ id: p.id, name: p.name ?? '', phone_last4: p.phone_last4 ?? '', created_at: p.created_at ?? '' }); break;
    }
  }
  return { data: [...byUnit.values()], error: null };
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

// ── 입금 신고(payment_claims, 0083) — 계좌이체 "입금했어요"의 1급 기록 ──────────────
// RLS: 그 매장 사장만 select/insert. update/delete 는 정책도 권한도 없다(검토는 service_role RPC 전용).
// 신고는 반드시 RPC 로 — 서버가 활성 매장·사장 여부·청구액을 스스로 정하고 중복 pending 을 갱신한다.
export async function fetchPaymentClaims(): Promise<ReadResult<PaymentClaim[]>> {
  if (!HAS_SUPABASE) return { data: [], error: false };
  const { data, error } = await supabase
    .from('payment_claims')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    readFail('fetchPaymentClaims', error);
    return { data: [], error: true };
  }
  return { data: (data ?? []) as PaymentClaim[], error: false };
}

// 신고 등록/갱신. 실패 사유를 화면이 분기해야 하므로(depositor_required·not_owner…) DbResult 원형 유지.
export async function submitPaymentClaim(args: {
  plan: 'single' | 'multi';
  amountKrw: number;
  depositorName: string;
  months?: number;
  memo?: string | null;
  // 주문 시점 동의(0116) — 없으면 서버가 consent_required 로 거부한다. 이게 계약서를 대신하는 기록이다.
  termsVersion: string;
  // 세금계산서 — 요청하는 사장만(선택).
  bizNo?: string | null;
  bizEmail?: string | null;
}): Promise<DbResult<PaymentClaim>> {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase.rpc('submit_payment_claim', {
    p_plan: args.plan,
    // 서버가 다시 계산해 저장한다(클라 금액 불신, 0083). 보내는 값은 드리프트 관측용.
    p_amount: args.amountKrw,
    p_depositor: args.depositorName,
    p_months: args.months ?? 1,
    p_memo: args.memo ?? null,
    p_terms_version: args.termsVersion,
    p_biz_no: args.bizNo ?? null,
    p_biz_email: args.bizEmail ?? null,
  });
  return { data: (data as PaymentClaim) ?? null, error: error as DbErr };
}

// ── 좌석 잠금(0115) — 무료 강등으로 한도를 넘은 직원 자리 ────────────────────────
// 판정은 전부 서버(my_seat_locked / unit_seat_status)가 갖는다. 화면은 결과만 그린다.
export async function fetchMySeatLocked(): Promise<DbResult<boolean>> {
  if (!HAS_SUPABASE) return { data: false, error: null };
  const { data, error } = await supabase.rpc('my_seat_locked');
  return { data: (data as boolean) ?? false, error: error as DbErr };
}

export type SeatStatus = { total: number; cap: number; locked: number };

export async function fetchUnitSeatStatus(): Promise<DbResult<SeatStatus>> {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase.rpc('unit_seat_status');
  const row = Array.isArray(data) ? (data[0] as SeatStatus) : (data as SeatStatus);
  return { data: row ?? null, error: error as DbErr };
}

// ── 도입 문의(sales_inquiries, 0105) — 웹 영업 퍼널의 리드 캡처 ──────────────────
// RLS: insert 만(anon 포함 — 랜딩의 비로그인 방문자도 남긴다). 조회·처리는 service_role 전용.
// 로그인 상태면 계정을 연결해 운영자가 어떤 계정의 문의인지 맞춰볼 수 있게 한다(위조는 RLS 봉쇄).
export async function insertSalesInquiry(args: {
  name: string;
  phone: string;
  company?: string | null;
  message?: string | null;
}): Promise<boolean> {
  if (!HAS_SUPABASE) return true; // 데모 폴백 — 프론트 흐름 유지
  const { data: sess } = await supabase.auth.getSession();
  return write(
    'insertSalesInquiry',
    supabase.from('sales_inquiries').insert({
      user_id: sess?.session?.user?.id ?? null,
      name: args.name.trim(),
      phone: args.phone.trim(),
      company: args.company?.trim() || null,
      message: args.message?.trim() || null,
    }),
  );
}

// ── 무료 이용 코드(promo_codes, 0092) — 코드 검증·기록·활성화는 전부 서버(RPC) ────────────
// 테이블은 클라 전면 deny — 성패는 RPC 결과로만 안다. named 에러 분기는 billing.tsx 한 곳.
export type PromoRedeemRow = { unit_id: string; status: string; paid_until: string | null; plan: string; days: number };
export async function redeemPromoCode(code: string): Promise<DbResult<PromoRedeemRow>> {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase.rpc('redeem_promo_code', { p_code: code });
  // returns table → 배열로 온다(admin_activate_store 계열과 동일).
  return { data: (data as PromoRedeemRow[])?.[0] ?? null, error: error as DbErr };
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

// ── 매장별 개인 설정(unit_member_prefs) — "직원×매장" 레이어(닉네임·색·매장별 방해금지·음소거) ─────
// 순수 개인화라 본인 행만(RLS). 화면/스토어는 여기로만 접근(§계층 경계 ③). 저장=원자적 upsert RPC 한 곳.
// 읽기는 내 전 매장 행을 한 번에 받아 클라가 unit_id 로 머지한다(my_units RPC 는 무변경 — 시그니처 보존).
export type UnitMemberPrefsRow = {
  unit_id: string;
  nickname: string | null;
  color: string | null; // null 이면 클라가 unit_id 해시로 자동 배정
  muted: boolean;
  quiet_enabled: boolean;
  quiet_start: string; // "HH:MM"
  quiet_end: string; // "HH:MM"
  /** 알림 '모두 읽기' 기준 시각(0078) — 이 시각 이전 항목은 배지·강조 제외. 저장은 ackNotifications 로만. */
  notif_ack_at?: string | null;
};
export async function fetchMemberPrefs(): Promise<DbResult<UnitMemberPrefsRow[]>> {
  if (!HAS_SUPABASE) return { data: null, error: null };
  const { data, error } = await supabase
    .from('unit_member_prefs')
    .select('unit_id, nickname, color, muted, quiet_enabled, quiet_start, quiet_end, notif_ack_at');
  return { data: (data as UnitMemberPrefsRow[]) ?? null, error: error as DbErr };
}
/** 알림 '모두 읽기'(0078) — 내 (user, unit) 행의 notif_ack_at 을 지금으로. */
export async function ackNotifications(unitId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('ackNotifications', supabase.rpc('ack_notifications', { p_unit_id: unitId }));
}
export async function saveMemberPrefs(p: UnitMemberPrefsRow): Promise<{ error: DbErr }> {
  if (!HAS_SUPABASE) return { error: null };
  const { error } = await supabase.rpc('save_unit_member_prefs', {
    p_unit_id: p.unit_id,
    p_nickname: p.nickname,
    p_color: p.color,
    p_muted: p.muted,
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
// birthDate(YYYY-MM-DD)는 신규 가입 경로 필수(0065) — 서버가 누락·범위 밖을 named 에러로 거부.
// 기존 계정(컷오프 이전 생성)은 서버가 면제하므로 null 허용.
export async function rpcCreateStore(storeName: string, industry: string | null, bizNo: string | null, birthDate: string | null = null): Promise<DbResult<CreateStoreRow>> {
  const { data, error } = await supabase.rpc('create_store', { p_store_name: storeName, p_industry: industry, p_biz_no: bizNo, p_birth_date: birthDate });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: (row as CreateStoreRow) ?? null, error: error as DbErr };
}

// 소셜 로그인(구글 등) 사용자의 결손 프로필(phone/birth_date=null)을 본인이 채운다(0066).
// role/unit_id 는 서버 함수가 건드리지 않는다(사장 승격은 create_store 만). 성공 시 void.
export async function rpcCompleteProfile(name: string, phone: string | null, birthDate: string | null): Promise<{ error: DbErr }> {
  const { error } = await supabase.rpc('complete_profile', { p_name: name, p_phone: phone, p_birth_date: birthDate });
  return { error: error as DbErr };
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

// ── 매장별 멤버 역할(0093) ─────────────────────────────────
// 활성 매장 멤버들의 unit_members.role — 매니저 배지·임명 UI 입력(um_select_same_unit).
export async function fetchUnitMemberRoles(): Promise<ReadResult<Record<string, string>>> {
  if (!HAS_SUPABASE || !_unitId) return { data: {}, error: false };
  const { data, error } = await supabase.from('unit_members').select('user_id, role').eq('unit_id', _unitId);
  if (error) {
    readFail('fetchUnitMemberRoles', error);
    return { data: {}, error: true };
  }
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { user_id: string; role: string }[]) map[r.user_id] = r.role;
  return { data: map, error: false };
}

// 사장이 직원을 매니저로 지정/해제(0093). RPC = 매장 소유자 본인만·이 매장 junior/manager 대상만.
export async function setMemberRoleDb(uid: string, role: 'manager' | 'junior'): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('setMemberRole', supabase.rpc('set_member_role', { p_uid: uid, p_role: role }));
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

// source 는 아직 스키마에 컬럼이 없다(타입엔 있으나 0001 테이블 미포함).
// 그대로 보내면 PostgREST가 "column does not exist"로 insert 전체를 거부 → 발행 실패.
// 스키마에 없는 키는 떼고 보낸다(컬럼 추가 시 이 strip만 풀면 됨).
// verification 은 0068에서 컬럼이 생겨 strip 해제 — 이제 실제로 저장된다.
function stripNonColumns<T extends Record<string, unknown>>(obj: T): Omit<T, 'source'> {
  const { source: _s, ...rest } = obj as any;
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

/**
 * 카테고리(section) 일괄 이동 — 카테고리 편집(개명·삭제)용. to=null 이면 '기타'(미분류)로.
 * 단일 bulk update 라 per-entry 재색인(embedEntry)을 태우지 않는다(섹션은 색인 텍스트가 아님).
 * RLS가 활성 매장 행으로 범위를 좁힌다. 0행 매칭도 성공(이미 옮겨진 재시도 멱등).
 */
export async function renameEntrySection(from: string, to: string | null): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'renameEntrySection',
    supabase.from('playbook_entries').update({ section: to, updated_at: new Date().toISOString() }).eq('section', from),
  );
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

export async function resolveUnknown(id: string, newEntryId: string, answeredBy?: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  // 질문 해결 표시가 0행이면 알바 챗봇 학습 루프가 조용히 끊긴다 → 반드시 실제 갱신 확인(P1-6).
  // answered_by(0071): 누가 해결했나(직원 즉시해결·사장 발행 공통) — "내가 답한 질문"·크레딧용.
  return writeStrict(
    'resolveUnknown',
    supabase
      .from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: newEntryId, ...(answeredBy ? { answered_by: answeredBy } : null) })
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
// 행→TaskTemplate 매핑 SSOT — fetchTemplates(활성 매장)와 fetchCrossStoreNotifData(0077)가 공유.
function mapTemplateRow(r: any): TaskTemplate {
  return {
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
    // 업무 시간(0118). 이 값이 있으면 서버 크론이 그 시간에 알림을 쏜다.
    ...(r.remind_at ? { remindAt: r.remind_at as string } : null),
    // 배정 시각 — 배정 알림 정렬 기준(없으면 매일 상단 고정 버그). DB default now() 라 항상 존재.
    ...(r.created_at ? { createdAt: r.created_at as string } : null),
    // 할일 목록에서 숨김(0110). 퀴즈가 만들어 낸 껍데기 업무를 사장이 정리한 표시.
    ...(r.hidden ? { hidden: true } : null),
  } as TaskTemplate;
}
export async function fetchTemplates(): Promise<TaskTemplate[]> {
  if (!HAS_SUPABASE) return [];
  // select('*') — 0013 마이그레이션 적용 전후 모두 안전(없는 컬럼은 undefined).
  const { data, error } = await supabase.from('work_templates').select('*').order('created_at');
  if (error) {
    readFail('fetchTemplates', error);
    return [];
  }
  return (data ?? []).map(mapTemplateRow);
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
      remind_at: t.remindAt ?? null,
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
        remind_at: t.remindAt ?? null,
      })
      .eq('id', t.id)
      .select('id'),
  );
}
export async function deleteTemplate(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteTemplate', supabase.from('work_templates').delete().eq('id', id).select('id'));
}
/** 할일 목록에서 숨기기·되돌리기(0110) — 업무 행·노하우 링크·코스 소속은 그대로 남는다.
 *  updateTemplate 은 hidden 을 건드리지 않으므로 할일 수정이 이 표시를 지우지 않는다. */
export async function setTemplateHidden(ids: string[], hidden: boolean): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  if (ids.length === 0) return true;
  return writeStrict(
    'setTemplateHidden',
    supabase.from('work_templates').update({ hidden }).in('id', ids).select('id'),
  );
}

// ── 업무 ↔ 노하우 링크(0069) ───────────────────────────────
// 스키마 최초의 task↔knowhow 교차 연결(LIVE §4.1-2). unit_id/added_by 는 RLS·DB default 가 채운다.
export type KnowhowLinkRow = { templateId: string; entryId: string };
/** 활성 매장의 전체 (업무↔노하우) 링크 — 스토어가 정/역방향 셀렉터로 파생한다. */
export async function fetchTemplateKnowhow(): Promise<KnowhowLinkRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('work_template_knowhow').select('template_id, entry_id');
  if (error) {
    readFail('fetchTemplateKnowhow', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({ templateId: r.template_id, entryId: r.entry_id }));
}
/** 업무에 노하우 여러 개 첨부. onConflict 무시(이미 붙은 건 멱등) → 재첨부는 성공으로 본다(writeStrict 금지). */
export async function insertTemplateKnowhow(templateId: string, entryIds: string[]): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  if (entryIds.length === 0) return true;
  const rows = entryIds.map((entry_id) => ({ unit_id: _unitId, template_id: templateId, entry_id }));
  return write(
    'insertTemplateKnowhow',
    supabase.from('work_template_knowhow').upsert(rows, { onConflict: 'template_id,entry_id', ignoreDuplicates: true }),
  );
}
/** 업무에서 노하우 여러 개 첨부 해제. 이미 없으면 0행(=원하는 상태)이라 write(멱등). */
export async function deleteTemplateKnowhow(templateId: string, entryIds: string[]): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  if (entryIds.length === 0) return true;
  return write(
    'deleteTemplateKnowhow',
    supabase.from('work_template_knowhow').delete().eq('template_id', templateId).in('entry_id', entryIds),
  );
}

// ── 이해 확인 기록(0111) — 직원이 **노하우**를 이해했다는 통과 기록 ──────────
// 0072 는 업무 단위(task_understanding)였다. 0111 에서 노하우 단위로 옮겼다(기획 §3.1) —
// 같은 지식을 업무마다 다시 배우지 않게, 그리고 못 했을 때 무엇이 빠졌는지 알 수 있게.
// "이 업무를 할 줄 아는가"는 저장하지 않고 파생한다 — 판정 SSOT 는 useWorkStore 한 곳.
export type UnderstandingRow = { entryId: string; staffId: string; staffName: string; verifiedAt: string };
/** 활성 매장의 전체 이해 확인 기록 — 사장 배지·본인 확인·재확인 주기 판정용(노출 범위는 UI 게이팅). */
export async function fetchKnowhowUnderstanding(): Promise<UnderstandingRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('knowhow_understanding').select('entry_id, staff_id, staff_name, verified_at');
  if (error) {
    readFail('fetchKnowhowUnderstanding', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({ entryId: r.entry_id, staffId: r.staff_id, staffName: r.staff_name, verifiedAt: r.verified_at ?? '' }));
}
/** 통과 기록 저장(푼 문항의 근거 노하우 전부). staff_id 는 DB default auth.uid()(본인만·위조 차단).
 *  재통과는 verified_at 갱신(0111 ku_update) — 재확인 주기 판정의 근거라 멱등 무시가 아니라 갱신이다. */
export async function insertKnowhowUnderstanding(entryIds: string[], staffName: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  if (entryIds.length === 0) return true;
  const at = new Date().toISOString();
  return write(
    'insertKnowhowUnderstanding',
    supabase
      .from('knowhow_understanding')
      .upsert(
        entryIds.map((entry_id) => ({ unit_id: _unitId, entry_id, staff_name: staffName, verified_at: at })),
        { onConflict: 'entry_id,staff_id' },
      ),
  );
}

// ── 퀴즈 오답 집계(0103) — 문항이 근거한 노하우에 귀속(개인 저장 없음), 사장 결함 검출용 ──────────
export type QuizStatRow = { entryId: string; attempts: number; misses: number };
/** 채점 결과 합산(비치명 fire-and-forget) — 서버 RPC가 활성 매장 소속 엔트리만 반영한다. */
export async function recordQuizStats(rows: QuizStatRow[]): Promise<void> {
  if (!HAS_SUPABASE || rows.length === 0) return;
  const { error } = await supabase.rpc('record_quiz_stats', {
    p_stats: rows.map((r) => ({ entry_id: r.entryId, attempts: r.attempts, misses: r.misses })),
  });
  if (error) console.warn('[recordQuizStats]', error.message); // 집계 실패가 채점 UX를 막으면 안 된다
}
/** 활성 매장의 문항 오답 집계(RLS: 사장·매니저만) — entry_id → {attempts, misses}. */
export async function fetchQuizStats(): Promise<Record<string, { attempts: number; misses: number }>> {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase.from('knowhow_quiz_stats').select('entry_id, attempt_count, miss_count');
  if (error) {
    readFail('fetchQuizStats', error);
    return {};
  }
  const out: Record<string, { attempts: number; misses: number }> = {};
  for (const r of data ?? []) out[r.entry_id] = { attempts: r.attempt_count ?? 0, misses: r.miss_count ?? 0 };
  return out;
}

// ── 본인 퀴즈 통과 이력(0104 → 0111) — 허브 성장 탭용, 교차 매장·본인 한정(definer RPC) ──────────
// 0111 에서 읽는 테이블이 knowhow_understanding 으로 바뀌면서 단위도 업무 → 노하우가 됐다.
export type TrainingHistoryRow = { unitId: string; storeName: string; entryId: string; entryTitle: string; verifiedAt: string };
export async function fetchMyTrainingHistory(): Promise<TrainingHistoryRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.rpc('my_training_history');
  if (error) {
    readFail('fetchMyTrainingHistory', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    unitId: r.unit_id,
    storeName: r.store_name,
    entryId: r.entry_id,
    entryTitle: r.entry_title,
    verifiedAt: r.verified_at ?? '',
  }));
}

// ── 훈련 코스 항목(0099 → 0108) — ⚠️ 레거시·읽기 전용 ──────────
// 0111 에서 코스가 담는 것이 업무 → 노하우(course_entries)로 옮겨졌다. 이 테이블은 드롭하지
// 않고 남아 있으며, **1단계 정리 화면**이 "퀴즈 때문에 생긴 껍데기 업무"를 찾는 데만 읽는다.
// 새 쓰기 경로는 없다 — 코스 구성은 insertCourseEntry 계열을 쓴다.
/** 코스 key(training_courses.key). 0108 이전엔 'first_day'|'regular' 뿐이었으나 이제 매장이 만든 key 도 온다. */
export type TrainingCourse = string;
export type TrainingItemRow = {
  templateId: string;
  /** 정본(0108 training_courses.id). 쓰기는 전부 이 값 기준. */
  courseId: string;
  /** 코스 key 사본 — 화면 필터가 조인 없이 쓰는 값. DB 의 레거시 course 컬럼과 같다. */
  course: TrainingCourse;
  position: number;
};
/** 활성 매장의 훈련 항목 전체(전 코스 합본) — 코스 분리는 스토어 셀렉터가 한다. */
export async function fetchTrainingItems(): Promise<TrainingItemRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('training_items')
    .select('template_id, course_id, course, position')
    .order('position');
  if (error) {
    readFail('fetchTrainingItems', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    templateId: r.template_id,
    courseId: r.course_id,
    course: r.course,
    position: r.position,
  }));
}
// ── 코스에 담긴 노하우(0111) — 퀴즈의 정본 축 ─────────────────────────────
// training_items(위)는 이제 **읽기 전용 레거시**다. 1단계 정리 화면이 "퀴즈 때문에 생긴 껍데기
// 업무"를 찾는 데만 쓰고, 코스 구성·직원 카드·통과 판정은 전부 여기를 본다.
export type CourseEntryRow = { courseId: string; entryId: string; position: number };
/** 활성 매장의 코스 항목 전체(전 코스 합본) — 코스 분리는 스토어 셀렉터가 한다. */
export async function fetchCourseEntries(): Promise<CourseEntryRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('course_entries')
    .select('course_id, entry_id, position')
    .order('position');
  if (error) {
    readFail('fetchCourseEntries', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({ courseId: r.course_id, entryId: r.entry_id, position: r.position }));
}
/** 코스에 노하우 담기(관리 권한만, RLS). 충돌 기준 = (course_id, entry_id) — 같은 코스 재추가만 멱등. */
export async function insertCourseEntry(courseId: string, entryId: string, position: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'insertCourseEntry',
    supabase
      .from('course_entries')
      .upsert(
        { unit_id: _unitId, course_id: courseId, entry_id: entryId, position },
        { onConflict: 'course_id,entry_id', ignoreDuplicates: true },
      ),
  );
}
/** 코스 하나에서 노하우 빼기(노하우·다른 코스 소속·통과 기록은 남는다). 이미 없으면 0행 = 원하는 상태(멱등). */
export async function deleteCourseEntry(courseId: string, entryId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'deleteCourseEntry',
    supabase.from('course_entries').delete().eq('course_id', courseId).eq('entry_id', entryId),
  );
}
/** 순서 변경 — 한 코스 안에서 이웃과 position 스왑(관리 권한만, ce_update). 두 행을 개별 update.
 *  ★course_id 로 먼저 좁힌다 — 같은 노하우가 다른 코스에도 있으면 그쪽 순서까지 덮어쓴다. */
export async function updateCourseEntryPositions(
  courseId: string,
  pairs: { entryId: string; position: number }[],
): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  for (const p of pairs) {
    const ok = await writeStrict(
      'updateCourseEntryPositions',
      supabase
        .from('course_entries')
        .update({ position: p.position })
        .eq('course_id', courseId)
        .eq('entry_id', p.entryId)
        .select('entry_id'),
    );
    if (!ok) return false;
  }
  return true;
}

// ── 퀴즈 요청(0102 → 0111) — 특정 직원에게 노하우 확인을 지금/매주로 요청 ──────────
// recurrence: null = 즉시 1회 / {weekly:[0..6]} = 매주. 완료는 파생(verified_at 비교) — 컬럼 없음.
// 0111 에서 축이 업무 → 노하우로 옮겨졌다. 옛 template_id 행(entry_id null)은 읽지 않는다.
export type TrainingRequestRow = {
  id: string;
  entryId: string;
  staffId: string;
  recurrence: Recurrence | null;
  createdAt: string;
};
/** 내 요청(직원) 또는 매장 전체 요청(관리 권한) — 범위는 RLS(trq_select)가 가른다. */
export async function fetchTrainingRequests(): Promise<TrainingRequestRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('training_requests')
    .select('id, entry_id, staff_id, recurrence, created_at')
    .not('entry_id', 'is', null);
  if (error) {
    readFail('fetchTrainingRequests', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id, entryId: r.entry_id, staffId: r.staff_id,
    recurrence: (r.recurrence as Recurrence) ?? null, createdAt: r.created_at,
  }));
}
export async function insertTrainingRequests(rows: TrainingRequestRow[]): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  if (rows.length === 0) return true;
  return write(
    'insertTrainingRequests',
    supabase.from('training_requests').insert(
      rows.map((r) => ({ id: r.id, unit_id: _unitId, entry_id: r.entryId, staff_id: r.staffId, recurrence: r.recurrence })),
    ),
  );
}
export async function deleteTrainingRequest(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteTrainingRequest', supabase.from('training_requests').delete().eq('id', id));
}

// ── 훈련 문항(0107) — 저장된 퀴즈 문항 + 서버 채점 ──────────────────────────
// ★payload 는 두 얼굴이다. 사장 편집 화면은 정답 포함 원본(fetchQuizItems, RLS 상 관리자만
//   SELECT 가능), 응시 화면은 정답 키가 제거된 사본(fetchQuizItemsForAttempt = definer RPC).
//   채점은 반드시 서버(gradeQuiz) — 문항을 저장하는 순간 클라 채점은 곧 정답 유출이다.
const QUIZ_ITEM_COLS =
  'id, unit_id, entry_ids, kind, format, payload, source, status, created_by, created_at, updated_at, source_updated_at';

/** 근거 노하우로 문항 찾기(정답 포함) — 사장 문항 편집용. 직원이 부르면 RLS 상 빈 배열. */
export async function fetchQuizItems(entryIds: string[]): Promise<DbResult<QuizItem[]>> {
  if (!HAS_SUPABASE || entryIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from('quiz_items')
    .select(QUIZ_ITEM_COLS)
    .overlaps('entry_ids', entryIds)
    .order('created_at', { ascending: false });
  if (error) readFail('fetchQuizItems', error);
  return { data: (data as QuizItem[] | null) ?? null, error: error as DbErr };
}

/** 응시용 문항(정답 제거본) — RPC quiz_items_for. 순서는 사람마다 다르고 재조회해도 같다. */
export async function fetchQuizItemsForAttempt(
  entryIds: string[],
  limit = 3,
): Promise<DbResult<QuizItem[]>> {
  if (!HAS_SUPABASE || entryIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc('quiz_items_for', { p_entry_ids: entryIds, p_limit: limit });
  if (error) {
    readFail('fetchQuizItemsForAttempt', error);
    return { data: null, error: error as DbErr };
  }
  // RPC 는 응시에 필요한 5개만 돌려준다(unit_id·source·status·시각은 안 내려온다 — 응시 화면이
  // 쓰지 않고, 적게 내보낼수록 안전하다). 아래 기본값은 QuizItem 타입을 채우기 위한 것뿐이다.
  return {
    data: ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      unit_id: _unitId ?? '',
      entry_ids: (r.entry_ids as string[]) ?? [],
      kind: r.kind,
      format: r.format,
      payload: (r.payload as Record<string, any>) ?? {},
      source: 'ai' as const,
      status: 'active' as const,
    })),
    error: null,
  };
}

/** 노하우별 '나가는' 문항 수(0109). 직원도 호출 가능 — 개수만 나오고 문항·정답은 안 나온다. */
export async function fetchQuizItemCounts(): Promise<DbResult<Record<string, number>>> {
  if (!HAS_SUPABASE) return { data: {}, error: null };
  const { data, error } = await supabase.rpc('quiz_item_counts');
  if (error) {
    readFail('fetchQuizItemCounts', error);
    return { data: null, error: error as DbErr };
  }
  const out: Record<string, number> = {};
  for (const r of (data as any[]) ?? []) out[r.entry_id] = r.n ?? 0;
  return { data: out, error: null };
}

/** 서버 채점(RPC grade_quiz). answer 는 틀렸을 때만 채워진다(맞으면 null). */
export async function gradeQuiz(itemId: string, response: QuizResponse): Promise<DbResult<QuizGrade>> {
  if (!HAS_SUPABASE) return { data: null, error: { message: 'no_backend' } };
  const { data, error } = await supabase.rpc('grade_quiz', { p_item_id: itemId, p_response: response });
  if (error) {
    // 채점 실패를 조용히 오답으로 접으면 안 된다 — 호출부가 재시도를 띄우도록 에러를 그대로 올린다.
    reportError('db.rpc:gradeQuiz', error);
    return { data: null, error: error as DbErr };
  }
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row) {
    reportError('db.rpc:gradeQuiz', { message: 'no row' });
    return { data: null, error: { message: 'grade_quiz_empty' } };
  }
  return {
    data: { correct: !!row.correct, explain: row.explain ?? '', answer: row.answer ?? null },
    error: null,
  };
}

/** 문항 저장(관리 권한만, RLS qi_insert). id 는 호출부가 만든다(training_requests 와 같은 관례). */
export async function insertQuizItem(item: QuizItem): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'insertQuizItem',
    supabase.from('quiz_items').insert({
      id: item.id,
      unit_id: item.unit_id || _unitId,
      entry_ids: item.entry_ids,
      kind: item.kind,
      format: item.format,
      payload: item.payload,
      source: item.source,
      status: item.status,
      created_by: item.created_by ?? null,
    }),
  );
}

/** 문항 수정 — 0행이면 사장이 고친 내용이 조용히 원복되므로 writeStrict(updateEntry 와 같은 이유). */
export async function updateQuizItem(id: string, patch: Partial<QuizItem>): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const { id: _drop, unit_id: _drop2, created_at: _drop3, ...rest } = patch as any;
  return writeStrict(
    'updateQuizItem',
    supabase
      .from('quiz_items')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
  );
}

export async function deleteQuizItem(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteQuizItem', supabase.from('quiz_items').delete().eq('id', id).select('id'));
}

// ── 훈련 코스(0108) — 0099 의 'first_day'|'regular' 문자열을 대체하는 매장 소유 코스 ──────
// 읽기는 매장 전원(직원 훈련 카드가 코스 이름을 쓴다), 쓰기는 관리 권한(RLS tc_*).
const TRAINING_COURSE_COLS =
  'id, unit_id, key, name, description, preset, min_items, max_items, due_days, position, active, created_at';

export async function fetchTrainingCourses(): Promise<DbResult<TrainingCourseRow[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.from('training_courses').select(TRAINING_COURSE_COLS).order('position');
  if (error) readFail('fetchTrainingCourses', error);
  return { data: (data as TrainingCourseRow[] | null) ?? null, error: error as DbErr };
}

/** 코스 생성·수정. 충돌 기준은 (unit_id, key) — 같은 프리셋을 두 번 눌러도 한 행이다(멱등).
 *  ⚠️ 이미 있는 key 에 다른 id 를 넘기면 PK 를 바꾸려다 training_items FK 에 걸려 실패한다(의도:
 *     조용히 다른 코스를 만들지 않는다). 수정은 fetch 한 행의 id 를 그대로 실어 보낼 것. */
export async function upsertTrainingCourse(c: TrainingCourseRow): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict(
    'upsertTrainingCourse',
    supabase
      .from('training_courses')
      .upsert(
        {
          id: c.id,
          unit_id: c.unit_id || _unitId,
          key: c.key,
          name: c.name,
          description: c.description ?? null,
          preset: c.preset ?? null,
          min_items: c.min_items,
          max_items: c.max_items,
          due_days: c.due_days ?? null,
          position: c.position,
          active: c.active,
        },
        { onConflict: 'unit_id,key' },
      )
      .select('id'),
  );
}

/** 코스 삭제 — 담긴 코스 항목(course_entries)도 함께 사라진다(0111 FK cascade).
 *  노하우·통과 기록은 남는다. course_entries 는 "무엇이 담겼나"의 연결행일 뿐이다. */
export async function deleteTrainingCourse(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict('deleteTrainingCourse', supabase.from('training_courses').delete().eq('id', id).select('id'));
}

// ── 응시 단위 점수(0112) — `김민지 · 3문제 중 2개 · 8월 4일` ────────────────
// 행 단위 = (응시 1회, 노하우 1건). 문항별로 무엇을 틀렸는지는 저장하지 않는다(기획 §4.1).
export type QuizAttemptRow = {
  id: string;
  entryId: string;
  /** 로그인 직원이면 uid, 외부 링크 손님이면 null. */
  staffId: string | null;
  /** 외부 링크 손님이면 이름, 직원이면 null. */
  guestName: string | null;
  total: number;
  correct: number;
  takenAt: string;
};
/** 활성 매장의 응시 기록 — 관리 권한은 전체, 직원은 본인 것만(RLS qa_select). */
export async function fetchQuizAttempts(): Promise<QuizAttemptRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('id, entry_id, staff_id, guest_name, total, correct, taken_at')
    .order('taken_at', { ascending: false })
    .limit(200);
  if (error) {
    readFail('fetchQuizAttempts', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id, entryId: r.entry_id, staffId: r.staff_id ?? null, guestName: r.guest_name ?? null,
    total: r.total ?? 0, correct: r.correct ?? 0, takenAt: r.taken_at ?? '',
  }));
}
/** 응시 기록 남기기(직원 본인). id·staff_id·taken_at 은 DB default 가 채운다.
 *  기록 실패가 응시 UX 를 막으면 안 되므로 호출부는 fire-and-forget 으로 쓴다. */
export async function insertQuizAttempts(rows: { entryId: string; total: number; correct: number }[]): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const usable = rows.filter((r) => r.total > 0);
  if (usable.length === 0) return true;
  // getUser() 는 서버 왕복이라 네트워크가 흔들리면 기록이 조용히 사라진다 — 로컬 세션에서 읽는다.
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id ?? null;
  if (!uid) {
    reportError('db.write:insertQuizAttempts', { message: 'no session' });
    return false;
  }
  return write(
    'insertQuizAttempts',
    supabase.from('quiz_attempts').insert(
      usable.map((r) => ({ unit_id: _unitId, entry_id: r.entryId, staff_id: uid, total: r.total, correct: r.correct })),
    ),
  );
}

// ── 외부 공유 링크(0113) — 단기 직원용. 로그인 없이 도는 유일한 경로 ────────────
export type QuizLinkRow = {
  id: string;
  courseId: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};
/** 이 매장의 링크 전체(관리 권한만 — RLS ql_select). 만료·회수 판정은 화면이 한다. */
export async function fetchQuizLinks(): Promise<QuizLinkRow[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('quiz_links')
    .select('id, course_id, token, expires_at, revoked_at, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    readFail('fetchQuizLinks', error);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id, courseId: r.course_id, token: r.token,
    expiresAt: r.expires_at, revokedAt: r.revoked_at ?? null, createdAt: r.created_at,
  }));
}
export async function insertQuizLink(row: QuizLinkRow): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict(
    'insertQuizLink',
    supabase
      .from('quiz_links')
      .insert({
        id: row.id, unit_id: _unitId, course_id: row.courseId,
        token: row.token, expires_at: row.expiresAt,
      })
      .select('id'),
  );
}
/** 회수 — 지우지 않고 revoked_at 을 찍는다(누가 언제 뭘 내보냈는지가 남아야 한다). */
export async function revokeQuizLink(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return writeStrict(
    'revokeQuizLink',
    supabase.from('quiz_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id'),
  );
}

// ── 손님(비로그인) 응시 경로 — 전부 definer RPC. 테이블 직접 접근은 0행이다 ────
/**
 * ★failed 와 ok=false 를 구분한다. 둘을 뭉뚱그리면 **장애가 "만료된 링크"로 위장**되고,
 * 손님은 멀쩡한 링크를 두고 사장에게 새 링크를 달라고 하게 된다(읽기 실패의 정상화면 위장).
 *   failed = 우리 쪽 문제(네트워크·서버) → "잠시 후 다시" · ok=false = 링크가 닫힘 → "다시 받아 주세요"
 */
export type QuizLinkInfo = { ok: boolean; failed: boolean; storeName: string; courseName: string; itemCount: number };
export async function openQuizLink(token: string): Promise<QuizLinkInfo> {
  if (!HAS_SUPABASE) return { ok: false, failed: true, storeName: '', courseName: '', itemCount: 0 };
  const { data, error } = await supabase.rpc('quiz_link_open', { p_token: token });
  if (error) {
    reportError('db.rpc:openQuizLink', error);
    return { ok: false, failed: true, storeName: '', courseName: '', itemCount: 0 };
  }
  const row = (Array.isArray(data) ? data[0] : data) as any;
  return {
    ok: !!row?.ok,
    failed: false,
    storeName: row?.store_name ?? '',
    courseName: row?.course_name ?? '',
    itemCount: row?.item_count ?? 0,
  };
}
/** 응시용 문항(정답 제거본) — 그 링크의 코스에 담긴 노하우 문항만. */
export async function fetchQuizLinkItems(token: string, limit = 5): Promise<DbResult<QuizItem[]>> {
  if (!HAS_SUPABASE) return { data: [], error: null };
  const { data, error } = await supabase.rpc('quiz_link_items', { p_token: token, p_limit: limit });
  if (error) {
    reportError('db.rpc:fetchQuizLinkItems', error);
    return { data: null, error: error as DbErr };
  }
  return {
    data: ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      unit_id: '',
      entry_ids: (r.entry_ids as string[]) ?? [],
      kind: r.kind,
      format: r.format,
      payload: (r.payload as Record<string, any>) ?? {},
      source: 'ai' as const,
      status: 'active' as const,
    })),
    error: null,
  };
}
/** 토큰 채점 — 판정 본체는 로그인 경로와 같은 함수(quiz_grade_item)다. */
export async function gradeQuizLink(token: string, itemId: string, response: QuizResponse): Promise<DbResult<QuizGrade>> {
  if (!HAS_SUPABASE) return { data: null, error: { message: 'no_backend' } };
  const { data, error } = await supabase.rpc('quiz_link_grade', { p_token: token, p_item_id: itemId, p_response: response });
  if (error) {
    reportError('db.rpc:gradeQuizLink', error);
    return { data: null, error: error as DbErr };
  }
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row) return { data: null, error: { message: 'grade_quiz_empty' } };
  return { data: { correct: !!row.correct, explain: row.explain ?? '', answer: row.answer ?? null }, error: null };
}
/** 결과 기록(손님) — quiz_attempts 에 guest_name 으로. 노하우별로 나눠 적는다. */
export async function submitQuizLink(
  token: string,
  guestName: string,
  rows: { entryId: string; total: number; correct: number }[],
): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const usable = rows.filter((r) => r.total > 0);
  if (usable.length === 0) return true;
  return write(
    'submitQuizLink',
    supabase.rpc('quiz_link_submit', {
      p_token: token,
      p_guest_name: guestName,
      p_rows: usable.map((r) => ({ entry_id: r.entryId, total: r.total, correct: r.correct })),
    }),
  );
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
/** 전 매장 동시 공지(S3 #3): 소유 매장들에 같은 공지를 한 번에. 소유검증·본문 구성은 RPC 내부(definer). 반환=broadcast_id+발송 매장 수. */
export async function broadcastNotice(unitIds: string[], text: string, important: boolean): Promise<DbResult<{ broadcast_id: string; sent: number }>> {
  if (!HAS_SUPABASE) return { data: { broadcast_id: 'mock', sent: unitIds.length }, error: null };
  const { data, error } = await supabase.rpc('broadcast_notice', { p_units: unitIds, p_text: text, p_important: important });
  return { data: (data?.[0] as { broadcast_id: string; sent: number }) ?? null, error: error as DbErr };
}
/** 다중발송 공지의 매장 단위 읽음 집계("읽은 매장 / 전체 매장"). 소유 매장만 집계(definer). */
export async function fetchBroadcastReadStatus(broadcastId: string): Promise<DbResult<{ total: number; read_count: number }>> {
  if (!HAS_SUPABASE) return { data: { total: 1, read_count: 0 }, error: null };
  const { data, error } = await supabase.rpc('broadcast_read_status', { p_broadcast_id: broadcastId });
  return { data: (data?.[0] as { total: number; read_count: number }) ?? null, error: error as DbErr };
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
  // 급여 규칙=돈 직결. 0093: 매니저도 저장 가능 — units 직접 update(units_write=사장 전용 유지)가 아니라
  // save_payroll_settings RPC(auth_can_manage 게이트·payroll_settings 한 컬럼만)로 쓴다.
  // RPC 는 권한 거부를 예외로 던지므로(0행 무음 없음) write 경유로 실패가 그대로 드러난다.
  return write('savePayrollSettings', supabase.rpc('save_payroll_settings', { p_settings: settings }));
}

// ── 업무보드/출퇴근 Realtime 구독 ─────────────────────────
export function subscribeWork(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel(uniqueChannel('work'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_feed' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_done' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_templates' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_template_knowhow' }, onChange)
    // 0111 publication 멤버(AGENTS.md ⑤) — 직원이 통과하면 사장 배지가 즉시 바뀐다.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'knowhow_understanding' }, onChange)
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

// ── 노하우 커스텀 카테고리(0096) — 매장 공유 설정 schedule_config.knowhow_categories(jsonb) ──
// 해석/정리는 knowhowCategories.ts(resolve/sanitize)가 SSOT — 여기서는 원시 jsonb만 나른다.
export async function fetchKnowhowCategories(): Promise<unknown> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('schedule_config')
    .select('knowhow_categories')
    .maybeSingle();
  if (error) {
    readFail('fetchKnowhowCategories', error);
    return [];
  }
  return data?.knowhow_categories ?? [];
}

export async function saveKnowhowCategories(cats: CustomCategory[]): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'saveKnowhowCategories',
    supabase.from('schedule_config').upsert({
      unit_id: _unitId,
      knowhow_categories: cats,
      updated_at: new Date().toISOString(),
    }),
  );
}

// ── 정기 훈련 재확인 주기(0100) — 매장 공유 설정 schedule_config.regular_due_days ──
export async function fetchRegularDueDays(): Promise<number | null> {
  if (!HAS_SUPABASE) return null;
  const { data, error } = await supabase.from('schedule_config').select('regular_due_days').maybeSingle();
  if (error) {
    readFail('fetchRegularDueDays', error);
    return null;
  }
  return typeof data?.regular_due_days === 'number' ? data.regular_due_days : null;
}
export async function saveRegularDueDays(days: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'saveRegularDueDays',
    supabase.from('schedule_config').upsert({
      unit_id: _unitId,
      regular_due_days: days,
      updated_at: new Date().toISOString(),
    }),
  );
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

// 행→SwapRequest 매핑 SSOT — fetchSwaps(활성 매장)와 fetchCrossStoreNotifData(0077)가 공유.
function mapSwapRow(r: any): SwapRequest {
  return {
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
  } as SwapRequest;
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
  return (data ?? []).map(mapSwapRow);
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
