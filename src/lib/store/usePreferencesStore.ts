// 사용자 환경설정.
// - textScale/emailEnabled 는 "이 기기에서의 보기 설정" → localStorage 로컬 영속(네이티브=메모리 폴백).
// - pushEnabled(계정 전역 푸시 수신 동의)는 서버(엣지 push)가 발송 직전에 읽으므로 DB(notification_prefs)가
//   SSOT다. localStorage 는 즉시 렌더용 캐시일 뿐이고, 진실은 DB다.
// - ⚠️ quietHours/quietStart/quietEnd(전역 방해금지)는 **레거시 미러**: 1b(0076)에서 방해금지 판정이
//   매장별 unit_member_prefs 로 이관돼 엣지도 UI 도 더 안 쓴다. 그런데 saveNotify 가 "전체 선호를 한
//   트랜잭션으로" 저장하는 구조라, 필드를 지우면 푸시 토글 저장이 DB 의 기존 quiet 값을 기본값으로
//   덮어쓴다 → 라운드트립 보존용으로만 유지한다. 새 소비처 추가 금지(매장별은 useMemberPrefsStore).
import { create } from 'zustand';
import { fetchNotificationPrefs, saveNotificationPrefs } from '@/lib/db';

export type TextScale = 'small' | 'normal' | 'large';
/** 채팅방 목록 정렬 — '이 기기에서의 보기 설정'이라 textScale 과 같은 로컬 축이다(서버 저장 없음). */
export type RoomSort = 'recent' | 'unread';

type Prefs = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHours: boolean; // 방해 금지 시간 사용 여부
  quietStart: string; // "HH:MM" — 방해 금지 시작 (사용자 직접 입력)
  quietEnd: string; // "HH:MM" — 방해 금지 종료
  textScale: TextScale;
  roomSort: RoomSort;
};

const KEY = 'sqt.prefs.v1';
const DEFAULTS: Prefs = {
  pushEnabled: true,
  emailEnabled: false,
  quietHours: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  textScale: 'normal',
  roomSort: 'recent',
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

  // 로그인 후 1회: DB의 알림 선호를 캐시로 당긴다. 읽기 실패/미설정이면 로컬(기본값) 유지 —
  // 일시적 읽기실패에 설정을 무음 강등하지 않는다(§4.8). 미설정 유저는 엣지도 기본=켜짐으로 취급.
  hydrateNotify: async () => {
    const { data, error } = await fetchNotificationPrefs();
    if (error || !data) return;
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
  try {
    const { pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale, roomSort } = state;
    storage?.setItem(
      KEY,
      JSON.stringify({ pushEnabled, emailEnabled, quietHours, quietStart, quietEnd, textScale, roomSort }),
    );
  } catch {
    /* noop */
  }
}
