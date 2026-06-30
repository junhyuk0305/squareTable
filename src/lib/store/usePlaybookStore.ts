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
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  add: (entry: PlaybookEntry) => void;
  getById: (id: string) => PlaybookEntry | undefined;
  update: (id: string, patch: Partial<PlaybookEntry>) => void;
  remove: (id: string) => void;
  reset: () => void;
  applyMock: (demo: boolean) => void;
};

export const usePlaybookStore = create<PlaybookState>((set, get) => ({
  // Supabase면 빈 채로 시작 → hydrate가 DB로 채움. 아니면 기존 로컬 시드.
  entries: HAS_SUPABASE ? [] : seed,
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    set({ entries: await fetchEntries(), loaded: true });
  }),

  // 다른 기기(사장님)가 노하우를 발행하면 실시간으로 다시 당겨온다.
  subscribe: () => subscribeDebounced(subscribePlaybook, () => get().hydrate()),

  add: (entry) => {
    // 맨 앞에 추가(최신 우선). 실패 시 제거 롤백.
    optimisticAdd(set, 'entries', entry, () => insertEntry(entry), '노하우 저장에 실패했어요. 다시 시도해 주세요.', 'start');
    void embedEntry(entry); // 임베딩 색인(파이어앤포겟, 실패해도 발행 성공)
  },
  getById: (id) => get().entries.find((e) => e.id === id),
  update: (id, patch) => {
    optimisticPatch(set, get, 'entries', id, patch, () => updateEntry(id, patch), '수정 저장에 실패했어요.');
    const merged = get().entries.find((e) => e.id === id);
    if (merged) void embedEntry(merged); // 내용 변경 → 재색인
  },
  remove: (id) => {
    optimisticRemove(set, get, 'entries', id, () => deleteEntry(id), '삭제에 실패했어요.');
  },
  reset: () => set({ entries: HAS_SUPABASE ? [] : seed }),
  // 데모 매장이면 시드, 신규 계정이면 빈 채로(가짜 노하우 노출 방지).
  applyMock: (demo) => set({ entries: demo ? seed : [], loaded: true }),
}));
