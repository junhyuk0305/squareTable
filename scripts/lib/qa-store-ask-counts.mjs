// qa-store-ask-counts.mjs — 매장 묻기 먼저(0520 · 공간·매장 통합 6번 덩이 서버) 검사. qa-space-isolation.mjs 가 한 줄로 부른다.
//
// 무엇을 증명하나: 승인 대기 판정이 서버 한 곳(_uq_in_review)이고 미응답 숫자 · 벨 · 앱 목록 계산 칸이 같은 답을 낸다.
//   · 승인 대기 질문은 다른 직원·사장 벨의 질문 줄에서 빠지고, 그 답을 제안한 직원에게는 남는다.
//   · 미응답 = 기간 없이 지금 대기 전부에서 승인 대기를 뺀 수(지난달 대기 질문도 든다).
//   · 허브 숫자(owner_question_counts)는 내가 사장인 매장만 매장별로 준다. 공간·남의 매장·직원은 0행.
//   · 질문자 알림 제목 이름 = 답 쓴 사람(승인한 사장이 아니다).
//   · 매장 배치 스위치(store/ask_first)는 꺼짐 · 허용 목록 계정에게만 켜짐.
// 방식: 한 트랜잭션 안에서 계정·매장 셋·공간 하나를 따로 심고(데모 매장을 안 쓴다) 끝에 rollback 한다 = 공유 로컬 DB 흔적 0.
//   호출은 authenticated 역할 + JWT 클레임(세션 번호 포함)으로 흉내 낸다.
// 로컬 전용(부르는 쪽이 --local 을 이미 확인한다). AI 호출 0회.
import { spawnSync } from 'node:child_process';

