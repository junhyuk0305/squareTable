// qa-space-edu-ask.mjs — 교육 링크 묻기·보내기·답 받기·AI 결과·신고(0401 · 공간·매장 통합 3번 덩이 나머지) 검사.
//   qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나: 손님 함수는 토큰이 곧 열쇠다(틀린·닫힌·만료·지운 자리·기능 꺼진 링크 = link_closed) · 손님 열쇠 없이는
//   남의 질문·답을 못 읽는다(같은 링크 다른 손님도) · 로그인한 브라우저도 손님으로 돈다 · 보내기 전에는 주인 목록에 안 뜬다 ·
//   보내면 답할 질문 1개 + 주인 알림 1개(10분에 한 번) · 주인 답(보내기 답 글 · 노하우)이 손님에게 돌아온다 ·
//   AI 재료에 이름이 없다 · 질문 하나에 AI 한 번 · AI 를 다 쓰면 바로 보낸다 · 빈도 제한 · 신고 · 앱 안 신고가 공간에서도 된다.
// 방식: 한 트랜잭션 안에서 계정·공간·매장·링크를 심고 끝에 rollback 한다 = 공유 로컬 DB 흔적 0(데모 매장을 안 쓴다).
//   호출은 역할(anon · authenticated · service_role)과 JWT 클레임을 흉내 낸다. 앞 호출이 돌려준 열쇠·질문 번호는
//   서비스 권한 임시 표에 담아 {K:이름} {C:이름} {U:이름} 자리에 채운다.
// 로컬 전용(부르는 쪽이 --local 을 이미 확인한다). AI 호출 0회(엣지를 부르지 않는다 · AI 결과는 엣지 대신 service_role 로 적는다).
import { spawnSync } from 'node:child_process';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function runEduAskChecks({ DB, check }) {
  console.log('\n[5b] 교육 링크 묻기 · 보내기 · 답 받기 · 신고(0401)');
  const rnd = Math.random().toString(16).slice(2, 10);
  const K = ['O', 'M', 'Z', 'N', 'D'];
  // O 공간 SP 주인 · M 공간 SP 멤버 · Z 아무 데도 아닌 로그인 사람(같은 브라우저에 로그인이 남은 손님) · N 공간 SB 주인 · D 매장 X 사장
  const U = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-e${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-f${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const SP = `qa_easp_${rnd}`, SB = `qa_easb_${rnd}`, SD = `qa_easd_${rnd}`, X = `qa_eax_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const e = (n) => `qa_eae${n}_${rnd}`;
  const tk = (n) => `qa_eatok${n}_${rnd}_aaaaaaaaaaaa`;
  const TK = tk(1), TKC = tk(2), TKE = tk(3), TKD = tk(4), TKX = tk(5), TKB = tk(6), TK2 = tk(7), TK3 = tk(8);
  const L1 = `qa_eal1_${rnd}`;

  // 호출 줄: 이름 · 누구(null = 로그인 없음) · 역할 · sql · 기대. put 이 있으면 결과(ok| 뒤)를 그 이름으로 담는다.
  const call = (name, who, role, body, expect, put = '') =>
    `select 'QA|EA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.ea_do(${who ? q(U[who]) + '::uuid' : 'null'}, ${who ? q(S[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(body)}, ${q(put)});`;
  const val = (name, body, expect) => `select 'QA|EA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.ea_val(${q(body)});`;
  // 손님 묻기 결과 = 열쇠|질문번호|ai_ready|sent → {K:이름}·{C:이름} 으로 꺼낸다
  const ask = (token, key, name, text) =>
    `select coalesce(guest_key, '-') || '|' || cq_id || '|' || ai_ready || '|' || sent from public.edu_link_ask(${q(token)}, ${key}, ${name === null ? 'null' : q(name)}, ${q(text)})`;
  const K_ = (n) => `{K:${n}}`, C_ = (n) => `{C:${n}}`;
  const ans = (token, key) => `select count(*) || '/' || coalesce(string_agg(state || ':' || query_text, ',' order by query_text collate "C"), '') from public.edu_link_answers(${q(token)}, ${key})`;

  const sql = String.raw`
begin;
create temp table ea_v(k text primary key, v text);
grant select on ea_v to anon, authenticated, service_role;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_ea_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${K.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${K.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
update public.profiles set name = 'QA로그인' where id = ${q(U.Z)};

insert into public.units(id, store_name, kind) values
  (${q(SP)}, 'QA묻기공간', 'space'), (${q(SB)}, 'QA다른공간', 'space'), (${q(SD)}, 'QA지울공간', 'space'), (${q(X)}, 'QA묻기매장', 'store');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.O)}, ${q(SP)}, 'space_owner'), (${q(U.M)}, ${q(SP)}, 'space_member'), (${q(U.N)}, ${q(SB)}, 'space_owner'),
  (${q(U.O)}, ${q(SD)}, 'space_owner'), (${q(U.D)}, ${q(X)}, 'owner');
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(S.O)}, ${q(U.O)}, ${q(SP)}), (${q(S.M)}, ${q(U.M)}, ${q(SP)});
insert into public.session_active_units(session_id, user_id, unit_id) values (${q(S.D)}, ${q(U.D)}, ${q(X)});
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square) values
  (${q(e(1))}, ${q(SP)}, '서비스', '묻기 노하우 1', 'published', 'space_owner', '{"situation":"컵이 모자랄 때","action":{"steps":["창고에서 꺼낸다"]},"extract":{"dont":"빈 상자를 두지 않는다"}}'::jsonb),
  (${q(e(2))}, ${q(SP)}, '서비스', '묻기 노하우 2(링크 밖)', 'published', 'space_owner', '{}'::jsonb),
  (${q(e(3))}, ${q(SP)}, '서비스', '묻기 초안', 'draft', 'space_owner', '{}'::jsonb),
  (${q(e(5))}, ${q(SB)}, '서비스', '다른 공간 노하우', 'published', 'space_owner', '{}'::jsonb),
  (${q(e(7))}, ${q(X)}, '서비스', '매장 노하우', 'published', 'owner', '{}'::jsonb);
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at, closed_at) values
  (${q(L1)}, ${q(SP)}, ${q(TK)}, 'QA 묻기 링크', array[${q(e(1))}, ${q(e(3))}], now() + interval '7 days', null),
  ('qa_eal2_${rnd}', ${q(SP)}, ${q(TKC)}, 'QA 닫힘', '{}', now() + interval '7 days', now()),
  ('qa_eal3_${rnd}', ${q(SP)}, ${q(TKE)}, 'QA 만료', '{}', now() - interval '1 minute', null),
  ('qa_eal4_${rnd}', ${q(SD)}, ${q(TKD)}, 'QA 지운 공간', '{}', now() + interval '7 days', null),
  ('qa_eal5_${rnd}', ${q(X)}, ${q(TKX)}, 'QA 매장 링크', array[${q(e(7))}], now() + interval '7 days', null),
  ('qa_eal6_${rnd}', ${q(SB)}, ${q(TKB)}, 'QA 다른 공간 링크', array[${q(e(5))}], now() + interval '7 days', null),
  ('qa_eal7_${rnd}', ${q(SP)}, ${q(TK2)}, 'QA 손님 제한 링크', '{}', now() + interval '7 days', null),
  ('qa_eal8_${rnd}', ${q(SP)}, ${q(TK3)}, 'QA 링크 제한 링크', '{}', now() + interval '7 days', null);
update public.units set deleted_at = now() where id = ${q(SD)};

-- {K:n} 열쇠 · {C:n} 질문 번호 · {U:n} 그 질문의 답할 질문 번호. 없으면 null(앞 호출이 실패하면 뒤가 엉뚱하게 통과하지 않게).
create function pg_temp.ea_fill(p_sql text) returns text language plpgsql as $f$
declare m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{([KCU]):([^}]+)\}', 'g') loop
    select x.v into v from ea_v x where x.k = m[2];
    if m[1] = 'K' then v := nullif(split_part(v, '|', 1), '-');
    elsif m[1] = 'C' then v := nullif(split_part(v, '|', 2), '');
    else select g.uq_id into v from public.edu_guest_questions g where g.cq_id = split_part((select x.v from ea_v x where x.k = m[2]), '|', 2);
    end if;
    p_sql := replace(p_sql, '{' || m[1] || ':' || m[2] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  return p_sql;
end $f$;
create function pg_temp.ea_do(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_put text) returns text language plpgsql as $f$
declare r text;
begin
  p_sql := pg_temp.ea_fill(p_sql);
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
    else json_build_object('sub', p_uid, 'role', p_role, 'session_id', p_sid)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
    return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
  end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if p_put <> '' then insert into ea_v(k, v) values (p_put, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok|' || coalesce(r, '<null>');
end $f$;
create function pg_temp.ea_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute pg_temp.ea_fill(p_sql) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
end $f$;

-- ── 토큰이 곧 열쇠 ──
${call('틀린 토큰 → 묻기 거절', null, 'anon', ask(tk(9), 'null', '지은', '컵이 없어요'), 'err:link_closed')}
${call('닫힌 링크 → 묻기 거절', null, 'anon', ask(TKC, 'null', '지은', '컵이 없어요'), 'err:link_closed')}
${call('만료된 링크 → 묻기 거절', null, 'anon', ask(TKE, 'null', '지은', '컵이 없어요'), 'err:link_closed')}
${call('지운 공간 링크 → 묻기 거절', null, 'anon', ask(TKD, 'null', '지은', '컵이 없어요'), 'err:link_closed')}
${call('매장 링크(기능 꺼짐 · 7번 덩이) → 묻기 거절', null, 'anon', ask(TKX, 'null', '지은', '컵이 없어요'), 'err:link_closed')}
${call('이름 없이 첫 질문 거절', null, 'anon', ask(TK, 'null', '  ', '컵이 없어요'), 'err:name_required')}
${call('21자 이름 거절', null, 'anon', ask(TK, 'null', '가'.repeat(21), '컵이 없어요'), 'err:name_required')}
${call('빈 질문 거절', null, 'anon', ask(TK, 'null', '지은', '   '), 'err:invalid_argument')}
${call('501자 질문 거절', null, 'anon', ask(TK, 'null', '지은', '가'.repeat(501)), 'err:invalid_argument')}
${val('거절된 묻기는 아무것도 안 남김(손님·질문 0)', `select (select count(*) from public.edu_link_guests where unit_id = ${q(SP)}) || '/' || (select count(*) from public.chat_queries where unit_id = ${q(SP)})`, '0/0')}

-- ── 묻기 ──
${call('첫 질문(로그인 없음) = 새 열쇠 · AI 돌림 · 안 보냄', null, 'anon', ask(TK, 'null', ' 지은 ', '컵이 모자라요'), 'ok|gk_*|true|false', 'g1')}
${val('질문 기록 = 공간 · 링크 · 이름 지은 · 계정 없음', `select unit_id || '/' || link_id || '/' || junior_name || '/' || coalesce(junior_id, '-') from public.chat_queries where id = {C:g1}`, `${SP}/${L1}/지은/-`)}
${val('열쇠는 해시만 저장(원문 없음)', `select (key_hash <> {K:g1} and length(key_hash) = 64)::text from public.edu_link_guests where unit_id = ${q(SP)}`, 'true')}
${val('보내기 전에는 답할 질문·알림 0', `select (select count(*) from public.unknown_queries where unit_id = ${q(SP)}) || '/' || (select count(*) from public.member_notices where unit_id = ${q(SP)})`, '0/0')}
${call('로그인이 남은 브라우저(Z)도 손님으로 = 적은 이름 · 계정 칸 비움', 'Z', 'authenticated', ask(TK, 'null', '하늘', '빨대는 어디 있어요'), 'ok|gk_*|true|false', 'g2')}
${val('Z 질문 = 이름 하늘 · 계정 없음', `select junior_name || '/' || coalesce(junior_id, '-') from public.chat_queries where id = {C:g2}`, '하늘/-')}
${call('같은 열쇠로 다시 = 열쇠 안 줌 · 이름은 처음 그대로', null, 'anon', ask(TK, K_('g1'), '다른이름', '얼음은요'), 'ok|-|' + '*', 'g1b')}
${val('두 번째 질문 이름 = 지은', `select junior_name from public.chat_queries where id = {C:g1b}`, '지은')}
${call('다른 링크에 같은 열쇠 = 새 손님(열쇠는 링크 하나에 묶임)', null, 'anon', ask(TKB, K_('g1'), '지은', '다른 공간 질문'), 'ok|gk_*|true|false', 'gb')}

-- ── 답 받기 · 열쇠 없이는 0 ──
${call('열쇠 없이 답 받기 = 0', null, 'anon', ans(TK, 'null'), 'ok|0/')}
${call('틀린 열쇠 = 0', null, 'anon', ans(TK, q('gk_' + 'f'.repeat(48))), 'ok|0/')}
${call('다른 링크 열쇠 = 0', null, 'anon', ans(TK, K_('gb')), 'ok|0/')}
${call('하늘 열쇠 = 하늘 질문만(같은 링크 다른 손님 안 보임)', null, 'anon', ans(TK, K_('g2')), 'ok|1/asking:빨대는 어디 있어요')}
${call('지은 열쇠 = 지은 질문 둘', null, 'anon', ans(TK, K_('g1')), 'ok|2/asking:얼음은요,asking:컵이 모자라요')}
${call('답 받기에 이름·손님 번호·계정 없음', null, 'anon', `select (strpos(string_agg(a::text, ''), '지은') = 0 and strpos(string_agg(a::text, ''), ${q(U.O)}) = 0)::text from public.edu_link_answers(${q(TK)}, {K:g1}) a`, 'ok|true')}

-- ── AI 재료와 결과(엣지 대신 service_role) ──
${call('손님이 AI 재료를 직접 못 읽음', null, 'anon', `select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1})`, 'deny')}
${call('손님이 AI 결과를 직접 못 적음', null, 'anon', `select public.edu_link_ai_result(${q(TK)}, {K:g1}, {C:g1}, array[${q(e(1))}], '{}'::jsonb)::text`, 'deny')}
${call('AI 차례 잡기 = 질문 글 · 링크의 발행된 노하우만(초안·링크 밖 제외) · 손님 이름 없음', null, 'service_role', `select query_text || '/' || exceeded || '/' || jsonb_array_length(entries) || '/' || (entries->0->>'id') || '/' || (entries->0->>'situation') || '/' || (strpos(c::text, '지은') = 0) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1}) c`, `ok|컵이 모자라요/false/1/${e(1)}/컵이 모자랄 때/true`)}
${call('같은 질문 두 번째 차례 = 0줄(동시 호출에도 AI 한 번)', null, 'service_role', `select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1})`, 'ok|0')}
${call('차례 풀기(AI 실패) → 다시 잡힘', null, 'service_role', `select public.edu_link_ai_release(${q(TK)}, {K:g1}, {C:g1})::text || '/' || (select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1}))`, 'ok|true/1')}
${call('남의 열쇠로 차례 풀기 = 안 풀림', null, 'service_role', `select public.edu_link_ai_release(${q(TK)}, {K:g2}, {C:g1})::text`, 'ok|false')}
${call('차례 안 잡은 질문에 결과 적기 = 안 바뀜(하늘)', null, 'service_role', `select public.edu_link_ai_result(${q(TK)}, {K:g2}, {C:g2}, null, null)::text`, 'ok|false')}
${call('남의 열쇠로 AI 재료 = 0줄', null, 'service_role', `select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g2}, {C:g1})`, 'ok|0')}
${call('링크 범위 검색 함수는 service_role 만', null, 'anon', `select count(*) from public.edu_link_match(${q(TK)}, array_fill(0::real, array[768])::extensions.vector, 8)`, 'deny')}
${call('AI 결과 적기(링크 밖 노하우는 걸러짐)', null, 'service_role', `select public.edu_link_ai_result(${q(TK)}, {K:g1}, {C:g1}, array[${q(e(1))}, ${q(e(2))}, ${q(e(5))}], '{"summary":"창고에서 꺼내요","actions":["창고에서 꺼낸다"],"donts":[],"mode":"generated"}'::jsonb, 0.8)::text`, 'ok|true')}
${val('질문 기록 = AI 답(참고 노하우 = 링크 안 것만)', `select was_deflected || '/' || array_to_string(matched_entry_ids, ',') || '/' || (response_block->>'mode') from public.chat_queries where id = {C:g1}`, `true/${e(1)}/generated`)}
${call('같은 질문 AI 결과 다시 적기 = 안 바뀜', null, 'service_role', `select public.edu_link_ai_result(${q(TK)}, {K:g1}, {C:g1}, array[${q(e(1))}], '{"mode":"generated"}'::jsonb)::text`, 'ok|false')}
${call('답한 질문은 AI 재료 0줄(질문 하나 = AI 한 번)', null, 'service_role', `select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1})`, 'ok|0')}
${call('못 찾음 적기(하늘 질문 · 차례 잡은 뒤)', null, 'service_role', `select (select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g2}, {C:g2})) || '/' || public.edu_link_ai_result(${q(TK)}, {K:g2}, {C:g2}, null, null)`, 'ok|1/true')}
${call('지은이 받은 AI 답이 보임', null, 'anon', `select state || '/' || (ai_block->>'summary') from public.edu_link_answers(${q(TK)}, {K:g1}) where cq_id = {C:g1}`, 'ok|ai/창고에서 꺼내요')}
update public.edu_links set entry_ids = array[${q(e(3))}] where id = ${q(L1)};
${call('참고 노하우를 링크에서 빼면 AI 답 본문 안 줌 · 보낼 수 있는 상태', null, 'anon', `select state || '/' || coalesce(ai_block::text, '-') from public.edu_link_answers(${q(TK)}, {K:g1}) where cq_id = {C:g1}`, 'ok|none/-')}
update public.edu_links set entry_ids = array[${q(e(1))}, ${q(e(3))}] where id = ${q(L1)};
${call('하늘 = 못 찾음 상태', null, 'anon', `select state from public.edu_link_answers(${q(TK)}, {K:g2})`, 'ok|none')}

-- ── 보내기(N2) ──
${call('남의 열쇠로 보내기 거절', null, 'anon', `select public.edu_link_send(${q(TK)}, {K:g2}, {C:g1}, true)::text`, 'err:question_not_found')}
${call('도움이 안 됐어요 → 보냄', null, 'anon', `select public.edu_link_send(${q(TK)}, {K:g1}, {C:g1}, true)::text`, 'ok|true')}
${val('답할 질문 = 대기 · 링크 · 이름 지은 · 계정 없음 · 짝에 번호', `select status || '/' || link_id || '/' || junior_name || '/' || coalesce(junior_id, '-') || '/' || (id = {U:g1}) from public.unknown_queries where unit_id = ${q(SP)}`, `pending_owner_answer/${L1}/지은/-/true`)}
${val('만족도 down 남김', `select coalesce(satisfaction, '-') from public.chat_queries where id = {C:g1}`, 'down')}
${val('주인 알림 1개(주인만 · 멤버 안 감) · 제목 · 경로', `select string_agg(user_id::text || '/' || kind || '/' || title || '/' || (url = '/space/answer/' || {U:g1} || '?space=' || ${q(SP)}), ',') from public.member_notices where unit_id = ${q(SP)}`, `${U.O}/question/지은님의 질문/true`)}
${call('두 번 눌러도 한 번', null, 'anon', `select public.edu_link_send(${q(TK)}, {K:g1}, {C:g1}, false)::text`, 'ok|false')}
${call('못 찾음 → 보내기(하늘)', 'Z', 'authenticated', `select public.edu_link_send(${q(TK)}, {K:g2}, {C:g2}, false)::text`, 'ok|true')}
${val('답할 질문 2 · 알림은 10분에 한 번(그대로 1)', `select (select count(*) from public.unknown_queries where unit_id = ${q(SP)}) || '/' || (select count(*) from public.member_notices where unit_id = ${q(SP)} and kind = 'question')`, '2/1')}
${val('하늘 질문도 계정 칸 비움(로그인 Z)', `select coalesce(junior_id, '-') || '/' || junior_name from public.unknown_queries where id = {U:g2}`, '-/하늘')}
${call('지은 = 기다림 상태', null, 'anon', `select state from public.edu_link_answers(${q(TK)}, {K:g1}) where cq_id = {C:g1}`, 'ok|waiting')}
${call('공간 멤버는 손님 질문을 못 읽음', 'M', 'authenticated', `select count(*) from public.unknown_queries where unit_id = ${q(SP)}`, 'ok|0')}
${call('주인은 답할 질문 목록에서 이름만 봄', 'O', 'authenticated', `select string_agg(junior_name, ',' order by junior_name) from public.unknown_queries where unit_id = ${q(SP)}`, 'ok|지은,하늘')}

-- ── 답 왕복 ──
${call('주인 보내기 답(하늘)', 'O', 'authenticated', `select (public.reply_unknown_query({U:g2}, '빨대는 계산대 아래 서랍에 있어요')).uq_id is not null`, 'ok|true')}
${call('하늘 화면 = 답함 · 답 글', null, 'anon', `select state || '/' || reply_body || '/' || (answered_at is not null) from public.edu_link_answers(${q(TK)}, {K:g2})`, 'ok|answered/빨대는 계산대 아래 서랍에 있어요/true')}
${call('주인이 있는 노하우로 답(지은 · 링크 밖 노하우 2)', 'O', 'authenticated', `with u as (update public.unknown_queries set status = 'resolved_with_entry', resolved_with_entry_id = ${q(e(2))}, answered_by = auth.uid() where id = {U:g1} returning 1) select count(*) from u`, 'ok|1')}
${call('지은 화면 = 답함 · 그 노하우(링크에 자동으로 담김)', null, 'anon', `select state || '/' || entry_title from public.edu_link_answers(${q(TK)}, {K:g1}) where cq_id = {C:g1}`, 'ok|answered/묻기 노하우 2(링크 밖)')}

-- ── AI 를 다 썼을 때 = 묻는 순간 바로 보냄(다른 공간 SB) ──
insert into public.ai_usage_monthly(unit_id, month, used) values (${q(SB)}, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'), 300)
  on conflict (unit_id, month) do update set used = 300;
${call('AI 다 참 → AI 안 돌림 · 바로 보냄', null, 'anon', ask(TKB, K_('gb'), null, '두 번째 질문'), 'ok|-|' + '*', 'gb2')}
${val('결과 = ai_ready false · sent true', `select split_part(v, '|', 3) || '/' || split_part(v, '|', 4) from ea_v where k = 'gb2'`, 'false/true')}
${val('SB 답할 질문 1 · SB 주인 알림 1', `select (select count(*) from public.unknown_queries where unit_id = ${q(SB)}) || '/' || (select string_agg(user_id::text, ',') from public.member_notices where unit_id = ${q(SB)} and kind = 'question')`, `1/${U.N}`)}
${call('AI 다 참 → AI 재료 exceeded = true', null, 'service_role', `select exceeded::text from public.edu_link_ai_context(${q(TKB)}, {K:gb}, {C:gb})`, 'ok|true')}

-- ── 신고 ──
${call('신고: 남의 질문 거절', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g2}, {C:g1}, 'ai_answer', '답이 이상해요')) is not null`, 'err:question_not_found')}
${call('신고: 모르는 종류 거절', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g1}, {C:g1}, 'harassment', '답이 이상해요')) is not null`, 'err:invalid_category')}
${call('신고: 4자 글 거절', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g1}, {C:g1}, 'ai_answer', '이상해')) is not null`, 'err:invalid_body')}
${call('신고 됨', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g1}, {C:g1}, 'ai_answer', '답이 이상해요')) is not null`, 'ok|true')}
${val('신고 행 = 손님 · 이름 없음 · 계정 없음 · 질문 번호', `select reporter_role || '/' || coalesce(reporter_name, '-') || '/' || coalesce(reporter_id::text, '-') || '/' || (cq_id = {C:g1}) || '/' || store_name from public.user_reports where unit_id = ${q(SP)}`, 'guest/-/-/true/QA묻기공간')}
${call('신고 2~5번째', null, 'anon', `select count(*) from (select public.edu_link_report(${q(TK)}, {K:g1}, {C:g1b}, 'other', '다시 신고해요 ' || g) from generate_series(1, 4) g) x`, 'ok|4')}
${call('신고 하루 5건 넘으면 거절', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g1}, {C:g1}, 'other', '여섯 번째 신고')) is not null`, 'err:rate_limited')}
${call('앱 안 신고: 공간 주인이 공간에서(AI 답)', 'O', 'authenticated', `select (public.submit_user_report(${q(SP)}, null, 'ai_answer', 'AI 답이 이상해요', null) is not null)::text`, 'ok|true')}
${call('앱 안 신고: 공간 멤버가 주인을', 'M', 'authenticated', `select (public.submit_user_report(${q(SP)}, ${q(U.O)}::uuid, 'other', '불편한 말을 했어요', null) is not null)::text`, 'ok|true')}
${val('앱 안 신고 행 = 공간 역할 그대로', `select string_agg(reporter_role || '/' || coalesce(target_role, '-'), ',' order by reporter_role) from public.user_reports where unit_id = ${q(SP)} and reporter_id is not null`, 'space_member/space_owner,space_owner/-')}
${call('앱 안 신고: 공간 멤버 아닌 사람 거절', 'Z', 'authenticated', `select public.submit_user_report(${q(SP)}, null, 'ai_answer', 'AI 답이 이상해요', null)::text`, 'err:not_a_member')}
${call('앱 안 신고: 공간 대상 목록', 'M', 'authenticated', `select string_agg(role, ',') from public.report_targets(${q(SP)})`, 'ok|space_owner')}
${call('앱 안 신고: 매장은 그대로(사장)', 'D', 'authenticated', `select (public.submit_user_report(${q(X)}, null, 'ai_answer', 'AI 답이 이상해요', null) is not null)::text`, 'ok|true')}
${val('매장 신고 행 = owner', `select string_agg(reporter_role, ',') from public.user_reports where unit_id = ${q(X)}`, 'owner')}

