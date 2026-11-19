// recipientReadiness.ts — "상대가 받을 수 없는 상태"를 보내는 쪽이 말하는 문구 표 한 곳(패턴 P5 · 0309).
//
// 서버 recipient_readiness 의 blocked_reason 과 quiz_send_status 의 reason 을 사람 말로 바꾼다.
// 퀴즈 결과 줄 · 퀴즈 보내기 · 할일 배정 · 공지 발송이 전부 이 표를 쓴다(화면마다 문구를 짓지 않는다).
// 사실만 말한다. 보내기는 막지 않는다 — 사장이 고칠 수 없는 전제(직원이 앱을 깔아야 함)가 대부분이다.
// ★0931: 근무표(not_scheduled)·자동 정지(auto_stopped)는 서버가 더 보지 않아 뺐다. 옛 앱은 그 코드를 계속 알지만 서버가 안 보낸다.

import type { QuizSendBlock } from '@/lib/db';

/** recipient_readiness(0309 · 0931) 의 이유 코드. */
export type DeviceReason = 'no_device' | 'push_off';
/** 사람 줄에 붙는 이유 코드 = 기기 이유 + quiz_send_status(0931) 이유. */
export type ReadinessReason = DeviceReason | QuizSendBlock;

export type RecipientReadiness = {
  userId: string;
  hasDevice: boolean;
  pushOn: boolean;
  blockedReason: DeviceReason | null;
};

/**
 * 받는 사람 줄(퀴즈 결과 탭)에 붙는 한 줄.
 * quiet = 옛 서버(0931~0959)만 보낸다. 0960 부터 방해금지는 퀴즈를 막지 않는다(카드는 제시각 · 푸시만 끝나고 요약 1건).
 * 0960 이 라이브에 오르기 전 서버와 같이 돌 수 있어 문구를 남긴다.
 */
const ROW_TEXT: Record<ReadinessReason, string> = {
  no_device: '알림 받을 기기가 없어요',
  push_off: '알림을 꺼 두었어요',
  quiet: '방해금지가 끝나면 가요',
  seat_locked: '인원 한도를 넘어 안 가요',
  due_passed: '마감이 지나 안 가요',
  store_locked: '매장 이용이 멈춰 안 가요',
};

/** 보내는 쪽 요약("N명은 …")에 붙는 술어. */
const SUM_TEXT: Record<DeviceReason, string> = {
  no_device: '알림 받을 기기가 없어요',
  push_off: '알림을 꺼 두었어요',
};

export function readinessText(reason: ReadinessReason | null | undefined): string | null {
  return reason ? ROW_TEXT[reason] ?? null : null;
}

/**
 * 보낸 직후 토스트에 붙일 한 줄. 받을 수 없는 사람이 없으면 null.
 * 예) "2명은 알림 받을 기기가 없어요 · 1명은 알림을 꺼 두었어요"
 */
export function unreachableNote(rows: RecipientReadiness[]): string | null {
  const n: Record<DeviceReason, number> = { no_device: 0, push_off: 0 };
  for (const r of rows) {
    if (r.blockedReason && r.blockedReason in n) n[r.blockedReason] += 1;
  }
  const parts = (Object.keys(SUM_TEXT) as DeviceReason[])
    .filter((k) => n[k] > 0)
    .map((k) => `${n[k]}명은 ${SUM_TEXT[k]}`);
  return parts.length ? parts.join(' · ') : null;
}
