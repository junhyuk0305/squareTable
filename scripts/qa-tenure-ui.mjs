#!/usr/bin/env node
// qa-tenure-ui.mjs — 앱 C 급여 묶음 뒷부분(P4-7d · Q10 · 재직 기간 화면)의 앱 쪽 회귀 하네스.
//
// 무엇을 보나
//   [1] 순수 함수(schedule.ts · tenure.ts 를 임시 트랜스파일해 실제 함수로 검증 · 로직 복제 없음)
//       · swapApprovable — 수락된 교대는 근무일이 지나도 35일 동안 승인 목록에 남는다(서버 approve_swap 0242 와 같은 경계).
//       · pastSwapNotice — 지난 교대 승인 확인창 문구. 받는 사람 이름을 넣고, 원래 담당자가 그날 출근을 찍었으면 경고를 더한다.
//       · departedInPeriod — "이번 정산 기간 퇴사자" = 닫힌 재직 기간 중 지금 멤버가 아니고 이번 기간에 근무가 있는 사람(사람당 최신 1건).
//       · rejoinNotice — 합류 신청자가 이 매장에 닫힌 재직 기간이 있으면 재입사 경고. 이번 기간 근무가 있으면 정산 먼저.
//       · openJoinedAt — 입사일 = 열린 재직 기간의 joined_at.
//   [2] 소스 계약 — 근무표 승인 목록·확인창·RPC 인자, 직원·급여 화면의 퇴사자 줄·재입사 경고, 명부 입사일.
//   [3] RPC 인자 이름 — db.ts 가 approve_swap 에 넘기는 키가 로컬 DB 함수의 인자 이름과 같은지(docker exec psql).
//   [4] 왕복 — 로컬 DB 에서 지난 교대 승인 경고 대상 · 나간 직원이 이번 기간 퇴사자에 잡힘 · 재입사 신청자 판정 · 입사일.
//       퇴사자 줄은 화면이 부르는 departedPayRows · workedInPeriod(tenure.ts)를 그대로 부른다.
//       ★로컬 전용: 계정 4개를 가입시키고 지운다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-tenure-ui.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'tenure-ui');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };

