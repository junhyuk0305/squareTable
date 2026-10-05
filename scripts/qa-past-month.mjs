#!/usr/bin/env node
// qa-past-month.mjs — 지난달 근무 규칙(2026-10-06 사장님 결정 A1·A2 · 논리점검_결정기록_2026-10-06.md §1).
//   반복 근무 변경은 바꾼 날부터 이후에만 적용한다(소급 금지 유지): 지난달 날짜"부터" 반복을 넣거나 고치거나 그만두지 못한다.
//   특정 날짜 하나를 고치는 일은 지난달이어도 된다: 대타 승인 · 시간 수정 요청·승인 · 근무 추가·삭제(예외) · 되돌리기.
//   교대 승인 35일 창(Q10)은 그대로다.
//   [1] 순수 · 앱 판정(src/lib/utils/schedule.ts pastMonthLocked · PAST_MONTH_LOCKED_TEXT)
//   [2] 배선 · 근무 시트는 반복 범위("이 날부터 계속"·매주 반복 추가)일 때만 지난달을 막는다
//   [3] 서버(로컬 도커 트랜잭션 · 고정 계정 store_001 · 되돌림)
// 실행: node scripts/qa-past-month.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') : '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

console.log('[1] 앱 판정');
{
  let M = {};
  try { M = await import('../src/lib/utils/schedule.ts'); } catch (e) { check('schedule.ts 를 읽는다', false, String(e?.code ?? e)); }
  const { pastMonthLocked, PAST_MONTH_LOCKED_TEXT } = M;
  const L = (d, t) => (fn(pastMonthLocked) ? pastMonthLocked(d, t) : undefined);
  check('★문구가 반복 근무만 막는다고 말한다', typeof PAST_MONTH_LOCKED_TEXT === 'string' && /반복 근무/.test(PAST_MONTH_LOCKED_TEXT), String(PAST_MONTH_LOCKED_TEXT));
  check('오늘 10/05 · 9/30 → 지난달', L('2026-09-30', '2026-10-05') === true);
  check('오늘 10/05 · 10/01 → 이번 달', L('2026-10-01', '2026-10-05') === false);
  check('해를 넘김 · 오늘 1/02 · 12/31 → 지난달', L('2026-12-31', '2027-01-02') === true);
}

