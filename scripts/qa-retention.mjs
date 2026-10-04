#!/usr/bin/env node
// qa-retention.mjs — 퇴사자 기록 보존 · 0234 서버 가드 (로컬 도커 전용)
//
// 무엇을 못박나:
//   [1] Q2 — purge_expired_former_staff 가 더는 아무것도 지우지 않는다.
//       재입사한 직원의 former_staff.departed_at 이 6개월을 넘으면, 사장 화면을 열 때마다 불리는
//       purge 가 그 직원의 지금 출퇴근·시급·근무표까지 통째로 지웠다(0026:74-88). 옛 앱이 계속 부르므로
//       함수는 남기고 본문만 0 을 돌려준다. anon 은 실행조차 못 한다.
//   [2] Q4 — owner_today.working_now 가 자정을 넘긴 야간 근무자를 센다.
//       오늘 날짜 행만 보던 조건(0180) 때문에 어제 22:00 출근한 사람이 자정이 지나면 "근무 중"에서 빠졌다.
//       기준 = 퇴근이 없고 출근이 24시간 안. 24시간이 넘은 열린 기록(퇴근 깜빡)은 세지 않는다.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. 라이브에서 돌리면 고정 계정 규칙 위반이라 URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-retention.mjs   자가정리(계정·매장·OTP 시드).
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

const phones = ['0181', '0182'].map((p) => `${p}${s.slice(0, 7)}`);
const H = 3600000;
const kstDate = (ms) => new Date(ms + 9 * H).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();

const users = [];
let UNIT = null;
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), J = mk();
  const up = async (c, i, name, role, birth) => {
    const r = await c.auth.signUp({
      email: `qa_ret_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    users.push({ c, id: r.data.user?.id });
    return r.data.user?.id;
  };
  await up(O, 0, 'QA보존사장', 'owner', '1980-01-01');
  const jId = await up(J, 1, 'QA보존직원', 'junior', '2000-01-01');

  const { data: st, error: e1 } = await O.rpc('create_store', { p_store_name: 'QA보존카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  UNIT = row.unit_id;
  await O.rpc('switch_active_unit', { p_unit_id: UNIT });
  await J.rpc('join_by_invite', { p_code: row.invite_code });
  { const { error } = await O.rpc('approve_member', { p_uid: jId }); if (error) throw new Error('approve_member: ' + error.message); }
  await J.rpc('switch_active_unit', { p_unit_id: UNIT });
  const now = Date.now();
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 J · 지금(KST) ${kstDate(now)}`);

  // ═══════ 1. Q2 — purge 는 아무것도 지우지 않는다 ═══════
  console.log('\n[1] Q2 purge_expired_former_staff = 지우지 않음');
  {
    // J 는 지금 멤버(재입사자)다. 첫 퇴사 기록이 7개월 전으로 남아 있다.
    const att = [
      { id: `ret_a1_${s}`, unit_id: UNIT, staff_id: jId, date: kstDate(now - 240 * 24 * H), check_in: iso(now - 240 * 24 * H), check_out: iso(now - 240 * 24 * H + 4 * H), work_minutes: 240 },
      { id: `ret_a2_${s}`, unit_id: UNIT, staff_id: jId, date: kstDate(now - 3 * 24 * H), check_in: iso(now - 3 * 24 * H), check_out: iso(now - 3 * 24 * H + 4 * H), work_minutes: 240 },
    ];
    for (const [label, q] of [
      ['attendance', admin.from('attendance').insert(att)],
      ['wages', admin.from('wages').upsert({ unit_id: UNIT, staff_id: jId, hourly_wage: 11000 })],
      ['shift', admin.from('shift_templates').insert({ id: `ret_t1_${s}`, unit_id: UNIT, staff_id: jId, weekday: 1, shift_date: null, start_time: '09:00', end_time: '13:00' })],
      ['former_staff', admin.from('former_staff').upsert({ unit_id: UNIT, staff_id: jId, name: 'QA보존직원', phone_last4: '0000', departed_at: iso(now - 210 * 24 * H) })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }

    const r = await O.rpc('purge_expired_former_staff');
    check('1-1 purge 는 0 을 돌려준다', !r.error && r.data === 0, r.error?.message ?? `rpc=${r.data}`);
    const cnt = async (t, col = 'staff_id') => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('unit_id', UNIT).eq(col, jId)).count;
    check('1-2 ★재입사 직원의 출퇴근 A1·A2 가 그대로 있다', (await cnt('attendance')) === 2, `left=${await cnt('attendance')}`);
    check('1-3 ★시급이 그대로 있다', (await cnt('wages')) === 1, `left=${await cnt('wages')}`);
    check('1-4 ★근무표가 그대로 있다', (await cnt('shift_templates')) === 1, `left=${await cnt('shift_templates')}`);
    check('1-5 퇴사 스냅샷도 지우지 않는다', (await cnt('former_staff')) === 1, `left=${await cnt('former_staff')}`);

    const a = await mk().rpc('purge_expired_former_staff');
    check('1-6 anon 은 실행 권한이 없다(42501)', a.error?.code === '42501', `code=${a.error?.code ?? '-'} ${a.error?.message ?? ''}`);
    const j = await J.rpc('purge_expired_former_staff');
    check('1-7 직원은 여전히 거부(owner_only)', /owner_only/.test(j.error?.message ?? ''), j.error?.message ?? `rpc=${j.data}`);
  }

  // ═══════ 2. Q4 — 자정을 넘긴 야간 근무자 ═══════
  console.log('\n[2] Q4 owner_today.working_now = 퇴근 없고 출근이 24시간 안');
  {
    const night = now - 20 * H;   // 어제 날짜로 찍힌 출근, 아직 퇴근 전
    const stale = now - 30 * H;   // 퇴근을 깜빡한 오래된 기록 — 세면 안 된다
    const { error } = await admin.from('attendance').insert([
      { id: `ret_n1_${s}`, unit_id: UNIT, staff_id: jId, date: kstDate(now - 24 * H), check_in: iso(night), check_out: null, work_minutes: 0 },
      { id: `ret_n2_${s}`, unit_id: UNIT, staff_id: jId, date: kstDate(now - 48 * H), check_in: iso(stale), check_out: null, work_minutes: 0 },
    ]);
    if (error) throw new Error('night attendance 셋업: ' + error.message);
    const r = await O.rpc('owner_today');
    const mine = (r.data ?? []).find((x) => x.unit_id === UNIT);
    check('2-1 ★어제 날짜로 출근한 야간 근무자를 근무 중으로 센다', !r.error && Number(mine?.working_now) === 1,
      r.error?.message ?? `working_now=${mine?.working_now}`);
    const a = await mk().rpc('owner_today');
    check('2-2 anon 은 실행 권한이 없다(42501)', a.error?.code === '42501', `code=${a.error?.code ?? '-'} rows=${(a.data ?? []).length}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  if (UNIT) { try { await admin.from('units').delete().eq('id', UNIT); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
