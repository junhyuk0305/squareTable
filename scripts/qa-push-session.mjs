#!/usr/bin/env node
// qa-push-session.mjs — 0236 푸시 토큰을 로그인 세션에 묶는다 (Q3 · F-2 엣지) · 로컬 도커 전용
//
// 무엇을 못박나:
//   [1] Q3 — 토큰을 저장한 세션이 로그아웃하면 그 기기로 푸시가 가지 않는다.
//       지금은 엣지 deliver() 가 user_id 로만 토큰을 고른다(push/index.ts). 그래서 로그아웃한 폰에도 계속 간다.
//       0236 뒤에는 발송 대상을 push_device_targets / push_web_targets(service_role 전용) 가 정한다.
//   [2] 옛 행(session_id 없음) — 7일 유예 동안만, 그리고 토큰을 등록할 때 이미 있던 세션이 살아 있을 때만 보낸다.
//       폰 A 에서 전체 로그아웃 → 폰 B 에서 로그인해도 A 의 옛 행은 살아나지 않는다(보안 검토 M2 · 정책 H4).
//   [3] 탈퇴(profiles.deleted_at)면 0행.
//   [4] 권한 — 대상 RPC 는 anon·authenticated 거부. 토큰 표 직접 INSERT·UPDATE 회수(SELECT·DELETE 는 옛 앱용으로 유지).
//   [5] unregister_my_push 는 지금 세션 행만 지운다. release_push_token 은 토큰·uid 가 둘 다 맞을 때만 지운다.
//   [6] 웹 구독(push_subscriptions)도 같은 규칙.
//   [7] 엣지 — deliver() 가 두 RPC 로 대상을 읽고, RPC 가 실패하면 아무것도 보내지 않는다.
//       모든 sweep·직접 발송이 deliver() 를 지난다. F-2: join_owners·owner_only 는 사장만.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-push-session.mjs   자가정리(계정·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jwtClaims = async (c) => {
  const { data } = await c.auth.getSession();
  const t = data.session?.access_token ?? '';
  return JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString() || '{}');
};
/** 로컬 도커 psql. 여러 문장을 한 세션에서 차례로 돌린다(-c 여러 개). 오류는 문자열로 돌려준다. */
const psql = (...cmds) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', ...cmds.flatMap((c) => ['-c', c])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};

/** 대상 RPC 결과에서 토큰(또는 endpoint) 목록. RPC 가 없거나 실패하면 null. */
const deviceTargets = async (ids) => {
  const r = await admin.rpc('push_device_targets', { p_user_ids: ids });
  return r.error ? { err: r.error.message } : { rows: (r.data ?? []).map((x) => x.token) };
};
const webTargets = async (ids) => {
  const r = await admin.rpc('push_web_targets', { p_user_ids: ids });
  return r.error ? { err: r.error.message } : { rows: (r.data ?? []).map((x) => x.endpoint) };
};
const show = (t) => (t.err ? `rpc 오류: ${t.err}` : `rows=${JSON.stringify(t.rows)}`);

const phones = ['0191', '0192', '0193'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const signUp = async (i, name) => {
  const c = mk();
  const email = `qa_pss_${i}_${s}@example.com`;
  const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role: 'junior', phone: phones[i], birth_date: '2000-01-01' } } });
  if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
  users.push({ id: r.data.user?.id, email });
  return { c, id: r.data.user?.id, email };
};
const signIn = async (email) => {
  const c = mk();
  const r = await c.auth.signInWithPassword({ email, password: pw });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return c;
};

