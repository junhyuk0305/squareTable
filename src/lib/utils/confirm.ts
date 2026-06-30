// 파괴적 동작 확인 / 정보 고지 — 시스템 alert·confirm(브라우저 window / 네이티브 Alert) 대신
// 모바일 프레임 안의 앱 내 모달(useDialogStore→<DialogHost/>)로 띄운다. Promise 반환은 그대로.
import type { Ionicons } from '@expo/vector-icons';
import { useDialogStore } from '@/lib/store/useDialogStore';

type IconName = keyof typeof Ionicons.glyphMap;
type ConfirmOptions = { destructive?: boolean; icon?: IconName; cancelLabel?: string; accent?: string };

/** 확인/취소 두 버튼. 확인=true, 취소·바깥탭=false. */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = '확인',
  opts: ConfirmOptions = {},
): Promise<boolean> {
  return useDialogStore.getState().open({ title, message, confirmLabel, ...opts });
}

/** 정보 고지(단일 '확인' 버튼). 닫히면 resolve. */
export function notifyAction(
  title: string,
  message: string,
  label = '확인',
  opts: Pick<ConfirmOptions, 'icon' | 'accent'> = {},
): Promise<void> {
  return useDialogStore.getState().open({ title, message, confirmLabel: label, hideCancel: true, ...opts }).then(() => {});
}
