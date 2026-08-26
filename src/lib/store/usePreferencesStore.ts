// 사용자 환경설정.
// - textScale/emailEnabled 는 "이 기기에서의 보기 설정" → 기기 로컬 영속.
//   ★웹=localStorage / 네이티브=AsyncStorage. 예전엔 `window.localStorage` 만 봐서 네이티브에선
//   storage 가 undefined 라 load()/persist() 가 **조용히 아무 일도 안 했다** — 글자 크기를 바꿔도
//   앱을 껐다 켜면 원래대로 돌아갔다(감사 #51). 접근성 설정이라 그게 필요한 사람이 매번 다시 해야 했다.
//   플랫폼 분기는 storage/authStorage(.web).ts **한 곳**에만 있다 — 여기서 다시 분기하지 않는다.
// - pushEnabled(계정 전역 푸시 수신 동의)는 서버(엣지 push)가 발송 직전에 읽으므로 DB(notification_prefs)가
//   SSOT다. localStorage 는 즉시 렌더용 캐시일 뿐이고, 진실은 DB다.
// - ⚠️ quietHours/quietStart/quietEnd(전역 방해금지)는 **레거시 미러**: 1b(0076)에서 방해금지 판정이
//   매장별 unit_member_prefs 로 이관돼 엣지도 UI 도 더 안 쓴다. 그런데 saveNotify 가 "전체 선호를 한
//   트랜잭션으로" 저장하는 구조라, 필드를 지우면 푸시 토글 저장이 DB 의 기존 quiet 값을 기본값으로
//   덮어쓴다 → 라운드트립 보존용으로만 유지한다. 새 소비처 추가 금지(매장별은 useMemberPrefsStore).
import { create } from 'zustand';
import { fetchNotificationPrefs, saveNotificationPrefs } from '@/lib/db';
import { authStorage } from '@/lib/storage/authStorage';
import { settleWithin } from '@/lib/store/realtimeSync';

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

// 예전엔 4단계('아주 크게'=xlarge)였다 → 3단계(작게/보통/크게)로 축소. 기기에 xlarge가 저장돼
// 있으면 없는 배율을 참조해 NaN이 되므로, 폐기 값은 안전하게 'large'로 접어 마이그레이션한다.
function normalizeScale(v: unknown): TextScale {
  if (v === 'small' || v === 'normal' || v === 'large') return v;
  return v === 'xlarge' ? 'large' : 'normal';
}

/** 기기에 저장된 설정을 읽는다. 네이티브(AsyncStorage)는 비동기라 await 로 통일한다. */
async function load(): Promise<Prefs> {
  try {
    const raw = await authStorage.getItem(KEY);
    const merged = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    return { ...merged, textScale: normalizeScale(merged.textScale) };
  } catch {
    return DEFAULTS;
  }
}

type PrefsState = Prefs & {
  /** true = 기기 저장소 읽기 **시도가 끝남**(성공·실패 무관). 화면은 이게 true 가 된 뒤에 그린다 —
   *  아니면 기본 배율로 한 번 그렸다가 저장된 배율로 튄다(AsyncStorage 는 비동기다). */
  loaded: boolean;
  /** 부팅 1회 — 기기에 저장된 설정을 당긴다. */
  hydrateLocal: () => Promise<void>;
  // 글자 크기 전환 중 상태(영속 X) — 로딩 오버레이 표시/커밋 타이밍 제어.
  applyingScale: boolean;
  pendingScale: TextScale | null;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  // 로컬 전용 토글은 emailEnabled 뿐. push/quiet 는 DB SSOT 라 반드시 saveNotify 로만 바꾼다(무단 로컬변경 차단).
  toggle: (key: 'emailEnabled') => void;
  // 알림 선호(push/quiet) — 로그인 시 DB에서 하이드레이트. 저장은 원자적 upsert RPC 한 번(부분 저장 없음)이며
  //   낙관적 반영 후 실패 시 롤백하고 error 를 돌려준다(설정된 듯 보이나 서버엔 없는 무음 유실 방지).
  hydrateNotify: () => Promise<void>;
  saveNotify: (
    patch: Partial<Pick<Prefs, 'pushEnabled' | 'quietHours' | 'quietStart' | 'quietEnd'>>,
  ) => Promise<{ error: string | null }>;
  // 3단계 전환: begin(오버레이 표시) → commit(배율 반영=트리 리마운트) → end(오버레이 내림).
  beginTextScale: (key: TextScale) => void;
  commitPendingScale: () => void;
  endTextScale: () => void;
};

