#!/usr/bin/env node
// qa-review-applogic.mjs — 2026-10-05 리뷰(영역 app-logic)에서 확인된 결함의 회귀 하네스.
//
// 무엇을 보나
//   [1] 근무 시간 수정 요청 35일 — 서버 decide_shift_time 은 근무일 < 오늘-35 이면 승인을 too_old 로 거부한다.
//       앱은 그 요청에 [승인] 을 그리지 않고 "35일이 지나 반려만 할 수 있어요"를 보여 준다(판정 = timeRequestApprovable).
//       서버가 too_old 로 거부하면 일반 실패 문구가 아니라 그 이유를 말한다.
//   [2] 직원·급여 히어로 "이번 달 예상 인건비"가 "이번 정산 기간 퇴사자" 줄의 금액까지 더한다.
//   [3] TimesheetView 승인 대기 안내 — 사장만 "근무표에서 승인할 수 있어요". 매니저는 승인하지 못하므로 다른 문구다.
//   [4] 퇴사자 줄 계산(근무 여부 · 시급 대체 · 금액)이 순수 함수 departedPayRows 하나이고, 화면과 qa-tenure-ui 왕복이
//       그 함수를 그대로 부른다. 교대로 넘긴 근무(예외)는 근무로 치지 않는다.
// 실행: node scripts/qa-review-applogic.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'review-applogic');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };

