// 코치마크 투어 '본 적 있음' 플래그 — 기기 단위 로컬 영속(계정 아님 → localStorage).
// usePreferencesStore와 동일 패턴(웹=localStorage / 네이티브=메모리 폴백).
// 투어는 한 번 끝내거나 건너뛰면 다시 자동으로 뜨지 않는다.
import { create } from 'zustand';

const KEY = 'sqt.tour.v1';

const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

type Seen = Record<string, boolean>;

function load(): Seen {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Seen) : {};
  } catch {
    return {};
  }
}

type TourState = {
  seen: Seen;
  markSeen: (id: string) => void;
};

export const useTourStore = create<TourState>((set, get) => ({
  seen: load(),
  markSeen: (id) => {
    const seen = { ...get().seen, [id]: true };
    set({ seen });
    try {
      storage?.setItem(KEY, JSON.stringify(seen));
    } catch {
      /* noop */
    }
  },
}));

/** 특정 투어를 이미 봤는지(셀렉터). */
export const useTourSeen = (id: string) => useTourStore((s) => !!s.seen[id]);
