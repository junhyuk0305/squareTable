#!/usr/bin/env node
// qa-signout-push-db.mjs — 로그아웃 순서(src/lib/push/signOutPush.ts)를 로컬 도커 DB 의 진짜 RPC 로 돌린다 (Q3 · Q16 · A1)
//
// 앱의 useSessionStore.signOut 이 넘기는 콜백을 그대로 흉내 낸다:
//   unregister   = supabase.rpc('unregister_my_push', { p_token }).abortSignal(signal)
//   signOutLocal = supabase.auth.signOut({ scope: 'local' })
//   부팅 release  = (anon) supabase.rpc('release_push_token', { p_token, p_user })
// 무엇을 못박나:
//   [1] 온라인 로그아웃: 그 기기 토큰이 발송 대상에서 빠진다. 같은 계정의 다른 기기는 로그인·푸시가 그대로다(Q16).
//   [2] 오프라인 로그아웃(A1): 서버 세션이 남아 대상에 그대로 있다 → pending 이 남는다 → 다음 부팅 release 로 빠진다.
//   [3] 순서: release 를 등록보다 먼저 해야 한다. 거꾸로 하면 같은 계정의 새 등록이 지워진다.
//   [4] 같은 계정이 같은 폰에서 다시 로그인하면 release 를 보내지 않는다(늦게 도착해 새 등록을 지우지 않게 · 10-05).
//
// ★로컬 전용: 로컬 고정 계정(staff2@pilot.squaretable.app, local_bootstrap.sh)을 쓴다. URL 이 로컬이 아니면 멈춘다.
//   이번 실행에서 만든 토큰 행만 지운다. 세션은 전부 local 로그아웃한다.
// 실행: node scripts/qa-signout-push-db.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  console.error(`중단: 로컬 도커 전용 하니스다. 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

let mod = null;
try {
  mod = await import('../src/lib/push/signOutPush.ts');
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
if (typeof mod?.signOutWithPushRelease !== 'function' || typeof mod?.releasePendingPush !== 'function') {
  console.log(`\n── ${pass} PASS · ${fail} FAIL`);
  process.exit(1);
}

const EMAIL = 'staff2@pilot.squaretable.app', PW = 'pilot1234';
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** 한 대의 기기. offline=true 면 모든 요청이 네트워크 오류로 끝난다(비행기 모드). 저장소는 기기마다 따로. */
function device() {
  const state = { offline: false };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  const c = createClient(URL_, ANON, {
    global: { fetch: (input, init) => (state.offline ? Promise.reject(new TypeError('Network request failed')) : fetch(input, init)) },
    auth: { storage, persistSession: true, autoRefreshToken: false },
  });
  /** 앱 기기 저장소(AsyncStorage 자리). */
  const kv = new Map();
  const appKV = { m: kv, getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v), removeItem: async (k) => void kv.delete(k) };
  return { c, state, kv: appKV };
}

/** useSessionStore.signOut 이 넘기는 것과 같은 콜백으로 로그아웃한다. */
const appSignOut = (d, userId) => mod.signOutWithPushRelease({
  kv: d.kv,
  userId,
  unregister: async (token, signal) => {
    const { error } = await d.c.rpc('unregister_my_push', { p_token: token }).abortSignal(signal);
    return !error;
  },
  clearNotifications: async () => {},
  disableWebPush: async () => {},
  signOutLocal: async () => { await d.c.auth.signOut({ scope: 'local' }); },
});
const appRelease = (d, current) => mod.releasePendingPush(d.kv, async (p, signal) => {
  let q = anon().rpc('release_push_token', { p_token: p.token, p_user: p.userId });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  return !error && typeof data === 'number';
}, undefined, current);
const register = async (d, token) => {
  const { error } = await d.c.rpc('save_push_device_token', { p_token: token, p_platform: 'android', p_unit_id: null });
  if (error) throw new Error('save_push_device_token: ' + error.message);
  await mod.rememberRegisteredToken(d.kv, token);
};
const targets = async (uid) => {
  const r = await admin.rpc('push_device_targets', { p_user_ids: [uid] });
  if (r.error) throw new Error('push_device_targets: ' + r.error.message);
  return (r.data ?? []).map((x) => x.token);
};
const signIn = async (d) => {
  const r = await d.c.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (r.error) throw new Error(`signIn ${EMAIL}: ${r.error.message} (local_bootstrap.sh 를 먼저 돌린다)`);
  return r.data.user.id;
};

const s = String(Date.now()).slice(-9);
const tok = (n) => `ExponentPushToken[qa_sop_${n}_${s}]`;
const made = [];
const devices = [];

