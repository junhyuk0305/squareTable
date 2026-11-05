#!/usr/bin/env node
// qa-role-read-boundary.mjs — 역할별 **읽기** 경계 실증(0122). 실 백엔드 대상·자가정리.
//
// 왜 따로 있나: qa-roles.mjs 는 0093 의 **쓰기** 매트릭스만 본다. 그래서 "같은 매장이면 다 읽힌다"는
// 0004~0019 시절 가정이 역할 축으로 안 쪼개진 채 남아 있었고(직원이 동료 시급·출퇴근 전량 조회 가능),
// 매니저는 반대로 방 목록만 보이고 그 방 메시지는 0건이었다. 세 경계를 여기서 고정한다.
//
//  ① wages      : 직원=본인 행만 / 매니저·사장=전량
//  ② attendance : 직원=본인 기록만 / 매니저·사장=전량
//  ③ 방 격리    : 비공개 방 — **비멤버는 매니저도 0건**(0126 으로 매니저 특권 제거) / 멤버면 목록·메시지 둘 다 보임
//  ④ 이해 확인  : knowhow_understanding(0353) — 직원=본인 행만(동료 행 0) / 매니저·사장=전량 / 좌석 잠긴 매니저=본인 행만
//                 (0111 의 ku_select 는 같은 매장 전원 읽기라 직원이 동료 통과 기록을 받았다 → 되돌리면 RED)
//
// 실행: node scripts/qa-role-read-boundary.mjs --local (로컬 도커 · 키는 supabase status 에서)
//       node scripts/qa-role-read-boundary.mjs --allow-remote (.env + .env.seed 필요). 전제 = 0122 + **0126** + 0353 push.
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { IS_LOCAL, localEnv, assertLocalUrl } from './qa-local-target.mjs';

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
  return env;
}
const env = loadEnv();
if (IS_LOCAL) Object.assign(env, localEnv());
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (IS_LOCAL) assertLocalUrl(URL);
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed 또는 --local)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const skipped = (n, why) => { skip++; console.log('  SKIP', n, why); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const qaPhones = ['0111', '0112', '0113', '0114'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);

const cleanup = [];
const entryId = `qa_rrb_entry_${s}`;
try {
  // ── 셋업: 사장 O · 매니저 M · 직원 J ─────────────────────────────────────
  const O = mk();
  const oId = await signUpSession(O, `qa_rrb_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0] });
  cleanup.push(O);
  const { data: c1 } = await O.rpc('create_store', { p_store_name: 'RRB 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id, code1 = c1?.[0]?.invite_code;

  const M = mk();
  const mId = await signUpSession(M, `qa_rrb_m_${s}@example.com`, { name: 'QA매니저', role: 'junior', phone: qaPhones[1] });
  cleanup.push(M);
  const J = mk();
  const jId = await signUpSession(J, `qa_rrb_j_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: qaPhones[2] });
  cleanup.push(J);
  // 직원 2 — ④ "동료 행 0건" 을 재기 위한 상대. ①②는 기존대로 J 한 명 기준이라 K 는 ①②의 행을 만들지 않는다.
  const K = mk();
  const kId = await signUpSession(K, `qa_rrb_k_${s}@example.com`, { name: 'QA직원2', role: 'junior', phone: qaPhones[3] });
  cleanup.push(K);
  await M.rpc('join_by_invite', { p_code: code1 });
  await J.rpc('join_by_invite', { p_code: code1 });
  await K.rpc('join_by_invite', { p_code: code1 });
  await O.rpc('approve_member', { p_uid: mId });
  await O.rpc('approve_member', { p_uid: jId });
  const { error: ke } = await O.rpc('approve_member', { p_uid: kId });
  const { error: pe } = await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  check('setup: 사장/매니저/직원 구성', !!S1 && !pe && !ke, `S1=${S1} ${pe?.message ?? ''} ${ke?.message ?? ''}`);

  // 시급 3인분 · 출퇴근 3인분(사장이 심는다 — 쓰기 권한은 qa-roles 담당).
  const { error: we } = await O.from('wages').upsert([
    { unit_id: S1, staff_id: oId, hourly_wage: 20000 },
    { unit_id: S1, staff_id: mId, hourly_wage: 15000 },
    { unit_id: S1, staff_id: jId, hourly_wage: 10030 },
  ]).select('staff_id');
  const day = new Date().toISOString().slice(0, 10);
  const { error: ae } = await O.from('attendance').upsert([
    { id: `att_o_${s}`, unit_id: S1, staff_id: oId, date: day, work_minutes: 60 },
    { id: `att_m_${s}`, unit_id: S1, staff_id: mId, date: day, work_minutes: 60 },
    { id: `att_j_${s}`, unit_id: S1, staff_id: jId, date: day, work_minutes: 60 },
  ]).select('id');
  // 2026-11-02 급여 기능을 앱에서 뺐다. 시급 셋업은 아래 ① 시급 읽기 경계(옛 앱이 계속 쓰는 표)용이라 DB 축소 때 함께 뺀다.
  check('setup: 출퇴근 3인분 심기', !ae, ae?.message ?? '');
  check('setup: 시급 3인분 심기(① 시급 읽기 경계용)', !we, we?.message ?? '');

  // ── ① 시급 읽기 경계 ─────────────────────────────────────────────────────
  const jW = await J.from('wages').select('staff_id, hourly_wage');
  const jWids = (jW.data ?? []).map((r) => r.staff_id);
  check('★직원: 시급은 본인 행만', jWids.length === 1 && jWids[0] === jId, `rows=${jWids.length}`);
  check('★직원: 동료 시급 조회 불가', !jWids.includes(mId) && !jWids.includes(oId), `ids=${jWids.length}`);

  const mW = await M.from('wages').select('staff_id');
  check('매니저: 시급 전량 열람(급여 업무)', (mW.data?.length ?? 0) === 3, `rows=${mW.data?.length}`);
  const oW = await O.from('wages').select('staff_id');
  check('회귀: 사장 시급 전량 열람', (oW.data?.length ?? 0) === 3, `rows=${oW.data?.length}`);

  // ── ② 출퇴근 읽기 경계 ───────────────────────────────────────────────────
  const jA = await J.from('attendance').select('staff_id');
  const jAids = (jA.data ?? []).map((r) => r.staff_id);
  check('★직원: 출퇴근은 본인 기록만', jAids.length === 1 && jAids[0] === jId, `rows=${jAids.length}`);
  const mA = await M.from('attendance').select('staff_id');
  check('매니저: 출퇴근 전량 열람', (mA.data?.length ?? 0) === 3, `rows=${mA.data?.length}`);
  const oA = await O.from('attendance').select('staff_id');
  check('회귀: 사장 출퇴근 전량 열람', (oA.data?.length ?? 0) === 3, `rows=${oA.data?.length}`);

  // ── ③ 방 격리: 비공개 방(둘 다 비멤버) ───────────────────────────────────
  const roomId = `room_${s}`;
  // ★created_by 를 반드시 싣는다. 2026-08-19(0147)에 can_see_room 에서 `or auth_is_owner()` 가
  //   **의도적으로 제거**됐다("사장도 멤버여야 본다"). 그래서 새 비공개 방은 멤버가 0명이라 아무도
  //   첫 멤버를 못 넣는 교착이 되는데, 0147 의 트리거 trg_wr_add_creator_member 가 **created_by 를
  //   보고** 작성자를 자동으로 멤버에 넣어 그 교착을 푼다. created_by 가 null 이면 트리거가 건너뛴다.
  //   ⚠️ 이 인자가 빠져 있어서 이 하니스는 0147 이후로 계속 RED 였다(셋업 1건 → 뒤 2건 연쇄 실패).
  //   앱(db.ts insertRoom)은 created_by 를 싣는다 — 하니스만 그 전 세계관에 남아 있었다.
  const { error: re } = await O.from('work_rooms').insert({
    id: roomId, unit_id: S1, name: 'QA 비공개방', is_default: false, created_by: oId,
  });
  const feedId = `wf_${s}`;
  const { error: fe } = await O.from('work_feed').insert({
    id: feedId, unit_id: S1, room_id: roomId, feed_date: day,
    data: { id: feedId, kind: 'message', text: 'QA 비공개 메시지', authorId: oId, authorName: 'QA사장', createdAt: new Date().toISOString() },
  });
  check('setup: 비공개 방 + 메시지', !re && !fe, re?.message ?? fe?.message ?? '');

  const jRooms = await J.from('work_rooms').select('id').eq('id', roomId);
  check('회귀: 직원은 비공개 방 목록에서 안 보임', (jRooms.data?.length ?? 0) === 0, `rows=${jRooms.data?.length}`);
  const jFeed = await J.from('work_feed').select('id').eq('id', feedId);
  check('★회귀: 직원은 비공개 방 메시지 0건', (jFeed.data?.length ?? 0) === 0, `rows=${jFeed.data?.length}`);

  // ★2026-08-11(0126): 매니저 특권이 **제거됐다.** 0122 는 매니저에게 전 방을 열어줬지만,
  //   그 결과 매니저가 자기가 안 들어간 방을 읽고 자기를 멤버로 넣고 전체방으로 승격까지 할 수 있었다(P5).
  //   확정 규칙 = 사장은 모든 방 / **매니저·직원은 기본방 + 본인이 멤버인 방만.** 정본은 0126.
  //   그래서 이 방(사장이 만들고 매니저는 비멤버)은 매니저에게도 0건이어야 한다.
  const mRooms = await M.from('work_rooms').select('id').eq('id', roomId);
  check('★매니저: 비멤버 비공개 방은 목록에서 안 보임(0126)', (mRooms.data?.length ?? 0) === 0, `rows=${mRooms.data?.length}`);
  const mFeed = await M.from('work_feed').select('id').eq('id', feedId);
  check('★매니저: 비멤버 비공개 방 메시지 0건(0126)', (mFeed.data?.length ?? 0) === 0, `rows=${mFeed.data?.length}`);

  // 반대 방향 — 좁히기만 검사하면 **과잉 수정**(매니저가 자기 방도 못 봄)을 놓친다.
  // 0122 가 고치려던 증상("목록은 보이는데 메시지 0건")이 멤버인 방에서 재발하지 않는지 함께 고정한다.
  await O.from('work_room_members').insert({ room_id: roomId, user_id: mId });
  const mRooms2 = await M.from('work_rooms').select('id').eq('id', roomId);
  check('매니저: 멤버로 넣으면 그 방이 보인다', (mRooms2.data?.length ?? 0) === 1, `rows=${mRooms2.data?.length}`);
  const mFeed2 = await M.from('work_feed').select('id').eq('id', feedId);
  check('★매니저: 멤버인 방은 메시지도 읽힌다(빈 방 회귀 방지)', (mFeed2.data?.length ?? 0) === 1, `rows=${mFeed2.data?.length}`);

  // ── ④ 이해 확인 기록 읽기 경계(0353 ku_select) ──────────────────────────
  // 노하우 1개(service role 로 심는다 — 사장 쓰기 경로는 다른 하니스 몫) 에 직원 J·K·매니저 M 의 통과 행 3개.
  // 직원은 본인 행만(동료 행 0) · 매니저·사장은 전량. 0111 정책(같은 매장 전원)으로 되돌리면 직원이 3행을 받아 RED.
  const { error: ee } = await admin.from('playbook_entries').insert({ id: entryId, unit_id: S1, category: 'QA', title: 'QA 이해 확인 노하우', status: 'published' });
  const { error: kue } = await admin.from('knowhow_understanding').insert([
    { unit_id: S1, entry_id: entryId, staff_id: jId, staff_name: 'QA직원' },
    { unit_id: S1, entry_id: entryId, staff_id: kId, staff_name: 'QA직원2' },
    { unit_id: S1, entry_id: entryId, staff_id: mId, staff_name: 'QA매니저' },
  ]);
  check('setup: 노하우 1개 + 이해 확인 3인분 심기', !ee && !kue, ee?.message ?? kue?.message ?? '');

  const jU = await J.from('knowhow_understanding').select('staff_id').eq('entry_id', entryId);
  const jUids = (jU.data ?? []).map((r) => r.staff_id);
  check('★직원: 이해 확인 기록은 본인 행만', jUids.length === 1 && jUids[0] === jId, `rows=${jUids.length}`);
  check('★직원: 동료 통과 기록 0건', !jUids.includes(kId) && !jUids.includes(mId), `ids=${jUids.length}`);
  const kU = await K.from('knowhow_understanding').select('staff_id').eq('entry_id', entryId);
  const kUids = (kU.data ?? []).map((r) => r.staff_id);
  check('★직원2: 이해 확인 기록은 본인 행만(대칭)', kUids.length === 1 && kUids[0] === kId, `rows=${kUids.length}`);
  const mU = await M.from('knowhow_understanding').select('staff_id').eq('entry_id', entryId);
  check('매니저: 이해 확인 기록 전량 열람(히트맵)', (mU.data?.length ?? 0) === 3, `rows=${mU.data?.length}`);
  const oU = await O.from('knowhow_understanding').select('staff_id').eq('entry_id', entryId);
  check('회귀: 사장 이해 확인 기록 전량 열람', (oU.data?.length ?? 0) === 3, `rows=${oU.data?.length}`);
  // 좌석 잠긴 매니저 = 본인 행만(auth_can_manage 0315 가 false). 잠금 판정(seat_locked_for 0264)은
  // billing_free_mode() 가 true 면 무조건 false 다. 로컬은 app_config 행이 없어 true(fail-open)이고,
  // 그 전역 설정을 하니스가 뒤집으면 같은 DB 를 쓰는 다른 하니스가 흔들린다 → 재현하지 않고 skip 으로 찍는다.
  const { data: freeMode } = await O.rpc('billing_free_mode');
  if (freeMode === false) {
    skipped('좌석 잠긴 매니저: 본인 행만', '무료 모드 off — 잠금 재현(직원 3명 초과 + 명단 밖)은 이 하니스에 아직 없다');
  } else {
    skipped('좌석 잠긴 매니저: 본인 행만', 'billing_free_mode()=true 라 seat_locked_for 가 항상 false(잠금 재현 불가)');
  }
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  try { await admin.from('playbook_entries').delete().eq('id', entryId); } catch { /* best-effort · 매장 삭제 cascade 가 2선 */ }
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}

console.log(`\nRESULT: pass ${pass} fail ${fail} skip ${skip}`);
process.exit(fail ? 1 : 0);
