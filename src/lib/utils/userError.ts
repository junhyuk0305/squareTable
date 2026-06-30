// lib/utils/userError.ts
// 백엔드(Supabase·Postgres) 원문 에러를 "고객 안내 문구"로 바꾼다.
// 원칙: 사용자 화면에는 절대 기술 원문(컬럼명·SQL·스택)을 노출하지 않는다.
//   - 끊기지 않는 안내: 무엇이 안 됐고 다음에 뭘 하면 되는지(해요체).
//   - 원문은 console 로만 남겨 개발자가 추적(디버깅 정보는 유지).
//
// 사용: 데이터 계층(스토어)에서 error.message 를 그대로 반환하지 말고
//   return { error: friendlyError(error.message, '가게를 만들지 못했어요. 잠시 후 다시 시도해 주세요.') }
// 처럼 화면 맥락에 맞는 fallback 과 함께 감싼다.

// 맥락과 무관하게 공통으로 잡아내는 횡단 케이스(네트워크·혼잡 등).
// 더 구체적인 패턴이 위로 오도록 정렬.
const COMMON: { test: RegExp; msg: string }[] = [
  {
    test: /failed to fetch|networkerror|network request failed|fetch failed|err_internet|offline|net::/i,
    msg: '인터넷 연결이 불안정해요. 연결을 확인하고 다시 시도해 주세요.',
  },
  {
    test: /timeout|timed out|deadline|408\b/i,
    msg: '응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.',
  },
  {
    test: /rate ?limit|too many|429\b/i,
    msg: '잠시 후 다시 시도해 주세요. 요청이 잠깐 몰렸어요.',
  },
  {
    test: /jwt|token|not authenticated|auth session|session.*(expired|missing)|로그인이 필요/i,
    msg: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  },
  {
    test: /\b(5\d{2})\b|internal server|service unavailable|bad gateway/i,
    msg: '서버에 일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  },
];

/**
 * 백엔드 원문 에러를 고객 안내 문구로 변환한다.
 * @param raw     supabase/postgres 등에서 받은 원문 메시지(또는 null)
 * @param fallback 맥락에 맞는 기본 안내 문구(원문을 식별하지 못하면 이 문구를 보여준다)
 */
export function friendlyError(raw: string | null | undefined, fallback: string): string {
  // 원문은 개발자 추적용으로 남긴다(화면엔 절대 안 나감).
  if (raw) console.warn('[userError]', raw);
  if (!raw) return fallback;
  for (const { test, msg } of COMMON) {
    if (test.test(raw)) return msg;
  }
  // 식별 못 한 원문(DB 내부 메시지 등)은 절대 그대로 노출하지 않는다 → 맥락 fallback.
  return fallback;
}
