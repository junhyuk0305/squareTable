// qa-space-store-link.mjs — 매장과 연결하기(0490 · 공간·매장 통합 5번 덩이 서버) 검사. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나: 제안은 "그 공간 주인 + 받는 매장 직원·매니저"만 · 승인은 받는 매장의 현재 사장·매니저만 ·
//   승인하면 사본은 매장 행 · 원본은 그대로 · 거절하면 사본 0 · 보낸 뒤 원본을 고쳐도 보낸 때 내용으로 간다 ·
//   공간 사람이 매장 사본을 못 고친다 · 공간에서 온 제안은 앱이 직접 만들거나 고칠 수 없다.
// 방식: 한 트랜잭션 안에서 계정·매장 둘·공간 둘을 따로 심고(데모 매장을 안 쓴다) 끝에 rollback 한다 = 공유 로컬 DB 흔적 0.
//   호출은 authenticated 역할 + JWT 클레임(세션 번호 포함)으로 흉내 낸다. 매장·공간 현재 자리는 세션 표에 심는다.
// 로컬 전용(부르는 쪽이 --local 을 이미 확인한다). AI 호출 0회.
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function runStoreLinkChecks({ DB, check }) {
  console.log('\n[5] 매장과 연결하기(0490) · 제안·승인·거절');
  const rnd = Math.random().toString(16).slice(2, 10);
  const K = ['A', 'B', 'M', 'J', 'G', 'D', 'E'];
  // A 공간 주인 겸 매장 X 직원 · B 공간 주인(매장 없음) · M 공간 멤버 겸 X 직원 · J X 직원 · G X 매니저 · D X 사장 · E 매장 Y 사장
  const U = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-a${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-b${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const X = `qa_slx_${rnd}`, Y = `qa_sly_${rnd}`, SP = `qa_slsp_${rnd}`, SB = `qa_slsb_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const e = (n) => `qa_sle${n}_${rnd}`;
  // 호출 줄: name, uid 키, sql, 기대(err:<코드> 또는 정확한 값)
  const call = (name, who, body, expect) =>
    `select 'QA|SL|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.sl_do(${q(U[who])}, ${q(S[who])}, ${q(body)});`;
  const val = (name, body, expect) => `select 'QA|SL|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.sl_val(${q(body)});`;
  const prop = (ids) => `select string_agg(suggestion_id, ',') from public.propose_to_store(${q(SP)}, ${q(X)}, array[${ids.map(q).join(',')}]::text[])`;
  // 제안 번호는 호출 전에 서비스 권한으로 채운다(직원 세션은 남의 제안을 못 읽어 번호를 못 구한다 · RLS ps_select).
  const sugOf = (n) => `{SUG:${e(n)}}`;

  const sql = String.raw`
begin;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_sl_' || v.k || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${K.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${K.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);

insert into public.units(id, store_name, kind) values
  (${q(X)}, 'QA연결매장', 'store'), (${q(Y)}, 'QA다른매장', 'store'), (${q(SP)}, 'QA연결공간', 'space'), (${q(SB)}, 'QA남의공간', 'space');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.D)}, ${q(X)}, 'owner'), (${q(U.G)}, ${q(X)}, 'manager'), (${q(U.J)}, ${q(X)}, 'junior'),
  (${q(U.A)}, ${q(X)}, 'junior'), (${q(U.M)}, ${q(X)}, 'junior'), (${q(U.E)}, ${q(Y)}, 'owner'),
  (${q(U.A)}, ${q(SP)}, 'space_owner'), (${q(U.M)}, ${q(SP)}, 'space_member'), (${q(U.B)}, ${q(SB)}, 'space_owner');
-- 무료 좌석 상한(직원 2) 때문에 매니저가 잠기지 않게 네 명 모두 사장이 고른 좌석으로 둔다.
insert into public.unit_kept_seats(unit_id, user_id) values
  (${q(X)}, ${q(U.G)}), (${q(X)}, ${q(U.J)}), (${q(X)}, ${q(U.A)}), (${q(X)}, ${q(U.M)});
-- 현재 자리: 매장 사람은 자기 매장 · A 는 현재 매장 X + 현재 공간 SP · E 는 Y
insert into public.session_active_units(session_id, user_id, unit_id) values
  (${q(S.D)}, ${q(U.D)}, ${q(X)}), (${q(S.G)}, ${q(U.G)}, ${q(X)}), (${q(S.J)}, ${q(U.J)}, ${q(X)}),
  (${q(S.A)}, ${q(U.A)}, ${q(X)}), (${q(S.M)}, ${q(U.M)}, ${q(X)}), (${q(S.E)}, ${q(U.E)}, ${q(Y)});
insert into public.session_active_spaces(session_id, user_id, space_id) values
  (${q(S.A)}, ${q(U.A)}, ${q(SP)}), (${q(S.M)}, ${q(U.M)}, ${q(SP)}), (${q(S.B)}, ${q(U.B)}, ${q(SB)});

insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square, photos) values
  (${q(e(1))}, ${q(SP)}, '서비스', '연결 노하우 1', 'published', 'space_owner',
     '{"situation":"손님이 메뉴를 물을 때","action":{"steps":["인사한다","추천한다"]}}'::jsonb, array[${q(SP + '/p1.jpg')}]),
  (${q(e(2))}, ${q(SP)}, '서비스', '연결 노하우 2', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(3))}, ${q(SP)}, '서비스', '연결 노하우 3', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(4))}, ${q(SP)}, '서비스', '연결 초안', 'draft', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(5))}, ${q(SB)}, '서비스', '남의 공간 노하우', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(6))}, ${q(SP)}, '서비스', '연결 노하우 6', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(7))}, ${q(X)}, '서비스', '매장 노하우', 'published', 'owner', '{}'::jsonb, '{}'),
  (${q(e(8))}, ${q(SP)}, '서비스', '연결 노하우 8', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(9))}, ${q(SP)}, '서비스', '연결 노하우 9', 'published', 'space_owner', '{}'::jsonb, '{}');

-- {SUG:노하우번호} → 그 노하우로 매장 X 에 넣은 가장 최근 제안 번호(서비스 권한으로 찾는다).
create function pg_temp.sl_fill(p_sql text) returns text language plpgsql as $f$
declare m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{SUG:([^}]+)\}', 'g') loop
    select id into v from public.playbook_suggestions where source_entry_id = m[1] and unit_id = ${q(X)} order by created_at desc, id limit 1;
    p_sql := replace(p_sql, '{SUG:' || m[1] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  return p_sql;
end $f$;

-- 호출: 역할·클레임을 세우고 부른 뒤 역할을 되돌린다. 쓰기는 남는다(검사가 이어서 본다 · 끝에 전체 rollback).
create function pg_temp.sl_do(p_uid uuid, p_sid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  p_sql := pg_temp.sl_fill(p_sql);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  begin
    execute 'set local role authenticated';
    execute p_sql into r;
    execute 'reset role';
    return 'ok|' || coalesce(r, '<null>');
  exception when others then
    execute 'reset role';
    return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
  end;
end $f$;

-- 서비스 권한으로 읽는다(값 확인용 · 실패하면 err 로 남겨 다음 검사가 이어 돈다)
create function pg_temp.sl_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute pg_temp.sl_fill(p_sql) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
end $f$;

-- 기능 줄 꺼짐(기본)
${call('기능 꺼짐 → 보내기 거절', 'A', prop([e(1)]), 'err:feature_off')}
-- night-1111 sb(0580): 줄은 꺼진 채 허용 목록 계정만 열린다(공간 입구와 같은 목록 · 가결정 18)
${call('줄 꺼짐 · 허용 목록 밖 = 닫힘(my_connect_store_open)', 'A', `select public.my_connect_store_open()::text`, 'ok|false')}
insert into public.space_entry_allowlist(user_id, note) values (${q(U.A)}, 'qa_sl') on conflict do nothing;
${call('줄 꺼짐 · 허용 목록 안 = 열림(my_connect_store_open)', 'A', `select public.my_connect_store_open()::text`, 'ok|true')}
${call('줄 꺼짐 · 허용 목록 안 = 보내기 됨', 'A', prop([e(9)]), 'ok|' + '*')}
${call('줄 꺼짐 · 허용 목록 밖 공간 주인(B) = feature_off', 'B', `select count(*) from public.propose_to_store(${q(SB)}, ${q(X)}, array[${q(e(5))}])`, 'err:feature_off')}
${val('내부 판정 함수는 앱에서 못 부른다(anon·authenticated)', `select has_function_privilege('anon', 'public._connect_store_open_for(uuid)', 'execute') || '/' || has_function_privilege('authenticated', 'public._connect_store_open_for(uuid)', 'execute') || '/' || has_function_privilege('anon', 'public.my_connect_store_open()', 'execute')`, 'false/false/false')}
delete from public.space_entry_allowlist where user_id = ${q(U.A)};
delete from public.playbook_suggestions where source_entry_id = ${q(e(9))};
delete from public.member_notices where unit_id = ${q(X)} and kind = 'suggestion';
update public.unit_kind_features set enabled = true where kind = 'space' and feature = 'connect_store';

${call('공간 멤버(주인 아님)의 제안 거절', 'M', prop([e(1)]), 'err:not_space_owner')}
${call('남의 공간 주인의 제안 거절', 'B', prop([e(1)]), 'err:not_space_owner')}
${call('매장 멤버가 아닌 공간 주인 거절', 'B', `select count(*) from public.propose_to_store(${q(SB)}, ${q(X)}, array[${q(e(5))}])`, 'err:not_store_member')}
${call('멤버가 아닌 매장으로 보내기 거절', 'A', `select count(*) from public.propose_to_store(${q(SP)}, ${q(Y)}, array[${q(e(1))}])`, 'err:not_store_member')}
${call('고른 노하우 0개 거절', 'A', prop([]), 'err:no_entries')}
${call('초안 노하우 거절', 'A', prop([e(4)]), 'err:entry_not_found')}
${call('남의 공간 노하우 거절', 'A', prop([e(5)]), 'err:entry_not_found')}
${call('매장 노하우를 출처로 거절', 'A', prop([e(7)]), 'err:entry_not_found')}
${call('앱이 공간 제안을 직접 넣기 거절', 'A', `insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, text, source_unit_id, source_entry_id) values ('qa_slfake_${rnd}', ${q(X)}, 'from_space', auth.uid(), 'x', ${q(SP)}, ${q(e(1))}) returning id`, 'err:forbidden')}

${call('공간 주인 겸 매장 직원의 제안', 'A', `select count(*) from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(e(1))}, ${q(e(2))}])`, 'ok|2')}
${val('제안 행 = 매장 X · from_space · 대기 · 스냅샷 제목', `select string_agg(unit_id || '/' || kind || '/' || status || '/' || (source_snapshot ->> 'title'), ',' order by source_entry_id) from public.playbook_suggestions where source_unit_id = ${q(SP)}`, `${X}/from_space/pending/연결 노하우 1,${X}/from_space/pending/연결 노하우 2`)}
${val('옛 앱용 글 칸에 제목·상황·순서', `select (text like '연결 노하우 1%' and text like '%손님이 메뉴를 물을 때%' and text like '%1. 인사한다%')::text from public.playbook_suggestions where source_entry_id = ${q(e(1))}`, 'true')}
${val('사장 알림 1행(사장만 · 제목·본문)', `select string_agg(user_id::text || '/' || title || '/' || body, ',') from public.member_notices where unit_id = ${q(X)} and kind = 'suggestion'`, `${U.D}/QAA님의 노하우 제안/연결 노하우 1 외 1개`)}
${call('같은 노하우 다시 보내기 거절', 'A', prop([e(1)]), 'err:already_proposed')}
${call('제안자가 내용 고치기 거절(취소 뒤 다시 보낸다)', 'A', `select public.suggestion_edit(${sugOf(1)}, '{"text":"바꿈"}'::jsonb)::text`, 'err:from_space_locked')}
${call('사장이 스냅샷 고치기 거절', 'D', `with u as (update public.playbook_suggestions set source_snapshot = '{}'::jsonb where id = ${sugOf(1)} returning 1) select count(*) from u`, 'err:from_space_locked')}

${call('직원의 승인 거절', 'J', `select count(*) from public.approve_space_proposal(${sugOf(1)})`, 'err:not_manager')}
${call('공간 주인(매장 직원)의 승인 거절', 'A', `select count(*) from public.approve_space_proposal(${sugOf(1)})`, 'err:not_manager')}
${call('다른 매장 사장의 승인 거절', 'E', `select count(*) from public.approve_space_proposal(${sugOf(1)})`, 'err:suggestion_not_found')}
${call('공간에서 온 제안이 아닌 것 승인 거절', 'D', `select count(*) from public.approve_space_proposal('qa_none_${rnd}')`, 'err:suggestion_not_found')}

-- 보낸 뒤 원본을 고친다(서비스 권한) → 승인은 보낸 때 내용으로
update public.playbook_entries set title = '연결 노하우 1 고침', updated_at = now() where id = ${q(e(1))};
${call('사장 승인 → 사본 1개 · 원본 사진 경로를 돌려줌', 'D', `select entry_id like 'pb_%' and source_photos = array[${q(SP + '/p1.jpg')}] from public.approve_space_proposal(${sugOf(1)})`, 'ok|true')}
${val('사본 = 매장 X 행 · 보낸 때 제목 · 발행 · 작성자 사장 · 사진 비움', `select string_agg(e.unit_id || '/' || e.title || '/' || e.status || '/' || e.creator_role || '/' || e.creator_id || '/' || cardinality(e.photos), ',') from public.playbook_entries e join public.playbook_suggestions s on s.resulting_entry_id = e.id where s.id = ${sugOf(1)}`, `${X}/연결 노하우 1/published/owner/${U.D}/0`)}
-- night-1111 sb(0581): 사진 복사 판정·기록 함수(엣지 전용 · service_role 만). 여기서는 소유자 권한으로 부른다.
${val('사진 함수 둘은 앱에서 못 부른다 · service_role 은 부른다', `select string_agg(has_function_privilege(r, f, 'execute')::text, '/' order by f, r) from unnest(array['anon','authenticated','service_role']) r, unnest(array['public._proposal_photo_source(text, uuid)','public._set_proposal_photos(text, text[])']) f`, 'false/false/true/false/false/true')}
${call('앱 세션(사장)이 사진 기록 함수 부르기 = 권한 없음', 'D', `select public._set_proposal_photos(${sugOf(1)}, array[${q(X + '/c0.jpg')}])::text`, 'sqlstate:42501')}
${val('판정: 사장 = ok · 매장 X · 원본 경로 = 스냅샷의 공간 사진', `select (j ->> 'status') || '/' || (j ->> 'store') || '/' || (j -> 'paths')::text || '/' || (j -> 'existing')::text from public._proposal_photo_source(${sugOf(1)}, ${q(U.D)}) j`, `ok/${X}/["${SP}/p1.jpg"]/[]`)}
${val('판정: 매니저 = ok', `select public._proposal_photo_source(${sugOf(1)}, ${q(U.G)}) ->> 'status'`, 'ok')}
${val('판정: 직원 · 공간 주인(매장 직원) · 다른 매장 사장 · 없는 제안 = forbidden', `select string_agg(public._proposal_photo_source(x.s, x.u) ->> 'status', '/' order by x.o) from (values (1, ${sugOf(1)}, ${q(U.J)}::uuid), (2, ${sugOf(1)}, ${q(U.A)}::uuid), (3, ${sugOf(1)}, ${q(U.E)}::uuid), (4, 'qa_none_${rnd}', ${q(U.D)}::uuid)) x(o, s, u)`, 'forbidden/forbidden/forbidden/forbidden')}
${val('판정: 승인 전(대기) 제안 = not_ready', `select public._proposal_photo_source(${sugOf(2)}, ${q(U.D)}) ->> 'status'`, 'not_ready')}
${val('기록: 첫 폴더가 다른 매장 · 공간 · 상위 경로 = 거절', `select string_agg(pg_temp.sl_val('select public._set_proposal_photos(' || quote_literal(${sugOf(1)}) || ', array[' || quote_literal(p) || '])::text'), ' ; ' order by p) from unnest(array[${q(Y + '/a.jpg')}, ${q(SP + '/a.jpg')}, ${q(X + '/../a.jpg')}]) p`, 'err|P0001|invalid_argument ; err|P0001|invalid_argument ; err|P0001|invalid_argument')}
${val('기록: 대기 제안 = 거절', `select pg_temp.sl_val('select public._set_proposal_photos(' || quote_literal(${sugOf(2)}) || ', array[' || quote_literal(${q(X + '/a.jpg')}) || '])::text')`, 'err|P0001|invalid_argument')}
${val('기록: 매장 폴더 경로 = 채움', `select public._set_proposal_photos(${sugOf(1)}, array[${q(X + '/c1.jpg')}])::text`, `{${X}/c1.jpg}`)}
${val('기록: 두 번째 = 앞의 목록 그대로(한 번만)', `select public._set_proposal_photos(${sugOf(1)}, array[${q(X + '/c2.jpg')}])::text`, `{${X}/c1.jpg}`)}
${val('사본 노하우 사진 = 매장 폴더 1장', `select e.photos::text from public.playbook_entries e join public.playbook_suggestions s on s.resulting_entry_id = e.id where s.id = ${sugOf(1)}`, `{${X}/c1.jpg}`)}
${val('판정: 이미 사진 있음 = existing 에 실림', `select (public._proposal_photo_source(${sugOf(1)}, ${q(U.D)}) -> 'existing')::text`, `["${X}/c1.jpg"]`)}
${val('제안 = 승인됨 · 검토한 사람 사장',`select status || '/' || reviewed_by from public.playbook_suggestions where id = ${sugOf(1)}`, `approved/${U.D}`)}
${val('사본은 색인 대기', `select count(*) from public.playbook_embeddings b join public.playbook_suggestions s on s.resulting_entry_id = b.entry_id where s.id = ${sugOf(1)} and b.next_attempt_at is not null and b.unit_id = ${q(X)}`, '1')}
${val('원본은 공간에 그대로(고친 제목 · 보관 안 됨)', `select unit_id || '/' || title || '/' || (archived_at is null) from public.playbook_entries where id = ${q(e(1))}`, `${SP}/연결 노하우 1 고침/true`)}
${call('두 번 승인 거절', 'D', `select count(*) from public.approve_space_proposal(${sugOf(1)})`, 'err:suggestion_not_pending')}
${call('공간 주인이 매장 사본 고치기 0행', 'A', `with u as (update public.playbook_entries set title = '바꿈' where id = (select resulting_entry_id from public.playbook_suggestions where id = ${sugOf(1)}) returning 1) select count(*) from u`, 'ok|0')}
${call('공간 주인이 매장 사본을 다시 다른 데로 보내기 거절', 'A', `select count(*) from public.propose_to_store(${q(SP)}, ${q(X)}, array[(select resulting_entry_id from public.playbook_suggestions where id = ${sugOf(1)})])`, 'err:entry_not_found')}

-- 거절: 지금 반려 길(ps_update) 그대로
${call('사장 반려(지금 길)', 'D', `with u as (update public.playbook_suggestions set status = 'rejected', owner_note = '이번엔 안 받아요' where id = ${sugOf(2)} returning 1) select count(*) from u`, 'ok|1')}
${val('반려 뒤 매장 사본 0 · 원본 그대로', `select (select count(*) from public.playbook_entries where unit_id = ${q(X)} and title = '연결 노하우 2') || '/' || (select count(*) from public.playbook_entries where id = ${q(e(2))} and unit_id = ${q(SP)})`, '0/1')}
${call('반려 뒤 다시 보내기 = 새 제안', 'A', prop([e(2)]), 'ok|' + '*')}
${call('이미 반려한 제안 승인 거절', 'D', `select count(*) from public.approve_space_proposal((select id from public.playbook_suggestions where source_entry_id = ${q(e(2))} and status = 'rejected'))`, 'err:suggestion_not_pending')}

-- 매니저 승인 · 제안자 취소
${call('제안(노하우 3·6)', 'A', `select count(*) from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(e(3))}, ${q(e(6))}])`, 'ok|2')}
${call('매니저 승인', 'G', `select count(*) from public.approve_space_proposal(${sugOf(3)})`, 'ok|1')}
${val('매니저 승인 사본 작성자 역할 = manager', `select e.creator_role from public.playbook_entries e join public.playbook_suggestions s on s.resulting_entry_id = e.id where s.id = ${sugOf(3)}`, 'manager')}
${call('제안자 취소(0355 길)', 'A', `select public.suggestion_withdraw(${sugOf(6)})::text`, 'ok|')}
${val('취소한 제안은 보관 표로(원래 표 0)', `select (select count(*) from public.playbook_suggestions where source_entry_id = ${q(e(6))}) || '/' || (select count(*) from public.playbook_suggestions_withdrawn where unit_id = ${q(X)} and kind = 'from_space')`, '0/1')}
${val('취소한 공간 제안의 출처 칸 셋이 보관 표에 남음(0582)', `select source_unit_id || '/' || source_entry_id || '/' || (source_snapshot ->> 'title') from public.playbook_suggestions_withdrawn where unit_id = ${q(X)} and kind = 'from_space'`, `${SP}/${e(6)}/연결 노하우 6`)}

-- 옛 사장 앱 승인 길: 글로 초안을 만들어 직접 쓴 노하우로 status·결과 노하우만 바꾼다(가드가 막지 않아야 한다)
${call('제안(노하우 8)', 'A', prop([e(8)]), 'ok|' + '*')}
${call('옛 사장 앱 승인(status·resulting_entry_id 만 update)', 'D', `with u as (update public.playbook_suggestions set status = 'approved', resulting_entry_id = ${q(e(7))} where id = ${sugOf(8)} returning 1) select count(*) from u`, 'ok|1')}
${val('옛 앱 승인 = 승인됨 · 검토한 사람 사장(0319 도장)', `select status || '/' || reviewed_by from public.playbook_suggestions where id = ${sugOf(8)}`, `approved/${U.D}`)}
${call('51개 고르면 거절', 'A', `select count(*) from public.propose_to_store(${q(SP)}, ${q(X)}, (select array_agg('x' || g) from generate_series(1, 51) g))`, 'err:too_many_entries')}

-- 받는 매장 대기 공간 제안 상한 50(사용자 결정 11-11). 대기 수를 가짜 행으로 49 까지 채우고 2개 → 거절 · 1개 → 됨. 끝나면 지운다.
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square, photos) values
  (${q(e(11))}, ${q(SP)}, '서비스', '상한 노하우 11', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(e(12))}, ${q(SP)}, '서비스', '상한 노하우 12', 'published', 'space_owner', '{}'::jsonb, '{}');
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, text, status)
  select 'qa_slcap_' || g || '_${rnd}', ${q(X)}, 'from_space', ${q(U.A)}, 'x', 'pending'
    from generate_series(1, greatest(0, 49 - (select count(*) from public.playbook_suggestions
                                              where unit_id = ${q(X)} and kind = 'from_space' and status = 'pending'))) g;
${val('대기 공간 제안 49개로 채움', `select count(*) from public.playbook_suggestions where unit_id = ${q(X)} and kind = 'from_space' and status = 'pending'`, '49')}
${call('대기 49 + 2개 → 상한 거절', 'A', prop([e(11), e(12)]), 'err:too_many_pending')}
${call('대기 49 + 1개 → 됨(50)', 'A', prop([e(11)]), 'ok|' + '*')}
delete from public.playbook_suggestions where unit_id = ${q(X)} and (id like 'qa_slcap_%' or source_entry_id in (${q(e(11))}, ${q(e(12))}));

-- 공간 사람이 매장 제안 목록을 못 본다(M 은 X 직원 · 남의 제안)
${call('남의 제안 안 보임(매장 직원 M)', 'M', `select count(*) from public.playbook_suggestions where source_unit_id = ${q(SP)}`, 'ok|0')}

-- night-1111 sb(0582): 질문이 해결되면 그 질문의 다른 대기 제안을 반려(메모)로 정리한다. 답은 사장 세션의 실제 길(save_unknown_answer).
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into public.unknown_queries(id, unit_id, junior_id, junior_name, query_text) values
  ('qa_sluq1_${rnd}', ${q(X)}, ${q(U.J)}, 'QAJ', '정리 질문 1'),
  ('qa_sluq2_${rnd}', ${q(X)}, ${q(U.J)}, 'QAJ', '정리 질문 2'),
  ('qa_sluq3_${rnd}', ${q(X)}, ${q(U.J)}, 'QAJ', '정리 질문 3');
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_uq_id) values
  ('qa_slc1j_${rnd}', ${q(X)}, 'new', ${q(U.J)}, 'QAJ', 'J 답 1', 'pending', 'qa_sluq1_${rnd}'),
  ('qa_slc1m_${rnd}', ${q(X)}, 'new', ${q(U.M)}, 'QAM', 'M 답 1', 'pending', 'qa_sluq1_${rnd}'),
  ('qa_slc2j_${rnd}', ${q(X)}, 'new', ${q(U.J)}, 'QAJ', 'J 답 2', 'pending', 'qa_sluq2_${rnd}'),
  ('qa_slc2m_${rnd}', ${q(X)}, 'new', ${q(U.M)}, 'QAM', 'M 답 2', 'pending', 'qa_sluq2_${rnd}'),
  ('qa_slc3j_${rnd}', ${q(X)}, 'new', ${q(U.J)}, 'QAJ', 'J 답 3', 'pending', 'qa_sluq3_${rnd}'),
  ('qa_slc3s_${rnd}', ${q(X)}, 'from_space', ${q(U.A)}, 'QAA', '공간 제안', 'pending', 'qa_sluq3_${rnd}');
${call('사장 직접 답(질문 1)', 'D', `select public.save_unknown_answer('qa_sluq1_${rnd}', '{"id":"qa_slans1_${rnd}","title":"정리 답 1","category":"서비스"}'::jsonb, null)`, `ok|qa_slans1_${rnd}`)}
${val('직접 답 → 그 질문의 대기 제안 전부 반려 · 메모 · 검토한 사람 비움', `select string_agg(status || '/' || coalesce(owner_note, '-') || '/' || coalesce(reviewed_by::text, '-') || '/' || (reviewed_at is not null), ',' order by id) from public.playbook_suggestions where source_uq_id = 'qa_sluq1_${rnd}'`, 'rejected/다른 답으로 해결된 질문이에요./-/true,rejected/다른 답으로 해결된 질문이에요./-/true')}
${call('사장이 J 제안으로 승인 답(질문 2)', 'D', `select public.save_unknown_answer('qa_sluq2_${rnd}', '{"id":"qa_slans2_${rnd}","title":"정리 답 2","category":"서비스"}'::jsonb, 'qa_slc2j_${rnd}')`, `ok|qa_slans2_${rnd}`)}
${val('승인 답 → 답 쓴 사람(J) 제안은 대기 그대로 · M 제안만 반려', `select string_agg(proposer_name || '/' || status, ',' order by id) from public.playbook_suggestions where source_uq_id = 'qa_sluq2_${rnd}'`, 'QAJ/pending,QAM/rejected')}
${call('승인 흐름이 J 제안을 승인으로(지금 앱 길 reviewSuggestion)', 'D', `with u as (update public.playbook_suggestions set status = 'approved', resulting_entry_id = 'qa_slans2_${rnd}' where id = 'qa_slc2j_${rnd}' returning 1) select count(*) from u`, 'ok|1')}
${call('기각(질문 3 · 지금 앱 길 status 만)', 'D', `with u as (update public.unknown_queries set status = 'dismissed' where id = 'qa_sluq3_${rnd}' returning 1) select count(*) from u`, 'ok|1')}
${val('기각 → 직원 제안 반려 · 공간 제안(from_space)은 대상 아님', `select string_agg(kind || '/' || status, ',' order by id) from public.playbook_suggestions where source_uq_id = 'qa_sluq3_${rnd}'`, 'new/rejected,from_space/pending')}
-- 대기가 아닌 질문의 상태가 또 바뀌어도(해결 → 보관) 새로 걸린 대기 제안은 건드리지 않는다
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_uq_id) values
  ('qa_slc1x_${rnd}', ${q(X)}, 'new', ${q(U.J)}, 'QAJ', 'J 늦은 답', 'pending', 'qa_sluq1_${rnd}');
update public.unknown_queries set status = 'archived' where id = 'qa_sluq1_${rnd}';
${val('대기가 아니던 질문의 상태 변경 = 정리 안 함', `select status from public.playbook_suggestions where id = 'qa_slc1x_${rnd}'`, 'pending')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('연결 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
  } else {
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|SL|'));
    // 줄이 통째로 빠져도 통과하지 않게 기대 줄 수를 센다(SQL 의 call·val 줄 수와 같다).
    const expected = (sql.match(/'QA\|SL\|'/g) ?? []).length;
    check(`연결 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
    for (const l of lines) {
      const [name, expect, got] = l.slice(6).split('¦');
      let ok;
      // 오류는 코드 낱말이 정확히 같아야 한다(err|SQLSTATE|코드 …). 부분 일치로 다른 코드가 통과하지 않게.
      if (expect.startsWith('err:')) ok = got.startsWith('err|P0001|') && got.slice(10).split(/[\s:]/)[0] === expect.slice(4);
      else if (expect.startsWith('sqlstate:')) ok = got.startsWith(`err|${expect.slice(9)}|`);
      else if (expect.endsWith('*')) ok = got.startsWith(expect.slice(0, -1)) && !got.startsWith('err|') && got !== 'ok|<null>';
      else ok = got === expect;
      check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
    }
  }
  runStoreLinkRaceChecks({ DB, check });   // night-1111 sb
  runPhotoCopyEdgeChecks({ check });       // night-1111 sb
}

