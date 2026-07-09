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

/**
 * 한국 휴대폰 표시 형식(010-1234-5678)으로 실시간 포맷팅.
 * 숫자만 추출해 **최대 11자리로 자르고**(무제한 입력 방지) 하이픈을 끼운다.
 * 입력창 onChange 에서 감싸 쓴다: onChange={(v) => setPhone(formatPhone(v))}.
 * (normalizePhone 은 저장·검증용 순수 숫자, formatPhone 은 화면 표시용 — 역할 구분.)
 */
export function formatPhone(input: string): string {
  const d = (input ?? '').replace(/\D/g, '').slice(0, 11); // 11자리 초과 입력 차단
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** 생년월일 최소 연도 — DB CHECK(profiles_birth_date_range, 0065)와 규칙 동일 유지. */
export const BIRTH_MIN_YEAR = 1920;

/**
 * 생년월일 입력 실시간 정리: 숫자만 추출 + 8자리 초과 차단(YYYYMMDD 단일 필드 — 토스류
 * 금융 서비스의 표준 패턴). 입력창 onChange 에서 감싸 쓴다: onChange={(v) => setBirth(formatBirthDate8(v))}.
 */
export function formatBirthDate8(input: string): string {
  return (input ?? '').replace(/\D/g, '').slice(0, 8);
}

/**
 * 생년월일 8자리 → ISO(YYYY-MM-DD). 실존 날짜 + 범위(1920-01-01 이상 · 오늘(KST) 이전)까지
 * 검증하고, 실패하면 null. 서버(0065 ensure_birth_date)와 규칙을 동일하게 유지해야 한다.
 */
export function birthDateISO(input: string): string | null {
  const d = (input ?? '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null; // 실존하지 않는 날짜(예: 0231)
  if (y < BIRTH_MIN_YEAR) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const todayKST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  if (iso >= todayKST) return null;
  return iso;
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