-- ── 빈도 제한 ──
${call('제한 링크 첫 질문', null, 'anon', ask(TK2, 'null', '바다', '첫 질문'), 'ok|gk_*', 'g3')}
insert into public.chat_queries(id, unit_id, junior_name, query_text, link_id)
  select 'qa_eacq_g' || g || '_${rnd}', ${q(SP)}, '바다', '채움 ' || g, 'qa_eal7_${rnd}' from generate_series(1, 9) g;
insert into public.edu_guest_questions(cq_id, guest_id, link_id)
  select 'qa_eacq_g' || g || '_${rnd}', x.id, 'qa_eal7_${rnd}'
    from generate_series(1, 9) g, public.edu_link_guests x where x.link_id = 'qa_eal7_${rnd}';   -- 손님이 없으면(마이그레이션 전) 0행
${call('손님 하나 10분 10개 넘으면 거절', null, 'anon', ask(TK2, K_('g3'), null, '열한 번째'), 'err:too_many_questions')}
${call('같은 링크의 다른 손님은 됨', null, 'anon', ask(TK2, 'null', '구름', '다른 사람 질문'), 'ok|gk_*')}
insert into public.chat_queries(id, unit_id, junior_name, query_text, link_id)
  select 'qa_eacq_l' || g || '_${rnd}', ${q(SP)}, '여럿', '채움 ' || g, 'qa_eal8_${rnd}' from generate_series(1, 30) g;
