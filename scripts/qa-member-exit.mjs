#!/usr/bin/env node
// qa-member-exit.mjs — 0237 구성원이 나갈 때 정리 (Q3 탈퇴 몫 · Q17 · Q20) · 로컬 도커 전용
//
// 무엇을 못박나:
//   [1] 직원 탈퇴(delete_my_account)
//       Q3  — 그 계정의 푸시 토큰·웹 구독·로그인 세션이 남지 않는다. 지금(0044)은 셋 다 그대로 남는다.
//       Q17 — 직원 멤버십이 지워져 사장 명부에서 빠진다. 지금은 unit_id 만 비우고 unit_members 를 남긴다.
//             비공개 방 멤버십도 지운다. 지우기 전에 former_staff 스냅샷(이름·끝4자리)을 남긴다.
//       옛 앱 — 탈퇴 뒤 부르는 signOut()(global 기본값)이 오류 없이 끝난다.
//   [2] 사장 탈퇴 분기는 그대로다(J5 서버 차단은 P7-1). 매장 소프트삭제 + 사장 멤버십 유지. 세션·토큰만 정리.
//   [3] Q20 — 내보낸 뒤(remove_staff) 다시 승인해도 예전 비공개 방 메시지가 보이지 않는다.
//   [4] Q20 — 스스로 나간 뒤(leave_store) 다시 승인해도 같다. 나갈 때 former_staff 스냅샷을 남긴다.
//   [5] 권한 — 세 함수 모두 anon 실행 불가(3역할 회수 후 authenticated 만).
//
// ★로컬 전용: 실행할 때마다 계정을 가입시키고 탈퇴시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-member-exit.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
/** 로컬 도커 psql 한 줄 결과. 오류는 문자열로 돌려준다. */
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};
const sessions = (uid) => psql(`select count(*) from auth.sessions where user_id = '${uid}'`);

