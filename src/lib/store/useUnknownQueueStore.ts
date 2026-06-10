import { create } from 'zustand';
import type { UnknownQuery } from '@/types';
import seedData from '@/data/unknown-queries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchUnknownQueue, insertUnknown, bumpUnknownSimilar, resolveUnknown, subscribeUnknownQueue } from '@/lib/db';

const seed = seedData as unknown as UnknownQuery[];

type UnknownQueueState = {
  queue: UnknownQuery[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  enqueue: (uq: UnknownQuery) => void;
  resolve: (uqId: string, newEntryId: string) => void;
  getPending: () => UnknownQuery[];
  getById: (id: string) => UnknownQuery | undefined;
  reset: () => void;
};

export const useUnknownQueueStore = create<UnknownQueueState>((set, get) => ({
  queue: HAS_SUPABASE ? [] : [...seed],
  loaded: !HAS_SUPABASE,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ queue: await fetchUnknownQueue(), loaded: true });
  },

  // 알바 폰에서 질문이 들어오면 사장님 인박스가 실시간으로 갱신된다(학습순환의 핵심).
  subscribe: () => subscribeUnknownQueue(() => get().hydrate()),

  // 같은 질문이 이미 대기 중이면 새로 쌓지 않고 유사 질문 수만 올린다(중복 방지).
  enqueue: (uq) =>
    set((s) => {
      const norm = uq.query_text.trim();
      const idx = s.queue.findIndex(
        (u) => u.status === 'pending_owner_answer' && u.query_text.trim() === norm,
      );
      if (idx >= 0) {
        const next = s.queue.slice();
        const bumped = next[idx].similar_queries_count + 1;
        next[idx] = { ...next[idx], similar_queries_count: bumped };
        void bumpUnknownSimilar(next[idx].id, bumped);
        return { queue: next };
      }
      void insertUnknown(uq);
      return { queue: [uq, ...s.queue] };
    }),
  resolve: (uqId, newEntryId) => {
    set((s) => ({
      queue: s.queue.map((u) =>
        u.id === uqId
          ? { ...u, status: 'resolved_with_entry' as const, resolved_with_entry_id: newEntryId }
          : u,
      ),
    }));
    void resolveUnknown(uqId, newEntryId);
  },
  getPending: () => get().queue.filter((u) => u.status === 'pending_owner_answer'),
  getById: (id) => get().queue.find((u) => u.id === id),
  reset: () => set({ queue: HAS_SUPABASE ? [] : [...seed] }),
}));
