import { create } from 'zustand';
import type { PlaybookEntry } from '@/types';
import seedData from '@/data/playbook-entries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchEntries, insertEntry, updateEntry, deleteEntry, subscribePlaybook } from '@/lib/db';

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

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ entries: await fetchEntries(), loaded: true });
  },

  // 다른 기기(사장님)가 노하우를 발행하면 실시간으로 다시 당겨온다.
  subscribe: () => subscribePlaybook(() => get().hydrate()),

  add: (entry) => {
    set((s) => ({ entries: [entry, ...s.entries] })); // 낙관적
    void insertEntry(entry);
  },
  getById: (id) => get().entries.find((e) => e.id === id),
  update: (id, patch) => {
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    void updateEntry(id, patch);
  },
  remove: (id) => {
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    void deleteEntry(id);
  },
  reset: () => set({ entries: HAS_SUPABASE ? [] : seed }),
  // 데모 매장이면 시드, 신규 계정이면 빈 채로(가짜 노하우 노출 방지).
  applyMock: (demo) => set({ entries: demo ? seed : [], loaded: true }),
}));
