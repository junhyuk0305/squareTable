#!/usr/bin/env node
// qa-space-isolation.mjs — 공간·매장 통합 1번 덩이 "바닥" 격리 하니스 (2026-11-10 · 0364~0371 · 데이터구조 A안 3판 부록 C-0)
//
// 무엇을 증명하나: 공간 사람이 어떤 세션 상태에서도 매장 기능에 닿지 못하고, 매장 결과가 공간이 없을 때와 같다.
//   기대값을 손으로 쓰지 않는다. 같은 호출을 "공간이 없을 때"와 "공간이 있을 때" 두 번 해서 결과가 같은지 본다.
//   매장 기능 목록도 손으로 쓰지 않는다. DB 목록(pg_proc · pg_policies)에서 현재 매장 함수를 쓰는 것을 전부 뽑는다.
//
// 계정(부록 C-0): A 공간만 있는 주인 · B 공간 멤버 겸 매장 X 직원 · C 매장 X 매니저 겸 공간 멤버 · D 매장 X 사장(대조군)
//   · E 아무 데도 아닌 사람 · W 본사 작업실 멤버(작업실이 지금처럼 현재 매장이 되는지).
// 세션 상태: ① 아무 기록 없음 ② 현재 공간만 ③ 현재 매장 X (+ 현재 공간) ④ 세 기록에 공간 번호를 억지로 심음.
//
// 방식(1부 · psql): 로컬 DB 컨테이너에서 한 트랜잭션 안에 계정·공간·질문을 심고, 호출마다 authenticated 역할과
//   JWT 클레임을 흉내 내 부른 뒤 그 호출을 되돌린다. 쓰기 함수를 불러도 아무것도 남지 않는다. 끝에 트랜잭션 전체를 되돌린다.
//   = 공유 로컬 DB 에 흔적 0. 매장 X 는 로컬 데모 매장(store_001 · seed-demo)이라 실제 데이터로 비교된다.
// 방식(2부 · 실세션): 매직링크 실세션 하나로 공간 전환·들어가기 거절과 session_bootstrap 을 PostgREST 로 잰다(AGENTS ⑥). 자가 정리.
//
// 로컬 전용. 공간 행은 입구가 꺼져 있어 서비스 권한으로 심는다. AI 호출 0회.
// 실행: npm run qa:space-isolation:local
import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { runStoreLinkChecks } from './lib/qa-space-store-link.mjs';

if (!process.argv.includes('--local')) { console.error('중단: 로컬 전용 하니스다(--local)'); process.exit(2); }
const DB = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
const X = process.env.QA_SPACE_STORE || 'store_001';
const rnd = Math.random().toString(16).slice(2, 10);
const SP = `qa_sp_${rnd}`, WS = `qa_ws_${rnd}`;
const U = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'W'].map((k, i) => [k, `00000000-0000-4000-8${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
const S = Object.fromEntries(Object.keys(U).map((k, i) => [k, `00000000-0000-4000-9${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));

let pass = 0, fail = 0, skip = 0, calls = 0, rejected = 0;
const check = (n, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`  ${ok ? '✓' : '✗'}`, n, extra); };
const skipped = (n, why) => { skip++; console.log('  - skip', n, `(${why})`); };

function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql 실패: ${(r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|CONTEXT/.test(l)).slice(0, 6).join(' | ')}`);
  return r.stdout;
}

// ── 1부 SQL ─────────────────────────────────────────────────────────────────
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = String.raw`
begin;
-- 계정 6 · 세션 6 (트리거 handle_new_user 가 프로필을 만든다)
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_spi_' || v.k || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${Object.entries(U).map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now()
  from (values ${Object.keys(U).map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);

-- 매장 X 멤버(데모 매장) · 공간 SP(주인 칸 비움 · 5-4) · 본사 작업실 WS
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.D)}, ${q(X)}, 'owner'), (${q(U.C)}, ${q(X)}, 'manager'), (${q(U.B)}, ${q(X)}, 'junior');
insert into public.units(id, store_name, kind) values (${q(SP)}, 'QA공간', 'space'), (${q(WS)}, 'QA작업실', 'brand_workspace');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.A)}, ${q(SP)}, 'space_owner'), (${q(U.B)}, ${q(SP)}, 'space_member'), (${q(U.C)}, ${q(SP)}, 'space_member'),
  (${q(U.W)}, ${q(WS)}, 'manager');

-- 공간 데이터: 노하우(발행·초안) · 질문 기록과 답할 질문(A·B·C 각각) · 교육 링크
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role) values
  ('qa_pb_pub_${rnd}', ${q(SP)}, '서비스', '공간 발행', 'published', 'space_owner'),
  ('qa_pb_drf_${rnd}', ${q(SP)}, '서비스', '공간 초안', 'draft', 'space_owner');
-- 질문자 칸은 작성자 도장 트리거(stamp_author)가 auth.uid() 로 덮는다. 질문마다 그 사람의 클레임을 세우고 넣는다.
${['A', 'B', 'C'].map((k) => `
select set_config('request.jwt.claims', json_build_object('sub', ${q(U[k])}, 'role', 'authenticated')::text, true);
insert into public.chat_queries(id, unit_id, query_text) values ('qa_cq_${k}_${rnd}', ${q(SP)}, '공간 질문 ${k}');
insert into public.unknown_queries(id, unit_id, query_text, status) values ('qa_uq_${k}_${rnd}', ${q(SP)}, '공간 질문 ${k}', 'pending_owner_answer');`).join('')}
select set_config('request.jwt.claims', '', true);
select 'QA|SEEDQ|' || count(*) filter (where junior_id is not null) || '/' || count(*) from public.chat_queries where unit_id = ${q(SP)};
insert into public.edu_links(id, unit_id, token, title, expires_at)
values ('qa_el_${rnd}', ${q(SP)}, md5(random()::text) || md5(random()::text), 'QA 링크', now() + interval '7 days');

