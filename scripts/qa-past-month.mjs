#!/usr/bin/env node
// qa-past-month.mjs — 지난달 근무는 어떤 경로로도 바뀌지 않는다(J1 정정 · 2026-10-05 사용자 결정).
//   지난달 = 이번 달 1일(KST)보다 이른 날짜. 이번 달 안의 지난 날짜는 지금처럼 확인(p_confirm_past) 뒤 허용.
//   [1] 순수 · 앱 판정(src/lib/utils/schedule.ts pastMonthLocked · PAST_MONTH_LOCKED_TEXT)
//   [2] 배선 · 근무 시트가 지난달이면 저장·삭제를 막고 안내한다 · 지난 기간 경고는 이번 달 안에서만 · 오류 문구 연결
//   [3] 서버(로컬 도커 트랜잭션 · 고정 계정 store_001 · 되돌림): 날짜를 받는 쓰기 RPC 와 옛 앱 직접 쓰기
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
  check('문구 = "지난달 근무는 바꿀 수 없어요."', PAST_MONTH_LOCKED_TEXT === '지난달 근무는 바꿀 수 없어요.');
  check('★오늘 10/05 · 9/30 → 잠김', L('2026-09-30', '2026-10-05') === true);
  check('★오늘 10/05 · 10/01 → 이번 달(잠기지 않음)', L('2026-10-01', '2026-10-05') === false);
  check('오늘 10/05 · 10/03 → 이번 달 지난 날(잠기지 않음)', L('2026-10-03', '2026-10-05') === false);
  check('해를 넘김 · 오늘 1/02 · 12/31 → 잠김', L('2026-12-31', '2027-01-02') === true);
}

console.log('\n[2] 배선(주석 제외 코드)');
{
  const sheet = strip(read('src/components/schedule/ShiftQuickSheet.tsx'));
  check('★시트가 pastMonthLocked 로 지난달을 막는다(저장·삭제)', /pastMonthLocked\(/.test(sheet) && /PAST_MONTH_LOCKED_TEXT/.test(sheet) && /monthLocked/.test(sheet) && /disabled=\{busy \|\| monthLocked\}/.test(sheet));
  check('지난 기간 경고는 이번 달 안에서만', /touchesPast = [^;]*!monthLocked/.test(sheet));
  check('범위 선택은 "이 날부터 계속" · "이 날만" 둘뿐', (sheet.match(/\['(from|day)', '[^']+'\]/g) || []).length === 2);
  const db = strip(read('src/lib/db.ts'));
  check('★db: past_month_locked 를 알아본다', /past_month_locked/.test(db));
  const st = strip(read('src/lib/store/useScheduleStore.ts'));
  check('★스토어: past_month_locked 면 "지난달 근무는 바꿀 수 없어요."', /PAST_MONTH_LOCKED_TEXT/.test(st));
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
  // ms = 이번 달 1일. 지난달 날짜 = ms-3(날짜 지정 행) · 반복 행은 2000-01-01 부터.
  const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.ms', to_char(date_trunc('month', public.kst_today())::date, 'YYYY-MM-DD'), true);
select set_config('qa.lm', to_char(date_trunc('month', public.kst_today())::date - 3, 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from) values
  ('qa_pm_ser', 'store_001', current_setting('qa.j'), extract(dow from current_setting('qa.lm')::date)::int, null, '09:00', '13:00', '2000-01-01'),
  ('qa_pm_day', 'store_001', current_setting('qa.j'), null, current_setting('qa.lm')::date, '14:00', '18:00', current_setting('qa.lm')::date);
`;
  const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
  const run = (who, body) => psql(`${SETUP}${as(who)}${body}\nrollback;\n`);
  const locked = (o) => o.includes('past_month_locked');
  const cases = [
    ['★edit_shift_from(지난달부터)', 'o', `select public.edit_shift_from('qa_pm_ser', current_setting('qa.lm')::date, '10:00', '13:00', true);`],
    ['★end_shift_from(지난달부터)', 'o', `select public.end_shift_from('qa_pm_ser', current_setting('qa.lm')::date, true);`],
    ['★override_shift_day(지난달 하루)', 'o', `select public.override_shift_day('qa_pm_day', current_setting('qa.lm')::date, '15:00', '18:00', true);`],
    ['★add_shift_series(지난달부터)', 'o', `select public.add_shift_series(current_setting('qa.j'), 1, current_setting('qa.lm')::date, '09:00', '12:00', true);`],
    ['★옛 앱 직접 UPDATE(지난달 날짜 지정 근무)', 'o', `update public.shift_templates set start_time = '15:00' where id = 'qa_pm_day';`],
    ['★옛 앱 직접 DELETE(지난달 날짜 지정 근무)', 'o', `delete from public.shift_templates where id = 'qa_pm_day';`],
    ['★옛 앱 직접 INSERT(지난달 날짜 지정 근무)', 'o', `insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time) values ('qa_pm_new', 'store_001', current_setting('qa.j'), null, current_setting('qa.lm')::date, '09:00', '10:00');`],
    ['★옛 앱 직접 INSERT 예외(지난달 하루 빼기)', 'o', `insert into public.shift_exceptions (template_id, unit_id, date) values ('qa_pm_ser', 'store_001', current_setting('qa.lm')::date);`],
    ['★request_shift_time(직원 · 지난달)', 'j', `select public.request_shift_time('qa_pm_day', current_setting('qa.lm')::date, '15:00', '18:00', null);`],
  ];
  for (const [n, who, sql] of cases) {
    const o = run(who, sql);
    check(`${n} → past_month_locked`, locked(o), o.slice(0, 160));
  }
  // 교대 승인 · 시간 요청 승인
  const sw = run('o', `reset role;
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by)
  values ('qa_pm_sw', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.lm'), 'qa_pm_day', 'accepted', current_setting('qa.o'));
${as('o')}
select public.approve_swap('qa_pm_sw', true);`);
  check('★approve_swap(지난달 근무) → past_month_locked', locked(sw), sw.slice(0, 160));
  const dt = run('o', `reset role;
insert into public.shift_change_requests (id, unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end)
  values ('qa_pm_rq', 'store_001', current_setting('qa.j'), 'qa_pm_day', current_setting('qa.lm')::date, '14:00', '18:00', '15:00', '18:00');
${as('o')}
select public.decide_shift_time('qa_pm_rq', true, true);`);
  check('★decide_shift_time 승인(지난달 근무) → past_month_locked', locked(dt), dt.slice(0, 160));
  // 이번 달은 지금처럼 된다.
  const ok1 = run('o', `select 'R=' || public.edit_shift_from('qa_pm_ser', current_setting('qa.ms')::date, '10:00', '13:00', true);`);
  check('이번 달 1일부터 바꾸기는 된다(확인 뒤)', ok1.includes('R=qa_pm_ser'), ok1.slice(0, 160));
  const ok2 = run('o', `select 'R=' || public.end_shift_from('qa_pm_ser', current_setting('qa.ms')::date, true)::text;`);
  check('이번 달 1일부터 그만은 된다 · 지난달 기록은 남는다', ok2.includes('R=true'), ok2.slice(0, 160));
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
