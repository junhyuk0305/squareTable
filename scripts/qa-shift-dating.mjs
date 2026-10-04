#!/usr/bin/env node
// qa-shift-dating.mjs — 0242 근무표 적용 기간(J1) · 순수 계산 + 로컬 DB · 로컬 도커 전용
//
// 사용자 결정(J1): 지난 것은 그대로, 앞으로만 바뀐다. 급여 기준은 근무표다(08-26).
// 무엇을 못박나:
//   [1] 순수 · 골든: 2000-01-01 로 채운 행의 지난 3개월 급여가 옛 판정(요일만)과 새 판정(요일 + 적용 기간)에서 같다.
//       나눈 행(복사본 ~어제 + 원래 행 오늘~)은 경계 앞뒤 어느 날이든 정확히 1건이다. 실제 computePay 를 쓴다.
//   [2] 옛 앱 사장이 반복 근무를 직접 UPDATE 해도 오류가 없고 오늘부터만 바뀐다(데이터 H1 회귀).
//       지난 구간은 복사본으로 남고, 지난 예외는 복사본으로 옮겨진다. 지난 3개월 급여가 1원도 안 바뀐다.
//   [3] 옛 앱 사장이 반복 근무를 직접 DELETE 해도 오류가 없고 "오늘부터 그만"이 된다. 지난 급여는 그대로다.
//   [4] 클라이언트가 적용 기간을 직접 고치지 못한다(기간은 RPC 로만).
//   [5] 첫 반복 근무 시작일(데이터 M1): 그 직원에게 어제 이전에 만든 반복 행이 없으면 매장 합류일(KST)부터다.
//       옛 앱은 근무마다 요청을 따로 보내므로 같은 날 넣은 행은 모두 합류일부터다. 예전 행이 있으면 오늘부터다.
//       오늘 만든 행을 오늘 고치거나 지우면 그 자리에서 바뀐다(오타가 지난 구간 복사본으로 굳지 않는다). 생성일은 직접 못 바꾼다.
//   [6] 새 RPC(add_shift_series · edit_shift_from · end_shift_from · override_shift_day) — 권한 · 지난 날짜 확인 ·
//       다른 매장 거부 · shift_templates_all 노출 범위(보안 M6) · 권한표.
//   [7] approve_swap: 지난 근무는 p_confirm_past 가 있어야 하고, 35일이 넘으면 안 되고, 그날 적용되지 않는 근무는 거부.
//       교대 요청이 다른 매장 근무를 가리키면(template_id · target_template_id) 승인하지 않고 그 매장 근무표를 안 건드린다.
//   [8] end_staff_tenure(내부): 반복 행은 오늘로 닫고, 미래 행만 지운다. 지난 날짜 지정 행은 남긴다.
//   [9] cascade · 정의자 경로가 시리즈 트리거에 안 걸린다(위험 §10-2): delete_store · leave_store ·
//       직원 delete_my_account · purge_deleted_accounts 가 지난 반복 근무가 있어도 성공한다.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시키고 지운다. URL 이 로컬이 아니면 멈춘다.
//   [9] 의 purge_deleted_accounts 는 로컬 DB 전체에서 30일 지난 소프트삭제를 파기한다(로컬이라 괜찮다).
// 실행: node scripts/qa-shift-dating.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
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

