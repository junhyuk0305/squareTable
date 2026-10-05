#!/usr/bin/env node
// qa-account-ui.mjs — 계정 보안 화면(번호 바꾸기·비밀번호 바꾸기·탈퇴 안내·가입/찾기 안내) 순수 판정 검증.
// DB·네트워크를 쓰지 않는다(엣지 호출은 fetch 를 가짜로 바꿔 요청 모양과 답 해석만 본다).
//
// ★2026-10-04 마스터 계획 P3-8 (서버 0238 · otp 엣지는 이미 이 브랜치에 있다)
//   Q13 번호를 문자 인증 없이 바꿨다 → 프로필 편집의 번호는 읽기 전용, [번호 바꾸기] 시트가 otp change_phone 을 부른다.
//   Q14 비밀번호를 바꿀 때 현재 비밀번호를 안 물었다 → 현재 비밀번호 칸 · 서버 대조(0253) · 다른 기기 로그아웃 안 함.
//   Q18 비밀번호 찾기에서 역할을 잘못 고르면 "계정 없음"만 나왔다 → 엣지의 other_role 로 맞는 역할을 알려 준다.
//   Q31 탈퇴 안내 "복구할 수 없어요" ↔ 실제 30일 보관(정책 검토 M4 문구) · 직원은 3년 보관 문장.
//   Q33 탈퇴 창의 이용권 안내를 플랫폼이 아니라 실제 구독으로 가른다(앱만). ⛔웹 탈퇴 창 문구는 토스 동결로 글자 그대로.
//   J11 사장 계정과 직원 계정은 따로 만든다는 안내(가입·비밀번호 찾기).
// 실행: node scripts/qa-account-ui.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// 앱 코드의 '@/…' 별칭과 확장자 없는 상대 경로를 노드가 읽게 한다(스크립트 전용).
register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const fn = (f) => typeof f === 'function';

const load = async (p) => {
  try {
    return await import(p);
  } catch (e) {
    console.log('  FAIL 모듈을 읽지 못했다', p, String(e && e.code ? e.code : e));
    return {};
  }
};
const copy = await load('../src/lib/account/copy.ts');
const otpMod = await load('../src/lib/otp.ts');
const { cancelPathText } = await load('../src/lib/iap/cancelPath.ts');

const read = (p) => {
  try {
    return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  } catch (e) {
    check(`${p} 를 읽는다`, false, String(e && e.code ? e.code : e));
    return '';
  }
};
// 주석을 걷어 낸 코드만 본다.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// 화면 문구 공통 금지: 대시 · 문장 잇는 중간점 · 결제 채널 말(3.1.1)
const STYLE = /—| · /;
const CHANNEL = /카드|웹에서|토스/;

const {
  deleteNotice, deleteConfirmText, otherRoleText, passwordChangeError,
  ROLE_SPLIT_TEXT, DELETED_LOGIN_TEXT, EMAIL_TAKEN_TEXT, CURRENT_PW_WRONG_TEXT,
} = copy;
const notice = (a) => (fn(deleteNotice) ? deleteNotice(a) : '(함수 없음)');
const confirmText = (a) => (fn(deleteConfirmText) ? deleteConfirmText(a) : '(함수 없음)');

const M4 = '계정 정보는 30일 뒤 지워요. 법으로 보관해야 하는 기록(근로·결제)은 정해진 기간만 따로 보관한 뒤 지워요.';
const STAFF_3Y = '출퇴근·시급 기록은 법에 따라 매장에 3년 보관돼요.';
const OTHER_DEVICE = '이 이용권은 다른 기기에서 샀어요. 산 기기의 스토어에서 해지해 주세요.';
// ⛔토스 동결(~10-16): 지금 웹 탈퇴 창 문구. 웹에서는 SHOW_IAP=false 라 이용권 문장이 없다.
const WEB_OWNER = '계정과 매장 데이터(노하우·직원·근무 기록)가 모두 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?';
const WEB_STAFF = '계정과 내 기록(질문·출퇴근)이 삭제되며 복구할 수 없어요. 정말 탈퇴하시겠어요?';

