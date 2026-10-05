#!/usr/bin/env node
// qa-find-email.mjs — 이메일 찾기 · 이메일 변경 대기(Q15 앱 · P5-7). 백엔드 없음.
//
// 무엇을 보나
//   [1] 순수 함수(src/lib/account/findEmail.ts 를 그대로 import · 로직 복제 없음)
//       · readFoundAccounts — otp 엣지 find_email 응답을 읽는다. 표본은 엣지 helpers.ts 의 실제 maskEmail 로 만든다.
//       · foundAccountLine · googleAccountHint — 찾은 계정 줄과 구글 가입 안내(앱은 구글 버튼이 없다).
//       · resetDoneText — 비밀번호를 바꾼 뒤 "이 이메일로 로그인해 주세요: ab****@gmail.com".
//       · emailChangeApplied — updateUser 응답에 new_email 이 있거나 email 이 요청과 다르면 아직 안 바뀐 것(확인 메일 대기).
//   [2] lib/otp.ts 를 가짜 fetch 로 부른다 — find_email 요청 모양과 답 해석, reset_password 성공 응답의 가린 이메일.
//   [3] 엣지 계약 — otp find_email 이 role · email(maskEmail) · provider 를 싣는다(앱 해석과 짝).
//   [4] 화면 배선 — forgot-password 두 갈래 · login 링크 문구 · updateProfile 이 대기면 로컬 이메일을 덮지 않음 · account-edit 안내.
// 수정 전에는 findEmail.ts 가 없으므로 **지금 앱의 판정**으로 같은 표를 돌린다(이메일 변경 = 무조건 바뀐 것으로 본다).
//   모듈이 없어서가 아니라 판정이 틀려서 RED 다.
// 실행: node scripts/qa-find-email.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const fn = (f) => typeof f === 'function';
const read = (p) => {
  const u = new URL(`../${p}`, import.meta.url);
  return existsSync(u) ? readFileSync(u, 'utf8').replace(/\r\n/g, '\n') : '';
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const load = async (p) => {
  try { return await import(p); } catch (e) { console.log('  (모듈 없음)', p, String(e && e.code ? e.code : e)); return null; }
};

// 화면 문구 공통 금지: 대시 · 문장 잇는 중간점 · 결제 채널 말(3.1.1) · 개발 말(snake_case)
const STYLE = /—| · /;
const CHANNEL = /카드|웹에서|토스/;
const DEV = /[a-z]+_[a-z]+/;
const copyOk = (m) => typeof m === 'string' && m.length > 0 && !STYLE.test(m) && !CHANNEL.test(m) && !DEV.test(m);

const { maskEmail } = await import('../supabase/functions/otp/helpers.ts');
const M = await load('../src/lib/account/findEmail.ts');
const otpMod = (await load('../src/lib/otp.ts')) ?? {};

// ── 지금 앱의 판정(수정 전 폴백) ─────────────────────────────────────────
const ss0 = strip(read('src/lib/store/useSessionStore.ts'));
// 데모(HAS_SUPABASE 아님) 분기는 서버가 없어 바로 덮는 게 맞다. 실제 서버 경로(updateUser 부터)만 본다.
const afterUpdateUser = (s) => {
  const u = (s.match(/updateProfile: async[\s\S]*?\n  \},/) || [''])[0];
  const i = u.indexOf('supabase.auth.updateUser');
  return i < 0 ? '' : u.slice(u.lastIndexOf('\n', i));
};
const up0 = afterUpdateUser(ss0);
// 지금 updateProfile 은 updateUser 결과와 상관없이 next.email = patch.email 로 덮는다 → 언제나 "바뀐 것".
const legacyApplied = /if \(patch\.email != null\) next\.email = patch\.email;/.test(up0) ? () => true : null;
const forgot0 = strip(read('src/app/forgot-password.tsx'));
// 지금 완료 화면은 이메일 없이 고정 문구만 보여 준다.
const legacyDone = forgot0.includes('새 비밀번호로 로그인해 주세요.') ? () => '새 비밀번호로 로그인해 주세요.' : null;
// 지금 앱은 otp 성공 응답의 본문을 버린다(callOtp 가 ok 만 돌려준다) → 찾은 계정 0개.
const otp0 = strip(read('src/lib/otp.ts'));
const legacyRead = /if \(res\.ok && j\?\.ok\) return \{ ok: true, reason: null, retryAfterSec: null, otherRole: null \}/.test(otp0) ? () => null : null;

