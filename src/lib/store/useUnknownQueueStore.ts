import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import type { UnknownQuery } from '@/types';
import seedData from '@/data/unknown-queries.json';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchUnknownQueue, insertUnknown, bumpUnknownSimilar, resolveUnknown, subscribeUnknownQueue } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { notifyStoreQuestion } from '@/lib/push/notify';
import { useSessionStore } from '@/lib/store/useSessionStore';

const seed = seedData as unknown as UnknownQuery[];

type UnknownQueueState = {
  queue: UnknownQuery[];
  loaded: boolean;
  loadError: boolean; // 마지막 hydrate 실패 여부 — 인박스가 "질문 없음"과 "못 불러옴"을 구분한다.
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  enqueue: (uq: UnknownQuery) => void;
  resolve: (uqId: string, newEntryId: string) => Promise<boolean>;
  getPending: () => UnknownQuery[];
  getById: (id: string) => UnknownQuery | undefined;
  reset: () => void;
  applyMock: (demo: boolean) => void;
};

/**
 * D4(③) 이 직원이 도와줄 수 있는 매장 미답질문 — 대기 중 + 내가 물은 건 제외(내 질문에 내가 안 답함).
 * ★배지 카운트(junior/chat)와 리스트(JuniorMySpace)의 공용 판정 SSOT — 한 곳만 바뀌어 어긋나지 않게.
 */
export function answerableQuestions(queue: UnknownQuery[], me: string): UnknownQuery[] {
  return queue.filter((u) => u.status === 'pending_owner_answer' && u.junior_id !== me);
}

export const useUnknownQueueStore = create<UnknownQueueState>((set, get) => ({
  queue: HAS_SUPABASE ? [] : [...seed],
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const { data, error } = await fetchUnknownQueue();
    set({ queue: data, loaded: true, loadError: error });
  }),

  // 알바 폰에서 질문이 들어오면 사장님 인박스가 실시간으로 갱신된다(학습순환의 핵심).
  subscribe: () => subscribeDebounced(subscribeUnknownQueue, () => get().hydrate()),

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
    // 저장 성공 후에만 사장에게 웹푸시(답변 대기 질문 유입). 실패(롤백)·상한 초과 시 유령 알림 방지.
    //   중복 유사질문(위 bump 경로)은 알리지 않는다.
    void guardWrite(
      insertUnknown(uq),
      () => set((st) => ({ queue: st.queue.filter((u) => u.id !== uq.id) })),
      // 일반 저장 실패 + 미해결 질문 상한(남용 #18, 0033 트리거 too_many_pending)을 한 메시지로 포괄.
      // (insertUnknown이 boolean만 반환해 사유 구분 불가 → 양쪽에 자연스러운 안내로 통합.)
      '질문을 등록하지 못했어요. 대기 중인 질문이 많으면 사장님 답변을 받은 뒤 다시 등록해 주세요.',
    // 저장 성공 후에만 웹푸시 — D4(③): 사장 + 같은 매장 직원 전체에게(누가 답하든 됨). 발송자 제외는 서버.
    ).then((ok) => { if (ok && uq.status === 'pending_owner_answer') notifyStoreQuestion(uq.query_text); });
  },
  // 질문 해결 — resolved_with_entry 로 전이 + answered_by 기록(누가 답했나, 0071).
  // 직원 즉시해결(기존 노하우 지정)·사장 발행(coach) 공통 경로. 답변자=현재 세션.
  resolve: (uqId, newEntryId) => {
    const before = get().queue.find((u) => u.id === uqId);
    const answeredBy = useSessionStore.getState().userId || undefined;
    set((s) => ({
      queue: s.queue.map((u) =>
        u.id === uqId
          ? { ...u, status: 'resolved_with_entry' as const, resolved_with_entry_id: newEntryId, ...(answeredBy ? { answered_by: answeredBy } : null) }
          : u,
      ),
    }));
    // ok 반환 — 호출부(coach)가 질문 상태 반영이 실제로 됐을 때만 성공 처리하도록.
    return guardWrite(
      resolveUnknown(uqId, newEntryId, answeredBy),
      () => before && set((s) => ({ queue: s.queue.map((u) => (u.id === uqId ? before : u)) })),
      '답변 반영에 실패했어요.',
    );
  },
  // (자동응답 전이 제거 — 2026-07-31 사용자 결정: 질문은 사장이 직접 답한다. auto_answered 는 과거 데이터 표시용으로만 남음.)
  getPending: () => get().queue.filter((u) => u.status === 'pending_owner_answer'),
  getById: (id) => get().queue.find((u) => u.id === id),
  reset: () => set({ queue: HAS_SUPABASE ? [] : [...seed], loadError: false }),
  applyMock: (demo) => set({ queue: demo ? [...seed] : [], loaded: true, loadError: false }),
}));
