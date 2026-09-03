// 근무표 스토어 — 가게 기본정보(운영시간·휴무) + 직원 주간 시프트 + 교대(주고받기) 요청.
// 흐름: 직원이 교대 요청(대타/맞교환) → 다른 직원이 수락 → 사장이 최종 컨펌(승인/반려).
//
// 영속: Supabase(schedule_config·shift_templates·swap_requests, 0016 마이그레이션) + RLS로 매장 격리.
// 다른 스토어와 동일 패턴 — 낙관적 업데이트 후 guardWrite로 DB 반영, 실패 시 롤백, Realtime로 재수화.
// HAS_SUPABASE=false면 데모 시드(store_001)로 폴백해 프론트가 끊기지 않는다.
import { create } from 'zustand';
import { type Daypart } from '@/lib/store/daypartLabels';
import { coalesce, subscribeDebounced, settleWithin, HYDRATE_TIMEOUT_MS } from '@/lib/store/realtimeSync';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchShiftExceptions,
  deleteShiftException,
  acceptSwapRpc,
  approveSwapRpc,
  updateMyShiftTime,
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

/**
 * "이 반복 근무는 이 날짜엔 없는 것으로 친다"(0178).
 * 요일 반복을 **하루만** 다르게 만드는 유일한 수단 — 부분 교대·하루 이전이 원본을 안 건드리게 한다.
 * ★shiftsOn 이 이걸 안 보면 그날 근무가 **두 벌**로 보인다(원본 반복 + 교대로 생긴 조각).
 */
export type ShiftException = { template_id: string; date: string };

export type SwapKind = 'cover' | 'swap'; // 대타(넘기기) / 맞교환
export type SwapStatus = 'open' | 'accepted' | 'approved' | 'rejected' | 'cancelled';

export type SwapRequest = {
  id: string;
  kind: SwapKind;
  requester_id: string;
  date: string; // 내가 빠지는 근무 날짜 YYYY-MM-DD
  template_id: string; // 내가 내보내는 시프트(요일 템플릿)
  // 맞교환이면 상대가 줄 시프트
  target_staff_id?: string; // swap: 지정 상대 / cover: 비움(누구나) — 레거시 단수(호환 유지)
  /** 지정 수신자 **목록**(0178). 여러 명에게 보내고 **먼저 수락한 사람**이 가져간다(선착순).
   *  비었으면 대타(누구나). 단수 target_staff_id 는 이 배열이 있으면 참고하지 않는다. */
  target_staff_ids?: string[];
  target_date?: string;
  target_template_id?: string;
  /** 넘기는 구간(0178). 둘 다 없으면 근무 전체 — 기존 동작 그대로. */
  part_start?: string;
  part_end?: string;
  note: string;
  status: SwapStatus;
  accepted_by?: string; // 수락한 직원
  created_at: string;
  updated_at: string;
};

type ScheduleState = {
  config: StoreConfig;
  templates: ShiftTemplate[];
  /** 그날 빠진 반복 근무(0178). shiftsOn 에 **반드시** 같이 넘긴다. */
  exceptions: ShiftException[];
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
    /** 지정 수신자 여럿(선착순). 비우면 대타(누구나). */
    target_staff_ids?: string[];
    target_date?: string;
    target_template_id?: string;
    /** 근무의 일부만 넘길 때의 구간. 둘 다 비우면 전체. */
    part_start?: string;
    part_end?: string;
    note: string;
  }) => void;
  /** 수락 — **선착순**이다. 서버가 선점하므로 실패하면 "이미 다른 분이 수락했어요"로 안내한다. */
  acceptSwap: (id: string, byStaffId: string) => void;
  cancelSwap: (id: string) => void; // 요청자 취소
  approveSwap: (id: string) => void; // 사장 승인 — 근무를 실제로 이전한다(0179)
  rejectSwap: (id: string) => void; // 사장 반려
  /** 직원이 **자기 근무의 시각만** 고친다(0178). 사장·매니저는 updateTemplate 를 쓴다. */
  editMyShiftTime: (id: string, start: string, end: string) => void;
  /** 그날 빼둔 반복 근무를 되돌린다(0178) — 쪼갠 근무표를 합치는 길. 관리자만. */
  restoreException: (templateId: string, date: string) => void;
};

// ── 유일 id ─────────────────────────────────────────────
const nowIso = () => new Date().toISOString();

