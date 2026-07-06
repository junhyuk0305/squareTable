import { create } from 'zustand';
import { HOURLY_WAGE } from '@/lib/store/useAttendanceStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchWages, setWageDb } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';

export type PayrollSettings = {
  breakDeduction: boolean; // 휴게시간 공제 (4h당 30분 무급)
  nightAllowance: boolean; // 야간수당 (22~06시 1.5배)
  overtimeAllowance: boolean; // 연장수당 (1일 8h 초과)
  weeklyHolidayPay: boolean; // 주휴수당 (주 15h+ 개근)
  extraAllowance: number; // 추가수당 (월 정액, 원)
  periodStartDay: number; // 정산 시작일
  payday: number; // 급여일
};

// 급여 설정 로컬 영속(무음 실패 수정): 예전엔 setSetting이 메모리만 갱신 → 새로고침하면 조용히
// 기본값으로 되돌아가는데 토글은 바뀐 것처럼 보여 "저장된 줄" 착각했다. usePreferencesStore와 동일
// 패턴으로 localStorage에 저장한다(웹). 설정이 급여 계산에 실제 반영되는 단계에서 DB(매장 단위)로 승격 예정.
const SETTINGS_KEY = 'sqt.payroll_settings.v1';
const DEFAULT_SETTINGS: PayrollSettings = {
  breakDeduction: true,
  nightAllowance: true,
  overtimeAllowance: false,
  weeklyHolidayPay: true,
  extraAllowance: 0,
  periodStartDay: 1,
  payday: 10,
};
const settingsStorage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
function loadSettings(): PayrollSettings {
  try {
    const raw = settingsStorage?.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function persistSettings(s: PayrollSettings): void {
  try {
    settingsStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* noop — 저장 실패해도 메모리 값은 유지 */
  }
}

type State = {
  settings: PayrollSettings;
  wages: Record<string, number>;
  hydrate: () => Promise<void>;
  setSetting: <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => void;
  setWage: (staffId: string, wage: number) => void;
  applyMock: (demo: boolean) => void;
};

export const usePayrollStore = create<State>((set, get) => ({
  // 설정은 로컬 영속에서 복원(새로고침해도 유지). 시급은 DB(wages 테이블).
  settings: loadSettings(),
  wages: HAS_SUPABASE ? {} : { ...HOURLY_WAGE },
  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ wages: await fetchWages() });
  },
  setSetting: (k, v) =>
    set((s) => {
      const settings = { ...s.settings, [k]: v };
      persistSettings(settings); // 즉시 로컬 저장 → 새로고침 후에도 유지(무음 손실 방지)
      return { settings };
    }),
  setWage: (staffId, wage) => {
    const had = Object.prototype.hasOwnProperty.call(get().wages, staffId);
    const prev = get().wages[staffId];
    set((s) => ({ wages: { ...s.wages, [staffId]: wage } }));
    void guardWrite(
      setWageDb(staffId, wage),
      () =>
        set((s) => {
          const next = { ...s.wages };
          if (had) next[staffId] = prev;
          else delete next[staffId];
          return { wages: next };
        }),
      '시급 저장에 실패했어요.',
    );
  },
  applyMock: (demo) => set({ wages: demo ? { ...HOURLY_WAGE } : {} }),
}));
