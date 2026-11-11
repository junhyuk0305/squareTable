// useSpaceAskStore — 공간 멤버 묻기(S17 · 사용자 결정 11-11 밤 6 · 결정 146·150) 얇은 스토어.
// 하는 일은 셋뿐이다: 질문 기록 넣기(chat_queries · RLS cq_insert 공간 갈래) · AI 부르기(공간 갈래 target) · 주인에게 보내기(space_question_send).
// 매장 묻기(useChatStore)는 고치지 않는다. 그 흐름 중 공간 멤버에게 필요한 줄만 옮겼다.
//
// 흐름:
//  · 공간 노하우가 하나도 없으면 AI 를 부르지 않고 "보낼까요?"로 간다(모델 0콜).
//  · 의도 게이트(classifyQuery)와 검색(hybridSearch)을 같이 부른다. 잡담·대상불명이면 답을 만들지 않고 "보낼까요?"로 간다.
//  · 검색이 확정이면 저장된 노하우 그대로(served) · 애매 구간이면 AI 정리(generated) · 그 밖은 "보낼까요?".
//  · AI 를 다 썼으면(402 scope space) 확인 없이 바로 보낸다(계약 6-3).
//  · AI 서버가 죽어 기본 답(degraded)으로 떨어지면 그 답을 보이지 않고 "보낼까요?"로 간다(가짜 답을 공간 노하우처럼 보이지 않는다).
// 차례는 화면에만 있다(새로 열면 비어 있다). 보낸 질문은 "내 질문"(space_my_questions)에서 다시 보인다.
import { create } from 'zustand';
import type { ChatQuery, PlaybookEntry, ResponseBlock } from '@/types';
import { classifyQuery, generateAnswer, hybridSearch, toSopSlices, GENERATE_THRESHOLD, type AiTarget } from '@/lib/ai';
import { MAX_ACTIONS, MAX_DONTS } from '@/lib/ai/config';
import { insertChatQuery, spaceQuestionSend } from '@/lib/db';
import type { DbErr } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { isServable } from '@/lib/utils/entryStatus';
import { genId } from '@/lib/utils/id';

/** 한 번 물은 것. thinking = AI 가 보는 중 · answer = 답 카드 · ask_owner = "보낼까요?" · sending = 보내는 중 · sent = 보냄. */
export type SpaceAskTurn = {
  id: string;
  spaceId: string;
  /** 물은 계정. 같은 기기에서 계정을 바꾸면 남의 차례가 보이지 않게 화면이 이것으로 거른다. */
  userId: string;
  text: string;
  state: 'thinking' | 'answer' | 'ask_owner' | 'sending' | 'sent';
  block?: ResponseBlock;
  /** AI 를 다 써서 확인 없이 보냈다(문구가 다르다). */
  capSent?: boolean;
  /** 보낸 뒤 답할 질문 번호. */
  uqId?: string;
};

type State = {
  turns: SpaceAskTurn[];
  /** 묻기 한 번. 결과는 turns 의 그 차례 상태로 남는다. */
  ask: (spaceId: string, text: string, entries: PlaybookEntry[]) => Promise<void>;
  /** 주인에게 보내기("보낼까요?" 뒤 · 도움이 안 됐어요). 실패하면 오류를 돌려주고 차례는 그대로 둔다. */
  send: (turnId: string) => Promise<{ error: DbErr | null }>;
  /** "보내지 않기" — 그 차례를 지운다(저장한 질문 기록은 남는다). */
  dismiss: (turnId: string) => void;
  /** 공간을 나가거나 다른 공간에 들어가면 비운다. */
  clear: () => void;
};

const patch = (turns: SpaceAskTurn[], id: string, p: Partial<SpaceAskTurn>) => turns.map((t) => (t.id === id ? { ...t, ...p } : t));

