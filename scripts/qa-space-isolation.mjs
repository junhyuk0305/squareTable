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
import { runStoreAskChecks } from './lib/qa-store-ask-counts.mjs';

if (!process.argv.includes('--local')) { console.error('중단: 로컬 전용 하니스다(--local)'); process.exit(2); }
const DB = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
const X = process.env.QA_SPACE_STORE || 'store_001';
const rnd = Math.random().toString(16).slice(2, 10);
const SP = `qa_sp_${rnd}`, WS = `qa_ws_${rnd}`;
// F·G(2번 덩이 · 0374~0381): F 공간을 새로 만드는 사람(허용 목록) · G 사장 계정(공간 만들기 거절 대조군).
const U = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'W', 'F', 'G'].map((k, i) => [k, `00000000-0000-4000-8${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
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

// ── 2번 덩이 검사(0374~0381) — 1부 트랜잭션 안에서 돈다 ─────────────────────────
//   새 객체가 없는 DB(마이그레이션 전)에서도 끝까지 돌아 RED 를 보이게, 셋업 쓰기는 qa_try 로 감싼다.
//   셋업 실패는 QA|SETUPFAIL 줄로 남겨 실패로 센다(건너뛴 것을 통과로 세지 않는다).
function part2Sql() {
  const SPQ = `qa_spq_${rnd}`, SPF = `qa_spf_${rnd}`;
  const st = (w, store, space) => `select pg_temp.qa_state(${q(U[w])}, ${q(S[w])}, ${store ? q(store) : 'null'}, ${space ? q(space) : 'null'}, null, null);`;
  const chk = (name, w, s, e) => `select pg_temp.qa_chk(${q(name)}, '${w}', ${q(s)}, ${q(e)});`;
  const act = (name, w, a, c, e) => `select pg_temp.qa_act(${q(name)}, '${w}', ${q(a)}, ${q(c)}, ${q(e)});`;
  const tryq = (s) => `select pg_temp.qa_try(${q(s)});`;
  const asWho = (w) => `select set_config('request.jwt.claims', json_build_object('sub', ${q(U[w])}, 'role', 'authenticated', 'session_id', ${q(S[w])})::text, true);`;
  const noWho = `select set_config('request.jwt.claims', '', true);`;
  const ent = (id, role) => `'{"id":"${id}","title":"QA 답","category":"서비스","creator_role":"${role}"}'::jsonb`;
  const vec = `array_fill(0.1::real, array[768])::extensions.vector`;
  const M = `to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')`;
  const lastMonth = `(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '1 hour'`;
  const xEntry = `(select id from public.playbook_entries where unit_id = ${q(X)} and brand_entry_id is null and status = 'published' and archived_at is null limit 1)`;
  return String.raw`
-- ════ 2번 덩이 (0374~0381) ════
create function pg_temp.qa_try(p text) returns void language plpgsql as $f$
begin execute p; exception when others then raise notice 'QA|SETUPFAIL|%|%', left(p, 60), left(sqlerrm, 80); end $f$;
-- 쓰기 하나를 그 사람 권한으로 하고, 결과를 서비스 권한으로 읽은 뒤 전부 되돌린다.
create function pg_temp.qa_act(p_name text, p_who text, p_act text, p_check text, p_expect text) returns text language plpgsql as $f$
declare u uuid; s uuid; r text;
begin
  select case p_who ${Object.keys(U).map((k) => `when '${k}' then ${q(U[k])}::uuid`).join(' ')} end,
         case p_who ${Object.keys(U).map((k) => `when '${k}' then ${q(S[k])}::uuid`).join(' ')} end into u, s;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'session_id', s)::text, true);
    perform set_config('statement_timeout', '5000', true);
    execute 'set local role authenticated';
    execute p_act;
    execute 'reset role';
    execute p_check into r;
    raise exception using errcode = 'QAOK0', message = coalesce(r, '<null>');
  exception
    when sqlstate 'QAOK0' then r := 'ok|' || sqlerrm;
    when others then r := 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
  return 'QA|CHK|' || p_name || '¦' || p_expect || '¦' || r;
end $f$;

-- ── A. 공간 입구 허용 목록 · B. create_space ──
${st('F', null, null)}
${chk('F 목록 밖 · 입구 꺼짐 → create_space 거절', 'F', `select count(*)::text from public.create_space('QA새공간')`, 'err:space_closed')}
${chk('F 목록 밖 → my_kind_features 공간 입구 꺼짐', 'F', `select enabled::text from public.my_kind_features() where kind = 'space' and feature = 'enter'`, 'ok|false')}
${tryq(`insert into public.space_entry_allowlist(user_id, note) values (${q(U.F)}, 'qa'), (${q(U.G)}, 'qa'), (${q(U.D)}, 'qa')`)}
${chk('F 목록 안 → my_kind_features 공간 입구 켜짐', 'F', `select enabled::text from public.my_kind_features() where kind = 'space' and feature = 'enter'`, 'ok|true')}
${chk('E 목록 밖 → 공간 입구 그대로 꺼짐', 'E', `select enabled::text from public.my_kind_features() where kind = 'space' and feature = 'enter'`, 'ok|false')}
${chk('F 목록 안 → 매장 줄은 표 그대로(ask_first 는 같은 허용 목록을 본다 · 0520 · [7] 에서 잰다)', 'F', `select count(*)::text from public.my_kind_features() f join public.unit_kind_features k using (kind, feature) where f.kind = 'store' and f.feature <> 'ask_first' and f.enabled is distinct from k.enabled`, 'ok|0')}
${chk('F 전화 인증 전 → create_space 거절', 'F', `select count(*)::text from public.create_space('QA새공간')`, 'err:PHONE_NOT_VERIFIED')}
update public.profiles set created_at = '2020-01-01' where id in (${q(U.F)}, ${q(U.G)}, ${q(U.D)});
update public.profiles set role = 'owner' where id = ${q(U.G)};
${chk('F 빈 이름 → 거절', 'F', `select count(*)::text from public.create_space('   ')`, 'err:space_name_required')}
${chk('F 41자 이름 → 거절', 'F', `select count(*)::text from public.create_space(repeat('가', 41))`, 'err:invalid_argument')}
${chk('G 사장 계정 → 새 공간 거절', 'G', `select count(*)::text from public.create_space('QA사장공간')`, 'err:owner_cannot_create_space')}
${st('D', X, null)}
${chk('D 매장 사장 멤버십 → 새 공간 거절', 'D', `select count(*)::text from public.create_space('QA사장공간')`, 'err:owner_cannot_create_space')}
${st('F', null, null)}
${act('F 공간 만들기 → 주인 칸 비움 · space_owner · 계정 기록 그대로 · 바로 들어가기', 'F',
  `select public.enter_space((select c.space_id from public.create_space('QA새공간') c))`,
  `select (select count(*) from public.units u join public.unit_members m on m.unit_id = u.id and m.user_id = ${q(U.F)} and m.role = 'space_owner'
            where u.kind = 'space' and u.owner_id is null and u.invite_code ~ '^[A-Z0-9]{6}$' and u.store_name = 'QA새공간')::text
       || '/' || (select coalesce(p.role, '-') || ':' || coalesce(p.active_unit_id, '-') || ':' || coalesce(p.unit_id, '-') from public.profiles p where p.id = ${q(U.F)})
       || '/' || coalesce((public.auth_space_id() like 'space\_%')::text, 'null')
       || '/' || (select count(*) from public.session_active_units where session_id = ${q(S.F)})::text`,
  'ok|1/junior:-:-/true/0')}
${tryq(`insert into public.units(id, store_name, kind) values (${q(SPF)}, 'QA F공간', 'space')`)}
${tryq(`insert into public.unit_members(user_id, unit_id, role) values (${q(U.F)}, ${q(SPF)}, 'space_owner')`)}
${chk('F 두 번째 공간 → 무료 1개 초과 거절', 'F', `select count(*)::text from public.create_space('QA둘째')`, 'err:space_limit_reached')}
${chk('F 목록 안 → 자기 공간 들어가기 됨', 'F', `select public.enter_space(${q(SPF)})::text`, 'ok|')}
${chk('F 목록 안 · 남의 공간 들어가기 거절', 'F', `select public.enter_space(${q(SP)})::text`, 'err:not_a_member')}
${chk('F 목록 안 · 매장 번호로 들어가기 → 닫힌 입구와 같음', 'F', `select public.enter_space(${q(X)})::text`, 'err:space_closed')}
${chk('F 클라가 허용 목록에 쓰기 거절', 'F', `insert into public.space_entry_allowlist(user_id) values (auth.uid()) returning 'inserted'`, 'err:42501')}
${chk('F 클라가 허용 목록 읽기 거절', 'F', `select count(*)::text from public.space_entry_allowlist`, 'err:42501')}
${tryq(`delete from public.space_entry_allowlist where user_id = ${q(U.F)}`)}
${chk('F 목록에서 빼면 → 자기 공간 들어가기 다시 거절', 'F', `select public.enter_space(${q(SPF)})::text`, 'err:space_closed')}
${chk('F 목록에서 빼면 → 공간 만들기 다시 거절', 'F', `select count(*)::text from public.create_space('QA셋째')`, 'err:space_closed')}
${chk('F 목록에서 빼면 → my_kind_features 다시 꺼짐', 'F', `select enabled::text from public.my_kind_features() where kind = 'space' and feature = 'enter'`, 'ok|false')}

-- ── C. 공간 노하우 쓰기·지우기 · 색인 · 사진 ──
${tryq(`insert into public.playbook_embeddings(entry_id, unit_id, embedding) values ('qa_pb_pub_${rnd}', ${q(SP)}, ${vec})`)}
${tryq(`insert into storage.objects(bucket_id, name) values ('playbook-photos', '${SP}/qa_seed.jpg')`)}
${st('A', null, SP)}
${chk('A 공간 주인 노하우 넣기 됨(작성자 space_owner)', 'A', `insert into public.playbook_entries(id, unit_id, category, title, status, creator_role) values ('qa_pb_a_${rnd}', '${SP}', '서비스', 'a', 'published', 'space_owner') returning 'inserted'`, 'ok|inserted')}
${chk('A 공간 주인 노하우 고치기 됨', 'A', `with x as (update public.playbook_entries set title = 'b' where id = 'qa_pb_pub_${rnd}' returning 1) select count(*)::text from x`, 'ok|1')}
${chk('A 공간 주인 노하우 지우기(archive_knowhow) 됨', 'A', `select public.archive_knowhow('qa_pb_pub_${rnd}', true)::text`, 'ok|')}
${chk('A 옛 앱 삭제 길(DELETE) → 보관으로 됨', 'A', `with d as (delete from public.playbook_entries where id = 'qa_pb_pub_${rnd}' returning 1) select count(*)::text from d`, 'ok|0')}
${chk('A 지우기 확인창 재료(knowhow_usage) 됨', 'A', `select (public.knowhow_usage('qa_pb_pub_${rnd}') ->> 'courses')`, 'ok|0')}
${chk('A 공간 초안은 보관이 아니라 → draft_entry', 'A', `select public.archive_knowhow('qa_pb_drf_${rnd}', true)::text`, 'err:draft_entry')}
select pg_temp.qa_chk('A 공간 주인이 매장 X 노하우 지우기 거절', 'A', format('select public.archive_knowhow(%L, true)::text', ${xEntry}), 'err:not_owner');
${chk('A 공간 노하우 색인 쓰기(엣지 embed upsert 길) 됨', 'A', `insert into public.playbook_embeddings(entry_id, unit_id, embedding) values ('qa_pb_pub_${rnd}', '${SP}', ${vec}) on conflict (entry_id) do update set embedding = excluded.embedding, embedded_at = now() returning 'ok'`, 'ok|ok')}
${chk('A match_playbook(공간) → 공간 노하우', 'A', `select count(*)::text from public.match_playbook(${vec}, '${SP}', 8)`, 'ok|1')}
${chk('A 공간 폴더 사진 올리기 됨', 'A', `insert into storage.objects(bucket_id, name) values ('playbook-photos', '${SP}/qa_up.jpg') returning 'inserted'`, 'ok|inserted')}
${chk('A 공간 폴더 사진 고치기 됨', 'A', `with x as (update storage.objects set metadata = '{}'::jsonb where bucket_id = 'playbook-photos' and name = '${SP}/qa_seed.jpg' returning 1) select count(*)::text from x`, 'ok|1')}
${chk('A 매장 X 폴더 사진 올리기 거절', 'A', `insert into storage.objects(bucket_id, name) values ('playbook-photos', '${X}/qa_up.jpg') returning 'inserted'`, 'err')}
${chk('A 공간 폴더라도 확장자 막기 그대로', 'A', `insert into storage.objects(bucket_id, name) values ('playbook-photos', '${SP}/qa_up.exe') returning 'inserted'`, 'err')}
${st('A', null, null)}
${chk('A 현재 공간 없이 지우기 거절', 'A', `select public.archive_knowhow('qa_pb_pub_${rnd}', true)::text`, 'err:not_owner')}
${chk('A 현재 공간 없이 공간 사진 올리기 거절', 'A', `insert into storage.objects(bucket_id, name) values ('playbook-photos', '${SP}/qa_up2.jpg') returning 'inserted'`, 'err')}
${st('C', X, SP)}
${chk('C 공간 멤버(매장 매니저)가 공간 노하우 지우기 거절', 'C', `select public.archive_knowhow('qa_pb_pub_${rnd}', true)::text`, 'err:not_owner')}
${chk('C 공간 멤버 match_playbook(공간) → 발행 노하우', 'C', `select count(*)::text from public.match_playbook(${vec}, '${SP}', 8)`, 'ok|1')}
${chk('C 공간 멤버(매장 매니저)가 공간 색인 쓰기 거절', 'C', `insert into public.playbook_embeddings(entry_id, unit_id, embedding) values ('qa_pb_pub_${rnd}', '${SP}', ${vec}) on conflict (entry_id) do update set embedding = excluded.embedding returning 'ok'`, 'err')}
select pg_temp.qa_chk('C 매장 X 노하우 지우기는 그대로 매니저 거절', 'C', format('select public.archive_knowhow(%L, true)::text', ${xEntry}), 'err:not_owner');
${st('B', X, SP)}
${chk('B 공간 멤버 노하우 지우기 거절', 'B', `select public.archive_knowhow('qa_pb_pub_${rnd}', true)::text`, 'err:not_owner')}
${chk('B 공간 멤버 공간 사진 읽기 됨', 'B', `select count(*)::text from storage.objects where bucket_id = 'playbook-photos' and name = '${SP}/qa_seed.jpg'`, 'ok|1')}
${chk('B 공간 멤버 공간 폴더 사진 올리기 거절', 'B', `insert into storage.objects(bucket_id, name) values ('playbook-photos', '${SP}/qa_b.jpg') returning 'inserted'`, 'err')}
${st('B', X, null)}
${chk('B 현재 공간 없이 공간 사진 0', 'B', `select count(*)::text from storage.objects where bucket_id = 'playbook-photos' and name = '${SP}/qa_seed.jpg'`, 'ok|0')}
${st('D', X, null)}
${chk('D 매장 사장이 공간 노하우 지우기 거절', 'D', `select public.archive_knowhow('qa_pb_pub_${rnd}', true)::text`, 'err:not_owner')}
${chk('D 매장 사장 match_playbook(공간) 0', 'D', `select count(*)::text from public.match_playbook(${vec}, '${SP}', 8)`, 'ok|0')}
${chk('D 매장 사장 공간 사진 0', 'D', `select count(*)::text from storage.objects where bucket_id = 'playbook-photos' and name = '${SP}/qa_seed.jpg'`, 'ok|0')}
${st('E', null, null)}
${chk('E 멤버 아님 공간 사진 0', 'E', `select count(*)::text from storage.objects where bucket_id = 'playbook-photos' and name = '${SP}/qa_seed.jpg'`, 'ok|0')}

-- ── D. 답하기: 보내기(reply_unknown_query · question_replies) · 노하우로 남기기(save_unknown_answer) ──
${asWho('B')}
insert into public.unknown_queries(id, unit_id, query_text) values ('qa_uq_x_${rnd}', ${q(X)}, '매장 질문 x'), ('qa_uq_x2_${rnd}', ${q(X)}, '매장 질문 x2');
${noWho}
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, text, status, source_uq_id) values
  ('qa_ps_x_${rnd}', ${q(X)}, 'new', ${q(U.B)}, '제안', 'pending', 'qa_uq_x_${rnd}'),
  ('qa_ps_y_${rnd}', ${q(X)}, 'new', ${q(U.B)}, '제안', 'pending', null);
${st('A', null, SP)}
${act('A 공간 주인 보내기 → 직접 답함 · sent · 답 글 한 번', 'A',
  `select public.reply_unknown_query('qa_uq_C_${rnd}', '  이렇게 하세요  ')`,
  `select u.status || '/' || coalesce(u.answer_kind, '-') || '/' || (u.answered_by = ${q(U.A)}::uuid) || '/' || (u.answer_author_id = ${q(U.A)}::uuid)
       || '/' || coalesce(u.resolved_with_entry_id, '-') || '/' || coalesce((select r.body || ':' || (r.author_id = ${q(U.A)}::uuid) from public.question_replies r where r.uq_id = u.id), '-')
     from public.unknown_queries u where u.id = 'qa_uq_C_${rnd}'`,
  'ok|answered_direct/sent/true/true/-/이렇게 하세요:true')}
${chk('A 같은 질문 두 번 보내기 → not_pending', 'A', `select (public.reply_unknown_query('qa_uq_C_${rnd}', 'x')).uq_id || (public.reply_unknown_query('qa_uq_C_${rnd}', 'y')).uq_id`, 'err:not_pending')}
${noWho}
-- ★0382: 보내기와 덮어쓰기를 한 호출 안에서 차례로(검사 묶음은 잰 뒤 되돌리므로 앞 보내기 결과가 남지 않는다).
create function pg_temp.qa_send_then_overwrite(p_id text) returns text language plpgsql as $f$
begin
  perform public.reply_unknown_query(p_id, '먼저 보낸 답');
  update public.unknown_queries set status = 'resolved_with_entry', answer_kind = 'existing' where id = p_id;
  return (select status || '/' || coalesce(answer_kind, '-') from public.unknown_queries where id = p_id);
end $f$;
${st('A', null, SP)}
${chk('★A 보낸 질문을 낡은 화면이 노하우 해결로 덮어쓰기 → not_pending(0382)', 'A', `select pg_temp.qa_send_then_overwrite('qa_uq_C_${rnd}')`, 'err:not_pending')}
${chk('A 빈 답 글 → invalid_argument', 'A', `select (public.reply_unknown_query('qa_uq_C_${rnd}', '   ')).uq_id`, 'err:invalid_argument')}
${chk('A 2001자 답 글 → invalid_argument', 'A', `select (public.reply_unknown_query('qa_uq_C_${rnd}', repeat('가', 2001))).uq_id`, 'err:invalid_argument')}
${chk('A 없는 질문 → question_not_found', 'A', `select (public.reply_unknown_query('qa_uq_none_${rnd}', 'x')).uq_id`, 'err:question_not_found')}
${st('B', X, SP)}
${chk('B 공간 멤버가 자기 질문에 보내기 → not_space_owner', 'B', `select (public.reply_unknown_query('qa_uq_B_${rnd}', 'x')).uq_id`, 'err:not_space_owner')}
${st('C', X, SP)}
${chk('C 공간 멤버(매장 매니저)가 남의 공간 질문에 보내기 → question_not_found', 'C', `select (public.reply_unknown_query('qa_uq_B_${rnd}', 'x')).uq_id`, 'err:question_not_found')}
${st('E', null, null)}
${chk('E 멤버 아님 → question_not_found', 'E', `select (public.reply_unknown_query('qa_uq_B_${rnd}', 'x')).uq_id`, 'err:question_not_found')}
${st('D', X, null)}
${chk('D 매장 사장 보내기 → feature_off(매장 보내기는 6번 덩이)', 'D', `select (public.reply_unknown_query('qa_uq_x_${rnd}', 'x')).uq_id`, 'err:feature_off')}
${st('A', null, null)}
${chk('A 현재 공간 없이 보내기 → question_not_found', 'A', `select (public.reply_unknown_query('qa_uq_C_${rnd}', 'x')).uq_id`, 'err:question_not_found')}
-- 읽기 검사용으로 보내기 하나를 남긴다(A → C 의 질문).
${st('A', null, SP)}
${asWho('A')}
${tryq(`select public.reply_unknown_query('qa_uq_C_${rnd}', '남긴 답')`)}
${noWho}
${chk('A 공간 주인 보내기 답 읽기', 'A', `select count(*)::text from public.question_replies where uq_id = 'qa_uq_C_${rnd}'`, 'ok|1')}
${chk('A 보낸 질문에 노하우로 남기기 → not_pending', 'A', `select public.save_unknown_answer('qa_uq_C_${rnd}', ${ent(`qa_pb_sv0_${rnd}`, 'space_owner')})`, 'err:not_pending')}
${st('C', X, SP)}
${chk('C 질문자 본인 보내기 답 읽기', 'C', `select count(*)::text from public.question_replies where uq_id = 'qa_uq_C_${rnd}'`, 'ok|1')}
${chk('C 보내기 답 고치기 거절', 'C', `update public.question_replies set body = 'x' where uq_id = 'qa_uq_C_${rnd}' returning 'u'`, 'err:42501')}
${chk('C 보내기 답 직접 넣기 거절', 'C', `insert into public.question_replies(uq_id, unit_id, body, author_id) values ('qa_uq_B_${rnd}', '${SP}', 'x', auth.uid()) returning 'i'`, 'err:42501')}
${st('C', X, null)}
${chk('C 현재 공간 없이 보내기 답 0', 'C', `select count(*)::text from public.question_replies`, 'ok|0')}
${st('B', X, SP)}
${chk('B 남(C)의 보내기 답 0', 'B', `select count(*)::text from public.question_replies`, 'ok|0')}
${st('E', null, null)}
${chk('E 멤버 아님 보내기 답 0', 'E', `select count(*)::text from public.question_replies`, 'ok|0')}
${st('A', null, SP)}
${act('A 공간 주인 노하우로 남기기 → saved · 답 쓴 사람 = 나 · 승인 없음', 'A',
  `select public.save_unknown_answer('qa_uq_B_${rnd}', ${ent(`qa_pb_sv1_${rnd}`, 'space_owner')})`,
  `select u.status || '/' || coalesce(u.answer_kind, '-') || '/' || (u.answer_author_id = ${q(U.A)}::uuid) || '/' || (u.approved_by is null) || '/' || (u.answered_by = ${q(U.A)}::uuid)
       || '/' || (select count(*) from public.playbook_entries e where e.id = 'qa_pb_sv1_${rnd}' and e.unit_id = '${SP}' and e.creator_role = 'space_owner')
     from public.unknown_queries u where u.id = 'qa_uq_B_${rnd}'`,
  'ok|resolved_with_entry/saved/true/true/true/1')}
${st('C', X, SP)}
${chk('C 공간 멤버(매장 매니저)가 공간 질문 노하우로 남기기 → not_pending', 'C', `select public.save_unknown_answer('qa_uq_B_${rnd}', ${ent(`qa_pb_sv2_${rnd}`, 'owner')})`, 'err:not_pending')}
${st('D', X, null)}
${act('D 매장 사장 승인 → 답 쓴 사람 = 제안한 B · 승인한 사람 = D · 답한 사람 = D', 'D',
  `select public.save_unknown_answer('qa_uq_x_${rnd}', ${ent(`qa_pb_sv3_${rnd}`, 'owner')}, 'qa_ps_x_${rnd}')`,
  `select (u.answer_author_id = ${q(U.B)}::uuid) || '/' || (u.approved_by = ${q(U.D)}::uuid) || '/' || (u.answered_by = ${q(U.D)}::uuid) || '/' || coalesce(u.answer_kind, '-') || '/' || u.status
     from public.unknown_queries u where u.id = 'qa_uq_x_${rnd}'`,
  'ok|true/true/true/saved/resolved_with_entry')}
${chk('D 다른 질문의 제안으로 승인 → suggestion_not_found', 'D', `select public.save_unknown_answer('qa_uq_x_${rnd}', ${ent(`qa_pb_sv4_${rnd}`, 'owner')}, 'qa_ps_y_${rnd}')`, 'err:suggestion_not_found')}
${act('D 옛 길 answer_unknown_query 그대로 됨 · saved · 답 쓴 사람 = D', 'D',
  `select public.answer_unknown_query('qa_uq_x2_${rnd}', ${ent(`qa_pb_sv5_${rnd}`, 'owner')})`,
  `select u.status || '/' || coalesce(u.answer_kind, '-') || '/' || coalesce((u.answer_author_id = ${q(U.D)}::uuid)::text, '-') || '/' || (u.approved_by is null)
       || '/' || (select count(*) from public.playbook_entries e where e.id = 'qa_pb_sv5_${rnd}' and e.unit_id = ${q(X)})
     from public.unknown_queries u where u.id = 'qa_uq_x2_${rnd}'`,
  'ok|resolved_with_entry/saved/true/true/1')}
${st('B', X, null)}
${chk('B 매장 직원 노하우로 남기기 거절(노하우 쓰기 권한 없음)', 'B', `select public.save_unknown_answer('qa_uq_x2_${rnd}', ${ent(`qa_pb_sv6_${rnd}`, 'owner')})`, 'err')}

-- ── E. 홈 숫자 넷(unit_question_counts) — 따로 공간 SPQ 에 정해진 행을 심는다 ──
insert into public.units(id, store_name, kind) values (${q(SPQ)}, 'QA숫자공간', 'space');
insert into public.unit_members(user_id, unit_id, role) values (${q(U.A)}, ${q(SPQ)}, 'space_owner');
insert into public.chat_queries(id, unit_id, query_text, was_deflected, matched_entry_ids, response_block, asked_at) values
  ('qa_cq_n1_${rnd}', ${q(SPQ)}, 'q', true,  array['e1'], '{"mode":"served"}'::jsonb, now()),
  ('qa_cq_n2_${rnd}', ${q(SPQ)}, 'q', true,  array[]::text[], '{"mode":"generated"}'::jsonb, now()),
  ('qa_cq_n3_${rnd}', ${q(SPQ)}, 'q', true,  array[]::text[], '{"mode":"smalltalk"}'::jsonb, now()),
  ('qa_cq_n4_${rnd}', ${q(SPQ)}, 'q', false, array[]::text[], null, now()),
  ('qa_cq_n5_${rnd}', ${q(SPQ)}, 'q', true,  array['e1'], '{"mode":"served"}'::jsonb, ${lastMonth});
insert into public.unknown_queries(id, unit_id, query_text, status, asked_at) values
  ('qa_uq_n1_${rnd}', ${q(SPQ)}, 'q', 'pending_owner_answer', now()),
  ('qa_uq_n2_${rnd}', ${q(SPQ)}, 'q', 'answered_direct', now()),
  ('qa_uq_n3_${rnd}', ${q(SPQ)}, 'q', 'resolved_with_entry', now()),
  ('qa_uq_n4_${rnd}', ${q(SPQ)}, 'q', 'auto_answered', now()),
  ('qa_uq_n5_${rnd}', ${q(SPQ)}, 'q', 'dismissed', now()),
  ('qa_uq_n6_${rnd}', ${q(SPQ)}, 'q', 'pending_owner_answer', ${lastMonth}),
  ('qa_uq_n7_${rnd}', ${q(SPQ)}, 'q', 'pending_owner_answer', now());
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, text, status, source_uq_id) values
  ('qa_ps_n7_${rnd}', ${q(SPQ)}, 'new', ${q(U.B)}, '제안', 'pending', 'qa_uq_n7_${rnd}');
${st('A', null, SPQ)}
${chk('A 공간 주인 홈 숫자 넷(질문 3 · AI 2 · 직접 2 · 미응답 2 = 지난달 대기 듦 · 0520)', 'A', `select questions || '/' || ai_answered || '/' || direct_answered || '/' || unanswered from public.unit_question_counts('${SPQ}')`, 'ok|3/2/2/2')}
${st('A', null, SP)}
${chk('A 현재 공간이 다른 공간이면 → not_space_member', 'A', `select questions::text from public.unit_question_counts('${SPQ}')`, 'err:not_space_member')}
${chk('A 공간에서 매장 X 숫자 → not_manager', 'A', `select questions::text from public.unit_question_counts('${X}')`, 'err:not_manager')}
${st('B', X, SP)}
${chk('B 공간 멤버 → not_space_owner', 'B', `select questions::text from public.unit_question_counts('${SP}')`, 'err:not_space_owner')}
${st('B', X, null)}
${chk('B 매장 직원 → not_manager', 'B', `select questions::text from public.unit_question_counts('${X}')`, 'err:not_manager')}
${st('E', null, null)}
${chk('E 멤버 아님 → not_space_member', 'E', `select questions::text from public.unit_question_counts('${SP}')`, 'err:not_space_member')}
${st('D', X, null)}
${chk('D 매장 사장 현재 매장 숫자 됨', 'D', `select questions::text from public.unit_question_counts('${X}')`, 'ok*')}
${st('C', X, null)}
${chk('C 매장 매니저 현재 매장 숫자 됨', 'C', `select questions::text from public.unit_question_counts('${X}')`, 'ok*')}

-- ── F. ai_quota_status_at — 현재 매장 = ai_quota_status 그대로 · 현재 공간 = 공간 상한(무료 모드 무시) · 그 밖 forbidden ──
insert into public.ai_usage_monthly(unit_id, month, used, updated_at) values (${q(SP)}, ${M}, 299, now())
  on conflict (unit_id, month) do update set used = excluded.used;
insert into public.app_config(key, value) values ('billing_free_mode', 'false') on conflict (key) do update set value = excluded.value;
${st('A', null, SP)}
${chk('A 공간 299 → 상한 300 · 아직 됨', 'A', `select used_count || '/' || cap_count || '/' || exceeded from public.ai_quota_status_at('${SP}')`, 'ok|299/300/false')}
${chk('A 공간 299 · 이번 호출 2단위 → 넘음', 'A', `select used_count || '/' || cap_count || '/' || exceeded from public.ai_quota_status_at('${SP}', 2)`, 'ok|299/300/true')}
${chk('A 매장 X 번호 → forbidden', 'A', `select cap_count::text from public.ai_quota_status_at('${X}')`, 'err:forbidden')}
${chk('A 빈 번호 → forbidden', 'A', `select cap_count::text from public.ai_quota_status_at(null)`, 'err:forbidden')}
update public.ai_usage_monthly set used = 300 where unit_id = ${q(SP)} and month = ${M};
update public.app_config set value = 'true' where key = 'billing_free_mode';
${chk('A 공간 300 · 무료 모드 켜짐 → 다 씀(공간은 상한을 본다)', 'A', `select used_count || '/' || cap_count || '/' || exceeded from public.ai_quota_status_at('${SP}')`, 'ok|300/300/true')}
${st('D', X, null)}
${chk('D 현재 매장 = ai_quota_status() 와 같음(무료 모드 켜짐)', 'D', `select ((select row(t.*)::text from public.ai_quota_status_at('${X}') t) = (select row(t.*)::text from public.ai_quota_status() t))::text`, 'ok|true')}
update public.app_config set value = 'false' where key = 'billing_free_mode';
${chk('D 현재 매장 = ai_quota_status() 와 같음(무료 모드 꺼짐)', 'D', `select ((select row(t.*)::text from public.ai_quota_status_at('${X}') t) = (select row(t.*)::text from public.ai_quota_status() t))::text`, 'ok|true')}
${chk('D 현재 매장 · 5단위 = ai_quota_status(5) 와 같음', 'D', `select ((select row(t.*)::text from public.ai_quota_status_at('${X}', 5) t) = (select row(t.*)::text from public.ai_quota_status(5) t))::text`, 'ok|true')}
${chk('D 매장 사장이 공간 번호 → forbidden', 'D', `select cap_count::text from public.ai_quota_status_at('${SP}')`, 'err:forbidden')}
${st('C', X, SP)}
${chk('C 현재 매장 + 현재 공간 → 공간 번호는 공간 상한', 'C', `select cap_count::text from public.ai_quota_status_at('${SP}')`, 'ok|300')}
${chk('C 현재 매장 + 현재 공간 → 매장 번호는 ai_quota_status 그대로', 'C', `select ((select row(t.*)::text from public.ai_quota_status_at('${X}') t) = (select row(t.*)::text from public.ai_quota_status() t))::text`, 'ok|true')}
${st('E', null, null)}
${chk('E 멤버 아님 공간 번호 → forbidden', 'E', `select cap_count::text from public.ai_quota_status_at('${SP}')`, 'err:forbidden')}
`;
}
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

${part2Sql()}

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

-- ── 교육 링크 함수(3번 덩이 앞부분 · 0400) ─────────────────────────────────
-- 손님(anon) 길: 틀린 토큰·만료·닫힘·지운 자리·다른 자리 노하우·초안·보관·숨김 → 전부 거절이나 빈 값.
-- 주인 길: 만들기·고치기·닫기는 그 행 자리의 링크 관리 권한(auth_can)으로만. 오류 코드까지 맞는지 본다.
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, archived_at, brand_hidden_at) values
  ('qa_pb_arc_${rnd}', ${q(SP)}, '서비스', '공간 보관', 'published', 'space_owner', now(), null),
  ('qa_pb_hid_${rnd}', ${q(SP)}, '서비스', '공간 숨김', 'published', 'space_owner', null, now()),
  ('qa_pb_x_${rnd}',   ${q(X)},  '서비스', '매장 X 노하우', 'published', null, null, null);
