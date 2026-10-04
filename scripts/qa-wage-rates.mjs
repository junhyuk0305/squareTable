#!/usr/bin/env node
// qa-wage-rates.mjs — 0244 시급 이력(wage_rates · J1-b) · 로컬 도커 전용
//
// 사용자 결정(J1): 과거는 그대로, 앞으로만 적용한다. 시급은 "{날짜}부터 얼마"다.
// 사용자 결정(§8 Q4): 지난 날짜부터 바꾸면 그 기간 급여가 바뀐다 → 서버는 p_confirm_past 를 요구한다.
// 무엇을 못박나:
//   [1] 표 · 채우기 · 기본값: wage_rates 가 있고, 지금 wages 값이 오늘 시급과 같다. wages.hourly_wage 기본값(10030)이 없다.
//   [2] 옛 앱 경로(wages 직접 upsert): 처음이면 2000-01-01 부터, 이력이 있으면 오늘부터 쌓인다.
//       10월에 시급을 올려도 9월 시급(이력)은 그대로다. 같은 값을 다시 저장하면 행이 늘지 않는다.
//   [3] set_wage_from: 사장만(매니저·직원 불가) · 활성 매장 멤버만(다른 매장 직원 id 거부 · IDOR) · 금액·날짜 형식 ·
//       지난 날짜는 p_confirm_past 필수 · 오늘 이하이면 wages 거울을 오늘 시급으로 맞춘다 · 미래 날짜는 wages 를 안 바꾼다.
//   [4] RLS: 관리자는 매장 전부, 직원은 본인 행만, 다른 매장은 0건. 클라이언트 직접 쓰기는 안 된다.
//   [5] 일일 맞춤(sync_wages_from_rates): 미리 정해 둔 시급이 시작되는 날 wages 를 맞춘다. 지금 멤버만.
//   [6] 권한 · 표 권한 · 크론.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시키고 지운다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-wage-rates.mjs   자가정리(계정·매장·OTP 시드).
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
const T = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 오늘(KST)