export function runStoreAskChecks({ DB, check }) {
  console.log('\n[7] 매장 묻기 먼저(0520) · 승인 대기 · 미응답 · 허브 숫자 · 알림 이름');
  const rnd = Math.random().toString(16).slice(2, 10);
  const K = ['D', 'G', 'J1', 'J2', 'J3', 'E', 'A'];
  // D 매장 X·X2 사장 · G X 매니저 · J1 X 직원(질문자) · J2 X 직원(답 제안) · J3 X 직원(남) · E 매장 Y 사장 · A 공간 SP 주인
  const U = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-c${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const S = Object.fromEntries(K.map((k, i) => [k, `00000000-0000-4000-d${rnd.slice(0, 3)}-${rnd}${String(i).padStart(4, '0')}`]));
  const X = `qa_sax_${rnd}`, X2 = `qa_sax2_${rnd}`, Y = `qa_say_${rnd}`, SP = `qa_sasp_${rnd}`;
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const uq = (n) => `qa_sauq${n}_${rnd}`;
  const call = (name, who, body, expect) =>
    `select 'QA|SA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.sa_do(${q(U[who])}, ${q(S[who])}, ${q(body)});`;
  const val = (name, body, expect) => `select 'QA|SA|' || ${q(name)} || '¦' || ${q(expect)} || '¦' || pg_temp.sa_val(${q(body)});`;
  const lastMonth = `(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '2 days'`;
  // 벨에서 그 질문 줄이 있나(uq 줄 · 질문 번호)
  const bellHas = (id) => `select count(*)::text from public.my_units_notif_data() n where n.source = 'uq' and n.payload->>'id' = ${q(id)}`;
  const counts = (u) => `select questions || '/' || ai_answered || '/' || direct_answered || '/' || unanswered from public.unit_question_counts(${q(u)})`;
  const hub = `select coalesce(string_agg(unit_id || ':' || direct_answered || '/' || unanswered || '/' || in_review, ',' order by unit_id collate "C"), '-') from public.owner_question_counts()`;

  const sql = String.raw`
begin;
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_sa_' || v.k || '_${rnd}@example.com',
       jsonb_build_object('name', 'QA' || v.k, 'role', 'junior', 'birth_date', '1994-03-03'), now(), now(), now()
  from (values ${K.map((k) => `(${q(k)}, ${q(U[k])})`).join(', ')}) v(k, id);
insert into auth.sessions(id, user_id, created_at, updated_at)
select v.sid::uuid, v.uid::uuid, now(), now() from (values ${K.map((k) => `(${q(S[k])}, ${q(U[k])})`).join(', ')}) v(sid, uid);
-- 이름은 알림 제목 검사에 쓴다(가입 트리거가 만든 프로필을 덮는다).
insert into public.profiles(id, name) values ${K.map((k) => `(${q(U[k])}::uuid, ${q('큐에이' + k)})`).join(', ')} on conflict (id) do update set name = excluded.name;

insert into public.units(id, store_name, kind) values
  (${q(X)}, 'QA묻기매장', 'store'), (${q(X2)}, 'QA묻기둘째', 'store'), (${q(Y)}, 'QA남의매장', 'store'), (${q(SP)}, 'QA묻기공간', 'space');
insert into public.unit_members(user_id, unit_id, role) values
  (${q(U.D)}, ${q(X)}, 'owner'), (${q(U.D)}, ${q(X2)}, 'owner'), (${q(U.G)}, ${q(X)}, 'manager'),
  (${q(U.J1)}, ${q(X)}, 'junior'), (${q(U.J2)}, ${q(X)}, 'junior'), (${q(U.J3)}, ${q(X)}, 'junior'),
  (${q(U.E)}, ${q(Y)}, 'owner'), (${q(U.A)}, ${q(SP)}, 'space_owner');
-- 무료 좌석 상한(직원 2) 때문에 잠기지 않게 넷 다 사장이 고른 좌석으로 둔다.
insert into public.unit_kept_seats(unit_id, user_id) values
  (${q(X)}, ${q(U.G)}), (${q(X)}, ${q(U.J1)}), (${q(X)}, ${q(U.J2)}), (${q(X)}, ${q(U.J3)});
insert into public.session_active_units(session_id, user_id, unit_id) values
  (${q(S.D)}, ${q(U.D)}, ${q(X)}), (${q(S.G)}, ${q(U.G)}, ${q(X)}), (${q(S.J1)}, ${q(U.J1)}, ${q(X)}),
  (${q(S.J2)}, ${q(U.J2)}, ${q(X)}), (${q(S.J3)}, ${q(U.J3)}, ${q(X)}), (${q(S.E)}, ${q(U.E)}, ${q(Y)});
insert into public.session_active_spaces(session_id, user_id, space_id) values (${q(S.A)}, ${q(U.A)}, ${q(SP)});

-- 질문: 1 = 이번 달 대기 + J2 답 제안 대기(승인 대기) · 2 = 지난달 대기 · 3 = 이번 달 해결(답 쓴 J2 · 승인 D)
--   · 4 = X2 대기 · 5 = Y 대기 · 6 = 공간 대기 · 7 = 이번 달 해결 + 남은 대기 제안(승인 대기 아님)
insert into public.unknown_queries(id, unit_id, query_text, junior_id, status, asked_at, answer_author_id, answered_by) values
  (${q(uq(1))}, ${q(X)}, 'QA 질문 하나', ${q(U.J1)}, 'pending_owner_answer', now(), null, null),
  (${q(uq(2))}, ${q(X)}, 'QA 지난달 질문', ${q(U.J1)}, 'pending_owner_answer', ${lastMonth}, null, null),
  (${q(uq(3))}, ${q(X)}, 'QA 답 온 질문', ${q(U.J1)}, 'resolved_with_entry', now(), ${q(U.J2)}, ${q(U.D)}),
  (${q(uq(4))}, ${q(X2)}, 'QA 둘째 매장 질문', null, 'pending_owner_answer', now(), null, null),
  (${q(uq(5))}, ${q(Y)}, 'QA 남의 매장 질문', null, 'pending_owner_answer', now(), null, null),
  (${q(uq(6))}, ${q(SP)}, 'QA 공간 질문', null, 'pending_owner_answer', now(), null, null),
  (${q(uq(7))}, ${q(X)}, 'QA 먼저 해결된 질문', ${q(U.J1)}, 'resolved_with_entry', now(), ${q(U.D)}, ${q(U.D)});
-- 넣기 트리거(0007)가 질문자 칸을 세션 사람으로 다시 찍는다(서비스 권한이면 비움). 질문자는 넣은 뒤 고쳐 적는다.
update public.unknown_queries set junior_id = ${q(U.J1)} where id in (${[1, 2, 3, 7].map((n) => q(uq(n))).join(', ')});
insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status, source_uq_id) values
  ('qa_saps1_${rnd}', ${q(X)}, 'new', ${q(U.J2)}, '큐에이J2', 'QA 답 제안', 'pending', ${q(uq(1))}),
  ('qa_saps7_${rnd}', ${q(X)}, 'new', ${q(U.J3)}, '큐에이J3', 'QA 늦은 답 제안', 'pending', ${q(uq(7))}),
  ('qa_saps8_${rnd}', ${q(X)}, 'improve', ${q(U.J3)}, '큐에이J3', 'QA 개선 제안', 'pending', null);

create function pg_temp.sa_do(p_uid uuid, p_sid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
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
create function pg_temp.sa_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err|' || sqlstate || '|' || left(sqlerrm, 60);
end $f$;

-- ── 승인 대기 판정(계산 칸) ──
${call('계산 칸: 승인 대기 질문 = true(남 직원 J3 이 봐도)', 'J3', `select public.uq_in_review(q) from public.unknown_queries q where q.id = ${q(uq(1))}`, 'ok|true')}
${call('계산 칸: 지난달 대기 질문 = false', 'J3', `select public.uq_in_review(q) from public.unknown_queries q where q.id = ${q(uq(2))}`, 'ok|false')}
${call('계산 칸: 해결된 질문에 남은 대기 제안 = false(승인 대기 아님)', 'D', `select public.uq_in_review(q) from public.unknown_queries q where q.id = ${q(uq(7))}`, 'ok|false')}
${call('계산 칸: 남의 매장 사람(E)이 X 질문 값을 직접 넣으면 null', 'E', `select coalesce(public.uq_in_review(jsonb_populate_record(null::public.unknown_queries, jsonb_build_object('id', ${q(uq(1))}, 'unit_id', ${q(X)}, 'status', 'pending_owner_answer')))::text, '<null>')`, 'ok|<null>')}
${call('계산 칸: E 가 자기 매장 번호에 X 질문 번호를 넣으면 false', 'E', `select public.uq_in_review(jsonb_populate_record(null::public.unknown_queries, jsonb_build_object('id', ${q(uq(1))}, 'unit_id', ${q(Y)}, 'status', 'pending_owner_answer')))::text`, 'ok|false')}
${call('계산 칸: 안쪽 함수는 앱이 직접 못 부른다', 'J3', `select public._uq_in_review(${q(uq(1))}, ${q(X)}, 'pending_owner_answer')::text`, 'err:42501')}

-- ── 그 자리 숫자(질문/AI/직접/미응답) ──
${call('X 사장 숫자: 직접 답변 2 · 미응답 1(지난달 대기 듦 · 승인 대기 빠짐)', 'D', counts(X), 'ok|0/0/2/1')}
${call('X 매니저 숫자도 같다', 'G', counts(X), 'ok|0/0/2/1')}
${call('X 직원은 숫자를 못 본다', 'J3', counts(X), 'err:not_manager')}
${call('공간 주인 숫자: 공간 대기 1(공간에는 제안이 없다)', 'A', counts(SP), 'ok|0/0/0/1')}

-- ── 허브 숫자(내가 사장인 매장마다 · 직접/미응답/승인 대기) ──
${call('허브: D = X·X2 두 줄(승인 대기 = 대기 제안 전부 3 · 공간·남의 매장 없음)', 'D', hub, `ok|${[`${X}:2/1/3`, `${X2}:0/1/0`].sort().join(',')}`)}
${call('허브: E = 자기 매장 Y 한 줄만', 'E', hub, `ok|${Y}:0/1/0`)}
${call('허브: 직원 J1 = 0줄', 'J1', hub, 'ok|-')}
${call('허브: 매니저 G = 0줄(사장만)', 'G', hub, 'ok|-')}
${call('허브: 공간 주인 A = 0줄(공간은 안 셈)', 'A', hub, 'ok|-')}
${call('허브 X 줄 = 그 자리 숫자와 같다(몸체 한 곳)', 'D', `select (select questions || '/' || ai_answered || '/' || direct_answered || '/' || unanswered from public.owner_question_counts() where unit_id = ${q(X)}) = (${counts(X)})`, 'ok|true')}

-- ── 벨(my_units_notif_data uq 줄) ──
${call('벨: 남 직원 J3 에게 승인 대기 질문 없음', 'J3', bellHas(uq(1)), 'ok|0')}
${call('벨: 질문자 J1 에게도 승인 대기 질문 없음(답 제안자가 아니다)', 'J1', bellHas(uq(1)), 'ok|0')}
${call('벨: 답 제안한 J2 에게는 남음', 'J2', bellHas(uq(1)), 'ok|1')}
${call('벨: 사장 D 질문 줄에서 빠짐', 'D', bellHas(uq(1)), 'ok|0')}
${call('벨: 사장 D 는 검토 대기(sugg)로 받는다', 'D', `select count(*)::text from public.my_units_notif_data() n where n.source = 'sugg' and n.payload->>'id' = 'qa_saps1_${rnd}'`, 'ok|1')}
${call('벨: 지난달 대기 질문은 J3 에게 있음', 'J3', bellHas(uq(2)), 'ok|1')}
${call('벨: J2 의 질문 줄 in_review = true', 'J2', `select n.payload->>'in_review' from public.my_units_notif_data() n where n.source = 'uq' and n.payload->>'id' = ${q(uq(1))}`, 'ok|true')}
${call('벨: 남의 매장 질문 없음', 'J3', bellHas(uq(5)), 'ok|0')}

-- ── 질문자 알림 이름 = 답 쓴 사람 ──
${val('알림 제목: 승인한 D 가 보내도 이름 = 답 쓴 J2', `select ok || '|' || reason || '|' || coalesce(title,'') from public.push_client_event_v2(${q(U.D)}, ${q(X)}, null, 'user', 'q-answered', ${q(uq(3))}, ${q(U.J1)})`, 'true|ok|큐에이J2님이 내 질문에 답했어요')}
${val('알림 제목: 사장이 바로 답했으면 이름 = 사장', `select ok || '|' || reason || '|' || coalesce(title,'') from public.push_client_event_v2(${q(U.D)}, ${q(X)}, null, 'user', 'q-answered', ${q(uq(7))}, ${q(U.J1)})`, 'true|ok|큐에이D님이 내 질문에 답했어요')}

-- ── 매장 배치 스위치 ──
${call('스위치: ask_first 기본 꺼짐', 'J1', `select enabled::text from public.my_kind_features() where kind = 'store' and feature = 'ask_first'`, 'ok|false')}
insert into public.space_entry_allowlist(user_id, note) values (${q(U.J1)}, 'qa 0520');
${call('스위치: 허용 목록 계정에게는 켜짐', 'J1', `select enabled::text from public.my_kind_features() where kind = 'store' and feature = 'ask_first'`, 'ok|true')}
${call('스위치: 허용 목록 밖은 그대로 꺼짐', 'J3', `select enabled::text from public.my_kind_features() where kind = 'store' and feature = 'ask_first'`, 'ok|false')}

-- ── 반려하면 질문이 저절로 다시 나타난다(파생) ──
update public.playbook_suggestions set status = 'rejected', reviewed_at = now() where id = 'qa_saps1_${rnd}';
${call('반려 뒤: J3 벨에 질문 다시 있음', 'J3', bellHas(uq(1)), 'ok|1')}
${call('반려 뒤: X 미응답 2', 'D', counts(X), 'ok|0/0/2/2')}
rollback;
`;

  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    check('묻기 숫자 검사 셋업', false, (r.stderr || '').split('\n').filter((l) => /ERROR|DETAIL|LINE/.test(l)).slice(0, 4).join(' | '));
    return;
  }
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('QA|SA|'));
  // 줄이 통째로 빠져도 통과하지 않게 기대 줄 수를 센다.
  const expected = (sql.match(/'QA\|SA\|'/g) ?? []).length;
  check(`묻기 숫자 검사 줄 수 ${lines.length}/${expected}`, lines.length === expected && expected > 0);
  for (const l of lines) {
    const [name, expect, got] = l.slice(6).split('¦');
    let ok;
    // 오류는 코드가 정확히 같아야 한다. err:42501 처럼 숫자면 SQLSTATE 를 본다.
    if (expect.startsWith('err:')) {
      const code = expect.slice(4);
      ok = /^\d{5}$/.test(code) ? got.startsWith(`err|${code}|`) : got.startsWith('err|P0001|') && got.slice(10).split(/[\s:]/)[0] === code;
    } else ok = got === expect;
    check(name, ok, ok ? '' : `기대 ${expect} · 실제 ${got}`);
  }
}