insert into public.units(id, store_name, kind, deleted_at) values ('qa_spd_${rnd}', 'QA지운공간', 'space', now());
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at, closed_at) values
  ('qa_el1_${rnd}', ${q(SP)}, 'qatok1_${rnd}_aaaaaaaaaaaa', 'QA 링크1', array['qa_pb_drf_${rnd}', 'qa_pb_pub_${rnd}', 'qa_pb_arc_${rnd}', 'qa_pb_hid_${rnd}'], now() + interval '7 days', null),
  ('qa_el2_${rnd}', ${q(SP)}, 'qatok2_${rnd}_aaaaaaaaaaaa', 'QA 닫힘', array['qa_pb_pub_${rnd}'], now() + interval '7 days', now()),
  ('qa_el3_${rnd}', ${q(SP)}, 'qatok3_${rnd}_aaaaaaaaaaaa', 'QA 만료', array['qa_pb_pub_${rnd}'], now() - interval '1 minute', null),
  ('qa_el4_${rnd}', ${q(SP)}, 'qatok4_${rnd}_aaaaaaaaaaaa', 'QA 빈 링크', '{}', now() + interval '7 days', null),
  ('qa_el5_${rnd}', 'qa_spd_${rnd}', 'qatok5_${rnd}_aaaaaaaaaaaa', 'QA 지운 자리', '{}', now() + interval '7 days', null),
  ('qa_el6_${rnd}', ${q(X)}, 'qatok6_${rnd}_aaaaaaaaaaaa', 'QA 매장 링크', array['qa_pb_x_${rnd}'], now() + interval '7 days', null);
