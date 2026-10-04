#!/usr/bin/env node
// qa-signout-push.mjs — 로그아웃 때 푸시를 먼저 푸는 순서(src/lib/push/signOutPush.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 Q3 · Q16 · A1:
//   Q3  로그아웃해도 그 폰에 푸시가 계속 왔다. signOut 이 토큰을 하나도 지우지 않았다.
//   Q16 한 기기에서 로그아웃하면 모든 기기가 로그아웃됐다. signOut() 기본값이 global 이었다.
//   A1  오프라인에서 로그아웃하면 서버 세션이 남아 푸시가 계속 온다.
// 정한 순서(마스터 계획 P3-2):
//   캐시 토큰(sqt.expoPushToken) 읽기 → unregister_my_push(4초 제한) → 실패하면 sqt.pushReleasePending 저장
//   → 알림센터 비우기·배지 0 → 웹 disablePush() → signOut({scope:'local'}).
//   부팅 때는 pending 을 release_push_token 으로 먼저 처리한다. 등록에 성공하면 pending 을 지운다.
// 실행: node scripts/qa-signout-push.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

let mod = null;
try {
  mod = await import('../src/lib/push/signOutPush.ts');
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}

const TOKEN = 'ExponentPushToken[qa_signout]';
const UID = '00000000-0000-4000-8000-000000000001';

/** 호출 순서를 남기는 메모리 저장소(AsyncStorage 와 같은 모양). */
function memKV(init = {}, log = []) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: async (k) => { log.push(`get:${k}`); return m.has(k) ? m.get(k) : null; },
    setItem: async (k, v) => { log.push(`set:${k}`); m.set(k, v); },
    removeItem: async (k) => { log.push(`remove:${k}`); m.delete(k); },
  };
}

/** 로그아웃 순서 한 번 돌리기. unregister 의 동작만 바꿔 끼운다. */
async function runSignOut({ unregister, token = TOKEN, userId = UID, timeoutMs = 50, throwIn = '' }) {
  const log = [];
  const kv = memKV(token ? { 'sqt.expoPushToken': token } : {}, log);
  let seenToken, seenSignal, scope;
  const step = (name) => async () => { log.push(name); if (throwIn === name) throw new Error('boom'); };
  const deps = {
    kv,
    userId,
    timeoutMs,
    unregister: async (t, signal) => { log.push('unregister'); seenToken = t; seenSignal = signal; return unregister(signal); },
    clearNotifications: step('clearNotifications'),
    disableWebPush: step('disableWebPush'),
    signOutLocal: async () => { log.push('signOutLocal'); scope = 'local'; if (throwIn === 'signOutLocal') throw new Error('boom'); },
  };
  if (timeoutMs == null) delete deps.timeoutMs;
  const t0 = Date.now();
  let result, threw = null;
  try { result = await mod.signOutWithPushRelease(deps); } catch (e) { threw = e; }
  return { log, kv, result, threw, seenToken, seenSignal, scope, ms: Date.now() - t0 };
}

