#!/usr/bin/env node
// qa-audit-payroll.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 급여·근무표 묶음 재현 검사.
//   [A4] 시급을 바꾸면 그 자리에서 이번 달 예상 급여가 새 시급으로 바뀐다(앱을 다시 켜지 않아도).
//   [A5] 시급 이력을 못 읽으면 지난달 급여를 지금 시급으로 만들지 않고 "못 불러왔다"고 말한다.
//   [A8] 지난달 출퇴근 기록은 그 달 기간으로 따로 읽는다 — 최근 1,000건에 잘려 "안 찍었어요"가 거짓으로 뜨지 않는다.
//   [A10] 이미 승인·반려·취소된 교대는 낡은 화면의 취소·반려로 다시 바뀌지 않는다(서버 트리거 · 클라 상태 조건).
//         서버 검사는 로컬 도커(고정 계정 store_001 · 트랜잭션 되돌림)가 있을 때만 돈다.
//   [A7] 사장 홈 인건비 = 직원 관리 합계(이번 달 퇴사자 포함) · 직원 허브 예상 급여 = 출퇴근 화면(근무표 기준).
// 실행: node --no-warnings scripts/qa-audit-payroll.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let P = {};
try { P = await import('../src/lib/utils/payroll.ts'); } catch (e) { check('payroll.ts 를 읽는다', false, String(e?.code ?? e)); }

console.log('[A4] 시급을 바꾸면 이번 달 예상 급여가 바로 새 시급이다');
{
  const { wageForMonth, withTodayWage } = P;
  const today = '2026-10-12';
  const rates = [{ staff_id: 'a', hourly_wage: 10320, effective_from: '2000-01-01' }];
  const next = fn(withTodayWage) ? withTodayWage(rates, 'a', 12000, today) : rates;
  check('★바꾼 직후 이번 달 시급 = 12,000원', wageForMonth(next, 'a', '2026-10', today, 12000) === 12000, String(wageForMonth(next, 'a', '2026-10', today, 12000)));
  check('지난달 시급은 그대로 10,320원', wageForMonth(next, 'a', '2026-09', today, 12000) === 10320);
  const twice = fn(withTodayWage) ? withTodayWage(next, 'a', 12500, today) : next;
  check('같은 날 두 번 바꾸면 오늘 행 하나를 덮는다', twice.filter((r) => r.staff_id === 'a' && r.effective_from === today).length === 1 && wageForMonth(twice, 'a', '2026-10', today, 12500) === 12500);
  check('다른 직원 이력은 건드리지 않는다', fn(withTodayWage) && withTodayWage([...rates, { staff_id: 'b', hourly_wage: 11000, effective_from: today }], 'a', 12000, today).some((r) => r.staff_id === 'b' && r.hourly_wage === 11000));
  const st = strip(read('src/lib/store/usePayrollStore.ts'));
  check('★스토어 setWage 가 wageRates 에도 오늘 시급을 넣고, 실패하면 되돌린다', /setWage:[\s\S]*withTodayWage\(/.test(st) && /setWage:[\s\S]*wageRates: prevRates/.test(st));
}

console.log('\n[A5] 시급 이력 읽기 실패 = 지난달 금액을 만들지 않는다(배선)');
{
  const db = read('src/lib/db.ts'); // strip 은 db.ts 문자열 속 '/*' 에 걸려 본문을 지운다 — 원문으로 본다.
  const f = db.match(/export async function fetchWageRates[\s\S]*?\n}\n/)?.[0] ?? '';
  check('★fetchWageRates 가 실패를 신호로 돌려준다(ReadResult · readFail)', /Promise<ReadResult<WageRate\[\]>>/.test(f) && /readFail\('fetchWageRates'/.test(f) && /error: true/.test(f));
  const st = strip(read('src/lib/store/usePayrollStore.ts'));
  check('★스토어: 읽기 실패면 이전 이력을 덮지 않고 wageRatesLoadError 를 세운다', /wageRatesLoadError: ratesRes\.error/.test(st) && /ratesRes\.error \? \{\} : \{ wageRates: ratesRes\.data \}/.test(st));
  const tv = strip(read('src/components/TimesheetView.tsx'));
  check('★출근 기록 화면: 지난달 + 이력 실패면 금액 대신 안내', /wageRatesLoadError/.test(tv) && /pastRatesMissing/.test(tv) && /지난달 시급을 불러오지 못했어요/.test(tv));
}

// 함수의 마지막 정의 본문(가장 큰 번호 마이그레이션). create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let body = '', file = '';
  for (const f of files) {
    const s = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body, file };
};