export const useSpaceAskStore = create<State>((set, get) => ({
  turns: [],

  ask: async (spaceId, raw, entries) => {
    const text = raw.trim();
    if (!text || !spaceId) return;
    const s = useSessionStore.getState();
    const id = genId('cq');
    const now = new Date().toISOString();
    set((st) => ({ turns: [...st.turns, { id, spaceId, userId: s.userId, text, state: 'thinking' }] }));
    const servable = entries.filter(isServable);
    const target: AiTarget = { unitId: spaceId };

    // 질문 기록(매장과 같은 표 · 공간 번호로). 실패해도 묻기는 이어 간다(기록은 통계용).
    const record = (block: ResponseBlock | null, matched: string[], confidence: number) => {
      const cq: ChatQuery & { unit_id: string } = {
        id, unit_id: spaceId, junior_id: s.userId, junior_name: s.userName, query_text: text, asked_at: now,
        matched_entry_ids: matched, match_confidence: confidence, was_deflected: !!block,
        response_block: block, satisfaction: null, resolved_at: block ? now : null,
      };
      void insertChatQuery(cq);
    };
    const askOwner = () => {
      set((st) => ({ turns: patch(st.turns, id, { state: 'ask_owner' }) }));
    };
    const showAnswer = (block: ResponseBlock, matched: string[], confidence: number) => {
      set((st) => ({ turns: patch(st.turns, id, { state: 'answer', block }) }));
      record(block, matched, confidence);
    };
    const capSend = async () => {
      record(null, [], 0);
      set((st) => ({ turns: patch(st.turns, id, { state: 'sending', capSent: true }) }));
      const r = await spaceQuestionSend(spaceId, text);
      set((st) => ({ turns: patch(st.turns, id, r.error ? { state: 'ask_owner', capSent: true } : { state: 'sent', capSent: true, uqId: r.data ?? undefined }) }));
    };

    try {
      if (servable.length === 0) {
        record(null, [], 0);
        askOwner();
        return;
      }
      const [triage, result] = await Promise.all([classifyQuery({ query: text }, target), hybridSearch(text, servable, target)]);
      if (triage.type === 'chat' || triage.type === 'vague') {
        record(null, [], 0);
        askOwner();
        return;
      }
      if (result.matched) {
        const e = result.matched;
        showAnswer(
          {
            summary: e.square.situation,
            actions: e.square.action.steps.slice(0, MAX_ACTIONS),
            donts: e.square.extract.dont ? [e.square.extract.dont].slice(0, MAX_DONTS) : [],
            mode: 'served',
            source: { entry_id: e.id, creator_name: e.creator_name, title: e.title, version: e.version, updated_at: e.updated_at },
          },
          [e.id],
          result.confidence,
        );
        return;
      }
      if (result.confidence >= GENERATE_THRESHOLD && result.candidates.length > 0) {
        const ai = await generateAnswer({ storeId: spaceId, query: text, sops: toSopSlices(result.candidates.map((c) => c.entry)) }, target);
        if (ai.quotaExceeded) {
          await capSend();
          return;
        }
        if (ai.block && !ai.degraded) {
          const partial = ai.coverage === 'partial' && !!ai.caveat?.trim();
          showAnswer({ ...ai.block, mode: 'generated', ...(partial ? { caveat: ai.caveat!.trim() } : {}) }, ai.usedSopIds, result.confidence);
          return;
        }
      }
      record(null, [], result.confidence);
      askOwner();
    } catch (e) {
      // 묻기가 넘어져도 질문이 사라지지 않게 "보낼까요?"로 남긴다(주인에게 보낼 길은 열어 둔다).
      console.warn('[space-ask] ask failed:', e);
      if (get().turns.some((t) => t.id === id && t.state === 'thinking')) askOwner();
    }
  },

  send: async (turnId) => {
    const t = get().turns.find((x) => x.id === turnId);
    if (!t || t.state === 'sending' || t.state === 'sent') return { error: null };
    const prev = t.state;
    set((st) => ({ turns: patch(st.turns, turnId, { state: 'sending' }) }));
    const r = await spaceQuestionSend(t.spaceId, t.text);
    if (r.error) {
      set((st) => ({ turns: patch(st.turns, turnId, { state: prev }) }));
      return { error: r.error };
    }
    set((st) => ({ turns: patch(st.turns, turnId, { state: 'sent', uqId: r.data ?? undefined }) }));
    return { error: null };
  },

  dismiss: (turnId) => set((st) => ({ turns: st.turns.filter((t) => t.id !== turnId) })),

  clear: () => set({ turns: [] }),
}));
