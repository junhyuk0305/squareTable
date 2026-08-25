// 근무표 스토어 — 가게 기본정보(운영시간·휴무) + 직원 주간 시프트 + 교대(주고받기) 요청.
// 흐름: 직원이 교대 요청(대타/맞교환) → 다른 직원이 수락 → 사장이 최종 컨펌(승인/반려).
//
// 영속: Supabase(schedule_config·shift_templates·swap_requests, 0016 마이그레이션) + RLS로 매장 격리.
// 다른 스토어와 동일 패턴 — 낙관적 업데이트 후 guardWrite로 DB 반영, 실패 시 롤백, Realtime로 재수화.
// HAS_SUPABASE=false면 데모 시드(store_001)로 폴백해 프론트가 끊기지 않는다.
import { create } from 'zustand';
import { newRoutine, resolveDayparts, type Daypart } from '@/lib/store/daypartLabels';
import { routineSeedForIndustry } from '@/data/industryRoutines';
import { coalesce, subscribeDebounced, settleWithin, HYDRATE_TIMEOUT_MS } from '@/lib/store/realtimeSync';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchScheduleConfig,
  upsertScheduleConfig,
  fetchShiftTemplates,
  insertShiftTemplate,
  updateShiftTemplate,
  deleteShiftTemplate,
  fetchSwaps,
  insertSwap,
  updateSwap,
  subscribeSchedule,
} from '@/lib/db';
import { guardWrite, useSyncStore } from '@/lib/store/useSyncStore';
import { optimisticAdd, optimisticPatch, optimisticRemove } from '@/lib/store/crudHelpers';
import { genId } from '@/lib/utils/id';
import { todayStr } from '@/lib/utils/attendance';
import { weekdayOf, nextDateForWeekday, fmtDateKo } from '@/lib/utils/schedule';
import {
  notifyStaffSwapRequest,
  notifyUserSwapRequest,
  notifyOwnersSwapApproval,
  notifyUserSwapResult,
} from '@/lib/push/notify';

// ── 타입 ────────────────────────────────────────────────
export type StoreConfig = {
  open: string; // "07:00"
  close: string; // "22:00"
  closedDays: number[]; // 정기휴무 요일 0(일)~6(토)
  note: string; // 비고(임시휴무·브레이크타임 등)
  /** 업무 시간대 카테고리(매장별) + 카테고리별 기본 루틴 업무. 없으면 기본 4개(오픈/미들/마감/기타). */
  dayparts?: Daypart[];
};

/**
 * 근무 한 칸. 0138부터 **요일 반복이거나 날짜 지정이거나 둘 중 하나**다(DB CHECK가 강제).
 *  · weekday=3, date=null        → 매주 수요일 반복
 *  · weekday=null, date='2026-08-12' → 그 날짜 하루만(대타·행사·단기)
 */
export type ShiftTemplate = {
  id: string;
  staff_id: string;
  weekday: number | null; // 0=일~6=토. 날짜 지정이면 null
  date: string | null; // YYYY-MM-DD. 요일 반복이면 null
  start: string; // "12:00"
  end: string; // "18:00"
};

export type SwapKind = 'cover' | 'swap'; // 대타(넘기기) / 맞교환
export type SwapStatus = 'open' | 'accepted' | 'approved' | 'rejected' | 'cancelled';

export type SwapRequest = {
  id: string;
  kind: SwapKind;
  requester_id: string;
  date: string; // 내가 빠지는 근무 날짜 YYYY-MM-DD
  template_id: string; // 내가 내보내는 시프트(요일 템플릿)
  // 맞교환이면 상대가 줄 시프트
  target_staff_id?: string; // swap: 지정 상대 / cover: 비움(누구나)
  target_date?: string;
  target_template_id?: string;
  note: string;
  status: SwapStatus;
  accepted_by?: string; // 수락한 직원
  created_at: string;
  updated_at: string;
};

