// qa-space-member-ask.mjs — 야간 작업 s1 서버(0551~0554) 검사: 멤버 묻기 · 답 알림 · 공간 벨 · 이어받기 · 크론 재확인 ·
//   공간 삭제 알림 · AI 한도 예약. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나:
//   (나) 멤버는 묻기 제한 없이 주인에게 보낸다(같은 글 두 번 = 한 번 · 알림은 질문마다) · 주인 부름 = practice_only · 남 = not_space_member ·
//        내 질문만 읽는다 · 답하면 질문한 멤버에게 알림 1(답 쓴 사람 본인·나간 멤버 0) · 벨 공급(my_space_notif_data).
//   (다) 이어받기 코드(10분 · 한 번 · 해시만) · 틀린 코드 = invalid_code + 실패 1행 · 살아 있는 초대코드 = not_link_code(안 셈) ·
//        직접 6번 → 6번째 too_many_attempts · 번호 미인증 = PHONE_NOT_VERIFIED · 닫힌 링크 = link_closed · 옮긴 뒤 답 → 그 계정 알림 1 ·
//        내 링크 목록에 닫힌 링크 없음 · 기기 열쇠로 묻기·답 읽기 · 남의 링크 열쇠 = link_closed · 웹 가입 자동 옮기기 · 손님 없는 코드 20개.
//   (라) 크론이 처리된 합류 요청을 안 보냄 · 공간 삭제 → 주인 아닌 멤버 알림 n · 알림 종류 목록.
//   (마) AI 예약 R1(동시 두 번 → 하나만 · psql 두 개를 동시에) · R2 재시도 한 번 · R3 돌려주기 · R4 매장 무료 모드 · 권한.
//        R5(공간 판정 불가 = 막음)는 엣지 코드 갈래라 여기서는 skip 으로 센다.
// 방식: (나)~(마 R1 뺀 것)는 한 트랜잭션 안에서 심고 끝에 rollback(공유 로컬 DB 흔적 0). R1 은 커밋한 임시 공간 하나로 재고 지운다.
//   지연 트리거(답 알림)는 `set constraints all immediate` 로 그 자리에서 돌린다.
// 로컬 전용(부르는 쪽이 --local 을 이미 확인한다). AI 호출 0회.
import { spawn, spawnSync } from 'node:child_process';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function psqlAsync(DB, sql) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q']);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(sql);
  });
}

