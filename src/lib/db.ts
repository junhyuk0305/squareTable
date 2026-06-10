// lib/db.ts
// 데이터 접근 단일 계층. 스토어/화면은 여기만 호출하고 Supabase를 직접 모름.
// HAS_SUPABASE=false면 전부 no-op/빈배열 → 기존 로컬 시드 스토어로 자연 폴백(프론트 안 끊김).
//
// 행(row) ↔ TS 타입 매핑: 중첩 필드는 JSONB라 거의 그대로. snake_case 컬럼만 살짝 정리.

import { supabase, HAS_SUPABASE } from './supabase';
import type { PlaybookEntry, UnknownQuery, ChatQuery, Owner, Junior } from '@/types';
import type { TaskTemplate, FeedItem, DoneMark } from '@/lib/store/useWorkStore';
import type { AttendanceRecord } from '@/lib/store/useAttendanceStore';

// 현재 로그인 사용자의 unit_id (RLS가 어차피 막지만, INSERT 시 채워야 함)
let _unitId: string | null = null;
export function setUnitId(id: string | null) {
  _unitId = id;
}
export function getUnitId() {
  return _unitId;
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

export async function insertEntry(entry: PlaybookEntry): Promise<void> {
  if (!HAS_SUPABASE) return;
  const row = { ...entry, unit_id: entry.unit_id || _unitId };
  const { error } = await supabase.from('playbook_entries').insert(row);
  if (error) console.warn('[db] insertEntry:', error.message);
}

export async function updateEntry(id: string, patch: Partial<PlaybookEntry>): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase
    .from('playbook_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.warn('[db] updateEntry:', error.message);
}

export async function deleteEntry(id: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('playbook_entries').delete().eq('id', id);
  if (error) console.warn('[db] deleteEntry:', error.message);
}

// ── 미답변 큐(사장님 인박스) ───────────────────────────────
export async function fetchUnknownQueue(): Promise<UnknownQuery[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('unknown_queries')
    .select('*')
    .order('asked_at', { ascending: false });
  if (error) {
    console.warn('[db] fetchUnknownQueue:', error.message);
    return [];
  }
  return (data ?? []) as UnknownQuery[];
}

export async function insertUnknown(uq: UnknownQuery): Promise<void> {
  if (!HAS_SUPABASE) return;
  const row = { ...uq, unit_id: (uq as any).unit_id || _unitId };
  const { error } = await supabase.from('unknown_queries').insert(row);
  if (error) console.warn('[db] insertUnknown:', error.message);
}

export async function bumpUnknownSimilar(id: string, count: number): Promise<void> {
  if (!HAS_SUPABASE) return;
  await supabase.from('unknown_queries').update({ similar_queries_count: count }).eq('id', id);
}

export async function resolveUnknown(id: string, newEntryId: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase
    .from('unknown_queries')
    .update({ status: 'resolved_with_entry', resolved_with_entry_id: newEntryId })
    .eq('id', id);
  if (error) console.warn('[db] resolveUnknown:', error.message);
}

// ── 채팅 기록 ──────────────────────────────────────────────
export async function fetchChatQueries(juniorId: string): Promise<ChatQuery[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('chat_queries')
    .select('*')
    .eq('junior_id', juniorId)
    .order('asked_at', { ascending: true });
  if (error) {
    console.warn('[db] fetchChatQueries:', error.message);
    return [];
  }
  return (data ?? []) as ChatQuery[];
}

export async function insertChatQuery(cq: ChatQuery): Promise<void> {
  if (!HAS_SUPABASE) return;
  const row = { ...cq, unit_id: (cq as any).unit_id || _unitId };
  const { error } = await supabase.from('chat_queries').insert(row);
  if (error) console.warn('[db] insertChatQuery:', error.message);
}

export async function updateChatSatisfaction(id: string, vote: 'up' | 'down'): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('chat_queries').update({ satisfaction: vote }).eq('id', id);
  if (error) console.warn('[db] updateChatSatisfaction:', error.message);
}

