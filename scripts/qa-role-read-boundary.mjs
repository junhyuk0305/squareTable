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
//
// 실행: node scripts/qa-role-read-boundary.mjs (.env + .env.seed 필요). 전제 = 0122 + **0126** push.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const qaPhones = ['0111', '0112', '0113'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);

const cleanup = [];
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
  await M.rpc('join_by_invite', { p_code: code1 });
  await J.rpc('join_by_invite', { p_code: code1 });
  await O.rpc('approve_member', { p_uid: mId });
  await O.rpc('approve_member', { p_uid: jId });
  const { error: pe } = await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  check('setup: 사장/매니저/직원 구성', !!S1 && !pe, `S1=${S1} ${pe?.message ?? ''}`);

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
  check('setup: 시급·출퇴근 3인분 심기', !we && !ae, we?.message ?? ae?.message ?? '');

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
  const { error: re } = await O.from('work_rooms').insert({ id: roomId, unit_id: S1, name: 'QA 비공개방', is_default: false });
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
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