// ── [1] 순수 함수 ──────────────────────────────────────────────────────────
const srcs = ['src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts', 'src/lib/utils/payroll.ts'];
if (existsSync(join(root, 'src/lib/utils/tenure.ts'))) srcs.push('src/lib/utils/tenure.ts');
try {
  execFileSync('npx', ['tsc', ...srcs,
    '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
const fix = (f) => {
  const fp = join(OUT, f);
  if (!existsSync(fp)) return null;
  writeFileSync(fp, readFileSync(fp, 'utf8')
    .replace(/'@\/lib\/utils\/([a-zA-Z]+)'/g, "'./$1.js'")
    .replace(/'\.\/([a-zA-Z]+)'/g, "'./$1.js'"), 'utf8');
  return fp;
};
fix('attendance.js'); fix('payroll.js');
const S = await import(pathToFileURL(fix('schedule.js')));
const tfp = fix('tenure.js');
const T = tfp ? await import(pathToFileURL(tfp)) : {};
const fnS = (n) => (typeof S[n] === 'function' ? S[n] : null);
const fnT = (n) => (typeof T[n] === 'function' ? T[n] : null);

// 새 함수가 없으면(수정 전) **지금 코드의 판정**으로 같은 케이스를 돌린다 — 함수가 없어서가 아니라 판정이 틀려서 RED 여야 한다.
//   지금 pendingApprovals = `r.status === 'accepted' && r.date >= today`(지난 날짜 제외).
const storeSrc = read('src/lib/store/useScheduleStore.ts');
const legacyApprovable = storeSrc.includes("r.status === 'accepted' && r.date >= today")
  ? (r, today) => r.status === 'accepted' && r.date >= today : null;
const approvable = fnS('swapApprovable') ?? legacyApprovable;
if (!fnS('swapApprovable')) console.log('  (swapApprovable 없음 → 지금 pendingApprovals 판정으로 실행)');

const TODAY = '2026-10-15';
const d = (n) => S.addDays(TODAY, n);
const sw = (o) => ({ id: 'sw', kind: 'cover', requester_id: 'A', date: d(-3), template_id: 't', note: '', status: 'accepted', accepted_by: 'B', created_at: '', updated_at: '', ...o });

console.log('\n■ [1-1] swapApprovable — 지난 교대 35일');
check('swapApprovable 이 schedule.ts 에 있다', !!fnS('swapApprovable'));
if (approvable) {
  check('★어제 날짜로 수락된 교대가 승인 목록에 남는다', approvable(sw({ date: d(-1) }), TODAY) === true);
  check('★35일 전 교대는 남는다(서버 date >= 오늘-35)', approvable(sw({ date: d(-35) }), TODAY) === true);
  check('36일 전 교대는 빠진다(서버가 거부)', approvable(sw({ date: d(-36) }), TODAY) === false);
  check('오늘·미래 교대는 그대로 남는다', approvable(sw({ date: TODAY }), TODAY) && approvable(sw({ date: d(5) }), TODAY));
  check('수락 전(open)·승인됨·반려는 빠진다', ['open', 'approved', 'rejected', 'cancelled'].every((st) => !approvable(sw({ status: st, date: d(2) }), TODAY)));
  check('맞교환은 두 날 중 이른 날로 본다(받을 날이 36일 전이면 빠짐)',
    approvable(sw({ kind: 'swap', date: d(2), target_date: d(-36) }), TODAY) === false);
}

console.log('\n■ [1-2] pastSwapNotice — 지난 교대 확인창');
const notice = fnS('pastSwapNotice');
check('pastSwapNotice 가 schedule.ts 에 있다', !!notice);
if (notice) {
  const nameOf = (id) => ({ A: '가나', B: '다라' })[id] ?? '직원';
  const n1 = notice(sw({ date: d(-3) }), TODAY, nameOf, []);
  check('★문구 = "지난 근무예요. 승인하면 이 근무 급여가 다라님에게 가요."',
    !!n1 && `${n1.title}. ${n1.message}` === '지난 근무예요. 승인하면 이 근무 급여가 다라님에게 가요.', JSON.stringify(n1));
  check('출근 기록이 없으면 경고가 없다', n1?.clockedIn === false);
  const n2 = notice(sw({ date: d(-3) }), TODAY, nameOf, [{ staff_id: 'A', date: d(-3), check_in: `${d(-3)}T00:00:00Z` }]);
  check('★원래 담당자(가나)가 그날 출근을 찍었으면 경고를 더한다', n2?.clockedIn === true && n2.message.includes('가나님'), JSON.stringify(n2));
  const n3 = notice(sw({ date: d(-3) }), TODAY, nameOf, [{ staff_id: 'B', date: d(-3), check_in: 'x' }, { staff_id: 'A', date: d(-4), check_in: 'x' }]);
  check('다른 사람·다른 날 출근은 경고하지 않는다', n3?.clockedIn === false);
  check('미래 교대는 확인창이 없다(null)', notice(sw({ date: d(1) }), TODAY, nameOf, []) === null);
  const n4 = notice(sw({ kind: 'swap', date: d(2), target_date: d(-2) }), TODAY, nameOf, [{ staff_id: 'B', date: d(-2), check_in: 'x' }]);
  check('맞교환에서 받을 날만 지났으면 그 근무는 요청자(가나)에게 가고, 원래 담당자는 수락자(다라)다',
    !!n4 && n4.message.startsWith('승인하면 이 근무 급여가 가나님에게 가요.') && n4.clockedIn === true, JSON.stringify(n4));
  const n5 = notice(sw({ kind: 'swap', date: d(-3), target_date: d(-2) }), TODAY, nameOf, []);
  check('맞교환 두 날이 다 지났으면 "승인하면 두 근무 급여가 서로 바뀌어요."',
    !!n5 && n5.message === '승인하면 두 근무 급여가 서로 바뀌어요.', JSON.stringify(n5));
}

const ten = (o) => ({ id: 't', user_id: 'C', joined_at: '2026-01-01T00:00:00Z', left_at: '2026-10-10T00:00:00Z', name_snapshot: '퇴사자', final_hourly_wage: 11000, ...o });

console.log('\n■ [1-3] departedInPeriod — 이번 정산 기간 퇴사자');
const departed = fnT('departedInPeriod');
check('departedInPeriod 가 tenure.ts 에 있다', !!departed);
if (departed) {
  const tens = [
    ten({ id: 'c1', user_id: 'C', left_at: '2026-03-01T00:00:00Z' }),
    ten({ id: 'c2', user_id: 'C', left_at: '2026-10-10T00:00:00Z' }),
    ten({ id: 'd1', user_id: 'D' }),                                  // 근무 없음
    ten({ id: 'e1', user_id: 'E' }),                                  // 지금 멤버(재입사함)
    ten({ id: 'e2', user_id: 'E', left_at: null }),
    ten({ id: 'f1', user_id: 'F', left_at: null }),                   // 열린 기간만
  ];
  const out = departed(tens, ['E', 'F'], new Set(['C', 'E', 'F']));
  check('★나간 직원(C)이 이번 기간 근무가 있으면 잡힌다(사람당 최신 기간 1건)', out.length === 1 && out[0].id === 'c2', JSON.stringify(out.map((t) => t.id)));
  check('근무 없는 퇴사자(D)·지금 멤버(E)·열린 기간(F)은 빠진다', !out.some((t) => ['d1', 'e1', 'e2', 'f1'].includes(t.id)));
}

console.log('\n■ [1-4] rejoinNotice — 재입사 승인 경고');
const rejoin = fnT('rejoinNotice');
check('rejoinNotice 가 tenure.ts 에 있다', !!rejoin);
if (rejoin) {
  const tens = [ten({ id: 'c2', user_id: 'C' }), ten({ id: 'g1', user_id: 'G', left_at: null })];
  const r1 = rejoin(tens, 'C', false);
  check('★닫힌 기간이 있으면 재입사 문구(글자 그대로)',
    Array.isArray(r1) && r1.length === 1 && r1[0] === '예전에 일했던 직원이에요. 새 직원으로 들어와요. 예전 기록은 보관만 하고 앱에서는 안 보여요.', JSON.stringify(r1));
  const r2 = rejoin(tens, 'C', true);
  check('★이번 기간 예전 근무가 있으면 "이번 기간 정산을 먼저 마치고 승인해 주세요."를 더한다',
    Array.isArray(r2) && r2.length === 2 && r2[1] === '이번 기간 정산을 먼저 마치고 승인해 주세요.', JSON.stringify(r2));
  check('처음 오는 사람·열린 기간만 있는 사람은 null', rejoin(tens, 'Z', true) === null && rejoin(tens, 'G', true) === null);
}

console.log('\n■ [1-5] openJoinedAt — 입사일');
const joined = fnT('openJoinedAt');
check('openJoinedAt 이 tenure.ts 에 있다', !!joined);
if (joined) {
  const tens = [ten({ id: 'c1', user_id: 'C', joined_at: '2025-01-01T00:00:00Z' }), ten({ id: 'c2', user_id: 'C', joined_at: '2026-10-12T01:00:00Z', left_at: null })];
  check('열린 기간의 joined_at 을 준다', joined(tens, 'C') === '2026-10-12T01:00:00Z');
  check('열린 기간이 없으면 null(호출부가 기존 값으로 폴백)', joined(tens, 'X') === null);
}

// ── [2] 소스 계약 ──────────────────────────────────────────────────────────
console.log('\n■ [2] 소스 계약');
const db = read('src/lib/db.ts');
const sched = read('src/app/owner/schedule.tsx');
const staffScr = read('src/app/owner/staff.tsx');
const staffStore = read('src/lib/store/useStaffStore.ts');
const pendBody = storeSrc.slice(storeSrc.indexOf('export function pendingApprovals'), storeSrc.indexOf('export function pendingApprovals') + 400);
check('pendingApprovals 가 swapApprovable 을 쓴다(홈 다음 행동과 같은 수)', pendBody.includes('swapApprovable('));
check('approveSwapRpc 가 p_confirm_past 를 넘긴다', /approveSwapRpc\([^)]*confirmPast/.test(db) && db.includes("p_confirm_past: true"));
check('p_confirm_past 는 지난 교대일 때만 보낸다(옛 서버 approve_swap(p_id) 와 맞게)',
  db.includes("confirmPast ? { p_id: id, p_confirm_past: true } : { p_id: id }"));
check('스토어 approveSwap 이 confirmPast 를 받는다', /approveSwap: \(id: string, confirmPast: boolean\)/.test(storeSrc) && /approveSwapRpc\(id, confirmPast\)/.test(storeSrc));
check('근무표 화면이 지난 교대에 pastSwapNotice 확인창을 거친다', sched.includes('pastSwapNotice(') && /approveSwap\(r\.id, (true|!!\w+|past)\)/.test(sched));
check('근무표 화면이 출근 기록(useAttendanceStore)을 넘긴다', sched.includes('useAttendanceStore'));
check('db.ts 에 fetchMemberTenures(member_tenures 읽기)', /export async function fetchMemberTenures/.test(db) && db.includes(".from('member_tenures')"));
check('직원 명부 입사일이 openJoinedAt 을 쓴다', staffStore.includes('openJoinedAt('));
// 0246 이 아직 없는 서버(옛 서버)에서는 member_tenures 읽기가 실패한다 — 명부까지 실패로 만들지 않는다(앱 먼저 나가도 동작).
check('재직 기간 읽기 실패는 명부 실패(loadError)로 번지지 않는다',
  staffStore.includes('fetchMemberTenures(') && !/loadError:[^\n]*ten/i.test(staffStore));
check('직원·급여 화면에 "이번 정산 기간 퇴사자" 줄', staffScr.includes('이번 정산 기간 퇴사자') && (staffScr.includes('departedInPeriod(') || staffScr.includes('departedPayRows(')));
// 퇴사자 줄 계산은 tenure.ts departedPayRows 하나다(2026-10-05 리뷰). 금액은 아래 [4] 왕복이 실제로 돌려 본다.
const tenureSrc = read('src/lib/utils/tenure.ts');
check('퇴사자 금액은 기존 계산 함수(computePay · scheduledShiftsFor)',
  staffScr.includes('departedPayRows(') && /computePay\(/.test(tenureSrc) && /scheduledShiftsFor\(/.test(tenureSrc));
check('합류 승인이 rejoinNotice 경고를 거친다', staffScr.includes('rejoinNotice('));

// ── [3] RPC 인자 이름 ─────────────────────────────────────────────────────
console.log('\n■ [3] RPC 인자 이름(로컬 도커)');
try {
  const out = execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-tAc',
    "select pg_get_function_identity_arguments('public.approve_swap(text,boolean)'::regprocedure)"], { encoding: 'utf8' }).trim();
  check('approve_swap(p_id, p_confirm_past) 가 로컬 DB 에 있다', out.includes('p_id') && out.includes('p_confirm_past'), out);
  const m = db.match(/rpc(?:Bool)?\([^)]*'approve_swap'[^\n]*/g) ?? [];
  check('db.ts 가 approve_swap 에 p_id·p_confirm_past 키를 쓴다', m.some((l) => l.includes('p_confirm_past')) || db.includes("'approve_swap', { p_id: id, p_confirm_past: true }"), m.join(' | '));
} catch (e) {
  check('로컬 도커 psql 접근', false, String(e.message).slice(0, 120));
}

// ── [4] 왕복(로컬 DB) ─────────────────────────────────────────────────────
console.log('\n■ [4] 왕복 — 로컬 DB');
function loadEnv() {
  const env = { ...process.env };
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
const phones = ['0191', '0192', '0193', '0194'].map((p) => `${p}${s.slice(0, 7)}`);
const H = 3600000;
const kstDate = (ms) => new Date(ms + 9 * H).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const users = [];
let UNIT = null;
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const up = async (i, name, role) => {
    const c = mk();
    const r = await c.auth.signUp({
      email: `qa_tenui_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: role === 'owner' ? '1980-01-01' : '2000-01-01' } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    users.push({ c, id: r.data.user?.id });
    return { c, id: r.data.user?.id };
  };
  const O = await up(0, 'QA재직사장', 'owner');
  const A = await up(1, 'QA교대요청', 'junior');
  const B = await up(2, 'QA교대수락', 'junior');
  const C = await up(3, 'QA나간직원', 'junior');
  const { data: st, error: e1 } = await O.c.rpc('create_store', { p_store_name: 'QA재직카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  UNIT = row.unit_id;
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  const joinApprove = async (U) => {
    const j = await U.c.rpc('join_by_invite', { p_code: row.invite_code });
    if (j.error) throw new Error('join_by_invite: ' + j.error.message);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error('approve_member: ' + a.error.message);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  };
  for (const U of [A, B, C]) await joinApprove(U);
  const now = Date.now();
  const today = kstDate(now);
  const addD = (n) => S.addDays(today, n);
  const names = { [A.id]: 'QA교대요청', [B.id]: 'QA교대수락', [C.id]: 'QA나간직원' };
  const nameOf = (id) => names[id] ?? '직원';
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 A·B·C · 오늘(KST) ${today}`);

  // ── 지난 교대 승인 경고 대상 ──
  {
    const past3 = addD(-3), past40 = addD(-40);
    for (const [label, q] of [
      ['A 지난 근무', admin.from('shift_templates').insert({ id: `tu_s3_${s}`, unit_id: UNIT, staff_id: A.id, weekday: null, shift_date: past3, start_time: '09:00', end_time: '13:00' })],
      ['A 40일 전 근무', admin.from('shift_templates').insert({ id: `tu_s40_${s}`, unit_id: UNIT, staff_id: A.id, weekday: null, shift_date: past40, start_time: '09:00', end_time: '13:00' })],
      ['교대(3일 전)', admin.from('swap_requests').insert({ id: `tu_w3_${s}`, unit_id: UNIT, kind: 'cover', requester_id: A.id, date: past3, template_id: `tu_s3_${s}`, note: '', status: 'accepted', accepted_by: B.id })],
      ['교대(40일 전)', admin.from('swap_requests').insert({ id: `tu_w40_${s}`, unit_id: UNIT, kind: 'cover', requester_id: A.id, date: past40, template_id: `tu_s40_${s}`, note: '', status: 'accepted', accepted_by: B.id })],
      ['A 출근(3일 전)', admin.from('attendance').insert({ id: `tu_a3_${s}`, unit_id: UNIT, staff_id: A.id, date: past3, check_in: iso(now - 72 * H), check_out: iso(now - 70 * H), work_minutes: 120 })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    const swaps = (await O.c.from('swap_requests').select('*').eq('unit_id', UNIT)).data ?? [];
    const recs = (await O.c.from('attendance').select('staff_id, date, check_in').eq('unit_id', UNIT)).data ?? [];
    const w3 = swaps.find((r) => r.id === `tu_w3_${s}`), w40 = swaps.find((r) => r.id === `tu_w40_${s}`);
    check('4-1 ★사장 승인 목록에 3일 전 수락 교대가 잡힌다', !!approvable && !!w3 && approvable(w3, today) === true);
    check('4-2 40일 전 교대는 목록에서 빠진다', !!approvable && !!w40 && approvable(w40, today) === false);
    const n = notice ? notice(w3, today, nameOf, recs) : null;
    check('4-3 ★확인창이 받는 사람(B) 이름을 말하고, A 가 그날 출근을 찍어 경고한다',
      !!n && n.message.startsWith('승인하면 이 근무 급여가 QA교대수락님에게 가요.') && n.clockedIn === true, JSON.stringify(n));
    const r0 = await O.c.rpc('approve_swap', { p_id: `tu_w3_${s}` });
    check('4-4 확인 없이 부르면 서버가 confirm_past_required 로 거부한다', /confirm_past_required/.test(r0.error?.message ?? ''), r0.error?.message ?? `rpc=${r0.data}`);
    const r1 = await O.c.rpc('approve_swap', { p_id: `tu_w3_${s}`, p_confirm_past: true });
    check('4-5 ★확인을 거쳐 p_confirm_past=true 로 부르면 승인된다', !r1.error && r1.data === true, r1.error?.message ?? `rpc=${r1.data}`);
    const r2 = await O.c.rpc('approve_swap', { p_id: `tu_w40_${s}`, p_confirm_past: true });
    check('4-6 40일 전 교대는 서버도 거부한다(앱 목록과 같은 경계)', !r2.error && r2.data === false, r2.error?.message ?? `rpc=${r2.data}`);
  }

  // ── 나간 직원이 이번 기간 퇴사자에 잡힘 ──
  // ★퇴사자 줄은 화면이 부르는 departedPayRows(tenure.ts)를 그대로 돈다. 입력은 화면이 읽는 것과 같은 표 · 같은 모양이다
  //   (근무표 = shift_templates_all 을 db.ts fetchShiftTemplates 와 같은 칸으로 · 멤버 = 사장 포함 전원 = Object.keys(roles)).
  const ym = today.slice(0, 7);
  const payRows = typeof T.departedPayRows === 'function' ? T.departedPayRows : null;
  const workedInPeriod = typeof T.workedInPeriod === 'function' ? T.workedInPeriod : null;
  const rules = { breakDeduction: false, nightAllowance: false, overtimeAllowance: false, weeklyHolidayPay: false, extraAllowance: 0 };
  const loadOwner = async () => {
    const tens = await O.c.from('member_tenures').select('id, user_id, joined_at, left_at, name_snapshot, final_hourly_wage').eq('unit_id', UNIT);
    const tpls = await O.c.rpc('shift_templates_all');
    const recs = await O.c.from('attendance').select('staff_id, date, check_in, check_out, work_minutes').eq('unit_id', UNIT);
    const mem = await O.c.from('unit_members').select('user_id, role').eq('unit_id', UNIT);
    const sws = await O.c.from('swap_requests').select('*').eq('unit_id', UNIT);
    const exs = await O.c.from('shift_exceptions').select('template_id, date');
    const wgs = await O.c.from('wages').select('staff_id, hourly_wage').eq('unit_id', UNIT);
    const err = tens.error ?? tpls.error ?? recs.error ?? mem.error ?? sws.error ?? exs.error ?? wgs.error;
    if (err) throw new Error('사장 읽기: ' + err.message);
    const templates = (tpls.data ?? []).map((r) => ({ id: r.id, staff_id: r.staff_id, weekday: r.weekday, date: r.shift_date ?? null, start: r.start_time, end: r.end_time, valid_from: r.valid_from ?? null, valid_to: r.valid_to ?? null }));
    const period = { ym, records: recs.data ?? [], templates, swaps: sws.data ?? [], exceptions: exs.data ?? [] };
    const wages = Object.fromEntries((wgs.data ?? []).map((w) => [w.staff_id, w.hourly_wage]));
    const tenures = tens.data ?? [];
    const rows = payRows ? payRows({ ...period, tenures, memberIds: (mem.data ?? []).map((m) => m.user_id), wages, settings: rules }) : [];
    return { tens: tenures, period, rows };
  };
  {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const t = await O.c.from('shift_templates').insert({ id: `tu_cs_${s}`, unit_id: UNIT, staff_id: C.id, weekday: dow, shift_date: null, start_time: '14:00', end_time: '18:00' });
    if (t.error) throw new Error('C 반복 근무: ' + t.error.message);
    for (const [label, q] of [
      ['C 출근(오늘)', admin.from('attendance').insert({ id: `tu_ca_${s}`, unit_id: UNIT, staff_id: C.id, date: today, check_in: iso(now - 2 * H), check_out: iso(now - 1 * H), work_minutes: 60 })],
      ['C 시급', O.c.from('wages').upsert({ unit_id: UNIT, staff_id: C.id, hourly_wage: 12000 })],
    ]) { const { error } = await q; if (error) throw new Error(`${label} 셋업: ${error.message}`); }
    const rm = await O.c.rpc('remove_staff', { p_staff_id: C.id });
    if (rm.error) throw new Error('remove_staff: ' + rm.error.message);
    const st1 = await loadOwner();
    const out = st1.rows;
    const cRow = out.find((x) => x.id === C.id);
    check('4-7 ★나간 직원(C)이 "이번 정산 기간 퇴사자"에 잡힌다(닫힌 기간 + 이번 기간 근무)', !!cRow, JSON.stringify(out));
    check('4-8 지금 직원(A·B)·사장은 퇴사자에 잡히지 않는다', !!payRows && !out.some((x) => x.id === A.id || x.id === B.id || x.id === O.id));
    check('4-9 퇴사자 이름은 스냅샷에서 온다', cRow?.name === 'QA나간직원', JSON.stringify(cRow));
    const wg = await O.c.from('wages').select('staff_id, hourly_wage').eq('unit_id', UNIT).eq('staff_id', C.id);
    check('4-10 나간 뒤에도 사장이 시급을 읽는다(기존 계산 함수에 넣을 값)', (wg.data ?? [])[0]?.hourly_wage === 12000, JSON.stringify(wg.data ?? wg.error));
    check('4-10b ★퇴사자 줄 금액 = 남은 시급(12000)으로 낸 근무표 기준 금액(오늘 14~18시 근무가 잡힌다)', cRow?.wage === 12000 && cRow?.schedMin >= 240 && cRow?.pay > 0, JSON.stringify(cRow));
    // 매니저에게는 재직 기간이 안 보인다(RLS = 같은 매장 사장만) — 퇴사자 줄·재입사 경고는 사장 화면 전용.
    const sr = await O.c.rpc('set_member_role', { p_uid: B.id, p_role: 'manager' });
    if (sr.error) throw new Error('set_member_role: ' + sr.error.message);
    const mt = await B.c.from('member_tenures').select('id').eq('unit_id', UNIT);
    check('4-11 매니저는 member_tenures 를 0행으로 읽는다(사장 전용)', !mt.error && (mt.data ?? []).length === 0, mt.error?.message ?? `rows=${(mt.data ?? []).length}`);

    // ── 재입사 신청자 판정 ──
    const j = await C.c.rpc('join_by_invite', { p_code: row.invite_code });
    if (j.error) throw new Error('C 재신청: ' + j.error.message);
    const pend = await O.c.from('profiles').select('id').eq('pending_unit_id', UNIT);
    check('4-12 C 가 합류 신청 목록에 있다', (pend.data ?? []).some((p) => p.id === C.id), JSON.stringify(pend.data ?? pend.error));
    const st2 = await loadOwner();
    const rn = rejoin && workedInPeriod ? rejoin(st2.tens, C.id, workedInPeriod(C.id, st2.period)) : null;
    check('4-13 ★재입사 신청자(C)에게 재입사 경고 + 정산 먼저 경고', Array.isArray(rn) && rn.length === 2, JSON.stringify(rn));
    check('4-14 처음 신청한 적 없는 직원(A)은 경고가 없다', !!rejoin && rejoin(st2.tens, A.id, true) === null);
    const ap = await O.c.rpc('approve_member', { p_uid: C.id });
    if (ap.error) throw new Error('C 재승인: ' + ap.error.message);
    const st3 = await loadOwner();
    const out3 = st3.rows;
    check('4-15 재입사 뒤 C 는 퇴사자 줄에서 빠진다(옛 근무는 표시돼 안 보임)', !!payRows && !out3.some((x) => x.id === C.id), JSON.stringify(out3));
    const ja = joined ? joined(st3.tens, C.id) : null;
    const open = st3.tens.find((x) => x.user_id === C.id && !x.left_at);
    check('4-16 ★입사일 = 새 열린 재직 기간의 joined_at(재입사일)', !!ja && ja === open?.joined_at && Date.parse(ja) > now - 600000, `${ja} vs ${open?.joined_at}`);
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
