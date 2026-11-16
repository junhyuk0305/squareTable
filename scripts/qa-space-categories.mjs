#!/usr/bin/env node
// qa-space-categories.mjs — 공간 노하우 카테고리 저장 경로(0780 · 실측 결함 R-3 · 2026-11-16)
//
// 무엇을 증명하나:
//   ① 결함 재현: 공간 주인이 표(schedule_config) 경로로 자기 공간 카테고리를 쓰면 거절된다(0780 전에도 후에도 · 정책을 안 넓혔다).
//   ② 0780 함수: 공간 주인은 자기 공간 카테고리를 읽고 쓴다. 쓴 칸은 knowhow_categories 하나뿐이다(dayparts 그대로).
//   ③ 격리: 공간 멤버 · 다른 공간 주인 · 매장 사장 · 매장 매니저 겸 공간 멤버는 거절. 매장 번호를 넘기면 거절. 이상한 값 거절.
//   ④ 회귀: 매장 사장·매니저는 지금처럼 표 경로로 매장 카테고리를 쓴다(sc_write 0151 그대로).
//
// 방식: qa-space-isolation 1부와 같다. 로컬 DB 컨테이너에서 한 트랜잭션 안에 계정·공간을 심고, 호출마다 authenticated 역할과
//   JWT 클레임을 흉내 내 부른 뒤 그 호출을 되돌린다. 끝에 트랜잭션 전체를 되돌린다 = 공유 로컬 DB 에 흔적 0.
// 로컬 전용. AI 호출 0회.
// 실행: npm run qa:space-categories:local
import { spawnSync } from 'node:child_process';