-- 호출 하나 = 하위 트랜잭션 하나. 역할·클레임을 바꾸고 부른 뒤 일부러 예외를 내 그 호출의 쓰기를 전부 되돌린다.
create function pg_temp.qa_call(p_uid uuid, p_sid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('statement_timeout', '5000', true);
    execute 'set local role authenticated';
    execute p_sql into r;
    raise exception using errcode = 'QAOK0', message = 'qa_ok';
  exception
    when sqlstate 'QAOK0' then return 'ok|' || coalesce(r, '<null>');
    when others then return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;

-- 세션 상태 바꾸기(서비스 권한 · 되돌릴 필요 없음: 매번 지우고 다시 심는다)
create function pg_temp.qa_state(p_uid uuid, p_sid uuid, p_store text, p_space text, p_active text, p_primary text) returns void language plpgsql as $f$
begin
  delete from public.session_active_units where session_id = p_sid;
  delete from public.session_active_spaces where session_id = p_sid;
  if p_store is not null then insert into public.session_active_units(session_id, user_id, unit_id) values (p_sid, p_uid, p_store); end if;
  if p_space is not null then insert into public.session_active_spaces(session_id, user_id, space_id) values (p_sid, p_uid, p_space); end if;
  update public.profiles set active_unit_id = p_active, unit_id = p_primary where id = p_uid;
end $f$;

-- 매장 기능 목록: 현재 매장 함수(auth_unit_id · auth_member_unit_id · session_unit)를 부르는 함수 전부
create temp table qa_fn as
select p.oid, p.proname::text as name,
       pg_get_function_identity_arguments(p.oid) as sig,
       p.proretset or t.typtype = 'c' or p.prorettype = 'record'::regtype as setlike,
       (select array_agg(format_type(p.proargtypes[i], null) order by i) from generate_series(0, p.pronargs - p.pronargdefaults - 1) i) as req_types,
       (select array_agg(coalesce(p.proargnames[i + 1], '') order by i) from generate_series(0, p.pronargs - p.pronargdefaults - 1) i) as req_names
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
 where n.nspname = 'public' and p.prokind = 'f'
   and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
   and has_function_privilege('authenticated', p.oid, 'execute')
   and p.prosrc ~ '(auth_unit_id|auth_member_unit_id|session_unit)\s*\(\s*\)';

create function pg_temp.qa_argval(p_type text, p_name text, p_unit text, p_uid uuid) returns text language sql as $f$
  select case
    when p_type in ('text', 'character varying') and p_name ~* '(unit|store|space)' then quote_literal(p_unit)
    when p_type in ('text', 'character varying') then '''qa'''
    when p_type = 'uuid' then quote_literal(p_uid::text) || '::uuid'
    when p_type in ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision') then '1'
    when p_type = 'boolean' then 'false'
    when p_type = 'date' then 'current_date'
    when p_type like 'timestamp%' then 'now()'
    when p_type like 'time%' then '''09:00''::time'
    when p_type in ('jsonb', 'json') then '''{}''::' || p_type
    when p_type in ('text[]', 'uuid[]', 'integer[]') then '''{}''::' || p_type
    when p_type = 'interval' then '''1 day''::interval'
  end
$f$;

create function pg_temp.qa_fn_sql(p_oid oid, p_unit text, p_uid uuid) returns text language plpgsql as $f$
declare f record; args text[] := '{}'; v text; i int;
begin
  select * into f from qa_fn where oid = p_oid;
  for i in 1 .. coalesce(array_length(f.req_types, 1), 0) loop
    v := pg_temp.qa_argval(f.req_types[i], f.req_names[i], p_unit, p_uid);
    if v is null then return null; end if;  -- 모르는 인자 형 = skip
    args := args || v;
  end loop;
  if f.setlike then
    return format($s$select count(*) || '#' || coalesce(md5(string_agg(x, '§' order by x)), '-') || '#' || coalesce(bool_or(strpos(x, %L) > 0), false) || '#' || coalesce(bool_or(strpos(x, %L) > 0), false) from (select t::text x from public.%I(%s) t) s$s$,
                  '${SP}', '${X}', f.name, array_to_string(args, ', '));
  end if;
  return format($s$select '1#' || coalesce(md5(x), '-') || '#' || coalesce(strpos(x, %L) > 0, false) || '#' || coalesce(strpos(x, %L) > 0, false) from (select (public.%I(%s))::text x) s$s$,
                '${SP}', '${X}', f.name, array_to_string(args, ', '));
end $f$;

-- 표 목록: 정책이 현재 매장·현재 공간 함수를 쓰는 표 전부. 공간 행(unit_id = SP)은 따로 센다.
create temp table qa_tbl as
select distinct c.relname::text as name,
       exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.relname and ic.column_name = 'unit_id') as has_unit
  from pg_policies pp join pg_class c on c.relname = pp.tablename join pg_namespace n on n.oid = c.relnamespace and n.nspname = pp.schemaname
 where pp.schemaname = 'public' and c.relkind = 'r'
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') ~ '(auth_unit_id|auth_member_unit_id|auth_space_id)\(\)';

-- 멤버 표는 지금 정책(um_select_self)이 내 행을 늘 보여 준다. 클라는 이 표를 현재 매장 번호로만 걸러 읽는다(db.ts:1253).
--   그래서 공간 행은 "남의 공간 멤버 행"만 센다. 내 공간 멤버십 행은 매장 쪽 비교에서도 뺀다.
create function pg_temp.qa_tbl_sql(p_name text, p_has_unit boolean) returns text language sql as $f$
  select case when p_name = 'unit_members' then
    format($s$select count(*) filter (where u is distinct from %L) || '#' || coalesce(md5(string_agg(x, '§' order by x) filter (where u is distinct from %L)), '-') || '#' || count(*) filter (where u = %L and not mine) from (select t::text x, t.unit_id::text u, t.user_id = auth.uid() mine from public.unit_members t) s$s$, '${SP}', '${SP}', '${SP}')
  when p_has_unit then
    format($s$select count(*) filter (where u is distinct from %L) || '#' || coalesce(md5(string_agg(x, '§' order by x) filter (where u is distinct from %L)), '-') || '#' || count(*) filter (where u = %L) from (select t::text x, t.unit_id::text u from public.%I t) s$s$, '${SP}', '${SP}', '${SP}', p_name)
  else
    format($s$select count(*) || '#' || coalesce(md5(string_agg(x, '§' order by x)), '-') || '#' || count(*) filter (where strpos(x, %L) > 0) from (select t::text x from public.%I t) s$s$, '${SP}', p_name)
  end
$f$;

create temp table qa_res(who text, state text, kind text, name text, out text);

-- 한 상태에서 함수·표 전부 부르기
create function pg_temp.qa_sweep(p_who text, p_state text, p_uid uuid, p_sid uuid, p_unit text) returns void language plpgsql as $f$
declare f record; t record; s text;
begin
  for f in select oid, name || '(' || sig || ')' as label from qa_fn order by name, sig loop
    s := pg_temp.qa_fn_sql(f.oid, p_unit, p_uid);
    insert into qa_res values (p_who, p_state, 'fn', f.label, case when s is null then 'skip' else pg_temp.qa_call(p_uid, p_sid, s) end);
  end loop;
  for t in select name, has_unit from qa_tbl order by name loop
    insert into qa_res values (p_who, p_state, 'tbl', t.name, pg_temp.qa_call(p_uid, p_sid, pg_temp.qa_tbl_sql(t.name, t.has_unit)));
  end loop;
end $f$;