// ════════════════════════════════════════════════════════════════════════════
// night-1111 sb · 동시 실행 검사 — 두 세션을 정말로 겹쳐 돌린다(트랜잭션 하나로는 못 잰다).
// ════════════════════════════════════════════════════════════════════════════
// 방식: 계정·매장·공간을 커밋으로 심고(이름에 난수) · 컨테이너 안에서 psql 두 개를 0.3초 차이로 띄운다.
//   앞 세션은 부른 뒤 1.5초 쉬고 커밋한다 → 뒤 세션은 잠금(매장 단위 advisory · 제안 행 for update · 고유 색인)에서 기다렸다가 결과를 본다.
//   끝나면 심은 것을 전부 지우고 남은 행이 0인지 센다(공유 로컬 DB 흔적 0).
//   매장과 연결하기 줄은 켜지 않는다(전역 값이라 다른 하니스에 샌다) → 공간 주인을 허용 목록에 넣었다가 뺀다.
function runStoreLinkRaceChecks({ DB, check }) {
  console.log('\n[5-2] 매장과 연결하기 · 동시 제안·동시 승인(두 세션)');
  const rnd = Math.random().toString(16).slice(2, 10);
  const K = ['A', 'D', 'G'];   // A 공간 주인 겸 매장 직원 · D 사장 · G 매니저
  const U = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-c${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-d${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const X = `qa_rcx_${rnd}`, SP = `qa_rcsp_${rnd}`, E1 = `qa_rce1_${rnd}`, E2 = `qa_rce2_${rnd}`, SG = `qa_rcsug_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const psqlRun = (input) => spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input, encoding: 'utf8', timeout: 60_000 });
  const as = (k) => `select set_config('request.jwt.claims', json_build_object('sub', ${q(U[k])}, 'role', 'authenticated', 'session_id', ${q(S[k])})::text, false);
select set_config('request.jwt.claim.sub', ${q(U[k])}, false);
set role authenticated;`;
  const cleanup = `
delete from public.space_entry_allowlist where user_id in (${K.map((k) => q(U[k])).join(',')});
delete from public.playbook_embeddings where unit_id = ${q(X)};
delete from public.member_notices where unit_id in (${q(X)}, ${q(SP)});
delete from public.playbook_suggestions where unit_id = ${q(X)};
delete from public.playbook_entries where unit_id in (${q(X)}, ${q(SP)});
delete from public.session_active_units where unit_id = ${q(X)};
delete from public.session_active_spaces where space_id = ${q(SP)};
delete from public.unit_kept_seats where unit_id = ${q(X)};
delete from public.unit_members where unit_id in (${q(X)}, ${q(SP)});
delete from public.units where id in (${q(X)}, ${q(SP)});
delete from auth.sessions where user_id in (${K.map((k) => q(U[k])).join(',')});
delete from auth.users where id in (${K.map((k) => q(U[k])).join(',')});`;
  const seed = `begin;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_rc_' || v.k || '_${rnd}@example.com',
       jsonb_build_object('name', 'QR' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${K.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${K.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
insert into public.units(id, store_name, kind) values (${q(X)}, 'QA동시매장', 'store'), (${q(SP)}, 'QA동시공간', 'space');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.D)}, ${q(X)}, 'owner'), (${q(U.G)}, ${q(X)}, 'manager'), (${q(U.A)}, ${q(X)}, 'junior'), (${q(U.A)}, ${q(SP)}, 'space_owner');
insert into public.unit_kept_seats(unit_id, user_id) values (${q(X)}, ${q(U.G)}), (${q(X)}, ${q(U.A)});
insert into public.session_active_units(session_id, user_id, unit_id) values
  (${q(S.D)}, ${q(U.D)}, ${q(X)}), (${q(S.G)}, ${q(U.G)}, ${q(X)}), (${q(S.A)}, ${q(U.A)}, ${q(X)});
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(S.A)}, ${q(U.A)}, ${q(SP)});
insert into public.space_entry_allowlist(user_id, note) values (${q(U.A)}, 'qa_rc');
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square, photos) values
  (${q(E1)}, ${q(SP)}, '서비스', '동시 노하우 1', 'published', 'space_owner', '{}'::jsonb, '{}'),
  (${q(E2)}, ${q(SP)}, '서비스', '동시 노하우 2', 'published', 'space_owner', '{}'::jsonb, '{}');