// ── 기본/시드 ───────────────────────────────────────────
const DEFAULT_CONFIG: StoreConfig = { open: '09:00', close: '22:00', closedDays: [], note: '' };

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
  exceptions: [],
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
    const quad = await settleWithin(
      HYDRATE_TIMEOUT_MS,
      Promise.all([fetchScheduleConfig(), fetchShiftTemplates(), fetchSwaps(), fetchShiftExceptions()]),
      () => null,
    );
    if (quad === null) { set({ loaded: true, loadError: true, configLoadError: true }); return; }
    const [config, templates, swaps, exceptions] = quad;
    // ★config 조회가 실패했으면 DEFAULT_CONFIG 로 덮지 않는다 — 직전 값을 유지하고 configLoadError 로
    //   말한다. 기본값을 실제 운영시간인 양 보여주는 것이 이 화면의 가장 비싼 거짓말이다(#48).
    //   config.data === null 이면서 error 가 아닌 경우만 "신규 매장"이라 기본값이 정당하다.
    set((s) => ({
      config: config.error ? s.config : (config.data ?? DEFAULT_CONFIG),
      templates: templates.error ? s.templates : templates.data,
      swaps: swaps.error ? s.swaps : swaps.data,
      // ★예외를 못 읽었으면 직전 값을 유지한다 — 빈 배열로 덮으면 그날 근무가 두 벌로 보인다.
      exceptions: exceptions.error ? s.exceptions : exceptions.data,
      loaded: true,
      loadError: config.error || templates.error || swaps.error || exceptions.error,
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
      target_staff_ids: input.target_staff_ids,
      target_date: input.target_date,
      target_template_id: input.target_template_id,
      part_start: input.part_start,
      part_end: input.part_end,
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
      // ★지정 발송이면 **수신자 전원**에게. 한 명이라도 못 받으면 그 사람에겐 요청이 없는 것과 같다.
      const targets = input.target_staff_ids?.length
        ? input.target_staff_ids
        : input.target_staff_id
          ? [input.target_staff_id]
          : [];
      if (targets.length) targets.forEach((uid) => notifyUserSwapRequest(uid, fmtDateKo(input.date)));
      else notifyStaffSwapRequest(fmtDateKo(input.date));
    });
  },
  acceptSwap: (id, byStaffId) => {
    const before = get().swaps.find((r) => r.id === id);
    // 본인이 올린 요청은 본인이 수락할 수 없다. 열린 상태에서만 수락 가능.
    if (!before || before.status !== 'open' || before.requester_id === byStaffId) return;
    const updated: SwapRequest = { ...before, status: 'accepted', accepted_by: byStaffId, updated_at: nowIso() };
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? updated : r)) }));
    // ★선착순이다 — 두 명이 동시에 누르면 서버가 한 명만 통과시킨다(0179 accept_swap).
    //   RPC 가 false 를 주면 **내가 진 것**이다. 0행을 성공으로 치면 두 명 다 수락한 줄 안다.
    void guardWrite(
      acceptSwapRpc(id),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '이미 다른 분이 수락했어요. 목록을 새로 불러올게요.',
    ).then((ok) => { if (ok) notifyOwnersSwapApproval(fmtDateKo(before.date)); else void get().hydrate(); });
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
    // ★승인은 상태 변경 + 근무 **실제 이전**이 한 트랜잭션이다(0179 approve_swap).
    //   따로 쓰면 "승인은 됐는데 근무는 안 넘어간" 반쪽 상태가 남는다.
    //   이전 결과(새 날짜 지정 행·예외)는 스토어에 없으므로 성공하면 재수화한다.
    void guardWrite(
      approveSwapRpc(id),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 승인에 실패했어요. 그 근무가 아직 있는지 확인해 주세요.',
    ).then((ok) => {
      if (!ok) return;
      notifyUserSwapResult(before.requester_id, true, fmtDateKo(before.date));
      void get().hydrate();
    });
  },
  editMyShiftTime: (id, start, end) => {
    const before = get().templates.find((t) => t.id === id);
    if (!before) return;
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, start, end } : t)) }));
    void guardWrite(
      updateMyShiftTime(id, start, end),
      () => set((s) => ({ templates: s.templates.map((t) => (t.id === id ? before : t)) })),
      '근무 시간 수정에 실패했어요. 내 근무가 맞는지 확인해 주세요.',
    );
  },
  restoreException: (templateId, date) => {
    const before = get().exceptions;
    set({ exceptions: before.filter((e) => !(e.template_id === templateId && e.date === date)) });
    void guardWrite(
      deleteShiftException(templateId, date),
      () => set({ exceptions: before }),
      '되돌리기에 실패했어요.',
    );
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
  /** 그 근무를 서는 사람. ★2026-08-26부터 **템플릿 행의 담당자 그대로**다 —
   *  승인된 교대는 이제 행 자체를 옮기므로(0179) 여기서 다시 치환하지 않는다. */
  workerStaffId: string;
  pending: boolean; // 진행 중인 교대 요청이 걸려 있나
};

