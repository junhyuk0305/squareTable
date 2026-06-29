// 데모 vs 신규계정 데이터 스위치 (mock 모드 전용).
//  - applyMockSeed(true)  → 모든 스토어를 데모 시드로 (데모 계정 입장)
//  - applyMockSeed(false) → 모든 스토어를 빈 상태로 (새 계정/새 사업장 → 처음부터)
// Supabase 모드에선 각 스토어 hydrate()가 매장별 실데이터를 채우므로 호출하지 않는다.
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useRoomStore } from '@/lib/store/useRoomStore';

export const DEMO_UNIT_ID = 'store_001';

export function applyMockSeed(demo: boolean) {
  usePlaybookStore.getState().applyMock(demo);
  useUnknownQueueStore.getState().applyMock(demo);
  useWorkStore.getState().applyMock(demo);
  useAttendanceStore.getState().applyMock(demo);
  usePayrollStore.getState().applyMock(demo);
  useChatStore.getState().applyMock(demo);
  useStaffStore.getState().applyMock(demo);
  useSuggestionStore.getState().applyMock(demo);
  useRoomStore.getState().applyMock(demo);
}
