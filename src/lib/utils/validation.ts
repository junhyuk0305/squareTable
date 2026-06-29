// 공용 입력 검증 헬퍼.

/** 이메일 형식(로컬@도메인.tld). 로그인/회원가입 공용. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
