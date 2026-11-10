// qa-space-store-link.mjs — 매장과 연결하기(0490 · 공간·매장 통합 5번 덩이 서버) 검사. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나: 제안은 "그 공간 주인 + 받는 매장 직원·매니저"만 · 승인은 받는 매장의 현재 사장·매니저만 ·
//   승인하면 사본은 매장 행 · 원본은 그대로 · 거절하면 사본 0 · 보낸 뒤 원본을 고쳐도 보낸 때 내용으로 간다 ·
//   공간 사람이 매장 사본을 못 고친다 · 공간에서 온 제안은 앱이 직접 만들거나 고칠 수 없다.
// 방식: 한 트랜잭션 안에서 계정·매장 둘·공간 둘을 따로 심고(데모 매장을 안 쓴다) 끝에 rollback 한다 = 공유 로컬 DB 흔적 0.
//   호출은 authenticated 역할 + JWT 클레임(세션 번호 포함)으로 흉내 낸다. 매장·공간 현재 자리는 세션 표에 심는다.
// 로컬 전용(부르는 쪽이 --local 을 이미 확인한다). AI 호출 0회.
import { spawnSync } from 'node:child_process';

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
  (${q(e(8))}, ${q(SP)}, '서비스', '연결 노하우 8', 'published', 'space_owner', '{}'::jsonb, '{}');

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
${val('제안 = 승인됨 · 검토한 사람 사장', `select status || '/' || reviewed_by from public.playbook_suggestions where id = ${sugOf(1)}`, `approved/${U.D}`)}
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
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('연결 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
    return;
  }
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|SL|'));
  // 줄이 통째로 빠져도 통과하지 않게 기대 줄 수를 센다(SQL 의 call·val 줄 수와 같다).
  const expected = (sql.match(/'QA\|SL\|'/g) ?? []).length;
  check(`연결 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
  for (const l of lines) {
    const [name, expect, got] = l.slice(6).split('¦');
    let ok;
    // 오류는 코드 낱말이 정확히 같아야 한다(err|SQLSTATE|코드 …). 부분 일치로 다른 코드가 통과하지 않게.
    if (expect.startsWith('err:')) ok = got.startsWith('err|P0001|') && got.slice(10).split(/[\s:]/)[0] === expect.slice(4);
    else if (expect.endsWith('*')) ok = got.startsWith(expect.slice(0, -1)) && !got.startsWith('err|') && got !== 'ok|<null>';
    else ok = got === expect;
    check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
  }
}
