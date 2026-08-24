// 게스트 응시 결과 표시 조각 — 목록(/owner/training)과 상세(/owner/quiz/guest/[sub])가 공용.
//
// 두 화면이 각자 만들면 같은 사람의 번호가 한쪽은 `010-1234-5678`, 다른 쪽은 `****-5678` 로 보인다.
// 로직이 아니라 **표시 규칙**이라 db.ts 가 아니라 여기 둔다(db 는 정규화된 원문을 그대로 돌려준다).

/**
 * 전화번호는 **뒤 4자리만** 보여준다. 사장이 같은 사람인지 알아보는 데는 4자리면 충분하고,
 * 화면 캡처가 도는 상황에서 번호 전체가 남을 이유가 없다.
 * 값은 정규화된 숫자만이다(0160 — 하이픈 있는 원문이 들어올 경로가 없다).
 */
export function maskTail4(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `****-${digits.slice(-4)}` : '번호 없음';
}

/** `5문제 중 3개` — 0112 설계 문구 그대로. 점수를 백분율로 바꾸지 않는다(문항 수가 적어 과장된다). */
export function scoreText(correct: number, total: number): string {
  return total > 0 ? `${total}문제 중 ${correct}개` : '푼 문제 없음';
}

/**
 * `8월 24일`. taken_at 은 timestamptz(UTC) 라 한국 날짜로 옮겨 읽는다
 * (useQuizBoard.buildQuizzes 의 발송일 표기와 같은 방식).
 * 날짜를 지어내지 않는다 — 못 읽으면 빈 문자열.
 */
export function takenDayLabel(takenAt: string | null | undefined): string {
  const t = Date.parse(String(takenAt ?? ''));
  if (!Number.isFinite(t)) return '';
  const kst = new Date(t + 9 * 3600_000);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}
