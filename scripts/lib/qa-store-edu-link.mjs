// qa-store-edu-link.mjs — 7번 매장 교육 링크 서버(0555 · 야간 s2) 검사. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나:
//   ① 링크 여는 판정 한 곳(_edu_link_open_for) — 허용 목록 밖 매장 사장: RPC = feature_off · 표 insert/update = 정책 거절(42501 row-level security ·
//      permission denied 아님 · feature_off 아님) · 허용 목록 사장·매니저 = RPC·표 쓰기 됨 · 직원 = not_manager · 닫기는 늘 됨.
//   ② 권한 — _edu_link_open_for = anon·authenticated 실행 거절 · _edu_link_open_for_me = authenticated 됨 · anon 거절.
//   ③ 손님 — 허용 목록 밖이 만든 링크(이미 있는 행) · 만든 사람이 빈 링크 = 닫힘 · edu_links+edu_guest 켜면 열림(트랜잭션 안에서 켰다 끔).
//   ④ 본사 사본 — 만들기·고치기 RPC · 표 update 로 새로 담기 거절 · 본사 사본으로 답한 질문은 링크에 안 담김.
//   ⑤ 알림(N3) — 매장 손님 보내기 → 링크 만든 사람 1 · 동료·사장 0 · 만든 사람이 나가면 사장 전원 · 경로 /owner/coach?uqId= ·
//      미응답 숫자·벨에 들어옴 · 매장 AI 한도(ai_quota_reserve)에서 깎임.
//   ⑥ my_kind_features — ('store'|'space','edu_links') 두 줄 = 나에게 판정 · 나머지 매장 줄은 표 그대로.
// 방식: 한 트랜잭션 안에서 계정·매장·링크를 심고 끝에 rollback 한다(공유 로컬 DB 흔적 0 · 데모 매장 안 씀).
//   역할(anon · authenticated · service_role)과 JWT 클레임을 흉내 낸다. 앞 호출 결과는 임시 표에 담아 {V:이름} 자리에 채운다.
// 로컬 전용(부르는 쪽이 --local 을 확인한다). AI 호출 0회(엣지를 안 부른다).
import { spawnSync } from 'node:child_process';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function runStoreEduLinkChecks({ DB, check }) {
  console.log('\n[7s] 매장 교육 링크 서버(0555 · 야간 s2)');
  const rnd = Math.random().toString(16).slice(2, 10);
  const K = ['O', 'P', 'M', 'J', 'Q'];
  // O 매장 X1 사장(허용 목록) · P 매장 X1 공동 사장(목록 밖) · M 매장 X1 매니저(허용 목록) · J 매장 X1 직원 · Q 매장 X2 사장(목록 밖)
  const U = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-a${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-b${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const X1 = `qa_sel1_${rnd}`, X2 = `qa_sel2_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const e = (n) => `qa_sele${n}_${rnd}`;
  const tk = (n) => `qa_seltok${n}_${rnd}_aaaaaaaaaaaa`;
  const LQ = `qa_sellq_${rnd}`, LN = `qa_selln_${rnd}`;

  const call = (name, who, role, body, expect, put = '') =>
    `select 'QA|SE|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.se_do(${who ? q(U[who]) + '::uuid' : 'null'}, ${who ? q(S[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(body)}, ${q(put)});`;
  const val = (name, body, expect) => `select 'QA|SE|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.se_val(${q(body)});`;
  const V = (n, part = 1) => `{V:${n}:${part}}`;
  const ask = (tokenExpr, name, text) =>
    `select coalesce(guest_key, '-') || '|' || cq_id from public.edu_link_ask(${tokenExpr}, null, ${q(name)}, ${q(text)})`;
  const notes = (uid) => `(select count(*) from public.member_notices where unit_id = ${q(X1)} and kind = 'question' and user_id = ${q(uid)})`;
  const mkf = (k) => `select enabled::text from public.my_kind_features() where kind = '${k}' and feature = 'edu_links'`;
  const insLink = (id, unit, token) =>
    `insert into public.edu_links(id, unit_id, token, title, expires_at) values (${q(id)}, ${q(unit)}, ${q(token)}, 't', now() + interval '1 day') returning 'inserted'`;

  const sql = String.raw`
begin;
create temp table se_v(k text primary key, v text);
grant select on se_v to anon, authenticated, service_role;
insert into public.app_config(key, value) values ('billing_free_mode', 'true') on conflict (key) do update set value = excluded.value;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_se_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${K.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${K.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
insert into public.units(id, store_name, kind) values (${q(X1)}, 'QA링크매장', 'store'), (${q(X2)}, 'QA목록밖매장', 'store');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.O)}, ${q(X1)}, 'owner'), (${q(U.P)}, ${q(X1)}, 'owner'), (${q(U.M)}, ${q(X1)}, 'manager'), (${q(U.J)}, ${q(X1)}, 'junior'),
  (${q(U.Q)}, ${q(X2)}, 'owner');
insert into public.session_active_units(session_id, user_id, unit_id) values
  ${['O', 'P', 'M', 'J'].map((k) => `(${q(S[k])}, ${q(U[k])}, ${q(X1)})`).join(', ')}, (${q(S.Q)}, ${q(U.Q)}, ${q(X2)});
insert into public.space_entry_allowlist(user_id, note) values (${q(U.O)}, 'qa'), (${q(U.M)}, 'qa') on conflict do nothing;
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, brand_entry_id) values
  (${q(e(1))}, ${q(X1)}, '서비스', '매장 노하우', 'published', 'owner', null),
  (${q(e(2))}, ${q(X1)}, '서비스', '본사 노하우 사본', 'published', 'owner', 'qa_brand_src_${rnd}'),
  (${q(e(3))}, ${q(X2)}, '서비스', '목록 밖 매장 노하우', 'published', 'owner', null);
-- 이미 있는 행(서비스 권한으로 심음): Q 가 만든 링크 · 만든 사람이 빈 링크(계정 삭제)
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at, created_by) values
  (${q(LQ)}, ${q(X2)}, ${q(tk(1))}, 'QA 목록 밖 링크', array[${q(e(3))}], now() + interval '7 days', ${q(U.Q)}),
  (${q(LN)}, ${q(X1)}, ${q(tk(2))}, 'QA 만든 사람 없음', array[${q(e(1))}], now() + interval '7 days', null);

-- {V:이름:n} = 담은 값의 n 번째 칸('|' 로 나눔). 없으면 null(앞 호출이 실패하면 뒤가 엉뚱하게 통과하지 않게).
create function pg_temp.se_fill(p_sql text) returns text language plpgsql as $f$
declare m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{V:([^:}]+):(\d+)\}', 'g') loop
    select nullif(nullif(split_part(x.v, '|', m[2]::int), ''), '-') into v from se_v x where x.k = m[1];
    p_sql := replace(p_sql, '{V:' || m[1] || ':' || m[2] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  return p_sql;
end $f$;
create function pg_temp.se_do(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_put text) returns text language plpgsql as $f$
declare r text;
begin
  p_sql := pg_temp.se_fill(p_sql);
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
    return 'err|' || sqlstate || '|' || left(sqlerrm, 70);
  end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if p_put <> '' then insert into se_v(k, v) values (p_put, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok|' || coalesce(r, '<null>');
end $f$;
create function pg_temp.se_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute pg_temp.se_fill(p_sql) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 70);
end $f$;

-- ── ② 권한 ──
${val('_edu_link_open_for anon·authenticated 실행 거절 · service_role 도 거절(내부)', `select has_function_privilege('anon', 'public._edu_link_open_for(text,uuid)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public._edu_link_open_for(text,uuid)', 'execute')::text`, 'false/false')}
${val('_edu_link_open_for_me authenticated 됨 · anon 거절', `select has_function_privilege('authenticated', 'public._edu_link_open_for_me(text)', 'execute')::text || '/' || has_function_privilege('anon', 'public._edu_link_open_for_me(text)', 'execute')::text`, 'true/false')}
${call('로그인 사람이 _edu_link_open_for 로 남의 uuid 찔러 보기 거절', 'Q', 'authenticated', `select public._edu_link_open_for('store', ${q(U.O)})::text`, 'deny')}
${call('Q 정책 전용 함수 = 나만(목록 밖 = false)', 'Q', 'authenticated', `select public._edu_link_open_for_me('store')::text`, 'ok|false')}
${call('O 정책 전용 함수 = 나만(목록 안 = true)', 'O', 'authenticated', `select public._edu_link_open_for_me('store')::text`, 'ok|true')}

-- ── ⑥ my_kind_features ──
${call('O(목록 안) → 매장 edu_links 켜짐', 'O', 'authenticated', mkf('store'), 'ok|true')}
${call('O(목록 안) → 공간 edu_links 켜짐', 'O', 'authenticated', mkf('space'), 'ok|true')}
${call('Q(목록 밖) → 매장 edu_links 꺼짐', 'Q', 'authenticated', mkf('store'), 'ok|false')}
${call('Q(목록 밖) → 공간 edu_links 꺼짐(edu_guest 꺼짐)', 'Q', 'authenticated', mkf('space'), 'ok|false')}
${call('J(직원 · 목록 밖) → 매장 edu_links 꺼짐', 'J', 'authenticated', mkf('store'), 'ok|false')}
${call('O → 나머지 매장 줄은 표 그대로(ask_first · edu_links 빼고)', 'O', 'authenticated', `select count(*)::text from public.my_kind_features() f join public.unit_kind_features k using (kind, feature) where f.kind = 'store' and f.feature not in ('ask_first', 'edu_links') and f.enabled is distinct from k.enabled`, 'ok|0')}

-- ── ① 만들기 판정 ──
${call('Q(목록 밖 사장) 링크 만들기 RPC → feature_off', 'Q', 'authenticated', `select id from public.edu_link_create(${q(X2)}, 'x', '{}', 7)`, 'err:feature_off')}
${call('Q 표 insert → 정책 거절(42501 row-level security)', 'Q', 'authenticated', insLink(`qa_selq2_${rnd}`, X2, tk(3)), 'rls')}
${call('Q 표 update(자기 매장 링크) → 정책 거절', 'Q', 'authenticated', `update public.edu_links set title = 'y' where id = ${q(LQ)} returning 'updated'`, 'rls')}
${call('Q 고치기 RPC → feature_off', 'Q', 'authenticated', `select public.edu_link_update(${q(LQ)}, 'y', null, null)::text`, 'err:feature_off')}
${call('P(목록 밖 공동 사장) 만들기 RPC → feature_off', 'P', 'authenticated', `select id from public.edu_link_create(${q(X1)}, 'x', '{}', 7)`, 'err:feature_off')}
${call('J(직원) 만들기 RPC → not_manager(권한이 먼저)', 'J', 'authenticated', `select id from public.edu_link_create(${q(X1)}, 'x', '{}', 7)`, 'err:not_manager')}
${call('O(목록 안 사장) 만들기 RPC 됨', 'O', 'authenticated', `select c.id || '|' || c.token from public.edu_link_create(${q(X1)}, 'O 링크', array[${q(e(1))}], 7) c`, 'ok|*', 'lo')}
${call('M(목록 안 매니저) 만들기 RPC 됨', 'M', 'authenticated', `select c.id || '|' || c.token from public.edu_link_create(${q(X1)}, 'M 링크', array[${q(e(1))}], 7) c`, 'ok|*', 'lm')}
${val('M 링크 만든 사람 = M', `select created_by::text from public.edu_links where id = ${V('lm')}`, U.M)}
${call('O 표 insert 됨(정책식이 permission denied 로 안 죽음)', 'O', 'authenticated', insLink(`qa_selo2_${rnd}`, X1, tk(4)), 'ok|inserted')}
${call('O 표 update 됨', 'O', 'authenticated', `update public.edu_links set title = '고침' where id = ${q(LN)} returning 'updated'`, 'ok|updated')}
${call('O 고치기 RPC 됨', 'O', 'authenticated', `select public.edu_link_update(${V('lo')}, '고친 제목', null, null)::text`, 'ok|')}

-- ── ④ 본사 사본 빼기 ──
${call('O 만들기에 본사 사본 담기 거절', 'O', 'authenticated', `select id from public.edu_link_create(${q(X1)}, 'x', array[${q(e(2))}], 7)`, 'err:EDU_LINK_ENTRY_DENIED')}
${call('O 고치기로 본사 사본 넣기 거절', 'O', 'authenticated', `select public.edu_link_update(${V('lo')}, null, array[${q(e(1))}, ${q(e(2))}], null)::text`, 'err:EDU_LINK_ENTRY_DENIED')}
${call('O 표 update 로 본사 사본 넣기 거절(트리거)', 'O', 'authenticated', `update public.edu_links set entry_ids = entry_ids || ${q(e(2))}::text where id = ${q(LN)} returning 'updated'`, 'err:EDU_LINK_ENTRY_DENIED')}

-- ── ③ 손님 열기 ──
${call('손님 → 목록 밖 사장이 만든 링크(이미 있는 행) 닫힘', null, 'anon', `select ok::text from public.edu_link_open(${q(tk(1))})`, 'ok|false')}
${call('손님 → 만든 사람이 빈 링크 닫힘', null, 'anon', `select ok::text from public.edu_link_open(${q(tk(2))})`, 'ok|false')}
${call('손님 → 목록 밖 링크에 묻기 = link_closed', null, 'anon', ask(q(tk(1)), '지은', '컵은요'), 'err:link_closed')}
${call('손님 → 매니저(목록 안) 링크 열림 · 매장', null, 'anon', `select o.ok || '/' || o.place_kind || '/' || o.entry_count from public.edu_link_open(${V('lm', 2)}) o`, 'ok|true/store/1')}
update public.unit_kind_features set enabled = true where kind = 'store' and feature in ('edu_links', 'edu_guest');
${call('매장 edu_links+edu_guest 켜면 → 목록 밖 링크 열림', null, 'anon', `select ok::text from public.edu_link_open(${q(tk(1))})`, 'ok|true')}
${call('켜면 → Q 만들기 RPC 됨', 'Q', 'authenticated', `select (c.id is not null)::text from public.edu_link_create(${q(X2)}, 'x', '{}', 7) c`, 'ok|true')}
update public.unit_kind_features set enabled = false where kind = 'store' and feature = 'edu_guest';
${call('edu_guest 만 끄면 → 다시 닫힘', null, 'anon', `select ok::text from public.edu_link_open(${q(tk(1))})`, 'ok|false')}
update public.unit_kind_features set enabled = false where kind = 'store' and feature = 'edu_links';

-- ── ⑤ 매장 손님 질문 알림(N3) ──
${call('손님 묻기(M 링크)', null, 'anon', ask(V('lm', 2), '지은', '포스기 마감은\n어떻게 해요'), 'ok|gk_*', 'g1')}
${call('손님 보내기 → true', null, 'anon', `select public.edu_link_send({V:lm:2}, {V:g1:1}, {V:g1:2}, false)::text`, 'ok|true')}
${val('알림 = 만든 사람 M 1 · 사장 O 0 · 공동 사장 P 0 · 직원 J 0', `select ${notes(U.M)} || '/' || ${notes(U.O)} || '/' || ${notes(U.P)} || '/' || ${notes(U.J)}`, '1/0/0/0')}
${val('알림 제목·본문(줄바꿈 정리)·경로', `select title || '|' || body || '|' || (url = '/owner/coach?uqId=' || (select uq_id from public.edu_guest_questions where cq_id = {V:g1:2}))::text from public.member_notices where unit_id = ${q(X1)} and kind = 'question' and user_id = ${q(U.M)}`, '지은님의 질문|포스기 마감은 어떻게 해요|true')}
${call('사장 벨(my_units_notif_data uq)에 손님 질문', 'O', 'authenticated', `select count(*)::text from public.my_units_notif_data() d where d.unit_id = ${q(X1)} and d.source = 'uq' and d.payload->>'link_id' = {V:lm:1}`, 'ok|1')}
${call('사장 미응답 숫자에 들어옴', 'O', 'authenticated', `select unanswered::text from public.owner_question_counts() where unit_id = ${q(X1)}`, 'ok|1')}
${call('직원 J 벨에도 도와줄 질문으로 보임(파생 · 푸시 아님)', 'J', 'authenticated', `select count(*)::text from public.my_units_notif_data() d where d.unit_id = ${q(X1)} and d.source = 'uq' and d.payload->>'link_id' = {V:lm:1}`, 'ok|1')}
${call('손님 AI 예약 = 그 매장 자리(ai_quota_reserve · 손님 요청 키 · 엣지와 같은 호출)', null, 'service_role', `select r.allowed::text from public.ai_quota_reserve(${q(X1)}, 1, 'edu:' || {V:g1:2}, true) r`, 'ok|true')}
${val('매장 AI 한도에서 깎임(이번 달 사용량 1)', `select coalesce((select used from public.ai_usage_monthly where unit_id = ${q(X1)} and month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::text`, '1')}
delete from public.unit_members where unit_id = ${q(X1)} and user_id = ${q(U.M)};
${call('만든 사람 M 이 나간 뒤 손님 묻기', null, 'anon', ask(V('lm', 2), '하늘', '마감 정산은요'), 'ok|gk_*', 'g2')}
${call('보내기 → true', null, 'anon', `select public.edu_link_send({V:lm:2}, {V:g2:1}, {V:g2:2}, false)::text`, 'ok|true')}
${val('M 나감 → 사장 전원(O 1 · P 1) · M 그대로 1 · J 0', `select ${notes(U.M)} || '/' || ${notes(U.O)} || '/' || ${notes(U.P)} || '/' || ${notes(U.J)}`, '1/1/1/0')}
${call('O 링크 손님 질문 → O 한 명', null, 'anon', ask(V('lo', 2), '바다', '컵 세척은요'), 'ok|gk_*', 'g3')}
${call('보내기', null, 'anon', `select public.edu_link_send({V:lo:2}, {V:g3:1}, {V:g3:2}, false)::text`, 'ok|true')}
${val('O 링크 → O 2 · P 1 그대로', `select ${notes(U.O)} || '/' || ${notes(U.P)}`, '2/1')}

-- ── ④ 본사 사본으로 답하면 링크에 안 담김 · 매장 노하우는 담김 ──
update public.unknown_queries set status = 'resolved_with_entry', resolved_with_entry_id = ${q(e(2))}
 where id = (select uq_id from public.edu_guest_questions where cq_id = (select split_part(v, '|', 2) from se_v where k = 'g1'));
${val('본사 사본 답 → 링크 담긴 목록에 없음', `select (${q(e(2))} = any (entry_ids))::text from public.edu_links where id = {V:lm:1}`, 'false')}
update public.edu_links set entry_ids = '{}' where id = (select split_part(v, '|', 1) from se_v where k = 'lo');
update public.unknown_queries set status = 'resolved_with_entry', resolved_with_entry_id = ${q(e(1))}
 where id = (select uq_id from public.edu_guest_questions where cq_id = (select split_part(v, '|', 2) from se_v where k = 'g3'));
${val('매장 노하우 답 → 링크에 담김', `select array_to_string(entry_ids, ',') from public.edu_links where id = {V:lo:1}`, e(1))}

-- ── 닫기는 판정 없이 늘 된다 ──
${call('Q(목록 밖) 자기 링크 닫기 됨', 'Q', 'authenticated', `select public.edu_link_close(${q(LQ)})::text`, 'ok|')}
${val('닫힘 기록', `select (closed_at is not null)::text from public.edu_links where id = ${q(LQ)}`, 'true')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('매장 링크 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
    return;
  }
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|SE|'));
  const expected = (sql.match(/'QA\|SE\|'/g) ?? []).length;
  check(`매장 링크 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
  for (const l of lines) {
    const [name, expect, got] = l.slice(6).split('¦');
    let ok;
    // err:코드 = 오류 글 첫 낱말이 그 코드(SQLSTATE 무관 · 정책 거절·권한 거절이 엉뚱하게 통과하지 않게 낱말을 본다).
    if (expect.startsWith('err:')) ok = got.startsWith('err|') && got.split('|').slice(2).join('|').split(/[\s:]/)[0] === expect.slice(4);
    // rls = 정책 거절(42501 · row-level security). permission denied·feature_off 는 실패다.
    else if (expect === 'rls') ok = got.startsWith('err|42501|') && /row-level security/.test(got);
    // deny = 실행 권한 없음(42501 permission denied).
    else if (expect === 'deny') ok = got.startsWith('err|42501|') && /permission denied/.test(got);
    else if (expect.includes('*')) ok = !got.startsWith('err|') && got !== 'ok|<null>'
      && new RegExp(`^${expect.split('*').map(escRe).join('.*')}$`).test(got);
    else ok = got === expect;
    check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
  }
}