// 체감되는 간격으로 벌린다(예전 0.92/1/1.12는 8% 차이라 "눌러도 안 변한다"는 인상).
// '아주 크게'(1.34)는 고정폭 카드 오버플로 위험이 커 폐기 → 3단계만 유지(회의 요청).
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = { small: 0.9, normal: 1, large: 1.18 };

/**
 * 기기 저장소 읽기 상한(ms). 네트워크용 HYDRATE_TIMEOUT_MS(15s)보다 훨씬 짧게 잡는다 —
 * 로컬 디스크 한 키 읽기고, 무엇보다 **스플래시의 탈출 타이머(BOOT_HOLD_MAX_MS=5s)보다 먼저**
 * 결판나야 한다. 늦게 결판나면 기본 배율로 화면이 뜬 뒤 저장된 배율로 튄다.
 */
const PREFS_HYDRATE_MAX_MS = 3000;

/** hydrateNotify(DB) 가 먼저 끝났는가 — 늦게 도착한 기기 캐시가 DB 값을 되돌리지 않게 하는 표식. */
let notifyHydrated = false;

export const usePreferencesStore = create<PrefsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  applyingScale: false,
  pendingScale: null,
  hydrateLocal: async () => {
    if (get().loaded) return;
    // 끝나지 않는 읽기가 부팅을 영영 붙잡지 않게 상한을 둔다(loaded 계약: 시도가 끝났다).
    const stored = await settleWithin(PREFS_HYDRATE_MAX_MS, load(), () => DEFAULTS);
    // push/quiet 는 DB 가 SSOT 다. DB 하이드레이트가 먼저 끝났으면 그 값을 기기 캐시로 덮지 않는다.
    const { pushEnabled, quietHours, quietStart, quietEnd, ...local } = stored;
    set(notifyHydrated ? { ...local, loaded: true } : { ...stored, loaded: true });
  },
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

  // 로그인 후 1회: DB의 알림 선호를 캐시로 당긴다. 읽기 실패/미설정이면 로컬(기본값) 유지 —
  // 일시적 읽기실패에 설정을 무음 강등하지 않는다(§4.8). 미설정 유저는 엣지도 기본=켜짐으로 취급.
  hydrateNotify: async () => {
    const { data, error } = await fetchNotificationPrefs();
    if (error || !data) return;
    notifyHydrated = true;
    set({
      pushEnabled: data.push_enabled,
      quietHours: data.quiet_enabled,
      quietStart: data.quiet_start,
      quietEnd: data.quiet_end,
    });
    persist(get());
  },

  // 알림 선호 저장 — 항상 현재 전체 선호를 한 번의 upsert RPC(=한 트랜잭션)로 확정한다.
  // 낙관적 반영으로 UI 즉시 갱신 후, 서버 저장 실패 시 이전 값으로 롤백하고 error 메시지를 반환한다.
  saveNotify: async (patch) => {
    const prev = get();
    const next = {
      pushEnabled: patch.pushEnabled ?? prev.pushEnabled,
      quietHours: patch.quietHours ?? prev.quietHours,
      quietStart: patch.quietStart ?? prev.quietStart,
      quietEnd: patch.quietEnd ?? prev.quietEnd,
    };
    set(next);
    persist(get());
    const { error } = await saveNotificationPrefs({
      push_enabled: next.pushEnabled,
      quiet_enabled: next.quietHours,
      quiet_start: next.quietStart,
      quiet_end: next.quietEnd,
    });
    if (error) {
      set({
        pushEnabled: prev.pushEnabled,
        quietHours: prev.quietHours,
        quietStart: prev.quietStart,
        quietEnd: prev.quietEnd,
      });
      persist(get());
      return { error: error.message };
    }
    return { error: null };
  },
}));

function persist(state: PrefsState) {
  // ★읽기 전에는 쓰지 않는다 — 하이드레이트가 끝나기 전 저장하면 기본값이 저장된 설정을 덮는다.
  if (!state.loaded) return;
  const { pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale } = state;
  const json = JSON.stringify({ pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale });
  // 웹 구현은 동기(void), 네이티브는 Promise — Promise.resolve 로 감싸 한 경로로 다룬다.
  void Promise.resolve(authStorage.setItem(KEY, json)).catch(() => {
    /* 기기 저장 실패는 이번 세션 값만 잃는다 — 화면을 막지 않는다. */
  });
}
