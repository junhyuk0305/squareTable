import { create } from 'zustand';
import type { UnknownQuery } from '@/types';
import seedData from '@/data/unknown-queries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchUnknownQueue, insertUnknown, bumpUnknownSimilar, resolveUnknown, updateUnknownStatus, subscribeUnknownQueue } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';

const seed = seedData as unknown as UnknownQuery[];

type UnknownQueueState = {
  queue: UnknownQuery[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  enqueue: (uq: UnknownQuery) => void;
  resolve: (uqId: string, newEntryId: string) => void;
  archive: (uqId: string) => void;
  unarchive: (uqId: string) => void;
  enableAutoAnswer: (uqId: string) => void;
  getPending: () => UnknownQuery[];
  getById: (id: string) => UnknownQuery | undefined;
  reset: () => void;
  applyMock: (demo: boolean) => void;
};

// 받은질문 상태 전이 공통 헬퍼: 낙관적 업데이트 + 실패 시 롤백.
function transition(
  set: (fn: (s: UnknownQueueState) => Partial<UnknownQueueState>) => void,
  get: () => UnknownQueueState,
  uqId: string,
  status: UnknownQuery['status'],
  failMsg: string,
) {
  const before = get().queue.find((u) => u.id === uqId);
  if (!before) return;
  set((s) => ({ queue: s.queue.map((u) => (u.id === uqId ? { ...u, status } : u)) }));
  void guardWrite(
    updateUnknownStatus(uqId, status),
    () => set((s) => ({ queue: s.queue.map((u) => (u.id === uqId ? before : u)) })),
    failMsg,
  );
}

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
  enqueue: (uq) => {
    const s = get();
    const norm = uq.query_text.trim();
    const idx = s.queue.findIndex(
      (u) => u.status === 'pending_owner_answer' && u.query_text.trim() === norm,
    );
    if (idx >= 0) {
      const target = s.queue[idx];
      const bumped = target.similar_queries_count + 1;
      set((st) => ({
        queue: st.queue.map((u) => (u.id === target.id ? { ...u, similar_queries_count: bumped } : u)),
      }));
      void guardWrite(
        bumpUnknownSimilar(target.id, bumped),
        () =>
          set((st) => ({
            queue: st.queue.map((u) => (u.id === target.id ? { ...u, similar_queries_count: bumped - 1 } : u)),
          })),
        '유사 질문 반영에 실패했어요.',
      );
      return;
    }
    set((st) => ({ queue: [uq, ...st.queue] }));
    void guardWrite(
      insertUnknown(uq),
      () => set((st) => ({ queue: st.queue.filter((u) => u.id !== uq.id) })),
      '질문 등록에 실패했어요. 다시 시도해 주세요.',
    );
  },
  resolve: (uqId, newEntryId) => {
    const before = get().queue.find((u) => u.id === uqId);
    set((s) => ({
      queue: s.queue.map((u) =>
        u.id === uqId
          ? { ...u, status: 'resolved_with_entry' as const, resolved_with_entry_id: newEntryId }
          : u,
      ),
    }));
    void guardWrite(
      resolveUnknown(uqId, newEntryId),
      () => before && set((s) => ({ queue: s.queue.map((u) => (u.id === uqId ? before : u)) })),
      '답변 반영에 실패했어요.',
    );
  },
  // 보관: 답변하지 않고 묻어둠. 대기/자동응답 목록에서 빠지고 보관함으로.
  archive: (uqId) => transition(set, get, uqId, 'archived', '보관 처리에 실패했어요.'),
  // 보관 해제 → 다시 대기로.
  unarchive: (uqId) => transition(set, get, uqId, 'pending_owner_answer', '보관 해제에 실패했어요.'),
  // 자동응답 사용 — AI 일반답변(ai_general_answer)으로 자동 응답하도록 표시.
  enableAutoAnswer: (uqId) => transition(set, get, uqId, 'auto_answered', '자동응답 설정에 실패했어요.'),
  getPending: () => get().queue.filter((u) => u.status === 'pending_owner_answer'),
  getById: (id) => get().queue.find((u) => u.id === id),
  reset: () => set({ queue: HAS_SUPABASE ? [] : [...seed] }),
  applyMock: (demo) => set({ queue: demo ? [...seed] : [], loaded: true }),
}));