-- A 를 지운 공간의 주인으로도 넣는다. 지운 자리라서 막히는지(남의 자리라서가 아니라) 보려고.
insert into public.unit_members(user_id, unit_id, role) values (${q(U.A)}, 'qa_spd_${rnd}', 'space_owner');
-- 다른 자리 노하우 번호가 이미 담겨 버린 행(옛 쓰기 길·사고 가정). 트리거를 잠시 끄고 심는다. 손님 함수가 그래도 걸러야 한다.
set local session_replication_role = replica;
update public.edu_links set entry_ids = entry_ids || 'qa_pb_x_${rnd}'::text where id = 'qa_el1_${rnd}';
set local session_replication_role = origin;

create function pg_temp.qa_anon(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
    execute p_sql into r;
    raise exception using errcode = 'QAOK0', message = 'qa_ok';
  exception
    when sqlstate 'QAOK0' then return 'ok|' || coalesce(r, '<null>');
    when others then return 'err|' || sqlstate || '|' || left(sqlerrm, 80);
  end;
end $f$;
create function pg_temp.qa_chk_anon(p_name text, p_sql text, p_expect text) returns text language sql as $f$
  select 'QA|CHK|' || p_name || '¦' || p_expect || '¦' || pg_temp.qa_anon(p_sql)
$f$;
${[
  ['살아 있는 링크 열림 · 발행 1개만 셈', 'aaaaaaaaaaaa', 1, `select o.ok || '/' || o.place_kind || '/' || o.entry_count from public.edu_link_open('qatok1_${rnd}_aaaaaaaaaaaa') o`, 'ok|true/space/1'],
  ['노하우 읽기 = 발행된 같은 자리 것만(초안·보관·숨김·다른 자리 빠짐)', '', 0, `select coalesce(string_agg(e.id, ','), '') from public.edu_link_entries('qatok1_${rnd}_aaaaaaaaaaaa') e`, `ok|qa_pb_pub_${rnd}`],
  ['열기 결과에 토큰·자리 번호 없음', '', 0, `select (strpos(o::text, 'qatok1') = 0 and strpos(o::text, ${q(SP)}) = 0)::text from public.edu_link_open('qatok1_${rnd}_aaaaaaaaaaaa') o`, 'ok|true'],
  ['빈 링크 열림 · 0개', '', 0, `select o.ok || '/' || o.entry_count from public.edu_link_open('qatok4_${rnd}_aaaaaaaaaaaa') o`, 'ok|true/0'],
  ['틀린 토큰 → 열기 실패', '', 0, `select o.ok::text from public.edu_link_open('qatok1_${rnd}_aaaaaaaaaaab') o`, 'ok|false'],
  ['짧은 토큰·빈 토큰 → 열기 실패', '', 0, `select (select ok from public.edu_link_open('') ) || '/' || (select ok from public.edu_link_open(null))`, 'ok|false/false'],
  ['닫힌 링크 → 열기 실패', '', 0, `select o.ok::text from public.edu_link_open('qatok2_${rnd}_aaaaaaaaaaaa') o`, 'ok|false'],
  ['만료된 링크 → 열기 실패', '', 0, `select o.ok::text from public.edu_link_open('qatok3_${rnd}_aaaaaaaaaaaa') o`, 'ok|false'],
  ['지운 자리 링크 → 열기 실패', '', 0, `select o.ok::text from public.edu_link_open('qatok5_${rnd}_aaaaaaaaaaaa') o`, 'ok|false'],
  ['닫힘·만료·틀린 토큰 → 노하우 0행', '', 0, `select count(*)::text from (select * from public.edu_link_entries('qatok2_${rnd}_aaaaaaaaaaaa') union all select * from public.edu_link_entries('qatok3_${rnd}_aaaaaaaaaaaa') union all select * from public.edu_link_entries('nope_nope_nope_nope_nope')) s`, 'ok|0'],
  ['매장 링크 열림 · 종류 store · 매장 노하우 1개 · 주인 이름 없음', '', 0, `select o.ok || '/' || o.place_kind || '/' || o.entry_count || '/' || coalesce(o.owner_name, '-') from public.edu_link_open('qatok6_${rnd}_aaaaaaaaaaaa') o`, 'ok|true/store/1/-'],
  ['공간 링크 열기에 공간 주인 이름(A)', '', 0, `select coalesce(o.owner_name, '-') from public.edu_link_open('qatok4_${rnd}_aaaaaaaaaaaa') o`, 'ok|QAA'],
  ['토큰 검사 함수는 손님이 못 부름', '', 0, `select (public.edu_link_resolve('qatok1_${rnd}_aaaaaaaaaaaa')).id`, 'err:permission denied'],
  ['링크 표를 손님이 못 읽음', '', 0, `select count(*)::text from public.edu_links`, 'err:permission denied'],
  ['손님 표를 손님이 못 읽음', '', 0, `select count(*)::text from public.edu_link_guests`, 'err:permission denied'],
  ['손님은 링크를 못 만듦', '', 0, `select id from public.edu_link_create(${q(SP)}, 't', '{}', 7)`, 'err:permission denied'],
  ['손님은 링크를 못 닫음', '', 0, `select public.edu_link_close('qa_el1_${rnd}')::text`, 'err:permission denied'],
].map(([n, , , s, e]) => `select pg_temp.qa_chk_anon(${q(`손님 ${n}`)}, ${q(s)}, ${q(e)});`).join('\n')}

-- 열람 수는 열기마다 1 오른다(되돌리지 않는 호출로 한 번 연다)
do $d$ begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  perform count(*) from public.edu_link_open('qatok1_${rnd}_aaaaaaaaaaaa');
  perform count(*) from public.edu_link_open('qatok2_${rnd}_aaaaaaaaaaaa');  -- 닫힌 링크: 세지 않아야 한다
exception when others then null;  -- 함수가 없으면(수정 전) 아래 검사가 0 으로 RED 가 된다
end $d$;
reset role;
select set_config('request.jwt.claims', '', true);
select 'QA|CHK|손님 열면 열람 수 1 오름¦ok|1¦ok|' || opened_count from public.edu_links where id = 'qa_el1_${rnd}';
select 'QA|CHK|손님 닫힌 링크를 열어도 열람 수 그대로¦ok|0¦ok|' || opened_count from public.edu_links where id = 'qa_el2_${rnd}';

-- 주인 길. A = 공간 주인(현재 공간) · B = 공간 멤버 겸 매장 X 직원 · D = 매장 X 사장 · C = 매장 X 매니저
create function pg_temp.qa_close_then_open(p_link text, p_token text) returns text language plpgsql as $f$
begin
  perform public.edu_link_close(p_link);
  perform public.edu_link_close(p_link);  -- 두 번 닫아도 같다
  return (select ok::text from public.edu_link_open(p_token));
end $f$;
-- 한 문장 안에서는 방금 쓴 행이 안 보인다. 쓰기와 읽기를 차례로 하는 도우미.
create function pg_temp.qa_create_then_read(p_unit text) returns text language plpgsql as $f$
declare v_id text; v_tok text; v_exp timestamptz; l public.edu_links;
begin
  select c.id, c.token, c.expires_at into v_id, v_tok, v_exp
    from public.edu_link_create(p_unit, '  새 링크  ', array['qa_pb_pub_${rnd}', 'qa_pb_drf_${rnd}', 'qa_pb_pub_${rnd}'], null) c;
  select * into l from public.edu_links where id = v_id;  -- 주인은 RLS 로 자기 링크를 읽는다
  return (length(v_tok) >= 20 and v_exp between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute'
          and l.created_by = auth.uid() and l.token = v_tok)::text || '/' || l.title || '/' || array_to_string(l.entry_ids, ',');
end $f$;
create function pg_temp.qa_update_then_read(p_link text, p_ids text[]) returns text language plpgsql as $f$
begin
  perform public.edu_link_update(p_link, '고친 제목', p_ids, null);
  return (select title || '/' || array_to_string(entry_ids, ',') from public.edu_links where id = p_link);
end $f$;
-- 매니저 C 가 무료 직원 한도(2명)에 걸려 좌석이 잠기지 않게 무료 모드를 켠다(트랜잭션 끝에 되돌아간다).
--   앞 블록(2번 덩이 F · ai_quota_status_at)이 무료 모드를 끈 채로 끝난다. 이 블록은 링크 권한만 본다(2026-11-11 통합 머지에서 발견).
insert into public.app_config(key, value) values ('billing_free_mode', 'true') on conflict (key) do update set value = excluded.value;
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, ${q(SP)}, null, null);
select pg_temp.qa_state(${q(U.B)}, ${q(S.B)}, ${q(X)}, ${q(SP)}, null, null);
select pg_temp.qa_state(${q(U.D)}, ${q(S.D)}, ${q(X)}, null, null, null);
select pg_temp.qa_state(${q(U.C)}, ${q(S.C)}, ${q(X)}, null, null, null);
${[
  ['A', '주인 링크 만들기 됨 · 토큰 20자 이상 · 7일 · 만든 사람 = 나',
    `select pg_temp.qa_create_then_read(${q(SP)})`, `ok|true/새 링크/qa_pb_pub_${rnd},qa_pb_drf_${rnd}`],
  ['A', '주인 링크 30일 됨', `select (c.expires_at > now() + interval '29 days')::text from public.edu_link_create(${q(SP)}, '', '{}', 30) c`, 'ok|true'],
  ['A', '주인 링크 31일 거절', `select id from public.edu_link_create(${q(SP)}, '', '{}', 31)`, 'err:invalid_argument'],
  ['A', '주인 노하우 201개 담기 거절(상한 200)', `select id from public.edu_link_create(${q(SP)}, '', (select array_agg('qa_none_' || g) from generate_series(1, 201) g), 7)`, 'err:invalid_argument'],
  ['A', '주인 링크 0일 거절', `select id from public.edu_link_create(${q(SP)}, '', '{}', 0)`, 'err:invalid_argument'],
  ['A', '주인이 다른 매장 노하우 담기 거절', `select id from public.edu_link_create(${q(SP)}, '', array['qa_pb_x_${rnd}'], 7)`, 'err:EDU_LINK_ENTRY_DENIED'],
  ['A', '주인이 보관된 노하우 담기 거절', `select id from public.edu_link_create(${q(SP)}, '', array['qa_pb_arc_${rnd}'], 7)`, 'err:EDU_LINK_ENTRY_DENIED'],
  ['A', '주인이 없는 노하우 담기 거절', `select id from public.edu_link_create(${q(SP)}, '', array['qa_pb_none_${rnd}'], 7)`, 'err:EDU_LINK_ENTRY_DENIED'],
  ['A', '주인이 매장 X 에 링크 만들기 거절', `select id from public.edu_link_create(${q(X)}, '', '{}', 7)`, 'err:not_manager'],
  ['B', '공간 멤버 링크 만들기 거절', `select id from public.edu_link_create(${q(SP)}, '', '{}', 7)`, 'err:not_space_owner'],
  ['B', '매장 직원 매장 링크 만들기 거절', `select id from public.edu_link_create(${q(X)}, '', '{}', 7)`, 'err:not_manager'],
  ['D', '매장 사장 공간 링크 만들기 거절', `select id from public.edu_link_create(${q(SP)}, '', '{}', 7)`, 'err:not_space_owner'],
  ['D', '매장 사장 매장 링크 만들기 됨', `select (c.id is not null)::text from public.edu_link_create(${q(X)}, 'X', array['qa_pb_x_${rnd}'], 7) c`, 'ok|true'],
  ['C', '매장 매니저 매장 링크 만들기 됨', `select (c.id is not null)::text from public.edu_link_create(${q(X)}, 'X', '{}', 7) c`, 'ok|true'],
  ['E', '아무 데도 아닌 사람 링크 만들기 거절', `select id from public.edu_link_create(${q(SP)}, '', '{}', 7)`, 'err:not_space_owner'],
  ['A', '주인이 닫으면 손님 열기 실패(두 번 닫아도 됨)', `select pg_temp.qa_close_then_open('qa_el1_${rnd}', 'qatok1_${rnd}_aaaaaaaaaaaa')`, 'ok|false'],
  ['B', '공간 멤버 링크 닫기 거절', `select public.edu_link_close('qa_el1_${rnd}')::text`, 'err:not_space_owner'],
  ['D', '매장 사장 공간 링크 닫기 거절', `select public.edu_link_close('qa_el1_${rnd}')::text`, 'err:not_space_owner'],
  ['A', '없는 링크 닫기 → 찾을 수 없음', `select public.edu_link_close('qa_el_none_${rnd}')::text`, 'err:link_not_found'],
  ['A', '주인 노하우 빼기·넣기 됨', `select pg_temp.qa_update_then_read('qa_el4_${rnd}', array['qa_pb_pub_${rnd}'])`, `ok|고친 제목/qa_pb_pub_${rnd}`],
  ['A', '이미 담긴 다른 자리 번호는 다시 안 봄 · 새로 넣는 것만 검사', `select public.edu_link_update('qa_el1_${rnd}', null, array['qa_pb_pub_${rnd}', 'qa_pb_x_${rnd}'], null)::text`, 'ok|'],
  ['A', '주인 다른 매장 노하우 새로 넣기 거절', `select public.edu_link_update('qa_el4_${rnd}', null, array['qa_pb_x_${rnd}'], null)::text`, 'err:EDU_LINK_ENTRY_DENIED'],
  ['A', '닫힌 링크 고치기 거절', `select public.edu_link_update('qa_el2_${rnd}', 'x', null, null)::text`, 'err:link_closed'],
  ['A', '기간 끝난 링크 고치기 거절', `select public.edu_link_update('qa_el3_${rnd}', 'x', null, null)::text`, 'err:link_expired'],
  ['A', '만든 날부터 30일 넘게 늘리기 거절', `select public.edu_link_update('qa_el4_${rnd}', null, null, now() + interval '31 days')::text`, 'err:invalid_argument'],
  ['A', '기간 줄이기 됨', `select public.edu_link_update('qa_el4_${rnd}', null, null, now() + interval '2 days')::text`, 'ok|'],
  ['B', '공간 멤버 링크 고치기 거절', `select public.edu_link_update('qa_el4_${rnd}', 'x', null, null)::text`, 'err:not_space_owner'],
  ['A', '주인 쪽 토큰 검사 함수 직접 호출 거절', `select (public.edu_link_resolve('qatok1_${rnd}_aaaaaaaaaaaa')).id`, 'err:permission denied'],
].map(([k, n, s, e]) => `select pg_temp.qa_chk(${q(`교육 링크 ${n}`)}, '${k}', ${q(s)}, ${q(e)});`).join('\n')}

