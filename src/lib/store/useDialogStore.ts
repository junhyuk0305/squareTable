// 전역 확인/고지 다이얼로그 — 시스템 alert·confirm(브라우저/네이티브 '알람') 대신
// 모바일 프레임(460px) 안의 앱 내 ConfirmModal로 띄운다. _layout에 <DialogHost/> 1회 마운트.
// 컴포넌트 밖(스토어 액션·유틸)에서도 confirmAction/notifyAction으로 호출 가능(Toast와 동일 패턴).
import { create } from 'zustand';
import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

export type DialogRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: IconName;
  /** 본문 아래 빨강 강조 줄 — 주의/검증 필요 등 경고성 문구. */
  accent?: string;
  /** 정보 고지(단일 '확인' 버튼) — 취소 버튼을 숨긴다. */
  hideCancel?: boolean;
};

type DialogState = {
  current: (DialogRequest & { resolve: (ok: boolean) => void }) | null;
  /** 아직 닫히는 중인 시트 수(iOS). 0 이 될 때까지 DialogHost 는 다이얼로그를 띄우지 않는다. */
  dismissing: number;
  /** 시트가 닫히기 시작할 때 부른다. 돌려받은 함수를 닫힘이 끝나면 부른다(여러 번 불러도 한 번만 센다). */
  holdForDismiss: () => () => void;
  /** 다이얼로그를 띄우고 확인(true)/취소(false)를 Promise로 돌려준다. */
  open: (req: DialogRequest) => Promise<boolean>;
  /** 버튼/바깥탭으로 닫으며 대기 중인 Promise를 푼다. */
  close: (ok: boolean) => void;
};

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  // ★iOS 는 Modal 이 닫히는 애니메이션 중에 다른 Modal 을 띄우면 새 것이 뜨지 않는다(2026-10-02 native-audit:
  // 본사 연결 해제 사유 시트를 닫으며 확인창을 열면 확인창이 사라져 해제가 안 됐다). 시트 닫힘이 끝날 때까지 기다린다.
  dismissing: 0,
  holdForDismiss: () => {
    set((s) => ({ dismissing: s.dismissing + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ dismissing: Math.max(0, s.dismissing - 1) }));
    };
  },
  open: (req) =>
    new Promise<boolean>((resolve) => {
      // 이미 떠 있는 다이얼로그가 있으면 이전 건을 '취소'로 정리하고 교체(겹침 방지·Promise 유실 방지).
      const prev = get().current;
      if (prev) prev.resolve(false);
      set({ current: { ...req, resolve } });
    }),
  close: (ok) => {
    const cur = get().current;
    if (!cur) return;
    cur.resolve(ok);
    set({ current: null });
  },
}));
