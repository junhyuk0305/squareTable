// 전면 무료 공지 — 무료 기간 안내를 기기당 1회 띄운다.
// 노출 조건 = 서버 스위치(app_config.billing_free_mode → 세션 freeMode). 스위치를 끄면 즉시 사라진다
// (문구가 과금 상태와 모순되는 일이 구조적으로 안 생긴다). 재공지가 필요하면 NOTICE_KEY 버전을 올린다.
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FREE_PROMO } from '@/lib/config/tiers';
import { useSessionStore } from '@/lib/store/useSessionStore';

const NOTICE_KEY = 'sqt.notice.free-until.v3';

const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

// 이미 확인한 기기면 false, 저장소 접근 불가(네이티브/시크릿 등)면 1회 노출(true).
function seenBefore(): boolean {
  try {
    return !!storage?.getItem(NOTICE_KEY);
  } catch {
    return false;
  }
}

export function FreeUntilNotice() {
  const freeMode = useSessionStore((s) => s.freeMode);
  // 첫 렌더에 동기로 결정 — '이 기기에서 봤는가'만 마운트 시점에 고정하고,
  // 무료 모드 여부는 세션 값이라 서버에서 로드되면 그때 뜬다.
  const [dismissed, setDismissed] = useState(seenBefore);

  const dismiss = () => {
    try {
      storage?.setItem(NOTICE_KEY, '1');
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  return (
    <ConfirmModal
      visible={freeMode && !dismissed}
      icon="gift-outline"
      title={FREE_PROMO.headline}
      message={`${FREE_PROMO.until}까지는 모든 기능을 무료로 쓰실 수 있어요.\n매장 수·직원 수 제한도 없어요. 이후 요금제 전환은 미리 안내드릴게요.`}
      confirmLabel="좋아요"
      hideCancel
      onConfirm={dismiss}
      onCancel={dismiss}
    />
  );
}