-- A: ① 기록 없음 · ② 현재 공간만 · ④ 세 기록을 공간으로 억지로(현재 공간 없음)
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, null, null, null);
select pg_temp.qa_sweep('A', '1', ${q(U.A)}, ${q(S.A)}, ${q(SP)});
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, ${q(SP)}, null, null);
select pg_temp.qa_sweep('A', '2', ${q(U.A)}, ${q(S.A)}, ${q(SP)});
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, ${q(SP)}, null, ${q(SP)}, ${q(SP)});
select pg_temp.qa_sweep('A', '4', ${q(U.A)}, ${q(S.A)}, ${q(SP)});
-- B·C·D: ③a 현재 매장 X 만 · ③b 현재 매장 X + 현재 공간(D 는 공간 멤버가 아니라 ③a 만 = 대조군)
${['B', 'C'].map((k) => `
select pg_temp.qa_state(${q(U[k])}, ${q(S[k])}, ${q(X)}, null, null, null);
select pg_temp.qa_sweep('${k}', '3a', ${q(U[k])}, ${q(S[k])}, ${q(X)});
select pg_temp.qa_state(${q(U[k])}, ${q(S[k])}, ${q(X)}, ${q(SP)}, null, null);
select pg_temp.qa_sweep('${k}', '3b', ${q(U[k])}, ${q(S[k])}, ${q(X)});`).join('')}
-- B·C ③c: 공간 멤버십 자체가 없는 대조군. 멤버십 행을 세기만 하는 함수는 ③a·③b 끼리 비교로는 안 드러난다(verify 11-10).
delete from public.unit_members where unit_id = ${q(SP)} and user_id in (${q(U.B)}, ${q(U.C)});
${['B', 'C'].map((k) => `
select pg_temp.qa_state(${q(U[k])}, ${q(S[k])}, ${q(X)}, null, null, null);
select pg_temp.qa_sweep('${k}', '3c', ${q(U[k])}, ${q(S[k])}, ${q(X)});`).join('')}
insert into public.unit_members(user_id, unit_id, role) values (${q(U.B)}, ${q(SP)}, 'space_member'), (${q(U.C)}, ${q(SP)}, 'space_member');
-- B: ② 현재 공간만(매장 기록 없음) — 매장 기능이 A 의 ① 처럼 닫히는지
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, null, null, null, null);
select pg_temp.qa_sweep('B', '1', ${q(U.B)}, ${q(S.B)}, ${q(SP)});
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, null, ${q(SP)}, null, null);
select pg_temp.qa_sweep('B', '2', ${q(U.B)}, ${q(S.B)}, ${q(SP)});

select 'QA|RES|' || who || '|' || state || '|' || kind || '|' || name || '|' || out from qa_res order by kind, name, who, state;
select 'QA|NFN|' || count(*) from qa_fn;
select 'QA|NTBL|' || count(*) from qa_tbl;

-- ── 이름 붙인 검사 ──────────────────────────────────────────────────────────
create function pg_temp.qa_chk(p_name text, p_who text, p_sql text, p_expect text) returns text language plpgsql as $f$
declare u uuid; s uuid; r text;
begin
  select case p_who ${Object.keys(U).map((k) => `when '${k}' then ${q(U[k])}::uuid`).join(' ')} end,
         case p_who ${Object.keys(U).map((k) => `when '${k}' then ${q(S[k])}::uuid`).join(' ')} end into u, s;
  r := pg_temp.qa_call(u, s, p_sql);
  return 'QA|CHK|' || p_name || '¦' || p_expect || '¦' || r;
end $f$;

-- 현재 매장 함수: 세 기록 조합 (기대 = 그 값 그대로 · ok|<null> = 현재 매장 없음)
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, ${q(SP)}, ${q(SP)}, ${q(SP)}, ${q(SP)});
select pg_temp.qa_chk('A 세 기록 전부 공간 → 현재 매장 없음', 'A', 'select public.auth_member_unit_id()', 'ok|<null>');
select pg_temp.qa_chk('A 세 기록 전부 공간 → auth_unit_id 없음', 'A', 'select public.auth_unit_id()', 'ok|<null>');
select pg_temp.qa_chk('A 세 기록 전부 공간 → session_unit 없음', 'A', 'select public.session_unit()', 'ok|<null>');
select pg_temp.qa_chk('A 세 기록 전부 공간 → 현재 공간 = 공간', 'A', 'select public.auth_space_id()', 'ok|${SP}');
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(SP)}, null, ${q(X)}, null);
select pg_temp.qa_chk('B 기기 기록 공간 + 계정 기록 매장 → 매장', 'B', 'select public.auth_member_unit_id()', 'ok|${X}');
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(SP)}, null, ${q(SP)}, ${q(X)});
select pg_temp.qa_chk('B 기기·계정 기록 공간 + 옛 주매장 칸 매장 → 매장', 'B', 'select public.auth_member_unit_id()', 'ok|${X}');
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, ${q(SP)}, ${q(SP)}, ${q(SP)});
select pg_temp.qa_chk('B 기기 기록 매장 + 현재 공간 → 매장', 'B', 'select public.auth_member_unit_id()', 'ok|${X}');
select pg_temp.qa_state(${q(U.D)}, ${q(S.D)}, ${q(X)}, null, null, null);
select pg_temp.qa_chk('D 매장 사장 기기 기록 → 매장(그대로)', 'D', 'select public.auth_member_unit_id()', 'ok|${X}');
select pg_temp.qa_state(${q(U.W)}, ${q(S.W)}, ${q(WS)}, null, null, null);
select pg_temp.qa_chk('W 본사 작업실 기기 기록 → 작업실(그대로)', 'W', 'select public.auth_member_unit_id()', 'ok|${WS}');
select pg_temp.qa_state(${q(U.W)}, ${q(S.W)}, null, null, ${q(WS)}, null);
select pg_temp.qa_chk('W 본사 작업실 계정 기록 → 작업실(그대로)', 'W', 'select public.auth_member_unit_id()', 'ok|${WS}');

-- 섞임: 세 기록에 공간을 심은 A·B 의 목록 함수에 공간이 안 나온다(결과에 공간 번호가 없으면 false)
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(SP)}, ${q(SP)}, ${q(SP)}, ${q(SP)});
${['A', 'B'].flatMap((k) => [
  ['my_units', `select coalesce(bool_or(strpos(t::text, '${SP}') > 0), false)::text from public.my_units() t`],
  ['my_cross_summary_v2', `select coalesce(bool_or(strpos(t::text, '${SP}') > 0), false)::text from public.my_cross_summary_v2() t`],
  ['my_units_notif_data', `select coalesce(bool_or(strpos(t::text, '${SP}') > 0), false)::text from public.my_units_notif_data() t`],
  ['my_locked_units', `select coalesce(bool_or(t = '${SP}'), false)::text from public.my_locked_units() t`],
  ['session_bootstrap(프로필 칸 제외)', `select (strpos((public.session_bootstrap() - 'profile')::text, '${SP}') > 0)::text`],
].map(([n, s]) => `select pg_temp.qa_chk(${q(`${k} 공간 기록 심음 → ${n} 에 공간 없음`)}, '${k}', ${q(s)}, 'ok|false');`)).join('\n')}

