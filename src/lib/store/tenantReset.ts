// tenantReset.ts — 계정·매장이 바뀌면 데이터 스토어를 비운다(2026-10-04 사용자 규칙).
//
// 규칙: 다른 매장·다른 계정의 데이터는 한 프레임도 보이면 안 된다. 스토어는 매장이 바뀌어도 스스로 비워지지 않는다.
// 비우지 않으면 ① 같은 기기에서 로그아웃 → 다른 계정 로그인 때 이전 계정 행이 보이고
// ② 매장을 바꾸면 새 매장 이름 아래 이전 매장 행이 loaded=true 로 그려진다.
//
// 왜 세션 구독인가: 계정·매장이 바뀌는 길이 여럿이다(로그인·로그아웃·auth 이벤트·탈퇴·로드 실패·
// 매장 전환·소속 재확인·매장 나가기/삭제). 길마다 부르면 하나를 빠뜨린다. 여기서 (userId, unitId) 전이 하나만 본다.
// useSessionStore 가 데이터 스토어를 import 하면 순환이 생긴다(데이터 스토어 → useSessionStore). 그래서 이 모듈이 구독한다.
//
// zustand 구독은 set() 안에서 동기로 돈다. React 는 그 뒤에 그리므로 새 unitId 와 이전 매장 행이 같이 그려지지 않는다.
// 비운 스토어는 loaded=false 라 화면은 로딩 게이트를 보이고, owner·junior _layout 의 [status, unitId] effect 가 다시 채운다.
//
// ⚠️ 매장 단위 스토어를 새로 만들면 UNIT_STORES 에 넣고, 두 _layout 의 [status, unitId] effect 에서 hydrate 한다.
//    빠지면 다른 매장 행이 남거나(목록에서 빠짐) 로딩 게이트가 영영 안 풀린다(hydrate 에서 빠짐).
//    hydrate 는 첫 await 전에 currentTenantEpoch() 를 잡고 await 뒤 isStaleEpoch 면 set 하지 않는다(tenantEpoch.ts).
import type { StoreApi } from 'zustand';
import { HAS_SUPABASE } from '@/lib/supabase';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore, DEFAULT_SETTINGS } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useOwnerAlertStore } from '@/lib/store/useOwnerAlertStore';
import { usePaymentClaimStore } from '@/lib/store/usePaymentClaimStore';
import { useHubStore, resetHubHydrateTtl } from '@/lib/store/useHubStore';
import { useCrossNotifStore, resetCrossNotifHydrateTtl } from '@/lib/store/useCrossNotifStore';
import { useMemberPrefsStore, resetMemberPrefsHydrateTtl } from '@/lib/store/useMemberPrefsStore';
import { useOwnerBrandStore } from '@/lib/store/useOwnerBrandStore';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useBrandUnitsPageStore } from '@/lib/store/useBrandUnitsPageStore';
import { useBrandUnitDetailStore } from '@/lib/store/useBrandUnitDetailStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import { useBrandBillingStore } from '@/lib/store/useBrandBillingStore';
import { setCustomCategoryRegistry } from '@/lib/store/knowhowCategories';
import { bumpTenantEpoch } from '@/lib/store/tenantEpoch';

/** 활성 매장 하나의 데이터 — 매장이 바뀌면 비운다. */
const UNIT_STORES: StoreApi<any>[] = [
  usePlaybookStore,
  useUnknownQueueStore,
  useWorkStore,
  useAttendanceStore,
  usePayrollStore,
  useStaffStore,
  useScheduleStore,
  useSuggestionStore,
  useRoomStore,
  useChatStore,
  useOwnerAlertStore,
  usePaymentClaimStore,
];

/** 계정 단위 데이터(내 전 매장 묶음·본사) — 매장 전환에는 그대로 두고 계정이 바뀔 때만 비운다. */
const ACCOUNT_STORES: StoreApi<any>[] = [useHubStore, useCrossNotifStore, useMemberPrefsStore, useOwnerBrandStore, useBrandUnitDetailStore];

const toInitial = (s: StoreApi<any>) => s.setState(s.getInitialState(), true);

function resetUnitData() {
  // 비우기 전에 출발한 hydrate 의 늦은 응답을 버린다(tenantEpoch.ts). 계정 전환도 이 함수를 지나므로 둘 다 올라간다.
  bumpTenantEpoch();
  UNIT_STORES.forEach(toInitial);
  // 노하우 커스텀 라벨 레지스트리는 스토어 밖 모듈 값이다(usePlaybookStore.reset 과 같은 이유).
  setCustomCategoryRegistry([]);
  // 급여 규칙의 초기값은 기기 캐시(이전 매장 규칙)다. DB 에 규칙이 없는 매장에 그대로 남지 않게 기본값으로 둔다.
  usePayrollStore.setState({ settings: DEFAULT_SETTINGS });
}

function resetTenantData() {
  resetUnitData();
  ACCOUNT_STORES.forEach(toInitial);
  resetHubHydrateTtl();
  resetCrossNotifHydrateTtl();
  resetMemberPrefsHydrateTtl();
  // 본사 스토어는 늦게 오는 응답을 버리는 세대 번호까지 올리는 자체 reset 을 쓴다.
  useBrandStore.getState().reset();
  useBrandUnitsStore.getState().reset();
  useBrandUnitsPageStore.getState().reset();
  useBrandKnowhowStore.getState().reset();
  useBrandQuizStore.getState().reset();
  useBrandBillingStore.getState().reset();
}

let _installed = false;

/** 앱 모듈 로드 시 1회(루트 _layout). 데모(백엔드 없음)는 시드 데이터라 비우지 않는다. */
export function installTenantReset() {
  if (_installed || !HAS_SUPABASE) return;
  _installed = true;
  useSessionStore.subscribe((s, prev) => {
    if (s.userId !== prev.userId) resetTenantData();
    else if (s.unitId !== prev.unitId) resetUnitData();
  });
}
