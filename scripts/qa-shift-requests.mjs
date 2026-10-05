#!/usr/bin/env node
// qa-shift-requests.mjs — 0243 직원 근무 시간 수정 요청(J2) · 로컬 도커 전용
//
// 사용자 결정(J2): 직원이 시간을 고치면 그날 하루만 바뀌고, 사장이 승인한 뒤에 급여에 반영된다.
// 사용자 결정(§8 Q4): 지난 날짜를 승인하면 그 기간 급여가 바뀐다 → 서버는 p_confirm_past 를 요구한다.
// 무엇을 못박나:
//   [1] 옛 앱 경로 update_my_shift_time 은 반복·날짜 지정 모두 false 이고 근무표를 바꾸지 않는다.
//   [2] request_shift_time: 본인 근무 · 그날 실제로 서는 근무 · 오늘-35일~오늘+60일 · 시각 형식 · 다른 매장 거부.
//       같은 근무·같은 날의 대기 요청은 하나다(다시 내면 앞 요청은 cancelled 로 닫고 새 id 를 만든다).
//       사장이 본 요청 id 로 승인하면 그사이 바뀐 시각이 반영되지 않는다(4-17 · not_pending).
//   [3] RLS: 본인과 관리자만 본다. 동료·다른 매장은 0건. 클라이언트 직접 쓰기는 안 된다.
//   [4] decide_shift_time: 사장만(매니저도 불가 · J2 원문). 승인하면 그날만 바뀌고 edited_by='staff' 가 남는다.
//       다음 주 같은 요일은 그대로다. 지난 날짜는 p_confirm_past 필수. 35일이 넘으면 거부. 두 번 승인돼도 한 번만 반영.
//       그날 근무가 이미 없어졌으면 승인하지 않고 요청을 닫는다(cancelled).
//   [5] 옛 앱 사장이 반복 근무를 직접 고치거나 지우면(copy_past_segment) 지난 날짜 요청은 지난 구간 복사본을 따라간다.
//   [6] 권한 · 표 권한 · realtime · 부분 유니크.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시키고 지운다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-shift-requests.mjs   자가정리(계정·매장·OTP 시드).
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
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};

const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const T = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 오늘(KST)
// 2026-10-05(J1 정정): 이번 달 1일(KST)보다 이른 날짜는 어떤 경로로도 못 바꾼다(past_month_locked).
const MS = `${T.slice(0, 7)}-01`;
const wdT = dow(T);