-- 전환 2개: 공간 번호 거절
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, null, null, null);
select pg_temp.qa_chk('A switch_session_unit(공간) 거절', 'A', $s$select public.switch_session_unit('${SP}')::text$s$, 'err');
select pg_temp.qa_chk('A switch_active_unit(공간) 거절', 'A', $s$select public.switch_active_unit('${SP}')::text$s$, 'err');
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, null, null, null);
select pg_temp.qa_chk('B switch_session_unit(공간) 거절', 'B', $s$select public.switch_session_unit('${SP}')::text$s$, 'err');
select pg_temp.qa_chk('B switch_session_unit(매장) 그대로 됨', 'B', $s$select public.switch_session_unit('${X}')::text$s$, 'ok|');
select pg_temp.qa_chk('A enter_space 입구 꺼짐 → 거절', 'A', $s$select public.enter_space('${SP}')::text$s$, 'err');

-- 권한 함수: 위험한 칸만. 현재 공간이 있는 세션에서.
select pg_temp.qa_state(${q(U.C)}, ${q(S.C)}, ${q(X)}, ${q(SP)}, null, null);
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, ${q(SP)}, null, null);
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, ${q(SP)}, null, null);
${[
  ['C', 'answer', 'false'], ['C', 'answer_direct', 'false'], ['C', 'write_knowhow', 'false'], ['C', 'manage_links', 'false'], ['C', 'manage_members', 'false'],
  ['C', 'read', 'true'], ['C', 'ask', 'true'],
  ['B', 'answer', 'false'], ['B', 'write_knowhow', 'false'], ['B', 'read', 'true'],
  ['A', 'answer_direct', 'true'], ['A', 'write_knowhow', 'true'], ['A', 'manage_members', 'true'],
].map(([k, p, e]) => `select pg_temp.qa_chk(${q(`${k} auth_can(공간, ${p}) = ${e}`)}, '${k}', $s$select public.auth_can('${SP}', '${p}')::text$s$, 'ok|${e}');`).join('\n')}
select pg_temp.qa_chk('C auth_can(매장, write_knowhow) = true (매장 매니저 그대로)', 'C', $s$select public.auth_can('${X}', 'write_knowhow')::text$s$, 'ok|true');
select pg_temp.qa_chk('B auth_can(매장, answer_direct) = false (매장 직원 그대로)', 'B', $s$select public.auth_can('${X}', 'answer_direct')::text$s$, 'ok|false');
${['read', 'ask', 'answer', 'answer_direct', 'write_knowhow', 'manage_links', 'manage_members'].map((p) =>
  `select pg_temp.qa_chk(${q(`E 멤버 아님 auth_can(공간, ${p}) = false`)}, 'E', $s$select public.auth_can('${SP}', '${p}')::text$s$, 'ok|false');`).join('\n')}
select pg_temp.qa_state(${q(U.C)}, ${q(S.C)}, ${q(X)}, null, null, null);
select pg_temp.qa_chk('C 현재 공간 없음 → auth_can(공간, read) = false', 'C', $s$select public.auth_can('${SP}', 'read')::text$s$, 'ok|false');
select pg_temp.qa_state(${q(U.C)}, ${q(S.C)}, ${q(X)}, ${q(SP)}, null, null);

-- 질문 행: 매니저 C 와 멤버 B 는 공간에서 내 질문만, 주인 A 는 전부
${['chat_queries', 'unknown_queries'].flatMap((t) => [
  ['C', `select count(*) || '/' || count(*) filter (where junior_id = auth.uid()::text) from public.${t} where unit_id = '${SP}'`, 'ok|1/1'],
  ['B', `select count(*) || '/' || count(*) filter (where junior_id = auth.uid()::text) from public.${t} where unit_id = '${SP}'`, 'ok|1/1'],
  ['A', `select count(*)::text from public.${t} where unit_id = '${SP}'`, 'ok|3'],
].map(([k, s, e]) => `select pg_temp.qa_chk(${q(`${k} ${t} 공간 행 읽기`)}, '${k}', ${q(s)}, '${e}');`)).join('\n')}
select pg_temp.qa_chk('C 매니저가 공간에서 남의 질문 고치기 0행', 'C', $s$with x as (update public.unknown_queries set status = 'dismissed' where id = 'qa_uq_B_${rnd}' returning 1) select count(*)::text from x$s$, 'ok|0');
select pg_temp.qa_chk('C 매니저가 공간에서 남의 질문 지우기 0행', 'C', $s$with x as (delete from public.chat_queries where id = 'qa_cq_B_${rnd}' returning 1) select count(*)::text from x$s$, 'ok|0');
select pg_temp.qa_chk('C 매니저가 공간 노하우 쓰기 거절', 'C', $s$insert into public.playbook_entries(id, unit_id, category, title, status) values ('qa_pb_c_${rnd}', '${SP}', '서비스', 'c', 'published') returning 'inserted'$s$, 'err');
select pg_temp.qa_chk('C 매니저가 공간 초안 노하우 0행', 'C', $s$select count(*)::text from public.playbook_entries where unit_id = '${SP}' and status <> 'published'$s$, 'ok|0');
select pg_temp.qa_chk('C 매니저가 공간 발행 노하우 읽기', 'C', $s$select count(*)::text from public.playbook_entries where unit_id = '${SP}'$s$, 'ok|1');
select pg_temp.qa_chk('A 주인 질문 기록 넣기 거절(연습)', 'A', $s$insert into public.chat_queries(id, unit_id, query_text, junior_id) values ('qa_cq_a2_${rnd}', '${SP}', 'q', auth.uid()) returning 'inserted'$s$, 'err');
select pg_temp.qa_chk('A 주인 답할 질문 넣기 거절(연습)', 'A', $s$insert into public.unknown_queries(id, unit_id, query_text, junior_id) values ('qa_uq_a2_${rnd}', '${SP}', 'q', auth.uid()) returning 'inserted'$s$, 'err');
select pg_temp.qa_chk('B 멤버 질문 넣기 됨', 'B', $s$insert into public.chat_queries(id, unit_id, query_text, junior_id) values ('qa_cq_b2_${rnd}', '${SP}', 'q', auth.uid()) returning 'inserted'$s$, 'ok|inserted');
select pg_temp.qa_chk('B 멤버 질문에 링크 번호 달기 거절', 'B', $s$insert into public.chat_queries(id, unit_id, query_text, junior_id, link_id) values ('qa_cq_b3_${rnd}', '${SP}', 'q', auth.uid(), 'qa_el_${rnd}') returning 'inserted'$s$, 'err');
select pg_temp.qa_chk('B 매장 직원 질문에 링크 번호 달기 거절', 'B', $s$insert into public.chat_queries(id, unit_id, query_text, junior_id, link_id) values ('qa_cq_b4_${rnd}', '${X}', 'q', auth.uid(), 'qa_el_${rnd}') returning 'inserted'$s$, 'err');

