-- 0520_store_ask_counts.sql — 매장 묻기 먼저(공간·매장 통합 6번 덩이 서버) · 승인 대기 판정 하나 · 사장 현황 숫자 줄 (2026-11-11)
-- 옛 앱 호환: 안전 | 함수 drop 없음 · 표·칸·제약·RLS·publication 무변경. 기능 줄 하나(꺼짐)를 더한다.
--   ① uq_in_review · _uq_in_review · _unit_question_counts · owner_question_counts = 새 함수. 옛 앱은 모른다.
--   ② unit_question_counts(0380) = 2번 덩이가 만든 새 함수라 옛 앱이 안 부른다. 공간 홈 숫자가 같이 바뀐다.
--   ③ my_units_notif_data(0367) = 옛 앱 벨도 부른다. 반환 열(unit_id · source · payload)은 그대로다.
--      바뀌는 것: 승인 대기 질문이 제안한 사람 밖의 벨에서 빠진다(옛 앱 벨도 같이 나아진다 · 3판 16장 "안전").
--      uq 줄 payload 에 in_review 키가 하나 붙는다. 옛 앱은 모르는 키를 무시한다(UnknownQuery 로 읽고 안 쓴다).
--   ④ push_client_event_v2(0357) = 엣지가 부른다. 서명·반환 그대로. q-answered 제목 이름만 "답 쓴 사람"으로 바뀐다.
--      옛 사장 앱이 승인해도 서버가 제목을 만들므로 같이 고쳐진다.
--   ⑤ my_kind_features(0374) = 옛 앱도 부른다(공간 입구 판정). ('space','enter') 줄 결과는 글자 그대로 같다.
--      새 줄 ('store','ask_first') 은 꺼짐 + 허용 목록 계정에게만 켜짐. 옛 앱은 이 줄을 안 본다.
--   ⑥ owner_overview(0299)는 고치지 않는다. 옛 앱 허브가 부른다(옛 "답 기다리는 질문" 숫자 그대로).
--
-- 정본: 데이터구조 3판 8-5(숫자 정의) · 부록 A-3(uq_in_review) · 4장 함정(허브에서 현재 매장 함수 금지) ·
--   화면착수조사_6번덩이 "사용자 결정"(미응답 = 기간 없이 지금 대기 전부 · 질문·AI 답변·직접 답변 = 이번 달).
--
-- ── 승인 대기 판정(한 곳) ─────────────────────────────────────────────────
--   승인 대기 질문 = 대기(pending_owner_answer) 질문이고, 그 질문을 답으로 단 대기 중 제안이 같은 자리에 있다
--     (playbook_suggestions.source_uq_id = 질문 · status 'pending' · unit_id 같음).
--   저장 칸이 아니라 파생이다. 제안은 승인 · 반려 · 취소(0355 보관 표로 이동) · 수정으로 바뀌고 옛 사장 앱의 반려 길은
--     새 칸을 모른다. 파생이면 어느 길로 바뀌어도 맞다(AGENTS ④ · 3판 8-3).
--   정의자로 본다. 제안 읽기 정책(ps_select 0093:62)은 제안한 본인과 관리자만 열어서, 앱이 거르면 제안한 사람 화면에서만
--     빠졌다(결함: 다른 직원 목록·배지·벨에 남음). 정의자 함수 하나가 모두에게 같은 답을 준다.
--   해결된 질문에 남은 대기 제안은 "승인 대기"가 아니다(질문이 이미 대기가 아니다). 남은 제안 정리는 이 파일 밖이다.
--   한 질문에 답 제안이 여럿이면 하나라도 대기면 승인 대기다. 벨에는 대기 제안을 낸 사람 모두에게 남는다.
--   허브 숫자는 닫힌 매장도 센다(사장은 닫힌 매장에서도 벨을 받는다 · my_units_notif_data my CTE 와 같은 방침).
--   쓰는 곳: 미응답 숫자(_unit_question_counts) · 벨(my_units_notif_data) · 앱 목록(fetchUnknownQueue 계산 칸 uq_in_review).
--
-- ── 숫자 정의(_unit_question_counts · 그 자리 하나 · 권한 검사 없음 · 부르는 함수가 검사한다) ──
--   questions · ai_answered = 0380 그대로(이번 달 서울 · chat_queries · 잡담 뺌).
--   direct_answered = 0380 그대로(이번 달 물은 답할 질문 중 사람이 답한 수).
--   ★0520 unanswered = 기간 없이 지금 대기 전부에서 승인 대기를 뺀 수. 0380 은 이번 달에 물은 것만 세서
--     10월 31일에 온 대기 질문이 11월 1일에 숫자에서 사라지고 목록에는 남았다(사용자 결정 11-11).
--   in_review(허브만) = 그 매장의 대기 제안 전부(개선 · 새 노하우 · 공간에서 온 것). 제안함 숫자와 같다.
--     질문에 달린 답 제안만 세면 제안함에 쌓인 수와 어긋난다. owner_overview.sugg_pending 과 같은 정의다.
--
-- ── 권한 ───────────────────────────────────────────────────────────────────
--   unit_question_counts = 0380 그대로(그 자리 answer_direct 권한 · 현재 자리일 때만 · 공간 주인).
--   owner_question_counts = 계정 층(허브). 멤버 표 역할 owner 인 매장만. 현재 매장 함수(auth_can · auth_is_owner ·
--     auth_can_manage)는 쓰지 않는다(4장 함정: 현재 매장일 때만 참이라 다른 매장 숫자가 0 이 된다). 공간은 세지 않는다.
--   uq_in_review(u) = 그 질문 자리의 멤버에게만 답한다(아니면 null). 남이 질문 번호를 넣어 남의 매장 제안 여부를
--     떠보지 못하게 한다. 같은 자리 제안만 보므로 내 자리 번호에 남의 질문 번호를 넣어도 false 다.
-- 새 오류 코드 없음(not_authenticated 는 있는 코드).
-- 검증: qa:space-isolation:local([7] 매장 숫자·승인 대기 · scripts/lib/qa-store-ask-counts.mjs) · qa:task-knowhow:local · qa:notif-axis
-- 되돌리기: scripts/rollback/0520.sql