console.log('\n■ Q33 — 탈퇴 창 이용권 안내는 실제 구독으로 가른다(deleteNotice)');
{
  check('웹은 안내가 없다(동결 · 지금 웹 문구 그대로)', notice({ iapPlatform: 'appstore', os: 'web' }) === null, show(notice({ iapPlatform: 'appstore', os: 'web' })));
  check('앱 · 구독 없음 → 안내 없음', notice({ iapPlatform: null, os: 'ios' }) === null && notice({ iapPlatform: null, os: 'android' }) === null);
  const ios = notice({ iapPlatform: 'appstore', os: 'ios' });
  check('iOS · App Store 구독 → 해지 경로를 말한다', typeof ios === 'string' && fn(cancelPathText) && ios.includes(cancelPathText('ios')) && ios.includes('탈퇴해도 해지되지 않아요'), show(ios));
  const and = notice({ iapPlatform: 'play', os: 'android' });
  check("★안드 · Play 구독 → 'Play' 경로", typeof and === 'string' && and.includes('Play') && and.includes('탈퇴해도 해지되지 않아요'), show(and));
  const iosOther = notice({ iapPlatform: 'play', os: 'ios' });
  check('iOS · 다른 기기 구독 → "다른 기기" 문구', typeof iosOther === 'string' && iosOther.includes(OTHER_DEVICE), show(iosOther));
  check('iOS 문구에 다른 플랫폼 이름이 없다(2.3.10)', typeof iosOther === 'string' && !/Play|Google|구글|안드/.test(iosOther), show(iosOther));
  const andOther = notice({ iapPlatform: 'appstore', os: 'android' });
  check('안드 · 다른 기기 구독 → "다른 기기" 문구', typeof andOther === 'string' && andOther.includes(OTHER_DEVICE), show(andOther));
  check('안드 문구에 다른 플랫폼 이름이 없다', typeof andOther === 'string' && !/App Store|애플|Apple|아이폰|iOS/.test(andOther), show(andOther));
  const unknown = notice({ iapPlatform: undefined, os: 'ios' });
  check('구독을 못 읽었으면(undefined) 같은 기기 안내로 보수적으로', unknown === ios, show(unknown));
  for (const [k, v] of Object.entries({ ios, and, iosOther, andOther })) {
    check(`${k} 문구에 대시·중간점·채널 말이 없다`, typeof v === 'string' && !STYLE.test(v) && !CHANNEL.test(v), show(v));
  }
}

