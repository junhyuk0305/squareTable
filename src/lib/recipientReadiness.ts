// recipientReadiness.ts — "상대가 받을 수 없는 상태"를 보내는 쪽이 말하는 문구 표 한 곳(패턴 P5 · 0309).
//
// 서버 recipient_readiness 의 blocked_reason 과 quiz_send_status 의 reason 을 사람 말로 바꾼다.
// 퀴즈 결과 줄 · 퀴즈 보내기 · 할일 배정 · 공지 발송이 전부 이 표를 쓴다(화면마다 문구를 짓지 않는다).
// 사실만 말한다. 보내기는 막지 않는다 — 사장이 고칠 수 없는 전제(직원이 앱을 깔아야 함)가 대부분이다.

/** 서버가 돌려주는 이유 코드. 앞의 셋 = recipient_readiness(0309) · auto_stopped = quiz_send_status(0274). */
export type ReadinessReason = 'no_device' | 'push_off' | 'not_scheduled' | 'auto_stopped';

export type RecipientReadiness = {
  userId: string;
  hasDevice: boolean;
  pushOn: boolean;
  onSchedule: boolean;
  blockedReason: Exclude<ReadinessReason, 'auto_stopped'> | null;
  /** 최근 7일 발송 2건 상한에서 남은 수(0301 ③). 0 이면 새 발송이 이번 창에선 안 나간다. */
  weeklyQuotaLeft: number;
};

/** 받는 사람 줄(퀴즈 결과 탭)에 붙는 한 줄. */
const ROW_TEXT: Record<ReadinessReason, string> = {
  no_device: '알림 받을 기기가 없어요',
  push_off: '알림을 꺼 두었어요',
  not_scheduled: '근무표에 없어 대기 중',
  auto_stopped: '두 번 안 열어 멈춤 · 열면 다시 나가요',
};

/** 보내는 쪽 요약("N명은 …")에 붙는 술어. */
const SUM_TEXT: Record<Exclude<ReadinessReason, 'auto_stopped'>, string> = {
  no_device: '알림 받을 기기가 없어요',
  push_off: '알림을 꺼 두었어요',
  not_scheduled: '근무표에 없어 아직 안 나가요',
};

export function readinessText(reason: ReadinessReason | null | undefined): string | null {
  return reason ? ROW_TEXT[reason] : null;
}

/**
 * 보낸 직후 토스트에 붙일 한 줄. 받을 수 없는 사람이 없으면 null.
 * 예) "2명은 알림 받을 기기가 없어요 · 1명은 알림을 꺼 두었어요"
 * `schedule` 이 true 일 때만 근무표 사유를 센다(퀴즈는 근무 시간에 나가므로 해당 · 할일·공지는 바로 가므로 비해당).
 */
export function unreachableNote(rows: RecipientReadiness[], opts?: { schedule?: boolean }): string | null {
  const n: Record<keyof typeof SUM_TEXT, number> = { no_device: 0, push_off: 0, not_scheduled: 0 };
  for (const r of rows) {
    if (!r.blockedReason) continue;
    if (r.blockedReason === 'not_scheduled' && !opts?.schedule) continue;
    n[r.blockedReason] += 1;
  }
  const parts = (Object.keys(SUM_TEXT) as (keyof typeof SUM_TEXT)[])
    .filter((k) => n[k] > 0)
    .map((k) => `${n[k]}명은 ${SUM_TEXT[k]}`);
  return parts.length ? parts.join(' · ') : null;
}