const ok = typeof mod?.signOutWithPushRelease === 'function';
if (ok) {
  console.log('\n■ 상수');
  check('저장 키 sqt.expoPushToken', mod.PUSH_TOKEN_KEY === 'sqt.expoPushToken', `→ ${mod.PUSH_TOKEN_KEY}`);
  check('저장 키 sqt.pushReleasePending', mod.PUSH_PENDING_KEY === 'sqt.pushReleasePending', `→ ${mod.PUSH_PENDING_KEY}`);
  check('해제 제한 4초', mod.PUSH_UNREGISTER_TIMEOUT_MS === 4000, `→ ${mod.PUSH_UNREGISTER_TIMEOUT_MS}`);

  console.log('\n■ 온라인 로그아웃 — 토큰을 먼저 풀고 local 로 끝낸다 (Q3 · Q16)');
  {
    const r = await runSignOut({ unregister: async () => true });
    const want = ['get:sqt.expoPushToken', 'unregister', 'clearNotifications', 'disableWebPush', 'signOutLocal'];
    check('★순서: 토큰 읽기 → unregister → 알림 비우기 → 웹 해제 → signOut', JSON.stringify(r.log) === JSON.stringify(want), JSON.stringify(r.log));
    check('unregister 에 캐시 토큰을 넘긴다', r.seenToken === TOKEN, `→ ${r.seenToken}`);
    check('unregister 에 AbortSignal 을 넘긴다', !!r.seenSignal && typeof r.seenSignal.aborted === 'boolean');
    check('성공하면 pending 을 남기지 않는다', !r.kv.m.has('sqt.pushReleasePending'));
    check('결과 released=true, pendingSaved=false', r.result?.released === true && r.result?.pendingSaved === false, JSON.stringify(r.result));
  }

  console.log('\n■ 오프라인 로그아웃 — pending 을 남긴다 (A1)');
  {
    const r = await runSignOut({ unregister: async () => false });
    const pend = r.kv.m.get('sqt.pushReleasePending');
    check('★unregister 실패 → pending = {token, userId}', pend != null && JSON.stringify(JSON.parse(pend)) === JSON.stringify({ token: TOKEN, userId: UID }), `→ ${pend}`);
    const iSave = r.log.indexOf('set:sqt.pushReleasePending');
    check('pending 저장은 unregister 뒤, 알림 비우기 앞', iSave > r.log.indexOf('unregister') && iSave < r.log.indexOf('clearNotifications'), JSON.stringify(r.log));
    check('그래도 signOut 까지 간다', r.log.at(-1) === 'signOutLocal' && r.threw === null);
    check('결과 released=false, pendingSaved=true', r.result?.released === false && r.result?.pendingSaved === true, JSON.stringify(r.result));
  }
  {
    const r = await runSignOut({ unregister: async () => { throw new TypeError('Network request failed'); } });
    check('unregister 가 던져도 pending 을 남기고 signOut 까지 간다', r.kv.m.has('sqt.pushReleasePending') && r.log.at(-1) === 'signOutLocal' && r.threw === null, JSON.stringify(r.log));
  }
  {
    const r = await runSignOut({ unregister: (signal) => new Promise((res) => signal.addEventListener('abort', () => res(false))), timeoutMs: 60 });
    check('응답이 없으면 제한 시간에 끊는다(60ms 지정)', r.ms < 1000 && r.log.at(-1) === 'signOutLocal', `${r.ms}ms`);
    check('끊을 때 signal 을 abort 한다', r.seenSignal?.aborted === true);
    check('끊기면 pending 을 남긴다', r.kv.m.has('sqt.pushReleasePending'));
  }
  {
    // abort 를 무시하는 요청도 제한 시간에 끝나야 한다.
    const r = await runSignOut({ unregister: () => new Promise(() => {}), timeoutMs: 60 });
    check('abort 를 무시해도 제한 시간에 끝난다', r.ms < 1000 && r.kv.m.has('sqt.pushReleasePending'), `${r.ms}ms`);
  }
  {
    const r = await runSignOut({ unregister: () => new Promise(() => {}), timeoutMs: null });
    check('★기본 제한은 4초다(3.9~6초 안에 끝남)', r.ms >= 3900 && r.ms < 6000 && r.log.at(-1) === 'signOutLocal', `${r.ms}ms`);
  }
  {
    const r = await runSignOut({ unregister: async () => false, token: null });
    check('캐시 토큰이 없으면 pending 을 남기지 않는다(풀 대상이 없다)', !r.kv.m.has('sqt.pushReleasePending'), JSON.stringify(r.log));
    check('토큰이 없어도 unregister(null) 은 부른다(지금 세션 행을 지운다)', r.log.includes('unregister') && r.seenToken === null, `→ ${r.seenToken}`);
  }
  {
    const r = await runSignOut({ unregister: async () => false, userId: '' });
    check('userId 가 없으면 pending 을 남기지 않는다', !r.kv.m.has('sqt.pushReleasePending'));
  }

  console.log('\n■ 중간 단계가 실패해도 로그아웃은 끝난다');
  for (const name of ['clearNotifications', 'disableWebPush']) {
    const r = await runSignOut({ unregister: async () => true, throwIn: name });
    check(`${name} 가 던져도 signOut 까지 간다`, r.log.at(-1) === 'signOutLocal' && r.threw === null, JSON.stringify(r.log));
  }
  {
    const r = await runSignOut({ unregister: async () => true, throwIn: 'signOutLocal' });
    check('signOut 이 던져도 호출부로 튀지 않는다', r.threw === null, String(r.threw));
  }
  {
    const log = [];
    const kv = { getItem: async () => { throw new Error('storage'); }, setItem: async () => {}, removeItem: async () => {} };
    let seen = 'x';
    await mod.signOutWithPushRelease({ kv, userId: UID, timeoutMs: 50, unregister: async (t) => { seen = t; log.push('unregister'); return true; },
      clearNotifications: async () => {}, disableWebPush: async () => {}, signOutLocal: async () => { log.push('signOutLocal'); } });
    check('저장소를 못 읽어도 unregister(null) 과 signOut 은 한다', seen === null && log.join() === 'unregister,signOutLocal', `${seen} ${log}`);
  }
}