console.log('\n■ Q31 — 탈퇴 확인 문구(deleteConfirmText)');
{
  const owner = confirmText({ ownerAccount: true, notice: null, os: 'ios' });
  const staff = confirmText({ ownerAccount: false, notice: null, os: 'android' });
  check('사장 앱 문구에 M4 문장이 있다', typeof owner === 'string' && owner.includes(M4), show(owner));
  check('직원 앱 문구에 M4 문장이 있다', typeof staff === 'string' && staff.includes(M4), show(staff));
  check('★앱 문구에 "복구할 수 없어요"가 없다(실제는 30일 보관)', typeof owner === 'string' && !owner.includes('복구할 수 없') && typeof staff === 'string' && !staff.includes('복구할 수 없'));
  // 사장 매장은 탈퇴 때 감춰지고(0237 soft delete) 30일 뒤 근무 기록까지 파기된다(0053 purge cascade).
  check('★사장 매장 데이터 문장이 30일 뒤 지운다고 말한다("함께" 즉시처럼 읽히지 않게)', typeof owner === 'string' && owner.includes('매장 데이터(노하우·직원·근무 기록)는 30일 뒤 지워요.') && !owner.includes('함께 지워요'), show(owner));
  check('직원에게만 3년 보관 문장',typeof staff === 'string' && staff.includes(STAFF_3Y) && typeof owner === 'string' && !owner.includes(STAFF_3Y));
  check('30일 동안 같은 이메일 재가입 불가를 말한다', typeof owner === 'string' && owner.includes('30일 동안은 같은 이메일로 다시 가입할 수 없어요.'));
  const withNotice = confirmText({ ownerAccount: true, notice: notice({ iapPlatform: 'appstore', os: 'ios' }), os: 'ios' });
  check('이용권 안내를 넣고 "정말 탈퇴하시겠어요?"로 끝난다', typeof withNotice === 'string' && withNotice.includes('탈퇴해도 해지되지 않아요') && withNotice.endsWith('정말 탈퇴하시겠어요?'), show(withNotice));
  check('앱 문구에 대시·중간점이 없다', [owner, staff, withNotice].every((s) => typeof s === 'string' && !STYLE.test(s)));
  check('⛔웹 사장 문구는 글자 그대로(동결)', confirmText({ ownerAccount: true, notice: null, os: 'web' }) === WEB_OWNER, show(confirmText({ ownerAccount: true, notice: null, os: 'web' })));
  check('⛔웹 직원 문구는 글자 그대로(동결)', confirmText({ ownerAccount: false, notice: null, os: 'web' }) === WEB_STAFF, show(confirmText({ ownerAccount: false, notice: null, os: 'web' })));
  check('⛔웹은 안내가 들어와도 문구가 그대로', confirmText({ ownerAccount: true, notice: 'x', os: 'web' }) === WEB_OWNER);
  check('탈퇴 계정 로그인 문구', DELETED_LOGIN_TEXT === '탈퇴 처리된 계정이에요. 30일 뒤 완전히 지워지고, 그 뒤엔 같은 이메일로 다시 가입할 수 있어요.', show(DELETED_LOGIN_TEXT));
  check('가입 이메일 중복 문구(탈퇴 여부를 따로 말하지 않는다)', EMAIL_TAKEN_TEXT === '이미 가입된 이메일이에요. 로그인해 주세요. 탈퇴했다면 30일 뒤 다시 가입할 수 있어요.', show(EMAIL_TAKEN_TEXT));
}

console.log('\n■ J11 · Q18 — 계정 역할 안내');
{
  check('J11 문구', ROLE_SPLIT_TEXT === '사장 계정과 직원 계정은 따로 만들어요. 같은 휴대폰 번호로 둘 다 만들 수 있어요.', show(ROLE_SPLIT_TEXT));
  const j = fn(otherRoleText) ? otherRoleText('junior') : null;
  const o = fn(otherRoleText) ? otherRoleText('owner') : null;
  check('other_role=junior → 직원을 고르라고', j === "이 번호는 직원 계정으로 가입돼 있어요. '직원'을 골라 주세요.", show(j));
  check('other_role=owner → 사장님을 고르라고(화면 버튼 이름)', o === "이 번호는 사장님 계정으로 가입돼 있어요. '사장님'을 골라 주세요.", show(o));
  check('모르는 값 → null', fn(otherRoleText) && otherRoleText(undefined) === null && otherRoleText('admin') === null);
}

console.log('\n■ Q14 — 비밀번호 바꾸기 입력 검사(passwordChangeError)');
{
  const pce = (current, next, confirm) => (fn(passwordChangeError) ? passwordChangeError({ current, next, confirm }) : '(함수 없음)');
  check('현재 비밀번호가 비면 막는다', pce('', 'newpass123', 'newpass123') === '현재 비밀번호를 입력해 주세요.', show(pce('', 'newpass123', 'newpass123')));
  check('새 비밀번호가 짧으면 규칙 문구', pce('oldpass123', 'ab1', 'ab1') === '비밀번호는 9자 이상이어야 해요.', show(pce('oldpass123', 'ab1', 'ab1')));
  check('새 비밀번호에 숫자가 없으면 규칙 문구', pce('oldpass123', 'abcdefghij', 'abcdefghij') === '영문과 숫자를 모두 포함해 주세요.');
  check('지금과 같으면 막는다', pce('oldpass123', 'oldpass123', 'oldpass123') === '지금 비밀번호와 다른 비밀번호를 정해 주세요.', show(pce('oldpass123', 'oldpass123', 'oldpass123')));
  check('확인이 다르면 막는다', pce('oldpass123', 'newpass123', 'newpass124') === '비밀번호가 서로 달라요.');
  check('맞으면 null', pce('oldpass123', 'newpass123', 'newpass123') === null);
  check('현재 비밀번호 틀림 안내(구글 가입 계정 포함)', CURRENT_PW_WRONG_TEXT === '현재 비밀번호가 맞지 않아요. 비밀번호를 만든 적이 없다면 비밀번호 찾기에서 문자 인증으로 만들 수 있어요.', show(CURRENT_PW_WRONG_TEXT));
}

