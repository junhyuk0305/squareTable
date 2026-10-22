-- 0330 문항은 course_id 없이 존재할 수 없다 (계획서 P2 표 4·5번 · R1 N31 N35 · 축소 단계)
-- 올리기 조건: 옛 앱 사용자가 사실상 없음(2026-10-22 사용자 결정)
-- 옛 앱 호환: 축소 | 옛 사장 앱이 course_id 없이 문항을 만들면 거부된다(사용자 결정 Q4 로 감수).
--   옛 직원 앱의 quiz_staff_record(p_rows) 는 그대로 돈다. 문항 course_id 가 항상 있으므로 그 퀴즈로 귀속된다.
--   RPC 이름·인자·반환형 변경 없음. quiz_attempt_items.legacy_shared 열은 남긴다(새 행은 기본값 false).
-- 전제: 0328 이 공유 문항을 지웠다. 아래 validate 가 남은 null 을 발견하면 이 파일 전체가 멈춘다.

-- ── 4) NOT NULL: not valid 로 붙이고 validate → set not null(검증된 CHECK 가 있으면 전체 재검사를 건너뛴다) ──
alter table public.quiz_items drop constraint if exists quiz_items_course_required;
alter table public.quiz_items
  add constraint quiz_items_course_required check (course_id is not null) not valid;
alter table public.quiz_items validate constraint quiz_items_course_required;
alter table public.quiz_items alter column course_id set not null;
alter table public.quiz_items drop constraint quiz_items_course_required;

-- ── 5-a) servable: null 분기 제거 (베이스 = 0326) ──
-- 출제와 제출이 같은 집합을 쓴다. 호출 권한은 공개 RPC에서 검사한다.
create or replace function public.quiz_course_servable(p_unit text, p_course text)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_items q
   where q.unit_id = p_unit and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and q.course_id = p_course
     and exists (select 1 from public.course_entries ce
                  where ce.course_id = p_course and ce.unit_id = p_unit and ce.entry_id = any(q.entry_ids))
     and not exists (select 1 from unnest(q.entry_ids) e(id)
                      where not exists (select 1 from public.playbook_entries pe
                        where pe.id = e.id and pe.unit_id = p_unit
                          and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_course_servable(text, text) from public, anon, authenticated;

-- ── 5-b) 진행: legacy_shared 예외 제거 (베이스 = 0326) ──
-- 본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다.
create or replace function public.quiz_assignment_pending(p_assignment_id text)
returns table(item_id text,entry_ids text[],answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id,q.entry_ids,exists(select 1 from public.quiz_attempt_items ai
    where ai.unit_id=a.unit_id and ai.staff_id=a.user_id
      and ai.course_id=a.course_id
      and ai.item_id=q.id and ai.created_at>=a.sent_at)
    from public.quiz_assignments a
    cross join lateral public.quiz_course_servable(a.unit_id,a.course_id) q
   where a.id=p_assignment_id and a.sent_at is not null
$$;
revoke all on function public.quiz_assignment_pending(text) from public,anon,authenticated;

-- ── 5-c) 직원 제출: 코스 추측 제거 (베이스 = 0326) ──
-- 새 앱은 유실된 응답을 같은 요청 id로 재시도한다. 사용자·매장·코스마다 키를 분리한다.
-- 성공 기록을 먼저 확인하므로 문항이 삭제된 뒤의 재시도도 중복 제출되지 않는다.
-- ★0330: 코스를 안 보낸 제출(옛 서명)은 문항의 course_id 로 귀속한다. 문항은 정확히 한 퀴즈에 속하므로 추측이 필요 없다.
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
    select * into g from public.quiz_grade_item(q.id, v_unit, a.response);
    insert into public.quiz_attempt_items
      (unit_id,submission_id,staff_id,item_id,ord,format,payload,response,correct,course_id,entry_ids)
    values(v_unit,v_sub,v_uid,q.id,a.ord,q.format,q.payload,a.response,coalesce(g.correct,false),v_course,q.entry_ids);
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

-- ── 5-d) 마지막 문항 보호: null 분기 제거 (베이스 = 0327 · 판정은 그대로) ──
create or replace function public.tg_quiz_items_keep_last()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'active' then return coalesce(new, old); end if;
  -- 노하우 보관(0314 트리거)과 본사 배포·회수는 막지 않는다(0327 ②). service_role 도 지나간다(0327 ③).
  if pg_trigger_depth() > 1 or coalesce(current_setting('brand.deploying', true), '') = '1'
     or coalesce(auth.role(), '') <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.training_courses c
     where c.unit_id = old.unit_id and c.active and c.brand_hidden_at is null
       and c.id = old.course_id
       and exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id = old.id)
       and not exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id <> old.id)
       -- UPDATE 는 바뀐 행이 그 코스에 여전히 나가면 통과한다(servable 조건을 NEW 에 그대로 적용).
       --   course_id 옮기기·entry_ids 비우기·미지원 형태로 바꾸기도 마지막 문항을 없애는 길이다.
       and not (tg_op = 'UPDATE' and new.status = 'active' and new.unit_id = c.unit_id
                and new.format = any(public.quiz_known_formats())
                and new.course_id = c.id
                and exists (select 1 from public.course_entries ce
                             where ce.course_id = c.id and ce.unit_id = c.unit_id and ce.entry_id = any(new.entry_ids))
                and not exists (select 1 from unnest(new.entry_ids) e(id)
                                 where not exists (select 1 from public.playbook_entries pe
                                   where pe.id = e.id and pe.unit_id = c.unit_id
                                     and pe.archived_at is null and pe.brand_hidden_at is null)))
  ) then
    -- 문구 = src/lib/quiz/errors.ts last_quiz_item.
    raise exception 'last_quiz_item' using hint = '마지막 문항은 뺄 수 없어요. 퀴즈를 그만 내려면 퀴즈를 보관하세요.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.tg_quiz_items_keep_last() from public, anon, authenticated;

-- ── 자가점검 ──
do $$
begin
  if (select attnotnull from pg_attribute
       where attrelid = 'public.quiz_items'::regclass and attname = 'course_id') is not true then
    raise exception '0330 자가점검 실패: quiz_items.course_id 가 NOT NULL 이 아니다';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('quiz_course_servable', 'quiz_assignment_pending', 'quiz_staff_record_internal', 'tg_quiz_items_keep_last')
              -- p_course_id is null(코스를 안 보낸 제출)은 공유 문항 분기가 아니다. 문항 쪽 null 판정만 찾는다.
              and (p.prosrc ~ '(q|old|new)\.course_id is null' or p.prosrc like '%legacy_shared%')) then
    raise exception '0330 자가점검 실패: 공유 문항 분기가 남았다';
  end if;
end $$;
