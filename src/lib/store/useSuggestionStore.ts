// 노하우 제안/신청 큐 — 알바가 올린 개선 제안 / 신규 등록 신청을 사장이 검토(승인·반려).
// mock 모드: 데모 시드. Supabase 모드: playbook_suggestions 테이블 + 실시간 구독.
import { create } from 'zustand';
import type { PlaybookSuggestion } from '@/types';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchSuggestions, insertSuggestion, reviewSuggestion, subscribeSuggestions } from '@/lib/db';
import { optimisticAdd, optimisticPatch } from '@/lib/store/crudHelpers';
import { genId } from '@/lib/utils/id';
import { useSessionStore } from '@/lib/store/useSessionStore';

// 데모 매장 id(= mockSeed.DEMO_UNIT_ID). 순환 import 방지를 위해 여기선 리터럴로 둔다.
const DEMO_UNIT_ID = 'store_001';

export type SuggestionInput = {
  kind: 'improve' | 'new';
  text: string;
  targetEntryId?: string;
  targetTitle?: string;
  photos?: string[];
};

// 데모 시드 — 사장이 검토 화면에서 바로 흐름을 볼 수 있게 1건씩(개선/신규).
const seed: PlaybookSuggestion[] = [
  {
    id: 'sug_seed_1',
    unit_id: DEMO_UNIT_ID,
    kind: 'improve',
    target_entry_id: 'pb_event_003',
    target_title: '우유 떨어졌을 때 (1L 미만)',
    proposer_id: 'u_staff_002',
    proposer_name: '이수민',
    text: '냉장고 맨 아래칸에 예비 우유 2팩이 더 있어요. 1L 미만이면 거기부터 쓰면 발주 전까지 버틸 수 있어요.',
    status: 'pending',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: 'sug_seed_2',
    unit_id: DEMO_UNIT_ID,
    kind: 'new',
    proposer_id: 'u_staff_002',
    proposer_name: '이수민',
    text: '아이스 음료 픽업대에 물기 자주 고여서, 30분마다 한 번씩 행주로 닦으면 손님 컴플레인이 확 줄었어요. 마감 직전엔 꼭 한 번 더요.',
    status: 'pending',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
];

type State = {
  suggestions: PlaybookSuggestion[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  submit: (input: SuggestionInput) => void;
  approve: (id: string, resultingEntryId?: string) => void;
  reject: (id: string, note?: string) => void;
  getPending: () => PlaybookSuggestion[];
  mineFor: (userId: string) => PlaybookSuggestion[];
  applyMock: (demo: boolean) => void;
};

export const useSuggestionStore = create<State>((set, get) => ({
  suggestions: HAS_SUPABASE ? [] : [...seed],
  loaded: !HAS_SUPABASE,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    set({ suggestions: await fetchSuggestions(), loaded: true });
  },
  subscribe: () => subscribeSuggestions(() => get().hydrate()),

  submit: (input) => {
    const s = useSessionStore.getState();
    const item: PlaybookSuggestion = {
      id: genId('sug'),
      unit_id: s.unitId || DEMO_UNIT_ID,
      kind: input.kind,
      ...(input.targetEntryId ? { target_entry_id: input.targetEntryId } : null),
      ...(input.targetTitle ? { target_title: input.targetTitle } : null),
      proposer_id: s.userId,
      proposer_name: s.userName,
      text: input.text.trim(),
      ...(input.photos && input.photos.length ? { photos: input.photos } : null),
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    optimisticAdd(set, 'suggestions', item, () => insertSuggestion(item), '제안 등록에 실패했어요. 다시 시도해 주세요.', 'start');
  },

  approve: (id, resultingEntryId) => {
    const s = useSessionStore.getState();
    const patch = {
      status: 'approved' as const,
      reviewed_at: new Date().toISOString(),
      reviewed_by: s.userId,
      ...(resultingEntryId ? { resulting_entry_id: resultingEntryId } : null),
    };
    optimisticPatch(set, get, 'suggestions', id, patch, () => reviewSuggestion(id, patch), '승인 처리에 실패했어요.');
  },

  reject: (id, note) => {
    const s = useSessionStore.getState();
    const patch = {
      status: 'rejected' as const,
      reviewed_at: new Date().toISOString(),
      reviewed_by: s.userId,
      ...(note ? { owner_note: note } : null),
    };
    optimisticPatch(set, get, 'suggestions', id, patch, () => reviewSuggestion(id, patch), '반려 처리에 실패했어요.');
  },

  getPending: () => get().suggestions.filter((x) => x.status === 'pending'),
  mineFor: (userId) => get().suggestions.filter((x) => x.proposer_id === userId),
  applyMock: (demo) => set({ suggestions: demo ? [...seed] : [], loaded: true }),
}));
