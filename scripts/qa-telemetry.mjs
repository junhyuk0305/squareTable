#!/usr/bin/env node
// qa-telemetry.mjs — 앱 행동 계측 쓰기 경로(log_app_events) 실증. 실세션·자가정리.
//
// 무엇을 보나(메가프롬프트_앱행동계측_2026-10-24 §3 2단계):
//   ① user_id 는 서버가 auth.uid() 로 찍는다(남의 uid 를 넣어도 자기 uid)
//   ② unit_id 는 실제 소속 매장일 때만 남는다(남의 매장 → null · 자기 매장 → 그대로 = 대조군)
//   ③ 로그인 전 호출은 user_id·unit_id 모두 null
//   ④ 51건 묶음·빈 묶음·잘못된 이름·2KB 초과 props·200자 초과 route 는 거부. 오류 문구에 칸 이름이 없다
//   ⑤ 클라 시각 at 은 24시간 전~5분 뒤만 받는다(벗어나면 now)
//   ⑥ platform·app_version·session_id 가 저장된다
//   ⑦ 옛 앱 방식 app_events 직접 insert 가 여전히 된다(AGENTS.md ⑪)
//
// 사용: node scripts/qa-telemetry.mjs --local   (로컬 도커)
//       node scripts/qa-telemetry.mjs --allow-remote   (main 체크아웃에서 라이브 재확인)
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { IS_LOCAL, localEnv } from './qa-local-target.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return IS_LOCAL ? { ...env, ...localEnv() } : env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed: ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// 하니스가 남긴 행은 session_id 로 찾고 지운다(이 실행만의 값).
const SID = `qa_tel_${s}`;
const ev = (event, extra = {}) => ({ event, props: { k: 1 }, route: '/owner/home', platform: 'web', app_version: '9.9.9', session_id: SID, ...extra });
const rowsOf = async (event) => {
  const { data } = await svc.from('app_events').select('user_id, unit_id, role, event, props, route, platform, app_version, session_id, created_at').eq('session_id', SID).eq('event', event);
  return data ?? [];
};
// 거부 판정: 사람이 읽는 코드만 나가고 칸·표 이름·SQLSTATE 문구가 섞이지 않는다(AGENTS.md ⑨).
const cleanReject = (r) => !!r.error && /invalid_argument/.test(r.error.message ?? '') && !/app_events|user_id|unit_id|props|route|column|violates/i.test(r.error.message ?? '');

