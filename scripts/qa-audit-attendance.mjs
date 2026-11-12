#!/usr/bin/env node
// qa-audit-attendance.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 근무표·출퇴근 묶음 재현 검사.
//   2026-11-02 급여 기능을 빼며 qa-audit-payroll.mjs 에서 급여와 상관없는 검사만 옮겼다.
//   [A8] 지난달 출퇴근 기록은 그 달 기간으로 따로 읽는다 — 최근 1,000건에 잘려 "안 찍었어요"가 거짓으로 뜨지 않는다.
//   [A9] 같은 사람 근무가 겹치면 경고만 한다(저장은 막지 않는다).
//   [A10] 이미 승인·반려·취소된 교대는 낡은 화면의 취소·반려로 다시 바뀌지 않는다(서버 트리거 · 클라 상태 조건).
//         서버 검사는 로컬 도커(고정 계정 store_001 · 트랜잭션 되돌림)가 있을 때만 돈다.
//         ★도커가 없으면 skip 으로 세고 RED 로 끝난다(건너뛴 것을 통과로 세지 않는다 · AGENTS.md).
//   [A11] 근무표·출퇴근 날짜 계산은 폰 시간대와 상관없다.
//   [T1] 출근 기록 직접 진입 — 명부가 오기 전·못 읽었을 때 "직원을 찾을 수 없어요"를 띄우지 않는다.
// 실행: node --no-warnings scripts/qa-audit-attendance.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0, skip = 0;
const SERVER_CHECKS = 23; // [A10] 서버 검사 수 — 로컬 도커가 있으면 실제 수와 맞는지 맨 끝에서 본다
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

console.log('[A8] 지난달 출퇴근 기록은 그 달 기간으로 따로 읽는다(최근 1,000건에 잘리지 않는다)');
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
  check('★출근 기록 화면: 지난달은 loadMonth 로 읽고, 다 읽기 전·실패면 대조 문구를 띄우지 않는다', /loadMonth\(staffId, (ym|m)\)/.test(tv) && /monthReady/.test(tv) && /이 달 기록을 불러오지 못했어요/.test(tv) && /monthReady \?[^;]*reconcileSchedule/.test(tv));
}