-- ══════════════════════════════════════════════════════════════════════════
-- ① 승인 대기 판정
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public._uq_in_review(p_uq_id text, p_unit text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_status = 'pending_owner_answer'
     and exists (select 1 from public.playbook_suggestions ps
                  where ps.source_uq_id = p_uq_id and ps.unit_id = p_unit and ps.status = 'pending')
$$;
revoke all on function public._uq_in_review(text, text, text) from public, anon, authenticated;

-- PostgREST 계산 칸: select('*, uq_in_review') 로 읽는다. 행은 이미 uq_select(RLS)를 지났다.
create or replace function public.uq_in_review(u public.unknown_queries)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.unit_members m where m.unit_id = u.unit_id and m.user_id = (select auth.uid()))
      then public._uq_in_review(u.id, u.unit_id, u.status)
    else null
  end
$$;
revoke all on function public.uq_in_review(public.unknown_queries) from public, anon, authenticated;
grant execute on function public.uq_in_review(public.unknown_queries) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ② 숫자 몸체 하나 + 두 입구(그 자리 · 허브)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public._unit_question_counts(p_unit text)
returns table(questions int, ai_answered int, direct_answered int, unanswered int)
language sql stable security definer set search_path = public as $$
  with b as (
    select date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as v_from,
           (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul' as v_to
  )
  select
    -- 0380 정의: 잡담(response_block.mode = 'smalltalk')은 질문이 아니다(useChatStore 0단계 의도 판정).
    (select count(*) filter (where coalesce(c.response_block->>'mode', '') <> 'smalltalk')::int
       from public.chat_queries c, b where c.unit_id = p_unit and c.asked_at >= b.v_from and c.asked_at < b.v_to),
    -- 0380 정의: ★was_deflected 만 보면 안 된다(잡담 답도 true). 참고 노하우가 있거나 mode 가 served·generated 인 것만.
    --   AI 답변은 질문 기록에서만 센다(손님 질문은 답할 질문에도 auto_answered 로 남아 두 번 셀 수 있다 · 8-5).
    (select count(*) filter (where c.was_deflected
                               and coalesce(c.response_block->>'mode', '') <> 'smalltalk'
                               and (coalesce(cardinality(c.matched_entry_ids), 0) > 0
                                    or c.response_block->>'mode' in ('served', 'generated')))::int
       from public.chat_queries c, b where c.unit_id = p_unit and c.asked_at >= b.v_from and c.asked_at < b.v_to),
    -- 0380 정의: 해결(노하우) + 직접 답함(보내기). 같은 질문이 여러 번 와도(similar_queries_count) 한 행은 한 번.
    (select count(*)::int from public.unknown_queries q, b
      where q.unit_id = p_unit and q.asked_at >= b.v_from and q.asked_at < b.v_to
        and q.status in ('resolved_with_entry', 'answered_direct')),
    -- ★0520 기간 없음 · 승인 대기는 판정 한 곳(_uq_in_review). 보관·넘김·AI 답함은 안 든다(대기가 아니다).
    (select count(*)::int from public.unknown_queries q
      where q.unit_id = p_unit and q.status = 'pending_owner_answer'
        and not public._uq_in_review(q.id, q.unit_id, q.status))
$$;
revoke all on function public._unit_question_counts(text) from public, anon, authenticated;

-- unit_question_counts — 0380 권한 검사 그대로 · 몸체는 위 한 곳(★0520).
create or replace function public.unit_question_counts(p_unit text)
returns table(questions int, ai_answered int, direct_answered int, unanswered int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null or p_unit = '' then raise exception 'invalid_argument'; end if;

  -- 0380: 정의자(질문 행 읽기 정책은 사람마다 보이는 행이 달라 invoker 면 숫자가 사람마다 다르다).
  --   그 자리의 answer_direct 권한만(매장 사장·매니저 · 공간 주인). 공간 멤버가 숫자를 보면 "사람별 건수 비공개"(결정 132)가 흔들린다.
  if not public.auth_can(p_unit, 'answer_direct') then
    select u.kind into v_kind from public.units u where u.id = p_unit;
    if v_kind = 'space' then
      if public.auth_can(p_unit, 'read') then raise exception 'not_space_owner'; end if;
      raise exception 'not_space_member';
    end if;
    raise exception 'not_manager';
  end if;

  return query select * from public._unit_question_counts(p_unit);
end $$;
revoke all on function public.unit_question_counts(text) from public, anon, authenticated;
grant execute on function public.unit_question_counts(text) to authenticated;

-- owner_question_counts — 사장 현황(허브) 숫자 줄. 내가 사장인 매장마다 한 행. 합계는 앱이 더한다(매장 고르기 시트가 매장별 수를 쓴다).
create or replace function public.owner_question_counts()
returns table(unit_id text, store_name text, questions int, ai_answered int, direct_answered int, unanswered int, in_review int)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name, c.questions, c.ai_answered, c.direct_answered, c.unanswered,
         (select count(*)::int from public.playbook_suggestions ps where ps.unit_id = u.id and ps.status = 'pending')
    from public.unit_members m
    join public.units u on u.id = m.unit_id
    cross join lateral public._unit_question_counts(u.id) c
   where m.user_id = (select auth.uid())
     and m.role = 'owner'            -- 멤버 표 역할(현재 매장 함수 금지 · 4장 함정)
     and u.kind = 'store'            -- 공간·본사 작업실은 세지 않는다
     and u.deleted_at is null
   order by u.created_at
$$;
revoke all on function public.owner_question_counts() from public, anon, authenticated;
grant execute on function public.owner_question_counts() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ 매장 화면 배치 스위치 ('store','ask_first') — 꺼진 채 머지 · 허용 목록 계정에게만 켜짐
-- ══════════════════════════════════════════════════════════════════════════
--   켜지면 새 앱이 사장 현황 첫 줄을 숫자 줄로, 신입 물어보기 첫 화면을 묻는 칸 위로 그린다. 문구만 바뀌는 곳은 스위치 밖이다.
--   허용 목록 = 공간 입구와 같은 표(space_entry_allowlist · 고정 QA 계정). 표를 하나 더 만들지 않는다.
--   전체 켜기 = update unit_kind_features set enabled = true where kind = 'store' and feature = 'ask_first'. 끄면 바로 옛 배치.
insert into public.unit_kind_features (kind, feature, enabled) values
  ('store', 'ask_first', false)
on conflict (kind, feature) do nothing;

-- my_kind_features — 베이스 0374:97 본문 통째(정의 0368 → 0374). ★0520 ask_first 줄도 허용 목록을 본다.
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature,
         case when f.kind = 'space' and f.feature = 'enter'
              then public.space_open_for(auth.uid())   -- ★0374: 허용 목록 계정에게는 켜짐
              when f.kind = 'store' and f.feature = 'ask_first'   -- ★0520: 같은 허용 목록
              then f.enabled or exists (select 1 from public.space_entry_allowlist a where a.user_id = auth.uid())
              else f.enabled end
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;
revoke all on function public.my_kind_features() from public, anon;
grant execute on function public.my_kind_features() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ my_units_notif_data — 베이스 0367:240 본문 통째 (정의 0077 … 0346 → 0367). 바뀐 곳은 ★0520 uq 블록 하나.
--   0367 머리말: 베이스 0346 본문 통째 (my CTE 에 "공간이 아닌 자리" 한 줄).
--   0346 머리말: 베이스 0345 본문 통째 (schednotice 종류에 member_joined·join_full · payload 에 actor_id 만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as (
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
      -- ★0314 닫힌 매장의 직원·매니저는 그 매장 알림을 허브에서 받지 않는다(0305 my_cross_summary 와 같은 술어 · 사용자 결정 10-17).
      and not (m.role in ('junior', 'manager') and public.unit_access_locked(m.unit_id))
      -- ★0367 공간은 매장 벨에 안 섞는다. 공간 알림은 공간 함수가 따로 준다(3판 14장). 매장·본사 작업실은 지금처럼.
      and exists (select 1 from public.units u where u.id = m.unit_id and u.kind <> 'space')
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      -- ⛔ 대화·공지는 방의 것이다 — 이 술어는 유지한다.
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id and r.deleted_at is null
          and (r.is_default
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
      and sr.archived_tenure_id is null      -- ★0246: 재입사 전 옛 요청은 알림에 넣지 않는다
  ) s where s.rn <= 50

  union all
  -- ★할일: 방 술어 제거(0153). 나에게 배정된 할일은 방과 무관하게 알림에 나온다.
  --   담당자 여러 명(0254 owner_ids) — 0254 의 문자열 치환 결과를 본문에 그대로 쓴다.
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where me.uid = any(wt.owner_ids)
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- ★완료마크: 같은 이유로 방 술어 제거(0153).
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and me.uid = any(wt.owner_ids))

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- ★0313 전 역할. 답 기다리는 질문(사장 = 답할 질문 · 직원·매니저 = 도와줄 수 있는 질문 D4)
  --   + 내가 물었고 답이 온 질문(q_answered). 매장 안 RLS(uq_select = 그 매장 전부)보다 좁다.
  select q.unit_id, 'uq'::text, q.payload
  from (
  -- ★0520 승인 대기 질문(_uq_in_review)은 그 답을 제안한 사람에게만 남긴다. 다른 직원 벨·사장 벨의 "답 기다리는 질문"에서 빠진다.
  --   사장·매니저에게는 같은 일이 아래 sugg 블록(검토 대기)으로 한 번 간다(같은 사실 한 번). 반려·취소되면 제안이 대기를 벗어나
  --   질문이 저절로 다시 나타난다. payload 에 in_review 키를 붙인다(새 앱 목록 판정이 같은 값을 쓴다 · 옛 앱은 무시).
    select uq.unit_id, to_jsonb(uq) || jsonb_build_object('in_review', public._uq_in_review(uq.id, uq.unit_id, uq.status)) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id
    cross join me
    where (uq.status = 'pending_owner_answer'
           and (not public._uq_in_review(uq.id, uq.unit_id, uq.status)
                or exists (select 1 from public.playbook_suggestions ps0
                            where ps0.source_uq_id = uq.id and ps0.unit_id = uq.unit_id
                              and ps0.status = 'pending' and ps0.proposer_id = me.uid)))
       or (uq.junior_id = me.uid::text and uq.status = 'resolved_with_entry')
  ) q where q.rn <= 50

  union all
  -- ★0313 검토 대기(사장·매니저 · 0153 그대로) + 내가 올린 제안의 검토 결과(전 역할 · 직원·매니저 벨 suggestion_approved/rejected).
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id
    cross join me
    where (ps.status = 'pending' and my.role in ('owner', 'manager'))
       or (ps.proposer_id = me.uid and ps.status <> 'pending' and ps.reviewed_at is not null)
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null

  union all
  -- ★0313 퀴즈 발송 원장(0139). 사장·매니저 매장 = 그 매장 전체(응시 완료 quiz_done) · 직원 매장 = 내 발송(안 푼 퀴즈 training).
  --   RLS qz_select 와 같은 갈래(user_id = 나 or 관리 권한). 나간 발송만(sent_at) · 최근 50.
  -- ★0332: 내 발송 중 열린 것만 서버 상태를 붙인다(완료된 것은 done). 판정 = quiz_assignment_state.
  select z.unit_id, 'quiz'::text,
         case
           when z.completed_at is not null then z.payload || jsonb_build_object('state', 'done')
           when z.mine then z.payload || coalesce(
             (select jsonb_build_object('state', s.state, 'total_items', s.total_items, 'answered_items', s.answered_items)
                from public.quiz_assignment_state(z.id) s), '{}'::jsonb)
           else z.payload
         end
  from (
    select qa.unit_id, qa.id, qa.completed_at, qa.user_id = me.uid as mine, to_jsonb(qa) as payload,
           row_number() over (partition by qa.unit_id order by coalesce(qa.completed_at, qa.sent_at) desc) as rn
    from public.quiz_assignments qa
    join my on my.unit_id = qa.unit_id
    cross join me
    where qa.sent_at is not null
      and (my.role in ('owner', 'manager') or qa.user_id = me.uid)
  ) z where z.rn <= 50

  union all
  select my.unit_id, 'legacy_quiz'::text, jsonb_build_object('id', q.course_id)
    from my cross join me
    cross join lateral public.quiz_legacy_open_courses(my.unit_id, me.uid) q

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  -- ★0332: due_days(1회성 = null)도 싣는다. 허브 벨은 1회성 규칙 없이 퀴즈마다 하나로 센다(10-23 · 카드만 1회성 하나).
  --   position(카드 순서 = 매장 앱 fetchTrainingCourses 의 order by position) · audience(외부 사람용은 직원 카드가 없다)도 싣는다.
  select c.unit_id, 'course'::text,
         jsonb_build_object('id', c.id, 'name', c.name, 'due_days', c.due_days, 'position', c.position, 'audience', c.audience)
  from public.training_courses c
  join my on my.unit_id = c.unit_id

  union all
  -- ★0313 근무 시간 수정 요청(0243 · 대기만 · 사장·매니저 매장). 재입사 전 옛 요청 제외(0246 scr_read 와 같은 술어).
  select tr.unit_id, 'timereq'::text, tr.payload
  from (
    select scr.unit_id, to_jsonb(scr) as payload,
           row_number() over (partition by scr.unit_id order by scr.created_at desc) as rn
    from public.shift_change_requests scr
    join my on my.unit_id = scr.unit_id and my.role in ('owner', 'manager')
    where scr.status = 'pending'
      and scr.archived_tenure_id is null
  ) tr where tr.rn <= 50

  union all
  -- ★0313 입금 신고 검토 결과(0083 · 사장 매장). RLS payment_claims_select 와 같은 role = owner.
  select cl.unit_id, 'claim'::text, cl.payload
  from (
    select pc.unit_id, to_jsonb(pc) as payload,
           row_number() over (partition by pc.unit_id order by pc.created_at desc) as rn
    from public.payment_claims pc
    join my on my.unit_id = pc.unit_id and my.role = 'owner'
    where pc.status <> 'pending' and pc.reviewed_at is not null
  ) cl where cl.rn <= 50

  union all
  -- ★0313 사장 알림(0191 · 사장 매장). RLS owner_alerts_select_owner 와 같은 role = owner.
  select al.unit_id, 'alert'::text, al.payload
  from (
    select oa.unit_id, to_jsonb(oa) as payload,
           row_number() over (partition by oa.unit_id order by oa.created_at desc) as rn
    from public.owner_alerts oa
    join my on my.unit_id = oa.unit_id and my.role = 'owner'
  ) al where al.rn <= 50

  union all
  -- ★0313 내 근무 알림(D9 · 0289 member_notices 3종 · user_id = 나). 매장별. 합류 결과(approved·rejected)는 계정 단위라 여기 없다.
  select sn.unit_id, 'schednotice'::text, sn.payload
  from (
    select mn.unit_id, jsonb_build_object('id', mn.id, 'kind', mn.kind, 'title', mn.title, 'body', mn.body, 'created_at', mn.created_at, 'actor_id', mn.actor_id) as payload,
           row_number() over (partition by mn.unit_id order by mn.created_at desc) as rn
    from public.member_notices mn
    join my on my.unit_id = mn.unit_id
    cross join me
    where mn.user_id = me.uid
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed', 'left', 'account_deleted', 'member_joined', 'join_full')  -- ★0316 role_changed · ★0317 직원 나감·탈퇴(사장이 받는다) · ★0346 합류함·인원 초과(사장이 받는다 · actor_id = 그 직원)
  ) sn where sn.rn <= 50

  union all
  -- ★0345 처리한 합류 신청(사장 매장 · 최근 30일). 판정·모양은 join_history_rows 한 곳이다(매장 벨과 같은 행).
  --   닫힌 매장 술어(my)도 지난다. 사장은 닫힌 매장에서도 my 에 남는다(위 my 정의와 같다).
  select jh.unit_id, 'join_done'::text, jh.payload
  from public.join_history_rows() jh
  join my on my.unit_id = jh.unit_id and my.role = 'owner'
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ push_client_event_v2 — 베이스 0357:14 본문 통째 (정의 0350 → 0357). 바뀐 곳은 ★0520 q-answered 갈래 두 줄.
--   0357 머리말: 0350 본문 통째 승계. suggestion-result 승인 제목만 '내 노하우 제안이 승인됐어요'.
--   5열 래퍼 push_client_event(0350)는 이 함수를 부르므로 따로 바꾸지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.push_client_event_v2(
  p_caller uuid, p_unit text, p_pending_unit text, p_audience text, p_tag text, p_item_id text, p_target uuid
) returns table(ok boolean, reason text, title text, body text, item_id text, key text)  -- ★0350: key 추가
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = p_caller), '동료');
  v_key   text;
  v_title text;
  v_body  text;
  v_item  text := p_item_id;
  v_manage boolean;
  r record;
begin
  if p_caller is null or p_tag is null then return query select false, 'missing', null::text, null::text, null::text, null::text; return; end if;

  if p_audience = 'join_owners' then
    -- 합류 신청: 신청자 본인이 지금 그 매장에 신청 중이어야 한다.
    if p_tag <> 'join' or p_pending_unit is null
       or not exists (select 1 from public.profiles p where p.id = p_caller and p.pending_unit_id = p_pending_unit) then
      return query select false, 'no_event', null::text, null::text, null::text, null::text; return;
    end if;
    v_key := 'join:' || p_caller || ':' || p_pending_unit;
    v_title := '합류 신청'; v_body := v_name || '님이 합류를 신청했어요'; v_item := p_caller::text;
  else
    if p_unit is null or not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller) then
      return query select false, 'not_member', null::text, null::text, null::text, null::text; return;
    end if;
    -- 잠긴 매장·잠긴 좌석은 보내지 않는다.
    if public.unit_access_locked(p_unit) or public.seat_locked_for(p_unit, p_caller) then
      return query select false, 'locked', null::text, null::text, null::text, null::text; return;
    end if;
    v_manage := exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller
                          and (m.role = 'owner' or m.role = 'manager'));

    if p_tag = 'question' and p_audience in ('owners', 'staff') then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_caller::text and q.status = 'pending_owner_answer';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'question:' || p_audience || ':' || r.id;
      v_title := case when p_audience = 'owners' then '답변 대기 질문' else '동료 질문 — 도와줄 수 있어요' end;
      v_body := r.query_text;

    elsif p_tag = 'suggestion' and p_audience = 'owners' then
      select s.id, s.text into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_caller and s.status = 'pending' and s.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion:' || s.id)
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion:' || r.id; v_title := v_name || '님의 노하우 제안'; v_body := r.text; v_item := null;

    elsif p_tag = 'swap-approval' and p_audience = 'owners' then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.accepted_by = p_caller::text and s.status = 'accepted' and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-approval:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-approval:' || r.id; v_title := '교대 승인 대기'; v_body := '교대 요청이 승인을 기다려요 · ' || public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'shift-time' and p_audience = 'owners' then
      select c.id, c.date, c.new_start, c.new_end into r from public.shift_change_requests c
       where c.id = p_item_id and c.unit_id = p_unit and c.archived_tenure_id is null
         and c.staff_id = p_caller::text and c.status = 'pending';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'shift-time:' || r.id; v_title := v_name || '님이 근무 시간 수정을 요청했어요';
      v_body := public.fmt_date_ko(r.date::text) || ' ' || r.new_start || '~' || r.new_end;

    elsif p_tag = 'quiz-done' and p_audience = 'owners' then
      select a.id, c.name into r from public.quiz_assignments a join public.training_courses c on c.id = a.course_id
       where a.unit_id = p_unit and a.user_id = p_caller and a.course_id = p_item_id and a.completed_at > now() - interval '30 minutes'
       order by a.completed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'quiz-done:' || r.id; v_title := v_name || '님이 퀴즈를 다 풀었어요'; v_body := r.name;

    elsif p_tag = 'swap-req' and p_audience in ('staff', 'user') then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_caller::text and s.status = 'open' and s.created_at > now() - interval '24 hours'
         and (case when p_audience = 'user'
                   then (s.target_staff_id = p_target::text or p_target::text = any(coalesce(s.target_staff_ids, '{}')))
                   else s.target_staff_id is null and coalesce(cardinality(s.target_staff_ids), 0) = 0 end)
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-req:' || p_audience || ':' || s.id || ':' || coalesce(p_target::text, ''))
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-req:' || p_audience || ':' || r.id || ':' || coalesce(p_target::text, '');
      if p_audience = 'user' then v_title := '맞교환 요청'; v_body := '나에게 맞교환을 요청했어요 · ' || public.fmt_date_ko(r.date);
      else v_title := '대타 요청'; v_body := '교대 대타를 찾고 있어요 · ' || public.fmt_date_ko(r.date); end if;
      v_item := null;

    elsif p_tag = 'swap-result' and p_audience = 'user' and v_manage then
      select s.id, s.date, s.status into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_target::text and s.status in ('approved', 'rejected') and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-result:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-result:' || r.id; v_title := case when r.status = 'approved' then '교대 확정' else '교대 반려' end;
      v_body := public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'q-answered' and p_audience = 'user' then
      select q.id, q.query_text, q.answer_author_id, q.answered_by into r from public.unknown_queries q   -- ★0520 답 쓴 사람
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_target::text and q.status = 'resolved_with_entry';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      -- ★0520 이름 = 답 쓴 사람(answer_author_id · 0379). 승인한 사장이 아니라 답을 제안한 직원이다. 비면 해결 처리한 사람(answered_by) ·
      --   그것도 비면 보낸 사람(0357 그대로). 탈퇴한 사람 이름은 비어 다음 것으로 떨어진다.
      v_key := 'q-answered:' || r.id;
      v_title := coalesce(
        (select nullif(btrim(p.name), '') from public.profiles p where p.id = r.answer_author_id),
        (select nullif(btrim(p.name), '') from public.profiles p where p.id = r.answered_by),
        v_name) || '님이 내 질문에 답했어요';
      v_body := r.query_text;

    elsif p_tag = 'suggestion-result' and p_audience = 'user' and v_manage then
      select s.id, s.text, s.status into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_target and s.status in ('approved', 'rejected') and s.reviewed_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion-result:' || s.id)
       order by s.reviewed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion-result:' || r.id;
      v_title := case when r.status = 'approved' then '내 노하우 제안이 승인됐어요' else '내 노하우 제안이 반려됐어요' end;  -- ★0357: 반영 → 승인
      v_body := r.text; v_item := null;

    elsif p_tag = 'mention' and p_audience = 'user' then
      select f.id, f.data ->> 'text' as text into r from public.work_feed f
       where f.id = p_item_id and f.unit_id = p_unit and f.data ->> 'authorId' = p_caller::text
         and (p_target::text = any(coalesce(f.mentions, '{}'))
              or coalesce(f.data -> 'mentions', '[]'::jsonb) ? p_target::text);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'mention:' || r.id || ':' || p_target; v_title := v_name || '님이 나를 언급했어요'; v_body := r.text;

    elsif p_tag = 'assign' and p_audience = 'user' then
      select t.id, t.text into r from public.work_templates t
       where t.id = p_item_id and t.unit_id = p_unit
         and (t.owner_id = p_target or p_target = any(coalesce(t.owner_ids, '{}')))
         and exists(select 1 from public.unit_members m join public.profiles p on p.id=m.user_id
                     where m.unit_id=p_unit and m.user_id=p_target and p.deleted_at is null)
         and not public.seat_locked_for(p_unit,p_target);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'assign:' || r.id || ':' || p_target; v_title := v_name || '님이 할 일을 배정했어요'; v_body := r.text;

    elsif p_tag = 'training' and p_audience = 'user' and v_manage then
      select t.id, coalesce(pe.title, wt.text, '') as title into r from public.training_requests t
        left join public.playbook_entries pe on pe.id = t.entry_id
        left join public.work_templates wt on wt.id = t.template_id
       where t.unit_id = p_unit and t.staff_id = p_target and t.created_by = p_caller and t.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'training:' || t.id)
       order by t.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'training:' || r.id; v_title := v_name || '님이 퀴즈를 요청했어요'; v_body := r.title; v_item := null;

    else
      -- 모르는 태그·갈래 조합(폐지한 공지 포함)·권한 없는 결과 알림은 보내지 않는다.
      return query select false, 'unknown_tag', null::text, null::text, null::text, null::text; return;
    end if;
  end if;

  -- 같은 사건은 24시간에 한 번만 알린다.
  perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
  --   합류·배정·멘션은 같은 대상에게 다시 일어날 수 있는 사건이라(반려 뒤 재신청 · 뺐다가 재배정) 10분만 막는다.
  if exists (select 1 from public.push_client_events e where e.key = v_key
              and (p_tag = 'assign' or e.sent_at > now() - case when p_tag in ('join', 'mention') then interval '10 minutes' else interval '24 hours' end)) then
    return query select false, 'duplicate', null::text, null::text, null::text, null::text; return;
  end if;
  insert into public.push_client_events (key) values (v_key);
  return query select true, 'ok', left(v_title, 80), left(coalesce(v_body, ''), 200), v_item, v_key;  -- ★0350: 선점한 키를 돌려준다(엣지가 release 에 쓴다)
