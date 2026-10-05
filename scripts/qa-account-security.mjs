#!/usr/bin/env node
// qa-account-security.mjs — 0238 계정 보안 · 번호 트리거 + otp 엣지 (로컬 도커 전용)
//
// 무엇을 못박나:
//   [1] Q13·M5 — profiles.phone 은 "방금 문자 인증을 마친 번호"로만 바뀐다(guard_profile_phone_change).
//       인증한 사람(verified_by)이 본인이면 15분, 기록이 없는 옛 앱 인증(PhoneVerifyBlock)은 5분 안만 통과.
//       남이 인증한 번호·인증 안 한 번호·오래된 인증은 PHONE_NOT_VERIFIED. phone_last4 는 서버가 다시 계산한다.
//       번호가 비어 있던 계정(구글 가입 프로필 완성)은 본인·기록 없는 인증 모두 30분 안이면 통과.
//   [2] A4 — revoke_user_sessions(uuid) 는 service_role 만 부른다. 부르면 그 사용자의 세션이 끊긴다.
//   [3] otp 엣지 — verify 가 verified_by·in_use 를 남기고 코드를 소모한다. change_phone 은 로그인 필수.
//       find_email 은 가린 이메일을 최대 2개 준다. reset_password 는 signup_role 로 계정을 찾고(Q18),
//       다른 역할에만 계정이 있으면 other_role 을 주고, 성공하면 가린 이메일을 주고 세션은 남긴다(2026-10-05).
//   [4] maskEmail 진리표(순수 함수, supabase/functions/otp/helpers.ts).
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// ★엣지 검사는 로컬 엣지 런타임(http://127.0.0.1:54321/functions/v1/otp)이 이 작업 트리를 서빙할 때만 의미가 있다.
//   SMS 발송(send)은 로컬에 솔라피 키가 없어 쓰지 않는다. 코드 해시를 service_role 로 직접 심는다.
// 실행: node scripts/qa-account-security.mjs   자가정리(계정·OTP 행).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

// 엣지 isValidPhone(/^01[016789]\d{7,8}$/)을 통과하는 번호. 매 실행 다른 번호.
const ph = (i) => `016${i % 10}${String(Number(s.slice(0, 7)) + Math.floor(i / 10)).padStart(7, '0').slice(-7)}`;
const P = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, ph(i)]));
const allPhones = Object.values(P);
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();
const sha = (x) => createHash('sha256').update(x).digest('hex');

// phone_otps 행을 심는다. verified_by 컬럼이 아직 없으면(0238 전) 그 값 없이 심는다.
async function seedOtp(phone, { verifiedAgoMin = null, verifiedBy = null, code = null } = {}) {
  const now = Date.now();
  const row = {
    phone,
    code_hash: code ? sha(`${phone}:${code}`) : 'qa-acct',
    expires_at: iso(code ? now + 3 * MIN : now),
    attempts: 0,
    last_sent_at: iso(now - 2 * MIN),
    sent_count: 1,
    sent_reset_at: iso(now + 86400000),
    verified_at: verifiedAgoMin == null ? null : iso(now - verifiedAgoMin * MIN),
    verified_by: verifiedBy,
  };
  let r = await admin.from('phone_otps').upsert(row, { onConflict: 'phone' });
  if (r.error && /verified_by/.test(r.error.message)) {
    delete row.verified_by;
    r = await admin.from('phone_otps').upsert(row, { onConflict: 'phone' });
  }
  if (r.error) throw new Error(`phone_otps 시드(${phone}): ${r.error.message}`);
}
const otpRow = async (phone) => (await admin.from('phone_otps').select('*').eq('phone', phone).maybeSingle()).data;
const prof = async (id) => (await admin.from('profiles').select('phone, phone_last4, phone_norm, role, signup_role').eq('id', id).maybeSingle()).data;

const OTP_URL = `${URL_}/functions/v1/otp`;
async function otp(body, token = null) {
  try {
    const res = await fetch(OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token ?? ANON}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    return { status: res.status, ...(j ?? {}) };
  } catch (e) {
    return { status: 0, reason: 'network', err: String(e) };
  }
}
const tok = async (c) => (await c.auth.getSession()).data.session?.access_token ?? null;