const pick = (name, legacy) => {
  if (M && fn(M[name])) return M[name];
  if (legacy) console.log(`  (${name} 없음 → 지금 앱 판정으로 실행)`);
  return legacy;
};
const readFoundAccounts = pick('readFoundAccounts', legacyRead);
const foundAccountLine = pick('foundAccountLine', null);
const googleAccountHint = pick('googleAccountHint', null);
const resetDoneText = pick('resetDoneText', legacyDone);
const emailChangeApplied = pick('emailChangeApplied', legacyApplied);

// ── [1] 순수 함수 ─────────────────────────────────────────────────────
console.log('\n[1] 순수 함수');
const ownerMasked = maskEmail('abcd@gmail.com');
const staffMasked = maskEmail('kim@naver.com');
const edgeBody = {
  ok: true,
  accounts: [
    { role: 'owner', email: ownerMasked, provider: 'google' },
    { role: 'junior', email: staffMasked, provider: 'email' },
  ],
};
console.log('  (표본) 엣지 응답 =', show(edgeBody));
{
  const acc = fn(readFoundAccounts) ? readFoundAccounts(edgeBody) : undefined;
  check('★1-1 엣지 find_email 응답에서 계정 2개를 읽는다', Array.isArray(acc) && acc.length === 2, show(acc));
  check('1-2 역할 · 가린 이메일 · 구글 표시를 그대로 옮긴다',
    Array.isArray(acc) && acc[0]?.role === 'owner' && acc[0]?.email === ownerMasked && acc[0]?.google === true
      && acc[1]?.role === 'junior' && acc[1]?.email === staffMasked && acc[1]?.google === false, show(acc));
  const bad = [
    ['ok:false', { ok: false, reason: 'no_account' }],
    ['accounts 없음(옛 엣지)', { ok: true }],
    ['accounts 빈 배열', { ok: true, accounts: [] }],
    ['null', null],
    ['문자열', '<html>'],
  ];
  for (const [label, b] of bad) {
    const r = fn(readFoundAccounts) ? readFoundAccounts(b) : undefined;
    check(`1-3 ${label} → null(실패로 처리)`, r === null, show(r));
  }
  const odd = fn(readFoundAccounts)
    ? readFoundAccounts({ ok: true, accounts: [{ role: 'admin', email: 'x****@y****.com', provider: 'email' }, { role: 'junior', email: '', provider: 'email' }, { role: 'owner', email: ownerMasked }] })
    : undefined;
  check('1-4 모르는 역할 · 빈 이메일 줄은 버리고 나머지만 읽는다', Array.isArray(odd) && odd.length === 1 && odd[0].role === 'owner' && odd[0].google === false, show(odd));

  if (fn(foundAccountLine)) {
    const l1 = foundAccountLine({ role: 'owner', email: ownerMasked, google: true });
    const l2 = foundAccountLine({ role: 'junior', email: staffMasked, google: false });
    check('1-5 사장 계정 줄', l1 === `사장님 계정: ${ownerMasked} (구글로 가입)`, show(l1));
    check('1-6 직원 계정 줄', l2 === `직원 계정: ${staffMasked}`, show(l2));
    for (const l of [l1, l2]) check(`1-7 문구 규칙: ${l}`, copyOk(l.replace(/\S+@\S+/, 'x')));
  } else {
    check('1-5 foundAccountLine 이 있다(찾은 계정을 화면에 보여 줄 길)', false);
  }

  if (fn(googleAccountHint)) {
    const g = [{ role: 'owner', email: ownerMasked, google: true }];
    const e = [{ role: 'junior', email: staffMasked, google: false }];
    const app = googleAccountHint(g, false);
    const web = googleAccountHint(g, true);
    check('1-8 구글 계정이 없으면 안내 없음', googleAccountHint(e, false) === null && googleAccountHint(e, true) === null);
    check('★1-9 앱(구글 버튼 없음) → 비밀번호 바꾸기로 비밀번호를 만들라고 안내', typeof app === 'string' && app.includes('비밀번호 바꾸기'), show(app));
    check('1-10 웹(구글 버튼 있음) → Google로 계속하기 안내', typeof web === 'string' && web.includes('Google로 계속하기'), show(web));
    for (const m of [app, web]) check(`1-11 문구 규칙: ${m}`, copyOk(m));
  } else {
    check('1-8 googleAccountHint 가 있다', false);
  }

  const d = fn(resetDoneText) ? resetDoneText('ab****@g****.com') : undefined;
  check('★1-12 비밀번호를 바꾼 뒤 로그인할 이메일을 알려 준다(계획 문구)', d === '이 이메일로 로그인해 주세요: ab****@g****.com', show(d));
  const d0 = fn(resetDoneText) ? resetDoneText(null) : undefined;
  check('1-13 이메일이 없으면(옛 엣지) 지금 문구', d0 === '새 비밀번호로 로그인해 주세요.', show(d0));

  const rows = [
    // [이름, 요청, updateUser 의 user, 기대(바뀜?)]
    ['★확인 메일 대기(new_email 있음 · email 은 옛 값)', 'new@x.com', { email: 'old@x.com', new_email: 'new@x.com' }, false],
    ['★new_email 은 없지만 email 이 아직 옛 값', 'new@x.com', { email: 'old@x.com' }, false],
    ['확인 없이 바로 바뀜(email = 요청)', 'new@x.com', { email: 'new@x.com', new_email: null }, true],
    ['대소문자 · 공백만 다름(서버가 소문자로 저장)', ' New@X.com ', { email: 'new@x.com' }, true],
    ['★user 가 비어 있음 → 바뀌었다고 하지 않는다', 'new@x.com', null, false],
  ];
  for (const [label, req, user, want] of rows) {
    const got = fn(emailChangeApplied) ? emailChangeApplied(req, user) : undefined;
    check(`1-14 ${label} → ${want ? '바뀜' : '대기'}`, got === want, show(got));
  }
  const pend = M?.EMAIL_CHANGE_PENDING_TEXT;
  check('1-15 대기 안내(계획 문구)', pend === '새 이메일로 확인 메일을 보냈어요. 메일의 링크를 누르면 바뀌어요.', show(pend));
  const none = M?.FIND_NO_ACCOUNT_TEXT;
  check('1-16 이메일 찾기 "계정 없음" 문구는 역할 선택을 말하지 않는다', copyOk(none) && none.includes('계정이 없어요') && !/사장님\/직원|선택/.test(none), show(none));
}