-- 동시 승인용 대기 제안(보낸 모양 그대로 · 서비스 권한으로 넣는다)
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_unit_id, source_entry_id, source_snapshot)
values (${q(SG)}, ${q(X)}, 'from_space', ${q(U.A)}, 'QRA', '동시 노하우 2', 'pending', ${q(SP)}, ${q(E2)},
        jsonb_build_object('title', '동시 노하우 2', 'category', '서비스', 'photos', '[]'::jsonb));
commit;`;
  // 두 세션 SQL. 앞 세션은 1.5초 쥐고 커밋한다. 결과는 R| 줄(성공) 또는 ERROR 줄(실패 코드)로 나온다.
  const session = (k, body, hold) => `${as(k)}
begin;
select 'R|' || coalesce((${body})::text, '<null>');
${hold ? 'select pg_sleep(1.5);' : ''}
commit;`;
  const twoAtOnce = (a, b) => {
    const tag = `${rnd}_${Math.random().toString(16).slice(2, 6)}`;
    for (const [n, s] of [['a', a], ['b', b]]) {
      const w = spawnSync('docker', ['exec', '-i', DB, 'sh', '-c', `cat > /tmp/qa_rc_${tag}_${n}.sql`], { input: s, encoding: 'utf8' });
      if (w.status !== 0) return null;
    }
    const sh = `cd /tmp; psql -U postgres -tA -q -f qa_rc_${tag}_a.sql > qa_rc_${tag}_a.out 2>&1 & sleep 0.3; `
      + `psql -U postgres -tA -q -f qa_rc_${tag}_b.sql > qa_rc_${tag}_b.out 2>&1 & wait; `
      + `cat qa_rc_${tag}_a.out; echo '=====QA====='; cat qa_rc_${tag}_b.out; rm -f qa_rc_${tag}_*`;
    const r = spawnSync('docker', ['exec', DB, 'sh', '-c', sh], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) return null;
    const [oa, ob] = r.stdout.split('=====QA=====');
    const res = (o) => {
      const ok = (o ?? '').split(/\r?\n/).find((l) => l.startsWith('R|'));
      if (ok) return `ok|${ok.slice(2)}`;
      const m = (o ?? '').match(/ERROR:\s+([a-z_]+)/);
      return m ? `err|${m[1]}` : `?|${(o ?? '').trim().slice(0, 80)}`;
    };
    return [res(oa), res(ob)];
  };
  const val = (body) => (psqlRun(body).stdout ?? '').trim();

  const s0 = psqlRun(cleanup + '\n' + seed);
  if (s0.status !== 0) {
    check('동시 검사 셋업', false, (s0.stderr || '').split('\n').filter((l) => /ERROR|DETAIL/.test(l)).slice(0, 3).join(' | '));
    psqlRun(cleanup);
    return;
  }
  try {
    // ① 같은 노하우를 같은 매장에 두 세션이 동시에 보낸다 → 하나만 대기 · 다른 하나 = already_proposed
    const prop = `(select string_agg(suggestion_id, ',') from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(E1)}]))`;
    const p = twoAtOnce(session('A', prop, true), session('A', prop, false));
    check('동시 제안 두 번: 앞 = 됨 · 뒤 = already_proposed', !!p && p[0].startsWith('ok|sug_') && p[1] === 'err|already_proposed', p ? p.join(' · ') : '실행 실패');
    check('동시 제안 뒤 대기 제안 = 1', val(`select count(*) from public.playbook_suggestions where unit_id = ${q(X)} and source_entry_id = ${q(E1)} and status = 'pending';`) === '1');
    check('동시 제안 뒤 사장 알림 = 1', val(`select count(*) from public.member_notices where unit_id = ${q(X)} and kind = 'suggestion';`) === '1');

    // ② 같은 제안을 사장·매니저가 동시에 승인한다 → 하나만 approved · 사본 1 · 다른 하나 = suggestion_not_pending
    const appr = `(select entry_id from public.approve_space_proposal(${q(SG)}))`;
    const a = twoAtOnce(session('D', appr, true), session('G', appr, false));
    check('동시 승인 두 번: 앞 = 됨 · 뒤 = suggestion_not_pending', !!a && a[0].startsWith('ok|pb_') && a[1] === 'err|suggestion_not_pending', a ? a.join(' · ') : '실행 실패');
    check('동시 승인 뒤 제안 = 승인됨 · 검토한 사람 사장', val(`select status || '/' || reviewed_by from public.playbook_suggestions where id = ${q(SG)};`) === `approved/${U.D}`);
    check('동시 승인 뒤 매장 사본 = 1', val(`select count(*) from public.playbook_entries where unit_id = ${q(X)} and title = '동시 노하우 2';`) === '1');
  } finally {
    psqlRun(cleanup);
    const left = val(`select (select count(*) from public.units where id in (${q(X)}, ${q(SP)})) + (select count(*) from auth.users where id in (${K.map((k) => q(U[k])).join(',')})) + (select count(*) from public.playbook_suggestions where unit_id = ${q(X)}) + (select count(*) from public.space_entry_allowlist where note = 'qa_rc');`);
    check('동시 검사 정리 = 남은 행 0', left === '0', left === '0' ? '' : `남은 ${left}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// night-1111 sb · 사진 복사 엣지(knowhow-photo-copy) — 로컬 엣지가 떠 있을 때만 돈다. 아니면 skip n.
