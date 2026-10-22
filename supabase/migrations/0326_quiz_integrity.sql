-- 0326 퀴즈 응시의 코스·문항 단위 계약 (2026-10-22 실측 감사)
-- 옛 앱 호환: 안전 | 기존 직원/게스트 제출·집계·완료 RPC의 인자와 반환형 유지.
-- 새 앱은 v2에 코스/요청 id를 보낸다. 옛 앱은 기존 wrapper로 같은 저장 본문을 탄다.
-- 완료 판정은 문항 단위만 센다. 옛 앱(문항 3개만 받음)은 4문항 이상 퀴즈를 못 끝낸다. 옛 앱 사용자가 사실상 없어 감수한다(2026-10-22 사용자 결정).
-- v2 제출도 0203처럼 지워진·다른 코스 문항만 버리고 나머지를 저장한다(재시도 영구 실패 방지).
-- 노하우별 quiz_attempts는 유지하되 점수는 문항별 quiz_attempt_items만 센다.
-- 스냅샷은 문항/코스 삭제 후에도 남아야 하므로 새 열에는 수명 연동 FK를 걸지 않는다.
alter table public.quiz_attempt_items add column if not exists course_id text;
alter table public.quiz_attempt_items add column if not exists entry_ids text[];
-- 출시 앱은 p_rows만 보내며 관련 발송의 완료 RPC를 모두 호출한다. 코스 없는 공유문항은
-- 호출 순서로 코스를 추측하지 않는다. 옛 저장 경로임을 남겨 동일 공유문항의 진행만 인정한다.
alter table public.quiz_attempt_items add column if not exists legacy_shared boolean not null default false;
create index if not exists idx_qai_course_history
  on public.quiz_attempt_items(unit_id, course_id, created_at desc, id);

-- 과거 게스트의 코스는 제출 원장에 있다. 직원은 당시 이후 수정되지 않은 문항만 복원한다.
-- 현재 노하우 연결을 과거 사실로 추측하거나 한 응시를 여러 코스에 복제하지 않는다.
with known as (
  select unit_id, submission_id, min(course_id) as course_id
    from public.quiz_attempts where course_id is not null
   group by unit_id, submission_id having count(distinct course_id) = 1
)
update public.quiz_attempt_items ai set course_id = k.course_id
  from known k where ai.unit_id = k.unit_id and ai.submission_id = k.submission_id
   and ai.course_id is null;
update public.quiz_attempt_items ai
   set course_id = coalesce(ai.course_id, qi.course_id), entry_ids = qi.entry_ids,
       legacy_shared = ai.course_id is null and qi.course_id is null
  from public.quiz_items qi
 where qi.id = ai.item_id and qi.unit_id = ai.unit_id and ai.entry_ids is null
   and qi.created_at <= ai.created_at and qi.updated_at <= ai.created_at
   and qi.payload = ai.payload;

