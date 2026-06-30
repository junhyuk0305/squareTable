// 전역 확인/고지 다이얼로그 호스트 — useDialogStore의 현재 요청을 ConfirmModal로 렌더한다.
// _layout 최상단(프레임 안)에 1회 마운트. 시스템 alert/confirm을 앱 내 모달로 대체한다.
import { ConfirmModal } from '@/components/ConfirmModal';
import { useDialogStore } from '@/lib/store/useDialogStore';

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const close = useDialogStore((s) => s.close);

  return (
    <ConfirmModal
      visible={!!current}
      title={current?.title ?? ''}
      message={current?.message ?? ''}
      confirmLabel={current?.confirmLabel}
      cancelLabel={current?.cancelLabel}
      destructive={current?.destructive}
      icon={current?.icon}
      accent={current?.accent}
      hideCancel={current?.hideCancel}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
}