/**
 * 한 사람이 그 날짜들에 서기로 된 근무들 — **급여 계산의 입력**이다(급여 기준 = 근무표).
 * 판정은 shiftsOn 하나뿐이다: 교대로 옮겨진 근무·그날 빠진 반복이 여기에 그대로 반영된다.
 * ★이 함수를 안 쓰고 templates 를 직접 훑으면 **교대 결과가 급여에 안 잡혀 돈이 틀린 사람에게 간다.**
 */
export function scheduledShiftsFor(
  templates: ShiftTemplate[],
  swaps: SwapRequest[],
  exceptions: ShiftException[],
  staffId: string,
  dates: string[],
): { date: string; start: string; end: string }[] {
  const out: { date: string; start: string; end: string }[] = [];
  for (const d of dates) {
    for (const sh of shiftsOn(templates, swaps, d, exceptions)) {
      if (sh.workerStaffId === staffId) out.push({ date: d, start: sh.template.start, end: sh.template.end });
    }
  }
  return out;
}

/**
 * 이 요청을 수락할 수 있는 사람들. **null 이면 누구나**(전체 공개 대타).
 * 배열이 있으면 그게 정본이고, 없으면 레거시 단수 컬럼을 1인 목록으로 읽는다(0178).
 * ★서버 `accept_swap`(0179)과 **같은 규칙**이다 — 화면이 보여주는 것과 서버가 허용하는 것이
 *   어긋나면 "수락 버튼이 있는데 눌러도 안 되는" 무음 실패가 된다.
 */
export function swapTargets(r: SwapRequest): string[] | null {
  if (r.target_staff_ids?.length) return r.target_staff_ids;
  return r.target_staff_id ? [r.target_staff_id] : null;
}

/** 내가 지금 이 요청을 수락할 수 있나(열림·내 것 아님·지난 날짜 아님·지정 대상). */
export function canAcceptSwap(r: SwapRequest, me: string, today: string): boolean {
  if (r.status !== 'open' || r.requester_id === me || r.date < today) return false;
  const targets = swapTargets(r);
  return targets === null || targets.includes(me);
}

/**
 * 사장 승인만 남은 교대 요청 — 직원끼리 합의(accepted)가 끝난 것. 지난 날짜는 승인 의미가 없어 제외.
 * ★근무표 화면과 사장 홈이 **같은 수**를 말해야 해서 판정은 여기 하나다(홈 '다음 행동' 1순위).
 */
export function pendingApprovals(swaps: SwapRequest[], today: string): SwapRequest[] {
  return swaps.filter((r) => r.status === 'accepted' && r.date >= today);
}

/**
 * 특정 날짜에 발생하는 시프트들. 진행 중 교대는 pending 으로 표시한다.
 *
 * ★★2026-08-26 — **승인된 교대를 여기서 치환하지 않는다.**
 *   승인은 이제 근무 행 자체를 수락자에게 옮긴다(0179 approve_swap → transfer_shift).
 *   파생 치환을 남겨 두면 **담당자가 두 번 바뀐다**(이중 적용) — 화면도 급여도 함께 틀린다.
 *   대신 반드시 `exceptions` 를 받아 "그날 빠진 반복"을 걸러야 한다. 안 걸러내면 그날 근무가
 *   **두 벌**로 보인다(원본 반복 + 이전으로 생긴 날짜 지정 조각).
 *   서버측 짝은 `workers_at`(0179) — 같은 규칙이다.
 *
 * ⚠️ exceptions 는 **선택 인자가 아니다**. 기본값을 주면 호출부가 조용히 빠뜨려도 컴파일되고,
 *    그 화면만 근무가 두 벌로 보인다(이 프로젝트가 반복해서 밟은 무음 실패 유형).
 */
export function shiftsOn(
  templates: ShiftTemplate[],
  swaps: SwapRequest[],
  date: string,
  exceptions: ShiftException[],
): ResolvedShift[] {
  const wd = weekdayOf(date);
  const excluded = new Set(exceptions.filter((e) => e.date === date).map((e) => e.template_id));
  const live = swaps.filter((s) => s.status === 'open' || s.status === 'accepted');
  return templates
    // 날짜 지정 근무는 그 날짜에만, 요일 반복은 매주 그 요일에. 이 판정이 SSOT다(0138).
    .filter((t) => (t.date ? t.date === date : t.weekday === wd))
    // 예외는 **반복 행에만** 걸린다(날짜 지정 행은 그 자체가 하루다).
    .filter((t) => t.date !== null || !excluded.has(t.id))
    .map((t) => {
      const pending = live.some(
        (s) =>
          (s.template_id === t.id && s.date === date) ||
          (s.target_template_id === t.id && s.target_date === date),
      );
      return { template: t, workerStaffId: t.staff_id, pending };
    })
    .sort((a, b) => a.template.start.localeCompare(b.template.start));
}