end $$;
revoke execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array['public._uq_in_review(text,text,text)', 'public.uq_in_review(public.unknown_queries)',
                           'public._unit_question_counts(text)', 'public.unit_question_counts(text)', 'public.owner_question_counts()'] loop
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '0520: % 정의자가 아니다', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise exception '0520: % 를 anon 이 부른다', f; end if;
  end loop;
  foreach f in array array['public._uq_in_review(text,text,text)', 'public._unit_question_counts(text)'] loop
    if has_function_privilege('authenticated', f, 'execute') then raise exception '0520: 안쪽 함수 % 를 앱이 직접 부른다', f; end if;
  end loop;
  -- 허브 함수는 현재 매장 함수를 쓰면 다른 매장 숫자가 0 이 된다(4장 함정).
  foreach f in array array['public.owner_question_counts()', 'public._unit_question_counts(text)', 'public._uq_in_review(text,text,text)'] loop
    if (select prosrc from pg_proc where oid = f::regprocedure) ~ 'auth_can\s*\(|auth_can_manage\s*\(|auth_is_owner\s*\(|auth_unit_id\s*\(' then
      raise exception '0520: % 가 현재 매장 함수를 쓴다', f;
    end if;
  end loop;
  -- 판정 한 곳: 미응답·벨이 같은 함수를 부른다(문자열 복제 금지).
  if (select prosrc from pg_proc where oid = 'public._unit_question_counts(text)'::regprocedure) !~ '_uq_in_review'
     or (select prosrc from pg_proc where oid = 'public.my_units_notif_data()'::regprocedure) !~ '_uq_in_review' then
    raise exception '0520: 승인 대기 판정을 _uq_in_review 한 곳에서 하지 않는다';
  end if;
  if not exists (select 1 from public.unit_kind_features where kind = 'store' and feature = 'ask_first') then
    raise exception '0520: ask_first 줄이 없다';
  end if;
end $$;
