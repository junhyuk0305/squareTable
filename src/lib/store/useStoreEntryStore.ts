// 매장 진입 — "이 매장으로 들어간다"는 한 가지 동작의 SSOT.
//
// 왜 스토어로 꺼냈나: 진입을 시작하는 자리가 둘이 됐다(2026-08-08 상단바 통일).
//   ① 허브의 매장 카드(stores.tsx)  ② 허브 상단바의 매장 칸(StoreToggle)
// 같은 동작을 두 번 구현하면 한쪽만 고쳐지는 게 이 프로젝트에서 반복된 실패다. 화면이 아니라
// 여기 한 곳에 두고, 화면은 부르기만 한다. 진행 중 커버는 전역 <StoreEnterCover/>가 그린다.
//
// 순서: ①활성 매장 전환(다른 매장일 때만) → ②착지 화면 데이터 선반입 → ③역할에 맞는 홈으로 replace.
import { create } from 'zustand';
import { router } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { showToast } from '@/lib/store/useToastStore';
import { canManage } from '@/lib/utils/roles';

/**
 * 진입 커버가 **각 단계**(① 활성 매장 전환 ② 착지 데이터 선반입)마다 최대 이만큼만 기다린다.
 *
 * ⚠️ 이 값이 진입 경로에서 가장 위험한 부분이다 — 읽기가 끝내 안 오면(오프라인 등) 스토어의 loaded 가
 * 영원히 false 라, 타임아웃이 없으면 사용자가 커버에 갇힌다. **무음 실패를 로딩으로 위장하는 것이
 * 지금보다 나쁘다.** 시간이 지나면 덜 채워진 채로라도 매장 화면(다음 행동이 있는 화면)으로 내보내고,
 * 실패 자체는 전역 SyncBanner(db.ts readFail)가 말한다.
 *
 * ①에는 예외가 있다 — 전환이 안 끝난 채로 진입하면 **이전 매장**이 보이므로, ①의 타임아웃은
 * 진입이 아니라 매장 목록으로의 복귀다(아래 enter 참고).
 */
const ENTER_TIMEOUT_MS = 6000;

/**
 * 정해진 시간 안에 안 끝나면 'timeout'.
 *
 * fetch 는 취소하지 못하므로 **기다림만 포기**한다. settle 되지 않는 네트워크(캡티브 포털·
 * TCP 블랙홀)에서 await 이 영원히 안 풀리는 것을 막는 유일한 수단이다.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))]);
}

/**
 * 착지 화면(사장 홈 / 직원 홈)이 그리기 전에 필요한 것만 미리 채운다.
 *
 * 왜 여기서 당기는가: 스토어는 매장이 바뀌어도 비워지지 않는다(loaded 는 true 로 남는다).
 * 그래서 전환 직후 그냥 넘어가면 ① 빈 상태가 스치거나 ② 잠깐 **이전 매장 데이터**가 보인다.
 * 하이드레이트 함수는 owner/junior _layout 이 부르는 것과 **같은 것**이라 새 경로가 아니다.
 */
async function prefetchStoreData(manage: boolean): Promise<void> {
  const jobs = manage
    ? [
        usePlaybookStore.getState().hydrate(),
        useUnknownQueueStore.getState().hydrate(),
        useWorkStore.getState().hydrate(),
        useAttendanceStore.getState().hydrate(),
      ]
    : [
        useWorkStore.getState().hydrate(),
        useAttendanceStore.getState().hydrate(),
        useScheduleStore.getState().hydrate(),
      ];
  // allSettled: 한 스토어가 던져도(오프라인) 나머지를 기다린다. race: 그래도 안 끝나면 놓아준다.
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise<void>((resolve) => setTimeout(resolve, ENTER_TIMEOUT_MS)),
  ]);
}

type StoreEntryState = {
  /** 진입 중인 매장(커버가 이걸 보고 그린다). null 이면 커버 없음. */
  entering: { uid: string; name: string } | null;
  /** name = 화면에 보여줄 이름(닉네임 우선) — 부르는 쪽이 이미 갖고 있다. */
  enter: (unit: { uid: string; name: string }) => Promise<void>;
};

export const useStoreEntryStore = create<StoreEntryState>((set, get) => ({
  entering: null,
  enter: async ({ uid, name }) => {
    if (get().entering) return;
    set({ entering: { uid, name } });
    const sess = useSessionStore.getState();
    // 이미 활성 매장이면 전환 없이 바로 진입. 다른 매장이면 활성 전환 후 진입.
    if (uid !== sess.unitId) {
      // ★switchUnit(RPC + loadProfile)도 타임아웃 안에 둔다 — 예전엔 이 await 만 무기한이라,
      //   응답이 끝내 안 오는 네트워크에서 커버가 영원히 남았다. 커버엔 뒤로가기가 없고
      //   위 `if (entering) return` 이 재시도까지 막아 앱 재시작 말고는 빠져나갈 길이 없었다.
      const res = await withTimeout(sess.switchUnit(uid), ENTER_TIMEOUT_MS);
      // 전환이 안 끝났으면 진입하지 않는다 — 덜 채워진 화면은 괜찮지만 **다른 매장** 화면은 안 된다.
      // 커버를 걷고 매장 목록으로 돌려보낸다(무음으로 넘기지 않는다).
      if (res === 'timeout') {
        set({ entering: null });
        showToast('연결이 느려서 매장을 열지 못했어요. 잠시 후 다시 눌러 주세요', 'warn');
        return;
      }
      // 전환 실패 시 진입하지 않는다 — 이전 매장을 "선택한 매장인 줄 알고" 보게 되는 무음 오류 방지.
      if (res.error) {
        set({ entering: null });
        showToast(res.error, 'warn');
        return;
      }
    }
    // 착지 화면이 그릴 준비가 될 때까지 커버 아래에서 채운다. 실패·지연이면 타임아웃으로 빠져나온다.
    await prefetchStoreData(canManage(useSessionStore.getState().role));
    // 0093: 역할은 매장별(A매장 매니저·B매장 직원 가능) — 전환 '후'의 세션 역할로 착지 화면을 정한다.
    router.replace(canManage(useSessionStore.getState().role) ? '/owner/dashboard' : '/junior/home');
    // 착지 화면이 그려진 뒤 커버를 걷는다(먼저 걷으면 빈 상태가 한 프레임 스친다).
    set({ entering: null });
  },
}));