const phones = ['0121', '0122', '0123', '0124', '0125', '0126'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const email = `qa_wr_${i}_${s}@example.com`;
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
/** 그 직원의 이력(날짜 오름차순) "YYYY-MM-DD=금액,..." · 표가 없으면 psql 오류 문자열. */
const hist = (unit, staff) => psql(`select coalesce(string_agg(effective_from::text || '=' || hourly_wage, ',' order by effective_from), '')
                                      from public.wage_rates where unit_id = '${unit}' and staff_id = '${staff}'`);
const wageOf = (unit, staff) => psql(`select coalesce((select hourly_wage::text from public.wages where unit_id = '${unit}' and staff_id = '${staff}'), 'none')`);

try {
  // ═══════ [1] 표 · 채우기 · 기본값 (계정을 만들기 전에 지금 DB 로 본다) ═══════
  console.log('[1] 표 · 채우기 · 기본값');
  {
    const t = psql(`select to_regclass('public.wage_rates') is not null`);
    check('1-1 wage_rates 표가 있다', t === 't', t);
    const off = psql(`select count(*) from public.wages w
                       where w.hourly_wage is distinct from (select r.hourly_wage from public.wage_rates r
                                                              where r.unit_id = w.unit_id and r.staff_id = w.staff_id
                                                                and r.effective_from <= public.kst_today()
                                                              order by r.effective_from desc limit 1)`);
    check('1-2 지금 wages 값이 모두 오늘 시급(이력)과 같다(채우기)', off === '0', off);
    const d = psql(`select coalesce(column_default, 'null') from information_schema.columns
                     where table_schema = 'public' and table_name = 'wages' and column_name = 'hourly_wage'`);
    check('1-3 wages.hourly_wage 기본값(10030)이 없다', d === 'null', d);
  }

  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA시급사장', 'owner', '1980-01-01');
  const J = await signUp(1, 'QA시급직원J', 'junior', '2000-01-01');
  const K = await signUp(2, 'QA시급직원K', 'junior', '2000-02-02');
  const M = await signUp(3, 'QA시급매니저', 'junior', '1995-04-04');
  const X = await signUp(4, 'QA다른사장', 'owner', '1981-01-01');
  const Y = await signUp(5, 'QA다른직원', 'junior', '2001-01-01');
  const st = await store(O.c, 'QA시급카페');
  const UNIT = st.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [U, label] of [[J, 'J'], [K, 'K'], [M, 'M']]) {
    const j = await U.c.rpc('join_by_invite', { p_code: st.invite_code });
    if (j.error) throw new Error(`${label} join_by_invite: ${j.error.message}`);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${label} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  const pr = await O.c.rpc('set_member_role', { p_uid: M.id, p_role: 'manager' });
  if (pr.error) throw new Error('set_member_role: ' + pr.error.message);
  const sx = await store(X.c, 'QA다른시급카페');
  await admin.rpc('admin_activate_store', { p_unit_id: sx.unit_id, p_days: 1, p_plan: 'multi' });
  await X.c.rpc('switch_active_unit', { p_unit_id: sx.unit_id });
  {
    const j = await Y.c.rpc('join_by_invite', { p_code: sx.invite_code });
    if (j.error) throw new Error(`Y join_by_invite: ${j.error.message}`);
    const a = await X.c.rpc('approve_member', { p_uid: Y.id });
    if (a.error) throw new Error(`Y approve_member: ${a.error.message}`);
    await Y.c.rpc('switch_active_unit', { p_unit_id: sx.unit_id });
  }
  console.log(`셋업 — 매장 ${UNIT} · 오늘(KST) ${T}`);

  // ═══════ [2] 옛 앱 경로 — wages 직접 upsert ═══════
  console.log('\n[2] 옛 앱 경로(wages 직접 upsert)는 처음이면 처음부터, 이후는 오늘부터 쌓인다');
  {
    const w1 = await O.c.from('wages').upsert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 10030 }).select('staff_id');
    check('2-1 옛 앱 사장 첫 시급 저장이 된다', !w1.error && w1.data?.length === 1, w1.error?.message);
    const h1 = hist(UNIT, J.id);
    check('2-2 ★첫 시급은 2000-01-01 부터(근무 기간 처음부터)', h1 === '2000-01-01=10030', h1);
    const w2 = await O.c.from('wages').upsert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 11000 }).select('staff_id');
    check('2-3 옛 앱 사장 시급 변경이 된다', !w2.error && w2.data?.length === 1, w2.error?.message);
    const h2 = hist(UNIT, J.id);
    check('2-4 ★바꾼 시급은 오늘부터 · 지난 시급(2000-01-01=10030)은 그대로', h2 === `2000-01-01=10030,${T}=11000`, h2);
    const w3 = await O.c.from('wages').upsert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 11000 }).select('staff_id');
    const h3 = hist(UNIT, J.id);
    check('2-5 같은 값을 다시 저장하면 이력이 늘지 않는다', !w3.error && h3 === h2, w3.error?.message ?? h3);
    const w4 = await O.c.from('wages').upsert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 11500 }).select('staff_id');
    const h4 = hist(UNIT, J.id);
    check('2-6 오늘 두 번 바꾸면 오늘 행 하나가 고쳐진다', !w4.error && h4 === `2000-01-01=10030,${T}=11500`, w4.error?.message ?? h4);
    const wm = await M.c.from('wages').upsert({ unit_id: UNIT, staff_id: K.id, hourly_wage: 20000 }).select('staff_id');
    check('2-7 매니저의 wages 직접 쓰기는 여전히 0행(0201)', (wm.data?.length ?? 0) === 0 && hist(UNIT, K.id) === '', wm.error?.message ?? hist(UNIT, K.id));
  }

  // ═══════ [3] set_wage_from ═══════
  console.log('\n[3] set_wage_from — 사장만 · 멤버만 · 지난 날짜는 확인 · 오늘 이하이면 wages 거울');
  {
    const call = (U, p) => U.c.rpc('set_wage_from', { p_confirm_past: false, ...p });
    const em = await call(M, { p_staff: K.id, p_wage: 12000, p_from: T });
    check('3-1 매니저는 거부(owner_only)', /owner_only/.test(em.error?.message ?? ''), em.error?.message ?? 'no error');
    const ej = await call(J, { p_staff: J.id, p_wage: 30000, p_from: T });
    check('3-2 직원 본인도 거부(owner_only)', /owner_only/.test(ej.error?.message ?? ''), ej.error?.message ?? 'no error');
    const ex = await call(X, { p_staff: J.id, p_wage: 12000, p_from: T });
    check('3-3 ★다른 매장 사장이 이 매장 직원 id 로 부르면 거부(not_member · IDOR)', /not_member/.test(ex.error?.message ?? '') && hist(UNIT, J.id).indexOf('12000') < 0,
      ex.error?.message ?? 'no error');
    const ey = await call(O, { p_staff: Y.id, p_wage: 12000, p_from: T });
    check('3-4 ★다른 매장 직원 id 는 거부(not_member)', /not_member/.test(ey.error?.message ?? '') && hist(sx.unit_id, Y.id) === '' && hist(UNIT, Y.id) === '',
      ey.error?.message ?? 'no error');
    for (const [n, w] of [['음수', -1], ['상한 초과', 1000001], ['null', null]]) {
      const e = await call(O, { p_staff: K.id, p_wage: w, p_from: T });
      check(`3-5 금액 ${n} 거부(invalid_wage)`, /invalid_wage/.test(e.error?.message ?? ''), e.error?.message ?? 'no error');
    }
    for (const [n, d] of [['null', null], ['2000-01-01 이전', '1999-12-31']]) {
      const e = await call(O, { p_staff: K.id, p_wage: 12000, p_from: d });
      check(`3-6 날짜 ${n} 거부(invalid_date)`, /invalid_date/.test(e.error?.message ?? ''), e.error?.message ?? 'no error');
    }

    // 미래: wages 는 안 바뀐다
    const f = await call(O, { p_staff: K.id, p_wage: 13000, p_from: addDays(T, 5) });
    check('3-7 미래 날짜부터는 확인 없이 된다', !f.error, f.error?.message);
    check('3-8 ★미래 시급은 wages(옛 앱 표시)를 아직 안 바꾼다', wageOf(UNIT, K.id) === 'none' && hist(UNIT, K.id) === `${addDays(T, 5)}=13000`,
      `${wageOf(UNIT, K.id)} / ${hist(UNIT, K.id)}`);

    // 지난 날짜: 확인 필수
    const p0 = await call(O, { p_staff: K.id, p_wage: 10500, p_from: addDays(T, -10) });
    check('3-9 ★지난 날짜부터는 p_confirm_past 없이 거부(confirm_past_required · Q4)', /confirm_past_required/.test(p0.error?.message ?? '')
      && hist(UNIT, K.id) === `${addDays(T, 5)}=13000`, p0.error?.message ?? 'no error');
    const p1 = await call(O, { p_staff: K.id, p_wage: 10500, p_from: addDays(T, -10), p_confirm_past: true });
    check('3-10 지난 날짜부터 + 확인이면 된다', !p1.error && hist(UNIT, K.id) === `${addDays(T, -10)}=10500,${addDays(T, 5)}=13000`,
      p1.error?.message ?? hist(UNIT, K.id));
    check('3-11 ★지난 날짜부터 정하면 wages 거울이 오늘 시급(10500)이 된다', wageOf(UNIT, K.id) === '10500', wageOf(UNIT, K.id));
    check('3-12 거울 갱신이 옛 앱 트리거로 오늘 행을 하나 더 만들지 않는다', hist(UNIT, K.id) === `${addDays(T, -10)}=10500,${addDays(T, 5)}=13000`, hist(UNIT, K.id));

    // J: 오늘 행(11500)이 있는데 더 지난 날짜(10일 전)를 정하면 오늘 시급은 그대로
    const p2 = await call(O, { p_staff: J.id, p_wage: 10800, p_from: addDays(T, -10), p_confirm_past: true });
    check('3-13 ★오늘 행보다 앞선 날짜를 넣어도 오늘 시급(wages 11500)은 그대로', !p2.error && wageOf(UNIT, J.id) === '11500'
      && hist(UNIT, J.id) === `2000-01-01=10030,${addDays(T, -10)}=10800,${T}=11500`, p2.error?.message ?? `${wageOf(UNIT, J.id)} / ${hist(UNIT, J.id)}`);

    // 오늘: wages 가 바로 바뀐다
    const p3 = await call(O, { p_staff: J.id, p_wage: 12000, p_from: T });
    check('3-14 ★오늘부터 정하면 wages 가 바로 바뀌고 오늘 행이 고쳐진다', !p3.error && wageOf(UNIT, J.id) === '12000'
      && hist(UNIT, J.id) === `2000-01-01=10030,${addDays(T, -10)}=10800,${T}=12000`, p3.error?.message ?? `${wageOf(UNIT, J.id)} / ${hist(UNIT, J.id)}`);
    const by = psql(`select coalesce(created_by::text, 'null') from public.wage_rates where unit_id = '${UNIT}' and staff_id = '${J.id}' and effective_from = '${T}'`);
    check('3-15 누가 정했는지(created_by = 사장) 남는다', by === O.id, by);

    // 사장 본인도 멤버다
    const po = await call(O, { p_staff: O.id, p_wage: 15000, p_from: T });
    check('3-16 사장 본인(멤버)의 시급도 정할 수 있다', !po.error && wageOf(UNIT, O.id) === '15000', po.error?.message ?? wageOf(UNIT, O.id));
  }

  // ═══════ [4] RLS ═══════
  console.log('\n[4] RLS — 관리자는 전부, 직원은 본인만, 다른 매장 0건, 직접 쓰기 불가');
  {
    const ids = (r) => [...new Set((r.data ?? []).map((x) => x.staff_id))].sort().join(',');
    const rj = await J.c.from('wage_rates').select('staff_id').eq('unit_id', UNIT);
    check('4-1 직원 J 는 본인 행만 본다', !rj.error && ids(rj) === J.id, rj.error?.message ?? ids(rj));
    const rk = await K.c.from('wage_rates').select('staff_id').eq('staff_id', J.id);
    check('4-2 ★동료 K 는 J 의 시급 이력을 0건 본다', !rk.error && (rk.data?.length ?? 0) === 0, rk.error?.message ?? JSON.stringify(rk.data));
    const rm = await M.c.from('wage_rates').select('staff_id').eq('unit_id', UNIT);
    check('4-3 매니저는 매장 전부를 본다(wages_read 와 같다)', !rm.error && ids(rm) === [J.id, K.id, O.id].sort().join(','), rm.error?.message ?? ids(rm));
    const rx = await X.c.from('wage_rates').select('staff_id').eq('unit_id', UNIT);
    check('4-4 ★다른 매장 사장은 0건', !rx.error && (rx.data?.length ?? 0) === 0, rx.error?.message ?? JSON.stringify(rx.data));
    const ri = await O.c.from('wage_rates').insert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 50000, effective_from: '2001-01-01' }).select('staff_id');
    check('4-5 ★사장도 직접 INSERT 는 안 된다(RPC 로만)', !!ri.error && !hist(UNIT, J.id).includes('50000'), ri.error?.message ?? 'no error');
    const ru = await O.c.from('wage_rates').update({ hourly_wage: 50000 }).eq('unit_id', UNIT).select('staff_id');
    check('4-6 ★사장도 직접 UPDATE 는 안 된다', (!!ru.error || (ru.data?.length ?? 0) === 0) && !hist(UNIT, J.id).includes('50000'), ru.error?.message ?? JSON.stringify(ru.data));
    const rd = await O.c.from('wage_rates').delete().eq('unit_id', UNIT).select('staff_id');
    check('4-7 ★사장도 직접 DELETE 는 안 된다(지난 급여 근거)', (!!rd.error || (rd.data?.length ?? 0) === 0) && hist(UNIT, J.id).startsWith('2000-01-01=10030'),
      rd.error?.message ?? JSON.stringify(rd.data));
  }

  // ═══════ [5] 일일 맞춤 ═══════
  console.log('\n[5] 일일 맞춤 — 미리 정한 시급이 시작되는 날 wages 를 맞춘다(지금 멤버만)');
  {
    // K 의 미래 시급(T+5=13000)을 "오늘 시작"으로 당긴 상황을 만든다(이틀 전에 정해 둔 것처럼).
    psql(`update public.wage_rates set effective_from = '${T}', created_at = now() - interval '2 days'
           where unit_id = '${UNIT}' and staff_id = '${K.id}' and effective_from = '${addDays(T, 5)}'`);
    // 지금 멤버가 아닌 사람(나간 직원 흉내)의 미리 정한 시급
    const ghost = '00000000-0000-4000-8000-' + s.padStart(12, '0');
    psql(`insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_at)
           values ('${UNIT}', '${ghost}', 14000, '${T}', now() - interval '2 days')`);
    const n = psql(`select public.sync_wages_from_rates()`);
    check('5-1 sync_wages_from_rates 가 돈다', /^\d+$/.test(n), n);
    check('5-2 ★시작일이 된 미리 정한 시급이 wages 에 들어간다(K 13000)', wageOf(UNIT, K.id) === '13000', wageOf(UNIT, K.id));
    check('5-3 ★지금 멤버가 아닌 사람의 wages 는 만들지 않는다(데이터 검토 — 퇴사자 되살리기 금지)', wageOf(UNIT, ghost) === 'none', wageOf(UNIT, ghost));
    check('5-4 다른 사람 wages 는 그대로(J 12000)', wageOf(UNIT, J.id) === '12000', wageOf(UNIT, J.id));
    const n2 = psql(`select public.sync_wages_from_rates()`);
    check('5-5 다시 돌리면 바뀌는 행이 없다(0)', n2 === '0', n2);
    psql(`delete from public.wage_rates where staff_id = '${ghost}'`);
  }

  // ═══════ [6] 권한 · 표 · 크론 ═══════
  console.log('\n[6] 권한 · 표 권한 · 크론');
  {
    const fx = (fn, role) => psql(`select has_function_privilege('${role}', '${fn}', 'execute')::text`);
    const sw = 'public.set_wage_from(text, integer, date, boolean)';
    check('6-1 set_wage_from: anon 불가 · authenticated 가능', fx(sw, 'anon') + fx(sw, 'authenticated') === 'falsetrue', fx(sw, 'anon') + fx(sw, 'authenticated'));
    const sy = 'public.sync_wages_from_rates()';
    check('6-2 sync_wages_from_rates: anon·authenticated 불가 · service_role 가능',
      fx(sy, 'anon') + fx(sy, 'authenticated') + fx(sy, 'service_role') === 'falsefalsetrue', fx(sy, 'anon') + fx(sy, 'authenticated') + fx(sy, 'service_role'));
    const rls = psql(`select relrowsecurity::text from pg_class where oid = to_regclass('public.wage_rates')`);
    check('6-3 RLS 켜짐', rls === 'true', rls);
    const w = psql(`select has_table_privilege('anon', 'public.wage_rates', 'SELECT,INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.wage_rates', 'INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.wage_rates', 'SELECT')::text`);
    check('6-4 anon 권한 없음 · authenticated 쓰기 없음 · 읽기만', w === 'false/false/true', w);
    const pol = psql(`select count(*)::text || '/' || count(*) filter (where cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename = 'wage_rates'`);
    check('6-5 정책은 읽기 하나뿐(쓰기 정책 없음)', pol === '1/1', pol);
    const tg = psql(`select count(*) from pg_trigger where tgrelid = 'public.wages'::regclass and not tgisinternal`);
    check('6-6 wages 에 옛 앱 경로 트리거가 있다', tg === '1', tg);
    const hasCron = psql(`select count(*) from pg_extension where extname = 'pg_cron'`) === '1';
    const cron = hasCron ? psql(`select count(*) from cron.job where jobname = 'sync-wage-rates'`) : 'no_pg_cron';
    check('6-7 크론: pg_cron 이 있으면 sync-wage-rates 가 1개(로컬은 pg_cron 이 없어 건너뜀)', cron === 'no_pg_cron' || cron === '1', cron);
    if (cron === 'no_pg_cron') console.log('    (참고) 로컬에 pg_cron 이 없다 — 라이브 적용 뒤 cron.job 에 sync-wage-rates 가 있는지 본다');
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