-- ── 보안 검토(11-10)에서 막은 두 길 ──
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, null, null, null);
select set_config('request.jwt.claims', json_build_object('sub', ${q(U.B)}, 'role', 'authenticated')::text, true);
insert into public.chat_queries(id, unit_id, query_text) values ('qa_cq_bx_${rnd}', ${q(X)}, '매장 질문');
select set_config('request.jwt.claims', '', true);
select pg_temp.qa_chk('B 매장 직원이 자기 질문 기록에 남의 링크 번호 달기 거절', 'B', $s$with x as (update public.chat_queries set link_id = 'qa_el_${rnd}' where id = 'qa_cq_bx_${rnd}' returning 1) select count(*)::text from x$s$, 'err');
select pg_temp.qa_chk('B 자기 질문 기록의 다른 칸 고치기는 그대로 됨', 'B', $s$with x as (update public.chat_queries set satisfaction = 'up' where id = 'qa_cq_bx_${rnd}' returning 1) select count(*)::text from x$s$, 'ok|1');
create function pg_temp.qa_link_delete_as_user() returns text language plpgsql as $f$
begin
  begin
    -- 질문은 B 가 넣고(질문 주인 = B), 지우기는 E 가 한다. E 는 질문 주인도 관리자도 아니다(동료 칸 검사 갈래 · verify 11-10).
    insert into public.edu_links(id, unit_id, token, title, expires_at) values ('qa_el_d_${rnd}', ${q(SP)}, md5('d') || md5('e'), 'd', now() + interval '1 day');
    perform set_config('request.jwt.claims', json_build_object('sub', ${q(U.B)}, 'role', 'authenticated')::text, true);
    insert into public.unknown_queries(id, unit_id, query_text, status, link_id) values ('qa_uq_l_${rnd}', ${q(SP)}, 'q', 'pending_owner_answer', 'qa_el_d_${rnd}');
    insert into public.chat_queries(id, unit_id, query_text, link_id) values ('qa_cq_l_${rnd}', ${q(SP)}, 'q', 'qa_el_d_${rnd}');
    perform set_config('request.jwt.claims', json_build_object('sub', ${q(U.E)}, 'role', 'authenticated')::text, true);
    delete from public.edu_links where id = 'qa_el_d_${rnd}';
    raise exception using errcode = 'QAOK0', message = (select count(*) from public.unknown_queries where id = 'qa_uq_l_${rnd}' and link_id is null)::text
                                                     || '/' || (select count(*) from public.chat_queries where id = 'qa_cq_l_${rnd}' and link_id is null)::text;
  exception
    when sqlstate 'QAOK0' then perform set_config('request.jwt.claims', '', true); return 'ok|' || sqlerrm;
    when others then perform set_config('request.jwt.claims', '', true); return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;
select 'QA|CHK|로그인한 사람이 링크를 지워도 질문 두 표가 막지 않는다¦ok|1/1¦' || pg_temp.qa_link_delete_as_user();
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, ${q(SP)}, null, null);
select pg_temp.qa_chk('A 공간 주인이 매장 X 노하우를 링크에 담기 거절', 'A', $s$insert into public.edu_links(id, unit_id, token, title, expires_at, entry_ids) values ('qa_el_x_${rnd}', '${SP}', md5('x') || md5('y'), 'x', now() + interval '1 day', array[(select id from public.playbook_entries where unit_id = '${X}' limit 1)]) returning 'inserted'$s$, 'err');
select pg_temp.qa_chk('A 공간 주인이 자기 공간 노하우를 링크에 담기 됨', 'A', $s$insert into public.edu_links(id, unit_id, token, title, expires_at, entry_ids) values ('qa_el_s_${rnd}', '${SP}', md5('s') || md5('t'), 's', now() + interval '1 day', array['qa_pb_pub_${rnd}']) returning 'inserted'$s$, 'ok|inserted');

-- ── 질문 보호 트리거(0370)의 공간 행 판정 ──
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, ${q(SP)}, null, null);
select pg_temp.qa_chk('B 공간 멤버가 자기 질문을 직접 답함으로 바꾸기 거절', 'B', $s$update public.unknown_queries set status = 'answered_direct' where id = 'qa_uq_B_${rnd}' returning 'updated'$s$, 'err');
select pg_temp.qa_chk('A 공간 주인이 승인한 사람을 남으로 적기 거절', 'A', $s$update public.unknown_queries set approved_by = '${U.B}' where id = 'qa_uq_B_${rnd}' returning 'updated'$s$, 'err');
select pg_temp.qa_chk('A 공간 주인이 답 쓴 사람을 남으로 적기 거절', 'A', $s$update public.unknown_queries set answer_author_id = '${U.C}' where id = 'qa_uq_B_${rnd}' returning 'updated'$s$, 'err');
select pg_temp.qa_chk('A 공간 주인이 대기 질문을 직접 답함으로 바꾸기 됨', 'A', $s$update public.unknown_queries set status = 'answered_direct', answer_kind = 'sent', answered_by = auth.uid(), answer_author_id = auth.uid() where id = 'qa_uq_B_${rnd}' returning 'updated'$s$, 'ok|updated');

-- ── 합류와 나가기(0366): 공간 초대코드는 매장 합류로 안 열리고, 나간 뒤 다음 매장으로 공간을 안 고른다 ──
update public.units set invite_code = 'QS' || upper(substr(md5(random()::text), 1, 4)) where id = ${q(SP)};
select pg_temp.qa_state(${q(U.E)}, ${q(S.E)}, null, null, null, null);
-- 전화 인증 판정(phone_verified_ok)을 지나야 코드 대조까지 간다. 인증 면제 날짜 이전 계정으로 만든다(끝에 되돌림).
-- 대조군이 무료 직원 한도(2명)에 안 걸리게 무료 모드를 켠다(트랜잭션 끝에 되돌아간다).
insert into public.app_config(key, value) values ('billing_free_mode', 'true') on conflict (key) do update set value = excluded.value;
update public.profiles set created_at = '2020-01-01' where id = ${q(U.E)};
update public.units set invite_code = coalesce(invite_code, 'QX' || upper(substr(md5(random()::text), 1, 4))), invite_expires_at = null where id = ${q(X)};
select pg_temp.qa_chk('E 대조군: 매장 X 초대코드로는 합류 됨', 'E', format($s$select count(*)::text from public.join_by_invite(%L)$s$, (select invite_code from public.units where id = ${q(X)})), 'ok|1');
-- join_by_invite 는 틀린 코드를 오류가 아니라 0행으로 돌려준다(지금 동작). 공간 코드도 같아야 한다.
select pg_temp.qa_chk('E 공간 초대코드로 매장 합류 0행', 'E', format($s$select count(*)::text from public.join_by_invite(%L)$s$, (select invite_code from public.units where id = ${q(SP)})), 'ok|0');
select pg_temp.qa_chk('E 공간 초대코드는 "매장 인원 다 참" 신고 대상이 아님', 'E', format($s$select public.report_join_full(%L)::text$s$, (select invite_code from public.units where id = ${q(SP)})), 'ok|false');
create function pg_temp.qa_after(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute p_sql;
  select coalesce(p.active_unit_id, '<null>') || '/' || coalesce(p.unit_id, '<null>') || '/' || coalesce(public.auth_member_unit_id(), '<null>')
    into r from public.profiles p where p.id = auth.uid();
  return (strpos(r, '${SP}') > 0)::text;
end $f$;
grant execute on function pg_temp.qa_after(text) to authenticated;
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, null, ${q(X)}, ${q(X)});
select pg_temp.qa_chk('B 매장 나가기 → 다음 매장으로 공간을 안 고름', 'B', $s$select pg_temp.qa_after('select public.leave_store()')$s$, 'ok|false');
-- 내보내기의 다음 매장 고르기는 close_member_tenure(0366) 안에 있다. 데모 매장은 주인 칸이 D 가 아니라
--   remove_staff 의 사장 판정에 걸린다. 그래서 내부 함수를 서비스 권한으로 직접 부르고 되돌린다.
update public.profiles set active_unit_id = ${q(X)}, unit_id = ${q(X)} where id = ${q(U.B)};
create function pg_temp.qa_close_tenure() returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform public.close_member_tenure(${q(X)}, ${q(U.B)}::uuid, 'removed', false);
    select (strpos(coalesce(p.active_unit_id, '') || '/' || coalesce(p.unit_id, ''), '${SP}') > 0)::text into r
      from public.profiles p where p.id = ${q(U.B)};
    raise exception using errcode = 'QAOK0', message = r;
  exception
    when sqlstate 'QAOK0' then return 'ok|' || sqlerrm;
    when others then return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;