// ── 사진 업로드(Storage) ───────────────────────────────────
// blob: URL은 같은 브라우저에서만 보임 → Storage에 올려 공개 URL로 영속·공유.
// Supabase 없으면 로컬 object URL을 그대로 반환(데모 폴백).
const PHOTO_BUCKET = 'playbook-photos';

export async function uploadPhoto(file: File): Promise<string | null> {
  if (!HAS_SUPABASE) {
    return typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
  }
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${_unitId ?? 'unknown'}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
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
    .channel('unknown_queue')
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
    .channel('playbook')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playbook_entries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

// ── 업무보드: 할일 템플릿 ──────────────────────────────────
export async function fetchTemplates(): Promise<TaskTemplate[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('work_templates').select('id, section, text').order('created_at');
  if (error) {
    console.warn('[db] fetchTemplates:', error.message);
    return [];
  }
  return (data ?? []) as TaskTemplate[];
}
export async function insertTemplate(t: TaskTemplate): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('work_templates').insert({ ...t, unit_id: _unitId });
  if (error) console.warn('[db] insertTemplate:', error.message);
}
export async function deleteTemplate(id: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('work_templates').delete().eq('id', id);
  if (error) console.warn('[db] deleteTemplate:', error.message);
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
export async function setDone(date: string, templateId: string, mark: DoneMark): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase
    .from('work_done')
    .upsert({ unit_id: _unitId, work_date: date, template_id: templateId, data: mark });
  if (error) console.warn('[db] setDone:', error.message);
}
export async function clearDone(date: string, templateId: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase
    .from('work_done')
    .delete()
    .eq('unit_id', _unitId)
    .eq('work_date', date)
    .eq('template_id', templateId);
  if (error) console.warn('[db] clearDone:', error.message);
}

// ── 업무보드: 피드(공지/메시지/완료) ──────────────────────
export async function fetchFeed(): Promise<FeedItem[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase.from('work_feed').select('data').order('created_at');
  if (error) {
    console.warn('[db] fetchFeed:', error.message);
    return [];
  }
  return (data ?? []).map((r: any) => r.data as FeedItem);
}
export async function upsertFeed(item: FeedItem): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase
    .from('work_feed')
    .upsert({ id: item.id, unit_id: _unitId, feed_date: item.date, data: item });
  if (error) console.warn('[db] upsertFeed:', error.message);
}
export async function deleteFeed(id: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('work_feed').delete().eq('id', id);
  if (error) console.warn('[db] deleteFeed:', error.message);
}

// ── 출퇴근 ─────────────────────────────────────────────────
export async function fetchAttendance(): Promise<AttendanceRecord[]> {
  if (!HAS_SUPABASE) return [];
  const { data, error } = await supabase
    .from('attendance')
    .select('id, staff_id, date, check_in, check_out, work_minutes')
    .order('date', { ascending: false });
  if (error) {
    console.warn('[db] fetchAttendance:', error.message);
    return [];
  }
  return (data ?? []) as AttendanceRecord[];
}
export async function upsertAttendance(rec: AttendanceRecord): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('attendance').upsert({ ...rec, unit_id: _unitId });
  if (error) console.warn('[db] upsertAttendance:', error.message);
}
export async function deleteAttendance(id: string): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('attendance').delete().eq('id', id);
  if (error) console.warn('[db] deleteAttendance:', error.message);
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
export async function setWageDb(staffId: string, wage: number): Promise<void> {
  if (!HAS_SUPABASE) return;
  const { error } = await supabase.from('wages').upsert({ unit_id: _unitId, staff_id: staffId, hourly_wage: wage });
  if (error) console.warn('[db] setWageDb:', error.message);
}

// ── 업무보드/출퇴근 Realtime 구독 ─────────────────────────
export function subscribeWork(onChange: () => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const ch = supabase
    .channel('work')
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
    .channel('attendance')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}