// ── [2] lib/otp.ts (가짜 fetch) ───────────────────────────────────────
console.log('\n[2] lib/otp.ts 가짜 fetch');
{
  const calls = [];
  let reply = { status: 200, body: { ok: true } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') });
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const { findEmailByPhone, resetPasswordByPhone } = otpMod;

  if (fn(findEmailByPhone)) {
    reply = { status: 200, body: edgeBody };
    const r = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    const c = calls.at(-1);
    check('2-1 find_email 을 부른다(번호 · 코드)', c?.body?.action === 'find_email' && c.body.phone === '01012345678' && c.body.code === '123456', show(c?.body));
    check('2-2 로그인 전이라 anon 키로 부른다', typeof c?.headers?.Authorization === 'string' && c.headers.Authorization.startsWith('Bearer ') && c.headers.Authorization !== 'Bearer user-jwt');
    check('★2-3 성공이면 계정 2개를 돌려준다', r?.ok === true && Array.isArray(r.accounts) && r.accounts.length === 2 && r.accounts[0].email === ownerMasked, show(r));
    reply = { status: 404, body: { ok: false, reason: 'no_account' } };
    const n = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    check('2-4 no_account → 이메일 찾기 문구', n?.ok === false && n.message === M?.FIND_NO_ACCOUNT_TEXT, show(n));
    reply = { status: 400, body: { ok: false, reason: 'expired' } };
    const x = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    check('2-5 expired → 다시 받아 달라는 문구', x?.ok === false && typeof x.message === 'string' && x.message.includes('다시 받아'), show(x));
    reply = { status: 400, body: { ok: false, reason: 'mismatch' } };
    const mm = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    check('2-6 mismatch → 맞지 않는다는 문구', mm?.ok === false && typeof mm.message === 'string' && mm.message.includes('맞지 않아요'), show(mm));
    reply = { status: 200, body: { ok: true } };
    const o = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    check('★2-7 ok 인데 accounts 가 없으면(옛 엣지) 실패 · 빈 문구가 아니다', o?.ok === false && copyOk(o.message), show(o));
    reply = { status: 502, body: '<html>bad gateway</html>' };
    const g = await findEmailByPhone({ phone: '01012345678', code: '123456' });
    check('2-8 JSON 이 아닌 답 → 실패 · 빈 문구가 아니다', g?.ok === false && copyOk(g.message), show(g));
  } else {
    check('★2-1 findEmailByPhone 이 있다(지금 앱은 find_email 을 부를 길이 없다)', false);
  }

  if (fn(resetPasswordByPhone)) {
    reply = { status: 200, body: { ok: true, email: ownerMasked, provider: 'google' } };
    const r = await resetPasswordByPhone({ phone: '01012345678', code: '123456', role: 'owner', newPassword: 'newpass123' });
    check('★2-9 reset_password 성공 응답의 가린 이메일을 돌려준다', r?.ok === true && r.email === ownerMasked, show(r));
    reply = { status: 200, body: { ok: true } };
    const r0 = await resetPasswordByPhone({ phone: '01012345678', code: '123456', role: 'owner', newPassword: 'newpass123' });
    check('2-10 옛 엣지(이메일 없음) → 성공 · email null', r0?.ok === true && r0.email === null, show(r0));
  } else {
    check('resetPasswordByPhone 이 있다', false);
  }
}

// ── [3] 엣지 계약 ─────────────────────────────────────────────────────
console.log('\n[3] otp 엣지 계약');
{
  const edge = strip(read('supabase/functions/otp/index.ts'));
  const fe = (edge.match(/if \(body\.action === 'find_email'\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('3-1 find_email 이 accounts 를 돌려준다', /json\(200, \{ ok: true, accounts \}/.test(fe));
  check('3-2 계정 줄 = role(signup_role) · email(maskEmail) · provider(google|email)',
    /role: p\.signup_role/.test(fe) && /email: maskEmail\(/.test(fe) && /provider: u\.user\.app_metadata\?\.provider === 'google' \? 'google' : 'email'/.test(fe));
  check('3-3 reset_password 성공이 email(maskEmail) 을 싣는다', /email: maskEmail\(upd\?\.user\?\.email\)/.test(edge));
  // 2026-10-05 결정: 재설정해도 다른 기기 세션을 끊지 않는다.
  check('3-4 reset_password 가 revoke_user_sessions 를 부르지 않는다', !/revoke_user_sessions/.test(edge));
}

// ── [4] 화면 배선 ─────────────────────────────────────────────────────
console.log('\n[4] 화면 배선');
{
  const forgot = strip(read('src/app/forgot-password.tsx'));
  check('★4-1 찾기 화면에 [이메일 찾기 / 비밀번호 바꾸기] 두 갈래', forgot.includes("'이메일 찾기'") && forgot.includes("'비밀번호 바꾸기'") && /testID=\{?["'`]forgot-mode/.test(forgot), '');
  check('4-2 이메일 찾기가 findEmailByPhone 을 부르고 줄 · 구글 안내를 그린다',
    /findEmailByPhone\(/.test(forgot) && /foundAccountLine\(/.test(forgot) && /googleAccountHint\([^)]*SHOW_SOCIAL_LOGIN\)/.test(forgot) && /testID="forgot-found"/.test(forgot));
  check('4-3 비밀번호를 바꾼 뒤 resetDoneText 로 이메일을 보여 준다', /resetDoneText\(/.test(forgot));
  check('4-4 비밀번호 바꾸기는 기존 흐름 그대로(역할 · resetPasswordByPhone · 역할 안내)', /resetPasswordByPhone\(\{ phone: normalized, code, role, newPassword: pw \}\)/.test(forgot) && /ROLE_SPLIT_TEXT/.test(forgot));
  check('4-5 찾기 화면에 결제 채널 말이 없다', !CHANNEL.test(forgot));

  const login = strip(read('src/app/login.tsx'));
  check('★4-6 로그인 링크 문구 = "이메일·비밀번호 찾기"', login.includes('이메일·비밀번호 찾기') && !login.includes('비밀번호를 잊으셨나요?'));

  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  const up = afterUpdateUser(ss);
  check('★4-7 updateProfile 이 updateUser 응답(user)을 emailChangeApplied 로 판정한다', /const \{ data: [a-zA-Z]+, error \} = await supabase\.auth\.updateUser\(\s*\{ email: patch\.email \}/.test(up) && /emailChangeApplied\(/.test(up), show(up.slice(0, 120)));
  check('★4-8 확인 메일 대기면 로컬 email 을 덮지 않는다(무조건 덮는 줄이 없다)', up.length > 0 && !/if \(patch\.email != null\) next\.email = patch\.email;/.test(up) && /emailPending/.test(up), show(up.slice(0, 120)));

  const edit = strip(read('src/app/account-edit.tsx'));
  const save = (edit.match(/const saveProfile = async[\s\S]*?\n  \};/) || [''])[0];
  check('4-9 프로필 저장이 대기면 확인 메일 안내를 보여 준다', /emailPending/.test(save) && /EMAIL_CHANGE_PENDING_TEXT/.test(save), show(save.slice(0, 80)));
}

// ── [5] 이메일 변경 확인 흐름(2026-10-05 · 시장 표준) ─────────────────────────────
//   updateUser 에 emailRedirectTo 를 준다 → 링크를 누르면 Supabase verify 를 거쳐 /email-changed 로 온다.
//   그 화면이 "이메일이 바뀌었어요"(또는 옛 주소 확인이 남았으면 "한 곳 더 확인해 주세요")를 말한다.
//   profiles 에는 email 열이 없다(auth.users 만) → 동기화할 것이 없다. 앱은 세션 갱신 때 loadProfile 이 새 이메일을 읽는다.
console.log('\n[5] 이메일 변경 확인 흐름');
{
  const rt = M && fn(M.emailChangeRedirectTo) ? M.emailChangeRedirectTo : null;
  check('★5-1 돌아올 주소 = 지금 오리진 + /email-changed', !!rt && rt('https://dochackchack.com') === 'https://dochackchack.com/email-changed', rt ? rt('https://dochackchack.com') : '함수 없음');
  const nt = M && fn(M.emailChangedNotice) ? M.emailChangedNotice : null;
  const ok = nt ? nt({}) : null;
  check('★5-2 확인 끝 → "이메일이 바뀌었어요"', ok?.title === '이메일이 바뀌었어요' && copyOk(ok?.body), show(ok));
  const half = nt ? nt({ message: 'Confirmation link accepted. Please proceed to confirm link sent to the other email' }) : null;
  check('★5-3 한 주소만 확인 → "한 곳 더 확인해 주세요"', half?.title === '한 곳 더 확인해 주세요' && copyOk(half?.body), show(half));
  const bad = nt ? nt({ error: 'access_denied', error_description: 'Email link is invalid or has expired' }) : null;
  check('5-4 만료·잘못된 링크 → "링크를 쓸 수 없어요"', bad?.title === '링크를 쓸 수 없어요' && copyOk(bad?.body), show(bad));
  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  check('★5-5 updateUser 에 emailRedirectTo(emailChangeRedirectTo)를 준다', /updateUser\(\s*\{ email: patch\.email \},\s*\{ emailRedirectTo: emailChangeRedirectTo\(/.test(ss));
  check('5-6 세션이 바뀌면(USER_UPDATED · TOKEN_REFRESHED 포함) 새 auth 이메일로 프로필을 다시 읽는다', /onAuthStateChange\(\(_evt, session\) => \{\s*const u = session\?\.user;\s*if \(u\) loadProfile\(set, u\.id, u\.email/.test(ss));
  const page = strip(read('src/app/email-changed.tsx'));
  check('★5-7 /email-changed 화면이 emailChangedNotice 로 문구를 고른다', /emailChangedNotice\(/.test(page) && /useLocalSearchParams/.test(page));
  check('5-8 웹 셸이 /email-changed 를 크롬 없는 인증 경로로 둔다', /AUTH_PATHS = \[[^\]]*'\/email-changed'/.test(read('src/components/shell/AppShell.web.tsx')));
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
