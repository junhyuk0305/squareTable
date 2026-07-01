// 출시 전 무료 공지 — "이번 주까지 무료" 안내를 기기당 1회 띄운다.
// 정식 유료 전환 전 런웨이 고지용. 확인을 누르면 localStorage에 표시해 다시 뜨지 않는다.
// 재공지가 필요하면 NOTICE_KEY의 버전을 올린다(v1 → v2).
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';

const NOTICE_KEY = 'sqt.notice.free-until.v1';

const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

// 이번 주 일요일(주 마감)을 M/D 문자열로. 주말 프로모션 마감일을 사람이 읽기 쉽게 보여준다.
function endOfWeekLabel(): string {
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7; // 0=일요일
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return `${sunday.getMonth() + 1}/${sunday.getDate()}`;
}

// 이미 확인한 기기면 false. 접근 불가(네이티브/시크릿 등)면 1회 노출(true).
function shouldShow(): boolean {
  try {
    return !storage?.getItem(NOTICE_KEY);
  } catch {
    return true;
  }
}

export function FreeUntilNotice() {
  // 첫 렌더에 동기로 결정 — effect 없이 마운트 시점에 노출 여부 확정.
  const [visible, setVisible] = useState(shouldShow);
  const [label] = useState(endOfWeekLabel);

  const dismiss = () => {
    try {
      storage?.setItem(NOTICE_KEY, '1');
    } catch {
      /* noop */
    }
    setVisible(false);
  };

  return (
    <ConfirmModal
      visible={visible}
      icon="gift-outline"
      title="이번 주까지 무료예요"
      message={`스퀘어테이블을 정식 서비스로 준비하고 있어요.\n이번 주 일요일(${label})까지는 모든 기능을 무료로 써보실 수 있어요. 이후 유료 전환은 미리 안내드릴게요.`}
      confirmLabel="좋아요"
      hideCancel
      onConfirm={dismiss}
      onCancel={dismiss}
    />
  );
}