const qaPhones = ['0161', '0162'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);
const cleanup = [];
try {
  const A = mk(); const aId = await signUpSession(A, `qa_tel_a_${s}@example.com`, { name: '계측A사장', role: 'owner', phone: qaPhones[0] }); cleanup.push(A);
  const ca = await A.rpc('create_store', { p_store_name: '계측 A점', p_industry: '카페·디저트', p_biz_no: null });
  const UA = ca.data?.[0]?.unit_id;
  const B = mk(); const bId = await signUpSession(B, `qa_tel_b_${s}@example.com`, { name: '계측B사장', role: 'owner', phone: qaPhones[1] }); cleanup.push(B);
  const cb = await B.rpc('create_store', { p_store_name: '계측 B점', p_industry: '카페·디저트', p_biz_no: null });
  const UB = cb.data?.[0]?.unit_id;
  if (!UA || !UB) throw new Error(`setup: 매장 생성 실패 ${ca.error?.message ?? ''} ${cb.error?.message ?? ''}`);

  // ①② + ⑥ — 남의 uid·남의 매장을 실어 보낸다. 자기 매장 이벤트는 대조군.
  const r1 = await A.rpc('log_app_events', { p_events: [
    ev('qa_tel_own', { uid: aId, user_id: bId, unit_id: UA, role: 'junior' }),
    ev('qa_tel_foreign', { uid: aId, unit_id: UB }),
    ev('qa_tel_other_uid', { uid: bId, unit_id: UB }),
    ev('qa_tel_no_uid', { unit_id: UA }),
  ] });
  check('setup: 로그인 호출 성공', !r1.error, r1.error?.message ?? '');
  const own = await rowsOf('qa_tel_own');
  const foreign = await rowsOf('qa_tel_foreign');
  check('① user_id 칸에 남의 uid 를 넣어도 저장값은 자기 uid', own.length === 1 && own[0].user_id === aId && foreign[0]?.user_id === aId, JSON.stringify(own[0]?.user_id));
  // 쌓을 때의 사용자(uid)가 지금 토큰과 다르면 누구의 것으로도 찍지 않는다(로그아웃 → 다른 사람 로그인).
  const other = await rowsOf('qa_tel_other_uid');
  check('① 다른 사람이 쌓은 기록 → user_id·unit_id null(B 로도 A 로도 안 찍힘)', other.length === 1 && other[0].user_id === null && other[0].unit_id === null, JSON.stringify(other[0]));
  const noUid = await rowsOf('qa_tel_no_uid');
  check('① 로그인 전에 쌓아 로그인 뒤 보낸 기록 → user_id·unit_id null', noUid.length === 1 && noUid[0].user_id === null && noUid[0].unit_id === null, JSON.stringify(noUid[0]));
  check('② 대조군: 자기 매장 unit_id 는 그대로', own[0]?.unit_id === UA, String(own[0]?.unit_id));
  check('② 역할은 클라 값이 아니라 소속 행에서', own[0]?.role === 'owner', String(own[0]?.role));
  check('② 소속 아닌 unit_id 는 null', foreign.length === 1 && foreign[0].unit_id === null && foreign[0].role === null, JSON.stringify(foreign[0]));
  check('⑥ platform·app_version·session_id·route·props 저장', own[0]?.platform === 'web' && own[0]?.app_version === '9.9.9' && own[0]?.session_id === SID && own[0]?.route === '/owner/home' && own[0]?.props?.k === 1, JSON.stringify(own[0]));

  // ③ 로그인 전
  const anon = mk();
  const r3 = await anon.rpc('log_app_events', { p_events: [ev('qa_tel_anon', { user_id: aId, unit_id: UA })] });
  const an = await rowsOf('qa_tel_anon');
  check('③ 로그인 전: user_id·unit_id 모두 null', !r3.error && an.length === 1 && an[0].user_id === null && an[0].unit_id === null, r3.error?.message ?? JSON.stringify(an[0]));

  // ④ 거부
  const many = Array.from({ length: 51 }, () => ev('qa_tel_many'));
  const r51 = await A.rpc('log_app_events', { p_events: many });
  check('④ 51건 묶음 거부', cleanReject(r51), r51.error?.message ?? 'no error');
  check('④ 51건 묶음은 한 줄도 안 남음', (await rowsOf('qa_tel_many')).length === 0);
  const r50 = await A.rpc('log_app_events', { p_events: Array.from({ length: 50 }, () => ev('qa_tel_fifty')) });
  check('④ 대조군: 50건 묶음은 저장', !r50.error && (await rowsOf('qa_tel_fifty')).length === 50, r50.error?.message ?? '');
  const r0 = await A.rpc('log_app_events', { p_events: [] });
  check('④ 빈 묶음 거부', cleanReject(r0), r0.error?.message ?? 'no error');
  const rObj = await A.rpc('log_app_events', { p_events: { event: 'x' } });
  check('④ 배열이 아니면 거부', cleanReject(rObj), rObj.error?.message ?? 'no error');
  for (const bad of ['Bad_Name', '1abc', 'a', 'has space', 'x'.repeat(49), "drop'--"]) {
    const r = await A.rpc('log_app_events', { p_events: [ev(bad)] });
    check(`④ 잘못된 이름 거부: ${bad.slice(0, 12)}`, cleanReject(r), r.error?.message ?? 'no error');
  }
  const big = await A.rpc('log_app_events', { p_events: [ev('qa_tel_big', { props: { t: 'x'.repeat(2100) } })] });
  check('④ 2KB 초과 props 거부', cleanReject(big), big.error?.message ?? 'no error');
  const longRoute = await A.rpc('log_app_events', { p_events: [ev('qa_tel_route', { route: '/' + 'a'.repeat(200) })] });
  check('④ 200자 초과 route 거부', cleanReject(longRoute), longRoute.error?.message ?? 'no error');
  const mixed = await A.rpc('log_app_events', { p_events: [ev('qa_tel_mixed'), ev('BAD')] });
  check('④ 한 건이라도 잘못되면 묶음 전체 거부(부분 저장 없음)', cleanReject(mixed) && (await rowsOf('qa_tel_mixed')).length === 0, mixed.error?.message ?? 'no error');

  // ⑤ 시각
  const now = Date.now();
  const hourAgo = new Date(now - 3600e3).toISOString();
  const r5 = await A.rpc('log_app_events', { p_events: [
    ev('qa_tel_at_ok', { at: hourAgo }),
    ev('qa_tel_at_old', { at: new Date(now - 2 * 864e5).toISOString() }),
    ev('qa_tel_at_future', { at: new Date(now + 3600e3).toISOString() }),
    ev('qa_tel_at_junk', { at: 'not-a-date' }),
  ] });
  const near = (t, target) => Math.abs(new Date(t).getTime() - target) < 120e3;
  const okAt = (await rowsOf('qa_tel_at_ok'))[0];
  check('⑤ 1시간 전 시각은 그대로', !r5.error && okAt && near(okAt.created_at, now - 3600e3), r5.error?.message ?? okAt?.created_at);
  for (const k of ['old', 'future', 'junk']) {
    const row = (await rowsOf(`qa_tel_at_${k}`))[0];
    check(`⑤ 범위 밖 시각(${k}) → now`, row && near(row.created_at, now), row?.created_at ?? 'no row');
  }

  // ⑧ 같은 id 는 한 번만(응답 유실 재전송·탭 닫힘 keepalive 재전송)
  const dupId = crypto.randomUUID();
  const d1 = await A.rpc('log_app_events', { p_events: [ev('qa_tel_dup', { id: dupId, uid: aId })] });
  const d2 = await A.rpc('log_app_events', { p_events: [ev('qa_tel_dup', { id: dupId, uid: aId }), ev('qa_tel_dup', { id: dupId, uid: aId })] });
  const dupRows = await rowsOf('qa_tel_dup');
  check('⑧ 같은 id 세 번 → 1행 · 반환값은 새로 들어간 수(1 → 0)', !d1.error && !d2.error && d1.data === 1 && d2.data === 0 && dupRows.length === 1,
    `${d1.error?.message ?? d1.data} ${d2.error?.message ?? d2.data} rows=${dupRows.length}`);
  const badId = await A.rpc('log_app_events', { p_events: [ev('qa_tel_badid', { id: 'not-a-uuid' })] });
  check('⑧ uuid 가 아닌 id → 서버가 새 id 로 저장', !badId.error && (await rowsOf('qa_tel_badid')).length === 1, badId.error?.message ?? '');

  // ⑦ 옛 앱 직접 insert
  const old = await A.from('app_events').insert({ unit_id: UA, user_id: aId, role: 'owner', event: 'qa_tel_old_insert', props: { session_id: SID }, route: null });
  const { count: oldN } = await svc.from('app_events').select('*', { count: 'exact', head: true }).eq('event', 'qa_tel_old_insert').eq('user_id', aId);
  check('⑦ 옛 방식 직접 insert 가 여전히 된다', !old.error && oldN === 1, old.error?.message ?? `n=${oldN}`);
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  await svc.from('app_events').delete().eq('session_id', SID);
  await svc.from('app_events').delete().eq('event', 'qa_tel_old_insert');
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