console.log('\n[A10] 이미 승인·반려·취소된 교대는 다시 바뀌지 않는다');
{
  const g = lastDef('swap_requests_decided_guard');
  check('★서버: swap_requests 의 끝난 요청(approved·rejected·cancelled) 상태를 바꾸면 거부하는 트리거', /old\.status in \('approved', 'rejected', 'cancelled'\)/.test(g.body) && /swap_already_decided/.test(g.body) && /before update on public\.swap_requests/.test(read(`supabase/migrations/${g.file}`)), g.file);
  const cg = lastDef('swap_requests_client_guard');
  check('★서버: 클라 직접 갱신은 앱이 쓰는 전이·열만 허용하는 트리거(S2)', /current_user/.test(cg.body) && /swap_update_not_allowed/.test(cg.body) && /before update on public\.swap_requests/.test(read(`supabase/migrations/${cg.file}`)), cg.file || '없음');
  const db = read('src/lib/db.ts');
  const f = db.match(/export async function updateSwap[\s\S]*?\n}\n/)?.[0] ?? '';
  // 33e0e79 부터 writeStrict 대신 writeDecision 이다. 0행은 'already'(이미 처리됨)로 올라간다.
  check('★db: updateSwap 이 지금 상태를 조건으로 건다(0행 = 이미 처리됨)', /\.in\('status', expect\)/.test(f) && /writeDecision\('updateSwap'/.test(f));
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
  // 고정 계정이 없으면 SETUP 의 set_config 가 null 이 되어 아래 판정이 엉뚱한 이유로 갈린다 — 그것도 skip 이다.
  const fixed = up ? psql(`select count(*) from auth.users where email in ('owner@pilot.squaretable.app', 'staff2@pilot.squaretable.app', 'staff@pilot.squaretable.app');`).trim() : '';
  if (!up || fixed !== '3') {
    skip += SERVER_CHECKS;
    console.log(`  SKIP 서버 검사 ${SERVER_CHECKS}개 · ${!up ? '로컬 도커 DB 없음' : `고정 계정 3개 중 ${fixed} 개(seed-demo 를 먼저 돌린다)`}`);
  } else {
    const serverStart = pass + fail;
    const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.m', (select id::text from auth.users where email = 'staff@pilot.squaretable.app'), true);
select set_config('qa.d', to_char(public.kst_today() + 3, 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from) values
  ('qa_a10_t', 'store_001', current_setting('qa.j'), null, current_setting('qa.d')::date, '09:00', '13:00', current_setting('qa.d')::date);
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by) values
  ('qa_a10_ap', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d'), 'qa_a10_t', 'approved', current_setting('qa.o')),
  ('qa_a10_ac', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d'), 'qa_a10_t', 'accepted', current_setting('qa.o')),
  -- 0633: 같은 (근무, 날짜)의 진행 중(open·accepted) 요청은 하나다(swap_requests_one_live_uq). open 요청은 한 주 뒤 날짜로 둔다.
  ('qa_a10_op', 'store_001', 'cover', current_setting('qa.o'), to_char(current_setting('qa.d')::date + 7, 'YYYY-MM-DD'), 'qa_a10_t', 'open', null);
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
    // [S1] 요청자 취소는 상태만 바꾼다. 취소에 얹어 수락자·요청자·내용을 바꾸는 길은 없다.
    const r6 = run('j', `update public.swap_requests set status = 'cancelled', accepted_by = current_setting('qa.m') where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★요청 직원이 취소하면서 수락자를 바꾸기 → 거부', r6.startsWith('ERR='), r6.slice(0, 160));
    const r7 = run('j', `update public.swap_requests set status = 'cancelled', note = 'x' where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★요청 직원이 취소하면서 다른 열(메모)을 바꾸기 → 거부', r7.startsWith('ERR='), r7.slice(0, 160));
    const r8 = run('j', `update public.swap_requests set status = 'cancelled', requester_id = current_setting('qa.j') where id = 'qa_a10_op' returning 'R=' || status;`);
    check('★동료가 남의 열린 요청을 자기 것으로 바꿔 취소하기 → 거부', r8.startsWith('ERR='), r8.slice(0, 160));
    const r9 = run('j', `update public.swap_requests set status = 'cancelled', updated_at = now() where id = 'qa_a10_ac' returning 'R=' || status || '/' || (accepted_by = current_setting('qa.o'))::text;`);
    check('합의된 요청 취소 뒤에도 수락자는 그대로다', r9.includes('R=cancelled/true'), r9.slice(0, 160));
    const r5 = psql(`${SETUP}update public.swap_requests set archived_tenure_id = null, updated_at = now() where id = 'qa_a10_ap' returning 'R=' || status;\nrollback;\n`);
    check('상태를 안 바꾸는 갱신(재입사 표시 등)은 막지 않는다', r5.includes('R=approved'), r5.slice(0, 160));

    // [S2] 클라 직접 UPDATE 는 앱이 쓰는 전이·열만 된다.
    //   앱 목록: 동료 수락(open→accepted · 수락자=본인) · 요청자 취소(open·accepted→cancelled) · 관리자 반려(accepted→rejected).
    //   requester_id 는 누구도 직접 못 바꾼다. 승인은 approve_swap(근무 이전과 한 트랜잭션)으로만.
    const s1 = run('j', `update public.swap_requests set accepted_by = null where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★요청 직원이 수락된 자기 요청의 수락자를 비우기 → 거부', s1.startsWith('ERR='), s1.slice(0, 160));
    const s2 = run('j', `update public.swap_requests set status = 'open', accepted_by = null where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★요청 직원이 수락된 요청을 다시 열기(accepted→open) → 거부', s2.startsWith('ERR='), s2.slice(0, 160));
    const s3 = run('j', `update public.swap_requests set requester_id = current_setting('qa.j') where id = 'qa_a10_op' returning 'R=' || status;`);
    check('★동료가 남의 열린 요청의 요청자를 자기로 바꾸기 → 거부', s3.startsWith('ERR='), s3.slice(0, 160));
    const s4 = run('j', `update public.swap_requests set note = 'x' where id = 'qa_a10_op' returning 'R=' || status;`);
    check('★동료가 남의 열린 요청 내용(메모)을 바꾸기 → 거부', s4.startsWith('ERR='), s4.slice(0, 160));
    const s5 = run('j', `update public.swap_requests set status = 'accepted', accepted_by = current_setting('qa.m') where id = 'qa_a10_op' returning 'R=' || status;`);
    check('동료가 수락하며 다른 사람을 수락자로 넣기 → 거부', s5.startsWith('ERR='), s5.slice(0, 160));
    const s6 = run('o', `update public.swap_requests set requester_id = current_setting('qa.m') where id = 'qa_a10_op' returning 'R=' || status;`);
    check('★사장도 요청자를 직접 못 바꾼다', s6.startsWith('ERR='), s6.slice(0, 160));
    const s7 = run('o', `update public.swap_requests set accepted_by = current_setting('qa.m') where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★사장도 수락자를 직접 못 바꾼다', s7.startsWith('ERR='), s7.slice(0, 160));
    const s8 = run('o', `update public.swap_requests set status = 'approved' where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('★사장 직접 승인(근무 이전 없이 approved) → 거부 · 승인은 approve_swap 으로만', s8.startsWith('ERR='), s8.slice(0, 160));
    const s9 = run('o', `update public.swap_requests set status = 'open', accepted_by = null where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('사장 직접 다시 열기(accepted→open) → 거부', s9.startsWith('ERR='), s9.slice(0, 160));
    const s10 = run('j', `update public.swap_requests set status = 'accepted', accepted_by = current_setting('qa.j'), updated_at = now() where id = 'qa_a10_op' returning 'R=' || status;`);
    check('★동료 직접 갱신 수락(open→accepted) → 거부(수락은 accept_swap 만)', s10.startsWith('ERR='), s10.slice(0, 160));
    const s11 = run('o', `update public.swap_requests set status = 'rejected', updated_at = now() where id = 'qa_a10_ac' returning 'R=' || status;`);
    check('사장 반려(accepted→rejected · 상태·시각만)는 된다', s11.includes('R=rejected'), s11.slice(0, 160));
    const s12 = run('m', `select 'R=' || public.accept_swap('qa_a10_op')::text;`);
    check('정의자 함수 accept_swap 수락은 된다', s12.includes('R=true'), s12.slice(0, 160));
    const s13 = psql(`${SETUP}set local role service_role;\nupdate public.swap_requests set status = 'accepted', accepted_by = current_setting('qa.m') where id = 'qa_a10_op' returning 'R=' || status;\nrollback;\n`);
    check('service_role 갱신은 막지 않는다', s13.includes('R=accepted'), s13.slice(0, 160));
    const s14 = psql(`${SETUP}update public.swap_requests set status = 'cancelled', updated_at = now() where id = 'qa_a10_ac';\n${as('j')}update public.swap_requests set status = 'cancelled', updated_at = now() where id = 'qa_a10_ac' returning 'R=' || status;\nrollback;\n`);
    check('옛 앱이 이미 취소된 요청을 다시 취소(같은 상태 · 시각만)해도 오류가 아니다', s14.includes('R=cancelled'), s14.slice(0, 160));
    // skip 일 때 세는 수가 실제 검사 수와 어긋나지 않게 여기서 맞춰 본다.
    check(`서버 검사 수 = SERVER_CHECKS(${SERVER_CHECKS})`, pass + fail - serverStart === SERVER_CHECKS, `실제 ${pass + fail - serverStart}`);
  }
}

console.log('\n[A11] 근무표 날짜 계산은 폰 시간대와 상관없다');
{
  let S = {};
  try { S = await import('../src/lib/utils/schedule.ts'); } catch (e) { check('schedule.ts 를 읽는다', false, String(e?.code ?? e)); }
  const { addDays, mondayOf, weekDates, weekdayOf, fmtMd, fmtDateKo, dayOfMonth, nextDateForWeekday } = S;
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
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
}

console.log('\n[A9] 같은 사람 근무가 겹치면 경고만 한다(2026-10-06 결정 ①)');
{
  let S = {};
  try { S = await import('../src/lib/utils/schedule.ts'); } catch (e) { check('schedule.ts 를 읽는다', false, String(e?.code ?? e)); }
  const { overlapsStaffShift, swapOverlap } = S;

  // 경고 판정 — 같은 사람 · 같은 날 · 겹침. 맞교환·자기 근무는 빼고 본다.
  const tpl = (id, staff_id, date, start, end) => ({ id, staff_id, weekday: null, date, start, end });
  const T = [tpl('a1', 'kim', '2026-10-10', '12:00', '18:00'), tpl('b1', 'lee', '2026-10-10', '14:00', '20:00'), tpl('k2', 'kim', '2026-10-11', '09:00', '13:00')];
  const O = (...a) => (fn(overlapsStaffShift) ? overlapsStaffShift(...a) : undefined);
  check('★김알바 10/10 에 14~20 을 더 넣으면 겹친다', O(T, [], [], 'kim', '2026-10-10', '14:00', '20:00') === true);
  check('19~22 는 안 겹친다 · 다른 날도 안 겹친다', O(T, [], [], 'kim', '2026-10-10', '19:00', '22:00') === false && O(T, [], [], 'kim', '2026-10-12', '12:00', '18:00') === false);
  check('고치는 근무 자신은 빼고 본다', O(T, [], [], 'kim', '2026-10-10', '13:00', '17:00', ['a1']) === false);
  check('자정 넘김(22~02)과 23~01 은 겹친다', O([tpl('n1', 'kim', '2026-10-10', '22:00', '02:00')], [], [], 'kim', '2026-10-10', '23:00', '01:00') === true);
  const SW = (r) => (fn(swapOverlap) ? swapOverlap(r, T, [], []) : undefined);
  check('★이수민 14~20 대타를 김알바가 받으면 겹친다(승인 카드 경고)', SW({ id: 's1', kind: 'cover', requester_id: 'lee', date: '2026-10-10', template_id: 'b1', accepted_by: 'kim', status: 'accepted' }) === true);
  check('일부만(18~20) 받으면 안 겹친다', SW({ id: 's2', kind: 'cover', requester_id: 'lee', date: '2026-10-10', template_id: 'b1', part_start: '18:00', part_end: '20:00', accepted_by: 'kim', status: 'accepted' }) === false);
  check('맞교환으로 내주는 근무는 빼고 본다', SW({ id: 's3', kind: 'swap', requester_id: 'lee', date: '2026-10-10', template_id: 'b1', target_date: '2026-10-10', target_template_id: 'a1', accepted_by: 'kim', status: 'accepted' }) === false);

  const sheet = strip(read('src/components/schedule/ShiftQuickSheet.tsx'));
  check('★근무 추가 시트: 같은 사람 겹침 경고 · 저장은 막지 않는다', /overlapsStaffShift\(/.test(sheet) && /같은 시간에 이미 근무가 있어요/.test(sheet) && !/canSave = [^;]*overlap/i.test(sheet));
  const own = strip(read('src/app/owner/schedule.tsx'));
  check('★교대 승인 카드: 겹침 경고 · 승인 버튼은 그대로', /swapOverlap\(/.test(own) && /같은 시간에 이미 근무가 있어요/.test(own));
}

console.log('\n[A11b] 직원 출퇴근·허브의 날짜 계산도 폰 시간대를 타지 않는다(A11 과 같은 헬퍼)');
{
  const localParse = /new Date\(`\$\{[^}]+\}T00:00:00`\)/;
  const att = strip(read('src/app/junior/attendance.tsx'));
  check('★출퇴근 화면: 날짜를 기기 현지 자정으로 읽지 않는다', !localParse.test(att) && !/\.getDay\(\)|\.getFullYear\(\)/.test(att));
  check('출퇴근 화면: 이번 주는 schedule.ts 의 mondayOf 로 만든다', /mondayOf\(today\)/.test(att));
  const jt = strip(read('src/components/hub/JuniorTodayView.tsx'));
  check('★허브 오늘 카드: 날짜를 기기 현지 자정으로 읽지 않는다', !localParse.test(jt) && !/\.getDay\(\)/.test(jt));
  check('허브 오늘 카드: 다음 근무 날짜·요일은 addDays·weekdayOf 로 만든다', /addDays\(today, off\)/.test(jt) && /weekdayOf\(date2\)/.test(jt));
}

console.log('\n[T1] 출근 기록 직접 진입 — 명부가 오기 전·못 읽었을 때 "직원을 찾을 수 없어요"를 띄우지 않는다');
{
  const ts = strip(read('src/app/owner/timesheet/[staffId].tsx'));
  check('★명부 읽기 실패는 "못 불러왔다"+다시 시도로 말한다', /useStaffStore\(\(s\) => s\.loadError\)/.test(ts) && /LoadErrorState/.test(ts));
  check('★직원은 스토어 구독으로 찾는다(늦게 온 명부에 화면이 따라온다 · getStaff 일회 조회 금지)', /useStaffStore\(\(s\) => s\.staff\.find\(/.test(ts) && !/getStaff\(/.test(ts));
  check('판정에 profiles.role 을 쓰지 않는다', !/profiles\.role|\.profile\?*\.role/.test(ts));
}

console.log(`\n${fail || skip ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail} · skip ${skip}`);
process.exit(fail || skip ? 1 : 0);
