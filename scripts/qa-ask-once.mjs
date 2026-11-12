// qa-ask-once.mjs — 0681 검사(로컬 전용 · 한 트랜잭션 · 끝에 rollback · AI 호출 0회)
//
// 무엇을 증명하나:
//   A 교육 링크 손님 첫 질문을 같은 요청 열쇠(p_req)로 두 번 보낸다(앞 응답이 끊긴 경우) → 질문 1 · 손님 1 · 같은 질문 번호 ·
//     둘째에 새 손님 열쇠가 오고 그 열쇠로 내 질문을 읽는다 · 둘째 ai_ready = true(아직 답 없음).
//   B 열쇠를 가진 손님이 같은 요청 열쇠로 다시 보낸다 → 같은 질문 번호 · 열쇠 안 바꿈(null) · 질문 수 그대로.
//   C 요청 열쇠 없이(옛 앱) 두 번 → 질문 2(0550 그대로).
//   D 다른 손님 열쇠로 남의 요청 열쇠를 쓰면 invalid_argument.
//   E '전체 읽음'에서 한 건을 먼저 읽어 둔 뒤 두 건을 요청 → 2(S5-3 · 0681 전 = 1).
//   F 못 보는 방의 행은 여전히 세지 않는다(0).
//   H 열쇠 가진 손님의 둘째 질문 요청 열쇠를 열쇠 없이 다시 보내면 거절 · 앞 열쇠 그대로(/cso M-1).
//   G submit_unknown_query(0634) 가 남의 자리 id 를 받으면 잠그기 전에 not_member(찾은결함 I1-3).
// 쓰는 법: node scripts/qa-ask-once.mjs --local
import { spawnSync } from 'node:child_process';