select 'QA|CHK|B 내보내기(close_member_tenure) → 다음 매장으로 공간을 안 고름¦ok|false¦' || pg_temp.qa_close_tenure();

-- 다음 매장 고르기는 지운 매장(0358 deleted_at)을 건너뛴다(0366). 지운 매장 Y 가 더 오래된 소속이라 먼저 뽑히는 자리에 둔다.
--   주인 칸은 비운다(사장을 넣으면 전화 인증 트리거가 먼저 거절한다 · 이 검사는 사장과 무관하다).
--   지운 매장에는 합류가 막히므로(0335 트리거) 직원이 들어온 뒤에 지운다. 실제 순서와 같다.
insert into public.units(id, store_name, kind) values
  ('qa_spi_y_${rnd}', 'QA지운매장', 'store'), ('qa_spi_z_${rnd}', 'QA살아있는매장', 'store');
insert into public.unit_members(user_id, unit_id, role, created_at) values
  (${q(U.B)}, 'qa_spi_y_${rnd}', 'junior', '2000-01-01'), (${q(U.B)}, 'qa_spi_z_${rnd}', 'junior', '2001-01-01');
update public.units set deleted_at = now() where id = 'qa_spi_y_${rnd}';
update public.profiles set active_unit_id = ${q(X)}, unit_id = ${q(X)} where id = ${q(U.B)};
create function pg_temp.qa_next_live() returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform public.close_member_tenure(${q(X)}, ${q(U.B)}::uuid, 'removed', false);
    select coalesce(p.unit_id, '<null>') into r from public.profiles p where p.id = ${q(U.B)};
    raise exception using errcode = 'QAOK0', message = r;
  exception
    when sqlstate 'QAOK0' then return 'ok|' || sqlerrm;
    when others then return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;
select 'QA|CHK|B 내보내기 → 다음 매장으로 지운 매장을 안 고름¦ok|qa_spi_z_${rnd}¦' || pg_temp.qa_next_live();

-- 매일 파기의 백스톱(purge_deleted_accounts)이 공간을 지우지 않는다(0372). 공간은 주인 칸이 원래 비어 있다.
create function pg_temp.qa_purge_keeps_space() returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform public.purge_deleted_accounts();
    select coalesce((select (u.deleted_at is null and u.purged_at is null)::text from public.units u where u.id = ${q(SP)}), 'gone') into r;
    raise exception using errcode = 'QAOK0', message = r;
  exception
    when sqlstate 'QAOK0' then return 'ok|' || sqlerrm;
    when others then return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;
select 'QA|CHK|매일 파기 백스톱이 공간을 남김¦ok|true¦' || pg_temp.qa_purge_keeps_space();

-- ── AI 상한 한 곳(0369): 경계 199/200 · 2999/3000 · 공간 299/300(무료 모드에도) ──
--   엣지를 거치지 않고 상한 함수를 서비스 권한으로 직접 부른다(로컬에서 AI 를 부르지 않는다). 무료 모드 변경은 끝에 되돌아간다.
insert into public.units(id, store_name, kind) values ('qa_paid_${rnd}', 'QA유료', 'store'), ('qa_free_${rnd}', 'QA무료', 'store');
insert into public.unit_subscriptions(unit_id, status, plan, paid_until) values ('qa_paid_${rnd}', 'active', 'single', now() + interval '30 days')
  on conflict (unit_id) do update set status = excluded.status, plan = excluded.plan, paid_until = excluded.paid_until;
create function pg_temp.qa_cap(p_name text, p_unit text, p_used int, p_free text, p_expect text) returns text language plpgsql as $f$
declare r record; m text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  insert into public.app_config(key, value) values ('billing_free_mode', p_free) on conflict (key) do update set value = excluded.value;
  insert into public.ai_usage_monthly(unit_id, month, used, updated_at) values (p_unit, m, p_used, now())
    on conflict (unit_id, month) do update set used = excluded.used;
  select * into r from public.consume_ai_quota_for(p_unit, 1, null);
  return 'QA|CHK|' || p_name || '¦' || p_expect || '¦ok|' || r.allowed || '/' || r.cap_count;
end $f$;
select pg_temp.qa_cap('무료 매장 199 → 허용 · 상한 200', 'qa_free_${rnd}', 199, 'false', 'ok|true/200');
select pg_temp.qa_cap('무료 매장 200 → 거절', 'qa_free_${rnd}', 200, 'false', 'ok|false/200');
select pg_temp.qa_cap('유료 매장 2999 → 허용 · 상한 3000', 'qa_paid_${rnd}', 2999, 'false', 'ok|true/3000');
select pg_temp.qa_cap('유료 매장 3000 → 거절', 'qa_paid_${rnd}', 3000, 'false', 'ok|false/3000');
select pg_temp.qa_cap('무료 모드 켜짐 · 무료 매장 200 → 허용(지금 그대로)', 'qa_free_${rnd}', 200, 'true', 'ok|true/200');
select pg_temp.qa_cap('공간 299 → 허용 · 상한 300', ${q(SP)}, 299, 'false', 'ok|true/300');
select pg_temp.qa_cap('공간 300 → 거절', ${q(SP)}, 300, 'false', 'ok|false/300');
select pg_temp.qa_cap('무료 모드 켜짐 · 공간 300 → 거절(공간은 상한을 본다)', ${q(SP)}, 300, 'true', 'ok|false/300');
select 'QA|CHK|공간은 사용량 사장 알림을 안 남긴다¦ok|0¦ok|' || count(*) from public.owner_alerts where unit_id = ${q(SP)};

