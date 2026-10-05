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
//   [3]~[7] 0246 재직 기간 — 나갈 때는 숨기지 않고(그 달 출퇴근·근무표·시급이 사장에게 보인다) 재직 기간만 닫는다.
//       다시 들어오면 옛 재직 기간 행에 표시(archived_tenure_id)를 찍어 직원·사장 화면에서 모두 뺀다. 시급은 비운다.
//       스스로 나가기·다시 열기도 같은 정리 함수(close_member_tenure)를 지난다. 다른 매장 tenure id 는 거부한다.
//   [8] 0247 3년 보존 크론(purge_expired_tenures) — dry-run 은 개수만 센다. 실제 실행은 퇴직 3년+1일 지난 것만 지우고
//       다시 돌리면 0 이다. 처리방침 개정 전까지 6개월 지난 스냅샷 이름·끝4자리를 비운다. 실행마다 retention_purge_log.
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

const phones = ['0181', '0182', '0183', '0184', '0185'].map((p) => `${p}${s.slice(0, 7)}`);
const H = 3600000;
const kstDate = (ms) => new Date(ms + 9 * H).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();

const users = [];
const otherUnits = [];
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

  // ═══════ 0246 — 재직 기간(member_tenures) · 재입사 표시(archived_tenure_id) · 정리 함수 ═══════
  //   병합 모델(마스터 계획 Phase 4): 나갈 때는 아무것도 숨기지 않는다(마지막 급여 정산 · 근기법 36조).
  //   다시 들어오는 순간 옛 재직 기간 행에 표시를 찍어 사장을 포함한 모든 앱 화면에서 뺀다(DB 에만 보관 · 새 직원).
  const today = kstDate(now);
  const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dowOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const rows = async (q) => { const { data, error } = await q; return error ? `오류 ${error.code ?? ''} ${error.message}` : (data ?? []); };
  const len = (r) => (Array.isArray(r) ? r.length : r);
  const inputsOf = async (c) => {
    const { data, error } = await c.rpc('owner_labor_inputs_v2');
    if (error) return { error: error.message };
    return (data ?? []).find((x) => x.unit_id === UNIT) ?? {};
  };
  const addUser = async (i, name, role) => {
    const c = mk();
    const id = await up(c, i, name, role, role === 'owner' ? '1980-01-01' : '2000-01-01');
    return { c, id };
  };
  const joinApprove = async (U) => {
    const j = await U.c.rpc('join_by_invite', { p_code: row.invite_code });
    if (j.error) throw new Error('join_by_invite: ' + j.error.message);
    const a = await O.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error('approve_member: ' + a.error.message);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  };

  const K = await addUser(2, 'QA재입사직원', 'junior');
  const L = await addUser(3, 'QA나감직원', 'junior');
  const P = await addUser(4, 'QA다른매장사장', 'owner');
  await joinApprove(K);
  await joinApprove(L);

  // ── K 셋업: 옛 앱 경로(사장 직접 쓰기)와 서버 경로를 섞어 재직 중 기록을 만든다 ──
  const kSeries = `ret_ks_${s}`, kDated = `ret_kd_${s}`, kSwap = `ret_kw_${s}`, kChat = `ret_kc_${s}`, kAtt = `ret_ka_${s}`;
  const past3 = addDays(today, -3);
  {
    const w = await O.from('wages').upsert({ unit_id: UNIT, staff_id: K.id, hourly_wage: 12000 });
    if (w.error) throw new Error('K wages(옛 앱 경로): ' + w.error.message);
    const t = await O.from('shift_templates').insert({ id: kSeries, unit_id: UNIT, staff_id: K.id, weekday: dowOf(today), shift_date: null, start_time: '09:00', end_time: '13:00' });
    if (t.error) throw new Error('K 반복 근무(옛 앱 경로): ' + t.error.message);
    for (const [label, q] of [
      ['K 날짜 근무', admin.from('shift_templates').insert({ id: kDated, unit_id: UNIT, staff_id: K.id, weekday: null, shift_date: past3, start_time: '10:00', end_time: '14:00' })],
      ['K 출퇴근', admin.from('attendance').insert({ id: kAtt, unit_id: UNIT, staff_id: K.id, date: today, check_in: iso(now - 3 * H), check_out: iso(now - 1 * H), work_minutes: 120 })],
      ['K 질문', admin.from('chat_queries').insert({ id: kChat, unit_id: UNIT, junior_id: K.id, junior_name: 'QA재입사직원', query_text: '재입사 전 질문' })],
      ['K 교대 이력', admin.from('swap_requests').insert({ id: kSwap, unit_id: UNIT, kind: 'cover', requester_id: K.id, date: past3, template_id: kDated, note: '', status: 'rejected' })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    const m = await O.rpc('mark_shift_day', { p_template: kDated, p_date: past3, p_mark: 'absent', p_confirm_past: true });
    if (m.error) throw new Error('K 결근 표시: ' + m.error.message);
    const rq = await K.c.rpc('request_shift_time', { p_template: kDated, p_date: past3, p_start: '11:00', p_end: '14:00' });
    if (rq.error) throw new Error('K 시간 요청: ' + rq.error.message);
  }

  // ── L 셋업: 스스로 나갈 사람 ──
  const lSeries = `ret_ls_${s}`, lFuture = `ret_lf_${s}`, lSwap = `ret_lw_${s}`, lCourse = `ret_lq_${s}`;
  {
    const t = await O.from('shift_templates').insert({ id: lSeries, unit_id: UNIT, staff_id: L.id, weekday: dowOf(today), shift_date: null, start_time: '14:00', end_time: '18:00' });
    if (t.error) throw new Error('L 반복 근무: ' + t.error.message);
    for (const [label, q] of [
      ['L 미래 날짜 근무', admin.from('shift_templates').insert({ id: lFuture, unit_id: UNIT, staff_id: L.id, weekday: null, shift_date: addDays(today, 3), start_time: '10:00', end_time: '12:00' })],
      ['L 미결 교대', admin.from('swap_requests').insert({ id: lSwap, unit_id: UNIT, kind: 'cover', requester_id: L.id, date: addDays(today, 3), template_id: lFuture, note: '', status: 'open' })],
      ['L 코스', admin.from('training_courses').insert({ id: lCourse, unit_id: UNIT, key: `ret_lq_${s}`, name: 'QA보존 코스' })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    const qa = await admin.from('quiz_assignments').insert({ unit_id: UNIT, course_id: lCourse, user_id: L.id, scheduled_on: addDays(today, 2), origin: 'manual' });
    if (qa.error) throw new Error('L 미발송 퀴즈: ' + qa.error.message);
    const pf = await L.c.from('unit_member_prefs').upsert({ user_id: L.id, unit_id: UNIT, nickname: '엘' });
    if (pf.error) throw new Error('L 알림 설정: ' + pf.error.message);
  }

  // ═══════ 3. 내보낸 직원의 그 달 기록은 다시 들어오기 전까지 사장에게 보인다 ═══════
  console.log('\n[3] 0246 remove_staff — 나갈 때는 숨기지 않는다(마지막 급여 정산) · 재직 기간이 닫힌다');
  {
    const r = await O.rpc('remove_staff', { p_staff_id: K.id });
    check('3-1 remove_staff 성공', !r.error, r.error?.message);
    check('3-2 사장이 그 달 출퇴근을 본다', len(await rows(O.from('attendance').select('id').eq('staff_id', K.id))) === 1,
      String(len(await rows(O.from('attendance').select('id').eq('staff_id', K.id)))));
    const sh = await rows(admin.from('shift_templates').select('id, valid_to').eq('unit_id', UNIT).eq('staff_id', K.id));
    check('3-3 ★근무표가 남는다(반복 행 + 지난 날짜 행 · 지우지 않는다)', len(sh) === 2, JSON.stringify(sh));
    const ser = Array.isArray(sh) ? sh.find((x) => x.id === kSeries) : null;
    check('3-4 ★반복 근무는 오늘로 닫힌다(valid_to = 오늘)', ser?.valid_to === today, JSON.stringify(ser));
    const inp = await inputsOf(O);
    check('3-5 ★owner_labor_inputs_v2 가 나간 직원의 근무를 준다(이번 기간 정산)',
      (inp.shifts ?? []).filter((x) => x.staff_id === K.id).length === 2, JSON.stringify(inp.error ?? (inp.shifts ?? []).length));
    check('3-6 ★결근 표시가 남는다(근무표 cascade 로 사라지지 않는다)',
      len(await rows(O.from('shift_day_marks').select('date').eq('staff_id', K.id))) === 1, String(len(await rows(O.from('shift_day_marks').select('date').eq('staff_id', K.id)))));
    check('3-7 사장이 시급을 본다(wages · wage_rates)',
      len(await rows(O.from('wages').select('staff_id').eq('staff_id', K.id))) === 1 && len(await rows(O.from('wage_rates').select('staff_id').eq('staff_id', K.id))) >= 1);
    const ten = await rows(admin.from('member_tenures').select('id, left_at, left_reason, role_at_end, name_snapshot, phone_last4, final_hourly_wage').eq('unit_id', UNIT).eq('user_id', K.id));
    const closed = Array.isArray(ten) ? ten.find((x) => x.left_at) : null;
    check('3-8 ★재직 기간이 닫힌다(removed · 이름 · 끝4자리 · 역할 · 마지막 시급)',
      closed?.left_reason === 'removed' && closed?.name_snapshot === 'QA재입사직원' && closed?.phone_last4 === phones[2].slice(-4)
        && closed?.role_at_end === 'junior' && closed?.final_hourly_wage === 12000, JSON.stringify(ten));
    check('3-9 ★열린 재직 기간이 없다', Array.isArray(ten) && ten.filter((x) => !x.left_at).length === 0, JSON.stringify(ten));
  }

  // ═══════ 4. 스스로 나가기(leave_store)도 같은 정리 ═══════
  console.log('\n[4] 0246 leave_store — close_member_tenure(left) · 앞으로의 예정만 정리');
  {
    const r = await L.c.rpc('leave_store');
    check('4-1 leave_store 성공', !r.error, r.error?.message);
    const ten = await rows(admin.from('member_tenures').select('left_at, left_reason, name_snapshot').eq('unit_id', UNIT).eq('user_id', L.id));
    check('4-2 ★재직 기간이 left 로 닫힌다', Array.isArray(ten) && ten.length === 1 && ten[0].left_reason === 'left' && !!ten[0].left_at
      && ten[0].name_snapshot === 'QA나감직원', JSON.stringify(ten));
    const ser = await rows(admin.from('shift_templates').select('valid_to').eq('id', lSeries));
    check('4-3 ★반복 근무는 지우지 않고 오늘로 닫는다', Array.isArray(ser) && ser[0]?.valid_to === today, JSON.stringify(ser));
    check('4-4 ★앞으로의 날짜 근무는 지운다', len(await rows(admin.from('shift_templates').select('id').eq('id', lFuture))) === 0);
    check('4-5 ★미결 교대는 지운다', len(await rows(admin.from('swap_requests').select('id').eq('id', lSwap))) === 0);
    check('4-6 ★보내지 않은 퀴즈는 지운다', len(await rows(admin.from('quiz_assignments').select('id').eq('user_id', L.id).is('sent_at', null))) === 0);
    check('4-7 ★매장별 알림 설정을 지운다', len(await rows(admin.from('unit_member_prefs').select('user_id').eq('user_id', L.id).eq('unit_id', UNIT))) === 0);
    check('4-8 former_staff 에 더 쓰지 않는다', len(await rows(admin.from('former_staff').select('staff_id').eq('unit_id', UNIT).eq('staff_id', L.id))) === 0);
  }

  // ═══════ 5. 다시 들어오면 새 직원 — 옛 기록은 DB 에만 ═══════
  console.log('\n[5] 0246 재입사 — 옛 재직 기간 행에 표시 · 시급 비움 · 모든 앱 화면에서 빠진다');
  {
    await joinApprove(K);
    check('5-1 ★시급(wages)이 없다 — 시급 미설정부터', len(await rows(admin.from('wages').select('staff_id').eq('unit_id', UNIT).eq('staff_id', K.id))) === 0,
      String(len(await rows(admin.from('wages').select('staff_id').eq('unit_id', UNIT).eq('staff_id', K.id)))));
    check('5-2 ★직원 본인 select 에 옛 출퇴근이 0건', len(await rows(K.c.from('attendance').select('id').eq('staff_id', K.id))) === 0,
      String(len(await rows(K.c.from('attendance').select('id').eq('staff_id', K.id)))));
    check('5-3 ★사장 select 에도 0건', len(await rows(O.from('attendance').select('id').eq('staff_id', K.id))) === 0,
      String(len(await rows(O.from('attendance').select('id').eq('staff_id', K.id)))));
    check('5-4 ★옛 질문이 본인에게 안 보인다', len(await rows(K.c.from('chat_queries').select('id').eq('id', kChat))) === 0);
    check('5-5 ★사장에게 옛 시급 이력·결근 표시·시간 요청이 안 보인다',
      len(await rows(O.from('wage_rates').select('staff_id').eq('staff_id', K.id))) === 0
        && len(await rows(O.from('shift_day_marks').select('date').eq('staff_id', K.id))) === 0
        && len(await rows(O.from('shift_change_requests').select('id').eq('staff_id', K.id))) === 0);
    check('5-6 ★옛 교대 이력이 매장 동료에게 안 보인다', len(await rows(J.from('swap_requests').select('id').eq('id', kSwap))) === 0);
    const arch = await rows(admin.from('attendance').select('archived_tenure_id').eq('id', kAtt));
    const archT = await rows(admin.from('shift_templates').select('id, archived_tenure_id').eq('unit_id', UNIT).eq('staff_id', K.id));
    check('5-7 ★옛 행은 지우지 않고 표시만 한다(출퇴근 · 근무표 · 교대)', Array.isArray(arch) && !!arch[0]?.archived_tenure_id
      && Array.isArray(archT) && archT.length === 2 && archT.every((x) => !!x.archived_tenure_id)
      && len(await rows(admin.from('swap_requests').select('id').eq('id', kSwap).not('archived_tenure_id', 'is', null))) === 1, JSON.stringify([arch, archT]));
    const inp = await inputsOf(O);
    check('5-8 ★owner_labor_inputs_v2 에 옛 근무·시급 이력·결근 표시가 없다',
      !inp.error && !(inp.shifts ?? []).some((x) => x.staff_id === K.id) && !(inp.wage_rates ?? []).some((x) => x.staff_id === K.id)
        && !(inp.marks ?? []).some((x) => x.staff_id === K.id), JSON.stringify(inp.error ?? ''));
    const { data: cs, error: ce } = await K.c.rpc('my_cross_summary_v2');
    const mine = (cs ?? []).find((x) => x.unit_id === UNIT);
    check('5-9 ★my_cross_summary_v2: 이번 달 근무 0분 · 근무 0 · 시급 이력 0', !ce && Number(mine?.month_minutes) === 0
      && (mine?.shifts ?? []).length === 0 && (mine?.wage_rates ?? []).length === 0, ce?.message ?? JSON.stringify(mine));
    const ten = await rows(admin.from('member_tenures').select('id, left_at, final_hourly_wage').eq('unit_id', UNIT).eq('user_id', K.id));
    check('5-10 ★재직 기간 2개(닫힌 것 · 열린 것) · 닫힌 기간이 마지막 시급을 갖는다', Array.isArray(ten) && ten.length === 2
      && ten.filter((x) => !x.left_at).length === 1 && ten.find((x) => x.left_at)?.final_hourly_wage === 12000, JSON.stringify(ten));
    check('5-11 ★former_staff 행을 지운다', len(await rows(admin.from('former_staff').select('staff_id').eq('unit_id', UNIT).eq('staff_id', K.id))) === 0);
    // 새 시급은 옛 이력과 부딪히지 않고 처음부터(옛 앱 경로)
    const w = await O.from('wages').upsert({ unit_id: UNIT, staff_id: K.id, hourly_wage: 13000 });
    const wr = await rows(O.from('wage_rates').select('effective_from, hourly_wage').eq('staff_id', K.id));
    check('5-12 ★재입사 뒤 새 시급 = 이력 1행(13000 · 처음부터)', !w.error && Array.isArray(wr) && wr.length === 1 && wr[0].hourly_wage === 13000,
      w.error?.message ?? JSON.stringify(wr));
    const ins = await K.c.from('attendance').insert({ id: `ret_kn_${s}`, unit_id: UNIT, staff_id: K.id, date: today, check_in: iso(now - 30 * 60000), work_minutes: 0 });
    check('5-13 새 재직 기간 출근은 그대로 된다', !ins.error && len(await rows(K.c.from('attendance').select('id').eq('staff_id', K.id))) === 1, ins.error?.message);
    const upd = await K.c.from('attendance').update({ archived_tenure_id: ten.find?.((x) => x.left_at)?.id ?? null }).eq('id', `ret_kn_${s}`).select('id');
    check('5-14 ★직원이 자기 행에 표시를 찍을 수 없다(42501)', upd.error?.code === '42501', `code=${upd.error?.code ?? '-'} ${upd.error?.message ?? JSON.stringify(upd.data)}`);
  }

  // ═══════ 6. 다른 매장 재직 기간 ═══════
  console.log('\n[6] 0246 member_tenures — 같은 매장 사장만 · 다른 매장 tenure id 거부');
  {
    const { data: ps, error: pe } = await P.c.rpc('create_store', { p_store_name: 'QA보존다른카페', p_industry: '카페·디저트', p_biz_no: null });
    const prow = Array.isArray(ps) ? ps[0] : ps;
    if (pe || !prow?.unit_id) throw new Error('P create_store: ' + (pe?.message ?? 'no row'));
    otherUnits.push(prow.unit_id);
    await P.c.rpc('switch_active_unit', { p_unit_id: prow.unit_id });
    const ten = await rows(admin.from('member_tenures').select('id').eq('unit_id', UNIT).eq('user_id', K.id).not('left_at', 'is', null));
    const tid = Array.isArray(ten) ? ten[0]?.id : null;
    const pt = await P.c.from('member_tenures').select('id').eq('id', tid ?? '00000000-0000-0000-0000-000000000000');
    check('6-1 ★다른 매장 사장은 이 매장 재직 기간을 못 본다(0행)', !!tid && !pt.error && (pt.data ?? []).length === 0, pt.error?.message ?? `tid=${tid} rows=${(pt.data ?? []).length}`);
    const ot = await O.from('member_tenures').select('id').eq('user_id', K.id);
    check('6-2 ★같은 매장 사장은 본다(2행)', !ot.error && (ot.data ?? []).length === 2, ot.error?.message ?? String((ot.data ?? []).length));
    const kt = await K.c.from('member_tenures').select('id');
    check('6-3 ★직원은 재직 기간을 못 본다(0행)', !kt.error && (kt.data ?? []).length === 0, kt.error?.message ?? String((kt.data ?? []).length));
    const pi = await P.c.from('attendance').insert({ id: `ret_pa_${s}`, unit_id: prow.unit_id, staff_id: P.id, date: today, work_minutes: 0, archived_tenure_id: tid });
    check('6-4 ★다른 매장 tenure id 로 표시된 행을 넣을 수 없다(42501)', pi.error?.code === '42501', `code=${pi.error?.code ?? '-'} ${pi.error?.message ?? ''}`);
    const pw2 = await P.c.from('member_tenures').insert({ unit_id: prow.unit_id, user_id: P.id, joined_at: iso(now) });
    check('6-5 ★재직 기간은 앱이 쓸 수 없다', !!pw2.error, pw2.error?.message ?? '들어감');
  }

  // ═══════ 7. 다시 열기 — 기록은 두고 소속만 정리 ═══════
  console.log('\n[7] 0246 reopen_store — 직원마다 close_member_tenure(reopen) · 출퇴근·교대 이력·근무표 기록이 남는다');
  {
    const jSeries = `ret_js_${s}`, jSwap = `ret_jw_${s}`, oSeries = `ret_os_${s}`;
    for (const [label, q] of [
      ['J 반복 근무', O.from('shift_templates').insert({ id: jSeries, unit_id: UNIT, staff_id: jId, weekday: dowOf(today), shift_date: null, start_time: '18:00', end_time: '22:00' })],
      ['사장 반복 근무', O.from('shift_templates').insert({ id: oSeries, unit_id: UNIT, staff_id: users[0].id, weekday: dowOf(today), shift_date: null, start_time: '08:00', end_time: '09:00' })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    { const { error } = await admin.from('swap_requests').insert({ id: jSwap, unit_id: UNIT, kind: 'cover', requester_id: jId, date: past3, template_id: jSeries, note: '', status: 'approved' });
      if (error) throw new Error('J 교대 이력 셋업: ' + error.message); }
    // 잠그기: 사장에게 유료 매장(S2)을 주고 이 매장은 무료로 만든다 → 이 매장이 "이전 매장"이 된다. 슬롯 1개.
    const S2 = `ret_s2_${s}`;
    for (const [label, q] of [
      ['S2', admin.from('units').insert({ id: S2, owner_id: users[0].id, store_name: 'QA보존2호점' })],
      ['S2 사장', admin.from('unit_members').insert({ user_id: users[0].id, unit_id: S2, role: 'owner' })],
      ['S2 구독', admin.from('unit_subscriptions').upsert({ unit_id: S2, status: 'active', plan: 'multi', paid_until: iso(now + 30 * 24 * H) })],
      ['이 매장 무료', admin.from('unit_subscriptions').upsert({ unit_id: UNIT, status: 'active', plan: 'multi', paid_until: iso(now - 60000) })],
      ['슬롯', admin.from('store_slots').insert({ owner_id: users[0].id, paid_until: iso(now + 30 * 24 * H), source: 'grant' })],
      ['대기 신청', admin.from('profiles').update({ pending_unit_id: UNIT }).eq('id', L.id)],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    otherUnits.push(S2);
    const attBefore = (await admin.from('attendance').select('*', { count: 'exact', head: true }).eq('unit_id', UNIT)).count;
    const r = await O.rpc('reopen_store', { p_unit: UNIT });
    check('7-1 reopen_store 성공', !r.error, r.error?.message);
    const attAfter = (await admin.from('attendance').select('*', { count: 'exact', head: true }).eq('unit_id', UNIT)).count;
    check('7-2 출퇴근 행 수가 그대로다', attBefore > 0 && attAfter === attBefore, `${attBefore} → ${attAfter}`);
    const js = await rows(admin.from('shift_templates').select('valid_to').eq('id', jSeries));
    check('7-3 ★직원 반복 근무는 지우지 않고 오늘로 닫는다', Array.isArray(js) && js[0]?.valid_to === today, JSON.stringify(js));
    check('7-4 ★직원 교대 이력(approved)이 남는다', len(await rows(admin.from('swap_requests').select('id').eq('id', jSwap))) === 1);
    const ten = await rows(admin.from('member_tenures').select('user_id, left_reason, left_at').eq('unit_id', UNIT).is('archived_tenure_id', null));
    const tenOpen = await rows(admin.from('member_tenures').select('user_id').eq('unit_id', UNIT).is('left_at', null));
    const jt = await rows(admin.from('member_tenures').select('left_reason').eq('unit_id', UNIT).eq('user_id', jId));
    check('7-5 ★직원 재직 기간이 reopen 으로 닫히고 열린 기간이 0', Array.isArray(jt) && jt.some((x) => x.left_reason === 'reopen')
      && Array.isArray(tenOpen) && tenOpen.length === 0, JSON.stringify([jt, tenOpen, typeof ten === 'string' ? ten : '']));
    const mem = (await admin.from('unit_members').select('*', { count: 'exact', head: true }).eq('unit_id', UNIT).in('role', ['junior', 'manager'])).count;
    check('7-6 직원 멤버십 0', mem === 0, `rows=${mem}`);
    const pend = (await admin.from('profiles').select('pending_unit_id').eq('id', L.id).maybeSingle()).data;
    check('7-7 대기 신청이 비었다', pend?.pending_unit_id === null, JSON.stringify(pend));
    const os = await rows(admin.from('shift_templates').select('valid_to').eq('id', oSeries));
    check('7-8 사장 본인 근무표는 그대로', Array.isArray(os) && os.length === 1 && os[0].valid_to === null, JSON.stringify(os));
  }

  // ═══════ 8. 0247 — 3년 보존 크론 purge_expired_tenures(p_dry_run default true) ═══════
  //   근로기준법 제42조 · 시행령 제22조: 퇴직일부터 3년. dry-run 은 개수만 센다(크론은 7일 동안 dry-run 으로 돈다 · P4-8).
  //   실제 실행은 3년 + 1일 지난 것만 지우고, 다시 돌리면 0 이다. 처리방침 개정 전까지는 6개월 지난 스냅샷 이름·끝4자리를 비운다.
  console.log('\n[8] 0247 purge_expired_tenures — dry-run 은 세기만 · 실제는 3년+1일만 · 다시 돌리면 0 · 6개월 스냅샷 비움');
  {
    const D = 24 * H;
    const Y3 = 3 * 365.25 * D;
    const rid = () => crypto.randomUUID();
    const X = rid(), Y = rid(), Z = rid(), F = rid(), W = rid(), G = rid();
    const T = { x: rid(), y1: rid(), y2: rid(), z: rid() };
    const oldDay = kstDate(now - Y3 - 40 * D);
    const setup = [
      // X: 3년+1일 전에 나간 사람(지금 멤버 아님) — 표시 안 된 행이 전부 지워진다.
      ['X 기간', admin.from('member_tenures').insert({ id: T.x, unit_id: UNIT, user_id: X, joined_at: iso(now - Y3 - 400 * D), left_at: iso(now - Y3 - D), left_reason: 'removed', name_snapshot: 'X이름', phone_last4: '1111' })],
      ['X 출퇴근', admin.from('attendance').insert({ id: `ret_px_a_${s}`, unit_id: UNIT, staff_id: X, date: oldDay, check_in: iso(now - Y3 - 40 * D), work_minutes: 60 })],
      ['X 근무', admin.from('shift_templates').insert({ id: `ret_px_t_${s}`, unit_id: UNIT, staff_id: X, weekday: null, shift_date: oldDay, start_time: '09:00', end_time: '10:00' })],
      ['X 시급', admin.from('wages').upsert({ unit_id: UNIT, staff_id: X, hourly_wage: 9000 })],
      ['X 질문', admin.from('chat_queries').insert({ id: `ret_px_c_${s}`, unit_id: UNIT, junior_id: X, junior_name: 'X이름', query_text: '오래된 질문' })],
      ['X 모르는 질문', admin.from('unknown_queries').insert({ id: `ret_px_u_${s}`, unit_id: UNIT, junior_id: X, junior_name: 'X이름', query_text: '오래된 모르는 질문', status: 'dismissed' })],
      // 작성자 칸은 INSERT 트리거(stamp_author)가 auth.uid() 로 덮는다(service_role 이면 null) → 넣은 뒤 고친다.
      ['X 질문 작성자', admin.from('chat_queries').update({ junior_id: X }).eq('id', `ret_px_c_${s}`)],
      ['X 모르는 질문 작성자', admin.from('unknown_queries').update({ junior_id: X }).eq('id', `ret_px_u_${s}`)],
      // Y: 재입사자 — 3년+1일 전에 닫힌 첫 기간(표시된 행)과 1년 전에 닫힌 둘째 기간(표시 안 된 행).
      ['Y 첫 기간', admin.from('member_tenures').insert({ id: T.y1, unit_id: UNIT, user_id: Y, joined_at: iso(now - Y3 - 300 * D), left_at: iso(now - Y3 - D), left_reason: 'removed', name_snapshot: 'Y이름' })],
      ['Y 둘째 기간', admin.from('member_tenures').insert({ id: T.y2, unit_id: UNIT, user_id: Y, joined_at: iso(now - 600 * D), left_at: iso(now - 365 * D), left_reason: 'left', name_snapshot: 'Y이름' })],
      ['Y 옛 출퇴근(표시)', admin.from('attendance').insert({ id: `ret_py_a1_${s}`, unit_id: UNIT, staff_id: Y, date: oldDay, work_minutes: 60, archived_tenure_id: T.y1 })],
      ['Y 둘째 출퇴근', admin.from('attendance').insert({ id: `ret_py_a2_${s}`, unit_id: UNIT, staff_id: Y, date: kstDate(now - 400 * D), work_minutes: 60 })],
      // Z: 3년-1일 전에 나간 사람 — 남는다. 스냅샷은 6개월이 지났으니 비운다(실제 실행에서만).
      ['Z 기간', admin.from('member_tenures').insert({ id: T.z, unit_id: UNIT, user_id: Z, joined_at: iso(now - Y3 - 100 * D), left_at: iso(now - Y3 + D), left_reason: 'left', name_snapshot: 'Z이름', phone_last4: '3333' })],
      ['Z 출퇴근', admin.from('attendance').insert({ id: `ret_pz_a_${s}`, unit_id: UNIT, staff_id: Z, date: oldDay, work_minutes: 60 })],
      // former_staff: F 는 3년+1일(지움) · W 는 3년-1일(남기고 이름·끝4자리를 비움)
      ['F 퇴사 스냅샷', admin.from('former_staff').upsert({ unit_id: UNIT, staff_id: F, name: 'F이름', phone_last4: '5555', departed_at: iso(now - Y3 - D) })],
      ['W 퇴사 스냅샷', admin.from('former_staff').upsert({ unit_id: UNIT, staff_id: W, name: 'W이름', phone_last4: '6666', departed_at: iso(now - Y3 + D) })],
      // 신고 3년 · 계정 없는 동의 기록 5년
      ['오래된 신고', admin.from('user_reports').insert({ id: rid(), store_name: 'QA', reporter_role: 'junior', category: 'other', body: '오래된 신고 본문', created_at: iso(now - Y3 - D) })],
      ['최근 신고', admin.from('user_reports').insert({ id: rid(), store_name: 'QA', reporter_role: 'junior', category: 'other', body: '최근 신고 본문', created_at: iso(now - Y3 + D) })],
      ['계정 없는 동의(5년+1일)', admin.from('user_consents').insert({ user_id: G, item: 'terms', version: `qa_${s}`, channel: 'email_signup', created_at: iso(now - 5 * 365.25 * D - D) })],
      ['계정 있는 동의(5년+1일)', admin.from('user_consents').insert({ user_id: users[0].id, item: 'terms', version: `qa_${s}`, channel: 'email_signup', created_at: iso(now - 5 * 365.25 * D - D) })],
    ];
    for (const [label, q] of setup) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    const ex = async (t, col, v) => len(await rows(admin.from(t).select(col).eq(col, v)));
    const snap = async () => ({
      xAtt: await ex('attendance', 'id', `ret_px_a_${s}`), xSh: await ex('shift_templates', 'id', `ret_px_t_${s}`),
      xWage: len(await rows(admin.from('wages').select('staff_id').eq('unit_id', UNIT).eq('staff_id', X))),
      xRate: len(await rows(admin.from('wage_rates').select('staff_id').eq('unit_id', UNIT).eq('staff_id', X))),
      xChat: await ex('chat_queries', 'id', `ret_px_c_${s}`), xUq: await ex('unknown_queries', 'id', `ret_px_u_${s}`),
      tx: await ex('member_tenures', 'id', T.x), ty1: await ex('member_tenures', 'id', T.y1), ty2: await ex('member_tenures', 'id', T.y2), tz: await ex('member_tenures', 'id', T.z),
      yA1: await ex('attendance', 'id', `ret_py_a1_${s}`), yA2: await ex('attendance', 'id', `ret_py_a2_${s}`), zA: await ex('attendance', 'id', `ret_pz_a_${s}`),
      f: len(await rows(admin.from('former_staff').select('staff_id').eq('staff_id', F))),
      w: len(await rows(admin.from('former_staff').select('staff_id').eq('staff_id', W))),
      rep: len(await rows(admin.from('user_reports').select('id').eq('store_name', 'QA').in('body', ['오래된 신고 본문', '최근 신고 본문']))),
      conG: len(await rows(admin.from('user_consents').select('id').eq('user_id', G))),
      conO: len(await rows(admin.from('user_consents').select('id').eq('user_id', users[0].id).eq('version', `qa_${s}`))),
    });
    const before = await snap();
    check('8-0 셋업이 다 들어갔다', Object.values(before).every((v) => v === 1 || (v === 2 && before.rep === v)), JSON.stringify(before));

    const an = await mk().rpc('purge_expired_tenures');
    check('8-1 anon 은 실행할 수 없다(42501)', an.error?.code === '42501', `code=${an.error?.code ?? '-'} ${an.error?.message ?? ''}`);
    const au = await O.rpc('purge_expired_tenures');
    check('8-2 authenticated(사장)도 실행할 수 없다(42501)', au.error?.code === '42501', `code=${au.error?.code ?? '-'} ${au.error?.message ?? ''}`);

    const dry = await admin.rpc('purge_expired_tenures');
    const dc = dry.data ?? {};
    check('8-3 ★dry-run(기본값)은 개수를 돌려준다(출퇴근 ≥2 · 재직 기간 ≥2 · 옛 퇴사 스냅샷 ≥1 · 신고 ≥1 · 동의 ≥1)', !dry.error && dc.dry_run === true
      && Number(dc.attendance) >= 2 && Number(dc.member_tenures) >= 2 && Number(dc.former_staff) >= 1 && Number(dc.user_reports) >= 1 && Number(dc.user_consents) >= 1,
      dry.error?.message ?? JSON.stringify(dc));
    const afterDry = await snap();
    check('8-4 ★dry-run 은 아무것도 지우지 않는다', JSON.stringify(afterDry) === JSON.stringify(before), JSON.stringify(afterDry));
    const zs = (await admin.from('member_tenures').select('name_snapshot, phone_last4').eq('id', T.z).maybeSingle()).data;
    check('8-5 ★dry-run 은 스냅샷도 비우지 않는다', zs?.name_snapshot === 'Z이름' && zs?.phone_last4 === '3333', JSON.stringify(zs));
    const lg = await admin.from('retention_purge_log').select('job, dry_run, counts, ran_at').order('ran_at', { ascending: false }).limit(1);
    check('8-6 실행마다 retention_purge_log 에 남는다(dry_run true)', !lg.error && lg.data?.[0]?.dry_run === true && lg.data?.[0]?.job === 'purge_expired_tenures',
      lg.error?.message ?? JSON.stringify(lg.data));

    const real = await admin.rpc('purge_expired_tenures', { p_dry_run: false });
    check('8-7 실제 실행 성공(FK 순서 오류 없음)', !real.error && real.data?.dry_run === false, real.error?.message ?? JSON.stringify(real.data));
    const a = await snap();
    check('8-8 ★3년+1일 지난 사람(X)의 출퇴근 · 근무 · 시급 · 시급 이력 · 질문 · 모르는 질문 · 재직 기간을 지운다',
      a.xAtt === 0 && a.xSh === 0 && a.xWage === 0 && a.xRate === 0 && a.xChat === 0 && a.xUq === 0 && a.tx === 0, JSON.stringify(a));
    check('8-9 ★재입사자(Y)의 3년+1일 지난 첫 기간과 그 표시된 행을 지운다', a.ty1 === 0 && a.yA1 === 0, JSON.stringify(a));
    check('8-10 ★Y 의 둘째 기간(1년 전)과 그 기록은 남는다', a.ty2 === 1 && a.yA2 === 1, JSON.stringify(a));
    check('8-11 ★3년-1일(Z)은 남는다', a.tz === 1 && a.zA === 1, JSON.stringify(a));
    check('8-12 former_staff: 3년+1일(F)은 지우고 3년-1일(W)은 남긴다', a.f === 0 && a.w === 1, JSON.stringify(a));
    check('8-13 신고는 3년+1일만 지운다', a.rep === 1, JSON.stringify(a));
    check('8-14 동의 기록은 계정이 없고 5년이 넘은 것만 지운다', a.conG === 0 && a.conO === 1, JSON.stringify(a));
    const z2 = (await admin.from('member_tenures').select('name_snapshot, phone_last4').eq('id', T.z).maybeSingle()).data;
    const w2 = (await admin.from('former_staff').select('name, phone_last4').eq('staff_id', W).maybeSingle()).data;
    check('8-15 ★6개월 지난 스냅샷 이름 · 끝4자리를 비운다(처리방침 개정 전 · 정책 M6)', z2?.name_snapshot === null && z2?.phone_last4 === null
      && w2?.name === null && w2?.phone_last4 === null, JSON.stringify([z2, w2]));

    const again = await admin.rpc('purge_expired_tenures', { p_dry_run: false });
    const nonzero = Object.entries(again.data ?? {}).filter(([k, v]) => typeof v === 'number' && v !== 0);
    check('8-16 ★다시 돌리면 모든 개수가 0', !again.error && nonzero.length === 0, again.error?.message ?? JSON.stringify(nonzero));
    const lg2 = await O.from('retention_purge_log').select('*');
    check('8-17 앱은 retention_purge_log 를 읽을 수 없다', !!lg2.error || (lg2.data ?? []).length === 0, lg2.error?.code ?? `rows=${(lg2.data ?? []).length}`);
    await admin.from('user_consents').delete().eq('version', `qa_${s}`);
    await admin.from('user_reports').delete().eq('store_name', 'QA').in('body', ['오래된 신고 본문', '최근 신고 본문']);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  if (UNIT) { try { await admin.from('units').delete().eq('id', UNIT); } catch { /* best-effort */ } }
  for (const id of otherUnits) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
