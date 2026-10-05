#!/usr/bin/env node
// qa-review-security.mjs — 2026-10-05 리뷰(영역 security)에서 확인된 결함의 회귀 하네스.
//
// 무엇을 보나: 교대 요청을 꾸며서 동료 근무를 옮길 수 없는가
//   [1] 직원은 이미 "수락됨"인 요청이나 수락자가 적힌 요청을 직접 넣을 수 없다(swap_insert).
//   [2] approve_swap 은 다음을 거부한다(행을 postgres 로 직접 넣어 정책과 따로 잰다).
//       · 요청자 근무가 아닌 근무를 넘기는 요청
//       · 이 매장 멤버가 아닌 사람이 수락자인 요청
//       · 맞교환에서 상대 근무 주인이 수락자가 아닌 요청
//       · 지정 발송인데 목록에 없는 사람이 수락자인 요청
//   [3] 정상 대타·맞교환·직원의 open 요청은 그대로 된다(대조군).
// 로컬 DB 트랜잭션 안에서 store_001(사장 owner · 매니저 staff · 직원 staff2)과
// store_solo_local(owner-solo)의 고정 계정으로 잰다. 케이스마다 되돌린다(계정 신설 없음).
// 전제: local_bootstrap_fix.sh 를 돌린 로컬 도커. 실행: node scripts/qa-review-security.mjs
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300);
  }
};
const pick = (out, k) => (out.split('\n').find((l) => l.startsWith(k + '=')) ?? '').slice(k.length + 1);

// 공통 준비: 고정 계정 id · 근무일(오늘+3) · 매니저 근무 tpl_m · 직원 근무 tpl_j
const SETUP = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.m', (select id::text from auth.users where email = 'staff@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.x', (select id::text from auth.users where email = 'owner-solo@pilot.squaretable.app'), true);
select set_config('qa.d', to_char(public.kst_today() + 3, 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, shift_date, start_time, end_time) values
  ('qa_rs_tpl_m', 'store_001', current_setting('qa.m'), null, current_setting('qa.d')::date, '09:00', '13:00'),
  ('qa_rs_tpl_j', 'store_001', current_setting('qa.j'), null, current_setting('qa.d')::date, '14:00', '18:00');
`;
const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
// 근무 주인 요약: 그날 store_001 근무의 시작시각=주인역할
const OWNERS = `
reset role;
select 'OWNERS=' || coalesce(string_agg(t.start_time || ':' ||
  case t.staff_id when current_setting('qa.m') then 'M' when current_setting('qa.j') then 'J'
                  when current_setting('qa.o') then 'O' when current_setting('qa.x') then 'X' else '?' end, ',' order by t.start_time), '')
  from public.shift_templates t
 where t.unit_id = 'store_001' and t.shift_date = current_setting('qa.d')::date
   and (t.start_time, t.end_time) in (('09:00', '13:00'), ('14:00', '18:00'));
`;
// 행을 postgres 로 직접 넣고 사장으로 approve_swap 을 부른다
const approveCase = (row) => psql(`${SETUP}
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, target_staff_id, target_staff_ids,
                                  target_date, target_template_id, status, accepted_by) values
  ('qa_rs_sw', 'store_001', '${row.kind}', current_setting('qa.j'), current_setting('qa.d'), '${row.tpl}',
   ${row.targetStaff ? `current_setting('qa.${row.targetStaff}')` : 'null'},
   ${row.targets ? `array[${row.targets.map((w) => `current_setting('qa.${w}')`).join(',')}]` : 'null'},
   ${row.targetTpl ? 'current_setting(\'qa.d\')' : 'null'}, ${row.targetTpl ? `'${row.targetTpl}'` : 'null'},
   'accepted', current_setting('qa.${row.acc}'));
${as('o')}
select 'OK=' || public.approve_swap('qa_rs_sw')::text;
${OWNERS}
rollback;
`);

// ── [1] 직원이 직접 넣는 요청 ─────────────────────────────────────────────────
console.log('[1] 직원이 직접 넣는 교대 요청(swap_insert)');
const ins = (status, accExpr, tpl) => psql(`${SETUP}
${as('j')}
insert into public.swap_requests (id, unit_id, kind, requester_id, date, template_id, status, accepted_by)
  values ('qa_rs_sw', 'store_001', 'cover', current_setting('qa.j'), current_setting('qa.d'), '${tpl}', '${status}', ${accExpr});
