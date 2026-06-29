// 근무표 스토어 — 가게 기본정보(운영시간·휴무) + 직원 주간 시프트 + 교대(주고받기) 요청.
// 흐름: 직원이 교대 요청(대타/맞교환) → 다른 직원이 수락 → 사장이 최종 컨펌(승인/반려).
//
// 영속: Supabase(schedule_config·shift_templates·swap_requests, 0016 마이그레이션) + RLS로 매장 격리.
// 다른 스토어와 동일 패턴 — 낙관적 업데이트 후 guardWrite로 DB 반영, 실패 시 롤백, Realtime로 재수화.
// HAS_SUPABASE=false면 데모 시드(store_001)로 폴백해 프론트가 끊기지 않는다.
import { create } from 'zustand';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchScheduleConfig,
  upsertScheduleConfig,
  fetchShiftTemplates,
  insertShiftTemplate,
  updateShiftTemplate,
  deleteShiftTemplate,
  saveStaffShifts,
  fetchSwaps,
  insertSwap,
  updateSwap,
  subscribeSchedule,
} from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { optimisticAdd, optimisticPatch, optimisticRemove } from '@/lib/store/crudHelpers';
import { genId } from '@/lib/utils/id';
import { todayStr } from '@/lib/utils/attendance';
import { weekdayOf, nextDateForWeekday } from '@/lib/utils/schedule';

// ── 타입 ────────────────────────────────────────────────
export type StoreConfig = {
  open: string; // "07:00"
  close: string; // "22:00"
  closedDays: number[]; // 정기휴무 요일 0(일)~6(토)
  note: string; // 비고(임시휴무·브레이크타임 등)
};

export type ShiftTemplate = {
  id: string;
  staff_id: string;
  weekday: number; // 0=일~6=토
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
  loaded: boolean;

  hydrate: () => Promise<void>;
  subscribe: () => () => void;

  setConfig: (patch: Partial<StoreConfig>) => void;
  addTemplate: (t: Omit<ShiftTemplate, 'id'>) => void;
  updateTemplate: (id: string, patch: Partial<Omit<ShiftTemplate, 'id'>>) => void;
  removeTemplate: (id: string) => void;
  /** 한 직원의 주간 시프트를 통째로 교체(근무표 편집 저장). */
  replaceStaffTemplates: (staffId: string, shifts: Omit<ShiftTemplate, 'id' | 'staff_id'>[]) => void;

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
      start: '07:00',
      end: '13:00',
    })),
    // 박지원(오후) — 화·목·토·일 12:00~18:00
    ...[2, 4, 6, 0].map((wd) => ({
      id: `tpl_jiwon_${wd}`,
      staff_id: 'u_staff_001',
      weekday: wd,
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

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const [config, templates, swaps] = await Promise.all([
      fetchScheduleConfig(),
      fetchShiftTemplates(),
      fetchSwaps(),
    ]);
    set({ config: config ?? DEFAULT_CONFIG, templates, swaps, loaded: true });
  },
  subscribe: () => subscribeSchedule(() => get().hydrate()),

  setConfig: (patch) => {
    const before = get().config;
    const next = { ...before, ...patch };
    set({ config: next });
    void guardWrite(
      upsertScheduleConfig(next),
      () => set({ config: before }),
      '가게 정보 저장에 실패했어요. 다시 시도해 주세요.',
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
  replaceStaffTemplates: (staffId, shifts) => {
    const prevAll = get().templates;
    const prevForStaff = prevAll.filter((t) => t.staff_id === staffId);
    // 같은 요일이 유지되면 기존 id 재사용 → 그 시프트를 참조하던 교대 요청이 깨지지 않는다.
    const nextForStaff: ShiftTemplate[] = shifts.map((sh) => {
      const keep = prevForStaff.find((p) => p.weekday === sh.weekday);
      return { ...sh, staff_id: staffId, id: keep?.id ?? genId('tpl') };
    });
    const nextAll = [...prevAll.filter((t) => t.staff_id !== staffId), ...nextForStaff];
    // 실제로 없어진 시프트만 삭제 대상(나머지는 id 재사용 upsert → 참조 중인 교대 요청 보존).
    const removeIds = prevForStaff.filter((p) => !nextForStaff.some((n) => n.id === p.id)).map((p) => p.id);
    set({ templates: nextAll });
    void guardWrite(
      saveStaffShifts(staffId, nextForStaff, removeIds),
      () => set({ templates: prevAll }),
      '근무표 저장에 실패했어요. 다시 시도해 주세요.',
    );
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
    void guardWrite(
      insertSwap(req),
      () => set((s) => ({ swaps: s.swaps.filter((r) => r.id !== req.id) })),
      '교대 요청 등록에 실패했어요. 다시 시도해 주세요.',
    );
  },
  acceptSwap: (id, byStaffId) => {
    const before = get().swaps.find((r) => r.id === id);
    // 본인이 올린 요청은 본인이 수락할 수 없다. 열린 상태에서만 수락 가능.
    if (!before || before.status !== 'open' || before.requester_id === byStaffId) return;
    const updated: SwapRequest = { ...before, status: 'accepted', accepted_by: byStaffId, updated_at: nowIso() };
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? updated : r)) }));
    void guardWrite(
      updateSwap(id, { status: 'accepted', accepted_by: byStaffId, updated_at: updated.updated_at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 수락 저장에 실패했어요.',
    );
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
    void guardWrite(
      updateSwap(id, { status: 'approved', updated_at: at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 승인 저장에 실패했어요.',
    );
  },
  rejectSwap: (id) => {
    const before = get().swaps.find((r) => r.id === id);
    if (!before || before.status !== 'accepted') return;
    const at = nowIso();
    set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? { ...r, status: 'rejected', updated_at: at } : r)) }));
    void guardWrite(
      updateSwap(id, { status: 'rejected', updated_at: at }),
      () => set((s) => ({ swaps: s.swaps.map((r) => (r.id === id ? before : r)) })),
      '교대 반려 저장에 실패했어요.',
    );
  },
}));

// ── 셀렉터/해석 헬퍼 ─────────────────────────────────────

export type ResolvedShift = {
  template: ShiftTemplate;
  baseStaffId: string; // 원래 담당
  workerStaffId: string; // 실제 근무자(승인된 교대 반영)
  pending: boolean; // 진행 중인 교대 요청이 걸려 있나
};

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
    .filter((t) => t.weekday === wd)
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