export async function runMemberAskChecks({ DB, check, skipped }) {
  console.log('\n[5c] 멤버 묻기 · 답 알림 · 이어받기 · 크론 재확인 · 공간 삭제 알림 · AI 예약(0551~0554 · 야간 s1)');
  const rnd = Math.random().toString(16).slice(2, 10);
  // O 공간 SP 주인 · M SP 멤버 · W SP 멤버(나갈 사람) · N 공간 SD 주인 · Z 링크 받은 로그인 사람 · Y 번호 미인증 · L 잠금 시험 · K 앱 길 시험 · D 매장 X 사장
  const KS = ['O', 'M', 'W', 'N', 'Z', 'Y', 'L', 'K', 'D'];
  const U = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-a${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-b${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const SP = `qa_masp_${rnd}`, SD = `qa_masd_${rnd}`, SQ = `qa_masq_${rnd}`, X = `qa_max_${rnd}`;
  const L1 = `qa_mal1_${rnd}`, L2 = `qa_mal2_${rnd}`, L3 = `qa_mal3_${rnd}`;
  const tk = (n) => `qa_matok${n}_${rnd}_aaaaaaaaaaaa`;
  const TK1 = tk(1), TK2 = tk(2), TK3 = tk(3);
  const E1 = `qa_mae1_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const M_ = `to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')`;

  // 호출 줄: 이름 · 누구(null = 로그인 없음) · 역할 · sql · 기대 · 담을 이름. {V:이름} = 담은 값 · {P1:이름}/{P2:이름} = '|' 로 나눈 1·2번째.
  const call = (name, who, role, body, expect, put = '') =>
    `select 'QA|MA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.ma_do(${who ? q(U[who]) + '::uuid' : 'null'}, ${who ? q(S[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(body)}, ${q(put)});`;
  const val = (name, body, expect) => `select 'QA|MA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.ma_val(${q(body)});`;
  const put = (k, body) => `insert into ma_v(k, v) select ${q(k)}, (${body}) on conflict (k) do update set v = excluded.v;`;
  const ask = (token, key, name, text) =>
    `select coalesce(guest_key, '-') || '|' || cq_id from public.edu_link_ask(${q(token)}, ${key}, ${name === null ? 'null' : q(name)}, ${q(text)})`;
  const claim = (code) => `select c.status || '/' || coalesce(c.link_id, '-') || '/' || coalesce(c.place_kind, '-') from public.edu_link_claim_code(${code}) c`;
  const fails = (w) => `select count(*) from public.join_attempts where uid = ${q(U[w])} and not ok`;
  // void 함수는 null 이 아니라 빈 값을 돌려준다 → "한 번 불렸다"를 행 수로 잰다.
  const refund = (unit, n, key) => `((select count(*) from (select public.ai_quota_refund(${q(unit)}, ${n}, ${key === null ? 'null' : q(key)})) r) = 1)`;

  const sql = String.raw`
begin;
create temp table ma_v(k text primary key, v text);
grant select on ma_v to anon, authenticated, service_role;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_ma_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${KS.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${KS.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
update public.profiles set name = 'QA주인' where id = ${q(U.O)};
update public.profiles set name = 'QA멤버' where id = ${q(U.M)};
-- 번호 인증: 컷오프 이전 계정은 면제(phone_verified_ok). Y 만 지금 만든 계정 + 번호 없음 = 미인증.
update public.profiles set created_at = '2020-01-01' where id in (${KS.filter((k) => k !== 'Y').map((k) => q(U[k])).join(', ')});

insert into public.units(id, store_name, kind) values
  (${q(SP)}, 'QA멤버공간', 'space'), (${q(SD)}, 'QA지울멤버공간', 'space'), (${q(SQ)}, 'QA한도공간', 'space'), (${q(X)}, 'QA멤버매장', 'store');
update public.units set invite_code = public._new_join_code() where id in (${q(SP)}, ${q(X)});
${put('spcode', `select invite_code from public.units where id = ${q(SP)}`)}
${put('xcode', `select invite_code from public.units where id = ${q(X)}`)}
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.O)}, ${q(SP)}, 'space_owner'), (${q(U.M)}, ${q(SP)}, 'space_member'), (${q(U.W)}, ${q(SP)}, 'space_member'),
  (${q(U.N)}, ${q(SD)}, 'space_owner'), (${q(U.W)}, ${q(SD)}, 'space_member'), (${q(U.Z)}, ${q(SD)}, 'space_member'),
  (${q(U.D)}, ${q(X)}, 'owner');
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(S.O)}, ${q(U.O)}, ${q(SP)}), (${q(S.M)}, ${q(U.M)}, ${q(SP)});
insert into public.playbook_entries(id, unit_id, category, title, status, creator_role, square) values
  (${q(E1)}, ${q(SP)}, '서비스', '멤버 노하우 1', 'published', 'space_owner', '{"situation":"컵이 모자랄 때"}'::jsonb);
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at) values
  (${q(L1)}, ${q(SP)}, ${q(TK1)}, 'QA 이어받기 링크', array[${q(E1)}], now() + interval '7 days'),
  (${q(L2)}, ${q(SP)}, ${q(TK2)}, 'QA 둘째 링크', '{}', now() + interval '7 days'),
  (${q(L3)}, ${q(SP)}, ${q(TK3)}, 'QA 닫을 링크', '{}', now() + interval '7 days');

create function pg_temp.ma_fill(p_sql text) returns text language plpgsql as $f$
declare m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{(V|P1|P2):([^}]+)\}', 'g') loop
    select x.v into v from ma_v x where x.k = m[2];
    if m[1] = 'P1' then v := nullif(split_part(v, '|', 1), '-');
    elsif m[1] = 'P2' then v := nullif(split_part(v, '|', 2), '');
    end if;
    p_sql := replace(p_sql, '{' || m[1] || ':' || m[2] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  return p_sql;
end $f$;
create function pg_temp.ma_do(p_uid uuid, p_sid uuid, p_role text, p_sql text, p_put text) returns text language plpgsql as $f$
declare r text;
begin
  p_sql := pg_temp.ma_fill(p_sql);
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
  if p_put <> '' then insert into ma_v(k, v) values (p_put, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok|' || coalesce(r, '<null>');
end $f$;
create function pg_temp.ma_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute pg_temp.ma_fill(p_sql) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
end $f$;

-- ════ (나) 멤버 묻기 ════
${call('멤버 보내기 → 답할 질문 번호', 'M', 'authenticated', `select public.space_question_send(${q(SP)}, ' 컵은 어디 있어요? ')`, 'ok|uq_*', 'm1')}
${val('답할 질문 = 공간 · 멤버 계정 · 프로필 이름 · 대기 · 링크 없음', `select unit_id || '/' || (junior_id = ${q(U.M)}) || '/' || junior_name || '/' || status || '/' || coalesce(link_id, '-') || '/' || query_text from public.unknown_queries where id = {V:m1}`, `${SP}/true/QA멤버/pending_owner_answer/-/컵은 어디 있어요?`)}
${val('주인 알림 1(주인만 · 제목 · 경로)', `select count(*) || '/' || string_agg((user_id = ${q(U.O)}) || '/' || title || '/' || (url = '/space/answer/' || {V:m1} || '?space=' || ${q(SP)}), ',') from public.member_notices where unit_id = ${q(SP)} and kind = 'question'`, '1/true/QA멤버님의 질문/true')}
${call('같은 글 두 번 = 같은 번호', 'M', 'authenticated', `select (public.space_question_send(${q(SP)}, '컵은 어디 있어요?') = {V:m1})::text`, 'ok|true')}
${val('두 번 눌러도 알림 1', `select count(*) from public.member_notices where unit_id = ${q(SP)} and kind = 'question'`, '1')}
${call('다른 글(줄바꿈) → 새 질문', 'M', 'authenticated', `select public.space_question_send(${q(SP)}, '빨대는' || chr(10) || '어디요')`, 'ok|uq_*', 'm2')}
${val('알림은 질문마다(2) · 본문 한 줄', `select count(*) || '/' || bool_and(body !~ '[[:cntrl:]]') from public.member_notices where unit_id = ${q(SP)} and kind = 'question'`, '2/true')}
${call('주인이 부르면 연습', 'O', 'authenticated', `select public.space_question_send(${q(SP)}, '연습 질문')`, 'err:practice_only')}
${call('다른 공간 주인 = 멤버 아님', 'N', 'authenticated', `select public.space_question_send(${q(SP)}, '남의 공간')`, 'err:not_space_member')}
${call('아무 데도 아닌 사람 = 멤버 아님', 'Z', 'authenticated', `select public.space_question_send(${q(SP)}, '남의 공간')`, 'err:not_space_member')}
${call('매장 번호 = 멤버 아님', 'D', 'authenticated', `select public.space_question_send(${q(X)}, '매장에서')`, 'err:not_space_member')}
${call('빈 글 거절', 'M', 'authenticated', `select public.space_question_send(${q(SP)}, '   ')`, 'err:invalid_argument')}
${call('2001자 거절', 'M', 'authenticated', `select public.space_question_send(${q(SP)}, repeat('가', 2001))`, 'err:invalid_argument')}
${call('로그인 없이 = 실행 권한 없음', null, 'anon', `select public.space_question_send(${q(SP)}, '손님')`, 'deny')}
${call('묻기 제한 없음: 대기 12개째도 됨(매장 직원 대기 10 상한은 공간에 안 건다)', 'M', 'authenticated', `select count(public.space_question_send(${q(SP)}, '채움 ' || g)) from generate_series(1, 10) g`, 'ok|10')}
${val('멤버 대기 12', `select count(*) from public.unknown_queries where unit_id = ${q(SP)} and junior_id = ${q(U.M)} and status = 'pending_owner_answer'`, '12')}
${call('다른 멤버 W 질문', 'W', 'authenticated', `select public.space_question_send(${q(SP)}, 'W 의 질문')`, 'ok|uq_*', 'w1')}
${call('내 질문만 읽음(M = 12 · W 질문 없음)', 'M', 'authenticated', `select count(*) || '/' || count(*) filter (where query_text = 'W 의 질문') from public.space_my_questions(${q(SP)})`, 'ok|12/0')}
${call('W 는 자기 것 1', 'W', 'authenticated', `select count(*) || '/' || string_agg(state, ',') from public.space_my_questions(${q(SP)})`, 'ok|1/waiting')}
${call('주인도 자기 질문만(0)', 'O', 'authenticated', `select count(*)::text from public.space_my_questions(${q(SP)})`, 'ok|0')}
${call('멤버 아닌 사람 내 질문 읽기 거절', 'Z', 'authenticated', `select count(*)::text from public.space_my_questions(${q(SP)})`, 'err:not_space_member')}
${call('주인 벨 = 대기 질문 13', 'O', 'authenticated', `select count(*)::text from public.my_space_notif_data() where source = 'space_question' and unit_id = ${q(SP)}`, 'ok|13')}
${call('멤버 벨에 대기 질문 없음(주인 것)', 'M', 'authenticated', `select count(*)::text from public.my_space_notif_data() where source = 'space_question'`, 'ok|0')}

-- 답 → 질문한 멤버 알림(N4 · 지연 트리거)
${call('주인 보내기 답(m1)', 'O', 'authenticated', `select ((public.reply_unknown_query({V:m1}, '창고 둘째 칸' || chr(10) || '에 있어요')).uq_id is not null)::text`, 'ok|true')}
set constraints all immediate;
set constraints all deferred;
${val('멤버 알림 1 · 제목 · 본문 = 답 글(한 줄) · 착지', `select count(*) || '/' || string_agg(title || '/' || body || '/' || (url = '/space/joined/' || ${q(SP)} || '?uqId=' || {V:m1}), ',') from public.member_notices where user_id = ${q(U.M)} and kind = 'question_answered'`, '1/QA주인님이 내 질문에 답했어요/창고 둘째 칸 에 있어요/true')}
${val('같은 사건 키 남김(앱 길과 안 겹침)', `select count(*) from public.push_client_events where key = 'q-answered:' || {V:m1}`, '1')}
${call('멤버 화면 = 답함 · 답 글 · 답 쓴 사람', 'M', 'authenticated', `select state || '/' || coalesce(answerer_name, '-') || '/' || (reply_body is not null) || '/' || (answered_at is not null) from public.space_my_questions(${q(SP)}) where uq_id = {V:m1}`, 'ok|answered/QA주인/true/true')}
${call('주인이 있는 노하우로 답(m2)', 'O', 'authenticated', `with u as (update public.unknown_queries set status = 'resolved_with_entry', resolved_with_entry_id = ${q(E1)}, answered_by = auth.uid() where id = {V:m2} returning 1) select count(*) from u`, 'ok|1')}
set constraints all immediate;
set constraints all deferred;
${val('노하우 답 알림 본문 = 질문 글(한 줄)', `select body from public.member_notices where user_id = ${q(U.M)} and kind = 'question_answered' and url like '%' || {V:m2}`, '빨대는 어디요')}
${call('멤버 화면 = 그 노하우', 'M', 'authenticated', `select state || '/' || entry_title from public.space_my_questions(${q(SP)}) where uq_id = {V:m2}`, 'ok|answered/멤버 노하우 1')}
${call('멤버 벨 = 답 온 질문 2', 'M', 'authenticated', `select count(*)::text from public.my_space_notif_data() where source = 'space_answered' and unit_id = ${q(SP)}`, 'ok|2')}
delete from public.unit_members where unit_id = ${q(SP)} and user_id = ${q(U.W)};
${call('나간 멤버 질문에 답', 'O', 'authenticated', `select ((public.reply_unknown_query({V:w1}, '나간 뒤 답')).uq_id is not null)::text`, 'ok|true')}
set constraints all immediate;
set constraints all deferred;
${val('나간 멤버에게는 알림 0', `select count(*) from public.member_notices where user_id = ${q(U.W)} and kind = 'question_answered'`, '0')}

-- ════ (다) 이어받기 ════
${call('손님 묻기(L1)', null, 'anon', ask(TK1, 'null', '이어받을손님', '얼음은 몇 개 넣어요'), 'ok|gk_*', 'g1')}
${call('손님 코드 받기', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK1)}, {P1:g1})`, 'ok|*', 'h1')}
${val('코드 모양 = 초대코드 글자 6자 · 영문 하나 이상', `select ({V:h1} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' and {V:h1} ~ '[A-Z]')::text`, 'true')}
${val('코드 원문은 저장 안 함(해시 하나 · 손님에 묶임 · 10분)', `select count(*) || '/' || bool_and(guest_id is not null) || '/' || bool_and(expires_at between now() + interval '9 minutes' and now() + interval '11 minutes') from public.edu_link_handoffs where code_hash = encode(extensions.digest({V:h1}, 'sha256'), 'hex')`, '1/true/true')}
${call('같은 손님 코드 다시 = 새 코드 · 옛 코드는 쓴 것으로', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK1)}, {P1:g1})`, 'ok|*', 'h2')}
${val('옛 코드 쓴 표시', `select (used_at is not null)::text from public.edu_link_handoffs where code_hash = encode(extensions.digest({V:h1}, 'sha256'), 'hex')`, 'true')}
${call('닫힌·없는 링크 코드 = link_closed', null, 'anon', `select code from public.edu_link_handoff_code('nope_${rnd}_nope_nope_x', null)`, 'err:link_closed')}
${call('번호 미인증 계정 = PHONE_NOT_VERIFIED', 'Y', 'authenticated', claim('{V:h2}'), 'err:PHONE_NOT_VERIFIED')}
${call('로그인 없이 넣기 = 실행 권한 없음', null, 'anon', claim('{V:h2}'), 'deny')}
${call('쓴 코드 = invalid_code', 'Z', 'authenticated', claim('{V:h1}'), 'ok|invalid_code/-/-')}
${val('틀린 시도 1행', fails('Z'), '1')}
${call('살아 있는 매장 초대코드 = not_link_code', 'Z', 'authenticated', claim('{V:xcode}'), 'ok|not_link_code/-/-')}
${call('살아 있는 공간 초대코드 = not_link_code(소문자·빈칸도 같은 코드)', 'Z', 'authenticated', claim(`' ' || lower({V:spcode}) || ' '`), 'ok|not_link_code/-/-')}
${val('초대코드는 세지 않음(그대로 1)', fails('Z'), '1')}
${call('코드 넣기 → 옮김', 'Z', 'authenticated', claim('{V:h2}'), `ok|claimed/${L1}/space`)}
${val('손님 행에 내 계정 · 질문 행 질문자 칸은 그대로 비움', `select (g.claimed_by = ${q(U.Z)}) || '/' || (g.claimed_at is not null) || '/' || coalesce(c.junior_id, '-') from public.edu_link_guests g join public.chat_queries c on c.id = {P2:g1} where g.link_id = ${q(L1)} and g.name = '이어받을손님'`, 'true/true/-')}
${val('성공 기록 1 · 틀린 시도 그대로', `select count(*) filter (where ok) || '/' || count(*) filter (where not ok) from public.join_attempts where uid = ${q(U.Z)}`, '1/1')}
${call('같은 코드 두 번째 = invalid_code(한 번만)', 'Z', 'authenticated', claim('{V:h2}'), 'ok|invalid_code/-/-')}
${call('만료 코드 준비', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK2)}, null)`, 'ok|*', 'h3')}
update public.edu_link_handoffs set expires_at = now() - interval '1 second' where code_hash = encode(extensions.digest((select v from ma_v where k = 'h3'), 'sha256'), 'hex');
${call('10분 지난 코드 = invalid_code', 'K', 'authenticated', claim('{V:h3}'), 'ok|invalid_code/-/-')}
${val('앱 길: 틀린 코드 1번 = 실패 1행(합류 함수는 안 부른다)', fails('K'), '1')}
${call('닫을 링크 코드(손님 없이)', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK3)}, null)`, 'ok|*', 'h4')}
update public.edu_links set closed_at = now() where id = ${q(L3)};
${call('그사이 닫힌 링크 = link_closed', 'K', 'authenticated', claim('{V:h4}'), 'err:link_closed')}
${[1, 2, 3, 4, 5].map((n) => call(`없는 코드 직접 ${n}번째 = invalid_code`, 'L', 'authenticated', claim(`'ZZZZZ${n + 3}'`), 'ok|invalid_code/-/-')).join('\n')}
${call('6번째 = too_many_attempts(초대코드와 같은 잠금)', 'L', 'authenticated', claim(`'ZZZZZ9'`), 'err:too_many_attempts')}
${call('맞는 이어받기 코드 준비(손님 없이 · L2)', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK2)}, null)`, 'ok|*', 'h5')}
${call('잠긴 계정은 맞는 이어받기 코드도 거절', 'L', 'authenticated', claim('{V:h5}'), 'err:too_many_attempts')}
insert into public.space_entry_allowlist(user_id, note) values (${q(U.L)}, 'qa');
${call('잠긴 계정은 공간 초대코드도 거절(같은 join 칸)', 'L', 'authenticated', `select count(*)::text from public.join_space_by_code({V:spcode})`, 'err:too_many_attempts')}
${call('손님 없는 코드 20개(링크당 · 위 1개 + 19개)', null, 'anon', `select count(distinct x.c) from (select (select h.code from public.edu_link_handoff_code(${q(TK2)}, nullif(g::text, g::text)) h) as c from generate_series(1, 19) g) x`, 'ok|19')}
${call('21번째 = handoff_busy', null, 'anon', `select code from public.edu_link_handoff_code(${q(TK2)}, null)`, 'err:handoff_busy')}
${call('손님 있는 코드는 20개와 따로', null, 'anon', `select count(*) from public.edu_link_handoff_code(${q(TK1)}, {P1:g1})`, 'ok|1')}
${val('초대코드 발급이 살아 있는 이어받기 코드를 피한다(_new_join_code 본문)', `select (prosrc ~ 'edu_link_handoffs')::text from pg_proc where oid = 'public._new_join_code()'::regprocedure`, 'true')}

