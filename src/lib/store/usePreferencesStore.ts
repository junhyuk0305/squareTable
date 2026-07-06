// 사용자 환경설정 — 알림/글자크기 등 기기 단위 선호. DB가 아니라 로컬에 영속한다.
// (계정이 아니라 "이 기기에서의 보기 설정"이라 localStorage가 맞다. 네이티브는 메모리 폴백.)
import { create } from 'zustand';

export type TextScale = 'small' | 'normal' | 'large' | 'xlarge';

type Prefs = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHours: boolean; // 방해 금지 시간 사용 여부
  quietStart: string; // "HH:MM" — 방해 금지 시작 (사용자 직접 입력)
  quietEnd: string; // "HH:MM" — 방해 금지 종료
  textScale: TextScale;
};

const KEY = 'sqt.prefs.v1';
const DEFAULTS: Prefs = {
  pushEnabled: true,
  emailEnabled: false,
  quietHours: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  textScale: 'normal',
};

const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

function load(): Prefs {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

type PrefsState = Prefs & {
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  toggle: (key: 'pushEnabled' | 'emailEnabled' | 'quietHours') => void;
};

// 체감되는 간격으로 벌린다(예전 0.92/1/1.12는 8% 차이라 "눌러도 안 변한다"는 인상). 매장 사장은
// 나이대가 다양해 접근성용 '아주 크게'까지 둔다.
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = { small: 0.9, normal: 1, large: 1.18, xlarge: 1.34 };

export const usePreferencesStore = create<PrefsState>((set, get) => ({
  ...load(),
  set: (key, value) => {
    set({ [key]: value } as Partial<Prefs>);
    persist(get());
  },
  toggle: (key) => {
    set({ [key]: !get()[key] } as Partial<Prefs>);
    persist(get());
  },
}));

function persist(state: PrefsState) {
  try {
    const { pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale } = state;
    storage?.setItem(
      KEY,
      JSON.stringify({ pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale }),
    );
  } catch {
    /* noop */
  }
}
