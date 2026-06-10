import { create } from 'zustand';
import type { ChatQuery, ResponseBlock, UnknownQuery } from '@/types';
import { searchPlaybook } from '@/lib/rag';
import { inferCategoryFromQuery } from '@/lib/utils/inferCategory';
import { generateAnswer, toSopSlices, GENERATE_THRESHOLD } from '@/lib/ai';
import { MAX_ACTIONS, MAX_DONTS } from '@/lib/ai/config';
import { usePlaybookStore } from './usePlaybookStore';
import { useUnknownQueueStore } from './useUnknownQueueStore';
import { useSessionStore } from './useSessionStore';
import seedData from '@/data/chat-queries.json';
import contextPack from '@/data/context-pack.json';

const seed = seedData as unknown as ChatQuery[];

// 매장 식별자는 컨텍스트팩(데이터)이 단일 진실. mock 단일 매장.
const STORE_ID = (contextPack as { unit_id: string }).unit_id;

type ChatState = {
  history: ChatQuery[];
  isLoading: boolean;
  lastSubmittedId: string | null;
  submit: (text: string) => Promise<void>;
  rate: (id: string, vote: 'up' | 'down') => void;
  reset: () => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  history: [...seed],
  isLoading: false,
  lastSubmittedId: null,

  submit: async (text) => {
    if (!text.trim()) return;
    set({ isLoading: true });

    try {
    const session = useSessionStore.getState();
    const playbookEntries = usePlaybookStore.getState().entries;

    // 시연 시 RAG 검색 느낌을 살리는 인위적 딜레이
    await new Promise((r) => setTimeout(r, 900));

    const result = searchPlaybook(text, playbookEntries);
    const now = new Date().toISOString();
    const id = `cq_${Date.now()}`;

    if (result.matched) {
      const entry = result.matched;
      const block: ResponseBlock = {
        summary: entry.square.situation,
        // 생성 경로와 동일하게 출력 상한을 강제(저장된 답도 같은 분량 규칙).
        actions: entry.square.action.steps.slice(0, MAX_ACTIONS),
        donts: entry.square.extract.dont ? [entry.square.extract.dont].slice(0, MAX_DONTS) : [],
        source: {
          entry_id: entry.id,
          creator_name: entry.creator_name,
          title: entry.title,
          version: entry.version,
          updated_at: entry.updated_at,
        },
      };
      const cq: ChatQuery = {
        id,
        junior_id: session.userId,
        junior_name: session.userName,
        query_text: text,
        asked_at: now,
        matched_entry_ids: [entry.id],
        match_confidence: result.confidence,
        was_deflected: true,
        response_block: block,
        satisfaction: null,
        resolved_at: now,
      };
      set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));
      return;
    }

    // ── 중간 밴드: 부분 매칭 → 그라운딩 생성 (이 구간만 LLM) ──
    if (result.confidence >= GENERATE_THRESHOLD && result.candidates.length > 0) {
      const sops = toSopSlices(result.candidates.map((c) => c.entry));
      const ai = await generateAnswer({ storeId: STORE_ID, query: text, sops });
      if (ai.block) {
        const cq: ChatQuery = {
          id,
          junior_id: session.userId,
          junior_name: session.userName,
          query_text: text,
          asked_at: now,
          matched_entry_ids: ai.usedSopIds,
          match_confidence: result.confidence,
          was_deflected: true,
          response_block: ai.block,
          satisfaction: null,
          resolved_at: now,
        };
        set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));
        return;
      }
      // 생성도 근거 못 찾음 → 사장님 라우팅으로 낙하
    }

    // ── 근거 부족 → 사장님께 라우팅 (LLM 안 씀) ──
    {
      const presumed = inferCategoryFromQuery(text, result.candidates);
      const cq: ChatQuery = {
        id,
        junior_id: session.userId,
        junior_name: session.userName,
        query_text: text,
        asked_at: now,
        matched_entry_ids: [],
        match_confidence: result.confidence,
        was_deflected: false,
        response_block: null,
        satisfaction: null,
        resolved_at: null,
      };
      set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));

      const uq: UnknownQuery = {
        id: `uq_${Date.now()}`,
        junior_id: session.userId,
        junior_name: session.userName,
        query_text: text,
        asked_at: now,
        presumed_category: presumed,
        presumed_subcategory: '',
        match_attempted: true,
        best_match_confidence: result.confidence,
        best_match_entry_id: result.candidates[0]?.entry?.id ?? null,
        status: 'pending_owner_answer',
        fallback_action: '사장님께 알림 전송됨',
        owner_notified_at: now,
        owner_will_answer: true,
        similar_queries_count: 1,
        ai_general_answer: '잠시만요, 사장님 답변을 기다리고 있어요.',
      };
      useUnknownQueueStore.getState().enqueue(uq);
    }
    } catch (e) {
      console.warn('[chat] submit failed:', e);
      set({ isLoading: false });
    }
  },

  rate: (id, vote) =>
    set((s) => ({
      history: s.history.map((q) => (q.id === id ? { ...q, satisfaction: vote } : q)),
    })),

  reset: () => set({ history: [...seed], isLoading: false, lastSubmittedId: null }),
}));