-- 옮긴 뒤 답 → 그 계정 알림 · 앱 안 링크
${call('손님 보내기', null, 'anon', `select public.edu_link_send(${q(TK1)}, {P1:g1}, {P2:g1}, false)::text`, 'ok|true')}
${put('g1uq', `select uq_id from public.edu_guest_questions where cq_id = (select split_part(v, '|', 2) from ma_v where k = 'g1')`)}
${call('주인 답', 'O', 'authenticated', `select ((public.reply_unknown_query({V:g1uq}, '세 개요')).uq_id is not null)::text`, 'ok|true')}
set constraints all immediate;
set constraints all deferred;
${val('옮겨 받은 계정 알림 1 · 착지 /link', `select count(*) || '/' || string_agg(title || '/' || body || '/' || (url = '/link/' || ${q(L1)} || '?uqId=' || {V:g1uq}), ',') from public.member_notices where user_id = ${q(U.Z)} and kind = 'question_answered'`, '1/QA주인님이 내 질문에 답했어요/세 개요/true')}
${call('벨 = 링크 답 1', 'Z', 'authenticated', `select count(*) || '/' || string_agg(payload->>'link_id', ',') from public.my_space_notif_data() where source = 'link_answered'`, `ok|1/${L1}`)}
${call('내가 받은 링크 = L1 하나(토큰 · 공간 · 주인 이름 · 노하우 1)', 'Z', 'authenticated', `select count(*) || '/' || string_agg(link_id || '/' || (token = ${q(TK1)}) || '/' || place_kind || '/' || coalesce(owner_name, '-') || '/' || entry_count, ',') from public.my_edu_links()`, `ok|1/${L1}/true/space/QA주인/1`)}
${call('남은 받은 링크 없음', 'M', 'authenticated', `select count(*)::text from public.my_edu_links()`, 'ok|0')}
${call('기기 열쇠 받기', 'Z', 'authenticated', `select key || '|' || name from public.edu_link_me_key(${q(L1)})`, 'ok|gk_*|이어받을손님', 'mk')}
${val('기기 열쇠는 해시만', `select count(*) from public.edu_link_guest_keys where key_hash = encode(extensions.digest({P1:mk}, 'sha256'), 'hex')`, '1')}
${call('기기 열쇠로 답 읽기 = 손님 때 질문 · 답함', null, 'anon', `select count(*) || '/' || string_agg(state || ':' || query_text, ',') from public.edu_link_answers(${q(TK1)}, {P1:mk})`, 'ok|1/answered:얼음은 몇 개 넣어요')}
${call('기기 열쇠로 묻기 = 같은 손님(열쇠 안 줌)', 'Z', 'authenticated', ask(TK1, '{P1:mk}', '무시될이름', '앱에서 물어요'), 'ok|-|cq_*', 'mq')}
${val('앱에서 물은 질문 이름 = 손님 이름 · 계정 칸 비움', `select junior_name || '/' || coalesce(junior_id, '-') from public.chat_queries where id = {P2:mq}`, '이어받을손님/-')}
${call('남의 링크 열쇠 = link_closed', 'M', 'authenticated', `select key from public.edu_link_me_key(${q(L1)})`, 'err:link_closed')}
${call('내 손님 행 없는 링크 열쇠 = link_closed', 'Z', 'authenticated', `select key from public.edu_link_me_key(${q(L2)})`, 'err:link_closed')}

