import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import type { PlaybookEntry } from '@/types';
import seedData from '@/data/playbook-entries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchEntries, insertEntry, updateEntry, deleteEntry, renameEntrySection, subscribePlaybook, fetchKnowhowCategories, saveKnowhowCategories } from '@/lib/db';
import {
  resolveCustomCategories,
  sanitizeCustomCategories,
  setCustomCategoryRegistry,
  type CustomCategory,
} from '@/lib/store/knowhowCategories';
import { optimisticAdd, optimisticPatch, optimisticRemove } from '@/lib/store/crudHelpers';
import { embedEntry } from '@/lib/ai/searchClient';

const seed = seedData as unknown as PlaybookEntry[];

type PlaybookState = {
  entries: PlaybookEntry[];
  loaded: boolean;
  loadError: boolean; // 마지막 hydrate가 실패했는가 — 화면이 "없음"과 "못 불러옴"을 구분해 재시도 UI를 띄운다.
  /** 매장 커스텀 카테고리(0096) — 기본 4종 외. getCategoryMeta 레지스트리와 동기 유지. */
  customCategories: CustomCategory[];
  /** ★카테고리 레지스트리 **전용** 실패 플래그(#21) — entries 축(loadError)과 분리한다.
   *  true 면 customCategories 를 신뢰할 수 없으므로 편집 진입·저장을 막는다(덮어쓰기 = 영구 삭제). */
  categoryLoadError: boolean;
  saveCustomCategories: (items: CustomCategory[]) => Promise<boolean>;
  /** 카테고리(section) 일괄 이동(개명·삭제→기타). bulk 1쿼리 — per-entry 재색인 없음. */
  renameSection: (from: string, to: string | null) => Promise<boolean>;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  add: (entry: PlaybookEntry) => Promise<boolean>;
  getById: (id: string) => PlaybookEntry | undefined;
  /** 수정 저장 — **서버 반영 성공 여부**를 돌려준다(#17). 하부 updateEntry 는 writeStrict 라
   *  0행(RLS·id 드리프트)을 제대로 잡는데, 예전엔 이 함수가 void 라 그 판정이 화면까지 못 올라왔다 —
   *  화면은 서버 결과와 무관하게 "수정 저장됨 (v3)"을 띄우고 1초 뒤 뒤로 갔다(publish 와 동형으로 맞춘다). */
  update: (id: string, patch: Partial<PlaybookEntry>) => Promise<boolean>;
  /** draft → published 확정(인수인계서 검수). 성공 여부를 돌려줘 발행 수·부분 실패를 정확히 센다. */
  publish: (id: string, patch?: Partial<PlaybookEntry>) => Promise<boolean>;
  remove: (id: string) => void;
  reset: () => void;
  applyMock: (demo: boolean) => void;
};

export const usePlaybookStore = create<PlaybookState>((set, get) => ({
  // Supabase면 빈 채로 시작 → hydrate가 DB로 채움. 아니면 기존 로컬 시드.
  entries: HAS_SUPABASE ? [] : seed,
  loaded: !HAS_SUPABASE,
  loadError: false,
  customCategories: [],
  categoryLoadError: false,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const [{ data, error }, rawCats] = await Promise.all([fetchEntries(), fetchKnowhowCategories()]);
    // ★레지스트리 조회가 실패하면 customCategories 를 **건드리지 않는다**(#21). 빈 배열로 덮으면
    //   카테고리 편집 화면이 "커스텀 0건"을 사실로 믿고, 저장 시 레지스트리를 통째로 덮어써
    //   커스텀 카테고리가 영구 삭제된다. 실패는 categoryLoadError 로 말하고 편집 진입을 막는다.
    if (rawCats.error) {
      set({ entries: data, loaded: true, loadError: error, categoryLoadError: true });
      return;
    }
    const customCategories = resolveCustomCategories(rawCats.data);
    setCustomCategoryRegistry(customCategories); // getCategoryMeta 인자 생략 호출부(대시보드 등)용
    set({ entries: data, loaded: true, loadError: error, customCategories, categoryLoadError: false });
  }),

  // 커스텀 카테고리 저장 — sanitize 후 DB 반영이 성공했을 때만 상태/레지스트리 갱신(실패 시 기존 유지).
  saveCustomCategories: async (items) => {
    // 레지스트리를 못 읽은 상태의 저장은 통째 덮어쓰기라 **영구 삭제**가 된다(#21). 거부한다.
    if (get().categoryLoadError) return false;
    const cleaned = sanitizeCustomCategories(items);
    const ok = await saveKnowhowCategories(cleaned);
    if (ok) {
      setCustomCategoryRegistry(cleaned);
      set({ customCategories: cleaned });
    }
    return ok;
  },

  // 카테고리 개명·삭제 — 서버 반영 성공 시에만 로컬 갱신(섹션은 색인 텍스트가 아니라 재색인 불요).
  renameSection: async (from, to) => {
    const ok = await renameEntrySection(from, to);
    if (ok) set((s) => ({ entries: s.entries.map((e) => (e.section === from ? { ...e, section: to } : e)) }));
    return ok;
  },

  // 다른 기기(사장님)가 노하우를 발행하면 실시간으로 다시 당겨온다.
  subscribe: () => subscribeDebounced(subscribePlaybook, () => get().hydrate()),

  add: async (entry) => {
    // 맨 앞에 추가(최신 우선). 실패 시 제거 롤백. ok 를 반환해 호출부가 성공 UI를 조건부로 띄운다.
    const ok = await optimisticAdd(set, 'entries', entry, () => insertEntry(entry), '노하우 저장에 실패했어요. 다시 시도해 주세요.', 'start');
    void embedEntry(entry); // 임베딩 색인(파이어앤포겟, 실패해도 발행 성공)
    return ok;
  },
  getById: (id) => get().entries.find((e) => e.id === id),
  // 검수 확정 — 낙관적 패치(update, void)와 달리 서버 반영을 기다려 ok를 반환한다.
  // 실패 시 로컬 상태를 건드리지 않으므로(draft 유지) 재시도가 안전(F4 중복 방지 패턴).
  publish: async (id, patch = {}) => {
    const ok = await updateEntry(id, { ...patch, status: 'published' });
    if (ok) {
      set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch, status: 'published' as const } : e)) }));
      const merged = get().entries.find((e) => e.id === id);
      if (merged) void embedEntry(merged); // published 전환 → 이제 색인 대상(맥락주입 텍스트)
    }
    return ok;
  },
  update: async (id, patch) => {
    const ok = await optimisticPatch(set, get, 'entries', id, patch, () => updateEntry(id, patch), '수정 저장에 실패했어요.');
    if (!ok) return false; // 실패면 재색인도 하지 않는다 — 서버에 없는 내용을 색인하면 검색이 거짓말을 한다
    const merged = get().entries.find((e) => e.id === id);
    if (merged) void embedEntry(merged); // 내용 변경 → 재색인
    return true;
  },
  remove: (id) => {
    optimisticRemove(set, get, 'entries', id, () => deleteEntry(id), '삭제에 실패했어요.');
  },
  reset: () => {
    setCustomCategoryRegistry([]); // 매장 전환 시 이전 매장 커스텀 라벨 누출 방지(hydrate가 다시 채움)
    set({ entries: HAS_SUPABASE ? [] : seed, loadError: false, customCategories: [], categoryLoadError: false });
  },
  // 데모 매장이면 시드, 신규 계정이면 빈 채로(가짜 노하우 노출 방지).
  applyMock: (demo) => set({ entries: demo ? seed : [], loaded: true, loadError: false }),
}));