-- ── 속도: auth_member_unit_id 1,000회 · 지금 정의 vs 0303 정의(종류 조건 없음) ──
create function pg_temp.qa_old_amui() returns text language sql stable security definer set search_path = public as $f$
  select coalesce(
    (select s.unit_id from public.session_active_units s
      where s.session_id = public.jwt_session_uuid() and s.user_id = auth.uid()
        and exists (select 1 from public.unit_members m where m.user_id = s.user_id and m.unit_id = s.unit_id)),
    (select coalesce(
      (select p.active_unit_id from public.profiles p
        where p.id = auth.uid() and p.active_unit_id is not null
          and exists (select 1 from public.unit_members m where m.user_id = p.id and m.unit_id = p.active_unit_id)),
      (select p.unit_id from public.profiles p where p.id = auth.uid()))))
$f$;
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, null, null, null);
do $d$
declare t0 timestamptz; i int; r text; best_new numeric := 1e9; best_old numeric := 1e9; round int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ${q(U.B)}, 'role', 'authenticated', 'session_id', ${q(S.B)})::text, true);
  for round in 1 .. 3 loop
    t0 := clock_timestamp(); for i in 1 .. 1000 loop r := public.auth_member_unit_id(); end loop;
    best_new := least(best_new, extract(epoch from clock_timestamp() - t0) * 1000);
    t0 := clock_timestamp(); for i in 1 .. 1000 loop r := pg_temp.qa_old_amui(); end loop;
    best_old := least(best_old, extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  raise notice 'QA|SPEED|%|%|%', round(best_new, 1), round(best_old, 1), r;
end $d$;

rollback;
`;

// ── 1부 실행·판정 ───────────────────────────────────────────────────────────
console.log(`— 대상 로컬 DB(${DB}) · 매장 X = ${X} · 공간 = ${SP} —`);
const exists = psql(`select count(*) from public.units where id = '${X}' and kind = 'store'`).trim();
if (exists !== '1') { console.error(`중단: 로컬에 매장 ${X} 가 없다(seed-demo 를 먼저 돌린다)`); process.exit(2); }

let out;
{
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error('psql 실패:\n' + (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|CONTEXT|LINE/.test(l)).slice(0, 10).join('\n')); process.exit(1); }
  out = r.stdout + '\n' + r.stderr;
}
const lines = out.split(/\r?\n/).map((l) => l.replace(/^NOTICE:\s+/, '')).filter((l) => l.startsWith('QA|'));
const res = new Map(); // key = kind|name → { who|state: out }
for (const l of lines.filter((l) => l.startsWith('QA|RES|'))) {
  const [, , who, state, kind, ...rest] = l.split('|');
  const name = rest.shift(); const o = rest.join('|');
  const k = `${kind}|${name}`;
  if (!res.has(k)) res.set(k, {});
  res.get(k)[`${who}${state}`] = o;
}
const nFn = Number(lines.find((l) => l.startsWith('QA|NFN|'))?.split('|')[2] ?? 0);
const nTbl = Number(lines.find((l) => l.startsWith('QA|NTBL|'))?.split('|')[2] ?? 0);

// 비교용: 함수 결과 = ok|count#md5#hasSP#hasX · 오류 = err|state|msg
const parse = (o) => {
  if (o == null) return null;
  if (o === 'skip') return { skip: true };
  if (o.startsWith('err|')) return { err: true, sig: o };
  const [n, md5, hasSP, hasX] = o.slice(3).split('#');
  return { n, md5, hasSP: hasSP === 'true', hasX: hasX === 'true', sig: `${n}#${md5}` };
};
const parseTbl = (o) => {
  if (o.startsWith('err|')) return { err: true, sig: o, sp: 0 };
  const [n, md5, sp] = o.slice(3).split('#');
  return { sig: `${n}#${md5}`, sp: Number(sp), n: Number(n) };
};

console.log(`\n[1] 매장 기능 전수 호출 · 함수 ${nFn}개 · 표 ${nTbl}개`);
check('매장 기능 목록이 비지 않았다', nFn > 50 && nTbl > 20, `함수 ${nFn} · 표 ${nTbl}`);
// 공간 부품 표: 0371 가 공간 갈래를 붙인 표. 현재 공간이 있을 때만 공간 행이 보여도 된다.
const SPACE_PART_TABLES = new Set(['playbook_entries', 'playbook_embeddings', 'chat_queries', 'unknown_queries', 'ai_usage']);
const fnDiff = [], tblDiff = [], leaks = [];
for (const [k, v] of res) {
  const [kind, name] = k.split('|');
  for (const o of Object.values(v)) { if (o === 'skip') continue; calls++; if (o.startsWith('err|')) rejected++; }
  if (kind === 'fn') {
    const a1 = parse(v.A1), a2 = parse(v.A2), a4 = parse(v.A4), b1 = parse(v.B1), b2 = parse(v.B2);
    if (a1?.skip) { skipped(`함수 ${name}`, '인자 형을 모름'); continue; }
    // ④ 는 프로필의 두 기록 칸 자체를 공간 번호로 바꾼다. 프로필 행을 그대로 돌려주는 session_bootstrap 은 ④ 비교에서 뺀다.
    //   공간이 안 나오는지는 [2] 에서 프로필 칸을 빼고 따로 잰다.
    const echoesProfile = name.startsWith('session_bootstrap(');
    // 샌 것: A 결과에 매장 X 나 공간 번호 · B(매장 X 직원)는 공간 번호만
    for (const [lab, p] of [['A①', a1], ['A②', a2], ['A④', echoesProfile ? null : a4], ['B①', b1], ['B②', b2]]) {
      if (!p || p.err) continue;
      const leakX = lab.startsWith('A') && p.hasX;
      if (p.hasSP || leakX) leaks.push(`${lab} ${name} (${p.hasSP ? '공간' : ''}${leakX ? '매장 X' : ''})`);
    }
    if (a1.sig !== a2.sig || (!echoesProfile && a1.sig !== a4.sig)) fnDiff.push(`A ${name}: ①${a1.sig.slice(0, 40)} ②${a2.sig.slice(0, 40)} ④${a4.sig.slice(0, 40)}`);
    if (b1.sig !== b2.sig) fnDiff.push(`B ${name}: ①${b1.sig.slice(0, 40)} ②${b2.sig.slice(0, 40)}`);
    for (const w of ['B', 'C']) { const x = parse(v[`${w}3a`]); for (const st of ['3b', '3c']) { const y = parse(v[`${w}${st}`]); if (x.sig !== y.sig) fnDiff.push(`${w} ${name}: ③a ${x.sig.slice(0, 50)} ${st} ${y.sig.slice(0, 50)}`); } }
  } else {
    const a1 = parseTbl(v.A1), a2 = parseTbl(v.A2), a4 = parseTbl(v.A4), b1 = parseTbl(v.B1), b2 = parseTbl(v.B2);
    if (a1.sp || a4.sp || b1.sp) tblDiff.push(`${name}: 현재 공간 없이 공간 행이 보임 A①${a1.sp} A④${a4.sp} B①${b1.sp}`);
    if (!SPACE_PART_TABLES.has(name) && (a2.sp || b2.sp)) tblDiff.push(`${name}: 공간 부품이 아닌데 공간 행이 보임`);
    if (a1.sig !== a2.sig || a1.sig !== a4.sig) tblDiff.push(`A ${name}: 매장 쪽 행이 상태마다 다름 ①${a1.sig} ②${a2.sig} ④${a4.sig}`);
    if (b1.sig !== b2.sig) tblDiff.push(`B ${name}: ①${b1.sig} ②${b2.sig}`);
    for (const w of ['B', 'C']) { const x = parseTbl(v[`${w}3a`]); for (const st of ['3b', '3c']) { const y = parseTbl(v[`${w}${st}`]); if (x.sig !== y.sig) tblDiff.push(`${w} ${name}: 매장 X 결과가 다름 ③a ${x.sig} ${st} ${y.sig}`); } }
  }
}
check('공간만 있는 계정·멤버의 매장 기능 결과에 매장 X·공간 번호가 안 나온다', leaks.length === 0, leaks.slice(0, 8).join(' · '));
check('함수 결과가 공간 세션·멤버십이 있든 없든 같다(A ①②④ · B ①② · B·C ③a=③b=③c)', fnDiff.length === 0, '\n      ' + fnDiff.slice(0, 12).join('\n      '));
check('표 결과: 매장 쪽 행이 같고 공간 행은 공간 부품 표에서 현재 공간일 때만', tblDiff.length === 0, '\n      ' + tblDiff.slice(0, 12).join('\n      '));
// 공간 부품 표가 현재 공간에서 실제로 열리는지(아니면 위 비교가 아무것도 증명하지 않는다)
{
  const pe = res.get('tbl|playbook_entries'), uq = res.get('tbl|unknown_queries');
  check('현재 공간에서 공간 부품이 열린다(A② 노하우 2 · 질문 3)', parseTbl(pe.A2).sp === 2 && parseTbl(uq.A2).sp === 3, `노하우 ${parseTbl(pe.A2).sp} · 질문 ${parseTbl(uq.A2).sp}`);
  check('매장 X 데이터가 실제로 보인다(B③a 노하우 > 0)', parseTbl(pe.B3a).n > 0, `노하우 ${parseTbl(pe.B3a).n}`);
}

