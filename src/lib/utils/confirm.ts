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

/** 지난 날짜를 바꾸기 전 경고 문구(§8 Q4). 시트 안 확인 단계(ShiftQuickSheet)도 같은 문구를 쓴다. */
export const PAST_CHANGE_TITLE = '지난 기간이에요';
export const PAST_CHANGE_BODY = '그 기간 급여가 바뀌어요. 그래도 바꿀까요?';

/**
 * 지난 날짜를 바꾸기 전 경고(§8 Q4). 급여 기준이 근무표라 지난 기간을 바꾸면 이미 계산된 급여가 바뀐다.
 * 확인=true 면 서버에 p_confirm_past 를 보낸다. 서버도 이것 없이 지난 날짜를 받지 않는다.
 * ⚠️ 시트(BottomSheet)가 열린 채로 부르지 않는다 — iOS 는 Modal 위에 Modal 을 띄우지 못할 수 있다. 시트 안에서는 같은 문구로 확인 단계를 그린다.
 */
export function confirmPastChange(confirmLabel: string): Promise<boolean> {
  return confirmAction(PAST_CHANGE_TITLE, PAST_CHANGE_BODY, confirmLabel, { icon: 'alert-circle-outline' });
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