console.log('\n[2] 배선(주석 제외 코드)');
{
  const sheet = strip(read('src/components/schedule/ShiftQuickSheet.tsx'));
  check('★시트: 지난달 잠금은 반복 범위(fromScope)일 때만', /monthLocked = fromScope && pastMonthLocked\(/.test(sheet), (sheet.match(/const monthLocked[^;]*;/) ?? [''])[0]);
  check('잠기면 저장·삭제를 막고 안내한다', /PAST_MONTH_LOCKED_TEXT/.test(sheet) && /disabled=\{busy \|\| monthLocked\}/.test(sheet) && /!monthLocked/.test(sheet));
  check('지난 날짜 경고는 잠기지 않은 지난 날짜 전부', /touchesPast = [^;]*!monthLocked/.test(sheet));
  check('범위 선택은 "이 날부터 계속" · "이 날만" 둘뿐', (sheet.match(/\['(from|day)', '[^']+'\]/g) || []).length === 2);
}

console.log('\n[3] 서버(로컬 도커 트랜잭션)');
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300);
  }
};
let up = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { up = false; }
if (!up) {
  console.log('  SKIP 로컬 도커 DB 없음');
} else {
  // ms = 이번 달 1일. lm = 지난달 날짜(ms-3). 반복 행은 2000-01-01 부터 · 60일 전에 만든 행.
  const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.ms', to_char(date_trunc('month', public.kst_today())::date, 'YYYY-MM-DD'), true);
select set_config('qa.lm', to_char(date_trunc('month', public.kst_today())::date - 3, 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from, created_at) values
  ('qa_pm_ser', 'store_001', current_setting('qa.j'), extract(dow from current_setting('qa.lm')::date)::int, null, '09:00', '13:00', '2000-01-01', now() - interval '60 days'),
  ('qa_pm_day', 'store_001', current_setting('qa.j'), null, current_setting('qa.lm')::date, '14:00', '18:00', current_setting('qa.lm')::date, now() - interval '60 days');
`;
  const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
  const run = (who, body) => psql(`${SETUP}${as(who)}${body}\nrollback;\n`);
  const locked = (o) => o.includes('past_month_locked');
  const ok = (o) => !o.startsWith('ERR=') && o.includes('R=');

  // 반복 근무를 지난달 날짜부터 바꾸는 것은 여전히 막힌다(소급 금지).
  for (const [n, sql] of [
    ['★반복 근무 고치기(지난달부터)', `select public.edit_shift_from('qa_pm_ser', current_setting('qa.lm')::date, '10:00', '13:00', true);`],
    ['★반복 근무 그만(지난달부터)', `select public.end_shift_from('qa_pm_ser', current_setting('qa.lm')::date, true);`],
    ['★반복 근무 추가(지난달부터)', `select public.add_shift_series(current_setting('qa.j'), 1, current_setting('qa.lm')::date, '09:00', '12:00', true);`],
  ]) {
    const o = run('o', sql);
    check(`${n} → past_month_locked`, locked(o), o.slice(0, 160));
  }

  // 날짜 하나를 고치는 일은 지난달이어도 된다.
  const day = [
    ['★이 날만 고치기(지난달 반복 근무 하루)', 'o', `select 'R=' || coalesce(public.override_shift_day('qa_pm_ser', current_setting('qa.lm')::date, '10:00', '13:00', true), 'null');`],
    ['★이 날만 빼기(지난달 날짜 지정 근무)', 'o', `select 'R=' || coalesce(public.override_shift_day('qa_pm_day', current_setting('qa.lm')::date, null, null, true), 'null');`],
    ['★옛 앱 직접 UPDATE(지난달 날짜 지정 근무)', 'o', `update public.shift_templates set start_time = '15:00' where id = 'qa_pm_day' returning 'R=' || start_time;`],
    ['★옛 앱 직접 DELETE(지난달 날짜 지정 근무)', 'o', `delete from public.shift_templates where id = 'qa_pm_day' returning 'R=' || id;`],
    ['★근무 추가(지난달 하루 · 날짜 지정)', 'o', `insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time) values ('qa_pm_new', 'store_001', current_setting('qa.j'), null, current_setting('qa.lm')::date, '09:00', '10:00') returning 'R=' || id;`],
    ['★예외 넣기(지난달 하루 빼기)', 'o', `insert into public.shift_exceptions (template_id, unit_id, date) values ('qa_pm_ser', 'store_001', current_setting('qa.lm')::date) returning 'R=' || date;`],
    ['★시간 수정 요청(직원 · 지난달)', 'j', `select 'R=' || public.request_shift_time('qa_pm_day', current_setting('qa.lm')::date, '15:00', '18:00', null);`],
  ];
  for (const [n, who, sql] of day) {
    const o = run(who, sql);
    check(`${n} → 된다`, ok(o), o.slice(0, 160));
  }
  // 되돌리기 = 지난달 예외 지우기
  const rs = run('o', `reset role;
insert into public.shift_exceptions (template_id, unit_id, date) values ('qa_pm_ser', 'store_001', current_setting('qa.lm')::date);
${as('o')}
delete from public.shift_exceptions where template_id = 'qa_pm_ser' and date = current_setting('qa.lm')::date returning 'R=' || date;`);
  check('★되돌리기(지난달 예외 지우기) → 된다', ok(rs), rs.slice(0, 160));

  // 교대 승인 · 시간 요청 승인(지난달)
  const sw = run('o', `reset role;
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by)
  values ('qa_pm_sw', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.lm'), 'qa_pm_day', 'accepted', current_setting('qa.o'));
${as('o')}
select 'R=' || public.approve_swap('qa_pm_sw', true)::text;
reset role;
select 'W=' || (staff_id = current_setting('qa.o'))::text from public.shift_templates where id = 'qa_pm_day';`);
  check('★대타 승인(지난달 근무) → 된다 · 근무가 수락자에게 간다', sw.includes('R=true') && sw.includes('W=true'), sw.slice(0, 200));
  const dt = run('o', `reset role;
insert into public.shift_change_requests (id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end)
  values ('qa_pm_rq', 'store_001', current_setting('qa.j'), 'qa_pm_day', current_setting('qa.lm')::date, '14:00', '18:00', '15:00', '18:00');
${as('o')}
select 'R=' || public.decide_shift_time('qa_pm_rq', true, true)::text;`);
  check('★시간 수정 승인(지난달 근무) → 된다', dt.includes('R=true'), dt.slice(0, 160));

  // 교대 승인 35일 창(Q10)은 그대로다.
  const old = run('o', `reset role;
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time) values
  ('qa_pm_old', 'store_001', current_setting('qa.j'), null, public.kst_today() - 40, '09:00', '12:00');
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by)
  values ('qa_pm_sw40', 'store_001', 'cover', current_setting('qa.j'), to_char(public.kst_today() - 40, 'YYYY-MM-DD'), 'qa_pm_old', 'accepted', current_setting('qa.o'));
${as('o')}
select 'R=' || public.approve_swap('qa_pm_sw40', true)::text;`);
  check('교대 승인 35일 창은 그대로(40일 전 = false)', old.includes('R=false'), old.slice(0, 160));

  // 반복 근무를 고쳐도 지난 날짜는 그대로다(옛 앱 직접 UPDATE · 새 앱 이 날부터 계속).
  const keep = run('o', `update public.shift_templates set start_time = '07:00' where id = 'qa_pm_ser';
reset role;
select 'C=' || count(*) from public.shift_templates
 where staff_id = current_setting('qa.j') and unit_id = 'store_001' and shift_date is null and id <> 'qa_pm_ser'
   and start_time = '09:00' and valid_to = public.kst_today() - 1 and valid_from = '2000-01-01';
select 'F=' || (valid_from = public.kst_today())::text from public.shift_templates where id = 'qa_pm_ser';`);
  check('★반복 근무 직접 수정 → 지난 구간(지난달 포함)은 옛 시각으로 남고 새 시각은 오늘부터', keep.includes('C=1') && keep.includes('F=true'), keep.slice(0, 200));
  const ok1 = run('o', `select 'R=' || public.edit_shift_from('qa_pm_ser', current_setting('qa.ms')::date, '10:00', '13:00', true);
reset role;
select 'C=' || count(*) from public.shift_templates where staff_id = current_setting('qa.j') and shift_date is null and start_time = '09:00' and valid_to = current_setting('qa.ms')::date - 1;`);
  check('이번 달 1일부터 바꾸기는 된다(확인 뒤) · 지난달 구간은 옛 시각', ok1.includes('R=qa_pm_ser') && ok1.includes('C=1'), ok1.slice(0, 160));
  const ok2 = run('o', `select 'R=' || public.end_shift_from('qa_pm_ser', current_setting('qa.ms')::date, true)::text;`);
  check('이번 달 1일부터 그만은 된다', ok2.includes('R=true'), ok2.slice(0, 160));
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
