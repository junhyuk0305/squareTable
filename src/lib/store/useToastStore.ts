// 전역 토스트 — 성공/경고/안내처럼 "잠깐 떴다 사라지는" 알림.
// 저장 실패(빨강 배너)는 useSyncStore(SyncBanner)가 따로 담당한다. 이쪽은 긍정·안내 톤.
import { create } from 'zustand';

export type ToastTone = 'good' | 'warn' | 'info';

/**
 * 되돌리기 버튼 — 되돌릴 수 있는 동작에 확인 모달을 새로 만들지 않기 위한 자리다
 * (워딩 §4: "실행 + 실행취소 토스트"). 버튼이 있으면 읽고 누를 시간이 필요해 더 오래 띄운다.
 */
export type ToastAction = { label: string; onPress: () => void };

type ToastState = {
  message: string | null;
  tone: ToastTone;
  action: ToastAction | null;
  /** 메시지를 띄우고 일정 시간 뒤 자동으로 지운다(기본 2.4초, 되돌리기 버튼이 있으면 6초). */
  show: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  clear: () => void;
};

let _timer: ReturnType<typeof setTimeout> | null = null;
const PLAIN_MS = 2400;
const ACTION_MS = 6000;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: 'good',
  action: null,
  show: (message, tone = 'good', action) => {
    if (_timer) clearTimeout(_timer);
    set({ message, tone, action: action ?? null });
    _timer = setTimeout(() => set({ message: null, action: null }), action ? ACTION_MS : PLAIN_MS);
  },
  clear: () => {
    if (_timer) clearTimeout(_timer);
    _timer = null;
    set({ message: null, action: null });
  },
}));

/** 컴포넌트 밖(스토어 액션 등)에서 토스트를 띄우는 단축 헬퍼. */
export const showToast = (message: string, tone?: ToastTone, action?: ToastAction) =>
  useToastStore.getState().show(message, tone, action);