try {
  await seedVerifiedPhones(URL_, SRV, phones);

  // ═══════ 1. 토큰을 세션에 묶는다 ═══════
  console.log('\n[1] 저장한 세션이 로그아웃하면 그 기기로 보내지 않는다');
  const A = await signUp(0, 'QA세션A');
  const tA1 = `ExponentPushToken[qa_pss_a1_${s}]`;
  const tA2 = `ExponentPushToken[qa_pss_a2_${s}]`;
  const tA3 = `ExponentPushToken[qa_pss_a3_${s}]`;
  {
    const claims = await jwtClaims(A.c);
    check('1-0 로컬 JWT 에 session_id 클레임이 있다(설계 전제)', !!claims.session_id, JSON.stringify(Object.keys(claims)));
    const r = await A.c.rpc('save_push_device_token', { p_token: tA1, p_platform: 'ios', p_unit_id: null });
    check('1-1 옛 앱 경로 save_push_device_token(3인자) 그대로 성공', !r.error, r.error?.message);
    const { data: row, error: re } = await admin.from('push_device_tokens').select('*').eq('token', tA1).maybeSingle();
    check('1-2 ★저장한 행에 지금 JWT 의 session_id 가 남는다', !re && row?.session_id === claims.session_id,
      re?.message ?? `session_id=${row?.session_id} jwt=${claims.session_id}`);
    const before = await deviceTargets([A.id]);
    check('1-3 로그인 중에는 대상이다', !before.err && before.rows.includes(tA1), show(before));

    const so = await A.c.auth.signOut({ scope: 'local' });
    if (so.error) throw new Error('signOut local: ' + so.error.message);
    const { data: cur } = await admin.from('push_device_tokens').select('token').eq('user_id', A.id);
    console.log(`  INFO 지금 엣지 선택식(user_id select)은 로그아웃 뒤에도 ${(cur ?? []).length}행을 고른다`);
    const after = await deviceTargets([A.id]);
    check('1-4 ★그 세션을 로그아웃하면 대상이 아니다', !after.err && !after.rows.includes(tA1), show(after));

    // 같은 사용자의 다른 기기 2대
    const A2 = await signIn(A.email);
    const A3 = await signIn(A.email);
    await A2.rpc('save_push_device_token', { p_token: tA2, p_platform: 'android' });
    await A3.rpc('save_push_device_token', { p_token: tA3, p_platform: 'ios' });
    const both = await deviceTargets([A.id]);
    check('1-5 살아 있는 두 기기는 둘 다 대상', !both.err && both.rows.includes(tA2) && both.rows.includes(tA3) && !both.rows.includes(tA1), show(both));

    // ═══════ 5. unregister_my_push / release_push_token ═══════
    console.log('\n[5] 해제 RPC');
    const u = await A2.rpc('unregister_my_push', {});
    check('5-1 unregister_my_push() 가 지금 세션 행 1개를 지운다', !u.error && u.data === 1, u.error?.message ?? `n=${u.data}`);
    const { data: left } = await admin.from('push_device_tokens').select('token').eq('user_id', A.id);
    const lt = (left ?? []).map((x) => x.token);
    check('5-2 같은 사용자 다른 기기(tA3) 행은 남는다', !lt.includes(tA2) && lt.includes(tA3), JSON.stringify(lt));
    const u2 = await A2.rpc('unregister_my_push', { p_token: tA3 });
    check('5-3 토큰을 주면 그 토큰 행을 지운다(세션이 달라도 본인 행)', !u2.error && u2.data === 1, u2.error?.message ?? `n=${u2.data}`);
    await A3.rpc('save_push_device_token', { p_token: tA3, p_platform: 'ios' });
    const anonU = await mk().rpc('unregister_my_push', {});
    check('5-4 anon 은 unregister_my_push 실행 불가(42501)', anonU.error?.code === '42501', `code=${anonU.error?.code ?? '-'} ${anonU.error?.message ?? ''}`);
    const rel0 = await mk().rpc('release_push_token', { p_token: tA3, p_user: randomUUID() });
    check('5-5 release_push_token: uid 가 틀리면 0행', !rel0.error && rel0.data === 0, rel0.error?.message ?? `n=${rel0.data}`);
    const rel1 = await mk().rpc('release_push_token', { p_token: tA3, p_user: A.id });
    check('5-6 release_push_token(anon): 토큰·uid 가 맞으면 1행', !rel1.error && rel1.data === 1, rel1.error?.message ?? `n=${rel1.data}`);

    // ═══════ 4. 권한 ═══════
    console.log('\n[4] 권한');
    const an = await mk().rpc('push_device_targets', { p_user_ids: [A.id] });
    check('4-1 anon 은 push_device_targets 거부(42501)', an.error?.code === '42501', `code=${an.error?.code ?? '-'} ${an.error?.message ?? ''}`);
    const au = await A2.rpc('push_device_targets', { p_user_ids: [A.id] });
    check('4-2 authenticated 도 push_device_targets 거부(42501)', au.error?.code === '42501', `code=${au.error?.code ?? '-'} ${au.error?.message ?? ''}`);
    const aw = await A2.rpc('push_web_targets', { p_user_ids: [A.id] });
    check('4-3 authenticated 도 push_web_targets 거부(42501)', aw.error?.code === '42501', `code=${aw.error?.code ?? '-'} ${aw.error?.message ?? ''}`);
    const ins = await A2.from('push_device_tokens').insert({ user_id: A.id, token: `x_${s}`, platform: 'ios' });
    check('4-4 토큰 표 직접 INSERT 거부(42501)', ins.error?.code === '42501', `code=${ins.error?.code ?? '-'} ${ins.error?.message ?? ''}`);
    await A2.rpc('save_push_device_token', { p_token: tA2, p_platform: 'android' });
    const upd = await A2.from('push_device_tokens').update({ session_id: null }).eq('token', tA2).select();
    check('4-5 토큰 표 직접 UPDATE 거부(42501)', upd.error?.code === '42501', `code=${upd.error?.code ?? '-'} rows=${(upd.data ?? []).length}`);
    const sel = await A2.from('push_device_tokens').select('token').eq('token', tA2);
    check('4-6 본인 행 SELECT 는 그대로(옛 앱)', !sel.error && (sel.data ?? []).length === 1, sel.error?.message ?? `rows=${(sel.data ?? []).length}`);
    const del = await A2.from('push_device_tokens').delete().eq('token', tA2).select();
    check('4-7 본인 행 DELETE 는 그대로(옛 앱)', !del.error && (del.data ?? []).length === 1, del.error?.message ?? `rows=${(del.data ?? []).length}`);
  }

  // ═══════ 2. 옛 행(session_id 없음) ═══════
  console.log('\n[2] 옛 행 — 유예 7일 + 등록 전에 있던 세션이 살아 있을 때만');
  const B = await signUp(1, 'QA세션B');
  const tBA = `ExponentPushToken[qa_pss_ba_${s}]`;
  {
    // 옛 앱이 폰 A 에서 로그인한 뒤 등록한 행. 등록 시각 = 로그인(iat) + 2초(GoTrue 시계 기준).
    const iat = (await jwtClaims(B.c)).iat;
    const legacyAt = new Date((iat + 2) * 1000).toISOString();
    const { error: le } = await admin.from('push_device_tokens')
      .insert({ user_id: B.id, token: tBA, platform: 'android', updated_at: legacyAt, created_at: legacyAt });
    if (le) throw new Error('옛 행 셋업: ' + le.message);
    const live = await deviceTargets([B.id]);
    check('2-1 유예 중 + 등록 전 세션이 살아 있으면 옛 행도 대상', !live.err && live.rows.includes(tBA), show(live));
    const after = psql('begin',
      "create or replace function public.push_legacy_grace_until() returns timestamptz language sql immutable as $f$ select now() - interval '1 minute' $f$",
      `select count(*) from public.push_device_targets(array['${B.id}']::uuid[])`, 'rollback');
    check('2-2 유예가 끝나면 옛 행은 대상이 아니다(트랜잭션 안에서 유예 끝을 과거로)', after === '0', after.replace(/\n/g, ' | '));

    const so = await B.c.auth.signOut({ scope: 'global' });
    if (so.error) throw new Error('signOut global: ' + so.error.message);
    await sleep(3500); // 폰 B 로그인 세션이 옛 행 등록 시각보다 확실히 뒤에 생기게
    const BB = await signIn(B.email);
    const { data: cur } = await admin.from('push_device_tokens').select('token').eq('user_id', B.id);
    console.log(`  INFO 지금 선택식은 폰 A 전체 로그아웃 + 폰 B 로그인 뒤에도 옛 행 ${(cur ?? []).length}행을 고른다`);
    const t = await deviceTargets([B.id]);
    check('2-3 ★폰 A 전체 로그아웃 + 폰 B 로그인 → A 의 옛 행은 대상이 아니다', !t.err && !t.rows.includes(tBA), show(t));
    void BB;
  }

  // ═══════ 3. 탈퇴 ═══════
  console.log('\n[3] 탈퇴(profiles.deleted_at)면 0행');
  const C = await signUp(2, 'QA세션C');
  const tC = `ExponentPushToken[qa_pss_c_${s}]`;
  const epC = `https://push.example.com/qa_pss_c_${s}`;
  {
    await C.c.rpc('save_push_device_token', { p_token: tC, p_platform: 'ios' });
    const ws = await C.c.rpc('save_push_subscription', { p_endpoint: epC, p_p256dh: 'p', p_auth: 'a', p_unit_id: null, p_ua: `qa-ua-${s}` });
    check('6-1 옛 웹 경로 save_push_subscription(5인자) 그대로 성공', !ws.error, ws.error?.message);
    const claims = await jwtClaims(C.c);
    const { data: wrow } = await admin.from('push_subscriptions').select('session_id').eq('endpoint', epC).maybeSingle();
    check('6-2 ★웹 구독에도 session_id 가 남는다', wrow?.session_id === claims.session_id, `session_id=${wrow?.session_id}`);
    const w1 = await webTargets([C.id]);
    check('6-3 로그인 중 웹 구독은 대상', !w1.err && w1.rows.includes(epC), show(w1));
    const d1 = await deviceTargets([C.id]);
    check('3-1 탈퇴 전에는 대상', !d1.err && d1.rows.includes(tC), show(d1));
    await admin.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', C.id);
    const d2 = await deviceTargets([C.id]);
    check('3-2 ★탈퇴 표시면 기기 대상 0행', !d2.err && d2.rows.length === 0, show(d2));
    const w2 = await webTargets([C.id]);
    check('3-3 ★탈퇴 표시면 웹 대상 0행', !w2.err && w2.rows.length === 0, show(w2));
    await admin.from('profiles').update({ deleted_at: null }).eq('id', C.id);
    await C.c.auth.signOut({ scope: 'local' });
    const w3 = await webTargets([C.id]);
    check('6-4 ★웹 구독도 그 세션 로그아웃 뒤 대상이 아니다', !w3.err && !w3.rows.includes(epC), show(w3));
  }

  // ═══════ 8. 마이그레이션 자가점검 ═══════
  console.log('\n[8] DB 자가점검');
  {
    const out = psql(`select has_table_privilege(pg_get_userbyid(p.proowner), 'auth.sessions', 'SELECT') from pg_proc p where p.oid = 'public.push_device_targets(uuid[])'::regprocedure`);
    check('8-1 대상 함수 소유자가 auth.sessions 를 읽을 수 있다', out === 't', out);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
}

// ═══════ 7. 엣지 push/index.ts — 순수 검사(백엔드 없음) ═══════
console.log('\n[7] 엣지 deliver() · 발송 경로 · F-2');
{
  const edgeSrc = readFileSync(join(ROOT, 'supabase/functions/push/index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const extract = (name) => {
    const start = edgeSrc.search(new RegExp(`(async )?function ${name}\\(`));
    if (start < 0) return null;
    const end = edgeSrc.indexOf('\n}\n', start);
    return ts.transpileModule(edgeSrc.slice(start, end + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  };
  const chain = (data) => {
    const o = { select: () => o, in: () => o, eq: () => o, delete: () => o, then: (res) => res({ data, error: null }) };
    return o;
  };
  const makeDeliver = (rpcResult) => {
    const calls = { web: 0, expo: 0, rpc: [] };
    const adminFake = {
      from: (t) => chain(t === 'push_device_tokens' ? [{ id: 'd1', token: 'ExponentPushToken[x]' }]
        : t === 'push_subscriptions' ? [{ id: 'w1', endpoint: 'https://e', p256dh: 'p', auth: 'a' }] : []),
      rpc: async (name) => { calls.rpc.push(name); return rpcResult(name); },
    };
    const webpushFake = { sendNotification: async () => { calls.web += 1; } };
    const fetchFake = async (_u, init) => {
      calls.expo += JSON.parse(init.body).length;
      return { ok: true, json: async () => ({ data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }) };
    };
    const src = ['deliver', 'deliverExpoPush', 'inQuietWindow', 'kstNowHHMM'].map(extract);
    if (src.some((x) => !x)) return null;
    const fn = new Function('webpush', 'fetch', 'EXPO_PUSH_URL', 'EXPO_PUSH_CHUNK', `${src.join('\n')}; return deliver;`)(
      webpushFake, fetchFake, 'https://exp', 100);
    return { run: (targets) => fn(adminFake, 'u1', targets, { title: 't', body: 'b', url: '/' }), calls };
  };

  const errCase = makeDeliver(() => ({ data: null, error: { message: 'boom' } }));
  const r1 = errCase ? await errCase.run(['u1']) : null;
  check('7-1 ★대상 RPC 가 실패하면 웹·앱 어느 쪽으로도 보내지 않는다',
    !!r1 && r1.sent === 0 && errCase.calls.web === 0 && errCase.calls.expo === 0,
    r1 ? `sent=${r1.sent} web=${errCase.calls.web} expo=${errCase.calls.expo} rpc=${errCase.calls.rpc}` : 'deliver 추출 실패');

  const okCase = makeDeliver((name) => ({
    data: name === 'push_device_targets' ? [{ id: 'd9', token: 'ExponentPushToken[ok]', user_id: 'u1' }]
      : name === 'push_web_targets' ? [] : null,
    error: null,
  }));
  const r2 = okCase ? await okCase.run(['u1']) : null;
  check('7-2 deliver() 는 push_web_targets·push_device_targets 두 RPC 로 대상을 읽는다',
    !!r2 && okCase.calls.rpc.includes('push_device_targets') && okCase.calls.rpc.includes('push_web_targets')
      && okCase.calls.web === 0 && okCase.calls.expo === 1,
    r2 ? `rpc=${okCase.calls.rpc} web=${okCase.calls.web} expo=${okCase.calls.expo}` : 'deliver 추출 실패');

  check('7-3 엣지에 토큰·구독 표를 직접 select 하는 곳이 없다',
    !/from\('push_(device_tokens|subscriptions)'\)\s*\.select/.test(edgeSrc));
  const deliverBody = extract('deliver') ?? '';
  const outside = edgeSrc.replace(edgeSrc.slice(edgeSrc.indexOf('async function deliver('), edgeSrc.indexOf('\n}\n', edgeSrc.indexOf('async function deliver(')) + 2), '');
  check('7-4 발송(webpush.sendNotification·deliverExpoPush 호출)은 deliver() 안에만 있다',
    /sendNotification/.test(deliverBody) && !/webpush\.sendNotification/.test(outside) && !/await deliverExpoPush\(/.test(outside));
  const deliverCalls = (edgeSrc.match(/await deliver\(/g) ?? []).length;
  check('7-5 sweep 4개 + 직접 발송 1개 = deliver() 호출 5곳', deliverCalls === 5, `calls=${deliverCalls}`);

  const rolesSrc = extract('audienceRoles');
  const roles = rolesSrc ? new Function(`${rolesSrc}; return audienceRoles;`)() : null;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('7-6 F-2 join_owners 는 사장만(매니저 제외)', !!roles && eq(roles('join_owners'), ['owner']), roles ? JSON.stringify(roles('join_owners')) : 'audienceRoles 없음');
  check('7-7 F-2 새 audience owner_only = 사장만', !!roles && eq(roles('owner_only'), ['owner']), roles ? JSON.stringify(roles('owner_only')) : 'audienceRoles 없음');
  check('7-8 owners 는 사장+매니저, staff 는 직원 그대로', !!roles && eq(roles('owners'), ['owner', 'manager']) && eq(roles('staff'), ['junior']));
  check('7-9 모르는 audience 는 null(직원에게 새지 않음)', !!roles && roles('nope') === null && roles(undefined) === null);
  const notifySrc = readFileSync(join(ROOT, 'src/lib/push/notify.ts'), 'utf8');
  const sug = notifySrc.slice(notifySrc.indexOf('export const notifyOwnersSuggestion'));
  check('7-10 F-2 notifyOwnersSuggestion 은 owner_only 를 쓴다', /audience: 'owner_only'/.test(sug.slice(0, sug.indexOf('});'))));
}

for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