console.log('\n[A7] 같은 "이번 달 인건비·예상 급여"는 화면마다 같은 공식이다');
{
  // (1) 사장 홈 인건비에 이번 달 퇴사자 몫이 들어간다(직원 관리 히어로와 같은 숫자).
  const ol = lastDef('owner_labor_inputs_v2');
  check('★owner_labor_inputs_v2 가 이번 달 퇴사자(닫힌 기간 · 지금 멤버 아님)를 준다', /departed\s+jsonb/.test(ol.body) && /member_tenures/.test(ol.body) && /left_at\s*>=/.test(ol.body) && /not exists[\s\S]*unit_members/.test(ol.body), ol.file);
  check('owner_labor_inputs_v2 권한 유지(authenticated 만)', new RegExp(`revoke all on function public\\.owner_labor_inputs_v2\\(\\) from public, anon, authenticated;\\s*\\ngrant execute on function public\\.owner_labor_inputs_v2\\(\\) to authenticated;`).test(read(`supabase/migrations/${ol.file}`)));
  const hub = strip(read('src/lib/store/useHubStore.ts'));
  check('★허브 laborByUnit 이 퇴사자 몫을 직원 관리와 같은 departedPayRows 로 더한다', /departedPayRows\(/.test(hub) && /r\.departed/.test(hub));
  // (2) 직원 허브 예상 급여 = 출퇴근 화면과 같은 근무표 기준 computePay.
  const mc = lastDef('my_cross_summary_v2');
  check('★my_cross_summary_v2 가 매장 급여 설정(payroll_settings)을 준다', /payroll_settings\s+jsonb/.test(mc.body) && /u\.payroll_settings/.test(mc.body), mc.file);
  check('my_cross_summary_v2 권한 유지(authenticated 만)', /revoke all on function public\.my_cross_summary_v2\(\) from public, anon, authenticated;\s*\ngrant execute on function public\.my_cross_summary_v2\(\) to authenticated;/.test(read(`supabase/migrations/${mc.file}`)));
  const jt = strip(read('src/components/hub/JuniorTodayView.tsx'));
  check('★직원 허브: 근무표(scheduledShiftsFor) → computePay 로 센다(출퇴근 분 × 시급 아님)', /computePay\(/.test(jt) && /scheduledShiftsFor\(/.test(jt) && !/month_minutes \/ 60\) \* r\.hourly_wage/.test(jt));
  check('직원 허브 ⓘ 가 근무표 기준이라고 말한다', /근무표/.test(jt) && !/근무 기록 × 시급/.test(jt));
}

console.log('\n[A8] 지난달 출퇴근 기록은 그 달 기간으로 따로 읽는다(최근 1,000건에 잘리지 않는다)');
{
  let A = {};
  try { A = await import('../src/lib/utils/attendance.ts'); } catch (e) { check('attendance.ts 를 읽는다', false, String(e?.code ?? e)); }
  const { replaceMonthRecords, keepLoadedMonths } = A;
  const rec = (id, staff_id, date, m = 60) => ({ id, staff_id, date, check_in: `${date}T00:00:00Z`, check_out: `${date}T01:00:00Z`, work_minutes: m });
  // 최근 1,000건 창 = 10월 기록만. 7월(석 달 전)은 창 밖이다.
  const window_ = [rec('o1', 'a', '2026-10-02'), rec('o2', 'b', '2026-10-02')];
  const july = [rec('j1', 'a', '2026-07-03'), rec('j2', 'a', '2026-07-04')];
  const after = fn(replaceMonthRecords) ? replaceMonthRecords(window_, 'a', '2026-07', july) : window_;
  check('★그 달 기록을 따로 읽어 넣으면 7월 기록 2건이 보인다', after.filter((r) => r.staff_id === 'a' && r.date.startsWith('2026-07')).length === 2);
  check('다른 달·다른 직원 기록은 그대로', after.some((r) => r.id === 'o1') && after.some((r) => r.id === 'o2'));
  const again = fn(replaceMonthRecords) ? replaceMonthRecords(after, 'a', '2026-07', [rec('j1', 'a', '2026-07-03', 90)]) : after;
  check('같은 달을 다시 읽으면 그 달 몫을 새 결과로 갈아끼운다(지운 기록은 빠진다)', again.filter((r) => r.date.startsWith('2026-07')).length === 1 && again.find((r) => r.id === 'j1')?.work_minutes === 90);
  // 실시간 갱신(hydrate)이 최근 창으로 records 를 갈아치워도, 따로 읽어 둔 달은 남는다.
  const fresh = [rec('o1', 'a', '2026-10-02'), rec('o3', 'a', '2026-10-03')];
  const kept = fn(keepLoadedMonths) ? keepLoadedMonths(fresh, after, ['a|2026-07']) : fresh;
  check('★hydrate 뒤에도 따로 읽어 둔 7월 기록이 남는다', kept.filter((r) => r.date.startsWith('2026-07')).length === 2 && kept.some((r) => r.id === 'o3'));
  check('읽어 두지 않은 달의 옛 행은 남기지 않는다', fn(keepLoadedMonths) && !keepLoadedMonths(fresh, window_, ['a|2026-07']).some((r) => r.id === 'o2'));
  const db = read('src/lib/db.ts');
  const f = db.match(/export async function fetchAttendanceMonth[\s\S]*?\n}\n/)?.[0] ?? '';
  check('★db: fetchAttendanceMonth 가 직원·기간 조건으로 읽고 실패를 신호로 돌려준다', /\.eq\('staff_id', staffId\)/.test(f) && /\.gte\('date'/.test(f) && /\.lte\('date'/.test(f) && /readFail\('fetchAttendanceMonth'/.test(f));
  const st = strip(read('src/lib/store/useAttendanceStore.ts'));
  check('★스토어: loadMonth 가 그 달을 읽어 넣고, hydrate 는 읽어 둔 달을 남긴다', /loadMonth:/.test(st) && /fetchAttendanceMonth\(/.test(st) && /replaceMonthRecords\(/.test(st) && /keepLoadedMonths\(/.test(st));
  const tv = strip(read('src/components/TimesheetView.tsx'));
  check('★출근 기록 화면: 지난달은 loadMonth 로 읽고, 다 읽기 전·실패면 대조 문구를 띄우지 않는다', /loadMonth\(staffId, ym\)/.test(tv) && /monthReady/.test(tv) && /이 달 기록을 불러오지 못했어요/.test(tv) && /monthReady \?[^;]*reconcileSchedule/.test(tv));
}

console.log('\n[A10] 이미 승인·반려·취소된 교대는 다시 바뀌지 않는다');
{
  const g = lastDef('swap_requests_decided_guard');
  check('★서버: swap_requests 의 끝난 요청(approved·rejected·cancelled) 상태를 바꾸면 거부하는 트리거', /old\.status in \('approved', 'rejected', 'cancelled'\)/.test(g.body) && /swap_already_decided/.test(g.body) && /before update on public\.swap_requests/.test(read(`supabase/migrations/${g.file}`)), g.file);
  const db = read('src/lib/db.ts');
  const f = db.match(/export async function updateSwap[\s\S]*?\n}\n/)?.[0] ?? '';
  check('★db: updateSwap 이 지금 상태를 조건으로 건다(0행 = 실패)', /\.in\('status', expect\)/.test(f) && /writeStrict\(/.test(f));
  const st = strip(read('src/lib/store/useScheduleStore.ts'));
  check('★스토어: 취소는 open·accepted 일 때만, 반려는 accepted 일 때만 · 실패하면 "이미 처리된 요청" 안내 뒤 다시 읽는다',
    /updateSwap\(id, \{ status: 'cancelled', updated_at: at \}, \['open', 'accepted'\]\)/.test(st)
    && /updateSwap\(id, \{ status: 'rejected', updated_at: at \}, \['accepted'\]\)/.test(st)
    && (st.match(/SWAP_ALREADY_DECIDED_TEXT/g) || []).length >= 3);
}
{
  // 서버(로컬 도커 트랜잭션 · 고정 계정 store_001 · 되돌림)
  const psql = (sql) => {
    try {
      return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
        { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
  };
  let up = true;
  try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { up = false; }
  if (!up) {
    console.log('  SKIP 서버 검사 — 로컬 도커 DB 없음');
  } else {
    const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.d', to_char(public.kst_today() + 3, 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from) values
  ('qa_a10_t', 'store_001', current_setting('qa.j'), null, current_setting('qa.d')::date, '09:00', '13:00', current_setting('qa.d')::date);
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by) values
  ('qa_a10_ap', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d'), 'qa_a10_t', 'approved', current_setting('qa.o')),
  ('qa_a10_ac', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d'), 'qa_a10_t', 'accepted', current_setting('qa.o'));
`;
    const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
    const run = (who, body) => psql(`${SETUP}${as(who)}${body}\nrollback;\n`);
    const r1 = run('o', `update public.swap_requests set status = 'rejected' where id = 'qa_a10_ap';`);
    check('★사장이 승인된 요청을 반려로 덮기 → swap_already_decided', r1.includes('swap_already_decided'), r1.slice(0, 160));
    const r2 = run('j', `update public.swap_requests set status = 'cancelled' where id = 'qa_a10_ap';`);
    check('★요청 직원이 승인된 요청을 취소로 덮기 → swap_already_decided', r2.includes('swap_already_decided'), r2.slice(0, 160));
    const r3 = run('o', `update public.swap_requests set status = 'rejected' where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('합의된(accepted) 요청 반려는 된다', r3.includes('R=rejected'), r3.slice(0, 160));
    const r4 = run('j', `update public.swap_requests set status = 'cancelled' where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('합의된(accepted) 요청 취소는 된다', r4.includes('R=cancelled'), r4.slice(0, 160));
    const r5 = psql(`${SETUP}update public.swap_requests set archived_tenure_id = null, updated_at = now() where id = 'qa_a10_ap' returning 'R=' || status;\nrollback;\n`);
    check('상태를 안 바꾸는 갱신(재입사 표시 등)은 막지 않는다', r5.includes('R=approved'), r5.slice(0, 160));
  }
}

console.log('\n[A11] 근무표 날짜 계산은 폰 시간대와 상관없다');
{
  let S = {};
  try { S = await import('../src/lib/utils/schedule.ts'); } catch (e) { check('schedule.ts 를 읽는다', false, String(e?.code ?? e)); }
  const { addDays, mondayOf, weekDates, weekdayOf, fmtMd, fmtDateKo, dayOfMonth, nextDateForWeekday } = S;
  const { computePay, shiftsToPayRecords } = P;
  const RULES = { breakDeduction: false, nightAllowance: true, overtimeAllowance: false, weeklyHolidayPay: false, extraAllowance: 0 };
  const saved = process.env.TZ;
  for (const tz of ['Asia/Seoul', 'Pacific/Guam', 'Pacific/Auckland', 'America/Los_Angeles']) {
    process.env.TZ = tz; // 노드는 실행 중 TZ 바꾸기를 따른다(Windows 포함 · 실측)
    const t = (n, ok, extra) => check(`${tz} · ${n}`, ok, extra);
    t('★addDays(10/05, +1) = 10/06', addDays('2026-10-05', 1) === '2026-10-06', addDays('2026-10-05', 1));
    t('addDays(10/05, 0) = 10/05 · 월말 넘김 10/31+1 = 11/01', addDays('2026-10-05', 0) === '2026-10-05' && addDays('2026-10-31', 1) === '2026-11-01');
    t('★10/05(월)의 요일 = 1 · 그 주 월요일 = 10/05', weekdayOf('2026-10-05') === 1 && mondayOf('2026-10-05') === '2026-10-05' && mondayOf('2026-10-11') === '2026-10-05');
    t('주간 7일 = 10/05~10/11', weekDates('2026-10-05').join(',') === ['05', '06', '07', '08', '09', '10', '11'].map((d) => `2026-10-${d}`).join(','));
    t('표기 10/5 · "10월 5일 (월)" · 5일', fmtMd('2026-10-05') === '10/5' && fmtDateKo('2026-10-05') === '10월 5일 (월)' && dayOfMonth('2026-10-05') === 5);
    t('다음 수요일(10/05부터) = 10/07', nextDateForWeekday('2026-10-05', 3) === '2026-10-07');
    const pay = computePay(shiftsToPayRecords([{ date: '2026-10-05', start: '22:00', end: '06:00' }]), 10000, RULES);
    t('★22:00~06:00 근무 = 8시간 · 야간수당 들어간다', pay.total === 120000, JSON.stringify({ total: pay.total }));
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
}

console.log('\n[A3] 급여 설정도 이력을 남기고 지난달은 그 달 기준 설정으로 센다(2026-10-06 결정 ①)');
{
  const { settingsForMonth, withTodaySettings, computePay, shiftsToPayRecords } = P;
  const today = '2026-10-20';
  const ON = { breakDeduction: true, nightAllowance: true, overtimeAllowance: false, weeklyHolidayPay: true, extraAllowance: 100000, periodStartDay: 1, payday: 10 };
  const OFF = { ...ON, weeklyHolidayPay: false, extraAllowance: 0 };
  const hist = [{ effective_from: '2000-01-01', settings: ON }, { effective_from: '2026-10-15', settings: OFF }];
  const S = (h, ym, fb) => (fn(settingsForMonth) ? settingsForMonth(h, ym, today, fb) : undefined);
  check('★9월 = 그 달 기준 설정(주휴 켬 · 추가수당 10만원)', S(hist, '2026-09', OFF)?.extraAllowance === 100000 && S(hist, '2026-09', OFF)?.weeklyHolidayPay === true, JSON.stringify(S(hist, '2026-09', OFF)));
  check('★이번 달(10월) = 오늘 적용 설정', S(hist, '2026-10', ON)?.extraAllowance === 0);
  check('이력이 없으면 지금 설정', S([], '2026-09', OFF) === OFF);
  const next = fn(withTodaySettings) ? withTodaySettings(hist, ON, today) : hist;
  check('★바꾼 직후 이력에 오늘 행이 들어가 이번 달이 새 설정 · 지난달은 그대로', S(next, '2026-10', OFF)?.extraAllowance === 100000 && S(next, '2026-09', OFF)?.extraAllowance === 100000 && next.filter((r) => r.effective_from === today).length === 1);
  if (fn(computePay) && fn(settingsForMonth)) {
    const recs = shiftsToPayRecords([{ date: '2026-09-07', start: '09:00', end: '18:00' }, { date: '2026-09-08', start: '09:00', end: '18:00' }]);
    const sep = computePay(recs, 10000, S(hist, '2026-09', OFF)).total;
    check('★10/15 에 설정을 꺼도 9월 금액 = 9월 설정으로 센 금액', sep === computePay(recs, 10000, ON).total && sep !== computePay(recs, 10000, OFF).total, String(sep));
  }
  const db = read('src/lib/db.ts');
  const f = db.match(/export async function fetchPayrollSettingsHistory[\s\S]*?\n}\n/)?.[0] ?? '';
  check('★db: fetchPayrollSettingsHistory 가 이력 표를 읽고 실패를 신호로 돌려준다', /payroll_settings_history/.test(f) && /readFail\('fetchPayrollSettingsHistory'/.test(f));
  const st = strip(read('src/lib/store/usePayrollStore.ts'));
  check('★스토어: hydrate 가 이력을 읽고, setSetting 이 오늘 행을 넣고 실패하면 되돌린다',
    /fetchPayrollSettingsHistory\(/.test(st) && /settingsHistoryLoadError/.test(st) && /setSetting:[\s\S]*withTodaySettings\(/.test(st) && /setSetting:[\s\S]*settingsHistory: prevHistory/.test(st));
  const tv = strip(read('src/components/TimesheetView.tsx'));
  check('★출근 기록 화면: 그 달 설정(settingsForMonth)으로 세고, 지난달 + 이력 실패면 금액 대신 안내',
    /settingsForMonth\(/.test(tv) && /computePay\(shiftsToPayRecords\(monthShifts\), monthWage, monthSettings\)/.test(tv) && /settingsHistoryLoadError/.test(tv) && /지난달 급여 설정을 불러오지 못했어요/.test(tv));
  const sv = lastDef('save_payroll_settings');
  const svFile = read(`supabase/migrations/${sv.file}`);
  check('★서버: save_payroll_settings 가 오늘부터 설정 이력을 남긴다(처음이면 옛 설정을 처음부터로)', /payroll_settings_history/.test(sv.body) && /kst_today\(\)/.test(sv.body) && /2000-01-01/.test(sv.body), sv.file);
  check('save_payroll_settings 권한 유지(0201 과 같이 authenticated 실행)', /grant execute on function public\.save_payroll_settings\(jsonb\) to authenticated;/.test(svFile) && sv.file > '0278', sv.file);
}
{
  const psql = (sql) => {
    try {
      return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
        { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
  };
  let up = true;
  try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { up = false; }
  if (!up) {
    console.log('  SKIP 서버 검사 — 로컬 도커 DB 없음');
  } else {
    const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
update public.units set payroll_settings = '{"weeklyHolidayPay": true, "extraAllowance": 100000}'::jsonb where id = 'store_001';
delete from public.payroll_settings_history where unit_id = 'store_001';  -- 이력이 아직 없는 매장(0280 뒤에 생긴 매장)
`;
    const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
    const run = (who, body) => psql(`${SETUP}${as(who)}${body}\nrollback;\n`);
    const r1 = run('o', `select public.save_payroll_settings('{"weeklyHolidayPay": false, "extraAllowance": 0}'::jsonb);
reset role;
select 'T=' || (settings->>'extraAllowance') from public.payroll_settings_history where unit_id = 'store_001' and effective_from = public.kst_today();
select 'P=' || (settings->>'extraAllowance') from public.payroll_settings_history where unit_id = 'store_001' and effective_from < public.kst_today() order by effective_from desc limit 1;
select 'U=' || (payroll_settings->>'extraAllowance') from public.units where id = 'store_001';`);
    check('★사장 저장 → 오늘 행(새 설정) · 그 전 행(옛 설정) · 지금 설정 거울', r1.includes('T=0') && r1.includes('P=100000') && r1.includes('U=0'), r1.slice(0, 200));
    const r2 = run('o', `select public.save_payroll_settings('{}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.j'), 'role', 'authenticated')::text, true);
select 'N=' || count(*) from public.payroll_settings_history where unit_id = 'store_001';`);
    check('같은 매장 직원은 이력을 읽는다(지난달 출근 기록 화면)', /N=[1-9]/.test(r2), r2.slice(0, 160));
    const r3 = run('o', `insert into public.payroll_settings_history(unit_id, effective_from, settings) values ('store_001', '2001-01-01', '{}'::jsonb);`);
    check('직접 쓰기는 막힌다(사장도 RPC 로만)', r3.startsWith('ERR='), r3.slice(0, 160));
    const r4 = run('j', `select public.save_payroll_settings('{}'::jsonb);`);
    check('직원은 저장 못 한다(owner_only)', r4.includes('owner_only'), r4.slice(0, 160));
  }
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
