// 전역 토스트 — 성공/경고/안내처럼 "잠깐 떴다 사라지는" 알림.
// 저장 실패(빨강 배너)는 useSyncStore(SyncBanner)가 따로 담당한다. 이쪽은 긍정·안내 톤.
import { create } from 'zustand';

export type ToastTone = 'good' | 'warn' | 'info';

type ToastState = {
  message: string | null;
  tone: ToastTone;
  /** 메시지를 띄우고 일정 시간 뒤 자동으로 지운다(기본 2.4초). */
  show: (message: string, tone?: ToastTone) => void;
  clear: () => void;
};

let _timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: 'good',
  show: (message, tone = 'good') => {
    if (_timer) clearTimeout(_timer);
    set({ message, tone });
    _timer = setTimeout(() => set({ message: null }), 2400);
  },
  clear: () => {
    if (_timer) clearTimeout(_timer);
    _timer = null;
    set({ message: null });
  },
}));

/** 컴포넌트 밖(스토어 액션 등)에서 토스트를 띄우는 단축 헬퍼. */
export const showToast = (message: string, tone?: ToastTone) => useToastStore.getState().show(message, tone);
