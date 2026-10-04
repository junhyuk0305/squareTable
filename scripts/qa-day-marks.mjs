#!/usr/bin/env node
// qa-day-marks.mjs — 0245 결근 표시 shift_day_marks (J1-c · §8 Q4 · 데이터 검토 H6) · 로컬 도커 전용
//
// 사용자 결정(J1): 지난 것은 그대로, 앞으로만 바뀐다. 결근은 "확인할 날" 목록에서 사장이 한 번 누른다.
// 사용자 결정(§8 Q4): 지난 날짜의 결근 표시는 경고를 거친 뒤에만 된다 → 서버는 p_confirm_past 를 요구한다.
// 무엇을 못박나:
//   [1] mark_shift_day: 사장만(직원·매니저 불가 · 급여 영향 0201 원칙) · 다른 매장 근무 거부(IDOR) · 그날 서는 근무만 ·
//       미래 날짜 거부 · 지난 날짜는 p_confirm_past 필수 · 같은 날 다시 누르면 덮어쓴다(한 행).
//   [2] ★데이터 H6: 결근 표시 → 근무 수정(옛 앱 직접 UPDATE · edit_shift_from · 옛 앱 직접 DELETE · end_shift_from)
//       → 그 주 지급액이 그대로다. 나누기(copy_past_segment)가 표시를 지난 구간 복사본으로 옮겨야 한다.
//   [3] RLS: 본인과 관리자만 본다. 동료·다른 매장 0건. 사장도 직접 쓰지 못한다(RPC 로만).
//   [4] clear_shift_day: 사장만 · 지난 날짜는 p_confirm_past · 다른 매장은 false.
//   [5] 권한 · 표 권한 · realtime.
// 지급액은 이 하니스가 근무표(반복·기간·예외·날짜 지정)와 표시로 직접 센다. 앱 C 의 computePeriodPay 규칙
// "absent 인 날은 뺀다"와 같다(주휴는 앱이 센다 · 여기서는 그날 근무분만).
//
// ★로컬 전용: 실행할 때마다 계정을 가입시키고 지운다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-day-marks.mjs   자가정리(계정·매장·OTP 시드).
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
const spanMin = (a, b) => { const m = (x) => +x.slice(0, 2) * 60 + +x.slice(3, 5); const d = m(b) - m(a); return d > 0 ? d : d + 1440; };

