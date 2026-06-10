import { create } from 'zustand';
import { HOURLY_WAGE } from '@/lib/store/useAttendanceStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchWages, setWageDb } from '@/lib/db';

export type PayrollSettings = {
  breakDeduction: boolean; // 휴게시간 공제 (4h당 30분 무급)
  nightAllowance: boolean; // 야간수당 (22~06시 1.5배)
  overtimeAllowance: boolean; // 연장수당 (1일 8h 초과)
  weeklyHolidayPay: boolean; // 주휴수당 (주 15h+ 개근)
  extraAllowance: number; // 추가수당 (월 정액, 원)
  periodStartDay: number; // 정산 시작일
  payday: number; // 급여일
};

type State = {
  settings: PayrollSettings;
  wages: Record<string, number>;
  hydrate: () => Promise<void>;
  setSetting: <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => void;
  setWage: (staffId: string, wage: number) => void;
};

export const usePayrollStore = create<State>((set) => ({
  settings: {
    breakDeduction: true,
    nightAllowance: true,
    overtimeAllowance: false,
    weeklyHolidayPay: true,
    extraAllowance: 0,
    periodStartDay: 1,
    payday: 10,
  },
  // 시급은 DB(wages 테이블). Supabase면 빈 채로 시작 → hydrate가 채움. 설정은 1차 로컬 유지.
  wages: HAS_SUPABASE ? {} : { ...HOURLY_WAGE },
  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ wages: await fetchWages() });
  },
  setSetting: (k, v) => set((s) => ({ settings: { ...s.settings, [k]: v } })),
  setWage: (staffId, wage) => {
    set((s) => ({ wages: { ...s.wages, [staffId]: wage } }));
    void setWageDb(staffId, wage);
  },
}));