type ScheduleState = {
  config: StoreConfig;
  templates: ShiftTemplate[];
  swaps: SwapRequest[];
  /** true = 조회 **시도가 끝남**(성공·실패 무관). 실패 여부는 loadError 로 본다. */
  loaded: boolean;
  /** 마지막 hydrate 가 실패했는가 — 화면이 "예정된 근무 없음"과 "못 불러옴"을 구분한다(#44). */
  loadError: boolean;
  /** ★운영설정(config) **전용** 실패 플래그(#48). 조회 실패와 "행 없음(신규 매장)"이 둘 다 null 이던 탓에
   *  폼이 09:00~22:00·연중무휴를 사실인 양 띄우고 저장 버튼까지 살아 있었고, 누르면 **서버의 실제
   *  운영시간·정기휴무·비고가 기본값으로 덮여 사라졌다.** true 면 화면이 폼을 아예 띄우지 않는다. */
  configLoadError: boolean;

  hydrate: () => Promise<void>;
  /** 재시도 — 실패 화면의 '다시 시도' 버튼이 부르는 경로. */
  retry: () => Promise<void>;
  subscribe: () => () => void;

  /** 매장 운영 설정 저장. **서버 반영 성공 여부를 돌려준다** — 호출부가 성공 토스트를 확인 뒤로 미룰 수 있게. */
  setConfig: (patch: Partial<StoreConfig>) => Promise<boolean>;
  addTemplate: (t: Omit<ShiftTemplate, 'id'>) => void;
  updateTemplate: (id: string, patch: Partial<Omit<ShiftTemplate, 'id'>>) => void;
  removeTemplate: (id: string) => void;

  requestSwap: (input: {
    kind: SwapKind;
    requester_id: string;
    date: string;
    template_id: string;
    target_staff_id?: string;
    target_date?: string;
    target_template_id?: string;
    note: string;
  }) => void;
  acceptSwap: (id: string, byStaffId: string) => void;
  cancelSwap: (id: string) => void; // 요청자 취소
  approveSwap: (id: string) => void; // 사장 승인
  rejectSwap: (id: string) => void; // 사장 반려
};

// ── 유일 id ─────────────────────────────────────────────
const nowIso = () => new Date().toISOString();

// ── 기본/시드 ───────────────────────────────────────────
const DEFAULT_CONFIG: StoreConfig = { open: '09:00', close: '22:00', closedDays: [], note: '' };

/**
 * 온보딩 1회: 업종 기본 루틴 선주입(콜드스타트 슬라이스 A).
 * 신규 매장의 day-1 "오늘 할일"이 비지 않도록 카페 팩 업종에 오픈/마감 루틴을 심는다.
 * 가드: 어느 데이파트든 루틴이 하나라도 있으면 no-op — 기존 매장 설정을 절대 덮지 않는다(멱등).
 * 스토어 상태는 건드리지 않는다(온보딩 시점엔 미수화) — 매장 앱 진입 시 hydrate가 DB에서 읽는다.
 * 실패는 upsertScheduleConfig(write 헬퍼)가 표면화하며, 온보딩 완주를 막지 않는 비치명 실패다.
 */
export async function seedDaypartRoutines(industry: string | undefined): Promise<boolean> {
  if (!HAS_SUPABASE) return false;
  const seed = routineSeedForIndustry(industry);
  if (!seed) return false;
  const { data: config, error } = await fetchScheduleConfig();
  // 조회 실패면 시드하지 않는다 — 기존 설정을 못 본 채로 upsert 하면 실제 운영시간을 기본값으로 덮는다(#48).
  if (error) return false;
  const dayparts = resolveDayparts(config?.dayparts);
  if (dayparts.some((d) => d.routines.length > 0)) return false;
  const filled = dayparts.map((d) =>
    seed[d.id] ? { ...d, routines: seed[d.id].map((text) => ({ ...newRoutine(), text })) } : d,
  );
  return upsertScheduleConfig({ ...(config ?? DEFAULT_CONFIG), dayparts: filled });
}