const phones = ['0171', '0172', '0173', '0174', '0175'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const r = await c.auth.signUp({
    email: `qa_mex_${i}_${s}@example.com`, password: pw,
    options: { data: { name, role, phone: phones[i], birth_date: birth } },
  });
  if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
  users.push({ c, id: r.data.user?.id });
  return { c, id: r.data.user?.id };
};

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA나감사장', 'owner', '1980-01-01');
  const A = await signUp(1, 'QA내보냄직원', 'junior', '2000-01-01');
  const C = await signUp(2, 'QA나감직원', 'junior', '2000-02-02');
  const D = await signUp(3, 'QA탈퇴직원', 'junior', '2000-03-03');
  const X = await signUp(4, 'QA탈퇴사장', 'owner', '1981-01-01');

  const { data: st, error: e1 } = await O.c.rpc('create_store', { p_store_name: 'QA나감카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = row.unit_id; units.push(UNIT);
  const CODE = row.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  const joinApprove = async (U, label) => {
    const j = await U.c.rpc('join_by_invite', { p_code: CODE });
    if (j.error) throw new Error(`${label} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${label} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  };
  for (const [U, label] of [[A, 'A'], [C, 'C'], [D, 'D']]) await joinApprove(U, label);

  // 비공개 방 R(멤버 = 사장 · A · C · D) + 그 방의 메시지 1건.
  const ROOM = `wr_mex_${s}`;
  {
    const { error } = await admin.from('work_rooms').insert([{ id: ROOM, unit_id: UNIT, name: 'QA비밀방', is_default: false, created_by: O.id }]);
    if (error) throw new Error('방 시드: ' + error.message);
    const { error: e2 } = await admin.from('work_room_members').upsert(
      [O.id, A.id, C.id, D.id].map((u) => ({ room_id: ROOM, user_id: u })), { onConflict: 'room_id,user_id' });
    if (e2) throw new Error('방 멤버 시드: ' + e2.message);
    const { error: e3 } = await admin.from('work_feed').insert([{
      id: `wf_mex_${s}`, unit_id: UNIT, room_id: ROOM, feed_date: new Date().toISOString().slice(0, 10),
      data: { kind: 'msg', text: '비밀방 메시지', authorId: O.id }, created_at: new Date().toISOString(),
    }]);
    if (e3) throw new Error('메시지 시드: ' + e3.message);
  }
  const roomMember = async (uid) => (await admin.from('work_room_members').select('*', { count: 'exact', head: true }).eq('room_id', ROOM).eq('user_id', uid)).count;
  const seesRoom = async (U) => {
    const { data, error } = await U.c.from('work_feed').select('id').eq('room_id', ROOM);
    return error ? `오류 ${error.message}` : (data ?? []).length;
  };
  const roster = async () => {
    const { data } = await O.c.from('unit_members').select('user_id').eq('unit_id', UNIT);
    return (data ?? []).map((x) => x.user_id);
  };
  const former = async (uid) => (await admin.from('former_staff').select('name, phone_last4, departed_at').eq('unit_id', UNIT).eq('staff_id', uid).maybeSingle()).data;
  console.log(`셋업 — 매장 ${UNIT} · 비밀방 ${ROOM}(멤버=사장·A·C·D)`);
  check('0-1 셋업: 방 멤버 A 는 비밀방 메시지를 본다', (await seesRoom(A)) === 1, `rows=${await seesRoom(A)}`);

  // ═══════ 1. 직원 탈퇴 ═══════
  console.log('\n[1] 직원 탈퇴 = 토큰·구독·세션 삭제 + 멤버십·방 멤버십 정리 + 스냅샷');
  {
    const tok = `ExponentPushToken[qa_mex_d_${s}]`;
    const ep = `https://fcm.googleapis.com/fcm/send/qa_mex_d_${s}`;
    const r1 = await D.c.rpc('save_push_device_token', { p_token: tok, p_platform: 'ios', p_unit_id: UNIT });
    const r2 = await D.c.rpc('save_push_subscription', { p_endpoint: ep, p_p256dh: 'p', p_auth: 'a', p_unit_id: UNIT });
    if (r1.error || r2.error) throw new Error('토큰 셋업: ' + (r1.error?.message ?? r2.error?.message));
    check('1-0 셋업: 탈퇴 전 세션이 있다', Number(sessions(D.id)) >= 1, sessions(D.id));

    const del = await D.c.rpc('delete_my_account');
    check('1-1 delete_my_account 성공', !del.error, del.error?.message);
    const nTok = (await admin.from('push_device_tokens').select('*', { count: 'exact', head: true }).eq('user_id', D.id)).count;
    check('1-2 ★앱 푸시 토큰 행이 남지 않는다(Q3)', nTok === 0, `rows=${nTok}`);
    const nSub = (await admin.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('user_id', D.id)).count;
    check('1-3 ★웹 푸시 구독 행이 남지 않는다(Q3)', nSub === 0, `rows=${nSub}`);
    check('1-4 ★로그인 세션이 남지 않는다(auth.sessions)', sessions(D.id) === '0', `sessions=${sessions(D.id)}`);
    check('1-5 ★사장 명부(unit_members)에서 빠진다(Q17)', !(await roster()).includes(D.id), `roster=${(await roster()).length}`);
    check('1-6 ★비공개 방 멤버십이 남지 않는다', (await roomMember(D.id)) === 0, `rows=${await roomMember(D.id)}`);
    const f = await former(D.id);
    check('1-7 ★퇴사 스냅샷이 이름·끝4자리를 남긴다(번호를 지우기 전에 찍는다)',
      f?.name === 'QA탈퇴직원' && f?.phone_last4 === phones[3].slice(-4), JSON.stringify(f));
    const { data: p } = await admin.from('profiles').select('deleted_at, phone, unit_id, pending_unit_id').eq('id', D.id).maybeSingle();
    check('1-8 기존 소프트삭제(0044) 그대로: deleted_at·phone=null·unit_id=null',
      !!p?.deleted_at && p?.phone === null && p?.unit_id === null && p?.pending_unit_id === null, JSON.stringify(p));
    const so = await D.c.auth.signOut();
    check('1-9 옛 앱 경로: 탈퇴 뒤 signOut()(global) 이 오류 없이 끝난다', !so.error, so.error?.message);
  }

  // ═══════ 2. 사장 탈퇴 분기는 그대로 ═══════
  console.log('\n[2] 사장 탈퇴 = 매장 소프트삭제 그대로 + 세션·토큰 정리');
  {
    const { data: sx, error: ex } = await X.c.rpc('create_store', { p_store_name: 'QA탈퇴사장카페', p_industry: '카페·디저트', p_biz_no: null });
    const rx = Array.isArray(sx) ? sx[0] : sx;
    if (ex || !rx?.unit_id) throw new Error('X create_store: ' + (ex?.message ?? 'no row'));
    units.push(rx.unit_id);
    await X.c.rpc('save_push_device_token', { p_token: `ExponentPushToken[qa_mex_x_${s}]`, p_platform: 'android' });
    const del = await X.c.rpc('delete_my_account');
    check('2-1 사장 delete_my_account 성공', !del.error, del.error?.message);
    const { data: u } = await admin.from('units').select('deleted_at').eq('id', rx.unit_id).maybeSingle();
    check('2-2 소유 매장 소프트삭제(기존 동작)', !!u?.deleted_at, JSON.stringify(u));
    const { count: om } = await admin.from('unit_members').select('*', { count: 'exact', head: true }).eq('unit_id', rx.unit_id).eq('user_id', X.id).eq('role', 'owner');
    check('2-3 사장 멤버십은 건드리지 않는다(J5 는 P7-1)', om === 1, `owner rows=${om}`);
    const nTok = (await admin.from('push_device_tokens').select('*', { count: 'exact', head: true }).eq('user_id', X.id)).count;
    check('2-4 ★사장 토큰도 남지 않는다', nTok === 0, `rows=${nTok}`);
    check('2-5 ★사장 세션도 남지 않는다', sessions(X.id) === '0', `sessions=${sessions(X.id)}`);
  }

  // ═══════ 3. 내보낸 뒤 다시 승인 ═══════
  console.log('\n[3] remove_staff → 다시 승인 = 예전 비공개 방이 보이지 않는다(Q20)');
  {
    const r = await O.c.rpc('remove_staff', { p_staff_id: A.id });
    check('3-1 remove_staff 성공', !r.error, r.error?.message);
    check('3-2 ★내보내면 비공개 방 멤버십이 지워진다', (await roomMember(A.id)) === 0, `rows=${await roomMember(A.id)}`);
    check('3-3 퇴사 스냅샷(기존 0132 동작)', (await former(A.id))?.name === 'QA내보냄직원', JSON.stringify(await former(A.id)));
    await joinApprove(A, 'A 재합류');
    check('3-4 ★다시 승인된 A 는 예전 비공개 방 메시지를 못 본다', (await seesRoom(A)) === 0, `rows=${await seesRoom(A)}`);
  }

  // ═══════ 4. 스스로 나간 뒤 다시 승인 ═══════
  console.log('\n[4] leave_store → 다시 승인 = 예전 비공개 방이 보이지 않는다(Q20) + 스냅샷');
  {
    const r = await C.c.rpc('leave_store');
    check('4-1 leave_store 성공', !r.error, r.error?.message);
    check('4-2 ★나가면 비공개 방 멤버십이 지워진다', (await roomMember(C.id)) === 0, `rows=${await roomMember(C.id)}`);
    const f = await former(C.id);
    check('4-3 ★나갈 때도 퇴사 스냅샷을 남긴다', f?.name === 'QA나감직원' && f?.phone_last4 === phones[2].slice(-4), JSON.stringify(f));
    const { data: p } = await admin.from('profiles').select('unit_id, active_unit_id').eq('id', C.id).maybeSingle();
    check('4-4 포인터 재지정(기존 0093 동작): 남은 소속 없음 → null', p?.unit_id === null && p?.active_unit_id === null, JSON.stringify(p));
    check('4-5 명부에서 빠진다(기존 동작)', !(await roster()).includes(C.id));
    await joinApprove(C, 'C 재합류');
    check('4-6 ★다시 승인된 C 는 예전 비공개 방 메시지를 못 본다', (await seesRoom(C)) === 0, `rows=${await seesRoom(C)}`);
  }

  // ═══════ 5. 권한 ═══════
  console.log('\n[5] 권한 — anon 실행 불가');
  for (const fn of ['delete_my_account()', 'remove_staff(uuid)', 'leave_store()']) {
    const v = psql(`select has_function_privilege('anon', 'public.${fn}', 'execute')`);
    check(`5 ★anon 이 ${fn} 을 실행할 수 없다`, v === 'f', `has_function_privilege=${v}`);
  }
  for (const fn of ['delete_my_account()', 'remove_staff(uuid)', 'leave_store()']) {
    const v = psql(`select has_function_privilege('authenticated', 'public.${fn}', 'execute')`);
    check(`5 옛 앱 호환: authenticated 는 ${fn} 을 실행할 수 있다`, v === 't', `has_function_privilege=${v}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
