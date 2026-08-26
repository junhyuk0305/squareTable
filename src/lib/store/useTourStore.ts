// 코치마크 투어 '본 적 있음' 플래그 — 기기 단위 로컬 영속(계정 아님).
// ★웹=localStorage / 네이티브=AsyncStorage. 예전엔 `window.localStorage` 만 봐서 네이티브에선
//   저장이 조용히 no-op 이었고, 앱을 껐다 켤 때마다 투어가 다시 떴다(감사 #51과 같은 원인).
//   플랫폼 분기는 storage/authStorage(.web).ts 한 곳에만 있다.
// 투어는 한 번 끝내거나 건너뛰면 다시 자동으로 뜨지 않는다.
import { create } from 'zustand';
import { authStorage } from '@/lib/storage/authStorage';
import { settleWithin } from '@/lib/store/realtimeSync';

const KEY = 'sqt.tour.v1';

/** 기기 저장소 읽기 상한(ms) — usePreferencesStore 와 같은 이유로 짧게. */
const TOUR_HYDRATE_MAX_MS = 3000;

type Seen = Record<string, boolean>;

async function load(): Promise<Seen> {
  try {
    const raw = await authStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Seen) : {};
  } catch {
    return {};
  }
}

type TourState = {
  seen: Seen;
  /** true = 읽기 **시도가 끝남**. 이 전에는 "안 봤다"가 사실이 아니다 — 화면은 이걸 보고 투어를 켠다. */
  loaded: boolean;
  hydrate: () => Promise<void>;
  markSeen: (id: string) => void;
};

export const useTourStore = create<TourState>((set, get) => ({
  seen: {},
  loaded: false,
  hydrate: async () => {
    if (get().loaded) return;
    set({ seen: await settleWithin(TOUR_HYDRATE_MAX_MS, load(), () => ({})), loaded: true });
  },
  markSeen: (id) => {
    const seen = { ...get().seen, [id]: true };
    set({ seen });
    void Promise.resolve(authStorage.setItem(KEY, JSON.stringify(seen))).catch(() => {
      /* 기기 저장 실패는 이번 세션만 잃는다 — 화면을 막지 않는다. */
    });
  },
}));

/** 특정 투어를 이미 봤는지(셀렉터). */
export const useTourSeen = (id: string) => useTourStore((s) => !!s.seen[id]);
