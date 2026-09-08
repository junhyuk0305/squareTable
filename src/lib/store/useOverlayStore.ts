// 첫 진입에 겹치던 오버레이들을 한 줄로 세운다(첫 사용 워크스루 #20).
//
// ★문제: 웹에서 직원이 합류 직후 홈에 처음 들어오면 팝업이 최대 셋 뜬다 —
//   ① 환영 코치(JuniorWelcomeCoach, 즉시) ② 사용 안내 팝업(GuideHost, 520ms)
//   ③ 알림 켜기 시트(NotificationPermissionSheet, 1200ms).
//   순서를 보장하는 코드가 없어 겹치거나 연달아 떴고, 겹치면 셋 다 안 읽힌다.
//
// ★규칙은 하나다: **떠 있는 것이 하나라도 있으면 다음 것은 기다린다. 닫히면 그때 뜬다.**
//   우선순위는 각자의 지연시간(0 < 520 < 1200)이 이미 정하고 있어 여기서 또 정하지 않는다.
//   기다리는 쪽은 '본 적 있음'을 세우지 않으므로, 앞의 것이 닫히면 같은 세션에서 그대로 이어 뜬다.
import { create } from 'zustand';

type OverlayState = {
  /** 지금 화면을 덮고 있는 오버레이 id 들. */
  open: string[];
  enter: (id: string) => void;
  exit: (id: string) => void;
};

export const useOverlayStore = create<OverlayState>((set) => ({
  open: [],
  enter: (id) => set((s) => (s.open.includes(id) ? s : { open: [...s.open, id] })),
  exit: (id) => set((s) => ({ open: s.open.filter((x) => x !== id) })),
}));

/** 지금 덮고 있는 것이 없는가 — 다음 장이 뜰 수 있는 조건. */
export function useOverlayFree(): boolean {
  return useOverlayStore((s) => s.open.length === 0);
}
