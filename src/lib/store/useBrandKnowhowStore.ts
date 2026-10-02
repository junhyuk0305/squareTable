// useBrandKnowhowStore.ts — 본사 노하우 화면 상태(작업실 원본 + 배포 현황). realtime 없음(정본 §6-3).
//
// ★핵심 전제: **작업실이 활성 매장이어야 한다.** 노하우 저작·조회는 매장 앱과 같은 서버 경로를 쓰고
//   (정본 §4-B) 그 RLS 가 `unit_id = auth_unit_id()` 라서, 활성 매장이 작업실이 아니면
//   `fetchEntries()` 가 **조용히 0행**을 준다. 그래서 hydrate 의 첫 줄이 `enterBrandWorkspace()` 다
//   (0215 · 멱등). 겸직 담당자가 '내 매장으로' 갔다 돌아오는 왕복도 이 한 줄로 복구된다.
//
// 재료가 셋인 이유:
//   entries — 작업실 원본 본문(편집기가 쓴다). RLS 경로라 db.ts 그대로.
//   list    — 표 재료(배포 매장 수·배포 버전). 사본은 다른 매장의 행이라 정의자 RPC 로만 센다.
//   matrix  — 교차표 칸(노하우 × 매장 상태). 사본이 없는 칸은 행이 없다 = 미배포.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import { fetchEntries } from '@/lib/db';
import {
  enterBrandWorkspace,
  fetchBrandKnowhow,
  fetchBrandDeployMatrix,
  deployBrandEntries,
  type BrandKnowhowRow,
  type BrandDeployCell,
  type BrandDeployResult,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { reportError } from '@/lib/analytics/track';
import type { PlaybookEntry } from '@/types';

type State = {
  /** 작업실 unit id — 편집기가 새 노하우의 `unit_id` 로 쓴다. null 이면 아직 못 들어갔다. */
  wsUnitId: string | null;
  entries: PlaybookEntry[];
  list: BrandKnowhowRow[];
  matrix: BrandDeployCell[];
  /** 첫 조회가 끝났나(실패해도 선다 — 화면은 error 로 갈린다. 메모리 feedback_screen_ready_gate). */
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 배포 — 성공하면 결과 격자를 돌려주고 스스로 재조회한다. */
  /** required=true 면 직영 대상에 '필수'가 걸린다(0225). 가맹 대상은 말없이 건너뛴다 — 거부가 아니다. */
  deploy: (entryIds: string[], unitIds: string[], required?: boolean) => Promise<{ data: BrandDeployResult[] | null; error: string | null }>;
  reset: () => void;
};

const EMPTY = { wsUnitId: null, entries: [], list: [], matrix: [], loaded: false, error: null } satisfies Pick<
  State,
  'wsUnitId' | 'entries' | 'list' | 'matrix' | 'loaded' | 'error'
>;

export const useBrandKnowhowStore = create<State>((set, get) => {
  const hydrate = coalesce(async () => {
    const ws = await enterBrandWorkspace();
    if (ws.error || !ws.data) {
      reportError('brandKnowhow.enterWorkspace', ws.error ?? { message: 'no_workspace' });
      // 작업실이 없으면 노하우 축 전체가 못 선다 — 빈 표로 위장하지 않고 이유를 말한다.
      set({ loaded: true, error: brandErrorMessage(ws.error) });
      return;
    }
    const [e, l, m] = await Promise.all([fetchEntries(), fetchBrandKnowhow(), fetchBrandDeployMatrix()]);
    const err = l.error ?? m.error;
    if (e.error || err) {
      if (err) reportError('brandKnowhow.hydrate', err);
      // 부분 실패도 실패다(useBrandStore 와 같은 규칙) — 반만 채운 표가 '정상'으로 보이는 게 더 위험하다.
      set({ wsUnitId: ws.data, loaded: true, error: brandErrorMessage(err, '노하우를 불러오지 못했어요.') });
      return;
    }
    set({
      wsUnitId: ws.data,
      // 편집기는 초안도 이어서 손봐야 한다(증분 저장 = structureDoc 체크포인트) → 발행본만 걸러내지 않는다.
      entries: e.data ?? [],
      list: l.data ?? [],
      matrix: m.data ?? [],
      loaded: true,
      error: null,
    });
  });

  return {
    ...EMPTY,
    hydrate,
    refresh: hydrate,
    deploy: async (entryIds, unitIds, required = false) => {
      const r = await deployBrandEntries(entryIds, unitIds, required);
      if (r.error) {
        reportError('brandKnowhow.deploy', r.error);
        return { data: null, error: brandErrorMessage(r.error, '배포하지 못했어요.') };
      }
      await get().refresh();
      return { data: r.data ?? [], error: null };
    },
    reset: () => set({ ...EMPTY }),
  };
});
