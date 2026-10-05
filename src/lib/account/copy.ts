// 계정 보안 화면의 문구와 입력 판정 — react-native 를 읽지 않는 순수 함수(scripts/qa-account-ui.mjs 가 Node 로 검증한다).
// 읽는 곳: account-settings(탈퇴 창) · account-edit(비밀번호 바꾸기) · useSessionStore(로그인) · signup · forgot-password · lib/otp.
//
// 2026-10-04 마스터 계획 P3-8.
// ⛔웹 탈퇴 창 문구는 토스 심사 동결(~10-16)로 글자 하나까지 그대로 둔다. 웹 반영은 P6-2.
import { cancelPathText } from '@/lib/iap/cancelPath';
import { passwordError } from '@/lib/utils/validation';

/** J11 — 사장 전환 기능은 만들지 않는다. 가입·비밀번호 찾기 화면에 이 안내만 둔다. */
export const ROLE_SPLIT_TEXT = '사장 계정과 직원 계정은 따로 만들어요. 같은 휴대폰 번호로 둘 다 만들 수 있어요.';

/**
 * Q31 — 탈퇴 계정으로 로그인했을 때. 30일 보관(0035 soft delete) 뒤 파기와 맞춘다.
 * F5(2026-10-06): '되돌리려면 문의' 를 뺐다. 탈퇴는 소속·근무표·전화번호를 바로 지워 되돌릴 수단이 없다.
 */
export const DELETED_LOGIN_TEXT =
  '탈퇴 처리된 계정이에요. 30일 뒤 완전히 지워지고, 그 뒤엔 같은 이메일로 다시 가입할 수 있어요.';

/** Q31 — 가입 이메일 중복. 그 이메일이 탈퇴한 계정인지는 따로 말하지 않는다(계정 열거 방지). */
export const EMAIL_TAKEN_TEXT = '이미 가입된 이메일이에요. 로그인해 주세요. 탈퇴했다면 30일 뒤 다시 가입할 수 있어요.';

/** Q14 — 현재 비밀번호 확인 실패. 구글로 가입해 비밀번호가 없는 계정도 이 문구로 길을 찾는다. */
export const CURRENT_PW_WRONG_TEXT =
  '현재 비밀번호가 맞지 않아요. 비밀번호를 만든 적이 없다면 비밀번호 찾기에서 문자 인증으로 만들 수 있어요.';

/** Q18 — 비밀번호 찾기에서 고른 역할에 계정이 없고 다른 역할에 있을 때(otp reset_password 의 other_role). 버튼 이름으로 말한다. */
export function otherRoleText(otherRole: string | null | undefined): string | null {
  if (otherRole === 'junior') return "이 번호는 직원 계정으로 가입돼 있어요. '직원'을 골라 주세요.";
  if (otherRole === 'owner') return "이 번호는 사장님 계정으로 가입돼 있어요. '사장님'을 골라 주세요.";
  return null;
}

/** Q14 — 비밀번호 바꾸기 입력 검사. 통과하면 null. 새 비밀번호 규칙은 가입과 같은 passwordError. */
export function passwordChangeError(v: { current: string; next: string; confirm: string }): string | null {
  if (!v.current) return '현재 비밀번호를 입력해 주세요.';
  const rule = passwordError(v.next);
  if (rule) return rule;
  if (v.next === v.current) return '지금 비밀번호와 다른 비밀번호를 정해 주세요.';
  if (v.next !== v.confirm) return '비밀번호가 서로 달라요.';
  return null;
}

/**
 * Q33 — 탈퇴 창의 이용권 안내. 플랫폼이 아니라 **실제 구독**(iap_subscriptions.platform)으로 가른다.
 * 탈퇴(delete_my_account)는 스토어 구독을 끊지 못한다. 그래서 해지할 곳을 말한다.
 *
 * - iapPlatform: 서버 행 값('appstore' | 'play'). null = 구독 없음. undefined = 읽지 못함 → 같은 기기 안내(보수적).
 * - os: Platform.OS. ⛔웹은 null(동결 · 지금 웹 탈퇴 창에는 이용권 문장이 없다).
 * - 다른 기기에서 산 구독은 스토어 이름을 쓰지 않는다(Apple 2.3.10). Q8 과 같은 "다른 기기" 말.
 */
export function deleteNotice(v: { iapPlatform: string | null | undefined; os: string }): string | null {
  const device = v.os === 'ios' ? 'appstore' : v.os === 'android' ? 'play' : null;
  if (!device || v.iapPlatform === null) return null;
  const lead = '앱에서 산 이용권은 탈퇴해도 해지되지 않아요.';
  if (v.iapPlatform !== undefined && v.iapPlatform !== device) {
    return `${lead} 이 이용권은 다른 기기에서 샀어요. 산 기기의 스토어에서 해지해 주세요.`;
  }
  return `${lead} ${cancelPathText(v.os)}에서 먼저 해지해 주세요.`;
}

/**
 * Q31 — 탈퇴 확인 문구. "복구할 수 없어요"는 실제(30일 보관 뒤 파기)와 달랐다.
 * 보관 문장은 정책 검토 M4 문구 그대로다. 직원은 근로 기록 3년 보관(J3)을 덧붙인다.
 * ⛔웹은 지금 문구를 글자 그대로 돌려준다(토스 동결). 웹에서는 이용권 문장도 넣지 않는다.
 */
export function deleteConfirmText(v: { ownerAccount: boolean; notice: string | null; os: string }): string {
  if (v.os === 'web') {
    return v.ownerAccount
      ? '계정과 매장 데이터(노하우·직원·근무 기록)가 모두 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?'
      : '계정과 내 기록(질문·출퇴근)이 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?';
  }
  const parts = [
    // 사장 매장은 탈퇴 때 감춰지고(0237) 30일 뒤 근무 기록까지 파기된다(0053 purge). 이 문장은 계획에 없다 · 사용자 확인 대기.
    v.ownerAccount ? '매장 데이터(노하우·직원·근무 기록)는 30일 뒤 지워요.' : null,
    '계정 정보는 30일 뒤 지워요. 법으로 보관해야 하는 기록(근로·결제)은 정해진 기간만 따로 보관한 뒤 지워요.',
    v.ownerAccount ? null : '출퇴근·시급 기록은 법에 따라 매장에 3년 보관돼요.',
    '30일 동안은 같은 이메일로 다시 가입할 수 없어요.',
    v.notice,
    '정말 탈퇴하시겠어요?',
  ];
  return parts.filter(Boolean).join(' ');
}
