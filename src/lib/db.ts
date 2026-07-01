// lib/db.ts
// 데이터 접근 단일 계층. 스토어/화면은 여기만 호출하고 Supabase를 직접 모름.
// HAS_SUPABASE=false면 전부 no-op/빈배열 → 기존 로컬 시드 스토어로 자연 폴백(프론트 안 끊김).
//
// 행(row) ↔ TS 타입 매핑: 중첩 필드는 JSONB라 거의 그대로. snake_case 컬럼만 살짝 정리.

import { supabase, HAS_SUPABASE } from './supabase';
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
    return false;
  }
  return true;
}

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

// ── 직원/사장 프로필 (같은 매장) ───────────────────────────
// 실서비스: profiles에서 내 매장 동료를 읽어 직원/근태/급여 화면을 채운다.
export async function fetchStaffProfiles(): Promise<{ owner: Owner | null; staff: Junior[] }> {
  if (!HAS_SUPABASE) return { owner: null, staff: [] };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, phone_last4, avatar, bio, meta, created_at')
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[db] fetchStaffProfiles:', error.message);
    return { owner: null, staff: [] };
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
  return { owner, staff };
}

// 사장이 직원을 매장에서 내보낸다(소속 해제 + 퇴사자 스냅샷 보관). RPC = 사장만·같은 매장 junior만.
export async function removeStaffMember(staffId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const { error } = await supabase.rpc('remove_staff', { p_staff_id: staffId });
  if (error) {
    console.warn('[db] removeStaffMember:', error.message);
    return false;
  }
  return true;
}

// 퇴사 6개월 경과분 개인 기록 자동 정리(내 매장 범위). 사장 진입 시 기회적으로 1회 호출 — 실패해도 무해.
export async function purgeExpiredFormerStaff(): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.rpc('purge_expired_former_staff');
  if (error) console.warn('[db] purgeExpiredFormerStaff:', error.message);
}

// ── 합류 승인(남용 #2) ─────────────────────────────────────
// 우리 매장에 합류 '신청'한(pending_unit_id = 내 매장) 프로필 목록. RLS가 신청자만 통과시킨다.
export async function fetchPendingMembers(): Promise<{ id: string; name: string; phone_last4: string; created_at: string }[]> {
  if (!HAS_SUPABASE || !_unitId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, phone_last4, created_at')
    .eq('pending_unit_id', _unitId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[db] fetchPendingMembers:', error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name ?? '',
    phone_last4: r.phone_last4 ?? '',
    created_at: r.created_at ?? '',
  }));
}

// 사장이 신청자를 승인 → unit_id 부여(소속 확정). RPC가 '내 매장 신청자'만 통과시킨다.
export async function approveMember(uid: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('approveMember', supabase.rpc('approve_member', { p_uid: uid }));
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
    console.warn('[db] rotateInviteCode:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_code) return null;
  return { inviteCode: String(row.invite_code), expiresAt: String(row.invite_expires_at ?? '') };
}

// ── 플레이북 ───────────────────────────────────────────────
export async function fetchEntries(): Promise<PlaybookEntry[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('playbook_entries')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[db] fetchEntries:', error.message);
    return [];
  }
  return (data ?? []) as PlaybookEntry[];
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
  return write(
    'updateEntry',
    supabase
      .from('playbook_entries')
      .update({ ...stripNonColumns(patch), updated_at: new Date().toISOString() })
      .eq('id', id),
  );
}

export async function deleteEntry(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteEntry', supabase.from('playbook_entries').delete().eq('id', id));
}

// ── 노하우 제안/신청(알바 → 사장) ─────────────────────────
export async function fetchSuggestions(): Promise<PlaybookSuggestion[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('playbook_suggestions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[db] fetchSuggestions:', error.message);
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
  return write('reviewSuggestion', supabase.from('playbook_suggestions').update(patch).eq('id', id));
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
export async function fetchUnknownQueue(): Promise<UnknownQuery[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('unknown_queries')
    .select('*')
    .order('asked_at', { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) {
    console.warn('[db] fetchUnknownQueue:', error.message);
    return [];
  }
  return (data ?? []) as UnknownQuery[];
}

export async function insertUnknown(uq: UnknownQuery): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  const row = { ...uq, unit_id: (uq as any).unit_id || _unitId };
  return write('insertUnknown', supabase.from('unknown_queries').insert(row));
}

export async function bumpUnknownSimilar(id: string, count: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('bumpUnknownSimilar', supabase.from('unknown_queries').update({ similar_queries_count: count }).eq('id', id));
}

// 받은질문 상태 전이(보관/자동응답/대기로 되돌리기). status 컬럼만 갱신.
export async function updateUnknownStatus(id: string, status: UnknownQuery['status']): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('updateUnknownStatus', supabase.from('unknown_queries').update({ status }).eq('id', id));
}