console.log('\n[2] 이름 붙인 검사');
for (const l of lines.filter((l) => l.startsWith('QA|CHK|'))) {
  const [name, expect, got] = l.slice(7).split('¦');
  calls++; if (got.startsWith('err|')) rejected++;
  const ok = expect === 'err' ? got.startsWith('err|') : got === expect;
  check(name, ok, ok ? (expect === 'err' ? got.split('|').slice(1, 3).join(' ') : '') : `기대 ${expect} · 실제 ${got}`);
}

console.log('\n[3] 속도 · auth_member_unit_id 1,000회 (3번 중 가장 빠른 값)');
{
  const sp = lines.find((l) => l.startsWith('QA|SPEED|'));
  if (!sp) skipped('속도', '측정 줄이 없음');
  else {
    const [, , nw, od, val] = sp.split('|');
    // 기준: 0303 정의의 2배 이하 또는 1,000회당 20ms 이하 차이(기록마다 PK 1행 조회가 하나 는다)
    check(`지금 ${nw}ms · 0303 정의 ${od}ms · 값 ${val}`, Number(nw) <= Math.max(Number(od) * 2, Number(od) + 20) && val === X);
  }
}

runStoreLinkChecks({ DB, check }); // 5번 덩이 매장과 연결하기(0490) · 별도 모듈

// ── 2부: 실세션(PostgREST) ──────────────────────────────────────────────────
console.log('\n[4] 실세션 · 공간만 있는 계정');
{
  const st = Object.fromEntries(execFileSync('npx', ['-y', 'supabase@2', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const URL_ = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY;
  if (!URL_ || !/^http:\/\/127\.0\.0\.1:/.test(URL_)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL_); process.exit(2); }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(URL_, SRV, opts);
  const SP2 = `qa_sp2_${rnd}`; let uid = null;
  try {
    const email = `qa_spi_real_${rnd}@example.com`;
    const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name: 'QA공간', role: 'junior', birth_date: '1994-03-03' } });
    if (ce) throw new Error(`createUser: ${ce.message}`);
    uid = cu.user.id;
    const iu = await admin.from('units').insert({ id: SP2, store_name: 'QA공간2', kind: 'space' });
    if (iu.error) throw new Error(`units: ${iu.error.message}`);
    const im = await admin.from('unit_members').insert({ user_id: uid, unit_id: SP2, role: 'space_owner' });
    if (im.error) throw new Error(`unit_members: ${im.error.message}`);
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (le) throw new Error(`generateLink: ${le.message}`);
    const c = createClient(URL_, ANON, opts);
    const { error: ve } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
    if (ve) throw new Error(`verifyOtp: ${ve.message}`);
    const rpc = async (n, a) => { calls++; const r = await c.rpc(n, a); if (r.error) rejected++; return r; };
    const e1 = await rpc('enter_space', { p_space: SP2 });
    check('enter_space 입구 꺼짐 → 거절', !!e1.error, e1.error?.message ?? '');
    const e2 = await rpc('switch_session_unit', { p_unit_id: SP2 });
    check('switch_session_unit(공간) 거절', !!e2.error, e2.error?.message ?? '');
    const e3 = await rpc('switch_active_unit', { p_unit_id: SP2 });
    check('switch_active_unit(공간) 거절', !!e3.error, e3.error?.message ?? '');
    const b = await rpc('session_bootstrap');
    check('session_bootstrap: 현재 매장 없음 · 공간 번호 없음', !b.error && b.data?.unit_id == null && !JSON.stringify(b.data).includes(SP2), b.error?.message ?? `unit_id=${b.data?.unit_id}`);
    const ms = await rpc('my_spaces');
    check('my_spaces: 내 공간 1개 · 주인', !ms.error && ms.data?.length === 1 && ms.data[0].id === SP2 && ms.data[0].role === 'space_owner', ms.error?.message ?? JSON.stringify(ms.data));
    const mu = await rpc('my_units');
    check('my_units: 공간이 안 나온다', !mu.error && (mu.data ?? []).length === 0, mu.error?.message ?? JSON.stringify(mu.data));
  } catch (e) {
    check('실세션 셋업', false, e?.message ?? String(e));
  } finally {
    const d1 = await admin.from('units').delete().eq('id', SP2); if (d1.error) console.error('  ! 정리 units:', d1.error.message);
    if (uid) { const d2 = await admin.auth.admin.deleteUser(uid); if (d2.error) console.error('  ! 정리 user:', d2.error.message); }
  }
}

console.log(`\n최종: ${fail === 0 ? 'PASS' : 'FAIL'} · 통과 ${pass} · 실패 ${fail} · skip ${skip} · 부른 수 ${calls} · 거절 ${rejected} · AI 호출 0회`);
process.exit(fail === 0 ? 0 : 1);