-- 지운 공간: A 는 그 공간의 주인이고 현재 공간 기록도 그 공간이다. 그래도 막혀야 한다(지운 자리라서).
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, 'qa_spd_${rnd}', null, null);
select pg_temp.qa_chk('교육 링크 지운 공간 주인도 링크를 못 닫음', 'A', $s$select public.edu_link_close('qa_el5_${rnd}')::text$s$, 'err:not_space_owner');
select pg_temp.qa_chk('교육 링크 지운 공간 주인도 링크를 못 만듦', 'A', $s$select id from public.edu_link_create('qa_spd_${rnd}', '', '{}', 7)$s$, 'err:not_space_owner');
-- 대조군: 같은 사람·같은 기록에서 삭제 표시만 걷으면 열린다(위 거절이 지운 자리 때문임을 보인다).
update public.units set deleted_at = null where id = 'qa_spd_${rnd}';
select pg_temp.qa_chk('교육 링크 (대조) 지우기 전이면 그 주인이 링크를 닫음', 'A', $s$select public.edu_link_close('qa_el5_${rnd}')::text$s$, 'ok|');
update public.units set deleted_at = now() where id = 'qa_spd_${rnd}';
select pg_temp.qa_state(${q(U.A)}, ${q(S.A)}, null, ${q(SP)}, null, null);
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
const SPACE_PART_TABLES = new Set(['playbook_entries', 'playbook_embeddings', 'chat_queries', 'unknown_queries', 'ai_usage_monthly', 'question_replies']);
// 공간 부품 함수(2번 덩이): 현재 공간에서 공간 결과를 돌려주는 것이 정상이라 A·B 의 ①②④ 비교에서 뺀다.
//   매장 쪽 비교(B·C ③a=③b=③c)와 섞임 검사는 그대로 받는다.
const SPACE_PART_FNS = new Set(['ai_quota_status_at']);
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
    const spacePart = SPACE_PART_FNS.has(name.split('(')[0]);
    if (!spacePart && (a1.sig !== a2.sig || (!echoesProfile && a1.sig !== a4.sig))) fnDiff.push(`A ${name}: ①${a1.sig.slice(0, 40)} ②${a2.sig.slice(0, 40)} ④${a4.sig.slice(0, 40)}`);
    if (!spacePart && b1.sig !== b2.sig) fnDiff.push(`B ${name}: ①${b1.sig.slice(0, 40)} ②${b2.sig.slice(0, 40)}`);
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
for (const l of lines.filter((l) => l.startsWith('QA|SETUPFAIL|'))) check(`셋업: ${l.slice(13)}`, false);
for (const l of lines.filter((l) => l.startsWith('QA|CHK|'))) {
  const [name, expect, got] = l.slice(7).split('¦');
  calls++; if (got.startsWith('err|')) rejected++;
  // 'err' = 아무 오류 · 'err:<코드>' = 그 코드로 거절(엉뚱한 이유의 거절을 통과로 세지 않는다 · 함수가 없어서 난 거절도 통과가 아니다) · 'ok*' = 오류 없이 돌아옴.
  const ok = expect === 'err' ? got.startsWith('err|')
    : expect.startsWith('err:') ? got.startsWith('err|') && got.includes(expect.slice(4))
    : expect === 'ok*' ? got.startsWith('ok|')
    : got === expect;
  check(name, ok, ok ? (expect.startsWith('err') ? got.split('|').slice(1, 3).join(' ') : '') : `기대 ${expect} · 실제 ${got}`);
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

// ── 3부: 공간 삭제 · 30일 파기 · 공간 주인 탈퇴(0430) ─────────────────────────
//   1부처럼 한 트랜잭션 안에서 심고 끝에 전부 되돌린다(흔적 0). 시간은 deleted_at 을 29일·31일 전으로 당겨 흉내 낸다.
//   매장 파기 대조: 같은 지운 매장을 공간 삭제·파기 전과 후에 purge_deleted_store 로 부르고(그 호출은 되돌림) 결과가 같은지 본다.
//   이 대조 줄(QA|STORE)은 마이그레이션 적용 전 실행 결과와도 비교한다(작업 기록).
console.log('\n[5] 공간 삭제 · 30일 파기 · 공간 주인 탈퇴');
{
  const V = Object.fromEntries(['O', 'M', 'K', 'N', 'O2', 'M2', 'O3', 'Z'].map((k, i) => [k, `00000000-0000-4000-a${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const VS = Object.fromEntries(Object.keys(V).map((k, i) => [k, `00000000-0000-4000-b${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const SPA = `qa_dsa_${rnd}`, SPB = `qa_dsb_${rnd}`, SPC = `qa_dsc_${rnd}`, ST = `qa_dst_${rnd}`;
  const OWNER = `오너${rnd}`, GUEST = `손님${rnd.slice(0, 4)}`, MARK = `mk${rnd}`;
  const TOKEN = `qa_del_tok_${rnd}_${rnd}`;
  const as = (who, s, keep = false, role = 'authenticated') => `pg_temp.qa_as(${who ? q(V[who]) + '::uuid' : 'null'}, ${who ? q(VS[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(s)}, ${keep})`;
  const chk = (name, expect, gotSql) => `insert into qa_out(l) select ${q(`QA|DEL|${name}¦${expect}¦`)} || (${gotSql});`;
  const svc = (s) => `(select coalesce((${s})::text, '<null>'))`;
  const storeSnap = (tag) => `do $s$ declare c jsonb; begin
  begin c := public.purge_deleted_store(${q(ST)}); raise exception using errcode = 'QAOK0';
  exception when sqlstate 'QAOK0' then null; when others then c := jsonb_build_object('err', sqlerrm); end;
  insert into qa_out(l) values ('QA|STORE|${tag}|' || coalesce(c::text, '<null>'));
end $s$;`;
  const sql3 = String.raw`
begin;
create temp table qa_out(i serial, l text);
create temp table qa_v(k text primary key, v bigint);
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_spd_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', case when v.k = 'O' then ${q(OWNER)} else 'QA' || v.k end, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${Object.entries(V).map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now()
  from (values ${Object.keys(V).map((k) => `(${q(VS[k])}, ${q(V[k])})`).join(', ')}) v(sid, uid);

create function pg_temp.qa_as(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_keep boolean) returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
      else json_build_object('sub', p_uid, 'role', p_role, 'session_id', p_sid)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql into r;
    if not p_keep then raise exception using errcode = 'QAOK0', message = 'qa_ok'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ok|' || coalesce(r, '<null>');
  exception
    when sqlstate 'QAOK0' then return 'ok|' || coalesce(r, '<null>');
    when others then return 'err|' || left(sqlerrm, 60);
  end;
end $f$;

-- 자리: 공간 A(주인 O · 멤버 M) · 공간 B(주인 O2 · 멤버 M2) · 공간 C(주인 O3 · 멤버 없음) · 지운 매장 ST(대조) · 매장 X 사장 K
insert into public.unit_members(user_id, unit_id, role) values (${q(V.K)}, ${q(X)}, 'owner');
insert into public.units(id, store_name, kind, invite_code) values
  (${q(SPA)}, 'QA삭제공간A', 'space', upper(substr(md5(random()::text), 1, 6))), (${q(SPB)}, 'QA삭제공간B', 'space', null), (${q(SPC)}, 'QA삭제공간C', 'space', upper(substr(md5(random()::text), 1, 6)));
-- 대조 매장 행만 트리거를 끄고 넣는다(사장 전화 인증 트리거 · 이 하니스는 매장 만들기를 재지 않는다).
set local session_replication_role = replica;
insert into public.units(id, store_name, kind, owner_id, industry, deleted_at)
select ${q(ST)}, 'QA대조매장', 'store', ${q(V.Z)}, u.industry, now() - interval '1 day' from public.units u where u.id = ${q(X)};
set local session_replication_role = origin;
insert into public.unit_members(user_id, unit_id, role) values
  (${q(V.O)}, ${q(SPA)}, 'space_owner'), (${q(V.M)}, ${q(SPA)}, 'space_member'),
  (${q(V.O2)}, ${q(SPB)}, 'space_owner'), (${q(V.M2)}, ${q(SPB)}, 'space_member'), (${q(V.O3)}, ${q(SPC)}, 'space_owner');

-- 공간 A 기록: 주인 노하우(제목에 주인·손님 이름) · 주인 질문 · 답할 질문 · 교육 링크 · 손님 · 손님 질문 짝
select set_config('request.jwt.claims', json_build_object('sub', ${q(V.O)}, 'role', 'authenticated')::text, true);
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, creator_id, creator_name) values
  ('qa_dpe_${rnd}', ${q(SPA)}, '서비스', ${q(`${OWNER} 비법 ${GUEST} ${MARK}`)}, 'published', 'space_owner', ${q(V.O)}, ${q(OWNER)});
insert into public.chat_queries(id, unit_id, query_text) values ('qa_dcq_o_${rnd}', ${q(SPA)}, '공간 삭제 질문');
insert into public.unknown_queries(id, unit_id, query_text, status) values ('qa_duq_o_${rnd}', ${q(SPA)}, '공간 삭제 질문', 'pending_owner_answer');
select set_config('request.jwt.claims', json_build_object('sub', ${q(V.Z)}, 'role', 'authenticated')::text, true);
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role) values
  ('qa_dpe_st_${rnd}', ${q(ST)}, '서비스', '대조 매장 노하우', 'published', 'owner');
insert into public.chat_queries(id, unit_id, query_text) values ('qa_dcq_st_${rnd}', ${q(ST)}, '대조 매장 질문');
select set_config('request.jwt.claims', '', true);
insert into public.edu_links(id, unit_id, token, title) values ('qa_del_el_${rnd}', ${q(SPA)}, ${q(TOKEN)}, 'QA 삭제 링크');
insert into public.edu_link_guests(id, link_id, unit_id, name, key_hash) values ('qa_del_g_${rnd}', 'qa_del_el_${rnd}', ${q(SPA)}, ${q(GUEST)}, md5(random()::text));
insert into public.chat_queries(id, unit_id, query_text, link_id, junior_name) values ('qa_dcq_g_${rnd}', ${q(SPA)}, '손님 질문', 'qa_del_el_${rnd}', ${q(GUEST)});
insert into public.edu_guest_questions(cq_id, guest_id, link_id) values ('qa_dcq_g_${rnd}', 'qa_del_g_${rnd}', 'qa_del_el_${rnd}');
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(VS.O)}, ${q(V.O)}, ${q(SPA)}), (${q(VS.M)}, ${q(V.M)}, ${q(SPA)});

-- 지우기 전(전제가 서야 아래 "닫힘"이 뜻이 있다)
${chk('전제: 주인 O 현재 공간 = A', `ok|${SPA}`, as('O', 'select coalesce(public.auth_space_id(), \'<null>\')'))}
${chk('전제: 멤버 M 의 내 공간 1개', 'ok|1', as('M', 'select count(*)::text from public.my_spaces()'))}
${chk('전제: 링크가 열린다', 'ok|true', `case when to_regprocedure('public.edu_link_open(text)') is null then 'skip' else ${as(null, `select ok::text from public.edu_link_open(${q(TOKEN)})`, false, 'anon')} end`)}
${storeSnap('before')}

-- 거절: 멤버 · 매장 사장 · 아무도 아닌 사람 · 없는 번호
${chk('멤버는 못 지운다', 'err|not_space_owner', as('M', `select 'done' from public.delete_space(${q(SPA)})`))}
${chk('매장 사장은 못 지운다', 'err|not_space_owner', as('K', `select 'done' from public.delete_space(${q(SPA)})`))}
${chk('남은 못 지운다', 'err|not_space_owner', as('N', `select 'done' from public.delete_space(${q(SPA)})`))}
${chk('남의 공간(B)을 주인 O 가 못 지운다', 'err|not_space_owner', as('O', `select 'done' from public.delete_space(${q(SPB)})`))}
${chk('로그인 없이 못 지운다', 'err|permission denied for function delete_space', as(null, `select 'done' from public.delete_space(${q(SPA)})`, false, 'anon'))}

-- 주인이 지운다(남긴다)
${chk('주인 O 가 지운다', 'ok|done', as('O', `select 'done' from public.delete_space(${q(SPA)})`, true))}
${chk('지운 표시 · 초대 코드 비움', 'true|true', svc(`select (deleted_at is not null)::text || '|' || (invite_code is null)::text from public.units where id = ${q(SPA)}`))}
${chk('멤버 전원 나감', '0', svc(`select count(*) from public.unit_members where unit_id = ${q(SPA)}`))}
${chk('현재 공간 기록 0', '0', svc(`select count(*) from public.session_active_spaces where space_id = ${q(SPA)}`))}
${chk('주인 O 현재 공간 닫힘', 'ok|<null>', as('O', 'select coalesce(public.auth_space_id(), \'<null>\')'))}
${chk('멤버 M 현재 공간 닫힘', 'ok|<null>', as('M', 'select coalesce(public.auth_space_id(), \'<null>\')'))}
${chk('주인 O 의 내 공간 0', 'ok|0', as('O', 'select count(*)::text from public.my_spaces()'))}
${chk('멤버 M 의 내 공간 0', 'ok|0', as('M', 'select count(*)::text from public.my_spaces()'))}
${chk('링크 열기 닫힘', 'ok|false', `case when to_regprocedure('public.edu_link_open(text)') is null then 'skip' else ${as(null, `select ok::text from public.edu_link_open(${q(TOKEN)})`, false, 'anon')} end`)}
${chk('링크 행도 닫힘', 'true', svc(`select (closed_at is not null)::text from public.edu_links where id = 'qa_del_el_${rnd}'`))}
${chk('주인 O 노하우 읽기 0(공간 RLS 닫힘)', 'ok|0', as('O', `select count(*)::text from public.playbook_entries where unit_id = ${q(SPA)}`))}
${chk('두 번 지우기 거절', 'err|not_space_owner', as('O', `select 'done' from public.delete_space(${q(SPA)})`))}
${chk('기록은 30일까지 남음(질문 2)', '2', svc(`select count(*) from public.chat_queries where unit_id = ${q(SPA)}`))}

-- 공간 주인 탈퇴
${chk('멤버 있는 공간 주인 O2 탈퇴 거절', 'err|space_has_members', as('O2', "select 'done' from public.delete_my_account()"))}
${chk('멤버 M2 탈퇴는 된다', 'ok|done', as('M2', "select 'done' from public.delete_my_account()", true))}
${chk('멤버 탈퇴로 공간 B 는 안 지워진다', '<null>', svc(`select deleted_at from public.units where id = ${q(SPB)}`))}
${chk('멤버가 탈퇴한 뒤 주인 O2 탈퇴 → 공간 B 지운 표시', 'ok|done', as('O2', "select 'done' from public.delete_my_account()", true))}
${chk('공간 B 지운 표시', 'true', svc(`select (deleted_at is not null)::text from public.units where id = ${q(SPB)}`))}
${chk('멤버 없는 공간 주인 O3 탈퇴', 'ok|done', as('O3', "select 'done' from public.delete_my_account()", true))}
${chk('공간 C 지운 표시 · 초대 코드 비움 · 주인 멤버십 남김', 'true|true|1', svc(`select (deleted_at is not null)::text || '|' || (invite_code is null)::text || '|' || (select count(*) from public.unit_members m where m.unit_id = u.id) from public.units u where id = ${q(SPC)}`))}

-- 29일째: 남는다
update public.units set deleted_at = now() - interval '29 days' where id in (${q(SPA)}, ${q(SPC)});
update public.profiles set deleted_at = now() - interval '29 days' where id = ${q(V.O3)};
select public.purge_deleted_accounts() is not null;
${chk('29일째 공간 A·C 남음', '2', svc(`select count(*) from public.units where id in (${q(SPA)}, ${q(SPC)}) and purged_at is null`))}
${chk('29일째 공간 A 기록 남음(질문 2 · 링크 1 · 손님 1)', '2|1|1', svc(`select (select count(*) from public.chat_queries where unit_id = ${q(SPA)}) || '|' || (select count(*) from public.edu_links where unit_id = ${q(SPA)}) || '|' || (select count(*) from public.edu_link_guests where unit_id = ${q(SPA)})`))}

-- 31일째: 파기
insert into qa_v select 'chat', coalesce(sum(questions), 0) from public.retained_question_stats where industry = '' and source = 'chat';
insert into qa_v select 'unknown', coalesce(sum(questions), 0) from public.retained_question_stats where industry = '' and source = 'unknown';
update public.units set deleted_at = now() - interval '31 days' where id in (${q(SPA)}, ${q(SPC)});
update public.profiles set deleted_at = now() - interval '31 days' where id = ${q(V.O3)};
select public.purge_deleted_accounts() is not null;
${chk('31일째 공간 A·C 행 없음', '0', svc(`select count(*) from public.units where id in (${q(SPA)}, ${q(SPC)})`))}
${chk('파기 실패 기록 0', '0', svc(`select count(*) from public.retention_purge_log where counts->>'unit_id' in (${q(SPA)}, ${q(SPC)}) and (counts->>'failed')::boolean`))}
${chk('링크·손님·손님 질문 짝 0', '0|0|0', svc(`select (select count(*) from public.edu_links where id = 'qa_del_el_${rnd}') || '|' || (select count(*) from public.edu_link_guests where id = 'qa_del_g_${rnd}') || '|' || (select count(*) from public.edu_guest_questions where cq_id = 'qa_dcq_g_${rnd}')`))}
${chk('질문·답할 질문·노하우 0', '0|0|0', svc(`select (select count(*) from public.chat_queries where id like 'qa_dcq_%${rnd}' and id <> 'qa_dcq_st_${rnd}') || '|' || (select count(*) from public.unknown_queries where id = 'qa_duq_o_${rnd}') || '|' || (select count(*) from public.playbook_entries where id = 'qa_dpe_${rnd}')`))}
${chk('질문 통계 생김(질문 +2 · 답할 질문 +1 · 업종 없음)', '2|1', svc(`select (select coalesce(sum(questions), 0) from public.retained_question_stats where industry = '' and source = 'chat') - (select v from qa_v where k = 'chat') || '|' || (select coalesce(sum(questions), 0) from public.retained_question_stats where industry = '' and source = 'unknown') - (select v from qa_v where k = 'unknown')`))}
${chk('보관 노하우: 주인·손님 이름 지움', `[이름] 비법 [이름] ${MARK}`, svc(`select string_agg(title, ' / ') from public.retained_knowhow where title like ${q(`%${MARK}%`)}`))}
${chk('탈퇴 30일 지난 공간 주인 O3 계정 파기', '0', svc(`select count(*) from auth.users where id = ${q(V.O3)}`))}
${chk('지운 지 30일 안 된 공간 B 는 남음', '1', svc(`select count(*) from public.units where id = ${q(SPB)}`))}
${storeSnap('after')}

select l from qa_out order by i;
rollback;
`;
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql3, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    check('3부 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|CONTEXT|LINE/.test(l)).slice(0, 8).join(' | '));
  } else {
    const ls = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|'));
    for (const l of ls.filter((l) => l.startsWith('QA|DEL|'))) {
      const [name, expect, got] = l.slice(7).split('¦');
      if (got === 'skip') { skipped(name, '교육 링크 함수(0400)가 이 DB 에 없음'); continue; }
      calls++; if (got.startsWith('err|')) rejected++;
      check(name, got === expect, got === expect ? '' : `기대 ${expect} · 실제 ${got}`);
    }
    const snap = (t) => ls.find((l) => l.startsWith(`QA|STORE|${t}|`))?.slice(`QA|STORE|${t}|`.length);
    const b = snap('before'), a = snap('after');
    check('지운 매장 파기 결과가 공간 삭제·파기 전후로 같다', !!b && b === a && !b.includes('"err"'), b === a ? '' : `전 ${b} · 후 ${a}`);
    console.log(`  · 매장 파기 결과(마이그레이션 전후 비교용): ${b}`);
  }
}

// ── 4부: 공간 합류 · 멤버 요청 · 수락과 거절 · 내보내기 · 나가기(0460) ──────────────
//   1부처럼 한 트랜잭션 안에서 심고 끝에 전부 되돌린다(흔적 0). 입구는 이 트랜잭션 안에서 끄고 허용 목록으로만 연다.
//   기대값은 오류 코드까지 적는다. 함수가 없거나 엉뚱한 이유로 거절되면 코드가 달라 실패로 센다.
//   옛 앱이 공간 코드를 매장 합류 칸에 넣는 경우는 [2] "E 공간 초대코드로 매장 합류 0행"이 잰다.
console.log('\n[6] 공간 합류 · 멤버 요청 · 수락과 거절 · 내보내기 · 나가기');
{
  const ks = ['P', 'Q', 'R', 'R2', 'R3', 'R4', 'T', 'G', 'H', 'L', 'N'];
  const V = Object.fromEntries(ks.map((k, i) => [k, `00000000-0000-4000-c${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const VS = Object.fromEntries(ks.map((k, i) => [k, `00000000-0000-4000-d${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S6 = `qa_ms_${rnd}`, S6B = `qa_msb_${rnd}`, S6D = `qa_msd_${rnd}`;
  const C6 = `Q6${rnd.slice(0, 4).toUpperCase()}`, C6D = `QD${rnd.slice(4, 8).toUpperCase()}`;
  const TK = `qa_mem_tok_${rnd}_${rnd}`, TKB = `qa_mem_tokb_${rnd}_${rnd}`, TKC = `qa_mem_tokc_${rnd}_${rnd}`, TKX = `qa_mem_tokx_${rnd}_${rnd}`;
  const as = (who, s, keep = false, role = 'authenticated') => `pg_temp.qa_as(${who ? q(V[who]) + '::uuid' : 'null'}, ${who ? q(VS[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(s)}, ${keep})`;
  const chk = (name, expect, gotSql) => `insert into qa_out(l) select ${q(`QA|MEM|${name}¦${expect}¦`)} || (${gotSql});`;
  const svc = (s) => `(select coalesce((${s})::text, '<null>'))`;
  const join = (who, code, keep = true) => as(who, `select count(*)::text from public.join_space_by_code(${q(code)})`, keep);
  const req = (who, tok, keep = true) => as(who, `select (public.request_space_join(${q(tok)}) is not null)::text`, keep);
  // 요청 번호는 클라가 못 읽는 표에 있다. 관리자 권한으로 먼저 꺼내 호출 글에 넣는다(표가 없으면 null · 수정 전 RED 용).
  const decide = (who, of, accept) => `pg_temp.qa_as(${q(V[who])}::uuid, ${q(VS[who])}::uuid, 'authenticated', format('select ''done'' from public.decide_space_join_request(%L, ${accept})', pg_temp.qa_req_id(${q(V[of])}::uuid)), true)`;
  const sql4 = String.raw`
begin;
create temp table qa_out(i serial, l text);
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_spm_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA멤버' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${ks.map((k) => `(${q(k)}, ${q(V[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now()
  from (values ${ks.map((k) => `(${q(VS[k])}, ${q(V[k])})`).join(', ')}) v(sid, uid);
-- 전화 인증: 면제 날짜 이전 계정으로 만든다. H 만 새 계정 · 번호 없음(인증 전).
update public.profiles set created_at = '2020-01-01' where id in (${ks.filter((k) => k !== 'H').map((k) => q(V[k])).join(', ')});
-- 입구: 전체 스위치를 끄고 허용 목록으로만 연다. G 는 목록에 없다.
update public.unit_kind_features set enabled = false where kind = 'space' and feature = 'enter';
insert into public.space_entry_allowlist(user_id, note)
select v::uuid, 'qa' from unnest(array[${ks.filter((k) => k !== 'G').map((k) => q(V[k])).join(', ')}]) v;

create function pg_temp.qa_as(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_keep boolean) returns text language plpgsql as $f$
declare r text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
      else json_build_object('sub', p_uid, 'role', p_role, 'session_id', p_sid)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql into r;
    if not p_keep then raise exception using errcode = 'QAOK0', message = 'qa_ok'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ok|' || coalesce(r, '<null>');
  exception
    when sqlstate 'QAOK0' then return 'ok|' || coalesce(r, '<null>');
    when others then return 'err|' || left(sqlerrm, 60);
  end;
end $f$;
create function pg_temp.qa_req_id(p_uid uuid) returns uuid language plpgsql as $f$
declare r uuid;
begin
  execute 'select id from public.space_join_requests where user_id = $1 order by created_at desc limit 1' into r using p_uid;
  return r;
exception when others then return null;
end $f$;

-- 자리: 공간 S6(주인 P · 코드 C6) · 공간 S6B(주인 N) · 지운 공간 S6D(코드를 일부러 남김) · 매장 X 사장 T
insert into public.units(id, store_name, kind, invite_code) values
  (${q(S6)}, 'QA멤버공간', 'space', ${q(C6)}), (${q(S6B)}, 'QA멤버공간B', 'space', null), (${q(S6D)}, 'QA지운공간', 'space', ${q(C6D)});
update public.units set deleted_at = now() where id = ${q(S6D)};
insert into public.unit_members(user_id, unit_id, role) values
  (${q(V.P)}, ${q(S6)}, 'space_owner'), (${q(V.N)}, ${q(S6B)}, 'space_owner'), (${q(V.T)}, ${q(X)}, 'owner');
update public.profiles set role = 'owner', active_unit_id = ${q(X)} where id = ${q(V.T)};
update public.units set invite_code = coalesce(invite_code, 'QX' || upper(substr(md5(random()::text), 1, 4))), invite_expires_at = null where id = ${q(X)};
insert into public.edu_links(id, unit_id, token, title) values
  ('qa_mem_el_${rnd}', ${q(S6)}, ${q(TK)}, 'QA 멤버 링크'), ('qa_mem_elb_${rnd}', ${q(S6B)}, ${q(TKB)}, 'QA 멤버 링크B'),
  ('qa_mem_elc_${rnd}', ${q(S6)}, ${q(TKC)}, 'QA 닫힌 링크'), ('qa_mem_elx_${rnd}', ${q(X)}, ${q(TKX)}, 'QA 매장 링크');
update public.edu_links set closed_at = now() where id = 'qa_mem_elc_${rnd}';
select set_config('request.jwt.claims', json_build_object('sub', ${q(V.P)}, 'role', 'authenticated')::text, true);
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, creator_id, creator_name) values
  ('qa_mpe_${rnd}', ${q(S6)}, '서비스', 'QA 멤버 노하우', 'published', 'space_owner', ${q(V.P)}, 'QA멤버P');
select set_config('request.jwt.claims', '', true);
create temp table qa_before as select id, role, active_unit_id, unit_id from public.profiles where id = ${q(V.T)};

-- 초대코드로 바로 멤버
${chk('로그인 없이 합류 거절', 'err|permission denied for function join_space_by_code', as(null, `select count(*)::text from public.join_space_by_code(${q(C6)})`, false, 'anon'))}
${chk('입구 닫힌 계정 거절', 'err|space_closed', join('G', C6, false))}
${chk('전화 인증 전 거절', 'err|PHONE_NOT_VERIFIED', join('H', C6, false))}
${chk('틀린 코드 0행', 'ok|0', join('Q', 'ZZZZZ9', false))}
${chk('매장 X 코드로 공간 합류 0행', 'ok|0', `pg_temp.qa_as(${q(V.Q)}::uuid, ${q(VS.Q)}::uuid, 'authenticated', format('select count(*)::text from public.join_space_by_code(%L)', (select invite_code from public.units where id = ${q(X)})), false)`)}
${chk('지운 공간 코드 거절(코드가 남아 있어도)', 'err|space_not_accepting', join('Q', C6D, false))}
${chk('맞는 코드(소문자로 쳐도) 합류 됨', 'ok|1', join('Q', C6.toLowerCase()))}
${chk('합류한 사람 = 공간 멤버', 'space_member', svc(`select role from public.unit_members where unit_id = ${q(S6)} and user_id = ${q(V.Q)}`))}
${chk('같은 사람 다시 합류 거절', 'err|already_member', join('Q', C6, false))}
${chk('주인이 자기 코드 넣기 거절', 'err|already_member', join('P', C6, false))}
${chk('사장 계정도 남의 공간 합류 됨', 'ok|1', join('T', C6))}
${chk('사장 계정 역할·현재 매장 그대로', 'true', svc(`select (p.role, p.active_unit_id, p.unit_id) is not distinct from (b.role, b.active_unit_id, b.unit_id) and p.role = 'owner' from public.profiles p, qa_before b where p.id = b.id`))}
${chk('사장 계정 현재 매장이 공간으로 안 바뀜', `ok|${X}`, as('T', `select coalesce(public.auth_member_unit_id(), '<null>')`))}
${[1, 2, 3, 4, 5].map((n) => chk(`틀린 코드 ${n}번째 0행(기록 남김)`, 'ok|0', join('L', 'ZZZZZ8'))).join('\n')}
${chk('틀린 코드 5번이면 맞는 코드도 잠김(매장 합류와 같은 잠금)', 'err|too_many_attempts', join('L', C6, false))}

-- 링크로 온 사람의 멤버 요청
${chk('닫힌 링크로 요청 거절', 'err|link_closed', req('R', TKC, false))}
${chk('없는 토큰으로 요청 거절', 'err|link_closed', req('R', `nope_${rnd}_${rnd}_xx`, false))}
${chk('매장 링크로 요청 거절', 'err|feature_off', req('R', TKX, false))}
${chk('입구 닫힌 계정 요청 거절', 'err|space_closed', req('G', TK, false))}
${chk('이미 멤버는 요청 거절', 'err|already_member', req('Q', TK, false))}
${chk('요청 됨', 'ok|true', req('R', TK))}
${chk('같은 요청 다시 거절', 'err|already_pending', req('R', TK, false))}
${chk('주인에게 합류 신청 알림 1개(공간 경로 · 본문 없음)', `1|/space/settings?space=${S6}&member=${V.R}|QA멤버R님이 합류를 신청했어요`, svc(`select count(*) || '|' || max(url) || '|' || max(title) from public.member_notices where user_id = ${q(V.P)} and kind = 'join_request' and unit_id = ${q(S6)}`))}
${chk('주인 요청 목록 1개(이름)', 'ok|1|QA멤버R', as('P', `select count(*) || '|' || max(name) from public.space_pending_requests(${q(S6)})`))}
${chk('멤버는 요청 목록 거절', 'err|not_space_owner', as('Q', `select count(*)::text from public.space_pending_requests(${q(S6)})`))}
${chk('남의 공간 주인은 요청 목록 거절', 'err|not_space_owner', as('N', `select count(*)::text from public.space_pending_requests(${q(S6)})`))}
${chk('남의 공간 주인이 수락 거절', 'err|not_space_owner', decide('N', 'R', true))}
${chk('멤버가 수락 거절', 'err|not_space_owner', decide('Q', 'R', true))}
${chk('수락 전 요청한 사람은 멤버 아님', '0', svc(`select count(*) from public.unit_members where unit_id = ${q(S6)} and user_id = ${q(V.R)}`))}
${chk('주인이 수락', 'ok|done', decide('P', 'R', true))}
${chk('수락하면 공간 멤버', 'space_member', svc(`select role from public.unit_members where unit_id = ${q(S6)} and user_id = ${q(V.R)}`))}
${chk('요청한 사람에게 승인 알림(새 종류 값 · 옛 벨 값 아님)', `1|/space/joined/${S6}|QA멤버공간 합류가 승인됐어요|0`, svc(`select count(*) filter (where kind = 'join_approved') || '|' || max(url) || '|' || max(title) || '|' || count(*) filter (where kind in ('approved', 'rejected', 'removed')) from public.member_notices where user_id = ${q(V.R)}`))}
${chk('다시 수락 거절', 'err|request_not_pending', decide('P', 'R', true))}
${chk('수락 뒤 요청 목록 0', 'ok|0', as('P', `select count(*)::text from public.space_pending_requests(${q(S6)})`))}
${chk('R2 요청 됨', 'ok|true', req('R2', TK))}
${chk('주인이 거절', 'ok|done', decide('P', 'R2', false))}
${chk('거절하면 멤버 아님', '0', svc(`select count(*) from public.unit_members where unit_id = ${q(S6)} and user_id = ${q(V.R2)}`))}
${chk('거절 뒤 바로 재요청 거절', 'err|request_cooldown', req('R2', TK, false))}
-- 재요청 대기 = 30분(사용자 결정 11-11 · 예전 10분). 요청 시각을 당겨 경계를 잰다.
update public.space_join_requests set created_at = now() - interval '20 minutes' where space_id = ${q(S6)} and user_id = ${q(V.R2)};
${chk('거절 뒤 20분이어도 재요청 거절(30분 대기)', 'err|request_cooldown', req('R2', TK, false))}
update public.space_join_requests set created_at = now() - interval '31 minutes' where space_id = ${q(S6)} and user_id = ${q(V.R2)};
${chk('거절 뒤 31분이면 재요청 됨', 'ok|true', req('R2', TK, false))}
${chk('R3 요청 됨', 'ok|true', req('R3', TK))}
delete from public.space_entry_allowlist where user_id = ${q(V.R3)};
${chk('요청한 사람 입구가 닫히면 수락 거절', 'err|space_closed', decide('P', 'R3', true))}
${chk('R4 가 공간 B 에 요청 됨', 'ok|true', req('R4', TKB))}
${chk('공간 B 주인 N 이 공간을 지움', 'ok|done', as('N', `select 'done' from public.delete_space(${q(S6B)})`, true))}
${chk('지운 공간 요청은 수락 거절', 'err|not_space_owner', decide('N', 'R4', true))}
${chk('지운 공간 링크로 요청 거절', 'err|link_closed', req('R2', TKB, false))}

-- 멤버 목록
${chk('멤버가 보는 멤버 목록(주인 먼저 · 이름과 역할만)', 'ok|4|space_owner', as('Q', `select count(*) || '|' || (array_agg(role))[1] from public.space_members(${q(S6)})`))}
${chk('멤버 목록 칸 = 번호·이름·역할·합류 시각(전화번호 없음)', 'TABLE(user_id uuid, name text, role text, joined_at timestamp with time zone)', svc(`select pg_get_function_result(to_regprocedure('public.space_members(text)'))`))}
${chk('멤버 아닌 사람 멤버 목록 거절', 'err|not_space_member', as('G', `select count(*)::text from public.space_members(${q(S6)})`))}
${chk('매장 X 사장이라도 남의 공간 목록은 멤버일 때만(T 는 멤버)', 'ok|4', as('T', `select count(*)::text from public.space_members(${q(S6)})`))}

-- 내보내기
${chk('멤버가 남을 내보내기 거절', 'err|not_space_owner', as('Q', `select 'done' from public.space_remove_member(${q(S6)}, ${q(V.R)})`))}
${chk('남의 공간 주인이 내보내기 거절', 'err|not_space_owner', as('N', `select 'done' from public.space_remove_member(${q(S6)}, ${q(V.R)})`))}
${chk('주인이 자기 자신 내보내기 거절', 'err|space_owner_cannot_leave', as('P', `select 'done' from public.space_remove_member(${q(S6)}, ${q(V.P)})`))}
${chk('멤버 아닌 사람 내보내기 거절', 'err|not_space_member', as('P', `select 'done' from public.space_remove_member(${q(S6)}, ${q(V.G)})`))}
${chk('(대조) 내보내기 전 R 이 공간에 들어감', 'ok|', as('R', `select public.enter_space(${q(S6)})::text`, true))}
${chk('(대조) 내보내기 전 R 현재 공간 = S6 · 노하우 읽기 1', `ok|${S6}|1`, as('R', `select coalesce(public.auth_space_id(), '<null>') || '|' || (select count(*) from public.playbook_entries where unit_id = ${q(S6)})`))}
${chk('주인이 R 을 내보냄', 'ok|done', as('P', `select 'done' from public.space_remove_member(${q(S6)}, ${q(V.R)})`, true))}
${chk('내보낸 뒤 R 현재 공간 기록 0', '0', svc(`select count(*) from public.session_active_spaces where user_id = ${q(V.R)}`))}
${chk('내보낸 뒤 R 현재 공간 비움', 'ok|<null>', as('R', `select coalesce(public.auth_space_id(), '<null>')`))}
${chk('내보낸 뒤 R 공간 노하우 읽기 0', 'ok|0', as('R', `select count(*)::text from public.playbook_entries where unit_id = ${q(S6)}`))}
${chk('내보낸 뒤 R 공간 들어가기 거절', 'err|not_a_member', as('R', `select public.enter_space(${q(S6)})::text`))}

-- 나가기
${chk('Q 가 공간에 들어감', 'ok|', as('Q', `select public.enter_space(${q(S6)})::text`, true))}
${chk('(대조) 나가기 전 Q 현재 공간 = S6 · 내 공간 1', `ok|${S6}|1`, as('Q', `select coalesce(public.auth_space_id(), '<null>') || '|' || (select count(*) from public.my_spaces())`))}
${chk('Q 가 나감', 'ok|done', as('Q', `select 'done' from public.leave_space(${q(S6)})`, true))}
${chk('나간 뒤 Q 현재 공간 비움', 'ok|<null>', as('Q', `select coalesce(public.auth_space_id(), '<null>')`))}
${chk('나간 뒤 Q 의 내 공간 0', 'ok|0', as('Q', 'select count(*)::text from public.my_spaces()'))}
${chk('다시 나가기 거절', 'err|not_space_member', as('Q', `select 'done' from public.leave_space(${q(S6)})`))}
${chk('주인 나가기 거절(공간 삭제로)', 'err|space_owner_cannot_leave', as('P', `select 'done' from public.leave_space(${q(S6)})`))}
${chk('멤버 아닌 사람 나가기 거절', 'err|not_space_member', as('G', `select 'done' from public.leave_space(${q(S6)})`))}
${chk('나간 뒤에도 무료 1개 계산 그대로: 주인 P 새 공간 거절', 'err|space_limit_reached', as('P', `select count(*)::text from public.create_space('QA둘째')`))}
${chk('나간 멤버 Q 는 자기 공간을 만들 수 있음', 'ok|1', as('Q', `select count(*)::text from public.create_space('QA큐공간')`))}
${chk('공간 S6 은 그대로(주인 1 · 멤버 T)', '1|1', svc(`select count(*) filter (where role = 'space_owner') || '|' || count(*) filter (where role = 'space_member') from public.unit_members where unit_id = ${q(S6)}`))}

select l from qa_out order by i;
rollback;
`;
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql4, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    check('4부 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|CONTEXT|LINE/.test(l)).slice(0, 8).join(' | '));
  } else {
    for (const l of r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|MEM|'))) {
      const [name, expect, got] = l.slice(7).split('¦');
      calls++; if (got.startsWith('err|')) rejected++;
      check(name, got === expect, got === expect ? '' : `기대 ${expect} · 실제 ${got}`);
    }
  }
}

runStoreAskChecks({ DB, check }); // 6번 덩이 매장 묻기 먼저(0520) · 별도 모듈

console.log(`\n최종: ${fail === 0 ? 'PASS' : 'FAIL'} · 통과 ${pass} · 실패 ${fail} · skip ${skip} · 부른 수 ${calls} · 거절 ${rejected} · AI 호출 0회`);
process.exit(fail === 0 ? 0 : 1);
