import { create } from 'zustand';
import { HOURLY_WAGE } from '@/lib/store/useAttendanceStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchWages, setWageDb, fetchPayrollSettings, savePayrollSettings } from '@/lib/db';
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

// 급여 설정 영속: 매장 단위 DB(units.payroll_settings, 0054)가 진실원천 —
//   다른 기기/공동 사장에게도 동일하게 보이고, 급여 계산이 옛 규칙으로 어긋나지 않는다.
//   localStorage는 오프라인/부팅 시 즉시 복원용 빠른 캐시(하이드레이트가 DB로 덮어씀).
//   (예전엔 localStorage에만 저장 → 기기별 상이·무음 불일치. setWage와 달리 setSetting만 DB 미승격이었음.)
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
  /** 시급을 한 번이라도 받아왔나. false면 아직 모른다 — "안 정했다"가 아니다. */
  wagesLoaded: boolean;
  /**
   * 급여 설정을 DB에서 한 번이라도 확인했나. false면 지금 `settings` 는 **localStorage 캐시**다.
   * 이 플래그가 없어서 급여 설정 화면이 캐시 값으로 토글 4개와 정산일을 먼저 확정 표시한 뒤,
   * DB 값이 오면 스스로 뒤집혔다(사장이 그 사이 누르면 반대로 저장된다).
   */
  settingsLoaded: boolean;
  /** 마지막 시급 읽기가 실패했나. true면 화면은 금액을 만들면 안 된다([P7-#5]). */
  wagesLoadError: boolean;
  hydrate: () => Promise<void>;
  setSetting: <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => void;
  setWage: (staffId: string, wage: number) => void;
  applyMock: (demo: boolean) => void;
};

export const usePayrollStore = create<State>((set, get) => ({
  // 설정은 로컬 영속에서 복원(새로고침해도 유지). 시급은 DB(wages 테이블).
  settings: loadSettings(),
  wages: HAS_SUPABASE ? {} : { ...HOURLY_WAGE },
  // mock 은 시급이 상수로 주어지므로 처음부터 '읽어온 상태'다.
  wagesLoaded: !HAS_SUPABASE,
  settingsLoaded: !HAS_SUPABASE,
  wagesLoadError: false,
  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const [wageRes, dbSettings] = await Promise.all([fetchWages(), fetchPayrollSettings()]);
    // DB에 저장된 규칙이 있으면 그것이 진실원천(기본값 위에 병합). 없으면(초기 매장) 로컬 캐시 유지.
    set((s) => {
      const settings = dbSettings ? { ...DEFAULT_SETTINGS, ...(dbSettings as Partial<PayrollSettings>) } : s.settings;
      persistSettings(settings);
      // ★읽기 실패면 이전에 받아 둔 시급을 **덮어쓰지 않는다** — 빈 값으로 갈아치우면
      //   "안 정했다"로 보이고, 화면이 그걸 근거로 금액을 만든다([P7-#5]).
      // settingsLoaded 는 시급 읽기 성패와 무관하다 — 여기 왔다는 건 급여 설정 조회가 끝났다는 뜻이다.
      return wageRes.error
        ? { settings, settingsLoaded: true, wagesLoadError: true }
        : { wages: wageRes.data, settings, settingsLoaded: true, wagesLoaded: true, wagesLoadError: false };
    });
  },
  setSetting: (k, v) => {
    const before = get().settings;
    const settings = { ...before, [k]: v };
    set({ settings });
    persistSettings(settings); // 로컬 캐시 즉시 갱신(빠른 복원)
    if (!HAS_SUPABASE) return;
    // 매장 단위 DB(units.payroll_settings)에 승격 저장 — 실패 시 이전 값으로 롤백 + 배너(무음 불일치 방지).
    //   0행(사장 아님/RLS/경합)도 실패로 처리(savePayrollSettings=writeStrict).
    void guardWrite(
      savePayrollSettings(settings),
      () => { set({ settings: before }); persistSettings(before); },
      '급여 설정 저장에 실패했어요.',
    );
  },
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

/**
 * 시급 조회가 **끝났는가**(성공·실패 무관) — 화면의 로딩 게이트는 `wagesLoaded` 가 아니라 이걸 본다.
 *
 * ★`wagesLoaded` 는 "실제 시급을 손에 넣었나"라서 읽기 실패면 영영 false다([P7-#5] 의 의도 —
 *   실패했는데 금액을 만들면 안 된다). 그 플래그를 게이트에 그대로 쓰면 읽기 한 번 실패에
 *   **화면이 영영 스피너에 갇히고**, 정작 그 화면이 가진 "시급을 못 불러왔어요" 안내 분기는
 *   렌더될 기회를 잃는다. 기다리기의 끝(게이트)과 값의 유무(표시)는 다른 축이다.
 * 판정을 한 곳에만 둔다 — 화면마다 `wagesLoaded || wagesLoadError` 를 복제하지 않는다.
 */
export const useWagesSettled = () => usePayrollStore((s) => s.wagesLoaded || s.wagesLoadError);