// ════════════════════════════════════════════════════════════════════════════
// 실세션(매직링크)으로 실제 엣지를 부른다. 이 모듈 함수는 동기라 같은 파일을 자식 프로세스로 띄워 비동기 검사를 돌린다.
// 띄우는 법: st-db 슬롯에서 `npx -y supabase@2 functions serve --env-file <스크래치>` (verify_jwt 는 config.toml 값).
const PHOTO_EDGE_CASES = 12;   // 아래 childPhotoEdge 의 검사 줄 수(엣지가 없으면 이 수만큼 skip 으로 적는다)

function runPhotoCopyEdgeChecks({ check }) {
  console.log('\n[5-3] 사진 복사 엣지(knowhow-photo-copy · 실세션)');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--photo-edge-child'], { encoding: 'utf8', timeout: 240_000 });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('QE|'));
  const skip = lines.find((l) => l.startsWith('QE|skip|'));
  if (skip) {
    const [, , n, why] = skip.split('|');
    console.log(`  - skip ${n} (${why})`);
    return;
  }
  if (lines.length === 0) {
    check('사진 엣지 검사 실행', false, (r.stderr || r.error?.message || '').split('\n').slice(0, 3).join(' | '));
    return;
  }
  const results = lines.filter((l) => l.startsWith('QE|ok|') || l.startsWith('QE|no|'));
  check(`사진 엣지 검사 줄 수 ${results.length}/${PHOTO_EDGE_CASES}`, results.length === PHOTO_EDGE_CASES);
  for (const l of results) {
    const [, okv, name, extra = ''] = l.split('|');
    check(name, okv === 'ok', extra);
  }
}

