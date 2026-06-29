import { create } from 'zustand';
import type { ChatQuery, ResponseBlock, UnknownQuery } from '@/types';
import { inferCategoryFromQuery } from '@/lib/utils/inferCategory';
import { generateAnswer, hybridSearch, toSopSlices, GENERATE_THRESHOLD } from '@/lib/ai';
import { MAX_ACTIONS, MAX_DONTS } from '@/lib/ai/config';
import { usePlaybookStore } from './usePlaybookStore';
import { useUnknownQueueStore } from './useUnknownQueueStore';
import { useSessionStore } from './useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchChatQueries, insertChatQuery, updateChatSatisfaction } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import seedData from '@/data/chat-queries.json';
import contextPack from '@/data/context-pack.json';

const seed = seedData as unknown as ChatQuery[];

// 매장 식별자는 컨텍스트팩(데이터)이 단일 진실. mock 단일 매장.
const STORE_ID = (contextPack as { unit_id: string }).unit_id;

type ChatState = {
  history: ChatQuery[];
  isLoading: boolean;
  loaded: boolean;
  lastSubmittedId: string | null;
  error: string | null; // 전송 실패 시 사용자에게 보일 메시지
  lastFailed: { text: string; anonymous: boolean } | null; // '다시 시도'용 마지막 실패 입력
  // 매칭 실패 질문은 곧장 사장님 인박스에 쌓지 않는다. 등록 대기(준비된 UnknownQuery)로 보관하고
  // 알바가 '등록' 버튼을 누를 때만 인박스로 보낸다 → 오타·장난성 질문이 사장에게 그대로 가는 걸 막는다.
  pendingDeflects: Record<string, UnknownQuery>;
  deflectStatus: Record<string, 'registered' | 'declined'>;
  hydrate: (juniorId: string) => Promise<void>;
  submit: (text: string, opts?: { anonymous?: boolean }) => Promise<void>;
  registerToOwner: (queryId: string) => void;
  declineDeflect: (queryId: string) => void;
  rate: (id: string, vote: 'up' | 'down') => void;
  dismissError: () => void;
  retryLast: () => Promise<void>;
  reset: () => void;
  applyMock: (demo: boolean) => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  // Supabase면 빈 채로 시작 → hydrate가 내 채팅 기록을 DB에서 당겨옴. 아니면 로컬 시드.
  history: HAS_SUPABASE ? [] : [...seed],
  isLoading: false,
  loaded: !HAS_SUPABASE,
  lastSubmittedId: null,
  error: null,
  lastFailed: null,
  pendingDeflects: {},
  deflectStatus: {},

  hydrate: async (juniorId) => {
    if (!HAS_SUPABASE) return;
    set({ history: await fetchChatQueries(juniorId), loaded: true });
  },

  submit: async (text, opts) => {
    if (!text.trim()) return;
    set({ isLoading: true, error: null });

    // 익명이면 사장 인박스에 노출될 이름을 '익명'으로 가린다. junior_id는 라우팅용으로만 유지.
    const anon = !!opts?.anonymous;

    try {
    const session = useSessionStore.getState();
    const playbookEntries = usePlaybookStore.getState().entries;

    // 하이브리드 검색(렉시컬+벡터). mock이면 내부에서 렉시컬+데모 딜레이로 폴백.
    const result = await hybridSearch(text, playbookEntries);
    const now = new Date().toISOString();
    const id = genId('cq');

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
      // 답변은 이미 보여줬으니 화면에선 유지하고, 영속 실패만 배너로 알린다(롤백 없음).
      void guardWrite(insertChatQuery(cq), () => {}, '대화 기록 저장에 실패했어요. (답변은 그대로 보여요)');
      return;
    }

    // ── 중간 밴드: 부분 매칭 → 그라운딩 생성 (이 구간만 LLM) ──
    if (result.confidence >= GENERATE_THRESHOLD && result.candidates.length > 0) {
      const sops = toSopSlices(result.candidates.map((c) => c.entry));
      const ai = await generateAnswer({ storeId: session.unitId || STORE_ID, query: text, sops });
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
          response_block: ai.degraded ? { ...ai.block, degraded: true } : ai.block,
          satisfaction: null,
          resolved_at: now,
        };
        set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));
        // 답변은 이미 보여줬으니 화면에선 유지하고, 영속 실패만 배너로 알린다(롤백 없음).
      void guardWrite(insertChatQuery(cq), () => {}, '대화 기록 저장에 실패했어요. (답변은 그대로 보여요)');
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
      // 답변은 이미 보여줬으니 화면에선 유지하고, 영속 실패만 배너로 알린다(롤백 없음).
      void guardWrite(insertChatQuery(cq), () => {}, '대화 기록 저장에 실패했어요. (답변은 그대로 보여요)');

      const uq: UnknownQuery = {
        id: genId('uq'),
        junior_id: session.userId,
        junior_name: anon ? '익명' : session.userName,
        anonymous: anon,
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
      // 곧장 enqueue 하지 않는다 — 알바가 카드에서 '등록'을 눌러야 사장님 인박스로 보낸다.
      set((s) => ({ pendingDeflects: { ...s.pendingDeflects, [id]: uq } }));
    }
    } catch (e) {
      // 조용히 삼키지 않는다 — 질문이 흔적 없이 사라지는 데드엔드 방지.
      // 입력을 보관해 '다시 시도'로 복구할 수 있게 한다.
      console.warn('[chat] submit failed:', e);
      set({
        isLoading: false,
        error: '질문을 보내지 못했어요. 잠시 후 다시 시도해 주세요.',
        lastFailed: { text, anonymous: anon },
      });
    }
  },

  // 알바가 '사장님께 등록'을 누르면 보관해둔 질문을 인박스로 보낸다. 중복(같은 질문 대기중)은 enqueue가 합친다.
  registerToOwner: (queryId) => {
    const uq = get().pendingDeflects[queryId];
    if (!uq || get().deflectStatus[queryId] === 'registered') return;
    set((s) => ({ deflectStatus: { ...s.deflectStatus, [queryId]: 'registered' } }));
    useUnknownQueueStore.getState().enqueue(uq);
  },

  // '괜찮아요' — 등록하지 않고 카드를 접는다. 보관해둔 질문은 그대로 둬서 나중에 다시 등록할 수 있다.
  declineDeflect: (queryId) =>
    set((s) => ({ deflectStatus: { ...s.deflectStatus, [queryId]: 'declined' } })),

  rate: (id, vote) => {
    const before = get().history.find((q) => q.id === id)?.satisfaction ?? null;
    set((s) => ({
      history: s.history.map((q) => (q.id === id ? { ...q, satisfaction: vote } : q)),
    }));
    void guardWrite(
      updateChatSatisfaction(id, vote),
      () => set((s) => ({ history: s.history.map((q) => (q.id === id ? { ...q, satisfaction: before } : q)) })),
      '평가 저장에 실패했어요.',
    );
  },

  dismissError: () => set({ error: null }),

  retryLast: async () => {
    const failed = get().lastFailed;
    if (!failed) return;
    set({ lastFailed: null });
    await get().submit(failed.text, { anonymous: failed.anonymous });
  },

  reset: () => set({ history: [...seed], isLoading: false, lastSubmittedId: null, error: null, lastFailed: null, pendingDeflects: {}, deflectStatus: {} }),
  applyMock: (demo) =>
    set({ history: demo ? [...seed] : [], isLoading: false, lastSubmittedId: null, loaded: true, error: null, lastFailed: null, pendingDeflects: {}, deflectStatus: {} }),
}));