select 'INS=ok';
rollback;
`);
let o = ins('accepted', `current_setting('qa.x')`, 'qa_rs_tpl_m');
check('수락됨 + 다른 매장 수락자 요청을 넣지 못한다', !o.includes('INS=ok'), '넣어짐');
o = ins('accepted', `current_setting('qa.m')`, 'qa_rs_tpl_j');
check('자기 근무라도 수락됨 상태로는 넣지 못한다', !o.includes('INS=ok'), '넣어짐');
o = ins('open', `current_setting('qa.m')`, 'qa_rs_tpl_j');
check('open 이어도 수락자를 미리 적어 넣지 못한다', !o.includes('INS=ok'), '넣어짐');
o = ins('open', 'null', 'qa_rs_tpl_j');
check('(대조) 자기 근무의 open 요청은 넣는다', o.includes('INS=ok'), o.slice(-200));

// ── [2] approve_swap 이 꾸민 수락을 거부 ─────────────────────────────────────
console.log('[2] approve_swap 이 꾸민 요청을 거부');
o = approveCase({ kind: 'cover', tpl: 'qa_rs_tpl_m', acc: 'x' });
check('동료 근무 + 다른 매장 수락자 → 거부', pick(o, 'OK') === 'false', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  동료 근무 주인은 그대로', pick(o, 'OWNERS') === '09:00:M,14:00:J', pick(o, 'OWNERS'));
o = approveCase({ kind: 'cover', tpl: 'qa_rs_tpl_m', acc: 'o' });
check('요청자 근무가 아닌 근무(동료 근무) → 거부', pick(o, 'OK') === 'false', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  동료 근무 주인은 그대로', pick(o, 'OWNERS') === '09:00:M,14:00:J', pick(o, 'OWNERS'));
o = approveCase({ kind: 'cover', tpl: 'qa_rs_tpl_j', acc: 'x' });
check('자기 근무라도 매장 멤버가 아닌 수락자 → 거부', pick(o, 'OK') === 'false', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  근무가 다른 매장 사람에게 가지 않는다', pick(o, 'OWNERS') === '09:00:M,14:00:J', pick(o, 'OWNERS'));
o = approveCase({ kind: 'swap', tpl: 'qa_rs_tpl_j', targetTpl: 'qa_rs_tpl_m', acc: 'o' });
check('맞교환 상대 근무 주인이 수락자가 아님 → 거부', pick(o, 'OK') === 'false', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  두 근무 주인은 그대로', pick(o, 'OWNERS') === '09:00:M,14:00:J', pick(o, 'OWNERS'));
o = approveCase({ kind: 'cover', tpl: 'qa_rs_tpl_j', acc: 'o', targets: ['m'] });
check('지정 발송 목록에 없는 수락자 → 거부', pick(o, 'OK') === 'false', 'OK=' + (pick(o, 'OK') || o.slice(-200)));

// ── [3] 대조군: 정상 요청은 그대로 승인 ───────────────────────────────────────
console.log('[3] 정상 요청은 그대로 승인');
o = approveCase({ kind: 'cover', tpl: 'qa_rs_tpl_j', acc: 'm', targets: ['m'] });
check('정상 대타 승인', pick(o, 'OK') === 'true', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  직원 근무가 매니저에게', pick(o, 'OWNERS') === '09:00:M,14:00:M', pick(o, 'OWNERS'));
o = approveCase({ kind: 'swap', tpl: 'qa_rs_tpl_j', targetTpl: 'qa_rs_tpl_m', targetStaff: 'm', acc: 'm' });
check('정상 맞교환 승인', pick(o, 'OK') === 'true', 'OK=' + (pick(o, 'OK') || o.slice(-200)));
check('  두 근무가 서로 바뀐다', pick(o, 'OWNERS') === '09:00:J,14:00:M', pick(o, 'OWNERS'));

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