const phones = ['0141', '0142', '0143', '0144', '0145', '0146'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const email = `qa_scr_${i}_${s}@example.com`;
  const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone: phones[i], birth_date: birth } } });
  if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
  const u = { c, id: r.data.user?.id, email };
  users.push(u);
  return u;
};
const store = async (c, name) => {
  const { data, error } = await c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.unit_id) throw new Error('create_store: ' + (error?.message ?? 'no row'));
  units.push(row.unit_id);
  return row;
};
/** 배포 전부터 있던 반복 근무처럼 넣는다(service_role · 생성일 200일 전 · 2000-01-01 부터). */
const legacy = async (id, unit, staff, weekday, start, end) => {
  const { error } = await admin.from('shift_templates').insert({ id, unit_id: unit, staff_id: staff, weekday, shift_date: null, start_time: start, end_time: end,
    created_at: new Date(Date.now() - 200 * 864e5).toISOString() });
  if (error) throw new Error(`legacy ${id}: ${error.message}`);
  psql(`update public.shift_templates set valid_from = '2000-01-01' where id = '${id}'`);
};
const dated = async (id, unit, staff, date, start, end) => {
  const { error } = await admin.from('shift_templates').insert({ id, unit_id: unit, staff_id: staff, weekday: null, shift_date: date, start_time: start, end_time: end });
  if (error) throw new Error(`dated ${id}: ${error.message}`);
};
const tpl = async (id) => (await admin.from('shift_templates').select('*').eq('id', id).maybeSingle()).data;
const rowsOf = async (unit) => (await admin.from('shift_templates').select('*').eq('unit_id', unit)).data ?? [];
const excOf = async (unit) => (await admin.from('shift_exceptions').select('template_id, date').eq('unit_id', unit)).data ?? [];
const reqOf = async (id) => psql(`select coalesce((select row_to_json(r)::text from public.shift_change_requests r where id = '${id}'), 'null')`);
const req = async (id) => { const v = await reqOf(id); try { return JSON.parse(v); } catch { return null; } };

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA요청사장', 'owner', '1980-01-01');
  const J = await signUp(1, 'QA요청직원J', 'junior', '2000-01-01');
  const K = await signUp(2, 'QA요청직원K', 'junior', '2000-02-02');
  const L = await signUp(3, 'QA요청직원L', 'junior', '2000-03-03');
  const M = await signUp(4, 'QA요청매니저', 'junior', '1995-04-04');
  const X = await signUp(5, 'QA다른사장', 'owner', '1981-01-01');
  const st = await store(O.c, 'QA요청카페');
  const UNIT = st.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [U, label] of [[J, 'J'], [K, 'K'], [L, 'L'], [M, 'M']]) {
    const j = await U.c.rpc('join_by_invite', { p_code: st.invite_code });
    if (j.error) throw new Error(`${label} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${label} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  const pr = await O.c.rpc('set_member_role', { p_uid: M.id, p_role: 'manager' });
  if (pr.error) throw new Error('set_member_role: ' + pr.error.message);
  const sx = await store(X.c, 'QA다른요청카페');
  await X.c.rpc('switch_active_unit', { p_unit_id: sx.unit_id });
  // 같은 사장의 두 번째 기기(동시 승인용)
  const O2 = mk();
  { const r = await O2.auth.signInWithPassword({ email: O.email, password: pw }); if (r.error) throw new Error('O2 login: ' + r.error.message); }
  console.log(`셋업 — 매장 ${UNIT} · 오늘(KST) ${T}`);

  const A1 = `qa_scr_a1_${s}`;           // J 의 매주 반복(오늘 요일, 09-18, 2000-01-01 부터)
  await legacy(A1, UNIT, J.id, wdT, '09:00', '18:00');
  const D1 = `qa_scr_d1_${s}`;           // J 의 날짜 지정(T+3)
  await dated(D1, UNIT, J.id, addDays(T, 3), '09:00', '15:00');
  const F1 = `qa_scr_f1_${s}`;           // 다른 매장 근무
  await legacy(F1, sx.unit_id, X.id, wdT, '09:00', '18:00');

  // ═══════ [1] 옛 앱 경로 ═══════
  console.log('\n[1] 옛 앱 update_my_shift_time 은 항상 false(J2 — 그날만 · 사장 승인 뒤)');
  {
    const r1 = await J.c.rpc('update_my_shift_time', { p_id: A1, p_start: '10:00', p_end: '19:00' });
    const a1 = await tpl(A1);
    check('1-1 반복 근무: false · 근무표 그대로', !r1.error && r1.data === false && a1?.start_time === '09:00' && a1?.end_time === '18:00',
      r1.error?.message ?? `rpc=${r1.data} ${a1?.start_time}-${a1?.end_time}`);
    const r2 = await J.c.rpc('update_my_shift_time', { p_id: D1, p_start: '10:00', p_end: '16:00' });
    const d1 = await tpl(D1);
    check('1-2 ★날짜 지정 근무도 false · 근무표 그대로 · 직원 수정 표시 없음(승인 없이 급여가 바뀌지 않는다)',
      !r2.error && r2.data === false && d1?.start_time === '09:00' && d1?.end_time === '15:00' && d1?.edited_by == null,
      r2.error?.message ?? `rpc=${r2.data} ${JSON.stringify(d1 && { s: d1.start_time, e: d1.end_time, by: d1.edited_by })}`);
  }

  // ═══════ [2] request_shift_time ═══════
  console.log('\n[2] request_shift_time — 본인 · 그날 서는 근무 · -35~+60일 · 형식 · 다른 매장');
  const D7 = addDays(T, 7);
  let R1 = null;
  {
    const r = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D7, p_start: '10:00', p_end: '19:00', p_note: '병원' });
    R1 = r.data;
    check('2-1 ★본인 근무(다음 주) 요청 성공 · id 반환', !r.error && typeof R1 === 'string', r.error?.message ?? `data=${r.data}`);
    const row = await req(R1);
    check('2-2 대기 요청에 그날 원래 시각과 새 시각이 남는다',
      row?.status === 'pending' && row?.staff_id === J.id && row?.unit_id === UNIT && row?.date === D7
      && row?.old_start === '09:00' && row?.old_end === '18:00' && row?.new_start === '10:00' && row?.new_end === '19:00',
      JSON.stringify(row));
    const again = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D7, p_start: '11:00', p_end: '19:00', p_note: null });
    const pend = psql(`select count(*) from public.shift_change_requests where template_id = '${A1}' and date = '${D7}' and status = 'pending'`);
    const prev = await req(R1), next = await req(again.data);
    check('2-3 ★같은 근무·같은 날 다시 내면 앞 요청은 cancelled · 새 id 로 대기 하나(사장이 본 요청이 몰래 바뀌지 않는다)',
      !again.error && typeof again.data === 'string' && again.data !== R1 && pend === '1'
      && prev?.status === 'cancelled' && prev?.new_start === '10:00' && next?.status === 'pending' && next?.new_start === '11:00',
      again.error?.message ?? `id=${again.data} old=${R1} pending=${pend} prev=${prev?.status}/${prev?.new_start}`);
    R1 = again.data;
    const other = await K.c.rpc('request_shift_time', { p_template: A1, p_date: D7, p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-4 ★남의 근무는 요청 못 한다', !!other.error && /not_own_shift/.test(other.error.message), other.error?.message ?? 'allowed');
    const wrongDay = await J.c.rpc('request_shift_time', { p_template: A1, p_date: addDays(T, 8), p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-5 ★그날 서지 않는 근무(다른 요일)는 거부', !!wrongDay.error && /day_not_scheduled/.test(wrongDay.error.message), wrongDay.error?.message ?? 'allowed');
    const far = await J.c.rpc('request_shift_time', { p_template: A1, p_date: addDays(T, 63), p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-6 오늘+60일 넘으면 거부', !!far.error && /date_out_of_range/.test(far.error.message), far.error?.message ?? 'allowed');
    const old = await J.c.rpc('request_shift_time', { p_template: A1, p_date: addDays(T, -42), p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-7 오늘-35일보다 오래되면 거부(지난달이면 past_month_locked 가 먼저)', !!old.error && /date_out_of_range|past_month_locked/.test(old.error.message), old.error?.message ?? 'allowed');
    const zero = await J.c.rpc('request_shift_time', { p_template: A1, p_date: addDays(T, 14), p_start: '10:00', p_end: '10:00', p_note: null });
    const fmt = await J.c.rpc('request_shift_time', { p_template: A1, p_date: addDays(T, 14), p_start: '9:00', p_end: '18:00', p_note: null });
    check('2-8 0분 · 형식 오류 거부', !!zero.error && !!fmt.error && /invalid_time/.test(zero.error.message), `${zero.error?.message} · ${fmt.error?.message}`);
    const foreign = await J.c.rpc('request_shift_time', { p_template: F1, p_date: D7, p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-9 ★다른 매장 근무 id 는 거부(IDOR)', !!foreign.error && /not_found/.test(foreign.error.message), foreign.error?.message ?? 'allowed');
    const an = await mk().rpc('request_shift_time', { p_template: A1, p_date: D7, p_start: '10:00', p_end: '19:00', p_note: null });
    check('2-10 로그인 안 한 사람은 못 부른다', !!an.error, an.error?.message ?? 'allowed');
  }

  // ═══════ [3] RLS ═══════
  console.log('\n[3] RLS — 본인·관리자만 본다 · 직접 쓰기 불가');
  {
    const seen = async (c) => ((await c.from('shift_change_requests').select('id').eq('id', R1)).data ?? []).length;
    check('3-1 본인은 자기 요청을 본다', (await seen(J.c)) === 1);
    check('3-2 ★같은 매장 동료는 못 본다', (await seen(K.c)) === 0);
    check('3-3 사장·매니저는 본다', (await seen(O.c)) === 1 && (await seen(M.c)) === 1);
    check('3-4 ★다른 매장 사장은 못 본다', (await seen(X.c)) === 0);
    const ins = await J.c.from('shift_change_requests').insert({ id: `qa_scr_x_${s}`, unit_id: UNIT, staff_id: J.id, template_id: A1, date: addDays(T, 14),
      new_start: '10:00', new_end: '19:00', status: 'approved' }).select('id');
    check('3-5 ★직원이 요청을 직접 넣지 못한다(승인 상태 위조)', !!ins.error || (ins.data ?? []).length === 0, `rows=${(ins.data ?? []).length}`);
    const upd = await J.c.from('shift_change_requests').update({ status: 'approved' }).eq('id', R1).select('id');
    const updO = await O.c.from('shift_change_requests').update({ status: 'approved' }).eq('id', R1).select('id');
    check('3-6 ★직원·사장 모두 상태를 직접 못 바꾼다(RPC 로만)', (!!upd.error || (upd.data ?? []).length === 0) && (!!updO.error || (updO.data ?? []).length === 0)
      && (await req(R1))?.status === 'pending', `j=${upd.error?.code ?? (upd.data ?? []).length} o=${updO.error?.code ?? (updO.data ?? []).length}`);
    const del = await J.c.from('shift_change_requests').delete().eq('id', R1).select('id');
    check('3-7 직접 삭제 불가', (!!del.error || (del.data ?? []).length === 0) && (await req(R1)) !== null);
  }

  // ═══════ [4] decide_shift_time ═══════
  console.log('\n[4] decide_shift_time — 사장만 · 그날만 · 지난 날짜 확인 · 35일 · 한 번만');
  {
    const jd = await J.c.rpc('decide_shift_time', { p_id: R1, p_approve: true });
    check('4-1 직원은 결정 못 한다', !!jd.error && /owner_only/.test(jd.error.message), jd.error?.message ?? `data=${jd.data}`);
    const md = await M.c.rpc('decide_shift_time', { p_id: R1, p_approve: true });
    check('4-2 ★매니저도 결정 못 한다(J2 — 사장 승인)', !!md.error && /owner_only/.test(md.error.message) && (await req(R1))?.status === 'pending',
      md.error?.message ?? `data=${md.data}`);
    const xd = await X.c.rpc('decide_shift_time', { p_id: R1, p_approve: true });
    check('4-3 ★다른 매장 사장은 결정 못 한다(IDOR)', !!xd.error && /not_found/.test(xd.error.message) && (await req(R1))?.status === 'pending',
      xd.error?.message ?? `data=${xd.data}`);

    const ok = await O.c.rpc('decide_shift_time', { p_id: R1, p_approve: true });
    const rows = await rowsOf(UNIT), exc = await excOf(UNIT);
    const day = rows.find((r) => r.staff_id === J.id && r.shift_date === D7);
    const a1 = rows.find((r) => r.id === A1);
    check('4-4 ★사장 승인 → 그날만 새 시각(날짜 지정 행) · 직원 수정 표시',
      !ok.error && ok.data === true && day?.start_time === '11:00' && day?.end_time === '19:00' && day?.edited_by === 'staff'
      && exc.some((e) => e.template_id === A1 && e.date === D7), ok.error?.message ?? JSON.stringify({ day, exc: exc.filter((e) => e.template_id === A1) }));
    check('4-5 ★다음 주 같은 요일은 원래대로(반복 근무 그대로 · 예외 없음)',
      a1?.start_time === '09:00' && a1?.end_time === '18:00' && !exc.some((e) => e.template_id === A1 && e.date === addDays(T, 14)),
      JSON.stringify(a1 && { s: a1.start_time, e: a1.end_time }));
    const r1 = await req(R1);
    check('4-6 요청은 approved · 결정한 사람·시각이 남는다', r1?.status === 'approved' && r1?.decided_by === O.id && !!r1?.decided_at, JSON.stringify(r1));
    const twice = await O.c.rpc('decide_shift_time', { p_id: R1, p_approve: true });
    check('4-7 이미 결정한 요청은 다시 결정 못 한다', !!twice.error && /not_pending/.test(twice.error.message), twice.error?.message ?? `data=${twice.data}`);

    // 지난 날짜(Q4)
    const P7 = addDays(T, -7);
    const rp = await J.c.rpc('request_shift_time', { p_template: A1, p_date: P7, p_start: '09:00', p_end: '20:00', p_note: null });
    if (P7 < MS) {
      // 이번 달에 같은 요일의 지난 날이 없다(오늘이 1~7일) — 지난달 요청은 낼 수 없다.
      check('4-8 지난달 날짜(-7일) 요청은 past_month_locked', !!rp.error && /past_month_locked/.test(rp.error.message), rp.error?.message ?? 'allowed');
    } else {
    check('4-8 지난 날짜(-7일) 요청은 낼 수 있다', !rp.error && typeof rp.data === 'string', rp.error?.message);
    const np = await O.c.rpc('decide_shift_time', { p_id: rp.data, p_approve: true });
    check('4-9 ★지난 날짜 승인은 p_confirm_past 없이 거부 · 근무표 그대로',
      !!np.error && /confirm_past_required/.test(np.error.message) && (await req(rp.data))?.status === 'pending'
      && !(await excOf(UNIT)).some((e) => e.template_id === A1 && e.date === P7), np.error?.message ?? `data=${np.data}`);
    const yp = await O.c.rpc('decide_shift_time', { p_id: rp.data, p_approve: true, p_confirm_past: true });
    check('4-10 p_confirm_past=true 면 승인 · 그날 새 시각',
      !yp.error && yp.data === true && (await rowsOf(UNIT)).some((r) => r.staff_id === J.id && r.shift_date === P7 && r.end_time === '20:00' && r.edited_by === 'staff'),
      yp.error?.message ?? `data=${yp.data}`);
    }

    // 반려
    const D14 = addDays(T, 14);
    const rr = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D14, p_start: '12:00', p_end: '18:00', p_note: null });
    const rj = await O.c.rpc('decide_shift_time', { p_id: rr.data, p_approve: false });
    check('4-11 반려 → rejected · 근무표 그대로',
      !rj.error && rj.data === true && (await req(rr.data))?.status === 'rejected'
      && !(await excOf(UNIT)).some((e) => e.template_id === A1 && e.date === D14) && !(await rowsOf(UNIT)).some((r) => r.shift_date === D14),
      rj.error?.message ?? `data=${rj.data}`);

    // 날짜 지정 행은 그 행을 고친다
    const rd = await J.c.rpc('request_shift_time', { p_template: D1, p_date: addDays(T, 3), p_start: '08:00', p_end: '15:00', p_note: null });
    const ad = await O.c.rpc('decide_shift_time', { p_id: rd.data, p_approve: true });
    const d1 = await tpl(D1);
    check('4-12 날짜 지정 근무 승인 → 그 행이 새 시각 · 직원 수정 표시 · 새 행 없음',
      !rd.error && !ad.error && ad.data === true && d1?.start_time === '08:00' && d1?.edited_by === 'staff'
      && (await rowsOf(UNIT)).filter((r) => r.staff_id === J.id && r.shift_date === addDays(T, 3)).length === 1,
      rd.error?.message ?? ad.error?.message ?? JSON.stringify(d1));

    // 그날 근무가 이미 없어졌으면 닫는다
    const D21 = addDays(T, 21);
    const rs = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D21, p_start: '10:00', p_end: '18:00', p_note: null });
    await O.c.rpc('override_shift_day', { p_id: A1, p_date: D21, p_start: null, p_end: null });
    const as = await O.c.rpc('decide_shift_time', { p_id: rs.data, p_approve: true });
    check('4-13 그날 근무가 빠졌으면 승인하지 않고 요청을 닫는다(cancelled)',
      !as.error && as.data === false && (await req(rs.data))?.status === 'cancelled' && !(await rowsOf(UNIT)).some((r) => r.shift_date === D21),
      as.error?.message ?? `data=${as.data} status=${(await req(rs.data))?.status}`);

    // 35일이 넘은 대기 요청(배포 전 데이터 · 시계가 넘어간 경우)
    const OLD = `qa_scr_old_${s}`;
    psql(`insert into public.shift_change_requests(id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end)
          values ('${OLD}', '${UNIT}', '${J.id}', '${A1}', '${addDays(T, -42)}', '09:00', '18:00', '10:00', '18:00')`);
    const ao = await O.c.rpc('decide_shift_time', { p_id: OLD, p_approve: true, p_confirm_past: true });
    check('4-14 ★35일이 넘은 근무는 확인해도 승인 안 된다(지난달이면 past_month_locked)', !!ao.error && /too_old|past_month_locked/.test(ao.error.message), ao.error?.message ?? `data=${ao.data}`);
    const ro = await O.c.rpc('decide_shift_time', { p_id: OLD, p_approve: false });
    check('4-15 35일이 넘어도 반려는 된다(대기 목록 정리)', !ro.error && ro.data === true && (await req(OLD))?.status === 'rejected', ro.error?.message);

    // 두 기기가 동시에 승인
    const D28 = addDays(T, 28);
    const rc = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D28, p_start: '10:00', p_end: '17:00', p_note: null });
    const [c1, c2] = await Promise.all([O.c.rpc('decide_shift_time', { p_id: rc.data, p_approve: true }),
                                        O2.rpc('decide_shift_time', { p_id: rc.data, p_approve: true })]);
    const okCount = [c1, c2].filter((x) => !x.error && x.data === true).length;
    const dayRows = (await rowsOf(UNIT)).filter((r) => r.staff_id === J.id && r.shift_date === D28).length;
    check('4-16 ★동시에 두 번 승인해도 한 번만 반영(for update 재확인)', okCount === 1 && dayRows === 1,
      `ok=${okCount} rows=${dayRows} ${c1.error?.message ?? c1.data} / ${c2.error?.message ?? c2.data}`);

    // 사장이 목록을 본 뒤 직원이 같은 날을 다시 요청 → 사장이 본 요청 id 로 승인
    const D35 = addDays(T, 35);
    const seenReq = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D35, p_start: '10:00', p_end: '16:00', p_note: null });
    const seenRow = (await O.c.from('shift_change_requests').select('id, new_start, new_end').eq('id', seenReq.data)).data?.[0];
    const swapped = await J.c.rpc('request_shift_time', { p_template: A1, p_date: D35, p_start: '06:00', p_end: '23:00', p_note: null });
    const stale = await O.c.rpc('decide_shift_time', { p_id: seenRow?.id, p_approve: true });
    const d35 = (await rowsOf(UNIT)).filter((r) => r.staff_id === J.id && r.shift_date === D35);
    const exc35 = (await excOf(UNIT)).some((e) => e.template_id === A1 && e.date === D35);
    check('4-17 ★사장이 본 요청(10:00-16:00)으로 승인 → 그사이 바뀐 요청(06:00-23:00)은 반영되지 않는다',
      !seenReq.error && !swapped.error && seenRow?.new_start === '10:00' && !!stale.error && /not_pending/.test(stale.error.message)
      && d35.length === 0 && !exc35 && (await req(swapped.data))?.status === 'pending',
      `${stale.error?.message ?? `data=${stale.data}`} rows=${JSON.stringify(d35.map((r) => `${r.start_time}-${r.end_time}`))} exc=${exc35}`);
  }

  // ═══════ [5] copy_past_segment 가 요청을 옮긴다 ═══════
  console.log('\n[5] 옛 앱 사장이 반복 근무를 고치거나 지워도 지난 날짜 요청은 지난 구간을 따라간다');
  {
    const B1 = `qa_scr_b1_${s}`;
    await legacy(B1, UNIT, L.id, wdT, '09:00', '18:00');
    const P7 = addDays(T, -7), P14 = addDays(T, -14), F7 = addDays(T, 7);
    // 지난 날짜 요청은 배포 전 데이터처럼 직접 넣는다(지난달이면 RPC 가 past_month_locked 로 거부한다).
    const ins = (id, d, st) => psql(`insert into public.shift_change_requests(id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end, status)
          values ('${id}', '${UNIT}', '${L.id}', '${B1}', '${d}', '09:00', '18:00', '09:00', '19:00', '${st}')`);
    ins(`qa_scr_q1_${s}`, P7, 'pending');
    ins(`qa_scr_q2_${s}`, P14, 'rejected');
    const q1 = { data: `qa_scr_q1_${s}`, error: null }, q2 = { data: `qa_scr_q2_${s}`, error: null };
    const q3 = await L.c.rpc('request_shift_time', { p_template: B1, p_date: F7, p_start: '09:00', p_end: '19:00', p_note: null });
    if (q1.error || q2.error || q3.error) throw new Error('[5] request: ' + (q1.error ?? q2.error ?? q3.error).message);
    const up = await O.c.from('shift_templates').update({ start_time: '08:00' }).eq('id', B1).select('id');
    const copy = (await rowsOf(UNIT)).find((r) => r.staff_id === L.id && r.weekday === wdT && r.id !== B1 && !r.shift_date);
    check('5-0 옛 앱 직접 UPDATE 성공 · 지난 구간 복사본 생김', !up.error && !!copy && copy.valid_to === addDays(T, -1), up.error?.message ?? JSON.stringify(copy ?? null));
    check('5-1 ★지난 날짜 대기 요청은 복사본으로 옮겨진다', (await req(q1.data))?.template_id === copy?.id,
      `template=${(await req(q1.data))?.template_id} copy=${copy?.id}`);
    check('5-2 지난 날짜 반려 이력도 복사본으로', (await req(q2.data))?.template_id === copy?.id);
    check('5-3 오늘 이후 요청은 원래 id 에 남는다', (await req(q3.data))?.template_id === B1);
    const ap = await O.c.rpc('decide_shift_time', { p_id: q1.data, p_approve: true, p_confirm_past: true });
    if (P7 < MS) {
      check('5-4 ★옮겨진 지난달 요청은 승인할 수 없다(past_month_locked)', !!ap.error && /past_month_locked/.test(ap.error.message), ap.error?.message ?? `data=${ap.data}`);
    } else {
    check('5-4 ★옮겨진 지난 요청을 승인할 수 있다(그날 서는 근무 = 복사본)',
      !ap.error && ap.data === true && (await rowsOf(UNIT)).some((r) => r.staff_id === L.id && r.shift_date === P7 && r.end_time === '19:00'),
      ap.error?.message ?? `data=${ap.data}`);
    }

    const C1 = `qa_scr_c1_${s}`;
    const wdC = dow(addDays(T, -6));
    await legacy(C1, UNIT, L.id, wdC, '13:00', '19:00');
    psql(`insert into public.shift_change_requests(id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end)
          values ('qa_scr_q4_${s}', '${UNIT}', '${L.id}', '${C1}', '${addDays(T, -6)}', '13:00', '19:00', '13:00', '20:00')`);
    const q4 = { data: `qa_scr_q4_${s}`, error: null };
    const del = await O.c.from('shift_templates').delete().eq('id', C1).select('id');
    const r4 = await req(q4.data);
    check('5-5 ★옛 앱 직접 DELETE 뒤에도 지난 날짜 요청이 지워지지 않고 복사본에 붙는다',
      !q4.error && !del.error && r4 !== null && r4.template_id !== C1, q4.error?.message ?? del.error?.message ?? JSON.stringify(r4));
  }

  // ═══════ [6] 권한 · 표 · realtime ═══════
  console.log('\n[6] 권한 · 표 권한 · realtime');
  {
    for (const fn of ['request_shift_time(text, date, text, text, text)', 'decide_shift_time(text, boolean, boolean)']) {
      const v = psql(`select has_function_privilege('anon', 'public.${fn}', 'execute')::text || has_function_privilege('authenticated', 'public.${fn}', 'execute')::text`);
      check(`6-1 ${fn}: anon 불가 · authenticated 가능`, v === 'falsetrue', v);
    }
    const rls = psql(`select relrowsecurity::text from pg_class where oid = to_regclass('public.shift_change_requests')`);
    check('6-2 RLS 켜짐', rls === 'true', rls);
    const w = psql(`select has_table_privilege('anon', 'public.shift_change_requests', 'SELECT,INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.shift_change_requests', 'INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.shift_change_requests', 'SELECT')::text`);
    check('6-3 anon 권한 없음 · authenticated 쓰기 없음 · 읽기만(realtime)', w === 'false/false/true', w);
    const pub = psql(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_change_requests'`);
    check('6-4 realtime publication 에 있다', pub === '1', pub);
    const uq = psql(`select count(*) from pg_indexes where schemaname = 'public' and tablename = 'shift_change_requests'
                       and indexdef ilike '%unique%' and indexdef ilike '%template_id%' and indexdef ilike '%pending%'`);
    check('6-5 부분 유니크 (template_id, date) where pending', uq === '1', uq);
    const cp = psql(`select has_function_privilege('anon', 'public.copy_past_segment(text, date)', 'execute')::text || has_function_privilege('authenticated', 'public.copy_past_segment(text, date)', 'execute')::text`);
    check('6-6 copy_past_segment 는 여전히 내부 전용', cp === 'falsefalse', cp);
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
