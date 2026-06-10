import { create } from 'zustand';
import { todayStr, minutesBetween } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchAttendance, upsertAttendance, deleteAttendance, subscribeAttendance } from '@/lib/db';

export type AttendanceRecord = {
  id: string;
  staff_id: string;
  date: string; // YYYY-MM-DD
  check_in: string | null; // ISO
  check_out: string | null; // ISO
  work_minutes: number;
};

/** 직원별 시급 (mock) — 데이터 연결 단계에서 프로필로 이관 */
export const HOURLY_WAGE: Record<string, number> = {
  u_staff_001: 10030, // 박지원
  u_staff_002: 10500, // 이수민
};

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
  /** 사장 수동 보정: 직원·날짜의 출퇴근 시간을 직접 설정(없으면 생성, 있으면 갱신). 시간은 "HH:MM". */
  upsertManual: (staffId: string, date: string, cin: string, cout: string | null) => void;
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
    const rec: AttendanceRecord = { id: `att_${staffId}_${Date.now()}`, staff_id: staffId, date, check_in: now, check_out: null, work_minutes: 0 };
    set((s) => ({ records: [rec, ...s.records] }));
    void upsertAttendance(rec);
  },
  checkOut: (staffId) => {
    const date = todayStr();
    let updated: AttendanceRecord | undefined;
    set((s) => ({
      records: s.records.map((r) => {
        if (r.staff_id === staffId && r.date === date && r.check_in && !r.check_out) {
          const out = new Date().toISOString();
          updated = { ...r, check_out: out, work_minutes: minutesBetween(r.check_in, out) };
          return updated;
        }
        return r;
      }),
    }));
    if (updated) void upsertAttendance(updated);
  },
  upsertManual: (staffId, date, cin, cout) => {
    const check_in = iso(date, cin);
    const check_out = cout ? iso(date, cout) : null;
    const work_minutes = check_out ? minutesBetween(check_in, check_out) : 0;
    let saved: AttendanceRecord | undefined;
    set((s) => {
      const existing = s.records.find((r) => r.staff_id === staffId && r.date === date);
      if (existing) {
        saved = { ...existing, check_in, check_out, work_minutes };
        const next = saved;
        return { records: s.records.map((r) => (r.staff_id === staffId && r.date === date ? next : r)) };
      }
      saved = { id: `att_${staffId}_${date}_manual`, staff_id: staffId, date, check_in, check_out, work_minutes };
      return { records: [saved, ...s.records] };
    });
    if (saved) void upsertAttendance(saved);
  },
  removeRecord: (id) => {
    set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
    void deleteAttendance(id);
  },
  applyMock: (demo) => set({ records: demo ? seed : [], loaded: true }),
}));