console.log('\n■ 부팅 — pending 을 release_push_token 으로 먼저 푼다');
const ok2 = typeof mod?.releasePendingPush === 'function' && typeof mod?.rememberRegisteredToken === 'function';
if (ok2) {
  const pending = JSON.stringify({ token: TOKEN, userId: UID });
  {
    let called = false;
    const kv = memKV({});
    const st = await mod.releasePendingPush(kv, async () => { called = true; return true; });
    check('pending 이 없으면 release 를 부르지 않는다', st === 'none' && !called, `→ ${st}`);
  }
  {
    let got = null;
    const kv = memKV({ 'sqt.pushReleasePending': pending });
    const st = await mod.releasePendingPush(kv, async (p) => { got = p; return true; });
    check('★pending → release({token, userId}) 를 부른다', got?.token === TOKEN && got?.userId === UID, JSON.stringify(got));
    check('풀리면 pending 을 지운다', st === 'released' && !kv.m.has('sqt.pushReleasePending'), `→ ${st}`);
  }
  {
    const kv = memKV({ 'sqt.pushReleasePending': pending });
    const st = await mod.releasePendingPush(kv, async () => false);
    check('실패하면 pending 을 남긴다(다음에 다시)', st === 'kept' && kv.m.has('sqt.pushReleasePending'), `→ ${st}`);
  }
  {
    const kv = memKV({ 'sqt.pushReleasePending': pending });
    const st = await mod.releasePendingPush(kv, async () => { throw new Error('offline'); });
    check('release 가 던져도 pending 을 남긴다', st === 'kept' && kv.m.has('sqt.pushReleasePending'), `→ ${st}`);
  }
  {
    const kv = memKV({ 'sqt.pushReleasePending': pending });
    const t0 = Date.now();
    const st = await mod.releasePendingPush(kv, () => new Promise(() => {}), 60);
    check('release 응답이 없어도 제한 시간에 끝난다(등록을 막지 않는다)', st === 'kept' && Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  }
  for (const bad of ['{', '"x"', '{"token":""}', JSON.stringify({ token: TOKEN })]) {
    let called = false;
    const kv = memKV({ 'sqt.pushReleasePending': bad });
    const st = await mod.releasePendingPush(kv, async () => { called = true; return true; });
    check(`깨진 pending(${bad}) 은 부르지 않고 지운다`, st === 'none' && !called && !kv.m.has('sqt.pushReleasePending'), `→ ${st}`);
  }
  {
    const kv = memKV({ 'sqt.pushReleasePending': pending });
    await mod.rememberRegisteredToken(kv, 'ExponentPushToken[new]');
    check('★등록에 성공하면 토큰을 캐시하고 pending 을 지운다', kv.m.get('sqt.expoPushToken') === 'ExponentPushToken[new]' && !kv.m.has('sqt.pushReleasePending'));
  }
} else {
  check('releasePendingPush · rememberRegisteredToken 이 있다', false);
}

console.log('\n■ 연결 — 앱 코드가 위 순서를 쓴다(소스 대조)');
{
  const { readFileSync } = await import('node:fs');
  const src = (p) => { try { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); } catch { return ''; } };
  const body = (s, start, end) => { const i = s.indexOf(start); return i < 0 ? '' : s.slice(i, s.indexOf(end, i + start.length)); };
  const sess = src('src/lib/store/useSessionStore.ts');
  const signOutBody = body(sess, '  signOut: async () => {', '\n  switchTo:');
  const deleteBody = body(sess, '  deleteAccount: async () => {', '\n  leaveStore:');
  check('★signOut 이 signOutWithPushRelease 를 쓴다', signOutBody.includes('signOutWithPushRelease('));
  check("★signOut 은 scope:'local' (Q16)", /signOut\(\{\s*scope:\s*'local'\s*\}\)/.test(signOutBody) && !/auth\.signOut\(\)/.test(signOutBody));
  check("signOut 이 unregister_my_push 에 abortSignal 을 건다", /rpc\('unregister_my_push'[\s\S]*?\.abortSignal\(/.test(signOutBody));
  check("deleteAccount 는 성공 뒤 scope:'global'", /signOut\(\{\s*scope:\s*'global'\s*\}\)/.test(deleteBody));
  const np = src('src/lib/push/nativepush.ts');
  check('nativepush: 등록 성공 뒤 rememberRegisteredToken', np.includes('rememberRegisteredToken('));
  check('nativepush: 등록 전에 pending release 를 기다린다', /releasePendingPushToken\(\)[\s\S]*?save_push_device_token/.test(body(np, 'async function registerToken', '\n}\n')));
  check('nativepush: 알림센터 비우기·배지 0', np.includes('dismissAllNotificationsAsync') && np.includes('setBadgeCountAsync(0)'));
  const boot = src('src/lib/push/usePushBootstrap.ts');
  check('부팅: pending release 를 로그인 여부와 상관없이 1회 부른다', boot.includes('releasePendingPushToken()'));
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || !ok || !ok2 ? 1 : 0);