// 데모 매장(store_001) 시드 — users.json의 두 직원 기준 주간 근무표. HAS_SUPABASE=false일 때만 사용.
function demoSeed(): { config: StoreConfig; templates: ShiftTemplate[]; swaps: SwapRequest[] } {
  const config: StoreConfig = {
    open: '07:00',
    close: '22:00',
    closedDays: [],
    note: '명절 당일 휴무 · 14~15시 브레이크',
  };
  const templates: ShiftTemplate[] = [
    // 이수민(오전 오픈) — 월~금 07:00~13:00
    ...[1, 2, 3, 4, 5].map((wd) => ({
      id: `tpl_sumin_${wd}`,
      staff_id: 'u_staff_002',
      weekday: wd,
      date: null,
      start: '07:00',
      end: '13:00',
    })),
    // 박지원(오후) — 화·목·토·일 12:00~18:00
    ...[2, 4, 6, 0].map((wd) => ({
      id: `tpl_jiwon_${wd}`,
      staff_id: 'u_staff_001',
      weekday: wd,
      date: null,
      start: '12:00',
      end: '18:00',
    })),
  ];
  // 데모용 열린 교대 요청 — 이수민이 다가오는 수요일 오전 대타를 구하는 중(누구나 수락 가능).
  const today = todayStr();
  const coverDate = nextDateForWeekday(today, 3); // 다가오는 수요일(이수민 근무일)
  const swaps: SwapRequest[] = [
    {
      id: 'swap_demo_1',
      kind: 'cover',
      requester_id: 'u_staff_002',
      date: coverDate,
      template_id: 'tpl_sumin_3',
      note: '이날 오전에 학교 시험이 있어서 대타 구해요 🙏',
      status: 'open',
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ];
  return { config, templates, swaps };
}

const SEED = HAS_SUPABASE ? null : demoSeed();

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  config: SEED?.config ?? DEFAULT_CONFIG,
  templates: SEED?.templates ?? [],
  swaps: SEED?.swaps ?? [],
  loaded: !HAS_SUPABASE,
  loadError: false,
  configLoadError: false,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    // ★throw 도 "시도가 끝났다"에 포함된다(2026-08-26 브라우저 실측). 아래 fetch 중 **하나라도**
    //   예외를 던지면 Promise.all 이 reject 되고 set 이 영영 실행되지 않아 loaded 가 false 로 남는다
    //   → 게이트가 **영구 스피너**가 된다. 계약을 값 반환 경로에만 걸면 계약이 아니다.
    try {
    // 정지(hang) 방지 — 위 try/catch 는 예외만 잡는다. 끝나지 않는 fetch 는 여기서 끊는다.
    const trio = await settleWithin(
      HYDRATE_TIMEOUT_MS,
      Promise.all([fetchScheduleConfig(), fetchShiftTemplates(), fetchSwaps()]),
      () => null,
    );
    if (trio === null) { set({ loaded: true, loadError: true, configLoadError: true }); return; }
    const [config, templates, swaps] = trio;
    // ★config 조회가 실패했으면 DEFAULT_CONFIG 로 덮지 않는다 — 직전 값을 유지하고 configLoadError 로
    //   말한다. 기본값을 실제 운영시간인 양 보여주는 것이 이 화면의 가장 비싼 거짓말이다(#48).
    //   config.data === null 이면서 error 가 아닌 경우만 "신규 매장"이라 기본값이 정당하다.
    set((s) => ({
      config: config.error ? s.config : (config.data ?? DEFAULT_CONFIG),
      templates: templates.error ? s.templates : templates.data,
      swaps: swaps.error ? s.swaps : swaps.data,
      loaded: true,
      loadError: config.error || templates.error || swaps.error,
      configLoadError: config.error,
    }));
    } catch (e) {
      console.warn('[schedule] hydrate threw:', e);
      set({ loaded: true, loadError: true, configLoadError: true });
    }
  }),
  retry: async () => {
    await get().hydrate();
  },
  subscribe: () => subscribeDebounced(subscribeSchedule, () => get().hydrate()),

  setConfig: (patch) => {
    // ★조회가 실패한 상태에서는 저장을 거부한다(#48). 이 upsert 는 config 전체를 쓰므로,
    //   못 불러온 값(=기본값)을 그대로 올리면 **서버의 실제 운영시간·정기휴무·비고가 지워진다.**
    if (get().configLoadError) {
      useSyncStore.getState().noteError('매장 정보를 불러오지 못해 저장할 수 없어요. 새로고침 후 다시 시도해 주세요.');
      return Promise.resolve(false);
    }
    const before = get().config;
    const next = { ...before, ...patch };
    set({ config: next });
    // 낙관적 반영은 그대로 두되 결과를 돌려준다 — 화면이 "저장됐어요"를 서버 확인 뒤에 띄우게 하기 위함.
    return guardWrite(
      upsertScheduleConfig(next),
      () => set({ config: before }),
      '매장 정보 저장에 실패했어요. 다시 시도해 주세요.',
    );
  },

  addTemplate: (t) => {
    const rec: ShiftTemplate = { ...t, id: genId('tpl') };
    optimisticAdd(set, 'templates', rec, () => insertShiftTemplate(rec), '근무 추가 저장에 실패했어요.');
  },
  updateTemplate: (id, patch) => {
    optimisticPatch(set, get, 'templates', id, patch, () => updateShiftTemplate(id, patch), '근무 수정 저장에 실패했어요.');
  },
  removeTemplate: (id) => {
    optimisticRemove(set, get, 'templates', id, () => deleteShiftTemplate(id), '근무 삭제에 실패했어요.');
  },
  requestSwap: (input) => {
    // 같은 시프트(날짜+템플릿)에 이미 진행 중(open/accepted) 요청이 있으면 중복 생성 차단.
    const dup = get().swaps.some(
      (r) =>
        (r.status === 'open' || r.status === 'accepted') &&
        r.template_id === input.template_id &&
        r.date === input.date,
    );
    if (dup) return;
    const now = nowIso();
    const req: SwapRequest = {
      id: genId('swap'),
      kind: input.kind,
      requester_id: input.requester_id,
      date: input.date,
      template_id: input.template_id,
      target_staff_id: input.target_staff_id,
      target_date: input.target_date,
      target_template_id: input.target_template_id,
      note: input.note,
      // 맞교환은 상대가 지정돼 있어도 상대의 수락이 필요 → open. 대타도 open(아무나 수락).
      status: 'open',
      created_at: now,
      updated_at: now,
    };
    set((s) => ({ swaps: [req, ...s.swaps] }));
    // 저장 성공 후에만 웹푸시(실패·롤백 시 유령 교대요청 알림 방지).
    //   맞교환(swap)은 지정 상대에게만, 대타(cover)는 매장 직원 전체(발송자 제외는 서버).
    void guardWrite(
      insertSwap(req),
      () => set((s) => ({ swaps: s.swaps.filter((r) => r.id !== req.id) })),
      '교대 요청 등록에 실패했어요. 다시 시도해 주세요.',
    ).then((ok) => {
      if (!ok) return;
      if (input.kind === 'swap' && input.target_staff_id) notifyUserSwapRequest(input.target_staff_id, fmtDateKo(input.date));
      else notifyStaffSwapRequest(fmtDateKo(input.date));
    });
  },
  acceptSwap: (id, byStaffId) => {
    const before = get().swaps.find((r) => r.id === id);
    // 본인이 올린 요청은 본인이 수락할 수 없다. 열린 상태에서만 수락 가능.
    if (!before || before.status !== 'open' || before.requester_id === byStaffId) return;
    const updated: SwapRequest = { ...before, status: 'accepted', accepted_by: byStaffId, updated_at: nowIso() };
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? updated : r)) }));
    // 저장 성공 후에만 사장에게 웹푸시(수락→최종 승인 필요). 실패·롤백 시 유령 알림 방지.
    void guardWrite(
      updateSwap(id, { status: 'accepted', accepted_by: byStaffId, updated_at: updated.updated_at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 수락 저장에 실패했어요.',
    ).then((ok) => { if (ok) notifyOwnersSwapApproval(fmtDateKo(before.date)); });
  },
  cancelSwap: (id) => {
    const before = get().swaps.find((r) => r.id === id);
    if (!before || (before.status !== 'open' && before.status !== 'accepted')) return;
    const at = nowIso();
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? { ...r, status: 'cancelled', updated_at: at } : r)) }));
    void guardWrite(
      updateSwap(id, { status: 'cancelled', updated_at: at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '요청 취소 저장에 실패했어요.',
    );
  },
  approveSwap: (id) => {
    const before = get().swaps.find((r) => r.id === id);
    if (!before || before.status !== 'accepted') return;
    const at = nowIso();
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? { ...r, status: 'approved', updated_at: at } : r)) }));
    // 저장 성공 후에만 요청 직원에게 결과 웹푸시(실패·롤백 시 유령 승인 알림 방지).
    void guardWrite(
      updateSwap(id, { status: 'approved', updated_at: at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 승인 저장에 실패했어요.',
    ).then((ok) => { if (ok) notifyUserSwapResult(before.requester_id, true, fmtDateKo(before.date)); });
  },
  rejectSwap: (id) => {
    const before = get().swaps.find((r) => r.id === id);
    if (!before || before.status !== 'accepted') return;
    const at = nowIso();
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? { ...r, status: 'rejected', updated_at: at } : r)) }));
    // 저장 성공 후에만 요청 직원에게 결과 웹푸시(실패·롤백 시 유령 반려 알림 방지).
    void guardWrite(
      updateSwap(id, { status: 'rejected', updated_at: at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 반려 저장에 실패했어요.',
    ).then((ok) => { if (ok) notifyUserSwapResult(before.requester_id, false, fmtDateKo(before.date)); });
  },
}));

