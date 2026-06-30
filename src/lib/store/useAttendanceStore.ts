import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { todayStr, minutesBetween, nowISO } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchAttendance, upsertAttendance, deleteAttendance, subscribeAttendance } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';

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

function iso(date: string, time: string): string {
  return nowISO(date, time); // KST 벽시계 → 표준 UTC ISO (직접 "+09:00" 조립 금지)
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
  /**
   * 수동 보정: 출퇴근 시간을 직접 설정. 시간은 "HH:MM". editedBy로 보정 주체 표시.
   * recordId를 주면 그 기록 한 건만 정확히 갱신(다회근무 같은 날 오인 방지), 없으면 새 기록 생성.
   */
  upsertManual: (staffId: string, date: string, cin: string, cout: string | null, editedBy?: 'staff' | 'owner', recordId?: string) => void;
  /** 출근 기록 삭제(잘못 찍힌 기록 정리) */
  removeRecord: (id: string) => void;
  applyMock: (demo: boolean) => void;
};

export const useAttendanceStore = create<State>((set, get) => ({
  records: HAS_SUPABASE ? [] : seed,
  loaded: !HAS_SUPABASE,
  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    set({ records: await fetchAttendance(), loaded: true });
  }),
  subscribe: () => subscribeDebounced(subscribeAttendance, () => get().hydrate()),

  checkIn: (staffId) => {
    const date = todayStr();
    // 다회 출퇴근: 열린(미퇴근) 기록이 없을 때만 새 출근 생성
    const hasOpen = get().records.some(
      (r) => r.staff_id === staffId && r.date === date && r.check_in && !r.check_out,
    );
    if (hasOpen) return;
    const now = new Date().toISOString();
    const rec: AttendanceRecord = { id: genId(`att_${staffId}`), staff_id: staffId, date, check_in: now, check_out: null, work_minutes: 0 };
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
  upsertManual: (staffId, date, cin, cout, editedBy = 'owner', recordId) => {
    const check_in = iso(date, cin);
    const check_out = cout ? iso(date, cout) : null;
    const work_minutes = check_out ? minutesBetween(check_in, check_out) : 0;
    let saved: AttendanceRecord | undefined;
    let before: AttendanceRecord | undefined;
    let wasNew = false;
    set((s) => {
      // 기존 기록 보정은 recordId로 그 한 건만 타깃 — 같은 날 기록이 여러 개(다회근무)여도 오인하지 않는다.
      const existing = recordId ? s.records.find((r) => r.id === recordId) : undefined;
      if (existing) {
        before = existing;
        saved = { ...existing, check_in, check_out, work_minutes, edited_by: editedBy };
        const next = saved;
        return { records: s.records.map((r) => (r.id === recordId ? next : r)) };
      }
      wasNew = true;
      // 새 기록은 genId()로 유일 id 부여(같은 날 여러 기록 공존 허용 + 자동 펀치 id와 충돌 방지).
      saved = { id: genId(`att_${staffId}`), staff_id: staffId, date, check_in, check_out, work_minutes, edited_by: editedBy };
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
