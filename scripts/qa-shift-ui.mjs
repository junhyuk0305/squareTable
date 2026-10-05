#!/usr/bin/env node
// qa-shift-ui.mjs — 앱 C 근무표 묶음(P4-7 앞부분 · J1 · J2 · §8 Q4)의 앱 쪽 회귀 하네스.
//
// 무엇을 보나
//   [1] 순수 함수(schedule.ts 를 임시 트랜스파일해 실제 함수로 검증 · 로직 복제 없음)
//       · shiftAppliesOn — 반복 근무는 요일 + 적용 기간(valid_from ~ valid_to)인 날에만 선다.
//         10/6부터 적용한 행이 9/29 에 잡히면 안 된다. 나눈 두 행은 경계 앞뒤 어느 날이든 정확히 1건.
//         골든: 2000-01-01 로 채운 기존 행은 옛 판정(요일만)과 3개월 내내 같다.
//       · planSeriesSave — "이 직원의 한 요일 반복은 하나"를 **그 요일 첫 날에 적용 중인 행** 기준으로 판정한다.
//         끝난 행을 고치지 않고, 아직 시작 안 한 행 앞에서는 새 행을 그 전날로 닫는다.
//   [2] 소스 계약 — shiftsOn·JuniorTodayView·db.ts·ShiftQuickSheet·MyShiftSheet·근무표·홈·TimesheetView 가
//       적용 기간과 새 RPC(요청·승인)를 쓰는지, 옛 직접 수정 경로(updateShiftTemplate·update_my_shift_time)가 사라졌는지.
//   [3] RPC 인자 이름 — db.ts 가 부르는 새 RPC 의 인자 키가 로컬 DB 함수의 실제 인자 이름과 같은지
//       (docker exec psql · 로컬 도커만 · 계정을 만들지 않는다). 다르면 PostgREST 가 404 로 조용히 실패한다.
//   [4] 왕복 — 앱 판정으로 RPC 를 부르고 shift_templates_all 로 다시 읽으면 매주 정확히 1건(이 날부터 계속 · 나중 행 앞 추가 ·
//       이 날만 · 직원 요청 → 사장 승인). ★로컬 전용: 계정 2개를 가입시키고 지운다. URL 이 로컬이 아니면 실패로 센다.
// 실행: node scripts/qa-shift-ui.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'shift-ui');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── [1] 순수 함수 ──────────────────────────────────────────────────────────
try {
  execFileSync('npx', ['tsc',
    'src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts',
    '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }
const fp = join(OUT, 'schedule.js');
writeFileSync(fp, readFileSync(fp, 'utf8').split("'@/lib/utils/attendance'").join("'./attendance.js'"), 'utf8');
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
const S = await import(pathToFileURL(fp));
const fn = (name) => (typeof S[name] === 'function' ? S[name] : null);
// 새 함수가 없으면(수정 전) **지금 코드의 판정**으로 같은 케이스를 돌린다 — 함수가 없어서가 아니라 판정이 틀려서 RED 여야 한다.
//   지금 shiftsOn 의 필터 = `t.date ? t.date === date : t.weekday === wd`(요일만) · 지금 ShiftQuickSheet = 같은 직원·요일 첫 행을 고친다.
const storeSrc0 = read('src/lib/store/useScheduleStore.ts');
const quickSrc0 = read('src/components/schedule/ShiftQuickSheet.tsx');
const legacyApplies = storeSrc0.includes('t.date ? t.date === date : t.weekday === wd')
  ? (t, d) => (t.date ? t.date === d : t.weekday === S.weekdayOf(d)) : null;
const legacyPlan = quickSrc0.includes('templates.find((t) => t.staff_id === staffId && !t.date && t.weekday === wd)')
  ? (tpls, staffId, wds, date, start, end) => wds.map((wd) => {
      const ex = tpls.find((t) => t.staff_id === staffId && !t.date && t.weekday === wd);
      return ex ? { kind: 'edit', id: ex.id, from: date } : { kind: 'add', weekday: wd, from: date };
    }) : null;
const applies = fn('shiftAppliesOn') ?? legacyApplies;
const plan = fn('planSeriesSave') ?? legacyPlan;
if (!fn('shiftAppliesOn')) console.log('  (shiftAppliesOn 없음 → 지금 shiftsOn 판정으로 실행)');
if (!fn('planSeriesSave')) console.log('  (planSeriesSave 없음 → 지금 ShiftQuickSheet 판정으로 실행)');

const days = (from, to) => { const out = []; for (let d = from; d <= to; d = S.addDays(d, 1)) out.push(d); return out; };
const MON = 1, TUE = 2, WED = 3;   // 2026-10-05 = 월 · 10-06 = 화 · 09-29 = 화

console.log('\n■ [1-1] shiftAppliesOn — 적용 기간');
check('shiftAppliesOn 이 schedule.ts 에 있다', !!fn('shiftAppliesOn'));
if (applies) {
  const fromOct6 = { weekday: TUE, date: null, valid_from: '2026-10-06', valid_to: null };
  check('★10/6부터 적용한 화요일 행이 9/29(화)에 잡히지 않는다', applies(fromOct6, '2026-09-29') === false);
  check('10/6부터 적용한 화요일 행이 10/6·10/13 에 잡힌다', applies(fromOct6, '2026-10-06') && applies(fromOct6, '2026-10-13'));
  check('요일이 다르면 잡히지 않는다(10/7 수)', applies(fromOct6, '2026-10-07') === false);
  const closed = { weekday: MON, date: null, valid_from: '2000-01-01', valid_to: '2026-10-05' };
  check('10/5에 끝난 행은 10/5(월)까지 잡히고 10/12 에는 안 잡힌다', applies(closed, '2026-10-05') && !applies(closed, '2026-10-12'));
  const dated = { weekday: null, date: '2026-10-08', valid_from: '2026-10-08', valid_to: null };
  check('날짜 지정 행은 그 날짜에만(기간 칸과 무관)', applies(dated, '2026-10-08') && !applies(dated, '2026-10-15'));
  const noPeriod = { weekday: MON, date: null };
  check('기간 칸이 없는 행(옛 데이터·데모)은 요일만 본다', applies(noPeriod, '2026-09-28') && applies(noPeriod, '2026-10-05'));

  // 나눈 두 행(지난 구간 복사본 + 원래 id) — 경계 앞뒤 어느 날이든 그 요일엔 정확히 1건, 다른 요일엔 0건.
  const copy = { id: 'copy', weekday: MON, date: null, valid_from: '2000-01-01', valid_to: '2026-10-05' };
  const orig = { id: 'orig', weekday: MON, date: null, valid_from: '2026-10-06', valid_to: null };
  let bad = [];
  for (const d of days('2026-09-01', '2026-11-30')) {
    const n = [copy, orig].filter((t) => applies(t, d)).length;
    const want = S.weekdayOf(d) === MON ? 1 : 0;
    if (n !== want) bad.push(`${d}=${n}`);
  }
  check('★나눈 두 행(월요일 · 경계 10/6 화): 9/1~11/30 어느 월요일이든 정확히 1건(중복 0 · 빈 날 0)', bad.length === 0, bad.slice(0, 5).join(' '));
  // 화요일 경계(10/6 화 = 원래 행 시작)도 같은 규칙인지 — 경계 날이 요일과 맞지 않아도 한 주도 비지 않는다.
  const copyT = { weekday: 2, date: null, valid_from: '2000-01-01', valid_to: '2026-10-05' };
  const origT = { weekday: 2, date: null, valid_from: '2026-10-06', valid_to: null };
  bad = [];
  for (const d of days('2026-09-01', '2026-11-30')) {
    if (S.weekdayOf(d) !== 2) continue;
    const n = [copyT, origT].filter((t) => applies(t, d)).length;
    if (n !== 1) bad.push(`${d}=${n}`);
  }
  check('나눈 두 행(화요일 경계 = 원래 행 첫날): 매주 화요일 정확히 1건', bad.length === 0, bad.slice(0, 5).join(' '));

  // 골든: 2000-01-01 로 채운 기존 행은 옛 판정(요일만 · 날짜 지정은 그 날짜)과 지난 3개월 내내 같다.
  const old = (t, d) => (t.date ? t.date === d : t.weekday === S.weekdayOf(d));
  const backfilled = [
    ...[1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, date: null, valid_from: '2000-01-01', valid_to: null })),
    ...[0, 6].map((wd) => ({ weekday: wd, date: null, valid_from: '2000-01-01', valid_to: null })),
    { weekday: null, date: '2026-08-15', valid_from: '2000-01-01', valid_to: null },
    { weekday: null, date: '2026-09-02', valid_from: '2000-01-01', valid_to: null },
  ];
  bad = [];
  for (const d of days('2026-07-01', '2026-09-30')) {
    for (const t of backfilled) if (applies(t, d) !== old(t, d)) bad.push(`${d}/${t.weekday ?? t.date}`);
  }
  check('★골든: 2000-01-01 백필 행은 7~9월 내내 옛 판정과 같다(지난 급여 불변)', bad.length === 0, bad.slice(0, 5).join(' '));
}

console.log('\n■ [1-2] planSeriesSave — "한 요일 반복은 하나"는 그날 적용 중인 행 기준');
check('planSeriesSave 가 schedule.ts 에 있다', !!fn('planSeriesSave'));
if (plan) {
  const me = 'u1';
  const closedMon = { id: 't_closed', staff_id: me, weekday: MON, date: null, valid_from: '2000-01-01', valid_to: '2026-09-28', start: '09:00', end: '13:00' };
  let ops = plan([closedMon], me, [MON], '2026-10-05', '10:00', '14:00');
  check('★9/28에 끝난 월요일 행은 고치지 않고 10/5부터 새로 넣는다',
    ops.length === 1 && ops[0].kind === 'add' && ops[0].weekday === MON && ops[0].from === '2026-10-05', JSON.stringify(ops));

  const liveMon = { id: 't_live', staff_id: me, weekday: MON, date: null, valid_from: '2000-01-01', valid_to: null, start: '09:00', end: '13:00' };
  ops = plan([closedMon, liveMon], me, [MON], '2026-10-05', '10:00', '14:00');
  check('적용 중인 월요일 행은 그 행을 10/5부터 고친다(edit)',
    ops.length === 1 && ops[0].kind === 'edit' && ops[0].id === 't_live' && ops[0].from === '2026-10-05', JSON.stringify(ops));

  ops = plan([liveMon], me, [MON], '2026-10-05', '09:00', '13:00');
  check('시각이 같으면 아무것도 하지 않는다', ops.length === 0, JSON.stringify(ops));

  ops = plan([liveMon], me, [MON, WED], '2026-10-05', '10:00', '14:00');
  const wed = ops.find((o) => o.kind === 'add' && o.weekday === WED);
  check('수요일은 그 주 첫 수요일(10/7)부터 새로 넣는다', !!wed && wed.from === '2026-10-07', JSON.stringify(ops));

  const other = { ...liveMon, id: 't_other', staff_id: 'u2' };
  ops = plan([other], me, [MON], '2026-10-05', '10:00', '14:00');
  check('다른 직원의 행은 보지 않는다', ops.length === 1 && ops[0].kind === 'add', JSON.stringify(ops));

  const datedMon = { id: 't_dated', staff_id: me, weekday: null, date: '2026-10-05', valid_from: '2026-10-01', valid_to: null, start: '09:00', end: '13:00' };
  ops = plan([datedMon], me, [MON], '2026-10-05', '10:00', '14:00');
  check('날짜 지정 행은 반복 판정 대상이 아니다', ops.length === 1 && ops[0].kind === 'add', JSON.stringify(ops));

  const futureMon = { id: 't_future', staff_id: me, weekday: MON, date: null, valid_from: '2026-10-19', valid_to: null, start: '09:00', end: '13:00' };
  ops = plan([futureMon], me, [MON], '2026-10-05', '10:00', '14:00');
  check('★10/19부터 시작하는 행이 있으면 새 행은 10/5부터 넣고 그 전날로 닫는다(이후 두 벌 금지)',
    ops.length === 1 && ops[0].kind === 'add' && ops[0].from === '2026-10-05' && ops[0].endBefore === '2026-10-19', JSON.stringify(ops));
}

// ── [2] 소스 계약 ──────────────────────────────────────────────────────────
console.log('\n■ [2] 소스 계약');
const store = read('src/lib/store/useScheduleStore.ts');
const db = read('src/lib/db.ts');
const quick = read('src/components/schedule/ShiftQuickSheet.tsx');
const mine = read('src/components/schedule/MyShiftSheet.tsx');
const today = read('src/components/hub/JuniorTodayView.tsx');
const ownerSched = read('src/app/owner/schedule.tsx');
const juniorSched = read('src/app/junior/schedule.tsx');
const dash = read('src/lib/hooks/useOwnerDashboardData.ts');
const dashScreen = read('src/app/owner/dashboard.tsx');
const sheetView = read('src/components/TimesheetView.tsx');
const notify = read('src/lib/push/notify.ts');
const fnBody = (src, name) => {
  const i = src.search(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${name}\\s*[(<]`));
  if (i < 0) return '';
  const j = src.indexOf('\n}', i);
  return src.slice(i, j < 0 ? undefined : j);
};

check('ShiftTemplate 타입에 valid_from · valid_to 가 있다', /export type ShiftTemplate = \{[^}]*valid_from[^}]*valid_to[^}]*\}/s.test(store));
check('shiftsOn 이 shiftAppliesOn(요일 + 적용 기간)으로 거른다', /shiftAppliesOn\(/.test(fnBody(store, 'shiftsOn')));
check('JuniorTodayView 가 자체 요일 판정(onDay) 대신 shiftsOn 을 쓴다', /shiftsOn\(/.test(today) && !/const onDay\s*=/.test(today));
check('fetchShiftTemplates 가 shift_templates_all RPC 를 쓴다', /rpc\(\s*'shift_templates_all'/.test(fnBody(db, 'fetchShiftTemplates')));
check('insertShiftTemplate 가 writeStrict(0행 = 실패)를 쓴다', /writeStrict\(/.test(fnBody(db, 'insertShiftTemplate')));
check('옛 직접 수정·삭제(updateShiftTemplate · deleteShiftTemplate)가 db.ts 에 없다',
  !/function\s+updateShiftTemplate|function\s+deleteShiftTemplate/.test(db));
check('직원 직접 수정 RPC(update_my_shift_time)를 앱이 부르지 않는다', !/'update_my_shift_time'/.test(db) && !/editMyShiftTime/.test(store));
check('근무표 실시간이 shift_change_requests 도 듣는다', /table:\s*'shift_change_requests'/.test(fnBody(db, 'subscribeSchedule')));
check('직원 junior/schedule 의 겹침 판정(conflictOf)이 적용 기간을 본다', /shiftAppliesOn\(/.test(juniorSched));

check('ShiftQuickSheet: "이 날부터 계속"(기본) · "이 날만" 범위 선택이 있다', /이 날부터 계속/.test(quick) && /이 날만/.test(quick));
check('ShiftQuickSheet: 지울 때도 "이 날부터 그만" · "이 날만 빼기"를 고른다', /이 날부터 그만/.test(quick) && /이 날만 빼기/.test(quick));
check('ShiftQuickSheet: 지난 날짜 안내 문구가 있다', /지난 날짜부터 바꾸면 그 기간 급여도 바뀌어요\./.test(quick));
check('ShiftQuickSheet: 저장은 RPC 액션으로(updateTemplate · removeTemplate 직접 쓰기 없음)',
  !/updateTemplate|removeTemplate/.test(quick) && /editShiftFrom|overrideShiftDay|endShiftFrom|addShiftSeries/.test(quick));
check('ShiftQuickSheet: 반복 저장 판정은 planSeriesSave(그날 적용 중인 행)', /planSeriesSave\(/.test(quick));
// 시트(Modal) 위에 확인창(Modal)을 띄우지 않는다(iOS) — 시트 안 확인 단계가 같은 문구(PAST_CHANGE_*)를 쓴다.
check('ShiftQuickSheet: 지난 날짜는 확인 단계(같은 경고 문구)를 거친 뒤에만 p_confirm_past 를 보낸다',
  /PAST_CHANGE_TITLE/.test(quick) && /PAST_CHANGE_BODY/.test(quick) && /send\(true,/.test(quick) && !/confirmPastChange\(/.test(quick));
check('경고창 문구 = "지난 기간이에요" · "그 기간 급여가 바뀌어요."',
  /지난 기간이에요/.test(read('src/lib/utils/confirm.ts')) && /그 기간 급여가 바뀌어요\./.test(read('src/lib/utils/confirm.ts')));

check('MyShiftSheet: "이 날 하루만 바뀌어요. 사장님이 승인하면 급여에 반영돼요."',
  /이 날 하루만 바뀌어요\. 사장님이 승인하면 급여에 반영돼요\./.test(mine));
check('MyShiftSheet: 지키지 않던 약속(‘직원 수정’으로 보이고)이 사라졌다', !/직원 수정’으로 보이고/.test(mine));
check('MyShiftSheet: 저장 = 요청(requestShiftTime)', /requestShiftTime/.test(mine));
check('db.ts: request_shift_time · decide_shift_time · shift_change_requests 읽기',
  /'request_shift_time'\s*,/.test(db) && /'decide_shift_time'\s*,/.test(db) && /from\(\s*'shift_change_requests'\s*\)/.test(db));
check('알림: 시간 수정 요청은 사장에게(audience owners · ownerOnly)',
  /audience:\s*'owners',\s*\n\s*ownerOnly:\s*true,[\s\S]{0,200}shift-time/.test(notify));
check('사장 근무표: 시간 수정 요청 승인 칸(decideShiftTime · 지난 날짜는 경고창)',
  /decideShiftTime/.test(ownerSched) && /pendingTimeRequests/.test(ownerSched) && /confirmPastChange\(/.test(ownerSched));
check('홈 다음 행동 수에 시간 수정 요청이 더해진다', /pendingTimeRequests/.test(dash) && /pendingTimeRequests|pendingShiftTimes/.test(dashScreen));
check('TimesheetView: "승인 대기 N건"', /승인 대기 \{/.test(sheetView) || /승인 대기 \$\{/.test(sheetView));

// ── [3] RPC 인자 이름 = 로컬 DB 함수 인자 ────────────────────────────────────
console.log('\n■ [3] db.ts 가 보내는 RPC 인자 키 = 로컬 DB 함수 인자 이름');
const RPCS = ['add_shift_series', 'edit_shift_from', 'end_shift_from', 'override_shift_day', 'request_shift_time', 'decide_shift_time'];
let dbArgs = null;
try {
  const sql = `select p.proname || '=' || coalesce(string_agg(a, ',' order by a), '') from pg_proc p
    cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) a
    where p.pronamespace = 'public'::regnamespace and p.proname in (${RPCS.map((r) => `'${r}'`).join(',')})
    group by p.oid, p.proname`;
  const out = execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-tAc', sql], { encoding: 'utf8' });
  dbArgs = Object.fromEntries(out.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [k, v] = l.split('='); return [k, v.split(',')]; }));
} catch (e) {
  check('로컬 도커 DB 에 접속', false, String(e.message ?? e).slice(0, 120));
}
if (dbArgs) {
  for (const name of RPCS) {
    // supabase.rpc('name', {...}) 이든 rpcOk('라벨', 'name', {...}) 이든 이름 바로 뒤 인자 객체를 본다.
    const m = db.match(new RegExp(`'${name}'\\s*,\\s*\\{([^}]*)\\}`));
    if (!m) { check(`${name}: db.ts 가 부른다`, false, '(호출 없음)'); continue; }
    const keys = [...m[1].matchAll(/(p_[a-z_]+)\s*:/g)].map((x) => x[1]);
    const want = dbArgs[name] ?? [];
    const unknown = keys.filter((k) => !want.includes(k));
    check(`${name}: 인자 ${keys.join(',')} ⊆ DB(${want.join(',')})`, keys.length > 0 && unknown.length === 0, unknown.length ? `모르는 키 ${unknown}` : '');
  }
}

// ── [4] 왕복 — 앱 판정(planSeriesSave·shiftAppliesOn)으로 RPC 를 부르고 shift_templates_all 로 다시 읽으면 매일 정확히 1건 ──
//   db.ts 와 같은 인자 · 같은 매핑. ★로컬 전용: 계정을 가입시키고 지운다. URL 이 로컬이 아니면 이 절을 실패로 센다.
console.log('\n■ [4] 왕복(로컬 도커) — 앱 판정 → RPC → shift_templates_all → 매일 정확히 1건');
{
  const { createClient } = await import('@supabase/supabase-js');
  const { seedVerifiedPhones, cleanupSeededPhones } = await import('./qa-otp-seed.mjs');
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of read(f).split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); }
    } catch { /* skip */ }
  }
  const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!plan || !applies || !URL_ || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
    check('[4] 로컬 도커 대상 · 판정 함수 있음', false, `대상=${URL_}`);
  } else {
    const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
    const sfx = String(Date.now()).slice(-9);
    const phones = ['0176', '0177'].map((p) => `${p}${sfx.slice(0, 7)}`);
    const users = [], units = [];
    const T = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 오늘(KST)
    const wdT = S.weekdayOf(T);
    // db.ts fetchShiftTemplates 와 같은 매핑
    const readAll = async (c) => {
      const { data, error } = await c.rpc('shift_templates_all');
      if (error) throw new Error('shift_templates_all: ' + error.message);
      return (data ?? []).map((r) => ({ id: r.id, staff_id: r.staff_id, weekday: r.weekday, date: r.shift_date ?? null,
        start: r.start_time, end: r.end_time, valid_from: r.valid_from ?? null, valid_to: r.valid_to ?? null }));
    };
    const readExc = async (c) => ((await c.from('shift_exceptions').select('template_id, date')).data ?? []);
    // shiftsOn 과 같은 규칙(적용 기간 + 그날 예외는 반복 행에만)
    const on = (tpls, exc, d, staff) => tpls.filter((t) => t.staff_id === staff && applies(t, d)
      && (t.date !== null || !exc.some((e) => e.template_id === t.id && e.date === d)));
    try {
      await seedVerifiedPhones(URL_, SRV, phones);
      const sign = async (i, name, role) => {
        const c = mk();
        const r = await c.auth.signUp({ email: `qa_sui_${i}_${sfx}@example.com`, password: 'Test1234!qa',
          options: { data: { name, role, phone: phones[i], birth_date: '1990-01-15' } } });
        if (r.error || !r.data.session) throw new Error(`${name} signUp: ${r.error?.message ?? 'no session'}`);
        users.push(r.data.user.id);
        return { c, id: r.data.user.id };
      };
      const O = await sign(0, 'QA화면사장', 'owner');
      const J = await sign(1, 'QA화면직원', 'junior');
      const { data: st, error: se } = await O.c.rpc('create_store', { p_store_name: 'QA화면카페', p_industry: '카페·디저트', p_biz_no: null });
      const UNIT = st?.[0]?.unit_id;
      if (se || !UNIT) throw new Error('create_store: ' + (se?.message ?? 'no row'));
      units.push(UNIT);
      await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
      await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
      if ((await J.c.rpc('join_by_invite', { p_code: st[0].invite_code })).error) throw new Error('join');
      if ((await O.c.rpc('approve_member', { p_uid: J.id })).error) throw new Error('approve');
      await J.c.rpc('switch_active_unit', { p_unit_id: UNIT });

      // 배포 전부터 있던 반복 근무(2000-01-01 부터 · 생성일 200일 전)
      const L1 = `qa_sui_l1_${sfx}`;
      await admin.from('shift_templates').insert({ id: L1, unit_id: UNIT, staff_id: J.id, weekday: wdT, shift_date: null,
        start_time: '09:00', end_time: '13:00', created_at: new Date(Date.now() - 200 * 864e5).toISOString() });
      execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qc',
        `update public.shift_templates set valid_from = '2000-01-01' where id = '${L1}'`]);

      // 4-1 "이 날부터 계속": planSeriesSave → edit_shift_from(오늘부터) → 지난 주는 옛 시각, 오늘부터 새 시각, 매주 1건
      let tpls = await readAll(O.c);
      const ops = plan(tpls, J.id, [wdT], T, '10:00', '14:00');
      check('4-1 적용 중인 행을 오늘부터 고치는 계획', ops.length === 1 && ops[0].kind === 'edit' && ops[0].id === L1 && ops[0].from === T, JSON.stringify(ops));
      const e1 = await O.c.rpc('edit_shift_from', { p_id: L1, p_from: T, p_start: '10:00', p_end: '14:00', p_confirm_past: false });
      check('4-1 edit_shift_from 성공', !e1.error, e1.error?.message);
      tpls = await readAll(O.c);
      let exc = await readExc(O.c);
      let bad = [];
      for (let k = -4; k <= 4; k++) {
        const d = S.addDays(T, 7 * k);
        const got = on(tpls, exc, d, J.id);
        const want = k < 0 ? '09:00' : '10:00';
        if (got.length !== 1 || got[0].start !== want) bad.push(`${d}:${got.map((g) => g.start).join('+') || '없음'}`);
      }
      check('★4-1 4주 전~4주 뒤 매주 정확히 1건 · 지난 주 09:00 그대로 · 오늘부터 10:00', bad.length === 0, bad.join(' '));

      // 4-2 나중에 시작하는 행이 있는 요일에 반복 추가 → 새 행은 그 전날로 닫혀 두 벌이 없다
      const wd2 = (wdT + 1) % 7;
      const first2 = S.nextDateForWeekday(T, wd2);
      const fut = await O.c.rpc('add_shift_series', { p_staff: J.id, p_weekday: wd2, p_from: S.addDays(first2, 14), p_start: '15:00', p_end: '19:00', p_confirm_past: false });
      check('4-2 2주 뒤부터 시작하는 행 준비', !fut.error, fut.error?.message);
      tpls = await readAll(O.c);
      const ops2 = plan(tpls, J.id, [wd2], T, '08:00', '12:00');
      check('4-2 계획 = 이번 주부터 넣고 그 행 시작 전날로 닫기', ops2.length === 1 && ops2[0].kind === 'add' && ops2[0].from === first2 && ops2[0].endBefore === S.addDays(first2, 14), JSON.stringify(ops2));
      const add = await O.c.rpc('add_shift_series', { p_staff: J.id, p_weekday: wd2, p_from: ops2[0].from, p_start: '08:00', p_end: '12:00', p_confirm_past: false });
      const end = add.error ? add : await O.c.rpc('end_shift_from', { p_id: add.data, p_from: ops2[0].endBefore, p_confirm_past: false });
      check('4-2 add_shift_series → end_shift_from 성공', !add.error && !end.error, add.error?.message ?? end.error?.message);
      tpls = await readAll(O.c);
      exc = await readExc(O.c);
      bad = [];
      for (let k = 0; k <= 5; k++) {
        const d = S.addDays(first2, 7 * k);
        const got = on(tpls, exc, d, J.id);
        const want = k < 2 ? '08:00' : '15:00';
        if (got.length !== 1 || got[0].start !== want) bad.push(`${d}:${got.map((g) => g.start).join('+') || '없음'}`);
      }
      check('★4-2 6주 동안 매주 정확히 1건(2주 동안 08:00 · 그 뒤 15:00)', bad.length === 0, bad.join(' '));

      // 4-3 "이 날만": 다음 주 그날만 바꾸면 그날만 1건(새 시각), 그다음 주는 원래대로
      const nextW = S.addDays(T, 7);
      const o1 = await O.c.rpc('override_shift_day', { p_id: L1, p_date: nextW, p_start: '11:00', p_end: '15:00', p_confirm_past: false });
      check('4-3 override_shift_day 성공', !o1.error, o1.error?.message);
      tpls = await readAll(O.c);
      exc = await readExc(O.c);
      const g1 = on(tpls, exc, nextW, J.id), g2 = on(tpls, exc, S.addDays(T, 14), J.id);
      check('★4-3 그날만 11:00 1건 · 그다음 주는 10:00 1건', g1.length === 1 && g1[0].start === '11:00' && g2.length === 1 && g2[0].start === '10:00',
        `${g1.map((g) => g.start)} / ${g2.map((g) => g.start)}`);

      // 4-4 직원 요청 → 사장 화면이 읽는 열로 1건 → 승인하면 그날만 바뀐다
      const rq = await J.c.rpc('request_shift_time', { p_template: L1, p_date: T, p_start: '10:30', p_end: '14:30' });
      check('4-4 request_shift_time 성공(직원)', !rq.error, rq.error?.message);
      const { data: pend, error: pe } = await O.c.from('shift_change_requests')
        .select('id, staff_id, template_id, date, old_start, old_end, new_start, new_end, note, created_at').eq('status', 'pending');
      check('4-4 사장이 대기 요청 1건을 읽는다(db.ts 와 같은 열)', !pe && pend?.length === 1 && pend[0].date === T && pend[0].new_start === '10:30' && pend[0].staff_id === J.id,
        pe?.message ?? JSON.stringify(pend));
      const { data: mine } = await J.c.from('shift_change_requests').select('id').eq('status', 'pending');
      check('4-4 직원도 자기 대기 요청을 읽는다(시트 표시)', mine?.length === 1);
      const dc = pend?.[0] ? await O.c.rpc('decide_shift_time', { p_id: pend[0].id, p_approve: true, p_confirm_past: false }) : { error: { message: 'no req' } };
      check('4-4 decide_shift_time(오늘 · 확인 불필요) = true', !dc.error && dc.data === true, dc.error?.message ?? String(dc.data));
      tpls = await readAll(O.c);
      exc = await readExc(O.c);
      const gT = on(tpls, exc, T, J.id), gN = on(tpls, exc, S.addDays(T, 14), J.id);
      check('★4-4 승인 뒤 오늘만 10:30 1건 · 2주 뒤는 10:00 그대로', gT.length === 1 && gT[0].start === '10:30' && gN.length === 1 && gN[0].start === '10:00',
        `${gT.map((g) => g.start)} / ${gN.map((g) => g.start)}`);
    } catch (e) {
      check('[4] 예외 없이 끝남', false, e.message);
    } finally {
      for (const id of users) { try { await admin.auth.admin.deleteUser(id); } catch { /* best-effort */ } }
      for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
      try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
    }
  }
}

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
await rm(OUT, { recursive: true, force: true }).catch(() => {});
process.exit(fail > 0 ? 1 : 0);