// ── 셀렉터/해석 헬퍼 ─────────────────────────────────────

export type ResolvedShift = {
  template: ShiftTemplate;
  baseStaffId: string; // 원래 담당
  workerStaffId: string; // 실제 근무자(승인된 교대 반영)
  pending: boolean; // 진행 중인 교대 요청이 걸려 있나
};

/**
 * 사장 승인만 남은 교대 요청 — 직원끼리 합의(accepted)가 끝난 것. 지난 날짜는 승인 의미가 없어 제외.
 * ★근무표 화면과 사장 홈이 **같은 수**를 말해야 해서 판정은 여기 하나다(홈 '다음 행동' 1순위).
 */
export function pendingApprovals(swaps: SwapRequest[], today: string): SwapRequest[] {
  return swaps.filter((r) => r.status === 'accepted' && r.date >= today);
}

/** 특정 날짜에 발생하는 시프트들 — 승인된 교대는 근무자를 치환, 진행 중 교대는 pending 표시. */
export function shiftsOn(
  templates: ShiftTemplate[],
  swaps: SwapRequest[],
  date: string,
): ResolvedShift[] {
  const wd = weekdayOf(date);
  // 승인된 교대는 시간순(오래된→최신)으로 적용 → 같은 시프트가 연쇄로 양도돼도 '가장 최근 승인'이 이긴다.
  const approved = swaps
    .filter((s) => s.status === 'approved')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const live = swaps.filter((s) => s.status === 'open' || s.status === 'accepted');
  return templates
    // 날짜 지정 근무는 그 날짜에만, 요일 반복은 매주 그 요일에. 이 판정이 SSOT다(0138).
    .filter((t) => (t.date ? t.date === date : t.weekday === wd))
    .map((t) => {
      let worker = t.staff_id;
      for (const s of approved) {
        if (s.template_id === t.id && s.date === date && s.accepted_by) worker = s.accepted_by;
        if (s.kind === 'swap' && s.target_template_id === t.id && s.target_date === date)
          worker = s.requester_id;
      }
      const pending = live.some(
        (s) =>
          (s.template_id === t.id && s.date === date) ||
          (s.target_template_id === t.id && s.target_date === date),
      );
      return { template: t, baseStaffId: t.staff_id, workerStaffId: worker, pending };
    })
    .sort((a, b) => a.template.start.localeCompare(b.template.start));
}