-- 웹 가입 직후 자동 옮기기
${call('새 손님 묻기(L1)', null, 'anon', ask(TK1, 'null', '웹가입손님', '가입 전 질문'), 'ok|gk_*', 'g2')}
${call('가입한 계정이 열쇠로 옮김', 'K', 'authenticated', `select link_id || '/' || claimed from public.edu_link_claim_guest({P1:g2})`, `ok|${L1}/true`)}
${call('두 번 = 그대로 내 것', 'K', 'authenticated', `select link_id || '/' || claimed from public.edu_link_claim_guest({P1:g2})`, `ok|${L1}/true`)}
${call('남이 같은 열쇠 = false', 'M', 'authenticated', `select link_id || '/' || claimed from public.edu_link_claim_guest({P1:g2})`, `ok|${L1}/false`)}
${call('틀린 열쇠 = 0행', 'M', 'authenticated', `select count(*)::text from public.edu_link_claim_guest('gk_${'f'.repeat(48)}')`, 'ok|0')}

-- 답 쓴 사람 본인은 빼기: 주인이 자기 링크 손님 질문을 옮겨 받고 답한다
${call('주인 링크 손님 묻기(L2)', null, 'anon', ask(TK2, 'null', '주인본인', '주인이 물어요'), 'ok|gk_*', 'g3')}
${call('보내기', null, 'anon', `select public.edu_link_send(${q(TK2)}, {P1:g3}, {P2:g3}, false)::text`, 'ok|true')}
${call('주인이 옮겨 받음', 'O', 'authenticated', `select claimed::text from public.edu_link_claim_guest({P1:g3})`, 'ok|true')}
${put('g3uq', `select uq_id from public.edu_guest_questions where cq_id = (select split_part(v, '|', 2) from ma_v where k = 'g3')`)}
${call('주인이 답', 'O', 'authenticated', `select ((public.reply_unknown_query({V:g3uq}, '본인 답')).uq_id is not null)::text`, 'ok|true')}
set constraints all immediate;
set constraints all deferred;
${val('답 쓴 사람 본인에게는 알림 0', `select count(*) from public.member_notices where user_id = ${q(U.O)} and kind = 'question_answered'`, '0')}