-- 출제와 제출이 같은 집합을 쓴다. 호출 권한은 공개 RPC에서 검사한다.
create or replace function public.quiz_course_servable(p_unit text, p_course text)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_items q
   where q.unit_id = p_unit and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and (q.course_id is null or q.course_id = p_course)
     and exists (select 1 from public.course_entries ce
                  where ce.course_id = p_course and ce.unit_id = p_unit and ce.entry_id = any(q.entry_ids))
     and not exists (select 1 from unnest(q.entry_ids) e(id)
                      where not exists (select 1 from public.playbook_entries pe
                        where pe.id = e.id and pe.unit_id = p_unit
                          and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_course_servable(text, text) from public, anon, authenticated;

create or replace function public.quiz_link_servable(l public.quiz_links)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select * from public.quiz_course_servable(l.unit_id, l.course_id)
$$;
revoke all on function public.quiz_link_servable(public.quiz_links) from public, anon, authenticated;

create or replace function public.quiz_link_grade(p_token text, p_item_id text, p_response jsonb)
returns table(correct boolean, explain text, answer jsonb)
language plpgsql stable security definer set search_path = public as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then raise exception 'link_unavailable'; end if;
  if not exists(select 1 from public.quiz_link_servable(l) q where q.id = p_item_id) then
    raise exception 'item_not_found';
  end if;
  return query select * from public.quiz_grade_item(p_item_id, l.unit_id, p_response);
end $$;
revoke all on function public.quiz_link_grade(text, text, jsonb) from public;
grant execute on function public.quiz_link_grade(text, text, jsonb) to anon, authenticated;

-- 새 앱은 유실된 응답을 같은 요청 id로 재시도한다. 사용자·매장·코스마다 키를 분리한다.
-- 성공 기록을 먼저 확인하므로 문항이 삭제된 뒤의 재시도도 중복 제출되지 않는다.
create or replace function public.quiz_staff_record_internal(
  p_rows jsonb, p_course_id text, p_request_id text, p_strict boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_unit text := public.auth_unit_id();
  v_sub text; v_list jsonb := coalesce(p_rows, '[]'::jsonb);
  a record; q public.quiz_items; g record; v_course text; v_n int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 50 then raise exception 'too_many_rows'; end if;
  if p_request_id is not null and (length(p_request_id) > 200 or btrim(p_request_id) = '') then
    raise exception 'invalid_argument';
  end if;
  if p_request_id is not null then
    v_sub := 'qs_' || md5(jsonb_build_array(v_unit, v_uid, p_course_id, p_request_id)::text);
    perform pg_advisory_xact_lock(hashtext(v_sub));
    if exists(select 1 from public.quiz_attempt_items ai where ai.submission_id = v_sub
               and ai.unit_id = v_unit and ai.staff_id = v_uid) then return v_sub; end if;
  else
    v_sub := 'qs_' || replace(gen_random_uuid()::text, '-', '');
  end if;
  if p_course_id is not null and not exists(select 1 from public.training_courses c
       where c.id = p_course_id and c.unit_id = v_unit and c.active and c.brand_hidden_at is null) then
    raise exception 'item_not_found';
  end if;
  if p_strict and exists(select 1 from jsonb_array_elements(v_list) e
                         where jsonb_typeof(e) <> 'object' or coalesce(e->>'item_id', '') = '') then
    raise exception 'bad_answers';
  end if;
  -- 0203: 같은 문항은 처음 낸 답 한 번만 저장한다.
  for a in
    select distinct on (e->>'item_id') e->>'item_id' as item_id,
           coalesce(e->'response', 'null'::jsonb) as response,
           coalesce((e->>'ord')::int, (ord-1)::int) as ord
      from jsonb_array_elements(v_list) with ordinality t(e,ord)
     where jsonb_typeof(e) = 'object' and e->>'item_id' is not null
     order by e->>'item_id', t.ord
  loop
    select * into q from public.quiz_items qi
     where qi.id = a.item_id and qi.unit_id = v_unit and qi.status = 'active'
       and qi.format = any(public.quiz_known_formats())
       and (p_course_id is null or exists(select 1 from public.quiz_course_servable(v_unit,p_course_id) s where s.id=qi.id));
    if not found then
      -- 0203: 그 사이 지워진 문항이나 다른 코스 문항은 버리고 나머지 답을 저장한다.
      continue;
    end if;
    v_course := coalesce(p_course_id, q.course_id);
    -- 옛 앱은 course_id를 보내지 않는다. 공유되지 않은 구형 문항만 코스를 확정한다.
    if v_course is null then
      select case when count(distinct ce.course_id)=1 then min(ce.course_id) end into v_course
        from public.course_entries ce where ce.unit_id=v_unit and ce.entry_id=any(q.entry_ids);
    end if;
    select * into g from public.quiz_grade_item(q.id, v_unit, a.response);
    insert into public.quiz_attempt_items
      (unit_id,submission_id,staff_id,item_id,ord,format,payload,response,correct,course_id,entry_ids,legacy_shared)
    values(v_unit,v_sub,v_uid,q.id,a.ord,q.format,q.payload,a.response,coalesce(g.correct,false),v_course,q.entry_ids,
           not p_strict and v_course is null and q.course_id is null);
  end loop;
  insert into public.quiz_attempts(unit_id,entry_id,course_id,staff_id,submission_id,total,correct)
  select v_unit,e.entry_id,ai.course_id,v_uid,v_sub,count(*)::int,count(*) filter(where ai.correct)::int
    from public.quiz_attempt_items ai cross join lateral unnest(ai.entry_ids) e(entry_id)
   where ai.submission_id=v_sub and ai.unit_id=v_unit
   group by e.entry_id,ai.course_id;
  get diagnostics v_n = row_count;
  if v_n=0 then return null; end if;
  return v_sub;
end $$;
revoke all on function public.quiz_staff_record_internal(jsonb,text,text,boolean) from public,anon,authenticated;
create or replace function public.quiz_staff_record(p_rows jsonb)
returns text language sql volatile security definer set search_path = public as $$
  select public.quiz_staff_record_internal(p_rows,null,null,false)
$$;
revoke all on function public.quiz_staff_record(jsonb) from public,anon;
grant execute on function public.quiz_staff_record(jsonb) to authenticated;
create or replace function public.quiz_staff_record_v2(p_rows jsonb,p_course_id text default null,p_request_id text default null)
returns text language sql volatile security definer set search_path = public as $$
  select public.quiz_staff_record_internal(p_rows,p_course_id,p_request_id,true)
$$;
revoke all on function public.quiz_staff_record_v2(jsonb,text,text) from public,anon;
grant execute on function public.quiz_staff_record_v2(jsonb,text,text) to authenticated;

-- 이력은 현재 문항과 독립적이다. 기존 RLS를 유지하고 정답을 직원에게 열지 않는다.
create or replace function public.quiz_course_attempt_items(p_course_id text)
returns setof public.quiz_attempt_items language sql stable security invoker set search_path = public as $$
  select ai.* from public.quiz_attempt_items ai where ai.course_id=p_course_id
  order by ai.created_at desc,ai.id
$$;
revoke all on function public.quiz_course_attempt_items(text) from public,anon;
grant execute on function public.quiz_course_attempt_items(text) to authenticated;

create or replace function public.quiz_course_stats()
returns table(course_id text,submissions bigint,people bigint,asked bigint,correct bigint)
language sql stable security invoker set search_path = public as $$
  select ai.course_id,count(distinct ai.submission_id),
         count(distinct coalesce(ai.staff_id::text,'sub:'||ai.submission_id)),
         count(*),count(*) filter(where ai.correct)
    from public.quiz_attempt_items ai where ai.course_id is not null group by ai.course_id
$$;
create or replace function public.quiz_course_person(p_course_id text,p_staff_id uuid)
returns table(submission_id text,taken_at timestamptz,asked bigint,correct bigint)
language sql stable security invoker set search_path = public as $$
  select ai.submission_id,max(ai.created_at),count(*),count(*) filter(where ai.correct)
    from public.quiz_attempt_items ai where ai.course_id=p_course_id and ai.staff_id=p_staff_id
   group by ai.submission_id order by 2 desc
$$;
revoke all on function public.quiz_course_stats() from public,anon;
revoke all on function public.quiz_course_person(text,uuid) from public,anon;
grant execute on function public.quiz_course_stats() to authenticated;
grant execute on function public.quiz_course_person(text,uuid) to authenticated;

-- 본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다.
create or replace function public.quiz_assignment_pending(p_assignment_id text)
returns table(item_id text,entry_ids text[],answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id,q.entry_ids,exists(select 1 from public.quiz_attempt_items ai
    where ai.unit_id=a.unit_id and ai.staff_id=a.user_id
      and (ai.course_id=a.course_id
           -- 구형 앱 호환: 같은 노하우가 아니라 실제 동일한 구형 공유문항만 인정한다.
           -- 새 v2 답과 코스가 명시된 문항은 이 예외를 탈 수 없다. 통계 귀속은 복제하지 않는다.
           or (ai.course_id is null and ai.legacy_shared and q.course_id is null))
      and ai.item_id=q.id and ai.created_at>=a.sent_at)
    from public.quiz_assignments a
    cross join lateral public.quiz_course_servable(a.unit_id,a.course_id) q
   where a.id=p_assignment_id and a.sent_at is not null
$$;
revoke all on function public.quiz_assignment_pending(text) from public,anon,authenticated;

create or replace function public.quiz_assignment_progress(p_course_id text default null)
returns table(assignment_id text,course_id text,pending_entry_ids text[],pending_item_ids text[],total_items int,answered_items int)
language sql stable security definer set search_path = public as $$
  select a.id,a.course_id,
    coalesce((select array_agg(distinct e.id) from public.quiz_assignment_pending(a.id) p
              cross join lateral unnest(p.entry_ids) e(id) where not p.answered),'{}'::text[]),
    coalesce((select array_agg(p.item_id order by p.item_id) from public.quiz_assignment_pending(a.id) p where not p.answered),'{}'::text[]),
    (select count(*)::int from public.quiz_assignment_pending(a.id)),
    (select count(*)::int from public.quiz_assignment_pending(a.id) p where p.answered)
  from public.quiz_assignments a
  join public.training_courses c on c.id=a.course_id and c.unit_id=a.unit_id and c.active and c.brand_hidden_at is null
  where a.user_id=auth.uid() and a.unit_id=public.auth_unit_id() and a.sent_at is not null
    and (p_course_id is null or a.course_id=p_course_id)
$$;
revoke all on function public.quiz_assignment_progress(text) from public,anon;
grant execute on function public.quiz_assignment_progress(text) to authenticated;

create or replace function public.quiz_assignment_items(p_assignment_id text,p_limit int default 3,p_entry_ids text[] default null)
returns table(id text,kind text,format text,payload jsonb,entry_ids text[])
language sql stable security definer set search_path = public as $$
  select q.id,q.kind,q.format,
         public.quiz_strip_payload(public.quiz_shuffle_seed(q.id,q.created_at),q.format,q.payload),q.entry_ids
    from public.quiz_assignments a
    join public.training_courses c on c.id=a.course_id and c.unit_id=a.unit_id and c.active and c.brand_hidden_at is null
    cross join lateral public.quiz_assignment_pending(a.id) p
    join public.quiz_items q on q.id=p.item_id and q.unit_id=a.unit_id
   where a.id=p_assignment_id and a.user_id=auth.uid() and a.unit_id=public.auth_unit_id()
     and not p.answered and (p_entry_ids is null or q.entry_ids && p_entry_ids)
   order by md5(q.id||auth.uid()::text)
   limit least(greatest(coalesce(p_limit,3),1),20)
$$;
revoke all on function public.quiz_assignment_items(text,int,text[]) from public,anon;
grant execute on function public.quiz_assignment_items(text,int,text[]) to authenticated;

create or replace function public.mark_quiz_completed(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.quiz_assignments; v_total int; v_answered int;
begin
  select * into a from public.quiz_assignments x where x.id=p_id and x.user_id=auth.uid()
    and x.unit_id=public.auth_unit_id() and x.sent_at is not null for update;
  if not found then return false; end if;
  update public.quiz_assignments set opened_at=coalesce(opened_at,now()) where id=a.id;
  -- 0313/0314: 이번에 완료됐을 때만 true. 중복 알림을 막는 행 잠금을 유지한다.
  if a.completed_at is not null then return false; end if;
  if not exists(select 1 from public.training_courses c where c.id=a.course_id and c.active and c.brand_hidden_at is null) then
    return false;
  end if;
  select count(*)::int,count(*) filter(where p.answered)::int into v_total,v_answered
    from public.quiz_assignment_pending(a.id) p;
  -- 문항 단위만 센다. 같은 노하우의 다른 문항을 풀었다고 이 퀴즈를 끝낸 것으로 보지 않는다(2026-10-22 사용자 결정).
  -- 낸 퀴즈의 마지막 문항은 빼지 못하게 막았다(아래 트리거). 0문항은 비정상이라 완료로 닫지 않는다.
  if v_total=0 or v_answered<v_total then return false; end if;
  update public.quiz_assignments set completed_at=now() where id=a.id;
  return true;
end $$;
revoke all on function public.mark_quiz_completed(text) from public,anon;
grant execute on function public.mark_quiz_completed(text) to authenticated;

-- Guest submission: base 0325; keep phone checks and rate limits.
CREATE OR REPLACE FUNCTION public.quiz_link_submit_internal(p_token text, p_guest_name text, p_guest_phone text, p_phone_verified boolean, p_answers jsonb, p_request_id text, p_strict boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l       public.quiz_links;
  v_name  text := btrim(coalesce(p_guest_name, ''));
  v_phone text := public.normalize_phone(p_guest_phone);
  v_sub   text := 'qs_' || replace(gen_random_uuid()::text, '-', '');
  v_list  jsonb := coalesce(p_answers, '[]'::jsonb);
  v_n     int;
  a       record;
  q       public.quiz_items%rowtype;
  g       record;
  v_verified boolean;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then raise exception 'link_unavailable'; end if;
  if p_request_id is not null then
    if length(p_request_id)>200 or btrim(p_request_id)='' then raise exception 'invalid_argument'; end if;
    v_sub := 'qs_' || md5(jsonb_build_array(l.unit_id,l.id,p_request_id)::text);
    perform pg_advisory_xact_lock(hashtext(v_sub));
    select count(*)::int into v_n from public.quiz_attempts qa_replay
      where qa_replay.unit_id=l.unit_id and qa_replay.submission_id=v_sub and qa_replay.staff_id is null;
    if v_n>0 then return v_n; end if;
  end if;

  -- 같은 링크의 동시 제출은 한 줄로 세운다(세는 사이에 끼어들지 못하게). 횟수 검사는 이름·번호를 정리한 뒤 아래에서 한다.
  perform pg_advisory_xact_lock(hashtext('quiz_link_submit:' || l.id));

  if v_name = '' then raise exception 'name_required'; end if;
  v_name := left(v_name, 20);

  -- ★0195: 전화번호는 **선택**이다. 0160 은 식별키라 필수로 뒀지만, 로그인 없는 외부 사람에게
  --   번호까지 요구하는 것은 개인정보 최소수집 원칙과 맞지 않았다(2026-09-13 사용자 결정).
  --   안 적으면 null 로 남는다 — 그 응시는 재응시 묶기·합류 시 이력 잇기가 안 된다(화면이 그렇게 말한다).
  --   적었으면 휴대폰 형식이어야 한다(잘못 적은 번호를 식별키로 쓰면 남의 이력에 붙는다).
  if v_phone = '' then v_phone := null; end if;
  if v_phone is not null and v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'bad_phone'; end if;

  -- ★0325: 같은 사람은 10분에 10번 · 링크 전체는 10분에 300번(2026-10-20 사용자 결정).
  --   같은 사람 = 번호를 적었으면 번호, 안 적었으면 이름. 교육 때 여러 사람이 한꺼번에 풀어도 막히지 않고,
  --   이름을 바꿔 가며 기계로 쏟아붓는 것은 링크 전체 상한이 막는다.
  if (select count(distinct qa.submission_id) from public.quiz_attempts qa
       where qa.course_id = l.course_id and qa.unit_id = l.unit_id and qa.staff_id is null
         and qa.taken_at > now() - interval '10 minutes'
         and (case when v_phone is not null then qa.guest_phone = v_phone
                   else qa.guest_phone is null and qa.guest_name = v_name end)) >= 10
     or (select count(distinct qa.submission_id) from public.quiz_attempts qa
          where qa.course_id = l.course_id and qa.unit_id = l.unit_id and qa.staff_id is null
            and qa.taken_at > now() - interval '10 minutes') >= 300 then
    raise exception 'too_many_submissions';
  end if;

  -- ★0321: '번호 확인됨'은 앱 주장(p_phone_verified)이 아니라 서버 인증 기록으로 정한다.
  --   이 값이 approve_member·my_guest_quiz_history 의 이력 승계 근거라, 남의 번호를 적어 그 사람 이력을 만들 수 있었다.
  --   p_phone_verified 는 옛 앱 호환으로 받는다(false 면 확인 안 한 것으로 둔다).
  v_verified := v_phone is not null and coalesce(p_phone_verified, false)
    and exists (select 1 from public.phone_otps o where o.phone = v_phone and o.verified_at > now() - interval '1 hour');

  -- 배열 크기를 먼저 끊는다(0113 과 같은 이유 — 링크는 카톡방에 도는 물건이다).
  -- ★0202: 상한 50 → 500. 0188 이 **출제** 상한을 없앤 뒤로 앞뒤가 안 맞았다 — 문항 51개짜리
  --   퀴즈는 51개가 전부 출제되는데 제출은 too_many_rows 로 통째로 거부됐고, 손님은 다 풀고
  --   나서야 "보내지 못했어요"를 봤다. 출제와 제출의 상한이 어긋나면 그 퀴즈는 존재만 하고
  --   끝낼 수가 없다. 값 500 은 copy_knowhow_between 의 남용 하드상한과 같은 값이다
  --   (한 요청이 무한정 커지지 않게 하는 목적이지, 문항 수를 판단하는 값이 아니다 — 개수 판단은
  --   퀴즈를 만드는 사장이 한다는 0188 결정 그대로).
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 500 then raise exception 'too_many_rows'; end if;
  if p_strict and exists(select 1 from jsonb_array_elements(v_list) e
    where jsonb_typeof(e)<>'object' or coalesce(e->>'item_id','')='') then raise exception 'bad_answers'; end if;

  -- ── 문항별: 소유 검사 → 서버 채점 → 스냅샷 기록 ──────────────────────────
  -- ★0203: **문항 하나당 한 번만** 받는다. 예전엔 배열을 그대로 순회해, 같은 item_id 를 200번
  --   보내면 200행이 적혔다(문항 1개짜리 퀴즈의 점수가 '200문제 중 200개'가 된다 — 실측 확인).
  --   그 행들이 0199 quiz_course_stats 의 sum(correct)/sum(total) 에도 들어가 코스 정답률을 오염시킨다.
  --   같은 문항이 여러 번 오면 **처음 것**을 남긴다(먼저 낸 답이 그 사람의 답이다).
  for a in
    with raw as (
      select e ->> 'item_id'                        as item_id,
             coalesce(e -> 'response', 'null'::jsonb) as response,
             (ord - 1)::int                         as ord
        from jsonb_array_elements(v_list) with ordinality as t(e, ord)
       where jsonb_typeof(e) = 'object'
    ),
    once as (
      select distinct on (item_id) item_id, response, ord
        from raw
       where item_id is not null
       order by item_id, ord
    )
    select item_id, response, ord from once order by ord
  loop
    continue when a.item_id is null;

    -- ★그 링크의 코스에 담긴 문항인지 확인한다. 이 검사가 없으면 임의 문항 id 로 남의 노하우에
    --   점수를 심을 수 있다(0113 quiz_link_grade 와 같은 검사).
    --   조용히 버린다(예외 아님) — 문항 하나가 그 사이 지워졌다고 응시자의 나머지 답까지 잃으면 안 된다.
    select * into q from public.quiz_link_servable(l) qi where qi.id=a.item_id;
    if not found then
      -- 0203: 그 사이 지워진 문항이나 다른 코스 문항은 버리고 나머지 답을 저장한다.
      continue;
    end if;

    -- 로그인 경로와 **같은 판정 함수**다. 클라가 보낸 정오답을 믿지 않는다.
    -- 문항이 깨져 있으면 여기서 예외가 난다 — 조용한 오답으로 뭉개지 않는다(0107 §3 과 같은 태도).
    select * into g from public.quiz_grade_item(a.item_id, l.unit_id, a.response);

    insert into public.quiz_attempt_items
      (unit_id, submission_id, item_id, ord, format, payload, response, correct, course_id, entry_ids)
    values
      (l.unit_id, v_sub, q.id, a.ord, q.format, q.payload, a.response, coalesce(g.correct, false), l.course_id, q.entry_ids);
  end loop;

  -- ── 노하우별 집계 → quiz_attempts (0112 행 단위 그대로) ─────────────────
  -- 문항 하나가 노하우 여러 건에 걸리면 각 노하우에 1건씩 센다 — 0103 매장 통계와 같은 귀속 방식.
  with agg as (
    select unnest(ai.entry_ids) as entry_id, ai.correct
      from public.quiz_attempt_items ai
     where ai.submission_id = v_sub
  ),
  scored as (
    select agg.entry_id,
           count(*)::int                              as total,
           count(*) filter (where agg.correct)::int   as correct
      from agg
     where exists (
       select 1 from public.course_entries ce
        where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = agg.entry_id
     )
     group by agg.entry_id
  ),
  ins as (
    -- ★0189 에서 course_id 한 칸만 늘었다 — 값은 링크가 이미 들고 있는 것(l.course_id)이다.
    insert into public.quiz_attempts
      (unit_id, entry_id, course_id, guest_name, guest_phone, guest_phone_verified, submission_id, total, correct)
    -- 번호가 없거나 서버 인증 기록이 없으면 false(★0321).
    select l.unit_id, s.entry_id, l.course_id, v_name, v_phone, v_verified, v_sub, s.total, s.correct
      from scored s
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end $function$;

revoke all on function public.quiz_link_submit_internal(text,text,text,boolean,jsonb,text,boolean) from public,anon,authenticated;
create or replace function public.quiz_link_submit(p_token text,p_guest_name text,p_guest_phone text,p_phone_verified boolean,p_answers jsonb)
returns integer language sql volatile security definer set search_path = public as $$
  select public.quiz_link_submit_internal(p_token,p_guest_name,p_guest_phone,p_phone_verified,p_answers,null,false)
$$;
revoke all on function public.quiz_link_submit(text,text,text,boolean,jsonb) from public;
grant execute on function public.quiz_link_submit(text,text,text,boolean,jsonb) to anon,authenticated;
create or replace function public.quiz_link_submit_v2(p_token text,p_guest_name text,p_guest_phone text,p_phone_verified boolean,p_answers jsonb,p_request_id text)
returns integer language sql volatile security definer set search_path = public as $$
  select public.quiz_link_submit_internal(p_token,p_guest_name,p_guest_phone,p_phone_verified,p_answers,p_request_id,true)
$$;
revoke all on function public.quiz_link_submit_v2(text,text,text,boolean,jsonb,text) from public;
grant execute on function public.quiz_link_submit_v2(text,text,text,boolean,jsonb,text) to anon,authenticated;

-- 통계 요청에서 고른 근거만 처리한 뒤 로그 전체를 counted로 바꾸면 나머지 근거가 사라진다.
-- 로그를 원자적으로 소비할 때 그 로그의 모든 근거를 함께 집계한다. 클라 숫자는 여전히 무시한다.
create or replace function public.record_quiz_stats(p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid:=auth.uid(); v_unit text:=public.auth_unit_id(); r record;
begin
  if v_uid is null or v_unit is null or p_stats is null or jsonb_typeof(p_stats)<>'array' then return; end if;
  for r in
    with want as (select distinct e->>'entry_id' as entry_id from jsonb_array_elements(p_stats) e),
    mine as (
      update public.quiz_grade_log g set counted=true
       where g.staff_id=v_uid and g.unit_id=v_unit and not g.counted
         and g.graded_at>now()-interval '2 hours' and g.entry_ids && array(select entry_id from want)
      returning g.entry_ids,g.correct
    )
    select e.entry_id,count(*)::int as attempts,count(*) filter(where not m.correct)::int as misses
      from mine m cross join lateral (select distinct unnest(m.entry_ids) as entry_id) e
     group by e.entry_id
  loop
    insert into public.knowhow_quiz_stats as k(entry_id,unit_id,attempt_count,miss_count,last_missed_at)
    select p.id,p.unit_id,r.attempts,r.misses,case when r.misses>0 then now() end
      from public.playbook_entries p where p.id=r.entry_id and p.unit_id=v_unit
    on conflict(entry_id) do update set attempt_count=k.attempt_count+excluded.attempt_count,
      miss_count=k.miss_count+excluded.miss_count,last_missed_at=coalesce(excluded.last_missed_at,k.last_missed_at);
  end loop;
end $$;

-- 출제·채점·제출·진행이 같은 문항 집합을 보게 한다. 출제만 다른 조건을 쓰면 낸 문항이 제출에서 조용히 버려진다.
-- 서명은 0307 그대로다. 코스를 안 보내는 옛 호출(p_course_id null)은 옛 동작을 유지한다.
create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3, p_course_id text default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  if p_course_id is not null then
    return query
      select q.id, q.kind, q.format,
             public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
             q.entry_ids
        from public.quiz_course_servable(v_unit, p_course_id) q
       where q.entry_ids && p_entry_ids
       order by md5(q.id || v_uid)
       limit least(greatest(coalesce(p_limit, 3), 1), 20);
    return;
  end if;
  return query
    select q.id, q.kind, q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = v_unit and q.status = 'active'
       and q.format = any(public.quiz_known_formats())
       and q.entry_ids && p_entry_ids
       and not exists (select 1 from public.playbook_entries h
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id
                          and (h.brand_hidden_at is not null or h.archived_at is not null))
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
revoke all on function public.quiz_items_for(text[], int, text) from public, anon, authenticated;
grant execute on function public.quiz_items_for(text[], int, text) to authenticated;

create or replace function public.quiz_link_items(p_token text, p_limit int default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql stable security definer set search_path = public as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then return; end if;
  return query
    select q.id, q.kind, q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_link_servable(l) q
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;
revoke all on function public.quiz_link_items(text, int) from public;
grant execute on function public.quiz_link_items(text, int) to anon, authenticated;

-- 낸 퀴즈(발송했거나 살아 있는 링크가 있는 퀴즈)의 마지막 문항은 빼지 못한다. 0문항 퀴즈는 아무도 끝낼 수 없다.
-- 퀴즈를 그만 내려면 퀴즈를 보관·삭제한다. 노하우 보관(0314 트리거)과 본사 배포·회수가 문항을 정리하는 경로는 막지 않는다.
create or replace function public.tg_quiz_items_keep_last()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'active' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.status = 'active' then return new; end if;
  if pg_trigger_depth() > 1 or coalesce(current_setting('brand.deploying', true), '') = '1' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.training_courses c
     where c.unit_id = old.unit_id and c.active and c.brand_hidden_at is null
       and (old.course_id is null or c.id = old.course_id)
       and exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id = old.id)
       and not exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id <> old.id)
       and (exists (select 1 from public.quiz_assignments a where a.course_id = c.id and a.sent_at is not null)
            or exists (select 1 from public.quiz_links l where l.course_id = c.id and l.revoked_at is null))
  ) then
    raise exception 'last_quiz_item' using hint = '마지막 문항은 뺄 수 없어요. 퀴즈를 그만 내려면 퀴즈를 보관하세요.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.tg_quiz_items_keep_last() from public, anon, authenticated;
drop trigger if exists trg_quiz_items_keep_last on public.quiz_items;
create trigger trg_quiz_items_keep_last
  before delete or update of status on public.quiz_items
  for each row execute function public.tg_quiz_items_keep_last();
