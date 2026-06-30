// 공용 입력 검증 헬퍼.

/** 이메일 형식(로컬@도메인.tld). 로그인/회원가입 공용. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * 한국 휴대폰 정규화: 숫자만 추출 + 국가코드(82)→0.
 * DB의 public.normalize_phone(0022)과 규칙을 동일하게 유지해야 한다(둘 중 하나만 바꾸면 unique가 어긋남).
 * 빈값이면 ''.
 */
export function normalizePhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('82') ? '0' + d.slice(2) : d;
}

/** 한국 휴대폰 번호(01X + 7~8자리). 정규화 후 검사. */
export function isValidPhone(phone: string): boolean {
  return /^01[016789]\d{7,8}$/.test(normalizePhone(phone));
}

/** 비밀번호 최소 길이(영문·숫자 조합). 규칙 변경 시 여기 한 곳만. */
export const PASSWORD_MIN = 9;

/**
 * 비밀번호 규칙: 9자 이상 + 영문·숫자를 모두 포함.
 * 통과면 null, 실패면 그대로 보여줄 안내 문구를 반환한다.
 */
export function passwordError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 포함해 주세요.';
  return null;
}
