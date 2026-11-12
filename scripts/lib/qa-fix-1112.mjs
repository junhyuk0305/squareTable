// qa-fix-1112.mjs — 11-12 결함 수정(서버 · 0583~) 검사. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나(지시서 3절 번호):
//   2  space_question_send · space_my_questions = 탈퇴(정지) 계정 거절(not_authenticated).
//   13 edu_link_claim_code · edu_link_claim_guest · edu_link_me_key = 탈퇴 계정 거절 · my_edu_links = 0행.
//   3  링크 만든 사람이 매장을 떠나면(내보내기 remove_staff · 나가기 leave_store · 탈퇴 delete_my_account · 공간 삭제) 그 링크가 닫히고
//      손님 열기가 닫힘으로 바뀐다. 매니저 → 직원 강등은 안 닫는다. 남의 링크는 그대로다.
//   4  손님 행이 없는 열쇠(없음 · 틀림)로는 이어받기 코드를 안 낸다(handoff_needs_question). 손님 있는 열쇠는 그대로 낸다.
//   6  사진을 한 번 적은 제안은 사장이 사진을 다 지운 뒤 다시 불러도 안 적는다 · 복사할 경로도 비운다.
//   8  edu_link_answers 맨 뒤 칸 uq_id = 보낸 질문의 답할 질문 번호(안 보냈으면 null).
//   9  propose_to_store already_proposed 의 detail = 이미 대기인 공간 노하우 번호(쉼표 · 번호 순).
//   17 무료 모드에서 다 찬 매장: 직원 예약(p_guest=false) = 됨 · 손님 예약(p_guest=true) = 안 됨.
// 방식: 한 트랜잭션 안에서 심고 끝에 rollback(공유 로컬 DB 흔적 0). 역할과 JWT 클레임을 흉내 낸다.
//   err 결과는 'err|SQLSTATE|메시지|detail' 로 돌려 detail 까지 잰다.
// 로컬 전용(부르는 쪽이 --local 을 확인한다). AI 호출 0회.
import { spawnSync } from 'node:child_process';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function runFix1112Checks({ DB, check }) {
  console.log('\n[fx] 11-12 결함 수정 서버(0583~ · 계정 확인 · 나가면 링크 닫기 · 이어받기 · 사진 한 번 · uq_id · 대기 번호 · 손님 한도)');
  const rnd = Math.random().toString(16).slice(2, 10);
  // O 매장 X 사장 · K 내보낼 매니저 · L 나갈 매니저 · Z 탈퇴할 매니저 · G 강등될 매니저 · H 남는 매니저(대조군)
  // SO 공간 SP 주인(매장 X 직원 · 제안 보냄) · SM SP 멤버 · DM 탈퇴 표시된 SP 멤버 · DO 지울 공간 SD 주인
  const KS = ['O', 'K', 'L', 'Z', 'G', 'H', 'SO', 'SM', 'DM', 'DO'];
  const U = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-e${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-f${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const X = `qa_fxx_${rnd}`, SP = `qa_fxsp_${rnd}`, SD = `qa_fxsd_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const lk = (k) => `qa_fxl${k.toLowerCase()}_${rnd}`;
  const tk = (k) => `qa_fxtok${k.toLowerCase()}_${rnd}_aaaaaaaaaaaa`;
  const LINKS = ['K', 'L', 'Z', 'G', 'H', 'SO', 'DO'];
  const E1 = `qa_fxe1_${rnd}`, E2 = `qa_fxe2_${rnd}`, E3 = `qa_fxe3_${rnd}`, EP = `qa_fxep_${rnd}`, SA = `qa_fxsa_${rnd}`;
  const M_ = `to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')`;

  const call = (name, who, role, body, expect, put = '') =>
    `select 'QA|FX|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.fx_do(${who ? q(U[who]) + '::uuid' : 'null'}, ${who ? q(S[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(body)}, ${q(put)});`;
  const val = (name, body, expect) => `select 'QA|FX|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.fx_val(${q(body)});`;
  const closed = (k) => `select (closed_at is not null)::text from public.edu_links where id = ${q(lk(k))}`;
  const open = (k) => `select ok::text from public.edu_link_open(${q(tk(k))})`;
  const ask = (k, key, name, text) => `select coalesce(guest_key, '-') || '|' || cq_id from public.edu_link_ask(${q(tk(k))}, ${key}, ${q(name)}, ${q(text)})`;

  const sql = String.raw`
begin;
create temp table fx_v(k text primary key, v text);
grant select on fx_v to anon, authenticated, service_role;
insert into public.app_config(key, value) values ('billing_free_mode', 'true') on conflict (key) do update set value = excluded.value;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_fx_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${KS.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${KS.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
-- 번호 인증 면제(컷오프 이전 계정)
update public.profiles set created_at = '2020-01-01' where id in (${KS.map((k) => q(U[k])).join(', ')});
insert into public.units(id, store_name, kind) values (${q(X)}, 'QA수정매장', 'store'), (${q(SP)}, 'QA수정공간', 'space'), (${q(SD)}, 'QA수정지울공간', 'space');
update public.units set owner_id = ${q(U.O)} where id = ${q(X)};   -- remove_staff 는 매장 주인 칸을 본다
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.O)}, ${q(X)}, 'owner'), (${q(U.K)}, ${q(X)}, 'manager'), (${q(U.L)}, ${q(X)}, 'manager'), (${q(U.Z)}, ${q(X)}, 'manager'),
  (${q(U.G)}, ${q(X)}, 'manager'), (${q(U.H)}, ${q(X)}, 'manager'), (${q(U.SO)}, ${q(X)}, 'junior'),
  (${q(U.SO)}, ${q(SP)}, 'space_owner'), (${q(U.SM)}, ${q(SP)}, 'space_member'), (${q(U.DM)}, ${q(SP)}, 'space_member'),
  (${q(U.DO)}, ${q(SD)}, 'space_owner');
insert into public.session_active_units(session_id, user_id, unit_id) values
  ${['O', 'K', 'L', 'Z', 'G', 'H'].map((k) => `(${q(S[k])}, ${q(U[k])}, ${q(X)})`).join(', ')};
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(S.SM)}, ${q(U.SM)}, ${q(SP)}), (${q(S.DM)}, ${q(U.DM)}, ${q(SP)});
insert into public.space_entry_allowlist(user_id, note) values ${LINKS.map((k) => `(${q(U[k])}, 'qa_fx')`).join(', ')} on conflict do nothing;
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square) values
  (${q(E1)}, ${q(SP)}, '서비스', '수정 공간 노하우 1', 'published', 'space_owner', '{}'::jsonb),
  (${q(E2)}, ${q(SP)}, '서비스', '수정 공간 노하우 2', 'published', 'space_owner', '{}'::jsonb),
  (${q(E3)}, ${q(SP)}, '서비스', '수정 공간 노하우 3', 'published', 'space_owner', '{}'::jsonb),
  (${q(EP)}, ${q(X)}, '서비스', '수정 사본 노하우', 'published', 'owner', '{}'::jsonb);
-- 링크: 만든 사람마다 하나(서비스 권한으로 심는다 · 만든 사람 칸을 그대로 둔다)
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at, created_by) values
  ${LINKS.map((k) => `(${q(lk(k))}, ${q(k === 'SO' ? SP : k === 'DO' ? SD : X)}, ${q(tk(k))}, 'QA ${k} 링크', '{}', now() + interval '7 days', ${q(U[k])})`).join(',\n  ')};
-- 6번: 승인된 공간 제안(스냅샷 사진 1장) · 9번: E1 은 이미 대기
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, resulting_entry_id, reviewed_by,
                                        source_unit_id, source_entry_id, source_snapshot) values
  (${q(SA)}, ${q(X)}, 'from_space', ${q(U.SO)}, 'QASO', 'x', 'approved', ${q(EP)}, ${q(U.O)}, ${q(SP)}, 'qa_fxsrc_${rnd}',
   jsonb_build_object('title', 'QA', 'photos', jsonb_build_array(${q(SP + '/p1.jpg')})));
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_unit_id, source_entry_id, source_snapshot) values
  ('qa_fxsp1_${rnd}', ${q(X)}, 'from_space', ${q(U.SO)}, 'QASO', 'x', 'pending', ${q(SP)}, ${q(E1)}, '{}'::jsonb);

create function pg_temp.fx_fill(p_sql text) returns text language plpgsql as $f$
declare m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{(V|P1|P2):([^}]+)\}', 'g') loop
    select x.v into v from fx_v x where x.k = m[2];
    if m[1] = 'P1' then v := nullif(split_part(v, '|', 1), '-');
    elsif m[1] = 'P2' then v := nullif(split_part(v, '|', 2), '');
    end if;
    p_sql := replace(p_sql, '{' || m[1] || ':' || m[2] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  return p_sql;
end $f$;
create function pg_temp.fx_do(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_put text) returns text language plpgsql as $f$
declare r text; d text;
begin
  p_sql := pg_temp.fx_fill(p_sql);
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
    else json_build_object('sub', p_uid, 'role', p_role, 'session_id', p_sid)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
    return 'err|' || sqlstate || '|' || left(sqlerrm, 70) || '|' || coalesce(d, '');
  end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if p_put <> '' then insert into fx_v(k, v) values (p_put, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok|' || coalesce(r, '<null>');
end $f$;
create function pg_temp.fx_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute pg_temp.fx_fill(p_sql) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 70);
end $f$;

-- ════ 3 · 전제: 링크가 다 열려 있다 ════
${LINKS.map((k) => call(`3 전제: ${k} 링크 열림`, null, 'anon', open(k), 'ok|true')).join('\n')}

-- ════ 4 · 이어받기 코드(손님 행이 있어야 낸다) ════
${call('4 열쇠 없이 코드 = handoff_needs_question', null, 'anon', `select code from public.edu_link_handoff_code(${q(tk('H'))}, null)`, 'err:handoff_needs_question')}
${call('4 틀린 열쇠 코드 = handoff_needs_question', null, 'anon', `select code from public.edu_link_handoff_code(${q(tk('H'))}, 'gk_${'0'.repeat(48)}')`, 'err:handoff_needs_question')}
${val('4 손님 없는 코드 행 0', `select count(*) from public.edu_link_handoffs where link_id = ${q(lk('H'))}`, '0')}
${call('4 손님 묻기', null, 'anon', ask('H', 'null', '수정손님', '수건은 어디 둬요'), 'ok|gk_*', 'g1')}
${call('4 손님 있는 열쇠 = 코드 받음', null, 'anon', `select code from public.edu_link_handoff_code(${q(tk('H'))}, {P1:g1})`, 'ok|*')}
${val('4 코드 행은 손님에 묶임', `select count(*) || '/' || bool_and(guest_id is not null) from public.edu_link_handoffs where link_id = ${q(lk('H'))}`, '1/true')}

-- ════ 8 · 답 받기 맨 뒤 칸 uq_id ════
${call('8 보내기 전 uq_id = null', null, 'anon', `select coalesce(uq_id, '-') from public.edu_link_answers(${q(tk('H'))}, {P1:g1})`, 'ok|-')}
${call('8 손님 보내기', null, 'anon', `select public.edu_link_send(${q(tk('H'))}, {P1:g1}, {P2:g1}, false)::text`, 'ok|true')}
${call('8 보낸 뒤 uq_id 받기', null, 'anon', `select uq_id from public.edu_link_answers(${q(tk('H'))}, {P1:g1})`, 'ok|uq_*', 'u8')}
${val('8 받은 uq_id = 답할 질문 번호', `select ({V:u8} = (select g.uq_id from public.edu_guest_questions g where g.cq_id = {P2:g1}))::text`, 'true')}
${val('8 uq_id 는 맨 뒤 칸', `select (proargnames[array_length(proargnames, 1)] = 'uq_id')::text from pg_proc where oid = 'public.edu_link_answers(text,text)'::regprocedure`, 'true')}
${val('8 anon·로그인 실행 권한 그대로', `select has_function_privilege('anon', 'public.edu_link_answers(text,text)', 'execute') || '/' || has_function_privilege('authenticated', 'public.edu_link_answers(text,text)', 'execute')`, 'true/true')}

-- ════ 2 · 13 · 탈퇴 계정 ════
${call('2 대조: 멤버 보내기 됨', 'SM', 'authenticated', `select public.space_question_send(${q(SP)}, '대조 질문')`, 'ok|uq_*')}
${call('13 대조: 기기 열쇠 받기 전 손님 행 옮김', 'DM', 'authenticated', `select claimed::text from public.edu_link_claim_guest({P1:g1})`, 'ok|true')}
update public.profiles set deleted_at = now() where id = ${q(U.DM)};
${call('2 탈퇴 계정 보내기 = not_authenticated', 'DM', 'authenticated', `select public.space_question_send(${q(SP)}, '탈퇴 뒤 질문')`, 'err:not_authenticated')}
${call('2 탈퇴 계정 내 질문 = not_authenticated', 'DM', 'authenticated', `select count(*)::text from public.space_my_questions(${q(SP)})`, 'err:not_authenticated')}
${call('13 탈퇴 계정 코드 넣기 = not_authenticated', 'DM', 'authenticated', `select status from public.edu_link_claim_code('ZZZZZ2')`, 'err:not_authenticated')}
${call('13 탈퇴 계정 자동 옮기기 = not_authenticated', 'DM', 'authenticated', `select count(*)::text from public.edu_link_claim_guest({P1:g1})`, 'err:not_authenticated')}
${call('13 탈퇴 계정 내 링크 = 0', 'DM', 'authenticated', `select count(*)::text from public.my_edu_links()`, 'ok|0')}
${call('13 탈퇴 계정 기기 열쇠 = not_authenticated', 'DM', 'authenticated', `select key from public.edu_link_me_key(${q(lk('H'))})`, 'err:not_authenticated')}
${val('13 탈퇴 계정 코드 넣기는 틀린 시도로 안 셈', `select count(*) from public.join_attempts where uid = ${q(U.DM)}`, '0')}

-- ════ 9 · 이미 대기 = detail 에 번호 ════
${call('9 하나가 대기 = already_proposed · detail = 그 번호', 'SO', 'authenticated', `select count(*)::text from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(E2)}, ${q(E1)}])`, `errd:already_proposed:${E1}`)}
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_unit_id, source_entry_id, source_snapshot) values
  ('qa_fxsp3_${rnd}', ${q(X)}, 'from_space', ${q(U.SO)}, 'QASO', 'x', 'pending', ${q(SP)}, ${q(E3)}, '{}'::jsonb);
${call('9 둘이 대기 = 번호 순 쉼표', 'SO', 'authenticated', `select count(*)::text from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(E3)}, ${q(E2)}, ${q(E1)}])`, `errd:already_proposed:${[E1, E3].sort().join(',')}`)}
${call('9 대기 없는 것만 = 됨', 'SO', 'authenticated', `select count(*)::text from public.propose_to_store(${q(SP)}, ${q(X)}, array[${q(E2)}])`, 'ok|1')}

-- ════ 6 · 사진은 한 번만 ════
${call('6 처음 적기 = 그 경로', null, 'service_role', `select array_to_string(public._set_proposal_photos(${q(SA)}, array[${q(X + '/a.jpg')}]), ',')`, `ok|${X}/a.jpg`)}
update public.playbook_entries set photos = '{}' where id = ${q(EP)};
${call('6 사장이 다 지운 뒤 다시 = 안 적음(빈 채)', null, 'service_role', `select coalesce(array_to_string(public._set_proposal_photos(${q(SA)}, array[${q(X + '/b.jpg')}]), ','), '')`, 'ok|')}
${val('6 결과 노하우 사진 = 빈 채', `select coalesce(cardinality(photos), 0) from public.playbook_entries where id = ${q(EP)}`, '0')}
${call('6 적은 뒤 복사할 경로 = 0(엣지가 복사하지 않음)', null, 'service_role', `select (public._proposal_photo_source(${q(SA)}, ${q(U.O)}::uuid) ->> 'status') || '/' || jsonb_array_length(public._proposal_photo_source(${q(SA)}, ${q(U.O)}::uuid) -> 'paths')`, 'ok|ok/0')}
-- 6 · CSO Low: 승인 뒤 엣지가 못 돌았고 사장이 먼저 자기 사진을 넣었다 → 덮지 않고 "적었다"로 찍는다 → 다 지운 뒤 다시 불러도 안 되살아난다
update public.playbook_suggestions set photos_written_at = null where id = ${q(SA)};
update public.playbook_entries set photos = array[${q(X + '/own.jpg')}] where id = ${q(EP)};
${call('6b 사장 사진이 있으면 덮지 않음', null, 'service_role', `select array_to_string(public._set_proposal_photos(${q(SA)}, array[${q(X + '/c.jpg')}]), ',')`, `ok|${X}/own.jpg`)}
update public.playbook_entries set photos = '{}' where id = ${q(EP)};
${call('6b 그 뒤 다 지우고 다시 = 안 적음(빈 채)', null, 'service_role', `select coalesce(array_to_string(public._set_proposal_photos(${q(SA)}, array[${q(X + '/c.jpg')}]), ','), '')`, 'ok|')}
${val('6b 결과 노하우 사진 = 빈 채', `select coalesce(cardinality(photos), 0) from public.playbook_entries where id = ${q(EP)}`, '0')}

-- ════ 3 · 나가면 그 사람 링크를 닫는다 ════
update public.unit_members set role = 'junior' where unit_id = ${q(X)} and user_id = ${q(U.G)};
${val('3 매니저 → 직원 강등 = 안 닫음', closed('G'), 'false')}
${call('3 사장이 K 내보내기', 'O', 'authenticated', `select public.remove_staff(${q(U.K)}::uuid)::text`, 'ok|*')}
${val('3 내보낸 K 링크 닫힘', closed('K'), 'true')}
${call('3 내보낸 K 링크 손님 열기 = 닫힘', null, 'anon', open('K'), 'ok|false')}
${call('3 내보낸 K 링크 손님 묻기 = link_closed', null, 'anon', ask('K', 'null', '손님', '닫힌 링크'), 'err:link_closed')}
${call('3 L 나가기', 'L', 'authenticated', `select public.leave_store()::text`, 'ok|*')}
${val('3 나간 L 링크 닫힘', closed('L'), 'true')}
${call('3 나간 L 링크 손님 묻기 = link_closed', null, 'anon', ask('L', 'null', '손님', '닫힌 링크'), 'err:link_closed')}
${call('3 Z 계정 탈퇴', 'Z', 'authenticated', `select public.delete_my_account()::text`, 'ok|*')}
${val('3 탈퇴한 Z 링크 닫힘', closed('Z'), 'true')}
${call('3 탈퇴한 Z 링크 손님 묻기 = link_closed', null, 'anon', ask('Z', 'null', '손님', '닫힌 링크'), 'err:link_closed')}
${call('3 DO 공간 지우기', 'DO', 'authenticated', `select public.delete_space(${q(SD)})::text`, 'ok|*')}
${val('3 지운 공간 주인 링크 닫힘', closed('DO'), 'true')}
${val('3 남은 사람(H · 강등 G · 공간 주인 SO) 링크 그대로', `select string_agg((closed_at is null)::text, ',' order by id) from public.edu_links where id in (${q(lk('H'))}, ${q(lk('G'))}, ${q(lk('SO'))})`, 'true,true,true')}
${val('3 닫기 트리거는 클라 실행 불가', `select (not has_function_privilege('authenticated', 'public.edu_links_close_departed()', 'execute'))::text`, 'true')}
${val('3 열린 링크 중 만든 사람이 그 자리에 없는 것 = 0', `select count(*) from public.edu_links l where l.closed_at is null and l.created_by is not null and l.id like 'qa_fx%${rnd}' and not exists (select 1 from public.unit_members m where m.unit_id = l.unit_id and m.user_id = l.created_by)`, '0')}

-- ════ 17 · 0556 무료 모드에서도 손님은 자리 한도 ════
insert into public.ai_usage_monthly(unit_id, month, used) values (${q(X)}, ${M_}, 200)
  on conflict (unit_id, month) do update set used = 200;
${call('17 무료 모드 · 다 찬 매장 · 직원 예약 = 됨', null, 'service_role', `select allowed::text from public.ai_quota_reserve(${q(X)}, 1, null, false)`, 'ok|true')}
${call('17 무료 모드 · 다 찬 매장 · 손님 예약 = 안 됨', null, 'service_role', `select allowed || '/' || cap_count from public.ai_quota_reserve(${q(X)}, 1, 'edu:qa_fx_${rnd}', true)`, 'ok|false/200')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (r.status !== 0) {
    check('11-12 수정 검사 셋업', false, (r.stderr || r.error?.message || '').split('\n').filter((l) => /ERROR|DETAIL|LINE|ETIMEDOUT/.test(l)).slice(0, 4).join(' | '));
    return;
  }
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|FX|'));
  const expected = (sql.match(/'QA\|FX\|'/g) ?? []).length;
  check(`11-12 수정 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
  for (const l of lines) {
    const [name, expect, got] = l.slice(6).split('¦');
    let ok;
    if (expect.startsWith('errd:')) {
      const [, code, detail] = expect.split(':');
      const parts = got.split('|');
      ok = parts[0] === 'err' && parts[1] === 'P0001' && parts[2].split(/[\s:]/)[0] === code && parts[3] === detail;
    } else if (expect.startsWith('err:')) ok = got.startsWith('err|P0001|') && got.slice(10).split(/[\s:|]/)[0] === expect.slice(4);
    else if (expect === 'deny') ok = got.startsWith('err|42501|');
    else if (expect.includes('*')) ok = !got.startsWith('err|') && new RegExp(`^${expect.split('*').map(escRe).join('.*')}$`).test(got);
    else ok = got === expect;
    check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
  }
}