try {
  // ═══════ 1. 온라인 로그아웃 ═══════
  console.log('\n[1] 온라인 로그아웃 — 그 기기만 빠지고 다른 기기는 그대로 (Q3 · Q16)');
  const X = device(), Y = device();
  devices.push(X, Y);
  const uid = await signIn(X);
  await signIn(Y);
  made.push(tok('x'), tok('y'));
  await register(X, tok('x'));
  await register(Y, tok('y'));
  const before = await targets(uid);
  check('1-0 두 기기 모두 대상', before.includes(tok('x')) && before.includes(tok('y')), JSON.stringify(before));
  const r1 = await appSignOut(X, uid);
  check('1-1 unregister 성공 · pending 없음', r1.released === true && r1.pendingSaved === false && !X.kv.m.has('sqt.pushReleasePending'), JSON.stringify(r1));
  const { data: rowX } = await admin.from('push_device_tokens').select('token').eq('token', tok('x'));
  check('1-2 ★X 토큰 행이 지워졌다', (rowX ?? []).length === 0, JSON.stringify(rowX));
  const after = await targets(uid);
  check('1-3 대상 = Y 만', !after.includes(tok('x')) && after.includes(tok('y')), JSON.stringify(after));
  const { data: sx } = await X.c.auth.getSession();
  check('1-4 X 기기 세션은 비었다', !sx.session);
  const gy = await Y.c.auth.getUser();
  check('1-5 ★Y 기기는 로그인 그대로(local 로그아웃 · Q16)', !gy.error && gy.data.user?.id === uid, gy.error?.message ?? '');

  // ═══════ 2. 오프라인 로그아웃 ═══════
  console.log('\n[2] 오프라인 로그아웃 — pending 을 남기고 다음 부팅에 푼다 (A1)');
  const Z = device();
  devices.push(Z);
  await signIn(Z);
  made.push(tok('z'));
  await register(Z, tok('z'));
  Z.state.offline = true;
  const r2 = await appSignOut(Z, uid);
  check('2-1 unregister 실패 → pending 저장', r2.released === false && r2.pendingSaved === true, JSON.stringify(r2));
  const pend = Z.kv.m.get('sqt.pushReleasePending');
  check('2-2 pending = {token, userId}', !!pend && JSON.parse(pend).token === tok('z') && JSON.parse(pend).userId === uid, String(pend));
  const { data: sz } = await Z.c.auth.getSession();
  check('2-3 Z 기기 세션은 지워졌다(네트워크 오류여도)', !sz.session);
  const mid = await targets(uid);
  console.log(`  INFO 서버 세션이 남아 Z 토큰은 아직 대상이다: ${mid.includes(tok('z'))} (A1 — pending 이 필요한 이유)`);
  Z.state.offline = false;
  const st = await appRelease(Z);
  check('2-4 ★다음 부팅 release_push_token(anon) → released', st === 'released' && !Z.kv.m.has('sqt.pushReleasePending'), `→ ${st}`);
  const end = await targets(uid);
  check('2-5 ★Z 토큰이 대상에서 빠졌다', !end.includes(tok('z')), JSON.stringify(end));
  check('2-6 Y 토큰은 그대로', end.includes(tok('y')), JSON.stringify(end));

  // ═══════ 3. 순서 ═══════
  console.log('\n[3] 부팅 순서 — release 를 등록보다 먼저');
  {
    // 같은 폰(같은 토큰)에서 같은 계정으로 다시 로그인하는 경우. pending = {tw, uid}.
    const W = device();
    devices.push(W);
    await signIn(W);
    made.push(tok('w'));
    await W.kv.setItem('sqt.pushReleasePending', JSON.stringify({ token: tok('w'), userId: uid }));
    // 거꾸로(등록 → release): 새 등록이 지워진다.
    await W.c.rpc('save_push_device_token', { p_token: tok('w'), p_platform: 'android', p_unit_id: null });
    await appRelease(W);
    const wrong = await targets(uid);
    check('3-1 (거꾸로) 등록 뒤 release 하면 새 등록이 지워진다 — 이래서 순서를 지킨다', !wrong.includes(tok('w')), JSON.stringify(wrong));
    // 맞는 순서(release → 등록 → pending 지움).
    await W.kv.setItem('sqt.pushReleasePending', JSON.stringify({ token: tok('w'), userId: uid }));
    await appRelease(W);
    await register(W, tok('w'));
    const right = await targets(uid);
    check('3-2 ★release → 등록 순서면 새 등록이 남는다', right.includes(tok('w')), JSON.stringify(right));
    check('3-3 등록 성공 뒤 pending 이 없다(다시 풀어 새 등록을 지우지 않게)', !W.kv.m.has('sqt.pushReleasePending'));
    const again = await appRelease(W);
    check('3-4 그 뒤 부팅 release 는 아무것도 안 한다', again === 'none' && (await targets(uid)).includes(tok('w')), `→ ${again}`);
  }

  // ═══════ 4. 같은 계정 재로그인 ═══════
  console.log('\n[4] 오프라인 로그아웃 뒤 같은 계정으로 다시 로그인 — release 를 보내지 않고 등록이 덮어쓴다');
  {
    const V = device();
    devices.push(V);
    await signIn(V);
    made.push(tok('v'));
    await register(V, tok('v'));
    V.state.offline = true;
    const r4 = await appSignOut(V, uid);
    V.state.offline = false;
    check('4-1 오프라인 로그아웃 → pending', r4.pendingSaved === true && V.kv.m.has('sqt.pushReleasePending'), JSON.stringify(r4));
    await signIn(V);
    const st4 = await appRelease(V, { userId: uid, token: tok('v') });
    check('4-2 ★같은 계정·같은 토큰 → superseded(요청 0) · pending 은 아직 남음', st4 === 'superseded' && V.kv.m.has('sqt.pushReleasePending'), `→ ${st4}`);
    await register(V, tok('v'));
    check('4-3 ★등록이 남고 pending 이 지워진다', (await targets(uid)).includes(tok('v')) && !V.kv.m.has('sqt.pushReleasePending'));
  }
} catch (e) {
  fail++;
  console.log('  FAIL 실행 중 오류', String(e?.message ?? e));
} finally {
  for (const d of devices) { try { d.state.offline = false; await d.c.auth.signOut({ scope: 'local' }); } catch { /* best-effort */ } }
  if (made.length) { try { await admin.from('push_device_tokens').delete().in('token', made); } catch { /* best-effort */ } }
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
