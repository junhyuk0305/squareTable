import { create } from 'zustand';
import type { ChatQuery, ResponseBlock, UnknownQuery } from '@/types';
import { inferCategoryFromQuery } from '@/lib/utils/inferCategory';
import { generateAnswer, hybridSearch, extractIntent, toSopSlices, GENERATE_THRESHOLD } from '@/lib/ai';
import { MAX_ACTIONS, MAX_DONTS } from '@/lib/ai/config';
import { usePlaybookStore } from './usePlaybookStore';
import { useUnknownQueueStore } from './useUnknownQueueStore';
import { useSessionStore } from './useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchChatQueries, insertChatQuery, updateChatSatisfaction, recomputePlaybookStats } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import seedData from '@/data/chat-queries.json';
import contextPack from '@/data/context-pack.json';

const seed = seedData as unknown as ChatQuery[];

// 매장 식별자는 컨텍스트팩(데이터)이 단일 진실. mock 단일 매장.
const STORE_ID = (contextPack as { unit_id: string }).unit_id;

// 후보 노하우 카드("혹시 이거?")를 띄울 최소 신뢰도. 이보다 낮으면 노이즈 → 바로 사장 라우팅.
const CANDIDATE_FLOOR = 0.3;
// 후보 카드 최대 개수.
const MAX_CANDIDATES = 3;

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

    // 영속(insert) + 영속 성공 후에만 사용통계 재계산(fire-and-forget).
    // 순서 보장(리뷰 fix-1): recompute는 chat_queries를 읽으므로 행이 커밋된 뒤 돌아야 이번 질의가 집계된다.
    // insert 프로미스를 공유해 guardWrite(에러 배너)와 recompute가 같은 1회 insert에 붙는다(이중 insert 방지).
    const persistAndCount = (cq: ChatQuery, entryIds: string[]) => {
      const writeP = insertChatQuery(cq);
      void guardWrite(writeP, () => {}, '대화 기록 저장에 실패했어요. (답변은 그대로 보여요)');
      void writeP.then((ok) => { if (ok && entryIds.length) void recomputePlaybookStats(entryIds); });
    };

    // 저장된 답 그대로 서빙(매칭 확정) — LLM 0콜.
    const serveStored = (entry: typeof playbookEntries[number], confidence: number) => {
      const id = genId('cq');
      const now = new Date().toISOString();
      const block: ResponseBlock = {
        summary: entry.square.situation,
        // 생성 경로와 동일하게 출력 상한을 강제(저장된 답도 같은 분량 규칙).
        actions: entry.square.action.steps.slice(0, MAX_ACTIONS),
        donts: entry.square.extract.dont ? [entry.square.extract.dont].slice(0, MAX_DONTS) : [],
        mode: 'served', // 저장된 매장 노하우 그대로 → 검증 배지로 신뢰 표시.
        source: {
          entry_id: entry.id,
          creator_name: entry.creator_name,
          title: entry.title,
          version: entry.version,
          updated_at: entry.updated_at,
        },
      };
      const cq: ChatQuery = {
        id, junior_id: session.userId, junior_name: session.userName, query_text: text, asked_at: now,
        matched_entry_ids: [entry.id], match_confidence: confidence, was_deflected: true,
        response_block: block, satisfaction: null, resolved_at: now,
      };
      set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));
      persistAndCount(cq, [entry.id]);
    };

    // 그라운딩 생성 시도(중간 밴드) — 근거 찾으면 서빙하고 true, 아니면 false.
    const tryGenerate = async (r: typeof result): Promise<boolean> => {
      if (!(r.confidence >= GENERATE_THRESHOLD && r.candidates.length > 0)) return false;
      const sops = toSopSlices(r.candidates.map((c) => c.entry));
      const ai = await generateAnswer({ storeId: session.unitId || STORE_ID, query: text, sops });
      if (!ai.block) return false;
      const id = genId('cq');
      const now = new Date().toISOString();
      const cq: ChatQuery = {
        id, junior_id: session.userId, junior_name: session.userName, query_text: text, asked_at: now,
        matched_entry_ids: ai.usedSopIds, match_confidence: r.confidence, was_deflected: true,
        // 여러 노하우를 AI가 모아 정리 → mode:'generated'(검증 배지 비노출 + "AI 정리" 고지).
        response_block: { ...ai.block, mode: 'generated', ...(ai.degraded ? { degraded: true } : {}) },
        satisfaction: null, resolved_at: now,
      };
      set((s) => ({ history: [...s.history, cq], isLoading: false, lastSubmittedId: id }));
      persistAndCount(cq, ai.usedSopIds);
      return true;
    };

    // 1) 하이브리드 검색(렉시컬+벡터). mock이면 내부에서 렉시컬+데모 딜레이로 폴백.
    let result = await hybridSearch(text, playbookEntries);
    if (result.matched) { serveStored(result.matched, result.confidence); return; }
    if (await tryGenerate(result)) return;

    // 2) 장황(상황 섞인) 질문인데 매칭 실패 → 의도추출로 핵심만 뽑아 재검색.
    //    이 케이스에만 추가 비용 1콜 — 잘 맞는 질문엔 추가 비용 0.
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const verbose = text.trim().length >= 18 || wordCount >= 6;
    if (verbose) {
      const intent = await extractIntent({ query: text });
      const q2 = intent.rewritten?.trim();
      if (q2 && q2 !== text.trim()) {
        const r2 = await hybridSearch(q2, playbookEntries);
        if (r2.matched) { serveStored(r2.matched, r2.confidence); return; }
        if (await tryGenerate(r2)) return;
        // 재검색이 더 강한 후보를 찾았으면 후보 카드용으로 채택.
        if (r2.confidence > result.confidence) result = r2;
      }
    }

    // 3) 확정 답 없음 → 후보 노하우("혹시 이거?") 제시 + 사장 라우팅 준비 (LLM 안 씀)
    {
      const id = genId('cq');
      const now = new Date().toISOString();
      const presumed = inferCategoryFromQuery(text, result.candidates);
      // 어느 정도 관련 있는 후보가 있으면 카드로 먼저 보여준다(즉시 도움 + 인박스 잡음 ↓).
      const candidateIds =
        result.confidence >= CANDIDATE_FLOOR
          ? result.candidates.slice(0, MAX_CANDIDATES).map((c) => c.entry.id)
          : [];
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
        ...(candidateIds.length > 0 ? { candidate_entry_ids: candidateIds } : {}),
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
    } finally {
      // 안전망: 성공/실패 모든 경로에서 이미 isLoading=false로 두지만, 예기치 못한 조기 return이나
      // 미래 코드 변경으로 스피너가 남는 걸 원천 차단(무한 로딩 데드엔드 방지).
      if (get().isLoading) set({ isLoading: false });
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
    const q = get().history.find((q) => q.id === id);
    const before = q?.satisfaction ?? null;
    const ratedEntryIds = q?.matched_entry_ids ?? []; // 평가가 영향 주는 노하우(thumbs/해결률 재계산 대상)
    set((s) => ({
      history: s.history.map((q) => (q.id === id ? { ...q, satisfaction: vote } : q)),
    }));
    const writeP = updateChatSatisfaction(id, vote);
    void guardWrite(
      writeP,
      () => set((s) => ({ history: s.history.map((q) => (q.id === id ? { ...q, satisfaction: before } : q)) })),
      '평가 저장에 실패했어요.',
    );
    // 평가 영속 후에만 재계산 → 서버가 thumbs_up/down·resolution_rate 갱신, 실시간 구독으로 카드에 반영.
    void writeP.then((ok) => { if (ok && ratedEntryIds.length) void recomputePlaybookStats(ratedEntryIds); });
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