${call('링크 하나 10분 30개 넘으면 새 손님도 거절', null, 'anon', ask(TK3, 'null', '새사람', '서른한 번째'), 'err:too_many_questions')}
${val('제한에 걸린 새 손님은 안 남음', `select count(*) from public.edu_link_guests where link_id = 'qa_eal8_${rnd}'`, '0')}
update public.chat_queries set asked_at = now() - interval '11 minutes' where link_id = 'qa_eal8_${rnd}';
${call('10분 지나면 다시 됨', null, 'anon', ask(TK3, 'null', '새사람', '다시 질문'), 'ok|gk_*')}

-- ── 닫거나 지우면 전부 끊김 ──
${call('주인이 링크 닫기', 'O', 'authenticated', `select public.edu_link_close(${q(L1)})::text`, 'ok|')}
${call('닫힌 링크 = 답 받기 0', null, 'anon', ans(TK, K_('g1')), 'ok|0/')}
${call('닫힌 링크 = 보내기 거절', null, 'anon', `select public.edu_link_send(${q(TK)}, {K:g1}, {C:g1b}, false)::text`, 'err:link_closed')}
${call('닫힌 링크 = 신고 거절', null, 'anon', `select (public.edu_link_report(${q(TK)}, {K:g2}, {C:g2}, 'other', '닫힌 뒤 신고')) is not null`, 'err:link_closed')}
${call('닫힌 링크 = AI 재료 0줄', null, 'service_role', `select count(*) from public.edu_link_ai_context(${q(TK)}, {K:g1}, {C:g1b})`, 'ok|0')}
update public.units set deleted_at = now() where id = ${q(SB)};
${call('지운 공간 = 답 받기 0', null, 'anon', ans(TKB, K_('gb')), 'ok|0/')}
${call('지운 공간 = 묻기 거절', null, 'anon', ask(TKB, K_('gb'), null, '지운 뒤 질문'), 'err:link_closed')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('묻기 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
    return;
  }
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|EA|'));
  // 줄이 통째로 빠져도 통과하지 않게 기대 줄 수를 센다(SQL 의 call·val 줄 수와 같다).
  const expected = (sql.match(/'QA\|EA\|'/g) ?? []).length;
  check(`묻기 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
  for (const l of lines) {
    const [name, expect, got] = l.slice(6).split('¦');
    let ok;
    // 오류는 코드 낱말이 정확히 같아야 한다(err|P0001|코드 …). 엉뚱한 이유의 거절(권한·없는 함수)이 통과하지 않게.
    if (expect.startsWith('err:')) ok = got.startsWith('err|P0001|') && got.slice(10).split(/[\s:]/)[0] === expect.slice(4);
    // deny = 실행 권한 없음(42501). 함수가 없으면(42883) 실패로 센다.
    else if (expect === 'deny') ok = got.startsWith('err|42501|');
    // * = 아무 글자(열쇠·질문 번호처럼 매번 바뀌는 값)
    else if (expect.includes('*')) ok = !got.startsWith('err|') && got !== 'ok|<null>'
      && new RegExp(`^${expect.split('*').map(escRe).join('.*')}$`).test(got);
    else ok = got === expect;
    check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
  }
}