console.log('\n■ Q13 · Q18 — otp 엣지 호출(가짜 fetch)');
{
  const calls = [];
  let reply = { status: 200, body: { ok: true } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const { changePhoneByOtp, resetPasswordByPhone } = otpMod;

  if (fn(changePhoneByOtp)) {
    reply = { status: 200, body: { ok: true, phone_last4: '5678' } };
    const r = await changePhoneByOtp({ phone: '01012345678', code: '123456', accessToken: 'user-jwt' });
    const c = calls.at(-1);
    check('change_phone 을 부른다', c?.body?.action === 'change_phone' && c.body.phone === '01012345678' && c.body.code === '123456', show(c?.body));
    check('★로그인 토큰을 Authorization 에 싣는다(엣지가 getUser 로 확인)', c?.headers?.Authorization === 'Bearer user-jwt', show(c?.headers?.Authorization));
    check('성공이면 ok · 문구 없음', r.ok === true && r.message === null, show(r));
    reply = { status: 409, body: { ok: false, reason: 'phone_taken' } };
    const t = await changePhoneByOtp({ phone: '01012345678', code: '123456', accessToken: 'user-jwt' });
    check('phone_taken → 다른 번호 안내', t.ok === false && typeof t.message === 'string' && t.message.includes('다른 번호'), show(t));
    reply = { status: 401, body: { ok: false, reason: 'unauthorized' } };
    const u = await changePhoneByOtp({ phone: '01012345678', code: '123456', accessToken: 'user-jwt' });
    check('unauthorized → 다시 로그인 안내', u.ok === false && typeof u.message === 'string' && u.message.includes('다시 로그인'), show(u));
    for (const m of [t.message, u.message]) check(`문구에 개발 말·대시가 없다: ${m}`, typeof m === 'string' && !/[a-z]+_[a-z]+/.test(m) && !STYLE.test(m));
    // ★모르는 이유(옛 엣지 bad_action · 새 엣지 500 의 db · bad_json)도 실패 문구가 있어야 한다.
    //   문구가 undefined 면 changePhone 이 { error: undefined } 를 돌려 화면이 "바꿨어요"로 닫혔다.
    for (const [status, reason] of [[400, 'bad_action'], [500, 'db'], [400, 'bad_json']]) {
      reply = { status, body: { ok: false, reason } };
      const x = await changePhoneByOtp({ phone: '01012345678', code: '123456', accessToken: 'user-jwt' });
      check(`★${reason} → 실패 · 빈 문구가 아니다`, x.ok === false && typeof x.message === 'string' && x.message.length > 0 && !/[a-z]+_[a-z]+/.test(x.message), show(x));
    }
    reply = { status: 502, body: '<html>bad gateway</html>' };
    const g = await changePhoneByOtp({ phone: '01012345678', code: '123456', accessToken: 'user-jwt' });
    check('JSON 이 아닌 답 → 실패 · 빈 문구가 아니다', g.ok === false && typeof g.message === 'string' && g.message.length > 0, show(g));
  } else {
    check('changePhoneByOtp 가 있다', false);
  }

  if (fn(resetPasswordByPhone)) {
    reply = { status: 404, body: { ok: false, reason: 'no_account', other_role: 'junior' } };
    const r = await resetPasswordByPhone({ phone: '01012345678', code: '123456', role: 'owner', newPassword: 'newpass123' });
    const want = fn(otherRoleText) ? otherRoleText('junior') : '(otherRoleText 없음)';
    check('★Q18 no_account + other_role → 맞는 역할을 알려 준다', r.ok === false && r.message === want, show(r));
    reply = { status: 404, body: { ok: false, reason: 'no_account' } };
    const n = await resetPasswordByPhone({ phone: '01012345678', code: '123456', role: 'owner', newPassword: 'newpass123' });
    check('other_role 이 없으면 지금 문구', n.ok === false && typeof n.message === 'string' && n.message.startsWith('이 번호로 가입된 계정이 없어요'), show(n));
  } else {
    check('resetPasswordByPhone 이 있다', false);
  }
}

console.log('\n■ 화면 배선');
{
  const edit = strip(read('src/app/account-edit.tsx'));
  const saveProfile = (edit.match(/const saveProfile = async[\s\S]*?\n  \};/) || [''])[0];
  check('★Q13 프로필 저장이 번호를 보내지 않는다', saveProfile.length > 0 && !/phone/.test(saveProfile), show(saveProfile.slice(0, 120)));
  check('Q13 [번호 바꾸기] 시트가 있다', edit.includes('번호 바꾸기') && /BottomSheet/.test(edit) && /changePhone\(/.test(edit));
  check('Q14 현재 비밀번호 칸 · 두 값을 넘긴다', edit.includes('현재 비밀번호') && /changePassword\(\s*curPw\s*,\s*pw\s*\)/.test(edit) && /passwordChangeError\(/.test(edit));
  // F1(QA 2026-10-05): 10-05 결정대로 다른 기기는 로그아웃되지 않는다 → 성공 토스트가 그렇다고 말하면 안 된다.
  const savePw = (edit.match(/const savePw = async[\s\S]*?\n  \};/) || [''])[0];
  check('★F1 비밀번호 변경 성공 토스트가 "로그아웃"을 약속하지 않는다', savePw.length > 0 && !/로그아웃/.test(savePw), show(savePw.slice(-90)));

  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  const cp = (ss.match(/changePassword: async[\s\S]*?\n  \},/) || [''])[0];
  // 2026-10-05 결정: 비밀번호를 바꿔도 다른 기기를 로그아웃시키지 않는다. updateUser 는 GoTrue 가 다른 세션을 끊으므로
  //   서버 RPC(0253 change_my_password)가 현재 비밀번호를 대조하고 해시를 바꾼다. 실제 세션 유지는 qa:password-sessions.
  check('★Q14 change_my_password RPC 로 바꾼다(updateUser 안 씀)', /rpc\('change_my_password'/.test(cp) && !/updateUser\(/.test(cp), show(cp.slice(0, 80)));
  check("Q14 성공 뒤 다른 기기를 로그아웃시키지 않는다(signOut 없음)", cp.length > 0 && !/signOut\(/.test(cp));
  check('Q14 현재 비밀번호 틀림 · 잠금 문구를 나눈다', /current_password_wrong/.test(cp) && /too_many_attempts/.test(cp));
  check('Q13 changePhone 이 otp change_phone 을 쓴다', /changePhone: async[\s\S]*?changePhoneByOtp\(/.test(ss));
  const chp = (ss.match(/changePhone: async[\s\S]*?\n  \},/) || [''])[0];
  check('★Q13 changePhone 실패는 문구가 비어도 실패로 돌려준다', /if \(!r\.ok\) return \{ error: r\.message \?\? '[^']+' \}/.test(chp), show(chp.slice(-200)));
  check('Q31 탈퇴 계정 로그인 문구를 정본에서 읽는다', /DELETED_LOGIN_TEXT/.test(ss) && !ss.includes('복구가 필요하면 문의해 주세요'));

  const settings = strip(read('src/app/account-settings.tsx'));
  check('Q33 탈퇴 창이 deleteNotice · deleteConfirmText 를 쓴다', /deleteNotice\(/.test(settings) && /deleteConfirmText\(/.test(settings) && /fetchMyIapSubscription\(/.test(settings));
  check('탈퇴 창에 SHOW_IAP 플랫폼 분기가 남지 않았다', !/SHOW_IAP\s*\?/.test(settings));

  const signup = strip(read('src/app/signup.tsx'));
  check('J11 가입 화면에 역할 안내', /ROLE_SPLIT_TEXT/.test(signup));
  check('Q31 가입 이메일 중복 문구를 정본에서 읽는다', /EMAIL_TAKEN_TEXT/.test(signup) && !signup.includes("'이미 가입된 이메일이에요. 로그인해 주세요.'"));
  const forgot = strip(read('src/app/forgot-password.tsx'));
  check('J11 비밀번호 찾기 화면에 역할 안내', /ROLE_SPLIT_TEXT/.test(forgot));
}

// 2026-10-05 로그인 화면 표준 보강: 비밀번호 보기 · 자동완성 · 두 번 누름 막기 · 실패해도 로딩 풀기.
console.log('\n■ 로그인 화면 표준');
{
  const pi = strip(read('src/components/PasswordInput.tsx'));
  check('공용 비밀번호 칸이 보기 토글을 가진다', /secureTextEntry=\{!shown\}/.test(pi) && /eye-off-outline/.test(pi) && /eye-outline/.test(pi) && /accessibilityLabel/.test(pi));
  check('공용 비밀번호 칸이 ref 를 넘긴다(account-edit 포커스)', /forwardRef/.test(pi));
  for (const [p, n] of [['src/app/login.tsx', 1], ['src/app/signup.tsx', 1], ['src/app/forgot-password.tsx', 2], ['src/app/account-edit.tsx', 3]]) {
    const s = strip(read(p));
    const uses = (s.match(/<PasswordInput\b/g) || []).length;
    check(`${p} 비밀번호 칸 ${n}개가 공용 칸을 쓴다`, uses === n && !/\bsecureTextEntry\b(?!=\{secure\})/.test(s), `PasswordInput ${uses}개`);
  }
  const login = strip(read('src/app/login.tsx'));
  check('login 이메일 자동완성', /autoComplete="email"/.test(login) && /textContentType="username"/.test(login));
  check('login 비밀번호 자동완성', /autoComplete="current-password"/.test(login) && /textContentType="password"/.test(login));
  const loginFn = (login.match(/const login = async \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
  check('★login() 맨 앞에서 busy 면 돌아간다(엔터 두 번)', /^const login = async \(\) => \{\s*if \(busy\) return;/.test(loginFn), show(loginFn.slice(0, 60)));
  const signup = strip(read('src/app/signup.tsx'));
  check('signup 이메일 자동완성', /autoComplete="email"/.test(signup));
  check('signup 새 비밀번호 자동완성', /autoComplete="new-password"/.test(signup) && /textContentType="newPassword"/.test(signup));
  check('signup 전화 자동완성', /autoComplete="tel"/.test(signup));
  check('signup 인증번호 자동완성', /autoComplete="one-time-code"/.test(signup) && /textContentType="oneTimeCode"/.test(signup));
  const forgot = strip(read('src/app/forgot-password.tsx'));
  const sub = (forgot.match(/const submit = async[\s\S]*?\n  \};/) || [''])[0];
  const fnd = (forgot.match(/const find = async[\s\S]*?\n  \};/) || [''])[0];
  check('★비밀번호 재설정이 실패로 던져도 로딩을 푼다', /try \{[\s\S]*\} finally \{\s*setBusy\(false\);/.test(sub));
  check('★이메일 찾기가 실패로 던져도 로딩을 푼다', /try \{[\s\S]*\} finally \{\s*setBusy\(false\);/.test(fnd));
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