if (!process.argv.includes('--local')) { console.error('로컬 전용이다. --local 을 붙인다.'); process.exit(2); }
const DB = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
const rnd = Math.random().toString(16).slice(2, 10);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const KS = ['O', 'J'];
const U = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-c${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
const S = Object.fromEntries(KS.map((k, i) => [k, `00000000-0000-4000-d${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
const SP = `qa_aosp_${rnd}`, ST = `qa_aost_${rnd}`, LK = `qa_aol_${rnd}`, TK = `qa_aotok_${rnd}_aaaaaaaaaaaa`;
const REQ1 = `req1${rnd}aaaaaaaaaaaa`, REQ2 = `req2${rnd}bbbbbbbbbbbb`, REQ3 = `req3${rnd}cccccccccccc`;
const ROOM = `qa_aoroom_${rnd}`, F1 = `qa_aof1_${rnd}`, F2 = `qa_aof2_${rnd}`, F3 = `qa_aof3_${rnd}`;

const as = (who, role, body) => `pg_temp.ao_do(${who ? q(U[who]) + '::uuid' : 'null'}, ${who ? q(S[who]) + '::uuid' : 'null'}, ${q(role)}, ${q(body)})`;
const out = (name, expr) => `select 'QA|' || ${q(name)} || '|' || coalesce((${expr})::text, '<null>');`;
const ask = (key, name, text, req) =>
  `select coalesce(guest_key, '-') || ',' || cq_id || ',' || ai_ready from public.edu_link_ask(${q(TK)}, ${key}, ${q(name)}, ${q(text)}${req ? ', ' + q(req) : ''})`;

const sql = String.raw`
begin;
create temp table ao_v(k text primary key, v text);
grant select, insert, update on ao_v to anon, authenticated;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_ao_' || lower(v.k) || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${KS.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${KS.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
update public.profiles set created_at = '2020-01-01' where id in (${KS.map((k) => q(U[k])).join(', ')});
insert into public.units(id, store_name, kind) values (${q(SP)}, 'QA한번공간', 'space'), (${q(ST)}, 'QA한번매장', 'store');
insert into public.unit_members(user_id, unit_id, role) values (${q(U.O)}, ${q(SP)}, 'space_owner'), (${q(U.O)}, ${q(ST)}, 'owner'), (${q(U.J)}, ${q(ST)}, 'junior');
insert into public.session_active_units(session_id, user_id, unit_id) values (${q(S.J)}, ${q(U.J)}, ${q(ST)});
insert into public.space_entry_allowlist(user_id, note) values (${q(U.O)}, 'qa') on conflict do nothing;
insert into public.edu_links(id, unit_id, token, title, entry_ids, expires_at, created_by)
values (${q(LK)}, ${q(SP)}, ${q(TK)}, 'QA 한번 링크', '{}', now() + interval '1 day', ${q(U.O)});
set local session_replication_role = replica;
insert into public.work_rooms(id, unit_id, name, is_default) values (${q(ROOM)}, ${q(ST)}, 'QA 남의 방', false);
insert into public.work_feed(id, unit_id, feed_date, data, room_id) values
  (${q(F1)}, ${q(ST)}, '2026-11-12', '{}', null), (${q(F2)}, ${q(ST)}, '2026-11-12', '{}', null), (${q(F3)}, ${q(ST)}, '2026-11-12', '{}', ${q(ROOM)});
set local session_replication_role = origin;

create function pg_temp.ao_do(p_uid uuid, p_sid uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare r text; m text[]; v text;
begin
  for m in select regexp_matches(p_sql, '\{V:([^}]+)\}', 'g') loop
    select x.v into v from ao_v x where x.k = m[1];
    p_sql := replace(p_sql, '{V:' || m[1] || '}', coalesce(quote_literal(v), 'null'));
  end loop;
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
    else json_build_object('sub', p_uid, 'role', p_role, 'session_id', p_sid)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    r := 'err:' || left(sqlerrm, 60);
  end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.put(k text, v text) returns text language sql as $f$
  insert into ao_v(k, v) values (k, v) on conflict (k) do update set v = excluded.v returning v $f$;

-- A 첫 질문 · 같은 요청 두 번(첫 응답은 끊겼다고 친다)
select pg_temp.put('a1', ${as(null, 'anon', ask('null', '하늘', '마감 때 뭐부터 해요?', REQ1))});
select pg_temp.put('a2', ${as(null, 'anon', ask('null', '하늘', '마감 때 뭐부터 해요?', REQ1))});
${out('A1', `(select v from ao_v where k = 'a1')`)}
${out('A2', `(select v from ao_v where k = 'a2')`)}
${out('A 질문 수', `(select count(*) from public.edu_guest_questions where link_id = ${q(LK)})`)}
${out('A 손님 수', `(select count(*) from public.edu_link_guests where link_id = ${q(LK)})`)}
select pg_temp.put('k2', split_part((select v from ao_v where k = 'a2'), ',', 1));
${out('A 새 열쇠로 읽기', `${as(null, 'anon', `select count(*)::text from public.edu_link_answers(${q(TK)}, {V:k2})`)}`)}
-- B 열쇠 가진 손님이 같은 요청 다시
select pg_temp.put('b', ${as(null, 'anon', `select coalesce(guest_key, '-') || ',' || cq_id from public.edu_link_ask(${q(TK)}, {V:k2}, '하늘', '마감 때 뭐부터 해요?', ${q(REQ1)})`)});
${out('B', `(select v from ao_v where k = 'b')`)}
${out('B 질문 수', `(select count(*) from public.edu_guest_questions where link_id = ${q(LK)})`)}
-- C 옛 앱(요청 열쇠 없음) 두 번
select pg_temp.put('c0', ${as(null, 'anon', `select coalesce(guest_key, '-') from public.edu_link_ask(${q(TK)}, null, '구름', '옛 앱 질문')`)});
${out('C0', `(select v from ao_v where k = 'c0')`)}
${out('C1', `${as(null, 'anon', `select cq_id from public.edu_link_ask(${q(TK)}, {V:c0}, '구름', '옛 앱 질문')`)}`)}
${out('C 옛 앱 질문 수', `(select count(*) from public.edu_guest_questions g join public.chat_queries c on c.id = g.cq_id where g.link_id = ${q(LK)} and c.query_text = '옛 앱 질문')`)}
-- D 다른 손님이 남의 요청 열쇠
select pg_temp.put('d0', ${as(null, 'anon', ask('null', '바다', '다른 사람 질문', REQ2))});
select pg_temp.put('kd', split_part((select v from ao_v where k = 'd0'), ',', 1));
${out('D', `${as(null, 'anon', `select cq_id from public.edu_link_ask(${q(TK)}, {V:kd}, '바다', '마감 때 뭐부터 해요?', ${q(REQ1)})`)}`)}
-- E · F 전체 읽음
select ${as('J', 'authenticated', `select public.mark_feed_read(${q(F1)})::text`)};
${out('E', `${as('J', 'authenticated', `select public.mark_all_feed_read(array[${q(F1)}, ${q(F2)}])::text`)}`)}
${out('F', `${as('J', 'authenticated', `select public.mark_all_feed_read(array[${q(F3)}])::text`)}`)}
-- H 열쇠(k2)를 가진 손님의 둘째 질문 요청 열쇠를 열쇠 없이 다시 보내면 거절 · k2 는 그대로 쓸 수 있다(/cso M-1)
select ${as(null, 'anon', `select cq_id from public.edu_link_ask(${q(TK)}, {V:k2}, '하늘', '둘째 질문', ${q(REQ3)})`)};
${out('H', `${as(null, 'anon', `select cq_id from public.edu_link_ask(${q(TK)}, null, '하늘', '둘째 질문', ${q(REQ3)})`)}`)}
${out('H 앞 열쇠 그대로', `${as(null, 'anon', `select count(*)::text from public.edu_link_answers(${q(TK)}, {V:k2})`)}`)}
-- G 남의 공간 id 로 질문 보내기(J 는 SP 멤버가 아니다)
${out('G', `${as('J', 'authenticated', `select public.submit_unknown_query('qa_aouq_${rnd}', '남의 공간 질문', ${q(SP)})::text`)}`)}
rollback;
`;

const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); console.log('\nRED — 셋업 실패'); process.exit(1); }
if (process.env.QA_DEBUG) console.log(r.stdout);
const got = Object.fromEntries(r.stdout.split('\n').filter((l) => l.startsWith('QA|')).map((l) => { const [, k, ...v] = l.split('|'); return [k, v.join('|')]; }));
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`); };
const [a1k, a1cq] = (got.A1 ?? '').split(','); const [a2k, a2cq, a2ai] = (got.A2 ?? '').split(',');
console.log('\n[0681] 손님 질문 한 번 · 전체 읽음 수');
check('A 같은 요청 두 번 = 같은 질문 번호', /^cq_/.test(a1cq ?? '') && a1cq === a2cq, `${got.A1} / ${got.A2}`);
check('A 질문 1 · 손님 1', got['A 질문 수'] === '1' && got['A 손님 수'] === '1', `질문 ${got['A 질문 수']} · 손님 ${got['A 손님 수']}`);
check('A 둘째에 새 열쇠 · 앞 열쇠와 다름', a2k && a2k !== '-' && a2k !== a1k, `${a1k} / ${a2k}`);
check('A 새 열쇠로 내 질문을 읽는다', got['A 새 열쇠로 읽기'] === '1', got['A 새 열쇠로 읽기']);
check('A 둘째 ai_ready = true(아직 답 없음)', a2ai === 'true', got.A2);
check('B 열쇠 가진 다시 보내기 = 같은 번호 · 열쇠 안 줌', got.B === `-,${a1cq}`, got.B);
check('B 질문 수 그대로 1', got['B 질문 수'] === '1', got['B 질문 수']);
check('C 요청 열쇠 없음(옛 앱) = 0550 그대로 2건', got['C 옛 앱 질문 수'] === '2', got['C 옛 앱 질문 수']);
check('D 남의 요청 열쇠 = invalid_argument', /invalid_argument/.test(got.D ?? ''), got.D);
check('E 먼저 한 건 읽고 전체 읽음 2건 = 2', got.E === '2', got.E);
check('F 못 보는 방 = 0', got.F === '0', got.F);
check('H 둘째 질문 요청 열쇠를 열쇠 없이 = invalid_argument(열쇠 안 바꿈)', /invalid_argument/.test(got.H ?? ''), got.H);
check('H 앞 열쇠로 그대로 읽는다(질문 셋)', Number(got['H 앞 열쇠 그대로']) >= 2, got['H 앞 열쇠 그대로']);
check('G 남의 공간 id 로 질문 보내기 = 잠그기 전에 not_member(I1-3)', /not_member/.test(got.G ?? ''), got.G);
console.log(`\n${fail ? 'RED' : 'GREEN'} — pass ${pass} · fail ${fail} · skip 0 (AI 호출 0회)`);
process.exit(fail ? 1 : 0);