-- 링크를 닫으면 끊김(결정 153)
update public.edu_links set closed_at = now() where id = ${q(L1)};
${call('닫힌 링크 = 내 링크 목록에서 빠짐', 'Z', 'authenticated', `select count(*)::text from public.my_edu_links()`, 'ok|0')}
${call('닫힌 링크 = 기기 열쇠 거절', 'Z', 'authenticated', `select key from public.edu_link_me_key(${q(L1)})`, 'err:link_closed')}
${call('닫힌 링크 = 기기 열쇠로 답 읽기 0', null, 'anon', `select count(*)::text from public.edu_link_answers(${q(TK1)}, {P1:mk})`, 'ok|0')}
${call('닫힌 링크 = 벨 링크 답 0', 'Z', 'authenticated', `select count(*)::text from public.my_space_notif_data() where source = 'link_answered'`, 'ok|0')}
${call('닫힌 링크 = 자동 옮기기 0행', 'K', 'authenticated', `select count(*)::text from public.edu_link_claim_guest({P1:g2})`, 'ok|0')}

-- 권한
${call('이어받기 표를 클라가 못 읽음', 'Z', 'authenticated', `select count(*)::text from public.edu_link_handoffs`, 'deny')}
${call('기기 열쇠 표를 클라가 못 읽음', 'Z', 'authenticated', `select count(*)::text from public.edu_link_guest_keys`, 'deny')}
${call('내부 함수(_edu_link_by_id) 클라 실행 불가', 'Z', 'authenticated', `select (public._edu_link_by_id(${q(L2)})).id`, 'deny')}
${call('내 링크 목록 anon 불가', null, 'anon', `select count(*)::text from public.my_edu_links()`, 'deny')}
${call('벨 공급 anon 불가', null, 'anon', `select count(*)::text from public.my_space_notif_data()`, 'deny')}

