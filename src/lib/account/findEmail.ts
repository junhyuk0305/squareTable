// 이메일 찾기 · 이메일 변경 대기(Q15 · 마스터 계획 P5-7) — react-native 를 읽지 않는 순수 함수.
// 읽는 곳: lib/otp(find_email 답 해석) · forgot-password(찾은 계정 · 완료 문구) · useSessionStore(이메일 변경) · account-edit.
// 검사: scripts/qa-find-email.mjs

export type FoundAccount = { role: 'owner' | 'junior'; email: string; google: boolean };

/** otp 엣지 find_email 의 답에서 계정을 읽는다. 읽을 계정이 없으면 null(호출부는 실패로 다룬다). */
export function readFoundAccounts(body: unknown): FoundAccount[] | null {
  const b = body as { ok?: unknown; accounts?: unknown } | null;
  if (!b || typeof b !== 'object' || b.ok !== true || !Array.isArray(b.accounts)) return null;
  const out: FoundAccount[] = [];
  for (const a of b.accounts as { role?: unknown; email?: unknown; provider?: unknown }[]) {
    if (!a || (a.role !== 'owner' && a.role !== 'junior')) continue;
    if (typeof a.email !== 'string' || !a.email) continue;
    out.push({ role: a.role, email: a.email, google: a.provider === 'google' });
  }
  return out.length > 0 ? out : null;
}

/** 찾은 계정 한 줄. 예) "사장님 계정: ab****@g****.com (구글로 가입)" */
export function foundAccountLine(a: FoundAccount): string {
  const head = a.role === 'owner' ? '사장님 계정' : '직원 계정';
  return `${head}: ${a.email}${a.google ? ' (구글로 가입)' : ''}`;
}

/** 구글로 가입한 계정이 있을 때 로그인 길. social = 이 화면에 구글 버튼이 있는가(SHOW_SOCIAL_LOGIN). */
export function googleAccountHint(accounts: FoundAccount[], social: boolean): string | null {
  if (!accounts.some((a) => a.google)) return null;
  return social
    ? '구글로 가입한 계정은 로그인 화면의 [Google로 계속하기]로 들어와요.'
    : '구글로 가입한 계정은 [비밀번호 바꾸기]에서 비밀번호를 만들면 이메일로 로그인할 수 있어요.';
}

/** 비밀번호를 바꾼 뒤 완료 문구. 옛 엣지라 이메일이 없으면 지금 문구 그대로. */
export function resetDoneText(maskedEmail: string | null | undefined): string {
  return maskedEmail ? `이 이메일로 로그인해 주세요: ${maskedEmail}` : '새 비밀번호로 로그인해 주세요.';
}

/** 이메일 찾기에서 그 번호로 가입된 계정이 없을 때. 이 갈래는 역할을 고르지 않는다. */
export const FIND_NO_ACCOUNT_TEXT = '이 번호로 가입된 계정이 없어요. 번호를 확인해 주세요.';

/**
 * 이메일 변경이 지금 바로 적용됐는가. updateUser 의 user 로 판정한다.
 * new_email 이 있거나 email 이 아직 요청과 다르면 확인 메일을 기다리는 중이다. 이때 앱의 email 을 바꾸지 않는다.
 * 서버는 이메일을 소문자로 저장하므로 대소문자·앞뒤 공백은 같게 본다.
 */
export function emailChangeApplied(
  requested: string,
  user: { email?: string | null; new_email?: string | null } | null | undefined,
): boolean {
  if (!user || user.new_email) return false;
  const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();
  return !!user.email && norm(user.email) === norm(requested);
}

export const EMAIL_CHANGE_PENDING_TEXT = '새 이메일로 확인 메일을 보냈어요. 메일의 링크를 누르면 바뀌어요.';

/** 이메일 변경 확인 링크가 돌아올 주소(2026-10-05). origin = 웹이면 지금 주소, 앱이면 서비스 도메인(siteOrigin). */
export function emailChangeRedirectTo(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/email-changed`;
}

/**
 * /email-changed 화면 문구. Supabase verify 가 붙여 보내는 값으로 고른다.
 *   error · error_description → 만료·잘못된 링크.
 *   message("…confirm link sent to the other email") → Secure email change 로 다른 주소 확인이 남았다.
 *   그 밖 → 바뀌었다.
 */
export function emailChangedNotice(params: { error?: string; error_description?: string; message?: string }): { title: string; body: string } {
  if (params.error || params.error_description) return { title: '링크를 쓸 수 없어요', body: '링크가 만료됐거나 이미 쓴 링크예요. 앱의 계정 편집에서 이메일을 다시 바꿔 주세요.' };
  if (params.message && /other email/i.test(params.message)) return { title: '한 곳 더 확인해 주세요', body: '다른 주소로 온 확인 메일의 링크도 누르면 이메일이 바뀌어요.' };
  return { title: '이메일이 바뀌었어요', body: '다음 로그인부터 새 이메일을 써 주세요.' };
}
