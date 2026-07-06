// 사용자 환경설정 — 알림/글자크기 등 기기 단위 선호. DB가 아니라 로컬에 영속한다.
// (계정이 아니라 "이 기기에서의 보기 설정"이라 localStorage가 맞다. 네이티브는 메모리 폴백.)
import { create } from 'zustand';

export type TextScale = 'small' | 'normal' | 'large';

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

// 예전엔 4단계('아주 크게'=xlarge)였다 → 3단계(작게/보통/크게)로 축소. 기기에 xlarge가 저장돼
// 있으면 없는 배율을 참조해 NaN이 되므로, 폐기 값은 안전하게 'large'로 접어 마이그레이션한다.
function normalizeScale(v: unknown): TextScale {
  if (v === 'small' || v === 'normal' || v === 'large') return v;
  return v === 'xlarge' ? 'large' : 'normal';
}

function load(): Prefs {
  try {
    const raw = storage?.getItem(KEY);
    const merged = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    return { ...merged, textScale: normalizeScale(merged.textScale) };
  } catch {
    return DEFAULTS;
  }
}

type PrefsState = Prefs & {
  // 글자 크기 전환 중 상태(영속 X) — 로딩 오버레이 표시/커밋 타이밍 제어.
  applyingScale: boolean;
  pendingScale: TextScale | null;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  toggle: (key: 'pushEnabled' | 'emailEnabled' | 'quietHours') => void;
  // 3단계 전환: begin(오버레이 표시) → commit(배율 반영=트리 리마운트) → end(오버레이 내림).
  beginTextScale: (key: TextScale) => void;
  commitPendingScale: () => void;
  endTextScale: () => void;
};

// 체감되는 간격으로 벌린다(예전 0.92/1/1.12는 8% 차이라 "눌러도 안 변한다"는 인상).
// '아주 크게'(1.34)는 고정폭 카드 오버플로 위험이 커 폐기 → 3단계만 유지(회의 요청).
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = { small: 0.9, normal: 1, large: 1.18 };

export const usePreferencesStore = create<PrefsState>((set, get) => ({
  ...load(),
  applyingScale: false,
  pendingScale: null,
  set: (key, value) => {
    set({ [key]: value } as Partial<Prefs>);
    persist(get());
  },
  toggle: (key) => {
    set({ [key]: !get()[key] } as Partial<Prefs>);
    persist(get());
  },
  // 글자 크기는 즉시 반영하면 _layout의 Stack(key=textScale)이 통째로 리마운트되며 열린 시트가
  // 사라지고 화면이 깜빡인다. 그 리마운트를 로딩 오버레이 뒤로 숨기려 3단계로 나눈다.
  beginTextScale: (key) => {
    if (key === get().textScale) return; // 같은 값이면 전환 없이 무시
    set({ applyingScale: true, pendingScale: key });
  },
  commitPendingScale: () => {
    const p = get().pendingScale;
    if (!p) return;
    set({ textScale: p, pendingScale: null });
    persist(get());
  },
  endTextScale: () => set({ applyingScale: false, pendingScale: null }),
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
