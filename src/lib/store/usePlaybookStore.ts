import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import type { PlaybookEntry } from '@/types';
import seedData from '@/data/playbook-entries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchEntries, insertEntry, updateEntry, deleteEntry, subscribePlaybook } from '@/lib/db';
import { optimisticAdd, optimisticPatch, optimisticRemove } from '@/lib/store/crudHelpers';
import { embedEntry } from '@/lib/ai/searchClient';

const seed = seedData as unknown as PlaybookEntry[];

type PlaybookState = {
  entries: PlaybookEntry[];
  loaded: boolean;
  loadError: boolean; // 마지막 hydrate가 실패했는가 — 화면이 "없음"과 "못 불러옴"을 구분해 재시도 UI를 띄운다.
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  add: (entry: PlaybookEntry) => Promise<boolean>;
  getById: (id: string) => PlaybookEntry | undefined;
  update: (id: string, patch: Partial<PlaybookEntry>) => void;
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

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const { data, error } = await fetchEntries();
    set({ entries: data, loaded: true, loadError: error });
  }),

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
  update: (id, patch) => {
    optimisticPatch(set, get, 'entries', id, patch, () => updateEntry(id, patch), '수정 저장에 실패했어요.');
    const merged = get().entries.find((e) => e.id === id);
    if (merged) void embedEntry(merged); // 내용 변경 → 재색인
  },
  remove: (id) => {
    optimisticRemove(set, get, 'entries', id, () => deleteEntry(id), '삭제에 실패했어요.');
  },
  reset: () => set({ entries: HAS_SUPABASE ? [] : seed, loadError: false }),
  // 데모 매장이면 시드, 신규 계정이면 빈 채로(가짜 노하우 노출 방지).
  applyMock: (demo) => set({ entries: demo ? seed : [], loaded: true, loadError: false }),
}));