// ── 실제 급여 함수(payroll.ts)를 임시 트랜스파일해서 쓴다(qa-payroll 과 같은 방식 · 로직 중복 없음) ──
const OUT = mkdtempSync(join(tmpdir(), 'qa-shift-dating-'));
try {
  execFileSync('npx', ['tsc',
    'src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts', 'src/lib/utils/payroll.ts',
    '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: ROOT, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* 경고로 비-0 이 나와도 산출물로 판정 */ }
for (const f of ['payroll.js', 'schedule.js']) {
  const fp = join(OUT, f);
  writeFileSync(fp, readFileSync(fp, 'utf8')
    .split("'./attendance'").join("'./attendance.js'")
    .split("'./schedule'").join("'./schedule.js'")
    .split("'@/lib/utils/attendance'").join("'./attendance.js'"), 'utf8');
}
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
const { computePay, shiftsToPayRecords } = await import(pathToFileURL(join(OUT, 'payroll.js')));

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

// ── 날짜 · 판정 (UTC 축의 YYYY-MM-DD 산술) ──
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const T = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 오늘(KST)
/** 적용 기간까지 보는 판정(0242 데이터 모델의 정의). 기간 컬럼이 없으면(0242 전) 요일만 본다 = 옛 판정. */
const applies = (t, d) => (t.shift_date ? t.shift_date === d
  : t.weekday === dow(d) && (!t.valid_from || t.valid_from <= d) && (!t.valid_to || d <= t.valid_to));
const expand = (rows, exc, staff, dates) => {
  const out = [];
  for (const d of dates) {
    for (const t of rows) {
      if (t.staff_id !== staff || !applies(t, d)) continue;
      if (!t.shift_date && exc.some((e) => e.template_id === t.id && e.date === d)) continue;
      out.push({ date: d, start: t.start_time, end: t.end_time });
    }
  }
  return out;
};
const W = 10320;
const RULES = { breakDeduction: true, nightAllowance: true, overtimeAllowance: true, weeklyHolidayPay: true, extraAllowance: 0 };
const NOW = `${T}T00:00:00+09:00`;
const pay = (rows, exc, staff, dates) => computePay(shiftsToPayRecords(expand(rows, exc, staff, dates)), W, RULES, NOW).total;
const PAST = range(addDays(T, -91), addDays(T, -1)); // 지난 3개월

const phones = ['0181', '0182', '0183', '0184', '0185'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const r = await c.auth.signUp({
    email: `qa_sdt_${i}_${s}@example.com`, password: pw,
    options: { data: { name, role, phone: phones[i], birth_date: birth } },
  });
  if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
  const u = { c, id: r.data.user?.id };
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

try {
  // ═══════ [1] 순수 · 골든 (DB 없음) ═══════
  console.log('[1] 순수 — 2000-01-01 로 채운 행 · 나눈 행의 급여가 옛 판정과 같다');
  {
    const legacy = [{ id: 'g1', staff_id: 'S', weekday: 1, shift_date: null, start_time: '09:00', end_time: '18:00' },
                    { id: 'g2', staff_id: 'S', weekday: 4, shift_date: null, start_time: '22:00', end_time: '06:00' }];
    const backfilled = legacy.map((t) => ({ ...t, valid_from: '2000-01-01', valid_to: null }));
    const exc = [{ template_id: 'g1', date: PAST.find((d) => dow(d) === 1) }];
    const a = pay(legacy, exc, 'S', PAST), b = pay(backfilled, exc, 'S', PAST);
    check('1-1 ★골든: 백필 행의 지난 3개월 급여 = 옛 판정(요일만)', a === b && a > 0, `old=${a} new=${b}`);
    const split = [
      { ...backfilled[0], id: 'g1c', valid_to: addDays(T, -1) },
      { ...backfilled[0], valid_from: T },
      backfilled[1],
    ];
    const excSplit = [{ template_id: 'g1c', date: exc[0].date }];
    const around = range(addDays(T, -91), addDays(T, 35));
    check('1-2 같은 시각으로 나눈 행 = 나누기 전과 같은 급여(앞뒤 126일)',
      pay(split, excSplit, 'S', around) === pay(backfilled, exc, 'S', around), `${pay(split, excSplit, 'S', around)} vs ${pay(backfilled, exc, 'S', around)}`);
    const bad = range(addDays(T, -21), addDays(T, 21)).filter((d) => dow(d) === 1)
      .filter((d) => split.filter((t) => t.weekday === 1 && applies(t, d)).length !== 1);
    check('1-3 경계 앞뒤 어느 월요일이든 반복 행이 정확히 1건(중복 0 · 빈 날 0)', bad.length === 0, bad.join(','));
  }

  // ═══════ 셋업 ═══════
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA기간사장', 'owner', '1980-01-01');
  const J = await signUp(1, 'QA기간직원J', 'junior', '2000-01-01');
  const K = await signUp(2, 'QA기간직원K', 'junior', '2000-02-02');
  const L = await signUp(3, 'QA기간직원L', 'junior', '2000-03-03');
  const X = await signUp(4, 'QA다른사장', 'owner', '1981-01-01');
  const st = await store(O.c, 'QA기간카페');
  const UNIT = st.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [U, label] of [[J, 'J'], [K, 'K'], [L, 'L']]) {
    const j = await U.c.rpc('join_by_invite', { p_code: st.invite_code });
    if (j.error) throw new Error(`${label} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${label} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  const hasPeriod = psql(`select count(*) from information_schema.columns
                           where table_schema = 'public' and table_name = 'shift_templates' and column_name = 'valid_from'`) === '1';
  console.log(`\n셋업 — 매장 ${UNIT} · 오늘(KST) ${T} · 적용 기간 컬럼 ${hasPeriod ? '있음' : '없음(0242 전)'}`);

  /** 배포 전부터 있던 행처럼 넣는다: service_role 로 넣고, 생성일을 200일 전으로, 기간 컬럼이 있으면 백필 값(2000-01-01)으로 맞춘다. */
  const legacy = async (id, unit, staff, weekday, start, end) => {
    const { error } = await admin.from('shift_templates').insert({ id, unit_id: unit, staff_id: staff, weekday, shift_date: null, start_time: start, end_time: end,
      created_at: new Date(Date.now() - 200 * 864e5).toISOString() });
    if (error) throw new Error(`legacy ${id}: ${error.message}`);
    if (hasPeriod) psql(`update public.shift_templates set valid_from = '2000-01-01' where id = '${id}'`);
  };
  const exception = async (template_id, unit, date) => {
    const { error } = await admin.from('shift_exceptions').insert({ template_id, unit_id: unit, date });
    if (error) throw new Error(`exception ${template_id}@${date}: ${error.message}`);
  };
  const raw = async (unit) => {
    const { data: rows } = await admin.from('shift_templates').select('*').eq('unit_id', unit);
    const { data: exc } = await admin.from('shift_exceptions').select('template_id, date').eq('unit_id', unit);
    return { rows: rows ?? [], exc: exc ?? [] };
  };

  // ═══════ [2] 옛 앱 직접 UPDATE ═══════
  console.log('\n[2] 옛 앱 사장의 반복 근무 직접 UPDATE = 오류 없이 오늘부터만 (H1)');
  const wdT = dow(T);
  const A1 = `qa_sdt_a1_${s}`;
  const excA1 = addDays(T, -7);
  {
    await legacy(A1, UNIT, J.id, wdT, '09:00', '18:00');
    await exception(A1, UNIT, excA1);
    const before = await raw(UNIT);
    const g0 = pay(before.rows, before.exc, J.id, PAST);
    const up = await O.c.from('shift_templates').update({ start_time: '10:00', end_time: '20:00' }).eq('id', A1).select('id');
    check('2-1 옛 앱 경로(update().select) 오류 없음 · 1행', !up.error && up.data?.length === 1, up.error?.message ?? `rows=${up.data?.length}`);
    const after = await raw(UNIT);
    const g1 = pay(after.rows, after.exc, J.id, PAST);
    check('2-2 ★지난 3개월 급여가 그대로다(J1)', g1 === g0 && g0 > 0, `before=${g0} after=${g1}`);
    const orig = after.rows.find((r) => r.id === A1);
    const copy = after.rows.find((r) => r.id !== A1 && r.staff_id === J.id && r.weekday === wdT);
    check('2-3 원래 id 는 오늘부터 새 시각', orig?.valid_from === T && orig?.start_time === '10:00' && orig?.end_time === '20:00',
      JSON.stringify(orig && { vf: orig.valid_from, s: orig.start_time, e: orig.end_time }));
    check('2-4 ★지난 구간은 새 id 복사본(2000-01-01 ~ 어제, 옛 시각)으로 남는다',
      copy?.valid_from === '2000-01-01' && copy?.valid_to === addDays(T, -1) && copy?.start_time === '09:00' && copy?.end_time === '18:00',
      JSON.stringify(copy ?? null));
    check('2-5 ★지난 예외가 복사본으로 옮겨진다', after.exc.some((e) => e.template_id === copy?.id && e.date === excA1),
      JSON.stringify(after.exc.filter((e) => e.date === excA1)));
    const bad = range(addDays(T, -35), addDays(T, 35)).filter((d) => dow(d) === wdT)
      .filter((d) => after.rows.filter((r) => r.staff_id === J.id && r.weekday === wdT && applies(r, d))
        .filter((r) => !after.exc.some((e) => e.template_id === r.id && e.date === d)).length !== (d === excA1 ? 0 : 1));
    check('2-6 ★경계 앞뒤 어느 날이든 정확히 1건(예외 날은 0)', bad.length === 0, bad.join(','));
    const { data: mine } = await J.c.from('shift_templates').select('id, weekday, shift_date').eq('staff_id', J.id);
    check('2-7 직원 직접 select(옛 앱)에는 오늘 적용 중인 행만 보인다(복사본 숨김)',
      (mine ?? []).filter((r) => r.weekday === wdT).length === 1 && (mine ?? []).every((r) => r.id !== copy?.id), JSON.stringify(mine));
    const { data: ownerView } = await O.c.from('shift_templates').select('id').eq('staff_id', J.id);
    check('2-8 사장 직접 select(옛 앱)도 복사본을 안 본다(st_write FOR ALL 제거)',
      (ownerView ?? []).length === 1 && ownerView[0].id === A1, JSON.stringify(ownerView));
    const mcs = await J.c.rpc('my_cross_summary');
    const mShifts = (mcs.data ?? []).find((r) => r.unit_id === UNIT)?.shifts ?? [];
    check('2-9 my_cross_summary(옛 앱)는 오늘 적용 중인 행만', !mcs.error && mShifts.filter((x) => x.weekday === wdT).length === 1,
      mcs.error?.message ?? JSON.stringify(mShifts));
    const oli = await O.c.rpc('owner_labor_inputs');
    const oShifts = (oli.data ?? []).find((r) => r.unit_id === UNIT)?.shifts ?? [];
    check('2-10 owner_labor_inputs(옛 앱)는 오늘 적용 중인 행만', !oli.error && oShifts.filter((x) => x.staff_id === J.id).length === 1,
      oli.error?.message ?? JSON.stringify(oShifts));
    const v2 = await O.c.rpc('owner_labor_inputs_v2');
    const v2Shifts = (v2.data ?? []).find((r) => r.unit_id === UNIT)?.shifts ?? [];
    check('2-11 ★owner_labor_inputs_v2 는 전체 이력과 기간을 준다',
      !v2.error && v2Shifts.filter((x) => x.staff_id === J.id).length === 2 && v2Shifts.some((x) => x.valid_to === addDays(T, -1)),
      v2.error?.message ?? JSON.stringify(v2Shifts));
    if (!v2.error) {
      const v2rows = v2Shifts.map((x) => ({ id: x.id, staff_id: x.staff_id, weekday: x.weekday, shift_date: x.date,
        start_time: x.start, end_time: x.end, valid_from: x.valid_from, valid_to: x.valid_to }));
      const v2exc = ((v2.data ?? []).find((r) => r.unit_id === UNIT)?.exceptions ?? []);
      check('2-12 ★v2 로 다시 계산해도 지난 3개월 급여 = 수정 전', pay(v2rows, v2exc, J.id, PAST) === g0, `${pay(v2rows, v2exc, J.id, PAST)} vs ${g0}`);
    } else check('2-12 ★v2 로 다시 계산해도 지난 3개월 급여 = 수정 전', false, v2.error.message);
    const mv2 = await J.c.rpc('my_cross_summary_v2');
    const mv2Shifts = (mv2.data ?? []).find((r) => r.unit_id === UNIT)?.shifts ?? [];
    check('2-13 my_cross_summary_v2 는 본인 이력 전부(복사본 포함)', !mv2.error && mv2Shifts.some((x) => x.id === copy?.id),
      mv2.error?.message ?? JSON.stringify(mv2Shifts));
  }

  // ═══════ [3] 옛 앱 직접 DELETE ═══════
  console.log('\n[3] 옛 앱 사장의 반복 근무 직접 DELETE = 오류 없이 "오늘부터 그만"');
  const wd2 = (wdT + 1) % 7;
  const A2 = `qa_sdt_a2_${s}`;
  {
    await legacy(A2, UNIT, J.id, wd2, '13:00', '19:00');
    const excDay = addDays(T, -6); // dow = wd2
    await exception(A2, UNIT, excDay);
    const before = await raw(UNIT);
    const g0 = pay(before.rows, before.exc, J.id, PAST);
    const del = await O.c.from('shift_templates').delete().eq('id', A2).select('id');
    check('3-1 옛 앱 경로(delete().select) 오류 없음 · 1행', !del.error && del.data?.length === 1, del.error?.message ?? `rows=${del.data?.length}`);
    const after = await raw(UNIT);
    check('3-2 ★지난 3개월 급여가 그대로다', pay(after.rows, after.exc, J.id, PAST) === g0, `before=${g0} after=${pay(after.rows, after.exc, J.id, PAST)}`);
    const copy = after.rows.find((r) => r.staff_id === J.id && r.weekday === wd2);
    check('3-3 지난 구간 복사본(~어제)이 남고 원래 id 는 지워진다',
      !after.rows.some((r) => r.id === A2) && copy?.valid_to === addDays(T, -1), JSON.stringify(copy ?? null));
    check('3-4 지난 예외가 복사본으로 옮겨진다(cascade 로 사라지지 않는다)', after.exc.some((e) => e.template_id === copy?.id && e.date === excDay));
    const fut = range(T, addDays(T, 13)).filter((d) => dow(d) === wd2)
      .filter((d) => after.rows.some((r) => r.staff_id === J.id && r.weekday === wd2 && applies(r, d)));
    check('3-5 오늘부터는 그 요일 근무가 없다', fut.length === 0, fut.join(','));
  }

  // ═══════ [4] 기간은 RPC 로만 ═══════
  console.log('\n[4] 클라이언트가 적용 기간을 직접 고치지 못한다');
  {
    const r = await O.c.from('shift_templates').update({ valid_from: '2000-01-01' }).eq('id', A1).select('id');
    check('4-1 ★직접 UPDATE 로 valid_from 을 과거로 못 바꾼다', !!r.error && /shift_period_rpc_only/.test(r.error.message), r.error?.message ?? `rows=${r.data?.length}`);
    const r2 = await O.c.from('shift_templates').insert({ id: `qa_sdt_vt_${s}`, unit_id: UNIT, staff_id: J.id, weekday: (wdT + 3) % 7,
      shift_date: null, start_time: '09:00', end_time: '10:00', valid_from: '2000-01-01' });
    check('4-2 ★직접 INSERT 로 지난 시작일을 못 넣는다', !!r2.error && /shift_period_rpc_only/.test(r2.error.message), r2.error?.message ?? 'inserted');
  }

  // ═══════ [5] 첫 반복 근무 시작일 (M1) ═══════
  const J3 = `qa_sdt_j3_${s}`; // [5] 에서 만들고 [7] 맞교환에서 쓴다
  console.log('\n[5] 첫 반복 근무는 매장 합류일부터(데이터 M1)');
  {
    psql(`update public.unit_members set created_at = now() - interval '20 days' where unit_id = '${UNIT}' and user_id = '${K.id}'`);
    const joined = psql(`select ((created_at at time zone 'Asia/Seoul')::date)::text from public.unit_members where unit_id = '${UNIT}' and user_id = '${K.id}'`);
    const K1 = `qa_sdt_k1_${s}`, K2 = `qa_sdt_k2_${s}`;
    const i1 = await O.c.from('shift_templates').insert({ id: K1, unit_id: UNIT, staff_id: K.id, weekday: wdT, shift_date: null, start_time: '09:00', end_time: '13:00' });
    const i2 = await O.c.from('shift_templates').insert({ id: K2, unit_id: UNIT, staff_id: K.id, weekday: wd2, shift_date: null, start_time: '09:00', end_time: '13:00' });
    check('5-0 옛 앱 경로(insert · 근무마다 요청 하나) 오류 없음', !i1.error && !i2.error, i1.error?.message ?? i2.error?.message);
    const { rows } = await raw(UNIT);
    check('5-1 ★첫 반복 행 시작일 = 합류일(KST)', rows.find((r) => r.id === K1)?.valid_from === joined, `${rows.find((r) => r.id === K1)?.valid_from} vs ${joined}`);
    check('5-2 ★같은 날 따로 넣은 두 번째 반복 행도 합류일부터(옛 앱은 근무마다 요청을 따로 보낸다)',
      rows.find((r) => r.id === K2)?.valid_from === joined, `${rows.find((r) => r.id === K2)?.valid_from} vs ${joined}`);
    // 어제 이전에 만든 반복 행이 있는 직원(J)은 새 행이 오늘부터다.
    const i3 = await O.c.from('shift_templates').insert({ id: J3, unit_id: UNIT, staff_id: J.id, weekday: (wdT + 4) % 7, shift_date: null, start_time: '09:00', end_time: '10:00' });
    check('5-3 예전에 만든 반복 행이 있는 직원의 새 행은 오늘부터', !i3.error && (await raw(UNIT)).rows.find((r) => r.id === J3)?.valid_from === T,
      i3.error?.message ?? (await raw(UNIT)).rows.find((r) => r.id === J3)?.valid_from);

    // 같은 날 오타를 고치거나 지우면 그 자리에서 바뀐다(지난 구간 복사본에 잘못 넣은 시각이 남지 않는다).
    const u1 = await O.c.from('shift_templates').update({ end_time: '12:00' }).eq('id', K1).select('id');
    const r5 = (await raw(UNIT)).rows;
    const k1 = r5.find((r) => r.id === K1);
    const k1copy = r5.filter((r) => r.staff_id === K.id && r.weekday === wdT && r.id !== K1);
    check('5-4 ★오늘 만든 행을 오늘 고치면 복사본 없이 합류일부터 새 시각',
      !u1.error && u1.data?.length === 1 && k1copy.length === 0 && k1?.valid_from === joined && k1?.end_time === '12:00',
      u1.error?.message ?? JSON.stringify({ k1, k1copy }));
    const d2 = await O.c.from('shift_templates').delete().eq('id', K2).select('id');
    const left2 = (await raw(UNIT)).rows.filter((r) => r.staff_id === K.id && r.weekday === wd2);
    check('5-5 ★오늘 만든 행을 오늘 지우면 복사본이 남지 않는다', !d2.error && d2.data?.length === 1 && left2.length === 0,
      d2.error?.message ?? JSON.stringify(left2));
    // 오늘 만든 행의 담당자를 바꾸면 새 담당자의 합류일 전으로 거슬러 가지 않는다.
    const K3 = `qa_sdt_k3_${s}`;
    await O.c.from('shift_templates').insert({ id: K3, unit_id: UNIT, staff_id: K.id, weekday: (wdT + 5) % 7, shift_date: null, start_time: '09:00', end_time: '10:00' });
    const u3 = await O.c.from('shift_templates').update({ staff_id: J.id }).eq('id', K3).select('id');
    const k3 = (await raw(UNIT)).rows.find((r) => r.id === K3);
    check('5-6 오늘 만든 행의 담당자를 바꾸면 시작일은 새 담당자 합류일(오늘) 이후', !u3.error && k3?.staff_id === J.id && k3?.valid_from === T,
      u3.error?.message ?? JSON.stringify(k3));
    // 생성일은 직접 못 바꾼다(오늘 만든 행처럼 꾸며 지난 급여를 고치는 길).
    const u4 = await O.c.from('shift_templates').update({ created_at: new Date().toISOString() }).eq('id', A1).select('id');
    check('5-7 ★직접 UPDATE 로 created_at 을 못 바꾼다', !!u4.error && /shift_period_rpc_only/.test(u4.error.message), u4.error?.message ?? `rows=${u4.data?.length}`);
  }

  // ═══════ [6] 새 RPC ═══════
  console.log('\n[6] 새 RPC — 권한 · 지난 날짜 확인 · 다른 매장 거부 · 노출 범위');
  const S1args = { p_staff: L.id, p_weekday: wdT, p_from: addDays(T, 7), p_start: '08:00', p_end: '12:00' };
  let S1 = null, S2 = null;
  {
    const jr = await J.c.rpc('add_shift_series', S1args);
    check('6-1 직원은 add_shift_series 를 못 부른다', !!jr.error, jr.error?.message ?? 'allowed');
    const a = await O.c.rpc('add_shift_series', S1args);
    S1 = a.data;
    check('6-2 사장 add_shift_series(다음 주부터) 성공', !a.error && typeof S1 === 'string', a.error?.message);
    const nm = await O.c.rpc('add_shift_series', { ...S1args, p_staff: X.id });
    check('6-3 매장 멤버가 아닌 사람에게는 못 넣는다', !!nm.error && /staff_not_member/.test(nm.error.message), nm.error?.message ?? 'allowed');
    const past = await O.c.rpc('add_shift_series', { p_staff: L.id, p_weekday: wd2, p_from: addDays(T, -6), p_start: '09:00', p_end: '12:00' });
    check('6-4 ★지난 날짜부터는 p_confirm_past 없이 거부', !!past.error && /confirm_past_required/.test(past.error.message), past.error?.message ?? 'allowed');
    const past2 = await O.c.rpc('add_shift_series', { p_staff: L.id, p_weekday: wd2, p_from: addDays(T, -6), p_start: '09:00', p_end: '12:00', p_confirm_past: true });
    S2 = past2.data;
    check('6-5 p_confirm_past=true 면 허용', !past2.error && typeof S2 === 'string', past2.error?.message);
    const bad = await O.c.rpc('add_shift_series', { ...S1args, p_start: '09:00', p_end: '09:00' });
    check('6-6 0분 근무 거부', !!bad.error, bad.error?.message ?? 'allowed');

    const { data: lMine } = await L.c.from('shift_templates').select('id').eq('staff_id', L.id);
    check('6-7 미래 시작 행은 옛 앱 select 에 안 보인다', !(lMine ?? []).some((r) => r.id === S1), JSON.stringify(lMine));
    const allL = await L.c.rpc('shift_templates_all');
    check('6-8 shift_templates_all: 본인 미래 행이 보인다', !allL.error && (allL.data ?? []).some((r) => r.id === S1), allL.error?.message);
    const allK = await K.c.rpc('shift_templates_all');
    const { rows: nowRows } = await raw(UNIT);
    const jCopy = nowRows.find((r) => r.staff_id === J.id && r.weekday === wdT && r.id !== A1);
    check('6-9 ★shift_templates_all: 동료의 지난 이력(닫힌 복사본)은 안 보인다(보안 M6)',
      !allK.error && !(allK.data ?? []).some((r) => r.id === jCopy?.id), allK.error?.message ?? `copy=${jCopy?.id}`);
    check('6-10 shift_templates_all: 지금 동료의 오늘 이후 행은 보인다', !allK.error && (allK.data ?? []).some((r) => r.id === S1), allK.error?.message);
    const allO = await O.c.rpc('shift_templates_all');
    check('6-11 shift_templates_all: 관리자는 전부 본다', !allO.error && (allO.data ?? []).some((r) => r.id === jCopy?.id), allO.error?.message);

    const e = await O.c.rpc('edit_shift_from', { p_id: S1, p_from: addDays(T, 14), p_start: '09:00', p_end: '13:00' });
    const r1 = (await raw(UNIT)).rows;
    const s1 = r1.find((r) => r.id === S1), s1c = r1.find((r) => r.staff_id === L.id && r.weekday === wdT && r.id !== S1);
    check('6-12 edit_shift_from: 원래 id 는 그날부터 새 시각, 앞 구간은 복사본',
      !e.error && s1?.valid_from === addDays(T, 14) && s1?.start_time === '09:00'
      && s1c?.valid_from === addDays(T, 7) && s1c?.valid_to === addDays(T, 13) && s1c?.start_time === '08:00',
      e.error?.message ?? JSON.stringify({ s1, s1c }));
    const en = await O.c.rpc('end_shift_from', { p_id: S1, p_from: addDays(T, 21) });
    const s1b = (await raw(UNIT)).rows.find((r) => r.id === S1);
    check('6-13 end_shift_from: 그 전날로 닫는다', !en.error && s1b?.valid_to === addDays(T, 20), en.error?.message ?? JSON.stringify(s1b));
    const T1 = addDays(T, 1); // dow = wd2 = S2 요일
    const ov = await O.c.rpc('override_shift_day', { p_id: S2, p_date: T1, p_start: '14:00', p_end: '15:00' });
    const after = await raw(UNIT);
    check('6-14 override_shift_day: 그날만 예외 + 날짜 지정 행',
      !ov.error && after.exc.some((x) => x.template_id === S2 && x.date === T1)
      && after.rows.some((r) => r.staff_id === L.id && r.shift_date === T1 && r.start_time === '14:00'),
      ov.error?.message ?? 'no rows');
    const ovp = await O.c.rpc('override_shift_day', { p_id: S2, p_date: addDays(T, -6), p_start: '10:00', p_end: '11:00' });
    check('6-15 override_shift_day 지난 날짜는 p_confirm_past 없이 거부', !!ovp.error && /confirm_past_required/.test(ovp.error.message), ovp.error?.message ?? 'allowed');

    // 다른 매장(IDOR)
    const sx = await store(X.c, 'QA다른카페');
    await X.c.rpc('switch_active_unit', { p_unit_id: sx.unit_id });
    for (const [fn, args] of [['edit_shift_from', { p_id: S2, p_from: addDays(T, 8), p_start: '09:00', p_end: '10:00' }],
                              ['end_shift_from', { p_id: S2, p_from: addDays(T, 8) }],
                              ['override_shift_day', { p_id: S2, p_date: addDays(T, 8), p_start: '09:00', p_end: '10:00' }],
                              ['add_shift_series', { ...S1args, p_staff: L.id }]]) {
      const r = await X.c.rpc(fn, args);
      check(`6-16 ★다른 매장 사장의 ${fn} 거부`, !!r.error, r.error?.message ?? 'allowed');
    }
    // 권한표
    const sig = {
      add_shift_series: 'text, integer, date, text, text, boolean', edit_shift_from: 'text, date, text, text, boolean',
      end_shift_from: 'text, date, boolean', override_shift_day: 'text, date, text, text, boolean', shift_templates_all: '',
      my_cross_summary_v2: '', owner_labor_inputs_v2: '', approve_swap: 'text, boolean',
    };
    for (const [fn, args] of Object.entries(sig)) {
      const v = psql(`select has_function_privilege('anon', 'public.${fn}(${args})', 'execute')::text || has_function_privilege('authenticated', 'public.${fn}(${args})', 'execute')::text`);
      check(`6-17 ${fn}: anon 불가 · authenticated 가능`, v === 'falsetrue', v);
    }
    for (const fn of ['copy_past_segment(text, date)', 'split_shift_at(text, date)', 'end_staff_tenure(text, text)']) {
      const v = psql(`select has_function_privilege('anon', 'public.${fn}', 'execute')::text || has_function_privilege('authenticated', 'public.${fn}', 'execute')::text`);
      check(`6-18 ★내부 헬퍼 ${fn}: anon·authenticated 모두 불가(L5)`, v === 'falsefalse', v);
    }
    const kt = psql(`select has_function_privilege('authenticated', 'public.kst_today()', 'execute')::text || has_function_privilege('anon', 'public.kst_today()', 'execute')::text`);
    check('6-19 kst_today: RLS 안에서 쓰므로 authenticated·anon 실행 가능(보안 M1)', kt === 'truetrue', kt);
  }

  // ═══════ [7] approve_swap ═══════
  console.log('\n[7] approve_swap — 지난 근무 확인 · 35일 · 그날 적용 여부');
  {
    const wd3 = dow(addDays(T, -3));
    const A3 = `qa_sdt_a3_${s}`;
    await legacy(A3, UNIT, K.id, wd3, '09:00', '18:00');
    const sw = async (id, tpl, requester, date) => {
      const { error } = await admin.from('swap_requests').insert({ id, unit_id: UNIT, kind: 'cover', requester_id: requester, date,
        template_id: tpl, status: 'accepted', accepted_by: L.id, note: '' });
      if (error) throw new Error(`swap ${id}: ${error.message}`);
    };
    const SW1 = `qa_sdt_sw1_${s}`, SW2 = `qa_sdt_sw2_${s}`, SW3 = `qa_sdt_sw3_${s}`;
    await sw(SW1, A3, K.id, addDays(T, -3));
    const r1 = await O.c.rpc('approve_swap', { p_id: SW1 });
    const exc1 = (await raw(UNIT)).exc.some((e) => e.template_id === A3 && e.date === addDays(T, -3));
    check('7-1 ★지난 근무 교대는 p_confirm_past 없이 승인되지 않는다(Q4)', r1.data !== true && !exc1, r1.error?.message ?? `data=${r1.data}`);
    const r2 = await O.c.rpc('approve_swap', { p_id: SW1, p_confirm_past: true });
    check('7-2 p_confirm_past=true 면 승인되고 근무가 넘어간다', !r2.error && r2.data === true
      && (await raw(UNIT)).rows.some((r) => r.staff_id === L.id && r.shift_date === addDays(T, -3)), r2.error?.message ?? `data=${r2.data}`);
    // 35일 넘은 근무: J 의 wdT 반복(지난 구간 행)에 42일 전 날짜
    const { rows } = await raw(UNIT);
    const old = rows.find((r) => r.staff_id === J.id && r.weekday === wdT && applies(r, addDays(T, -42)));
    await sw(SW2, old.id, J.id, addDays(T, -42));
    const r3 = await O.c.rpc('approve_swap', { p_id: SW2, p_confirm_past: true });
    check('7-3 ★35일이 넘은 근무는 확인해도 승인 안 된다(Q10 · 서버가 false)', !r3.error && r3.data === false, r3.error?.message ?? `data=${r3.data}`);
    // 그날 적용되지 않는 근무(요일이 다르다)
    const T1 = addDays(T, 1); // dow(T+1) ≠ wd3(=dow(T+4))
    await sw(SW3, A3, K.id, T1);
    const r4 = await O.c.rpc('approve_swap', { p_id: SW3 });
    const leaked = (await raw(UNIT)).rows.some((r) => r.staff_id === L.id && r.shift_date === T1 && r.start_time === '09:00');
    check('7-4 ★그날 적용되지 않는 반복 근무는 넘기지 않는다(transfer_shift 적용 여부)', r4.data !== true && !leaked, r4.error?.message ?? `data=${r4.data}`);

    // 다른 매장 근무를 가리키는 교대 요청(옛 앱 직접 INSERT 는 template_id 의 매장을 보지 않는다)
    const SXU7 = units.find((u) => u !== UNIT);
    const F1 = `qa_sdt_f1_${s}`, F2 = `qa_sdt_f2_${s}`;
    const fIns = await admin.from('shift_templates').insert({ id: F1, unit_id: SXU7, staff_id: X.id, weekday: null, shift_date: addDays(T, 2),
      start_time: '09:00', end_time: '18:00' });
    if (fIns.error) throw new Error('F1: ' + fIns.error.message);
    await legacy(F2, SXU7, X.id, dow(addDays(T, 3)), '09:00', '18:00');
    const foreignSnap = async () => JSON.stringify([
      (await admin.from('shift_templates').select('id, staff_id, start_time, end_time, valid_from, valid_to').eq('unit_id', SXU7).order('id')).data,
      (await admin.from('shift_exceptions').select('template_id, date').eq('unit_id', SXU7).order('date')).data,
    ]);
    const before7 = await foreignSnap();
    const FS1 = `qa_sdt_fs1_${s}`, FS2 = `qa_sdt_fs2_${s}`, FS3 = `qa_sdt_fs3_${s}`;
    const ins1 = await J.c.from('swap_requests').insert({ id: FS1, unit_id: UNIT, kind: 'cover', requester_id: J.id, date: addDays(T, 2), template_id: F1, note: '' });
    const ins2 = await J.c.from('swap_requests').insert({ id: FS2, unit_id: UNIT, kind: 'cover', requester_id: J.id, date: addDays(T, 10), template_id: F2, note: '' });
    const ins3 = await J.c.from('swap_requests').insert({ id: FS3, unit_id: UNIT, kind: 'swap', requester_id: J.id, date: addDays(T, 4), template_id: J3,
      target_staff_id: X.id, target_date: addDays(T, 3), target_template_id: F2, note: '' });
    if (ins1.error || ins2.error || ins3.error) throw new Error('foreign swap insert: ' + (ins1.error ?? ins2.error ?? ins3.error).message);
    await admin.from('swap_requests').update({ status: 'accepted', accepted_by: L.id }).in('id', [FS1, FS2]);
    await admin.from('swap_requests').update({ status: 'accepted', accepted_by: X.id }).eq('id', FS3);
    // 맞교환을 먼저: 상대 근무(F2)가 아직 그날 서 있어야 두 번째 이전이 성공하는지까지 본다.
    const f3 = await O.c.rpc('approve_swap', { p_id: FS3 });
    const f1 = await O.c.rpc('approve_swap', { p_id: FS1 });
    const f2 = await O.c.rpc('approve_swap', { p_id: FS2 });
    const after7 = await foreignSnap();
    check('7-5 ★다른 매장 날짜 지정 근무를 가리키는 교대는 승인 안 된다', f1.data !== true, f1.error?.message ?? `data=${f1.data}`);
    check('7-6 ★다른 매장 반복 근무를 가리키는 교대는 승인 안 된다', f2.data !== true, f2.error?.message ?? `data=${f2.data}`);
    check('7-7 ★상대 근무가 다른 매장인 맞교환은 승인 안 되고 내 근무도 안 넘어간다',
      f3.data !== true && !(await raw(UNIT)).exc.some((e) => e.template_id === J3), f3.error?.message ?? `data=${f3.data}`);
    check('7-8 ★다른 매장 근무표·예외가 1건도 안 바뀐다', after7 === before7, `${before7} → ${after7}`);
  }

  // ═══════ [8] end_staff_tenure ═══════
  console.log('\n[8] end_staff_tenure(내부) — 반복은 오늘로 닫고 미래만 지운다');
  {
    const before = (await raw(UNIT)).rows.filter((r) => r.staff_id === L.id);
    const r = psql(`select public.end_staff_tenure('${UNIT}', '${L.id}')`);
    const after = (await raw(UNIT)).rows.filter((x) => x.staff_id === L.id);
    check('8-1 실행 성공', !r.startsWith('psql 오류'), r);
    check('8-2 ★지금 적용 중인 반복 행은 valid_to = 오늘', after.find((x) => x.id === S2)?.valid_to === T, JSON.stringify(after.find((x) => x.id === S2) ?? null));
    check('8-3 미래에만 있던 반복 행(시작일 > 오늘)은 지운다', !after.some((x) => !x.shift_date && x.valid_from > T),
      JSON.stringify(after.filter((x) => !x.shift_date && x.valid_from > T)));
    check('8-4 오늘 이후 날짜 지정 행은 지운다', !after.some((x) => x.shift_date && x.shift_date > T));
    check('8-5 ★지난 날짜 지정 행은 남긴다(마지막 급여 근거)', after.some((x) => x.shift_date === addDays(T, -3)),
      `before=${before.length} after=${after.length}`);
  }

  // ═══════ [9] cascade · 정의자 경로 ═══════
  console.log('\n[9] 지난 반복 근무가 있어도 매장 삭제 · 나가기 · 탈퇴 · 파기가 성공한다(위험 §10-2)');
  {
    // delete_store: 두 번째 매장(직원 없음)에 지난 반복 근무 + 예외 + 교대 기록
    await admin.from('store_slots').insert({ owner_id: O.id, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() });
    const sb = await store(O.c, 'QA지울카페');
    const B1 = `qa_sdt_b1_${s}`;
    await legacy(B1, sb.unit_id, J.id, wdT, '09:00', '18:00');
    await exception(B1, sb.unit_id, addDays(T, -7));
    await admin.from('swap_requests').insert({ id: `qa_sdt_bsw_${s}`, unit_id: sb.unit_id, kind: 'cover', requester_id: J.id,
      date: addDays(T, -14), template_id: B1, status: 'approved', accepted_by: K.id, note: '' });
    const d = await O.c.rpc('delete_store', { p_unit_id: sb.unit_id });
    const left = (await admin.from('shift_templates').select('id').eq('unit_id', sb.unit_id)).data ?? [];
    check('9-1 ★delete_store 성공 + 근무표 cascade 정리', !d.error && left.length === 0, d.error?.message ?? `left=${left.length}`);

    const lv = await K.c.rpc('leave_store');
    check('9-2 ★직원 leave_store 성공(지난 반복 근무 있음)', !lv.error, lv.error?.message);
    const dm = await L.c.rpc('delete_my_account');
    check('9-3 ★직원 delete_my_account 성공', !dm.error, dm.error?.message);

    // purge_deleted_accounts: 다른 사장 X 의 매장에 지난 반복 근무 → X 탈퇴 → 31일 전으로 → 파기
    const SXU = units.find((u) => u !== UNIT && u !== sb.unit_id);
    const X1 = `qa_sdt_x1_${s}`;
    await legacy(X1, SXU, X.id, wdT, '09:00', '18:00');
    await exception(X1, SXU, addDays(T, -7));
    const xd = await X.c.rpc('delete_my_account');
    if (xd.error) throw new Error('X delete_my_account: ' + xd.error.message);
    psql(`update public.units set deleted_at = now() - interval '31 days' where id = '${SXU}'`);
    psql(`update public.profiles set deleted_at = now() - interval '31 days' where id = '${X.id}'`);
    const pr = psql('select public.purge_deleted_accounts()');
    const gone = psql(`select count(*) from public.units where id = '${SXU}'`) + '/' + psql(`select count(*) from public.shift_templates where unit_id = '${SXU}'`);
    check('9-4 ★purge_deleted_accounts 성공 + 매장·근무표 파기', !pr.startsWith('psql 오류') && gone === '0/0', `${pr} · ${gone}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail ? 1 : 0);