-- ════ (라) 크론 재확인 · 공간 삭제 알림 ════
insert into public.space_join_requests(space_id, user_id, status) values (${q(SP)}, ${q(U.K)}, 'pending');
insert into public.member_notices(user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id) values
  (${q(U.O)}, ${q(SP)}, 'join_request', 'QA멤버공간', 'QAZ', 'QAZ님이 합류를 신청했어요', '', '/space/settings', ${q(U.Z)}),
  (${q(U.O)}, ${q(SP)}, 'join_request', 'QA멤버공간', 'QAK', 'QAK님이 합류를 신청했어요', '', '/space/settings', ${q(U.K)});
${call('크론 스윕', null, 'service_role', `select count(*)::text from public.sweep_member_notices()`, 'ok|*')}
${val('처리된 요청 알림 = 안 보냄(버림) · 대기 요청 알림 = 그대로 보냄 차례', `select string_agg(actor_name || ':' || coalesce(delivered::text, 'null'), ',' order by actor_name) from public.member_notices where unit_id = ${q(SP)} and kind = 'join_request'`, 'QAK:null,QAZ:0')}
${call('공간 지우기(N)', 'N', 'authenticated', `select public.delete_space(${q(SD)})::text`, 'ok|')}
${val('주인 아닌 멤버 2명에게 알림 · 주인 0 · 제목·본문·착지', `select count(*) || '/' || count(*) filter (where user_id = ${q(U.N)}) || '/' || min(title) || '/' || min(body) || '/' || min(url) || '/' || min(store_name) from public.member_notices where unit_id = ${q(SD)} and kind = 'space_deleted'`, '2/0/공간이 지워졌어요/이제 이 공간의 노하우를 볼 수 없어요.//stores/QA지울멤버공간')}
${val('멤버십은 지워짐', `select count(*) from public.unit_members where unit_id = ${q(SD)}`, '0')}
${call('지운 멤버 벨 = 공간 삭제 1', 'Z', 'authenticated', `select count(*) || '/' || min(payload->>'space_name') from public.my_space_notif_data() where source = 'space_deleted'`, 'ok|1/QA지울멤버공간')}
${val('알림 종류 목록 = 0521 + space_deleted', `select (pg_get_constraintdef(oid) like '%''space_deleted''%' and pg_get_constraintdef(oid) like '%''question''%' and pg_get_constraintdef(oid) like '%''suggestion''%')::text from pg_constraint where conname = 'member_notices_kind_check'`, 'true')}