export async function resolveUnknown(id: string, newEntryId: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write(
    'resolveUnknown',
    supabase
      .from('unknown_queries')
      .update({ status: 'resolved_with_entry', resolved_with_entry_id: newEntryId })
      .eq('id', id),
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
    console.warn('[db] fetchChatQueries:', error.message);
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
  return write('updateChatSatisfaction', supabase.from('chat_queries').update({ satisfaction: vote }).eq('id', id));
}

// 노하우 사용 통계 재계산 — 답변 서빙/평가가 "영속된 뒤" 영향받은 entry id들로 호출(fire-and-forget·비치명).
// 진실원천 chat_queries에서 30일 윈도우를 서버가 재평가해 playbook_entries.stats(query_hits_30d/
// resolution_rate/thumbs/last_used_at)를 통째 갱신한다 → 클라 카운터 경쟁·권한경계 훼손 없음.
// 0037_knowhow_usage_stats.sql 의 recompute_playbook_stats RPC. 미적용 환경이면 함수 부재로
// 에러가 나지만 답변 흐름과 무관하므로 조용히 경고만 남긴다(stats가 0으로 남을 뿐, 서빙은 정상).
export async function recomputePlaybookStats(entryIds: string[]): Promise<void> {
  if (!HAS_SUPABASE || !entryIds.length) return;
  const { error } = await supabase.rpc('recompute_playbook_stats', { p_entry_ids: entryIds });
  if (error) console.warn('[db] recomputePlaybookStats:', error.message);
}

// ── 사진 업로드(Storage) ───────────────────────────────────
// blob: URL은 같은 브라우저에서만 보임 → Storage에 올려 공개 URL로 영속·공유.
// Supabase 없으면 로컬 object URL을 그대로 반환(데모 폴백).
const PHOTO_BUCKET = 'playbook-photos';

// 업로드 전 이미지 압축(웹) — 폰 사진 수 MB를 긴 변 1600px·JPEG q0.8로 다운스케일해 스토리지·대역폭 절감.
// 비웹(document 없음)·비이미지·이미 작은 파일·실패 시 원본 그대로(업로드가 절대 안 깨지게).
async function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
  if (file.size < 600_000) return file; // 이미 작으면 스킵
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
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
    if (!blob || blob.size >= file.size) return file; // 압축 이득 없으면 원본
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
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
    upsert: false,
  });
  if (error) {
    console.warn('[db] uploadPhoto:', error.message);
    return null;
  }
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
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
    console.warn('[db] fetchRooms:', error.message);
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
    console.warn('[db] fetchRoomMembers:', error.message);
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
  return write('updateRoomName', supabase.from('work_rooms').update({ name }).eq('id', id));
}
export async function deleteRoom(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteRoom', supabase.from('work_rooms').delete().eq('id', id));
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
    console.warn('[db] fetchTemplates:', error.message);
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
export async function deleteTemplate(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteTemplate', supabase.from('work_templates').delete().eq('id', id));
}

// ── 업무보드: 완료 체크 ────────────────────────────────────
export async function fetchDone(): Promise<Record<string, Record<string, DoneMark>>> {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase.from('work_done').select('work_date, template_id, data');
  if (error) {
    console.warn('[db] fetchDone:', error.message);
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
  return write(
    'clearDone',
    supabase.from('work_done').delete().eq('unit_id', _unitId).eq('work_date', date).eq('template_id', templateId),
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
    console.warn('[db] fetchFeed:', error.message);
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
export async function deleteFeed(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteFeed', supabase.from('work_feed').delete().eq('id', id));
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
    console.warn('[db] fetchAttendance:', error.message);
    return [];
  }
  return (data ?? []) as AttendanceRecord[];
}
export async function upsertAttendance(rec: AttendanceRecord): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('upsertAttendance', supabase.from('attendance').upsert({ ...rec, unit_id: _unitId }));
}
export async function deleteAttendance(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteAttendance', supabase.from('attendance').delete().eq('id', id));
}

// ── 시급 ───────────────────────────────────────────────────
export async function fetchWages(): Promise<Record<string, number>> {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase.from('wages').select('staff_id, hourly_wage');
  if (error) {
    console.warn('[db] fetchWages:', error.message);
    return {};
  }
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) out[r.staff_id] = r.hourly_wage;
  return out;
}
export async function setWageDb(staffId: string, wage: number): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('setWageDb', supabase.from('wages').upsert({ unit_id: _unitId, staff_id: staffId, hourly_wage: wage }));
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
    .select('open, close, closed_days, note')
    .maybeSingle();
  if (error) {
    console.warn('[db] fetchScheduleConfig:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    open: data.open ?? '09:00',
    close: data.close ?? '22:00',
    closedDays: Array.isArray(data.closed_days) ? (data.closed_days as number[]) : [],
    note: data.note ?? '',
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
    console.warn('[db] fetchShiftTemplates:', error.message);
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
  return write('updateShiftTemplate', supabase.from('shift_templates').update(row).eq('id', id));
}

export async function deleteShiftTemplate(id: string): Promise<boolean> {
  if (!HAS_SUPABASE) return true;
  return write('deleteShiftTemplate', supabase.from('shift_templates').delete().eq('id', id));
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
  if (removeIds.length > 0) {
    const del = await write(
      'saveStaffShifts.delete',
      supabase.from('shift_templates').delete().in('id', removeIds),
    );
    if (!del) return false;
  }
  if (rows.length === 0) return true;
  return write('saveStaffShifts.upsert', supabase.from('shift_templates').upsert(rows.map(shiftRow)));
}

export async function fetchSwaps(): Promise<SwapRequest[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('swap_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[db] fetchSwaps:', error.message);
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
  return write('updateSwap', supabase.from('swap_requests').update(row).eq('id', id));
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
