import { create } from 'zustand';
import { todayStr, minutesBetween } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchAttendance, upsertAttendance, deleteAttendance, subscribeAttendance } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';

export type AttendanceRecord = {
  id: string;
  staff_id: string;
  date: string; // YYYY-MM-DD
  check_in: string | null; // ISO
  check_out: string | null; // ISO
  work_minutes: number;
  // 수기 보정 주체(0006 마이그레이션 컬럼). 직원 보정 시 사장 화면에 '직원 수정' 배지. 자동 펀치는 null.
  edited_by?: 'staff' | 'owner' | null;
};

/** 직원별 시급 (mock) — 데이터 연결 단계에서 프로필로 이관 */
export const HOURLY_WAGE: Record<string, number> = {
  u_staff_001: 10030, // 박지원
  u_staff_002: 10500, // 이수민
};

// 충돌 방지 id — 같은 ms에 두 번 호출돼도 카운터로 유일성 보장(Date.now() 단독은 충돌 가능).
let _seq = 0;
function uid(): string {
  return `${Date.now()}_${_seq++}`;
}

function iso(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

function rec(staff: string, date: string, cin: string, cout: string): AttendanceRecord {
  const check_in = iso(date, cin);
  const check_out = iso(date, cout);
  return {
    id: `att_${staff}_${date}`,
    staff_id: staff,
    date,
    check_in,
    check_out,
    work_minutes: minutesBetween(check_in, check_out),
  };
}

const seed: AttendanceRecord[] = [
  rec('u_staff_001', '2026-06-09', '12:00', '18:05'),
  rec('u_staff_001', '2026-06-07', '12:00', '18:00'),
  rec('u_staff_001', '2026-06-05', '12:00', '17:50'),
  rec('u_staff_002', '2026-06-09', '07:00', '13:10'),
  rec('u_staff_002', '2026-06-08', '07:00', '13:00'),
  rec('u_staff_002', '2026-06-06', '07:00', '13:05'),
];

type State = {
  records: AttendanceRecord[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  checkIn: (staffId: string) => void;
  checkOut: (staffId: string) => void;
  /** 수동 보정: 직원·날짜의 출퇴근 시간을 직접 설정(없으면 생성, 있으면 갱신). 시간은 "HH:MM". editedBy로 보정 주체 표시. */
  upsertManual: (staffId: string, date: string, cin: string, cout: string | null, editedBy?: 'staff' | 'owner') => void;
  /** 출근 기록 삭제(잘못 찍힌 기록 정리) */
  removeRecord: (id: string) => void;
  applyMock: (demo: boolean) => void;
};

export const useAttendanceStore = create<State>((set, get) => ({
  records: HAS_SUPABASE ? [] : seed,
  loaded: !HAS_SUPABASE,
  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ records: await fetchAttendance(), loaded: true });
  },
  subscribe: () => subscribeAttendance(() => get().hydrate()),

  checkIn: (staffId) => {
    const date = todayStr();
    // 다회 출퇴근: 열린(미퇴근) 기록이 없을 때만 새 출근 생성
    const hasOpen = get().records.some(
      (r) => r.staff_id === staffId && r.date === date && r.check_in && !r.check_out,
    );
    if (hasOpen) return;
    const now = new Date().toISOString();
    const rec: AttendanceRecord = { id: `att_${staffId}_${uid()}`, staff_id: staffId, date, check_in: now, check_out: null, work_minutes: 0 };
    set((s) => ({ records: [rec, ...s.records] }));
    void guardWrite(
      upsertAttendance(rec),
      () => set((s) => ({ records: s.records.filter((r) => r.id !== rec.id) })),
      '출근 기록 저장에 실패했어요. 다시 시도해 주세요.',
    );
  },
  checkOut: (staffId) => {
    const date = todayStr();
    let before: AttendanceRecord | undefined;
    let updated: AttendanceRecord | undefined;
    set((s) => ({
      records: s.records.map((r) => {
        if (r.staff_id === staffId && r.date === date && r.check_in && !r.check_out) {
          before = r;
          const out = new Date().toISOString();
          updated = { ...r, check_out: out, work_minutes: minutesBetween(r.check_in, out) };
          return updated;
        }
        return r;
      }),
    }));
    if (updated)
      void guardWrite(
        upsertAttendance(updated),
        () => before && set((s) => ({ records: s.records.map((r) => (r.id === before!.id ? before! : r)) })),
        '퇴근 기록 저장에 실패했어요. 다시 시도해 주세요.',
      );
  },
  upsertManual: (staffId, date, cin, cout, editedBy = 'owner') => {
    const check_in = iso(date, cin);
    const check_out = cout ? iso(date, cout) : null;
    const work_minutes = check_out ? minutesBetween(check_in, check_out) : 0;
    let saved: AttendanceRecord | undefined;
    let before: AttendanceRecord | undefined;
    let wasNew = false;
    set((s) => {
      const existing = s.records.find((r) => r.staff_id === staffId && r.date === date);
      if (existing) {
        before = existing;
        saved = { ...existing, check_in, check_out, work_minutes, edited_by: editedBy };
        const next = saved;
        return { records: s.records.map((r) => (r.staff_id === staffId && r.date === date ? next : r)) };
      }
      wasNew = true;
      saved = { id: `att_${staffId}_${date}_manual`, staff_id: staffId, date, check_in, check_out, work_minutes, edited_by: editedBy };
      return { records: [saved, ...s.records] };
    });
    // edited_by 포함해 영속(0006 마이그레이션 컬럼). 자동 펀치는 edited_by 없음 → null.
    if (saved)
      void guardWrite(
        upsertAttendance(saved),
        () =>
          set((s) =>
            wasNew
              ? { records: s.records.filter((r) => r.id !== saved!.id) }
              : { records: s.records.map((r) => (r.id === before!.id ? before! : r)) },
          ),
        '근무 시간 보정 저장에 실패했어요.',
      );
  },
  removeRecord: (id) => {
    const idx = get().records.findIndex((r) => r.id === id);
    const removed = idx >= 0 ? get().records[idx] : undefined;
    set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
    void guardWrite(
      deleteAttendance(id),
      () =>
        removed &&
        set((s) => {
          const next = s.records.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return { records: next };
        }),
      '기록 삭제에 실패했어요.',
    );
  },
  applyMock: (demo) => set({ records: demo ? seed : [], loaded: true }),
}));