const users = [];
async function signUp(tag, role, phone) {
  const c = mk();
  const email = `qa_acct_${tag}_${s}@example.com`;
  const r = await c.auth.signUp({ email, password: pw, options: { data: { name: `QA계정${tag}`, role, phone, birth_date: '1990-01-01' } } });
  if (r.error || !r.data.user) throw new Error(`${tag} signUp: ${r.error?.message ?? 'no user'}`);
  const u = { c, id: r.data.user.id, email };
  users.push(u);
  return u;
}

try {
  const A = await signUp('a', 'owner', P[0]);   // 사장으로 가입, 매장 없음 → role 은 아직 junior
  const B = await signUp('b', 'junior', P[1]);
  const E = await signUp('e', 'owner', P[2]);
  {
    const pa = await prof(A.id);
    console.log(`셋업 — A(${pa?.signup_role}/${pa?.role}) B E · 번호 ${P[0]} ${P[1]} ${P[2]}`);
  }
  const upd = (u, patch) => u.c.from('profiles').update(patch).eq('id', u.id).select('id');
  const errText = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''}`.trim();
  const blocked = (r) => /PHONE_NOT_VERIFIED/.test(r.error?.message ?? '');

  // ═══════ 1. Q13·M5 — 번호 트리거 ═══════
  console.log('\n[1] guard_profile_phone_change — 방금 인증한 번호만');
  {
    let r = await upd(A, { phone: P[3], phone_last4: P[3].slice(-4) });
    check('1-1 ★인증 기록이 없는 번호로 바꾸면 PHONE_NOT_VERIFIED', blocked(r), r.error ? errText(r) : `성공함 phone=${(await prof(A.id))?.phone}`);

    await seedOtp(P[4], { verifiedAgoMin: 0, verifiedBy: B.id });
    r = await upd(A, { phone: P[4], phone_last4: P[4].slice(-4) });
    check('1-2 ★남(B)이 방금 인증한 번호로 바꾸면 PHONE_NOT_VERIFIED', blocked(r), r.error ? errText(r) : `성공함 phone=${(await prof(A.id))?.phone}`);

    await seedOtp(P[5], { verifiedAgoMin: 0, verifiedBy: A.id });
    r = await upd(A, { phone: P[5], phone_last4: '9999' });
    let pa = await prof(A.id);
    check('1-3 본인이 방금 인증한 번호는 바뀐다', !r.error && pa?.phone === P[5], r.error ? errText(r) : `phone=${pa?.phone}`);
    check('1-4 ★phone_last4 는 클라이언트 값(9999)이 아니라 번호에서 다시 계산한다', pa?.phone_last4 === P[5].slice(-4), `last4=${pa?.phone_last4}`);

    await seedOtp(P[6], { verifiedAgoMin: 3, verifiedBy: null });
    r = await upd(A, { phone: P[6], phone_last4: P[6].slice(-4) });
    check('1-5 옛 앱(인증자 기록 없음) 3분 전 인증은 통과(PhoneVerifyBlock 호환)', !r.error && (await prof(A.id))?.phone === P[6], errText(r));

    await seedOtp(P[7], { verifiedAgoMin: 6, verifiedBy: null });
    r = await upd(A, { phone: P[7], phone_last4: P[7].slice(-4) });
    check('1-6 ★옛 앱 인증이 6분 지났으면 거부(5분 창)', blocked(r), r.error ? errText(r) : '성공함');

    await seedOtp(P[8], { verifiedAgoMin: 20, verifiedBy: A.id });
    r = await upd(A, { phone: P[8], phone_last4: P[8].slice(-4) });
    check('1-7 ★본인 인증도 20분 지났으면 거부(15분 창)', blocked(r), r.error ? errText(r) : '성공함');

    await seedOtp(P[9], { verifiedAgoMin: 10, verifiedBy: A.id });
    r = await upd(A, { phone: P[9], phone_last4: P[9].slice(-4) });
    check('1-8 본인 인증 10분 전은 통과', !r.error && (await prof(A.id))?.phone === P[9], errText(r));

    const cp = await A.c.rpc('complete_profile', { p_name: 'QA계정a', p_phone: P[10], p_birth_date: '1990-01-01', p_role: null });
    check('1-9 ★complete_profile 도 같은 규칙(인증 안 한 번호면 PHONE_NOT_VERIFIED)', /PHONE_NOT_VERIFIED/.test(cp.error?.message ?? ''), cp.error ? cp.error.message : `성공함 phone=${(await prof(A.id))?.phone}`);

    const fmt = `${P[9].slice(0, 3)}-${P[9].slice(3, 7)}-${P[9].slice(7)}`;
    r = await upd(A, { phone: fmt });
    check('1-10 같은 번호를 하이픈만 바꿔 저장하면 통과(정규화 비교)', !r.error, errText(r));

    r = await upd(A, { phone: null, phone_last4: null });
    pa = await prof(A.id);
    check('1-11 번호를 비우는 것은 통과(탈퇴 경로와 같은 null)', !r.error && pa?.phone == null && pa?.phone_last4 == null, errText(r));

    const ar = await admin.from('profiles').update({ phone: P[0], phone_last4: '0000' }).eq('id', A.id);
    pa = await prof(A.id);
    check('1-12 service_role(엣지·크론)은 인증 없이 바꿀 수 있고 last4 는 다시 계산된다', !ar.error && pa?.phone === P[0] && pa?.phone_last4 === P[0].slice(-4), ar.error?.message ?? `last4=${pa?.phone_last4}`);

    // 구글 가입 프로필 완성(complete-profile.tsx): 번호를 먼저 인증하고(옛 앱·현재 앱 모두 anon verify)
    // 생년월일·매장 이름·업종·사업자번호를 채운 뒤에 complete_profile 을 부른다. 5분을 넘기기 쉽다.
    const G = await signUp('g', 'owner', null);
    await seedOtp(P[13], { verifiedAgoMin: 6, verifiedBy: null });
    let cg = await G.c.rpc('complete_profile', { p_name: 'QA계정g', p_phone: P[13], p_birth_date: '1990-01-01', p_role: 'owner' });
    check('1-13 ★번호가 비어 있던 계정은 anon 인증 6분 뒤 complete_profile 도 통과(구글 가입 프로필 완성)', !cg.error && (await prof(G.id))?.phone === P[13], cg.error ? cg.error.message : `phone=${(await prof(G.id))?.phone}`);

    const H = await signUp('h', 'owner', null);
    await seedOtp(P[14], { verifiedAgoMin: 31, verifiedBy: null });
    cg = await H.c.rpc('complete_profile', { p_name: 'QA계정h', p_phone: P[14], p_birth_date: '1990-01-01', p_role: 'owner' });
    check('1-14 ★번호가 비어 있어도 anon 인증 31분이 지났으면 PHONE_NOT_VERIFIED', /PHONE_NOT_VERIFIED/.test(cg.error?.message ?? ''), cg.error ? cg.error.message : `성공함 phone=${(await prof(H.id))?.phone}`);

    await seedOtp(P[15], { verifiedAgoMin: 1, verifiedBy: B.id });
    cg = await H.c.rpc('complete_profile', { p_name: 'QA계정h', p_phone: P[15], p_birth_date: '1990-01-01', p_role: 'owner' });
    check('1-15 번호가 비어 있어도 남(B)이 인증한 번호는 PHONE_NOT_VERIFIED', /PHONE_NOT_VERIFIED/.test(cg.error?.message ?? ''), cg.error ? cg.error.message : `성공함 phone=${(await prof(H.id))?.phone}`);
  }

  // ═══════ 2. A4 — revoke_user_sessions ═══════
  console.log('\n[2] revoke_user_sessions(uuid) — service_role 전용');
  {
    const a = await mk().rpc('revoke_user_sessions', { p_uid: B.id });
    check('2-1 anon 은 실행 권한이 없다(42501)', a.error?.code === '42501', `${a.error?.code ?? '-'} ${a.error?.message ?? `rpc=${a.data}`}`);
    const b = await B.c.rpc('revoke_user_sessions', { p_uid: B.id });
    check('2-2 authenticated 도 실행 권한이 없다(42501)', b.error?.code === '42501', `${b.error?.code ?? '-'} ${b.error?.message ?? `rpc=${b.data}`}`);
    const before = await B.c.auth.getUser();
    const r = await admin.rpc('revoke_user_sessions', { p_uid: B.id });
    const after = await B.c.auth.getUser();
    check('2-3 ★service_role 이 부르면 세션이 지워지고 그 토큰의 getUser 가 실패한다',
      !r.error && Number(r.data) >= 1 && !before.error && !!after.error,
      r.error ? errText(r) : `rpc=${r.data} before=${before.error?.message ?? 'ok'} after=${after.error?.message ?? 'ok'}`);
  }

  // ═══════ 3. otp 엣지 ═══════
  console.log('\n[3] otp 엣지 (로컬 서빙)');
  {
    const probe = await otp({ action: 'verify', phone: '01600000000', code: '000000' });
    if (probe.status === 0) throw new Error(`로컬 엣지에 닿지 않는다: ${probe.err}`);
    const tA = await tok(A.c);

    await seedOtp(P[11], { code: '111111' });
    let r = await otp({ action: 'verify', phone: P[11], code: '111111', role: 'owner' }, tA);
    let row = await otpRow(P[11]);
    check('3-1 로그인 상태 verify 성공', r.status === 200 && r.ok === true, JSON.stringify(r));
    check('3-2 ★verify 가 verified_by 에 JWT 사용자를 남긴다', row?.verified_by === A.id, `verified_by=${row?.verified_by}`);
    check('3-3 ★verify 응답에 in_use(false) 가 실린다', r.in_use === false, `in_use=${r.in_use}`);
    r = await otp({ action: 'verify', phone: P[11], code: '111111', role: 'owner' }, tA);
    check('3-4 ★같은 코드로 두 번 verify 하면 expired(코드 소모)', r.status === 400 && r.reason === 'expired', JSON.stringify(r));
    const ru = await upd(A, { phone: P[11] });
    check('3-5 엣지에서 본인이 인증한 번호는 직접 저장도 통과(트리거 연동)', !ru.error, errText(ru));

    await seedOtp(P[2], { code: '222222' });
    r = await otp({ action: 'verify', phone: P[2], code: '222222', role: 'owner' });
    row = await otpRow(P[2]);
    check('3-6 비로그인 verify 는 verified_by 를 비운다', r.status === 200 && row && row.verified_by == null, `${JSON.stringify(r)} by=${row?.verified_by}`);
    check('3-7 ★in_use 는 그 역할에 이미 계정이 있으면 true', r.in_use === true, `in_use=${r.in_use}`);

    // change_phone
    await seedOtp(P[12], { code: '333333' });
    r = await otp({ action: 'change_phone', phone: P[12], code: '333333' });
    check('3-8 ★change_phone 은 로그인이 없으면 401', r.status === 401, JSON.stringify(r));
    r = await otp({ action: 'change_phone', phone: P[12], code: '000000' }, tA);
    check('3-9 change_phone 코드가 틀리면 mismatch', r.status === 400 && r.reason === 'mismatch', JSON.stringify(r));
    r = await otp({ action: 'change_phone', phone: P[12], code: '333333' }, tA);
    let pa = await prof(A.id);
    row = await otpRow(P[12]);
    check('3-10 ★change_phone 이 번호를 바꾸고 last4 를 맞춘다', r.status === 200 && r.ok === true && pa?.phone === P[12] && pa?.phone_last4 === P[12].slice(-4), `${JSON.stringify(r)} phone=${pa?.phone}`);
    check('3-11 change_phone 뒤 코드가 소모되고 verified_by=본인', row && new Date(row.expires_at).getTime() <= Date.now() && row.verified_by === A.id, `exp=${row?.expires_at} by=${row?.verified_by}`);

    await seedOtp(P[2], { code: '444444' });
    r = await otp({ action: 'change_phone', phone: P[2], code: '444444' }, tA);
    check('3-12 ★같은 역할(사장) 다른 계정의 번호면 phone_taken', r.reason === 'phone_taken' && (await prof(A.id))?.phone === P[12], JSON.stringify(r));

    await seedOtp(P[1], { code: '555555' });
    r = await otp({ action: 'change_phone', phone: P[1], code: '555555' }, tA);
    check('3-13 다른 역할(직원 B)의 번호는 사장 계정이 같이 쓸 수 있다', r.status === 200 && (await prof(A.id))?.phone === P[1], JSON.stringify(r));

    // find_email — A(사장, 구글 표시) 와 B(직원) 가 같은 번호 P[1]
    await admin.auth.admin.updateUserById(A.id, { app_metadata: { provider: 'google', providers: ['google'] } });
    await seedOtp(P[1], { code: '666666' });
    r = await otp({ action: 'find_email', phone: P[1], code: '666666' });
    const acc = Array.isArray(r.accounts) ? r.accounts : [];
    const accA = acc.find((x) => x.role === 'owner'), accB = acc.find((x) => x.role === 'junior');
    check('3-14 ★find_email 이 역할별 계정 2개를 준다', r.status === 200 && acc.length === 2 && !!accA && !!accB, JSON.stringify(r));
    check('3-15 이메일은 가려져 있다(전체 주소가 응답에 없다)', acc.length === 2 && !JSON.stringify(r).includes(A.email) && !JSON.stringify(r).includes(B.email) && /\*/.test(accA?.email ?? ''), JSON.stringify(acc));
    check('3-16 구글 가입 계정에는 provider=google 표시', accA?.provider === 'google' && accB?.provider !== 'google', JSON.stringify(acc));
    r = await otp({ action: 'find_email', phone: P[1], code: '666666' });
    check('3-17 find_email 코드도 한 번 쓰면 expired', r.status === 400 && r.reason === 'expired', JSON.stringify(r));

    // reset_password — A 는 signup_role=owner, role=junior(매장 없음)
    const newPw = 'NewPass123!qa';
    await seedOtp(P[1], { code: '777777' });
    const beforeA = await A.c.auth.getUser();
    r = await otp({ action: 'reset_password', phone: P[1], code: '777777', role: 'owner', new_password: newPw });
    check('3-18 ★매장 없는 사장(role=junior)도 "사장"으로 재설정된다(Q18)', r.status === 200 && r.ok === true, JSON.stringify(r));
    check('3-19 ★성공 응답에 가린 이메일이 실린다', typeof r.email === 'string' && r.email.includes('*') && r.email !== A.email, `email=${r.email}`);
    const login = await mk().auth.signInWithPassword({ email: A.email, password: newPw });
    check('3-20 새 비밀번호로 A 가 로그인된다(B 가 아니라)', !login.error && login.data.user?.id === A.id, login.error?.message ?? `uid=${login.data.user?.id}`);
    const afterA = await A.c.auth.getUser();
    // 2026-10-05 결정: 비밀번호를 바꿔도 다른 기기는 로그아웃되지 않는다.
    //   admin.updateUserById 는 모든 세션을 끊으므로 otp 는 0253 admin_set_password 로 해시를 직접 바꾼다.
    check('3-21 ★재설정 뒤에도 A 의 기존 세션이 살아 있다(0253)', !beforeA.error && !afterA.error, `before=${beforeA.error?.message ?? 'ok'} after=${afterA.error?.message ?? 'ok'}`);

    await seedOtp(P[2], { code: '888888' });
    r = await otp({ action: 'reset_password', phone: P[2], code: '888888', role: 'junior', new_password: newPw });
    check('3-22 ★직원 계정이 없고 사장 계정만 있으면 no_account + other_role=owner', r.status === 404 && r.reason === 'no_account' && r.other_role === 'owner', JSON.stringify(r));
  }

  // ═══════ 4. maskEmail 진리표 ═══════
  console.log('\n[4] maskEmail 진리표 (supabase/functions/otp/helpers.ts)');
  {
    let maskEmail = null;
    try {
      ({ maskEmail } = await import(pathToFileURL(join(ROOT, 'supabase/functions/otp/helpers.ts')).href));
    } catch (e) { check('4-0 helpers.ts 를 불러온다', false, String(e).slice(0, 120)); }
    if (maskEmail) {
      for (const [inp, want] of [
        ['abcdef@gmail.com', 'ab****@g****.com'],
        ['abc@naver.com', 'ab****@n****.com'],
        ['ab@naver.com', 'a****@n****.com'],
        ['a@daum.net', 'a****@d****.net'],
        ['hong.gildong@mail.example.co.kr', 'ho****@m****.example.co.kr'],
        ['Kim@Company.CO.KR', 'Ki****@C****.CO.KR'],
        ['localhost-only', '****'],
        ['@nolocal.com', '****'],
        ['', ''],
      ]) {
        const got = maskEmail(inp);
        check(`4 maskEmail(${JSON.stringify(inp)}) = ${JSON.stringify(want)}`, got === want, `got=${JSON.stringify(got)}`);
      }
    }
  }

  // ═══════ 5. 탈퇴 경로 ═══════
  console.log('\n[5] 탈퇴(phone=null)는 트리거에 막히지 않는다');
  {
    const r = await E.c.rpc('delete_my_account');
    const pe = await prof(E.id);
    check('5-1 delete_my_account 성공, 번호가 비워진다', !r.error && pe?.phone == null, r.error?.message ?? `phone=${pe?.phone}`);
  }
} catch (e) {
  fail++;
  console.log('  FAIL (중단)', e?.message ?? e);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  try { await admin.from('phone_otps').delete().in('phone', allPhones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