const utils = ['attendance', 'schedule', 'payroll', 'tenure'];
try {
  execFileSync('npx', ['tsc', ...utils.map((u) => `src/lib/utils/${u}.ts`),
    '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* 타입 경고가 있어도 산출물은 나온다 — 산출물 존재로 판정 */ }
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
for (const u of utils) {
  const fp = join(OUT, `${u}.js`);
  if (!existsSync(fp)) continue;
  writeFileSync(fp, readFileSync(fp, 'utf8')
    .replace(/'@\/lib\/utils\/([a-zA-Z]+)'/g, "'./$1.js'")
    .replace(/'\.\/([a-zA-Z]+)'/g, "'./$1.js'"), 'utf8');
}
const load = async (u) => (existsSync(join(OUT, `${u}.js`)) ? import(pathToFileURL(join(OUT, `${u}.js`))) : {});
const S = await load('schedule');
const P = await load('payroll');
const T = await load('tenure');

const TODAY = '2026-10-15';
const d = (n) => S.addDays(TODAY, n);

// ── [1] 근무 시간 수정 요청 35일 ─────────────────────────────────────────────
console.log('\n■ [1] 근무 시간 수정 요청 — 35일이 지나면 반려만');
// 함수가 없으면(수정 전) 지금 앱 판정으로 돈다: 카드는 언제나 [승인] 을 그린다.
const sched = read('src/app/owner/schedule.tsx');
const legacyTimeApprovable = sched.includes('onApprove={() => void approveTime(r)}') ? () => true : null;
const timeApprovable = typeof S.timeRequestApprovable === 'function' ? S.timeRequestApprovable : legacyTimeApprovable;
if (typeof S.timeRequestApprovable !== 'function') console.log('  (timeRequestApprovable 없음 → 지금 카드 판정(언제나 승인)으로 실행)');
const tr = (date) => ({ id: 'r', staff_id: 'A', template_id: 't', date, old_start: '09:00', old_end: '13:00', new_start: '09:00', new_end: '14:00', note: null, created_at: '' });
if (timeApprovable) {
  check('어제 요청은 승인할 수 있다', timeApprovable(tr(d(-1)), TODAY) === true);
  check('35일 전 요청은 승인할 수 있다(서버 date >= 오늘-35)', timeApprovable(tr(d(-35)), TODAY) === true);
  check('★36일 전 요청은 승인할 수 없다(서버가 too_old 로 거부)', timeApprovable(tr(d(-36)), TODAY) === false);
  check('오늘·미래 요청은 승인할 수 있다', timeApprovable(tr(TODAY), TODAY) && timeApprovable(tr(d(3)), TODAY));
}
check('교대와 같은 경계(PAST_SWAP_DAYS = 35)', S.PAST_SWAP_DAYS === 35);
try {
  const def = execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-tAc',
    "select pg_get_functiondef('public.decide_shift_time(text,boolean,boolean)'::regprocedure)"], { encoding: 'utf8' });
  check('로컬 DB decide_shift_time 도 오늘-35 로 자른다(too_old)', /kst_today\(\)\s*-\s*35/.test(def) && def.includes("'too_old'"));
} catch (e) {
  check('로컬 도커 psql 접근', false, String(e.message).slice(0, 120));
}
const cardAt = sched.indexOf('function TimeRequestCard');
const card = cardAt >= 0 ? sched.slice(cardAt, cardAt + 3000) : '';
check('★근무표 카드가 35일 지난 요청에 "35일이 지나 반려만 할 수 있어요"를 보인다', card.includes('35일이 지나 반려만 할 수 있어요'));
check('★근무표 카드가 승인 못 하는 요청에는 [승인] 을 그리지 않는다', /approvable\s*\?|approvable\s*&&|!approvable/.test(card));
check('근무표 화면이 timeRequestApprovable 로 판정한다', sched.includes('timeRequestApprovable('));
const db = read('src/lib/db.ts');
const rpcAt = db.indexOf('export async function decideShiftTimeRpc');
check('decideShiftTimeRpc 가 too_old 를 따로 돌려준다', rpcAt >= 0 && db.slice(rpcAt, rpcAt + 700).includes('too_old'));
const store = read('src/lib/store/useScheduleStore.ts');
const decAt = store.indexOf('decideShiftTime: async');
check('★스토어가 too_old 에 이유를 말한다("35일이 지난 요청은 반려만 할 수 있어요")',
  decAt >= 0 && store.slice(decAt, decAt + 1500).includes('35일이 지난 요청은 반려만 할 수 있어요'));

// ── [2] 히어로 인건비에 퇴사자 금액 ───────────────────────────────────────────
console.log('\n■ [2] 이번 달 예상 인건비 = 지금 직원 + 이번 정산 기간 퇴사자');
const staffScr = read('src/app/owner/staff.tsx');
const totalLine = (staffScr.match(/const totalPay = [^\n]*/) ?? [''])[0];
check('★totalPay 가 departed 금액을 더한다', /departed/.test(totalLine), totalLine);
check('히어로 설명에 퇴사자 포함을 말한다', /퇴사자 \$\{departed\.length\}명 포함/.test(staffScr));

// ── [3] 매니저 승인 대기 안내 ─────────────────────────────────────────────────
console.log('\n■ [3] TimesheetView 승인 대기 안내 — 승인은 사장만');
const tv = read('src/components/TimesheetView.tsx');
check('TimesheetView 가 세션 역할을 읽는다', tv.includes('useSessionStore'));
check('★사장이 아닌 관리자에게는 "사장님이 근무표에서 승인해요"', tv.includes('사장님이 근무표에서 승인해요'));
check('"근무표에서 승인할 수 있어요"는 세션이 사장일 때만', /sessionIsOwner[^\n]*근무표에서 승인할 수 있어요|canApprove[^\n]*근무표에서 승인할 수 있어요/.test(tv));

// ── [4] 퇴사자 줄 계산 = 순수 함수 하나 ───────────────────────────────────────
console.log('\n■ [4] departedPayRows — 화면과 하니스가 같은 함수를 돈다');
const rows = typeof T.departedPayRows === 'function' ? T.departedPayRows : null;
check('departedPayRows 가 tenure.ts 에 있다', !!rows);
check('직원·급여 화면이 departedPayRows 를 부른다', staffScr.includes('departedPayRows('));
const tenUi = read('scripts/qa-tenure-ui.mjs');
check('qa-tenure-ui 왕복이 자체 workedIn 대신 departedPayRows 를 부른다', !/const workedIn\s*=/.test(tenUi) && tenUi.includes('departedPayRows'));
if (rows) {
  const ten = (o) => ({ id: 't', user_id: 'C', joined_at: '2026-01-01T00:00:00Z', left_at: '2026-10-10T00:00:00Z', name_snapshot: '퇴사자', final_hourly_wage: 11000, ...o });
  const tpl = (o) => ({ id: 'x', staff_id: 'C', weekday: null, date: null, start: '09:00', end: '13:00', valid_from: null, valid_to: null, ...o });
  const rules = { breakDeduction: false, nightAllowance: false, overtimeAllowance: false, weeklyHolidayPay: false, extraAllowance: 0 };
  // 2026-10: 월요일 5·12·19·26, 토요일 3·10·17·24·31.
  const input = {
    tenures: [
      ten({ id: 'c1', user_id: 'C', name_snapshot: '씨', final_hourly_wage: 11000 }),
      ten({ id: 'd1', user_id: 'D', name_snapshot: '디', left_at: '2026-10-04T00:00:00Z' }),
      ten({ id: 'e1', user_id: 'E', name_snapshot: '이', final_hourly_wage: 9000 }),
    ],
    memberIds: ['O', 'A'],
    ym: '2026-10',
    records: [{ staff_id: 'E', date: '2026-10-02', check_in: '2026-10-02T00:00:00Z', check_out: '2026-10-02T02:00:00Z', work_minutes: 120 }],
    templates: [
      tpl({ id: 'tc', staff_id: 'C', weekday: 1, valid_to: '2026-10-10' }),          // C: 월 09-13, 10/10 에 닫힘 → 10/5 하루
      tpl({ id: 'td', staff_id: 'D', weekday: 6, valid_to: '2026-10-04' }),          // D: 토 09-13 → 10/3 하루뿐인데
      tpl({ id: 'ta', staff_id: 'A', date: '2026-10-03' }),                           //    교대로 A 에게 넘어갔다
    ],
    swaps: [],
    exceptions: [{ template_id: 'td', date: '2026-10-03' }],
    wages: { E: 12000 },
    settings: rules,
  };
  const out = rows(input);
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  check('★교대로 이번 달 근무를 다 넘긴 퇴사자(D)는 줄에 없다', !byId.D, JSON.stringify(out));
  check('지금 멤버(O·A)는 줄에 없다', !byId.O && !byId.A);
  check('★C 는 wages 가 없어 final_hourly_wage(11000)로 4시간 = 44,000원', byId.C?.pay === 44000 && byId.C?.schedMin === 240, JSON.stringify(byId.C));
  check('C 금액은 computePay 와 같다', !!P.computePay && byId.C?.pay === P.computePay(P.shiftsToPayRecords([{ date: '2026-10-05', start: '09:00', end: '13:00' }]), 11000, rules).total);
  check('E 는 출퇴근만 있어도 줄에 잡히고, wages(12000)가 final(9000)보다 먼저다', byId.E?.min === 120 && byId.E?.wage === 12000, JSON.stringify(byId.E));
  check('이름은 스냅샷에서 온다', byId.C?.name === '씨' && byId.E?.name === '이');
  const noWage = rows({ ...input, tenures: [ten({ id: 'c1', user_id: 'C', final_hourly_wage: null })], wages: {} });
  check('시급이 없으면 pay = null(0원과 구별)', noWage.length === 1 && noWage[0].pay === null, JSON.stringify(noWage));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
