import type { SeedQuery } from '@/types';

/**
 * 발표자가 라이브 데모 중 1탭으로 호출하는 시드 쿼리.
 * 6번째는 매칭 실패 → 학습 순환 시연용 (정전 사례).
 */
export const SEED_QUERIES: SeedQuery[] = [
  { id: 's1', label: '머리카락',  text: '머리카락 나왔다고 환불해달래요',     expectedEntry: 'pb_event_001' },
  { id: 's2', label: '마감 청소', text: '마감 청소 어디까지 해요?',            expectedEntry: 'pb_routine_003' },
  { id: 's3', label: '우유',      text: '우유 떨어졌어요 어떻게 해요',         expectedEntry: 'pb_event_003' },
  { id: 's4', label: 'POS',       text: '포스기 에러 떴어요 결제가 안 돼요',   expectedEntry: 'pb_event_005' },
  { id: 's5', label: '컵 위치',   text: '컵 어디 있어요?',                     expectedEntry: 'pb_context_001' },
  { id: 's6', label: '정전 ★',    text: '정전됐어요. 손님 5명 계신데 어떻게 해요?', expectedEntry: null },
];