if (!process.argv.includes('--local')) { console.error('중단: 로컬 전용 하니스다(--local)'); process.exit(2); }
const DB = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
const rnd = Math.random().toString(16).slice(2, 10);
const SP = `qa_spc_${rnd}`, SP2 = `qa_spc2_${rnd}`, X = `qa_stc_${rnd}`;
// A 공간 주인 · B 공간 멤버 · C 다른 공간 주인 · D 매장 X 사장 · M 매장 X 매니저 겸 공간 멤버
const U = Object.fromEntries(['A', 'B', 'C', 'D', 'M'].map((k, i) => [k, `00000000-0000-4000-8${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
const S = Object.fromEntries(Object.keys(U).map((k, i) => [k, `00000000-0000-4000-9${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const CATS = `'[{"id":"kc_qa_1","label":"QA 공간 카테고리","color":"#3366AA"}]'::jsonb`;
const big = `(select jsonb_agg(jsonb_build_object('id', 'kc_' || i, 'label', 'x' || i)) from generate_series(1, 101) i)`;

const st = (w, store, space) => `select pg_temp.qa_state(${q(U[w])}, ${q(S[w])}, ${store ? q(store) : 'null'}, ${space ? q(space) : 'null'});`;
// 그 사람 권한으로 하나 하고(쓰기면 결과를 서비스 권한으로 읽는다) 전부 되돌린다.
const act = (name, w, a, c, e) => `select pg_temp.qa_act(${q(name)}, ${q(U[w])}, ${q(S[w])}, ${q(a)}, ${q(c)}, ${q(e)});`;
const svcCats = (unit) => `select coalesce((select knowhow_categories::text from public.schedule_config where unit_id = ${q(unit)}), '<none>')`;

const sql = String.raw`
begin;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_spc_' || v.k || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${Object.entries(U).map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now()
  from (values ${Object.keys(U).map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);

insert into public.units(id, store_name, kind) values (${q(SP)}, 'QA공간', 'space'), (${q(SP2)}, 'QA다른공간', 'space'), (${q(X)}, 'QA매장', 'store');
update public.units set owner_id = ${q(U.D)} where id = ${q(X)};
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.A)}, ${q(SP)}, 'space_owner'), (${q(U.B)}, ${q(SP)}, 'space_member'), (${q(U.M)}, ${q(SP)}, 'space_member'),
  (${q(U.C)}, ${q(SP2)}, 'space_owner'),
  (${q(U.D)}, ${q(X)}, 'owner'), (${q(U.M)}, ${q(X)}, 'manager');
-- 매장 X 설정 행(루틴 한 줄 · 카테고리 없음) · 공간 SP 행 없음(처음 저장이 만든다)
insert into public.schedule_config(unit_id, dayparts) values (${q(X)}, '[{"id":"dp1","routines":[]}]'::jsonb);

create function pg_temp.qa_state(p_uid uuid, p_sid uuid, p_store text, p_space text) returns void language plpgsql as $f$
begin
  delete from public.session_active_units where session_id = p_sid;
  delete from public.session_active_spaces where session_id = p_sid;
  if p_store is not null then insert into public.session_active_units(session_id, user_id, unit_id) values (p_sid, p_uid, p_store); end if;
  if p_space is not null then insert into public.session_active_spaces(session_id, user_id, space_id) values (p_sid, p_uid, p_space); end if;
  update public.profiles set active_unit_id = p_store, unit_id = p_store where id = p_uid;
end $f$;

create function pg_temp.qa_act(p_name text, p_uid uuid, p_sid uuid, p_act text, p_check text, p_expect text) returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('statement_timeout', '5000', true);
    execute 'set local role authenticated';
    execute p_act into r;
    if p_check like 'U:%' then
      -- 같은 사람으로 이어서 읽는다(다음 문장이라 앞 쓰기가 보인다).
      execute substr(p_check, 3) into r;
      execute 'reset role';
    else
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if p_check <> '' then execute p_check into r; end if;
    end if;
    raise exception using errcode = 'QAOK0', message = coalesce(r, '<null>');
  exception
    when sqlstate 'QAOK0' then r := 'ok|' || sqlerrm;
    when others then r := 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
  execute 'reset role';
  return 'QA|CHK|' || p_name || '¦' || p_expect || '¦' || r;
end $f$;

-- ① 결함 재현(표 경로 · 정책은 그대로라 계속 거절이어야 한다)
${st('A', null, SP)}
${act('A 공간 주인 · 표 경로로 공간 카테고리 쓰기 → 거절(42501)', 'A',
  `insert into public.schedule_config(unit_id, knowhow_categories) values (${q(SP)}, ${CATS}) on conflict (unit_id) do update set knowhow_categories = excluded.knowhow_categories returning 1`, '', 'err:42501')}
${act('A 공간 주인 · 표 경로로 공간 카테고리 읽기 → 0행', 'A', `select count(*)::text from public.schedule_config where unit_id = ${q(SP)}`, '', 'ok|0')}

-- ② 0780 함수
${act('A 공간 주인 · 함수로 쓰기 → 그 공간 행에 카테고리', 'A',
  `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, svcCats(SP), 'has:QA 공간 카테고리')}
${act('A 공간 주인 · 쓰고 읽기 → 같은 목록', 'A',
  `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, `U:select public.space_knowhow_categories(${q(SP)})::text`, 'has:kc_qa_1')}
${act('A 공간 주인 · 저장 전 읽기 → []', 'A', `select public.space_knowhow_categories(${q(SP)})::text`, '', 'ok|[]')}
${act('A 공간 주인 · 함수는 dayparts 를 안 만든다', 'A',
  `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`,
  `select coalesce(dayparts::text, 'null') from public.schedule_config where unit_id = ${q(SP)}`, 'not:routines')}

-- ③ 격리
${act('A 공간 주인 · 매장 번호로 쓰기 → invalid_argument', 'A', `select public.space_save_knowhow_categories(${q(X)}, ${CATS})::text`, '', 'err:invalid_argument')}
${act('A 공간 주인 · 배열 아님 → invalid_argument', 'A', `select public.space_save_knowhow_categories(${q(SP)}, '{"a":1}'::jsonb)::text`, '', 'err:invalid_argument')}
${act('A 공간 주인 · 101개 → invalid_argument', 'A', `select public.space_save_knowhow_categories(${q(SP)}, ${big})::text`, '', 'err:invalid_argument')}
${st('A', null, null)}
${act('A 공간에 안 들어간 세션 → not_space_owner', 'A', `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, '', 'err:not_space_owner')}
${st('B', null, SP)}
${act('B 공간 멤버 · 쓰기 → not_space_owner', 'B', `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, '', 'err:not_space_owner')}
${act('B 공간 멤버 · 읽기 → not_space_owner', 'B', `select public.space_knowhow_categories(${q(SP)})::text`, '', 'err:not_space_owner')}
${st('C', null, SP2)}
${act('C 다른 공간 주인 · 남의 공간 쓰기 → not_space_owner', 'C', `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, '', 'err:not_space_owner')}
${act('C 다른 공간 주인 · 남의 공간 읽기 → not_space_owner', 'C', `select public.space_knowhow_categories(${q(SP)})::text`, '', 'err:not_space_owner')}
${st('D', X, null)}
${act('D 매장 사장 · 공간 쓰기 → not_space_owner', 'D', `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, '', 'err:not_space_owner')}
${st('M', X, SP)}
${act('M 매장 매니저 겸 공간 멤버(둘 다 들어감) · 공간 쓰기 → not_space_owner', 'M', `select public.space_save_knowhow_categories(${q(SP)}, ${CATS})::text`, '', 'err:not_space_owner')}

-- ④ 매장 회귀(표 경로 그대로)
${st('D', X, null)}
${act('D 매장 사장 · 표 경로로 매장 카테고리 쓰기 → 됨', 'D',
  `update public.schedule_config set knowhow_categories = ${CATS} where unit_id = ${q(X)} returning 1`, svcCats(X), 'has:QA 공간 카테고리')}
${act('D 매장 사장 · 표 경로 읽기 → 매장 행 하나', 'D', `select count(*)::text from public.schedule_config`, '', 'ok|1')}
${st('M', X, SP)}
${act('M 매장 매니저(공간도 들어감) · 표 경로로 매장 카테고리 쓰기 → 됨', 'M',
  `update public.schedule_config set knowhow_categories = ${CATS} where unit_id = ${q(X)} returning 1`, svcCats(X), 'has:QA 공간 카테고리')}
${act('M 매장 매니저(공간도 들어감) · 표 경로 읽기 → 매장 행 하나(공간 행 안 섞임)', 'M', `select count(*)::text from public.schedule_config`, '', 'ok|1')}
${st('A', null, SP)}
${act('A 공간 주인 · 표 경로로 매장 X 쓰기 → 0행', 'A',
  `with u as (update public.schedule_config set knowhow_categories = ${CATS} where unit_id = ${q(X)} returning 1) select count(*)::text from u`, '', 'ok|0')}
rollback;
`;

const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) {
  console.error('psql 실패:\n' + (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|CONTEXT|LINE/.test(l)).slice(0, 10).join('\n'));
  process.exit(1);
}
let pass = 0, fail = 0;
console.log(`— 대상 로컬 DB(${DB}) · 공간 = ${SP} · 매장 = ${X} —`);
for (const l of r.stdout.split(/\r?\n/).filter((x) => x.startsWith('QA|CHK|'))) {
  const [name, expect, got] = l.slice(7).split('¦');
  let ok;
  if (expect.startsWith('err:')) ok = got.startsWith('err|') && got.includes(expect.slice(4));
  else if (expect.startsWith('has:')) ok = got.startsWith('ok|') && got.includes(expect.slice(4));
  else if (expect.startsWith('not:')) ok = got.startsWith('ok|') && !got.includes(expect.slice(4));
  else ok = got === expect;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  (기대 ${expect} · 받음 ${got})`}`);
}
if (pass + fail === 0) { console.log('검사 줄이 하나도 안 나왔다'); process.exit(1); }
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · skip 0 · AI 호출 0회`);
process.exit(fail === 0 ? 0 : 1);