async function childPhotoEdge() {
  const out = (ok, name, extra = '') => console.log(`QE|${ok ? 'ok' : 'no'}|${name}|${String(extra).replace(/[|\r\n]/g, ' ').slice(0, 200)}`);
  const skipAll = (why) => console.log(`QE|skip|${PHOTO_EDGE_CASES}|${why}`);
  const { createClient } = await import('@supabase/supabase-js');
  let st;
  try {
    st = Object.fromEntries(execFileSync('npx', ['-y', 'supabase@2', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 })
      .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch { return skipAll('로컬 supabase status 실패'); }
  const URL_ = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY;
  if (!URL_ || !/^http:\/\/127\.0\.0\.1:/.test(URL_) || !ANON || !SRV) return skipAll('로컬 도커 주소·키가 아님');
  const EP = `${URL_}/functions/v1/knowhow-photo-copy`;
  const callEdge = async (token, body) => {
    try {
      const res = await fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      return { status: res.status, body: j };
    } catch (e) { return { status: 0, body: { error: e.message } }; }
  };
  // 엣지가 떠 있는지: anon 키 토큰 → 함수가 사람을 못 찾아 401 { error: 'unauthorized' }
  const probe = await callEdge(ANON, { suggestionId: 'sug_probe' });
  if (!(probe.status === 401 && probe.body?.error === 'unauthorized')) return skipAll(`엣지가 안 떠 있음(status ${probe.status})`);

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(URL_, SRV, opts);
  const BUCKET = 'playbook-photos';
  const rnd = Math.random().toString(16).slice(2, 10);
  const X = `qa_pex_${rnd}`, Y = `qa_pey_${rnd}`, SP = `qa_pesp_${rnd}`;
  const made = { users: [], files: [] };
  const who = {};
  const mkUser = async (k) => {
    const email = `qa_pe_${k}_${rnd}@example.com`;
    const { data: cu, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name: `QP${k}`, role: 'junior', birth_date: '1994-03-03' } });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    made.users.push(cu.user.id);
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (le) throw new Error(`generateLink ${k}: ${le.message}`);
    const c = createClient(URL_, ANON, opts);
    const { data: v, error: ve } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
    if (ve) throw new Error(`verifyOtp ${k}: ${ve.message}`);
    who[k] = { id: cu.user.id, token: v.session.access_token };
  };
  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r; };
  try {
    for (const k of ['A', 'D', 'G', 'J', 'E']) await mkUser(k);
    must(await admin.from('units').insert([
      { id: X, store_name: 'QA사진매장', kind: 'store' }, { id: Y, store_name: 'QA사진다른매장', kind: 'store' }, { id: SP, store_name: 'QA사진공간', kind: 'space' }]), 'units');
    must(await admin.from('unit_members').insert([
      { user_id: who.D.id, unit_id: X, role: 'owner' }, { user_id: who.G.id, unit_id: X, role: 'manager' },
      { user_id: who.J.id, unit_id: X, role: 'junior' }, { user_id: who.A.id, unit_id: X, role: 'junior' },
      { user_id: who.E.id, unit_id: Y, role: 'owner' }, { user_id: who.A.id, unit_id: SP, role: 'space_owner' }]), 'unit_members');
    // 원본 사진(공간 폴더). p2 는 올렸다가 지운다 = "그사이 지워진 원본".
    for (const n of ['p1', 'p2', 'p4']) {
      const path = `${SP}/${n}.jpg`;
      must(await admin.storage.from(BUCKET).upload(path, Buffer.from(`qa-${n}`), { contentType: 'image/jpeg' }), `upload ${n}`);
      made.files.push(path);
    }
    must(await admin.storage.from(BUCKET).remove([`${SP}/p2.jpg`]), 'remove p2');
    const entry = (id) => ({ id, unit_id: X, category: '서비스', title: `QA사진 ${id}`, status: 'published', creator_role: 'owner', square: {}, photos: [] });
    const E1 = `qa_pee1_${rnd}`, E2 = `qa_pee2_${rnd}`;
    must(await admin.from('playbook_entries').insert([entry(E1), entry(E2)]), 'entries');
    const snap = (photos) => ({ title: 'QA사진', category: '서비스', photos });
    const SA = `qa_pesa_${rnd}`, SPN = `qa_pesn_${rnd}`, SGM = `qa_pesg_${rnd}`;
    must(await admin.from('playbook_suggestions').insert([
      { id: SA, unit_id: X, kind: 'from_space', proposer_id: who.A.id, proposer_name: 'QPA', text: 'x', status: 'approved', resulting_entry_id: E1, reviewed_by: who.D.id,
        source_unit_id: SP, source_entry_id: 'src1', source_snapshot: snap([`${SP}/p1.jpg`, `${SP}/p2.jpg`, `${Y}/p3.jpg`]) },
      { id: SPN, unit_id: X, kind: 'from_space', proposer_id: who.A.id, proposer_name: 'QPA', text: 'x', status: 'pending',
        source_unit_id: SP, source_entry_id: 'src2', source_snapshot: snap([`${SP}/p1.jpg`]) },
      // 매니저가 자기가 보낸 제안을 자기가 승인한 행(결정 193)
      { id: SGM, unit_id: X, kind: 'from_space', proposer_id: who.G.id, proposer_name: 'QPG', text: 'x', status: 'approved', resulting_entry_id: E2, reviewed_by: who.G.id,
        source_unit_id: SP, source_entry_id: 'src3', source_snapshot: snap([`${SP}/p4.jpg`]) }]), 'suggestions');

    const r1 = await callEdge(ANON, { suggestionId: SA });
    out(r1.status === 401, 'anon 키 = 401', r1.status);
    const r2 = await callEdge(who.E.token, { suggestionId: SA });
    out(r2.status === 403, '다른 매장 사장 = 403', r2.status);
    const r3 = await callEdge(who.J.token, { suggestionId: SA });
    out(r3.status === 403, '같은 매장 직원 = 403', r3.status);
    const r3b = await callEdge(who.A.token, { suggestionId: SA });
    out(r3b.status === 403, '보낸 공간 주인(매장 직원) = 403', r3b.status);
    const r4 = await callEdge(who.D.token, { suggestionId: SPN });
    out(r4.status === 409, '승인 전 제안 = 409', r4.status);
    const r4b = await callEdge(who.D.token, '{"suggestionId":"../x"}');
    out(r4b.status === 400, '이상한 번호 = 400', r4b.status);
    const r5 = await callEdge(who.D.token, { suggestionId: SA });
    const p5 = r5.body?.photos ?? [];
    out(r5.status === 200 && p5.length === 1 && r5.body?.skipped === 1, '사장 = 200 · 남은 원본 1장 복사 · 지워진 1장 skipped(다른 폴더 경로는 대상 아님)', JSON.stringify(r5.body));
    made.files.push(...p5);
    out(p5.length === 1 && p5[0].startsWith(`${X}/`) && /^[^/]+\/\d+-\d+\.jpg$/.test(p5[0]), '사본 경로 첫 폴더 = 매장 · {ts}-{rand}.jpg', p5[0]);
    const dl = p5[0] ? await admin.storage.from(BUCKET).download(p5[0]) : { error: { message: 'no path' } };
    out(!dl.error && (await dl.data.text()) === 'qa-p1', '사본 파일 내용 = 원본 p1', dl.error?.message ?? '');
    const r6 = await callEdge(who.D.token, { suggestionId: SA });
    out(r6.status === 200 && JSON.stringify(r6.body?.photos) === JSON.stringify(p5) && r6.body?.skipped === 0, '두 번 불러도 사진 그대로(한 번만)', JSON.stringify(r6.body));
    const { data: e1 } = await admin.from('playbook_entries').select('photos').eq('id', E1).maybeSingle();
    out(JSON.stringify(e1?.photos ?? null) === JSON.stringify(p5), '사본 노하우 photos = 응답 경로', JSON.stringify(e1?.photos));
    const r7 = await callEdge(who.G.token, { suggestionId: SGM });
    made.files.push(...(r7.body?.photos ?? []));
    out(r7.status === 200 && (r7.body?.photos ?? []).length === 1, '매니저가 자기 제안 승인 = 200 · 1장', JSON.stringify(r7.body));
  } catch (e) {
    console.log(`QE|no|사진 엣지 셋업|${String(e.message).replace(/[|\r\n]/g, ' ').slice(0, 200)}`);
  } finally {
    // 정리: 파일 · 행 · 계정. 매장·공간 폴더에 남은 파일도 목록으로 지운다.
    for (const folder of [X, SP]) {
      const { data: ls } = await admin.storage.from(BUCKET).list(folder, { limit: 100 });
      for (const f of ls ?? []) made.files.push(`${folder}/${f.name}`);
    }
    if (made.files.length) await admin.storage.from(BUCKET).remove([...new Set(made.files)]);
    await admin.from('playbook_suggestions').delete().eq('unit_id', X);
    await admin.from('playbook_entries').delete().eq('unit_id', X);
    await admin.from('unit_members').delete().in('unit_id', [X, Y, SP]);
    await admin.from('units').delete().in('id', [X, Y, SP]);
    for (const id of made.users) await admin.auth.admin.deleteUser(id);
  }
}

if (process.argv.includes('--photo-edge-child')) {
  await childPhotoEdge();
}
