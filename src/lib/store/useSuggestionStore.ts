// 노하우 제안/신청 큐 — 알바가 올린 개선 제안 / 신규 등록 신청을 사장이 검토(승인·반려).
// mock 모드: 데모 시드. Supabase 모드: playbook_suggestions 테이블 + 실시간 구독.
import { create } from 'zustand';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import type { PlaybookSuggestion } from '@/types';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchSuggestions, insertSuggestion, reviewSuggestion, subscribeSuggestions } from '@/lib/db';
import { optimisticAdd, optimisticPatch } from '@/lib/store/crudHelpers';
import { genId } from '@/lib/utils/id';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { notifyOwnersSuggestion } from '@/lib/push/notify';

// 데모 매장 id(= mockSeed.DEMO_UNIT_ID). 순환 import 방지를 위해 여기선 리터럴로 둔다.
const DEMO_UNIT_ID = 'store_001';

export type SuggestionInput = {
  kind: 'improve' | 'new';
  text: string;
  targetEntryId?: string;
  targetTitle?: string;
  photos?: string[];
  /** S1 ② 완료 캡처 출처 업무 id — 승인 시 그 업무에 자동 첨부(0069/0070). */
  sourceTemplateId?: string;
  /** S1 ③(D4) 새-답 제안이 답하는 미답질문 id — 승인·발행 시 그 질문 자동 resolve(0071). */
  sourceUqId?: string;
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
  /** true = 조회 **시도가 끝남**(성공·실패 무관). 실패 여부는 loadError 로 본다. */
  loaded: boolean;
  /** 마지막 hydrate 가 실패했는가 — 화면이 "대기 중인 제안이 없어요"와 "못 불러옴"을 구분한다(#19). */
  loadError: boolean;
  hydrate: () => Promise<void>;
  /** 재시도 — 실패 화면의 '다시 시도' 버튼이 부르는 경로. */
  retry: () => Promise<void>;
  subscribe: () => () => void;
  submit: (input: SuggestionInput) => Promise<boolean>;
  /** 승인 — **서버 반영 성공 여부**를 돌려준다(#18). 조용히 롤백되면 제안은 pending 으로 돌아오는데
   *  노하우는 이미 저장돼 있어, 사장이 다시 승인하면 **같은 노하우가 2건**이 된다. */
  approve: (id: string, resultingEntryId?: string) => Promise<boolean>;
  reject: (id: string, note?: string) => Promise<boolean>;
  getPending: () => PlaybookSuggestion[];
  mineFor: (userId: string) => PlaybookSuggestion[];
  applyMock: (demo: boolean) => void;
};

export const useSuggestionStore = create<State>((set, get) => ({
  suggestions: HAS_SUPABASE ? [] : [...seed],
  loaded: !HAS_SUPABASE,
  loadError: false,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const { data, error } = await fetchSuggestions();
    // 실패 시 기존 목록 유지 — 빈 배열로 덮으면 "제안 없음"이 사실인 양 굳는다.
    set((s) => ({ suggestions: error ? s.suggestions : data, loaded: true, loadError: error }));
  }),
  retry: async () => {
    await get().hydrate();
  },
  subscribe: () => subscribeDebounced(subscribeSuggestions, () => get().hydrate()),

  submit: (input) => {
    const s = useSessionStore.getState();
    const item: PlaybookSuggestion = {
      id: genId('sug'),
      unit_id: s.unitId || DEMO_UNIT_ID,
      kind: input.kind,
      ...(input.targetEntryId ? { target_entry_id: input.targetEntryId } : null),
      ...(input.targetTitle ? { target_title: input.targetTitle } : null),
      ...(input.sourceTemplateId ? { source_template_id: input.sourceTemplateId } : null),
      ...(input.sourceUqId ? { source_uq_id: input.sourceUqId } : null),
      proposer_id: s.userId,
      proposer_name: s.userName,
      text: input.text.trim(),
      ...(input.photos && input.photos.length ? { photos: input.photos } : null),
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    // ok를 반환해 호출부(제안 화면)가 "서버에 실제로 저장됐을 때만" 성공 토스트/뒤로가기를 하게 한다.
    const result = optimisticAdd(set, 'suggestions', item, () => insertSuggestion(item), '제안 등록에 실패했어요. 다시 시도해 주세요.', 'start');
    // 저장 성공 후에만 사장에게 웹푸시 — 실패(롤백) 시 유령 '검토 대기 제안' 알림 방지.
    void result.then((ok) => { if (ok) notifyOwnersSuggestion(item.proposer_name, item.text); });
    return result;
  },

  approve: (id, resultingEntryId) => {
    const s = useSessionStore.getState();
    const patch = {
      status: 'approved' as const,
      reviewed_at: new Date().toISOString(),
      reviewed_by: s.userId,
      ...(resultingEntryId ? { resulting_entry_id: resultingEntryId } : null),
    };
    return optimisticPatch(set, get, 'suggestions', id, patch, () => reviewSuggestion(id, patch), '승인 처리에 실패했어요.');
  },

  reject: (id, note) => {
    const s = useSessionStore.getState();
    const patch = {
      status: 'rejected' as const,
      reviewed_at: new Date().toISOString(),
      reviewed_by: s.userId,
      ...(note ? { owner_note: note } : null),
    };
    return optimisticPatch(set, get, 'suggestions', id, patch, () => reviewSuggestion(id, patch), '반려 처리에 실패했어요.');
  },

  getPending: () => get().suggestions.filter((x) => x.status === 'pending'),
  mineFor: (userId) => get().suggestions.filter((x) => x.proposer_id === userId),
  applyMock: (demo) => set({ suggestions: demo ? [...seed] : [], loaded: true, loadError: false }),
}));
