// qa-password-sessions.mjs — 비밀번호를 바꿔도 다른 기기는 로그아웃되지 않는다(2026-10-05 사용자 결정 · 0253).
//
// 왜: GoTrue 의 updateUser·admin.updateUserById 는 비밀번호를 바꾸면 다른 세션의 리프레시 토큰을 지운다(끄는 설정 없음).
//   0253 change_my_password(설정 화면) · admin_set_password(otp 문자 재설정)는 해시를 직접 바꿔 세션을 남긴다.
// 대조군: updateUser 로 바꾸면 다른 기기가 끊긴다 — 이게 GREEN 이면 GoTrue 동작이 바뀐 것이니 0253 이 여전히 필요한지 다시 본다.
// 로컬 전용. 임시 계정을 만들고 끝나면 지운다.
// 실행: node scripts/qa-password-sessions.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const f of ['.env', '.env.seed']) {
  try {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  } catch { /* 없는 파일은 건너뛴다 */ }
}
const U = env.EXPO_PUBLIC_SUPABASE_URL, K = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!/127\.0\.0\.1|localhost/.test(U ?? '')) { console.error('로컬 전용이다:', U); process.exit(2); }

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${!ok && info ? ` — ${info}` : ''}`); };
const admin = createClient(U, SR, { auth: { persistSession: false } });
const mk = () => createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const alive = async (s) => !(await mk().auth.refreshSession({ refresh_token: s.refresh_token })).error;
const canLogin = async (email, password) => !(await mk().auth.signInWithPassword({ email, password })).error;

async function user(pw = 'oldpass123') {
  const email = `pwqa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  const A = mk(), B = mk();
  const a = (await A.auth.signInWithPassword({ email, password: pw })).data.session;
  const b = (await B.auth.signInWithPassword({ email, password: pw })).data.session;
  return { id: data.user.id, email, A, a, b };
}
const made = [];

try {
  console.log('[대조군] updateUser 는 다른 기기를 끊는다');
  {
    const u = await user(); made.push(u.id);
    await u.A.auth.updateUser({ password: 'newpass456' });
    check('updateUser 뒤 B 끊김(GoTrue 고정 동작)', !(await alive(u.b)));
  }

  console.log('[1] 설정에서 바꾸기 — change_my_password');
  {
    const u = await user(); made.push(u.id);
    const r = await u.A.rpc('change_my_password', { p_current: 'oldpass123', p_new: 'newpass456' });
    check('결과 ok', r.data === 'ok', JSON.stringify(r));
    check('★다른 기기 B 가 살아 있다', await alive(u.b));
    check('바꾼 기기 A 도 살아 있다', await alive(u.a));
    check('새 비밀번호로 로그인된다', await canLogin(u.email, 'newpass456'));
    check('옛 비밀번호로는 안 된다', !(await canLogin(u.email, 'oldpass123')));
  }

  console.log('[2] 거절');
  {
    const u = await user(); made.push(u.id);
    const call = (c, n) => u.A.rpc('change_my_password', { p_current: c, p_new: n }).then((r) => r.data ?? r.error?.message);
    check('같은 비밀번호 → same_password', (await call('oldpass123', 'oldpass123')) === 'same_password');
    check('9자 미만 → weak_password', (await call('oldpass123', 'short')) === 'weak_password');
    check('비밀번호 그대로', await canLogin(u.email, 'oldpass123'));
    for (let i = 0; i < 5; i++) await call('wrongpass!', 'newpass456');
    check('5번 틀리면 맞는 비밀번호도 → too_many_attempts', (await call('oldpass123', 'newpass456')) === 'too_many_attempts');
    check('잠긴 동안 비밀번호 그대로', await canLogin(u.email, 'oldpass123'));
    const anon = await mk().rpc('change_my_password', { p_current: 'x', p_new: 'newpass456' });
    check('로그인 안 한 사람은 부를 수 없다', !!anon.error);
    const sneak = await u.A.rpc('admin_set_password', { p_uid: u.id, p_new: 'hacked1234' });
    check('일반 사용자는 admin_set_password 를 못 부른다', !!sneak.error);
    const fails = await u.A.from('password_change_failures').select('*');
    check('실패 기록 표는 사용자에게 안 보인다', !!fails.error || (fails.data ?? []).length === 0);
  }

  console.log('[3] 문자 재설정 — admin_set_password(service_role)');
  {
    const u = await user(); made.push(u.id);
    const r = await admin.rpc('admin_set_password', { p_uid: u.id, p_new: 'resetpass789' });
    check('에러 없음', !r.error, r.error?.message);
    check('★다른 기기 A·B 가 살아 있다', (await alive(u.a)) && (await alive(u.b)));
    check('새 비밀번호로 로그인된다', await canLogin(u.email, 'resetpass789'));
    const weak = await admin.rpc('admin_set_password', { p_uid: u.id, p_new: 'short' });
    check('9자 미만은 거절', !!weak.error);
  }
} finally {
  for (const id of made) await admin.auth.admin.deleteUser(id);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
