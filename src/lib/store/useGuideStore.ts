// 사용 안내 팝업 가이드의 요청 큐 — _layout 에 <GuideHost/> 1회 마운트(useDialogStore 와 같은 배치).
// '본 적 있음'은 여기서 새로 저장하지 않고 useTourStore 를 그대로 쓴다 —
// 저장소가 둘이면 '다시 보기'·QA 초기화가 두 벌이 된다.
import { useEffect } from 'react';
import { create } from 'zustand';

import { SHOW_GUIDE_POPUP } from '@/lib/config/store-policy';
import { GUIDE_IDS_BY_ROLE, type GuideId } from '@/lib/guides/guideContent';
import { useTourStore } from '@/lib/store/useTourStore';
import { useOverlayFree } from '@/lib/store/useOverlayStore';

/** 진입 애니메이션이 자리 잡은 뒤 띄운다(대시보드 코치마크와 같은 값). */
const OPEN_DELAY_MS = 520;

type GuideState = {
  current: GuideId | null;
  /** 이번 세션에 가이드를 이미 한 번 띄웠는가 — 탭을 옮길 때마다 연달아 뜨는 것을 막는다. */
  shownThisSession: boolean;
  request: (id: GuideId) => void;
  close: () => void;
};

export const useGuideStore = create<GuideState>((set, get) => ({
  current: null,
  shownThisSession: false,
  request: (id) => {
    // 큐를 쌓지 않는다 — 이미 떠 있거나 이번 세션에 한 번 띄웠으면 다음 진입으로 미룬다.
    if (get().current || get().shownThisSession) return;
    set({ current: id, shownThisSession: true });
  },
  close: () => {
    const id = get().current;
    if (!id) return;
    // 끝까지 봤든 건너뛰었든 '본 적 있음'이다 — 건너뛴 사람에게 다시 띄우면 그게 더 방해다.
    useTourStore.getState().markSeen(id);
    set({ current: null });
  },
}));

/**
 * 설정의 '사용 안내 다시 보기' — 그 역할의 '본 적 있음'을 지운다.
 * `shownThisSession` 도 함께 푼다. 안 그러면 눌러도 앱을 껐다 켜기 전엔 아무 일도 안 일어난다.
 */
export function replayGuides(role: 'owner' | 'junior') {
  useTourStore.getState().forget(GUIDE_IDS_BY_ROLE[role]);
  useGuideStore.setState({ shownThisSession: false });
}

/**
 * 화면 진입 시 가이드를 한 번 띄운다.
 *
 * `ready` 는 **그 화면의 데이터 로딩이 끝났다**는 신호를 넘긴다(로딩 게이트와 같은 값).
 * 넘기지 않으면 이미 잘 쓰고 있는 사용자에게도 깜빡 떴다 닫힌다 — 대시보드가 겪은 그 버그다.
 */
export function useGuideOnce(id: GuideId, ready: boolean) {
  const hydrate = useTourStore((s) => s.hydrate);
  const tourLoaded = useTourStore((s) => s.loaded);
  const seen = useTourStore((s) => !!s.seen[id]);
  const request = useGuideStore((s) => s.request);
  const overlayFree = useOverlayFree();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    // ★tourLoaded 전의 seen=false 는 사실이 아니다 — 네이티브는 AsyncStorage 라 비동기로 온다.
    // ★overlayFree: 앞 장(직원 환영 코치)이 떠 있으면 기다린다 — 겹치면 둘 다 안 읽힌다.
    //   '본 적 있음'을 세우지 않고 기다리므로, 앞 장이 닫히면 이 effect 가 다시 돌아 그때 뜬다.
    if (!SHOW_GUIDE_POPUP || !ready || !tourLoaded || seen || !overlayFree) return;
    const t = setTimeout(() => request(id), OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [id, ready, tourLoaded, seen, overlayFree, request]);
}