-- ════ (마) AI 한도 예약 R2~R4 (R1 은 아래 동시 실행) ════
insert into public.ai_usage_monthly(unit_id, month, used) values (${q(SQ)}, ${M_}, 299);
${call('클라는 예약 못 부름', 'O', 'authenticated', `select allowed::text from public.ai_quota_reserve(${q(SQ)}, 1, null)`, 'deny')}
${call('손님은 예약 못 부름', null, 'anon', `select allowed::text from public.ai_quota_reserve(${q(SQ)}, 1, null)`, 'deny')}
${call('클라는 돌려주기 못 부름', 'O', 'authenticated', `select public.ai_quota_refund(${q(SQ)}, 1, null)::text`, 'deny')}
${call('남은 1 → 예약 됨(공간 300)', null, 'service_role', `select allowed || '/' || used_count || '/' || cap_count from public.ai_quota_reserve(${q(SQ)}, 1, null)`, 'ok|true/300/300')}
${call('다 참 → 예약 안 됨 · 사용량 그대로', null, 'service_role', `select allowed || '/' || used_count || '/' || cap_count from public.ai_quota_reserve(${q(SQ)}, 1, null)`, 'ok|false/300/300')}
${call('키 없는 예약 돌려주기', null, 'service_role', `select ${refund(SQ, 1, null)}::text`, 'ok|true')}
${call('필요량이 남은 양보다 크면 안 됨(299 + 2)', null, 'service_role', `select (not allowed)::text from public.ai_quota_reserve(${q(SQ)}, 2, null)`, 'ok|true')}
${val('R3 돌려주면 원래대로(299)', `select used from public.ai_usage_monthly where unit_id = ${q(SQ)} and month = ${M_}`, '299')}
${call('R2 키 첫 예약 = 셈', null, 'service_role', `select allowed || '/' || used_count from public.ai_quota_reserve(${q(SQ)}, 1, 'qa_ma_k1_${rnd}')`, 'ok|true/300')}
${call('R2 같은 키 재시도 = 막지 않음 · 안 셈', null, 'service_role', `select allowed || '/' || used_count from public.ai_quota_reserve(${q(SQ)}, 1, 'qa_ma_k1_${rnd}')`, 'ok|true/300')}
${call('R2 같은 키 세 번째 = 재시도 아님 · 다 차서 막음', null, 'service_role', `select allowed || '/' || used_count from public.ai_quota_reserve(${q(SQ)}, 1, 'qa_ma_k1_${rnd}')`, 'ok|false/300')}
${call('재시도 호출 돌려주기 = 사용량 그대로 · 횟수만', null, 'service_role', `select ${refund(SQ, 1, `qa_ma_k1_${rnd}`)}::text`, 'ok|true')}
${val('사용량 300 · 횟수 1', `select (select used from public.ai_usage_monthly where unit_id = ${q(SQ)} and month = ${M_}) || '/' || (select hits from public.ai_quota_requests where request_key = 'qa_ma_k1_${rnd}')`, '300/1')}
${call('첫 호출 돌려주기 = 사용량 내림 · 키 지움', null, 'service_role', `select ${refund(SQ, 1, `qa_ma_k1_${rnd}`)}::text`, 'ok|true')}
${val('사용량 299 · 키 없음', `select (select used from public.ai_usage_monthly where unit_id = ${q(SQ)} and month = ${M_}) || '/' || (select count(*) from public.ai_quota_requests where request_key = 'qa_ma_k1_${rnd}')`, '299/0')}
update public.ai_usage_monthly set used = 50 where unit_id = ${q(SQ)} and month = ${M_};
${call('50 일 때 60 돌려주기', null, 'service_role', `select ${refund(SQ, 60, null)}::text`, 'ok|true')}
${val('0 밑으로 안 내림', `select used from public.ai_usage_monthly where unit_id = ${q(SQ)} and month = ${M_}`, '0')}
${call('없는 자리 = 안 됨(cap 200)', null, 'service_role', `select allowed || '/' || cap_count from public.ai_quota_reserve('qa_ma_none_${rnd}', 1, null)`, 'ok|false/200')}
insert into public.ai_usage_monthly(unit_id, month, used) values (${q(X)}, ${M_}, 200);
update public.app_config set value = 'false' where key = 'billing_free_mode';
${call('R4 대조: 무료 모드 꺼진 매장 · 다 참 → 안 됨', null, 'service_role', `select allowed || '/' || cap_count from public.ai_quota_reserve(${q(X)}, 1, null)`, 'ok|false/200')}
update public.app_config set value = 'true' where key = 'billing_free_mode';
${call('R4 무료 모드 매장 → 늘 됨', null, 'service_role', `select allowed::text from public.ai_quota_reserve(${q(X)}, 1, null)`, 'ok|true')}
update public.ai_usage_monthly set used = 300 where unit_id = ${q(SQ)} and month = ${M_};
${call('R4 무료 모드여도 공간은 상한을 봄(300 → 안 됨)', null, 'service_role', `select allowed::text from public.ai_quota_reserve(${q(SQ)}, 1, null)`, 'ok|false')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('멤버 묻기 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
  } else {
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|MA|'));
    const expected = (sql.match(/'QA\|MA\|'/g) ?? []).length;
    check(`멤버 묻기 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
    for (const l of lines) {
      const [name, expect, got] = l.slice(6).split('¦');
      let ok;
      if (expect === 'err:*') ok = got.startsWith('err|P0001|');
      else if (expect.startsWith('err:')) ok = got.startsWith('err|P0001|') && got.slice(10).split(/[\s:]/)[0] === expect.slice(4);
      else if (expect === 'deny') ok = got.startsWith('err|42501|');
      else if (expect.includes('*')) ok = !got.startsWith('err|') && got !== 'ok|<null>'
        && new RegExp(`^${expect.split('*').map(escRe).join('.*')}$`).test(got);
      else ok = got === expect;
      check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
    }
  }

  // ── R1: 남은 양 1 · 같은 자리에 동시에 두 번 → 하나만 허용(커밋한 임시 공간 · psql 두 개를 동시에) ──
  const R1 = `qa_mar1_${rnd}`;
  const setup = await psqlAsync(DB, `insert into public.units(id, store_name, kind) values (${q(R1)}, 'QA동시예약', 'space');
insert into public.ai_usage_monthly(unit_id, month, used) values (${q(R1)}, ${M_}, 299);`);
  if (setup.code !== 0) {
    check('R1 셋업', false, setup.err.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 2).join(' | '));
    return;
  }
  try {
    // 둘 다 예약한 뒤 1초 쉬고 커밋한다. 잠금이 없으면 둘 다 299 를 읽고 둘 다 허용된다.
    const one = `begin; set role service_role; select 'R1|' || allowed from public.ai_quota_reserve(${q(R1)}, 1, null); select pg_sleep(1); commit;`;
    const [a, b] = await Promise.all([psqlAsync(DB, one), psqlAsync(DB, one)]);
    const got = [a, b].map((x) => (x.out.match(/R1\|(true|false)/) ?? [])[1] ?? `err:${x.code}`);
    const used = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-tA', '-q'], {
      input: `select used from public.ai_usage_monthly where unit_id = ${q(R1)} and month = ${M_};`, encoding: 'utf8',
    }).stdout.trim();
    check('R1 동시 두 번 → 하나만 허용', got.filter((g) => g === 'true').length === 1 && got.filter((g) => g === 'false').length === 1, `결과 ${got.join(',')}`);
    check('R1 사용량 = 상한(300 · 넘지 않음)', used === '300', `실제 ${used}`);
  } finally {
    const clean = await psqlAsync(DB, `delete from public.ai_usage_monthly where unit_id = ${q(R1)};
delete from public.ai_quota_requests where unit_id = ${q(R1)};
delete from public.units where id = ${q(R1)};`);
    check('R1 임시 공간 정리', clean.code === 0, clean.err.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 2).join(' | '));
  }
  // R5(공간 판정 불가 = 막음)는 엣지 ai/index.ts 의 갈래다. DB 하니스로는 못 재서 건너뛴 것으로 센다(통과로 세지 않는다).
  if (skipped) skipped('R5 공간 예약 실패 → 402(닫힌 쪽)', '엣지 코드 갈래 · DB 하니스 범위 밖 · 기록 = 코드 확인');
}
