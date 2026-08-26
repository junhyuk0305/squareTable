import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { todayStr, minutesBetween, nowISO, MAX_SHIFT_MIN, tsMs } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchAttendance, upsertAttendance, deleteAttendance, subscribeAttendance } from '@/lib/db';
import { guardWrite, useSyncStore } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import { addDays, isOvernight } from '@/lib/utils/schedule';

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
  /** true = 조회 **시도가 끝남**(성공·실패 무관). 실패 여부는 loadError 로 본다. */
  loaded: boolean;
  /** 마지막 hydrate 가 실패했는가 — 화면이 "아직 출근 전"과 "못 불러옴"을 구분한다.
   *  실패 상태에서는 출근/퇴근 쓰기를 막는다(판정 불가 상태에서 쓰면 이중 출근이 찍힌다). */
  loadError: boolean;
  hydrate: () => Promise<void>;
  /** 재시도 — 실패 화면의 '다시 시도' 버튼이 부르는 경로. */
  retry: () => Promise<void>;
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
  loadError: false,
  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const { data, error } = await fetchAttendance();
    // ★실패해도 loaded 는 올린다(시도는 끝났다). 대신 loadError 로 말한다 — 예전엔 실패가
    //   records=[] 로 위장돼 hasOpen 이 항상 false 였고, 화면이 "아직 출근 전이에요"를 말했다(#40).
    //   기존 records 는 유지한다 — 실패 때문에 근무 중 기록이 화면에서 사라지면 더 위험하다.
    set((s) => ({ records: error ? s.records : data, loaded: true, loadError: error }));
  }),
  retry: async () => {
    await get().hydrate();
  },
  subscribe: () => subscribeDebounced(subscribeAttendance, () => get().hydrate()),

  checkIn: (staffId) => {
    const date = todayStr();
    // ★하이드레이션 전 중복 출근 방지(P7 실측): 아래 중복 검사는 인메모리 records 만 본다.
    //    HAS_SUPABASE 일 때 초기값은 records=[] 이라 **하이드레이션 전에는 검사가 무조건 통과**한다 —
    //    근무 중인 직원이 새로고침 직후 누르면 이중 오픈이 찍히고 work_minutes 가 부풀어 급여가 왜곡된다.
    //    판정할 수 없는 상태에서는 쓰지 않는다. 무음 no-op 금지 — 왜 안 되는지 말한다.
    if (!get().loaded) {
      useSyncStore.getState().noteError('출근 기록을 불러오는 중이에요. 잠시 후 다시 눌러 주세요.');
      return;
    }
    // ★loaded 계약이 "시도가 끝났다"로 바뀌면서(2026-08-25) 위 게이트만으로는 **조회 실패**를 못 막는다.
    //   실패 시 records 가 낡았거나 비어 있어 아래 hasOpen 검사가 무의미해진다 — 판정할 수 없는
    //   상태에서는 쓰지 않는다는 원칙은 그대로다. 무음 no-op 금지.
    if (get().loadError) {
      useSyncStore.getState().noteError('출근 기록을 불러오지 못했어요. 연결을 확인하고 다시 눌러 주세요.');
      return;
    }
    // 다회 출퇴근: 열린(미퇴근) 기록이 없을 때만 새 출근 생성.
    // ⚠️ 날짜 무관하게 검사한다 — 어제 퇴근을 깜빡한 열린 기록이 있는데 오늘 또 출근을 찍으면
    //    이중 오픈(둘 다 미퇴근)이 되어 어제 기록이 24h로 부풀고 급여가 왜곡된다(F7). 먼저 퇴근시켜야.
    const hasOpen = get().records.some(
      (r) => r.staff_id === staffId && r.check_in && !r.check_out,
    );
    if (hasOpen) {
      useSyncStore.getState().noteError('이미 출근 중이에요. 먼저 퇴근을 눌러 주세요.');
      return;
    }
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
    // ⚠️ 열린 기록을 '오늘' 로 찾지 않는다 — 야간근무(예: 23:00 출근)가 자정을 넘기면 기록 date 는
    //    어제라, today 로 찾으면 퇴근이 조용히 무효화되고 기록이 영영 열린 채 24h 로 부푼다(F2).
    //    staff 의 '열린 기록'을 날짜 무관하게(가장 최근 출근 1건) 찾아 닫는다.
    // ★조회 실패 상태에서는 "열린 기록 없음"이 사실이 아니다 — 무음 return 하면 근무 중인 직원의
    //   퇴근이 조용히 삼켜지고 기록이 열린 채 24h 로 부푼다. 왜 안 되는지 말한다.
    if (get().loadError) {
      useSyncStore.getState().noteError('근태 기록을 불러오지 못했어요. 연결을 확인하고 다시 눌러 주세요.');
      return;
    }
    const open = get()
      .records.filter((r) => r.staff_id === staffId && r.check_in && !r.check_out)
      .sort((a, b) => tsMs(b.check_in!) - tsMs(a.check_in!))[0];
    if (!open) return;
    const out = new Date().toISOString();
    // 퇴근 깜빡으로 24h 초과 시 절상(남용 #12) — 자동 펀치가 비현실적 급여를 만들지 않게.
    const updated: AttendanceRecord = { ...open, check_out: out, work_minutes: Math.min(MAX_SHIFT_MIN, minutesBetween(open.check_in!, out)) };
    set((s) => ({ records: s.records.map((r) => (r.id === open.id ? updated : r)) }));
    void guardWrite(
      upsertAttendance(updated),
      () => set((s) => ({ records: s.records.map((r) => (r.id === open.id ? open : r)) })),
      '퇴근 기록 저장에 실패했어요. 다시 시도해 주세요.',
    );
  },
  upsertManual: (staffId, date, cin, cout, editedBy = 'owner', recordId) => {
    const check_in = iso(date, cin);
    // ★심야 근무(22:00 출근 → 02:00 퇴근)의 퇴근은 **다음 날**이다. 같은 날짜로 조립하면
    //   minutesBetween 이 음수를 0 으로 깎아 **근무 0분**이 조용히 저장된다(감사 #43).
    //   기록의 date(=근무일)는 출근일 그대로 둔다 — 급여의 날짜 귀속 규칙은 여기서 바꾸지 않는다.
    const check_out = cout ? iso(isOvernight(cin, cout) ? addDays(date, 1) : date, cout) : null;
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
        '근무 시간 수정 저장에 실패했어요.',
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
  applyMock: (demo) => set({ records: demo ? seed : [], loaded: true, loadError: false }),
}));