const phones = ['0161', '0162', '0163', '0164', '0165'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const signUp = async (i, name, role, birth) => {
  const c = mk();
  const email = `qa_sdm_${i}_${s}@example.com`;
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
const rowsOf = async (unit) => (await admin.from('shift_templates').select('*').eq('unit_id', unit)).data ?? [];
const markOf = (tpl, date) => {
  const v = psql(`select coalesce((select row_to_json(m)::text from public.shift_day_marks m where template_id = '${tpl}' and date = '${date}'), 'null')`);
  try { return JSON.parse(v); } catch { return { error: v }; }
};
const marksAt = (date, staff) => {
  const v = psql(`select coalesce((select json_agg(m)::text from public.shift_day_marks m where date = '${date}' and staff_id = '${staff}'), '[]')`);
  try { return JSON.parse(v); } catch { return [{ error: v }]; }
};

/**
 * [from, to] 기간 그 직원의 근무분 합계(지급액 = 분 × 시급 / 60).
 * 그날 서는 근무 = 날짜 지정 행이거나, 요일이 맞고 적용 기간 안이고 그날 예외가 없는 반복 행.
 * 그 (근무, 날짜)에 결근 표시(absent · 담당자 같음)가 있으면 그날 그 근무는 뺀다.
 */
const payMinutes = async (unit, staff, from, to) => {
  const rows = (await rowsOf(unit)).filter((r) => r.staff_id === staff);
  const exc = (await admin.from('shift_exceptions').select('template_id, date').eq('unit_id', unit)).data ?? [];
  const mv = psql(`select coalesce((select json_agg(m)::text from public.shift_day_marks m where unit_id = '${unit}'), '[]')`);
  let marks = [];
  try { marks = JSON.parse(mv); } catch { marks = []; }   // 표가 없으면(0245 전) 표시 없음으로 센다
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const r of rows) {
      const on = r.shift_date ? r.shift_date === d
        : r.weekday === dow(d) && r.valid_from <= d && (!r.valid_to || r.valid_to >= d) && !exc.some((e) => e.template_id === r.id && e.date === d);
      if (!on) continue;
      if (marks.some((m) => m.template_id === r.id && m.date === d && m.mark === 'absent' && m.staff_id === r.staff_id)) continue;
      total += spanMin(r.start_time, r.end_time);
    }
  }
  return total;
};

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = await signUp(0, 'QA결근사장', 'owner', '1980-01-01');
  const J = await signUp(1, 'QA결근직원J', 'junior', '2000-01-01');
  const K = await signUp(2, 'QA결근직원K', 'junior', '2000-02-02');
  const M = await signUp(3, 'QA결근매니저', 'junior', '1995-04-04');
  const X = await signUp(4, 'QA결근다른사장', 'owner', '1981-01-01');
  const st = await store(O.c, 'QA결근카페');
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
  const sx = await store(X.c, 'QA다른결근카페');
  await X.c.rpc('switch_active_unit', { p_unit_id: sx.unit_id });
  console.log(`셋업 — 매장 ${UNIT} · 오늘(KST) ${T}`);

  // 지난 7일(T-7 ~ T-1)은 요일이 하나씩 다 들어 있다. 근무 넷을 서로 다른 요일에 둔다.
  const W0 = addDays(T, -7), W1 = addDays(T, -1);
  const P_A = addDays(T, -7), P_B = addDays(T, -5), P_C = addDays(T, -4), P_E = addDays(T, -3);
  const A1 = `qa_sdm_a1_${s}`;   // 옛 앱 직접 UPDATE 대상
  const B1 = `qa_sdm_b1_${s}`;   // edit_shift_from 대상
  const C1 = `qa_sdm_c1_${s}`;   // 옛 앱 직접 DELETE 대상
  const E1 = `qa_sdm_e1_${s}`;   // end_shift_from 대상
  await legacy(A1, UNIT, J.id, dow(P_A), '09:00', '18:00');
  await legacy(B1, UNIT, J.id, dow(P_B), '10:00', '16:00');
  await legacy(C1, UNIT, J.id, dow(P_C), '13:00', '19:00');
  await legacy(E1, UNIT, J.id, dow(P_E), '08:00', '12:00');
  const D1 = `qa_sdm_d1_${s}`;   // 날짜 지정(T-2)
  await dated(D1, UNIT, J.id, addDays(T, -2), '09:00', '13:00');
  const F1 = `qa_sdm_f1_${s}`;   // 다른 매장 근무
  await legacy(F1, sx.unit_id, X.id, dow(P_A), '09:00', '18:00');
  await admin.from('wages').upsert({ unit_id: UNIT, staff_id: J.id, hourly_wage: 12000 });

  // ═══════ [1] mark_shift_day ═══════
  console.log('\n[1] mark_shift_day — 사장만 · 그날 서는 근무 · 미래 거부 · 지난 날짜는 p_confirm_past');
  {
    const jm = await J.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    check('1-1 직원은 결근 표시 못 한다', !!jm.error && /owner_only/.test(jm.error.message), jm.error?.message ?? `data=${jm.data}`);
    const mm = await M.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    check('1-2 ★매니저도 못 한다(급여 영향 · 0201 원칙)', !!mm.error && /owner_only/.test(mm.error.message), mm.error?.message ?? `data=${mm.data}`);
    const xm = await X.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    check('1-3 ★다른 매장 사장은 못 한다(IDOR)', !!xm.error && /not_found/.test(xm.error.message), xm.error?.message ?? `data=${xm.data}`);
    const of = await O.c.rpc('mark_shift_day', { p_template: F1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    check('1-4 ★다른 매장 근무 id 는 거부(IDOR)', !!of.error && /not_found/.test(of.error.message), of.error?.message ?? `data=${of.data}`);
    const an = await mk().rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    check('1-5 로그인 안 한 사람은 못 부른다', !!an.error, an.error?.message ?? 'allowed');
    const np = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent' });
    check('1-6 ★지난 날짜는 p_confirm_past 없이 거부(Q4)', !!np.error && /confirm_past_required/.test(np.error.message) && markOf(A1, P_A) === null,
      np.error?.message ?? `data=${np.data}`);
    const wd = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: addDays(P_A, 1), p_mark: 'absent', p_confirm_past: true });
    check('1-7 그날 서지 않는 근무(다른 요일)는 거부', !!wd.error && /day_not_scheduled/.test(wd.error.message), wd.error?.message ?? `data=${wd.data}`);
    const fu = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: addDays(P_A, 14), p_mark: 'absent', p_confirm_past: true });
    check('1-8 미래 날짜는 거부', !!fu.error && /future_date/.test(fu.error.message), fu.error?.message ?? `data=${fu.data}`);
    const bad = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'late', p_confirm_past: true });
    check('1-9 absent·worked 밖의 값은 거부', !!bad.error && /invalid_mark/.test(bad.error.message), bad.error?.message ?? `data=${bad.data}`);
    const wdd = await O.c.rpc('mark_shift_day', { p_template: D1, p_date: addDays(T, -3), p_mark: 'absent', p_confirm_past: true });
    check('1-10 날짜 지정 근무는 그 날짜만', !!wdd.error && /day_not_scheduled/.test(wdd.error.message), wdd.error?.message ?? `data=${wdd.data}`);

    const ok = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'worked', p_confirm_past: true });
    const again = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: P_A, p_mark: 'absent', p_confirm_past: true });
    const m = markOf(A1, P_A);
    check('1-11 ★사장은 표시한다 · 다시 누르면 덮어쓴다(한 행) · 담당자·표시한 사람이 남는다',
      !ok.error && ok.data === true && !again.error && again.data === true
      && m?.mark === 'absent' && m?.staff_id === J.id && m?.unit_id === UNIT && m?.marked_by === O.id && !!m?.marked_at,
      ok.error?.message ?? again.error?.message ?? JSON.stringify(m));
    for (const [tpl, d] of [[B1, P_B], [C1, P_C], [E1, P_E], [D1, addDays(T, -2)]]) {
      const r = await O.c.rpc('mark_shift_day', { p_template: tpl, p_date: d, p_mark: 'absent', p_confirm_past: true });
      if (r.error) check(`1-11b ${d} 결근 표시`, false, r.error.message);
    }
    // 2주 전 '근무 인정' 표시(목록에서만 사라짐)도 지난 구간을 따라가야 한다.
    const w14 = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: addDays(P_A, -7), p_mark: 'worked', p_confirm_past: true });
    check('1-12 근무 인정(worked)도 표시된다', !w14.error && w14.data === true, w14.error?.message);
    const td = await O.c.rpc('mark_shift_day', { p_template: A1, p_date: T, p_mark: 'absent' });
    check('1-13 오늘(지난 날짜 아님)은 p_confirm_past 없이 된다 · 그날 서지 않으면 day_not_scheduled',
      dow(T) === dow(P_A) ? (!td.error && td.data === true) : (!!td.error && /day_not_scheduled/.test(td.error.message)),
      td.error?.message ?? `data=${td.data}`);
  }

  // ═══════ [2] 데이터 H6 — 결근 표시 → 근무 수정 → 그 주 지급액 그대로 ═══════
  console.log('\n[2] ★결근 표시 → 근무 수정 → 그 주 지급액이 그대로(데이터 H6)');
  {
    const base = await payMinutes(UNIT, J.id, W0, W1);
    // 결근 넷(A1·B1·C1·E1) + 날짜 지정 하나(D1)를 뺀 나머지 = 0 이어야 한다(그 주 근무는 이 다섯뿐).
    check('2-0 결근 표시한 날은 그 주 지급에서 빠진다(기준값)', base === 0, `base=${base}분`);

    const up = await O.c.from('shift_templates').update({ start_time: '08:00' }).eq('id', A1).select('id');
    const copyA = (await rowsOf(UNIT)).find((r) => r.staff_id === J.id && r.weekday === dow(P_A) && r.id !== A1 && !r.shift_date);
    check('2-1 옛 앱 직접 UPDATE 성공 · 지난 구간 복사본 생김', !up.error && !!copyA && copyA.valid_to === addDays(T, -1),
      up.error?.message ?? JSON.stringify(copyA ?? null));
    check('2-2 ★지난 날짜 결근 표시는 복사본으로 옮겨진다', markOf(copyA?.id, P_A)?.mark === 'absent',
      `copy=${JSON.stringify(markOf(copyA?.id, P_A))} orig=${JSON.stringify(markOf(A1, P_A))}`);
    check('2-3 2주 전 근무 인정 표시도 복사본으로', markOf(copyA?.id, addDays(P_A, -7))?.mark === 'worked',
      JSON.stringify(marksAt(addDays(P_A, -7), J.id)));
    const p1 = await payMinutes(UNIT, J.id, W0, W1);
    check('2-4 ★옛 앱 직접 수정 뒤에도 그 주 지급액이 그대로', p1 === base, `before=${base}분 after=${p1}분 (차이 ${(p1 - base) / 60 * 12000}원)`);

    const ed = await O.c.rpc('edit_shift_from', { p_id: B1, p_from: T, p_start: '11:00', p_end: '16:00' });
    const copyB = (await rowsOf(UNIT)).find((r) => r.staff_id === J.id && r.weekday === dow(P_B) && r.id !== B1 && !r.shift_date);
    check('2-5 ★edit_shift_from(이 날부터 계속) 뒤 결근 표시는 복사본으로',
      !ed.error && !!copyB && markOf(copyB.id, P_B)?.mark === 'absent', ed.error?.message ?? JSON.stringify({ copyB: copyB?.id, marks: marksAt(P_B, J.id) }));
    const p2 = await payMinutes(UNIT, J.id, W0, W1);
    check('2-6 ★edit_shift_from 뒤에도 그 주 지급액이 그대로', p2 === base, `before=${base}분 after=${p2}분`);

    const del = await O.c.from('shift_templates').delete().eq('id', C1).select('id');
    const mc = marksAt(P_C, J.id);
    check('2-7 ★옛 앱 직접 DELETE 뒤에도 지난 결근 표시가 지워지지 않고 복사본에 붙는다',
      !del.error && mc.length === 1 && mc[0]?.template_id !== C1 && mc[0]?.mark === 'absent', del.error?.message ?? JSON.stringify(mc));
    const p3 = await payMinutes(UNIT, J.id, W0, W1);
    check('2-8 ★옛 앱 직접 삭제 뒤에도 그 주 지급액이 그대로', p3 === base, `before=${base}분 after=${p3}분`);

    const en = await O.c.rpc('end_shift_from', { p_id: E1, p_from: T });
    const e1 = (await rowsOf(UNIT)).find((r) => r.id === E1);
    check('2-9 ★end_shift_from(오늘부터 그만)은 결근 표시가 있는 행을 지우지 않고 valid_to 로 닫는다',
      !en.error && e1?.valid_to === addDays(T, -1) && markOf(E1, P_E)?.mark === 'absent', en.error?.message ?? JSON.stringify({ e1, m: markOf(E1, P_E) }));
    const p4 = await payMinutes(UNIT, J.id, W0, W1);
    check('2-10 ★end_shift_from 뒤에도 그 주 지급액이 그대로', p4 === base, `before=${base}분 after=${p4}분`);

    // 표시가 없는 같은 주 근무는 그대로 지급된다(표시가 엉뚱한 날을 빼지 않는다).
    const G1 = `qa_sdm_g1_${s}`;
    await legacy(G1, UNIT, J.id, dow(addDays(T, -6)), '09:00', '11:00');
    const p5 = await payMinutes(UNIT, J.id, W0, W1);
    check('2-11 표시 없는 근무는 그대로 지급(+120분)', p5 === base + 120, `p5=${p5}`);
  }

  // ═══════ [3] RLS ═══════
  console.log('\n[3] RLS — 본인·관리자만 본다 · 직접 쓰기 불가');
  {
    const seen = async (c) => ((await c.from('shift_day_marks').select('template_id').eq('staff_id', J.id)).data ?? []).length;
    const all = Number(psql(`select count(*) from public.shift_day_marks where staff_id = '${J.id}'`));
    check('3-1 본인은 자기 결근 표시를 본다(분쟁 예방)', all > 0 && (await seen(J.c)) === all, `seen=${await seen(J.c)} all=${all}`);
    check('3-2 ★같은 매장 동료는 못 본다', (await seen(K.c)) === 0);
    check('3-3 사장·매니저는 본다', (await seen(O.c)) === all && (await seen(M.c)) === all);
    check('3-4 ★다른 매장 사장은 못 본다', (await seen(X.c)) === 0);
    const ins = await O.c.from('shift_day_marks').insert({ template_id: D1, date: addDays(T, -9), unit_id: UNIT, staff_id: J.id, mark: 'absent' }).select('template_id');
    check('3-5 ★사장도 직접 넣지 못한다(RPC 로만)', !!ins.error || (ins.data ?? []).length === 0, `rows=${(ins.data ?? []).length}`);
    const upd = await O.c.from('shift_day_marks').update({ mark: 'worked' }).eq('staff_id', J.id).select('template_id');
    const updJ = await J.c.from('shift_day_marks').update({ mark: 'worked' }).eq('staff_id', J.id).select('template_id');
    check('3-6 ★사장·직원 모두 직접 못 바꾼다', (!!upd.error || (upd.data ?? []).length === 0) && (!!updJ.error || (updJ.data ?? []).length === 0)
      && markOf(D1, addDays(T, -2))?.mark === 'absent', `o=${upd.error?.code ?? (upd.data ?? []).length} j=${updJ.error?.code ?? (updJ.data ?? []).length}`);
    const del = await J.c.from('shift_day_marks').delete().eq('staff_id', J.id).select('template_id');
    check('3-7 ★직원이 자기 결근 표시를 지우지 못한다', (!!del.error || (del.data ?? []).length === 0) && markOf(D1, addDays(T, -2)) !== null);
  }

  // ═══════ [4] clear_shift_day ═══════
  console.log('\n[4] clear_shift_day — 사장만 · 지난 날짜는 p_confirm_past · 다른 매장은 false');
  {
    const D2 = addDays(T, -2);
    const jc = await J.c.rpc('clear_shift_day', { p_template: D1, p_date: D2, p_confirm_past: true });
    const mc = await M.c.rpc('clear_shift_day', { p_template: D1, p_date: D2, p_confirm_past: true });
    check('4-1 ★직원·매니저는 못 지운다', !!jc.error && /owner_only/.test(jc.error.message) && !!mc.error && /owner_only/.test(mc.error.message)
      && markOf(D1, D2) !== null, `${jc.error?.message ?? jc.data} / ${mc.error?.message ?? mc.data}`);
    const xc = await X.c.rpc('clear_shift_day', { p_template: D1, p_date: D2, p_confirm_past: true });
    check('4-2 ★다른 매장 사장은 못 지운다(false · 그대로)', !xc.error && xc.data === false && markOf(D1, D2) !== null, xc.error?.message ?? `data=${xc.data}`);
    const np = await O.c.rpc('clear_shift_day', { p_template: D1, p_date: D2 });
    check('4-3 ★지난 날짜는 p_confirm_past 없이 거부(Q4)', !!np.error && /confirm_past_required/.test(np.error.message) && markOf(D1, D2) !== null,
      np.error?.message ?? `data=${np.data}`);
    const ok = await O.c.rpc('clear_shift_day', { p_template: D1, p_date: D2, p_confirm_past: true });
    check('4-4 사장은 지운다 → 그날 다시 지급', !ok.error && ok.data === true && markOf(D1, D2) === null, ok.error?.message ?? `data=${ok.data}`);
    const none = await O.c.rpc('clear_shift_day', { p_template: D1, p_date: D2, p_confirm_past: true });
    check('4-5 없는 표시를 지우면 false', !none.error && none.data === false, none.error?.message ?? `data=${none.data}`);
  }

  // ═══════ [5] 권한 · 표 · realtime ═══════
  console.log('\n[5] 권한 · 표 권한 · realtime');
  {
    for (const fn of ['mark_shift_day(text, date, text, boolean)', 'clear_shift_day(text, date, boolean)']) {
      const v = psql(`select has_function_privilege('anon', 'public.${fn}', 'execute')::text || has_function_privilege('authenticated', 'public.${fn}', 'execute')::text`);
      check(`5-1 ${fn}: anon 불가 · authenticated 가능`, v === 'falsetrue', v);
    }
    const rls = psql(`select relrowsecurity::text from pg_class where oid = to_regclass('public.shift_day_marks')`);
    check('5-2 RLS 켜짐', rls === 'true', rls);
    const w = psql(`select has_table_privilege('anon', 'public.shift_day_marks', 'SELECT,INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.shift_day_marks', 'INSERT,UPDATE,DELETE')::text || '/' ||
                           has_table_privilege('authenticated', 'public.shift_day_marks', 'SELECT')::text`);
    check('5-3 anon 권한 없음 · authenticated 쓰기 없음 · 읽기만(realtime)', w === 'false/false/true', w);
    const pub = psql(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_day_marks'`);
    check('5-4 realtime publication 에 있다', pub === '1', pub);
    const pk = psql(`select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.shift_day_marks') and contype = 'p'`);
    check('5-5 기본키 (template_id, date)', /\(template_id, date\)/.test(pk), pk);
    const cp = psql(`select has_function_privilege('anon', 'public.copy_past_segment(text, date)', 'execute')::text || has_function_privilege('authenticated', 'public.copy_past_segment(text, date)', 'execute')::text`);
    check('5-6 copy_past_segment 는 여전히 내부 전용', cp === 'falsefalse', cp);
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
