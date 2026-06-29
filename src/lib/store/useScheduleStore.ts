// 근무표 스토어 — 가게 기본정보(운영시간·휴무) + 직원 주간 시프트 + 교대(주고받기) 요청.
// 흐름: 직원이 교대 요청(대타/맞교환) → 다른 직원이 수락 → 사장이 최종 컨펌(승인/반려).
//
// 영속: 아직 전용 Supabase 테이블이 없어 기기 로컬(localStorage)에 매장 단위로 저장한다.
// (데모/파일럿용. 다른 스토어들이 쓰는 db.ts 연동은 후속 작업 — 같은 액션 시그니처라 이관 쉬움.)
import { create } from 'zustand';
import { useSessionStore } from '@/lib/store/useSessionStore';
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

  hydrateLocal: () => void;

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
let _seq = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${_seq++}`;
}

// ── 기본/시드 ───────────────────────────────────────────
const DEFAULT_CONFIG: StoreConfig = { open: '09:00', close: '22:00', closedDays: [], note: '' };

// 데모 매장(store_001) 시드 — users.json의 두 직원 기준 주간 근무표.
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
  // (기본 직원 신원인 박지원이 '내가 대신할게요'로 수락 → 사장 컨펌까지 한 흐름을 시연할 수 있도록 동료가 올린 것으로 둠.)
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  return { config, templates, swaps };
}

// ── localStorage 영속(매장 단위) ─────────────────────────
const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
const keyOf = (unitId: string) => `sqt.schedule.${unitId || 'default'}`;
let _unitId = '';

function persist(state: Pick<ScheduleState, 'config' | 'templates' | 'swaps'>) {
  if (!storage || !_unitId) return;
  try {
    storage.setItem(
      keyOf(_unitId),
      JSON.stringify({ config: state.config, templates: state.templates, swaps: state.swaps }),
    );
  } catch {
    /* 용량 초과 등은 무시(데모) */
  }
}

export const useScheduleStore = create<ScheduleState>((set, get) => {
  // set 후 자동 저장하는 래퍼.
  const save = () => persist(get());

  return {
    config: DEFAULT_CONFIG,
    templates: [],
    swaps: [],
    loaded: false,

    hydrateLocal: () => {
      const unitId = useSessionStore.getState().unitId;
      _unitId = unitId;
      // 1) 저장된 값이 있으면 그대로 복원.
      if (storage) {
        try {
          const raw = storage.getItem(keyOf(unitId));
          if (raw) {
            const parsed = JSON.parse(raw);
            set({
              config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
              templates: Array.isArray(parsed.templates) ? parsed.templates : [],
              swaps: Array.isArray(parsed.swaps) ? parsed.swaps : [],
              loaded: true,
            });
            return;
          }
        } catch {
          /* 파싱 실패 → 아래 시드로 폴백 */
        }
      }
      // 2) 첫 진입: 데모 매장이면 시드, 신규 매장이면 빈 근무표.
      if (unitId === 'store_001') {
        const seed = demoSeed();
        set({ ...seed, loaded: true });
        persist(seed);
      } else {
        set({ config: DEFAULT_CONFIG, templates: [], swaps: [], loaded: true });
      }
    },

    setConfig: (patch) => {
      set((s) => ({ config: { ...s.config, ...patch } }));
      save();
    },

    addTemplate: (t) => {
      set((s) => ({ templates: [...s.templates, { ...t, id: uid('tpl') }] }));
      save();
    },
    updateTemplate: (id, patch) => {
      set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      save();
    },
    removeTemplate: (id) => {
      set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
      save();
    },
    replaceStaffTemplates: (staffId, shifts) => {
      set((s) => {
        const prev = s.templates.filter((t) => t.staff_id === staffId);
        return {
          templates: [
            ...s.templates.filter((t) => t.staff_id !== staffId),
            // 같은 요일이 유지되면 기존 id를 재사용 → 그 시프트를 참조하던 교대 요청이 깨지지 않는다.
            ...shifts.map((sh) => {
              const keep = prev.find((p) => p.weekday === sh.weekday);
              return { ...sh, staff_id: staffId, id: keep?.id ?? uid('tpl') };
            }),
          ],
        };
      });
      save();
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
      const now = new Date().toISOString();
      const req: SwapRequest = {
        id: uid('swap'),
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
      save();
    },
    acceptSwap: (id, byStaffId) => {
      set((s) => ({
        swaps: s.swaps.map((r) =>
          // 본인이 올린 요청은 본인이 수락할 수 없다. 열린 상태에서만 수락 가능.
          r.id === id && r.status === 'open' && r.requester_id !== byStaffId
            ? { ...r, status: 'accepted', accepted_by: byStaffId, updated_at: new Date().toISOString() }
            : r,
        ),
      }));
      save();
    },
    cancelSwap: (id) => {
      set((s) => ({
        swaps: s.swaps.map((r) =>
          r.id === id && (r.status === 'open' || r.status === 'accepted')
            ? { ...r, status: 'cancelled', updated_at: new Date().toISOString() }
            : r,
        ),
      }));
      save();
    },
    approveSwap: (id) => {
      set((s) => ({
        swaps: s.swaps.map((r) =>
          r.id === id && r.status === 'accepted'
            ? { ...r, status: 'approved', updated_at: new Date().toISOString() }
            : r,
        ),
      }));
      save();
    },
    rejectSwap: (id) => {
      set((s) => ({
        swaps: s.swaps.map((r) =>
          r.id === id && r.status === 'accepted'
            ? { ...r, status: 'rejected', updated_at: new Date().toISOString() }
            : r,
        ),
      }));
      save();
    },
  };
});

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

/** 사장 컨펌 대기(직원이 수락 완료) 요청 수. */
export function pendingApprovalCount(swaps: SwapRequest[]): number {
  return swaps.filter((s) => s.status === 'accepted').length;
}
