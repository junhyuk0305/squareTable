-- 0334 "혼자 할 수 있어요" 출제 범위 넓힘 · 퀴즈 카드 "지난번 퀴즈" 조회 (2026-10-23 사용자 · 마무리 항목 1·3)
--
-- ① 새 앱 자청 출제 집합(quiz_self_servable_wide · 공개 RPC quiz_self_items_for): 발송된 퀴즈의 문항도 낸다
--    (10-23 사용자 "출제에는 발송된 퀴즈 문항도 써도 된다"). 새 앱은 답을 v2 서명(코스 없음)으로 내므로 self_check=true 로 적히고
--    진행(quiz_assignment_pending·state)·정답률(quiz_course_stats first_*)에 안 들어간다(0332 부터 not self_check).
--    ★출시 앱이 부르는 quiz_self_servable · quiz_items_for 는 0332 그대로 둔다(발송 퀴즈 문항 제외).
--      출시 앱의 자청 답은 옛 서명으로 와서 서버가 퀴즈 응시와 구분하지 못한다. 출제에서 막아야 Q1 이 지켜진다.
-- ② 제출 귀속(quiz_staff_record_internal): 새 앱 v2 코스 없음(p_strict) = 넓은 집합 → self.
--    옛 서명(출시 앱) = 0332 그대로(좁은 자청 집합 → self, 아니면 문항의 퀴즈로 귀속).
-- ③ quiz_my_last_submissions(p_course_ids): 퀴즈마다 내 마지막 제출(자청 제외)의 문항별 맞힘만. 문항 내용·정답은 안 준다.
--
-- 옛 앱 호환: 안전 | 기존 RPC 이름·인자·반환·권한·결과 그대로(quiz_items_for · quiz_self_servable · quiz_staff_record · _v2).
--   새 함수 quiz_self_items_for · quiz_my_last_submissions 는 옛 앱이 부르지 않는다. 새 앱이 옛 서버를 만나면
--   자청 출제는 quiz_items_for 로 돌아가고(db.ts) "지난번 퀴즈" 줄은 숨는다. 고정 = qa:quiz-contract:local '0334' 장면.
-- 함수 담당표(AGENTS ⑧): quiz_staff_record_internal 0332→0334 · 새 quiz_self_servable_wide · quiz_self_items_for 0334.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다. 이 파일은 다시 돌려도 같은 결과다(create or replace).

-- ── ① 새 앱 자청 출제 집합 (베이스 = 0332 quiz_self_servable · 발송 퀴즈 제외 줄을 빼고 퀴즈 살아 있음을 더했다) ──
-- 문항은 정확히 한 퀴즈에 속한다(0330). 그 퀴즈가 보관·본사 숨김·담긴 노하우 0개면(quiz_course_live 아님) 내지 않는다.
create or replace function public.quiz_self_servable_wide(p_unit text)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_items q
   where q.unit_id = p_unit and q.status = 'active'
     and public.quiz_course_live(p_unit, q.course_id)
     and q.format = any(public.quiz_known_formats())
     and cardinality(q.entry_ids) > 0
     and not exists (select 1 from unnest(q.entry_ids) e(id)
                      where not exists (select 1 from public.playbook_entries pe
                        where pe.id = e.id and pe.unit_id = p_unit
                          and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_self_servable_wide(text) from public, anon, authenticated;

-- 새 앱 "혼자 할 수 있어요" 출제. quiz_items_for 의 코스 없는 갈래(0332)와 같은 모양 · 넓은 집합.
create or replace function public.quiz_self_items_for(p_entry_ids text[], p_limit int default 3)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  return query
    select q.id, q.kind, q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_self_servable_wide(v_unit) q
     where q.entry_ids && p_entry_ids
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
revoke all on function public.quiz_self_items_for(text[], int) from public, anon, authenticated;
grant execute on function public.quiz_self_items_for(text[], int) to authenticated;

-- ── ② 직원 제출 (베이스 = 0332 본문 통째 · 새 앱 v2 코스 없음 갈래만 넓은 집합으로) ──
create or replace function public.quiz_staff_record_internal(
  p_rows jsonb, p_course_id text, p_request_id text, p_strict boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_unit text := public.auth_unit_id();
  v_sub text; v_list jsonb := coalesce(p_rows, '[]'::jsonb);
  a record; q public.quiz_items; g record; v_course text; v_n int; v_self boolean; v_found boolean;
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
  if p_course_id is not null and not public.quiz_course_live(v_unit, p_course_id) then
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
    v_self := false; v_found := false;
    if p_course_id is not null then
      select * into q from public.quiz_course_servable(v_unit, p_course_id) s where s.id = a.item_id;
      v_found := found;
    elsif p_strict then
      -- ★0334 새 앱 자청(v2 · 코스 없음) = 넓은 집합(발송 퀴즈 문항 포함) → self. 퀴즈 진행·정답률 밖이다(Q1).
      select * into q from public.quiz_self_servable_wide(v_unit) s where s.id = a.item_id;
      v_found := found; v_self := found;
    else
      -- 옛 서명(출시 앱) = 0332 그대로: 좁은 자청 집합이면 self, 아니면 문항의 퀴즈로 귀속(0330).
      select * into q from public.quiz_self_servable(v_unit) s where s.id = a.item_id;
      v_found := found; v_self := found;
      if not v_found then
        select * into q from public.quiz_course_servable(v_unit,
          (select qi.course_id from public.quiz_items qi where qi.id = a.item_id and qi.unit_id = v_unit)) s
         where s.id = a.item_id;
        v_found := found;
      end if;
    end if;
    if not v_found then
      -- 0203: 그 사이 지워진 문항이나 다른 코스 문항은 버리고 나머지 답을 저장한다.
      continue;
    end if;
    v_course := coalesce(p_course_id, q.course_id);
    select * into g from public.quiz_grade_item(q.id, v_unit, a.response);
    insert into public.quiz_attempt_items
      (unit_id,submission_id,staff_id,item_id,ord,format,payload,response,correct,course_id,entry_ids,self_check)
    values(v_unit,v_sub,v_uid,q.id,a.ord,q.format,q.payload,a.response,coalesce(g.correct,false),v_course,q.entry_ids,v_self);
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

-- ── ③ 퀴즈 카드 "지난번 퀴즈" (N14) ──
-- 본인 · 활성 매장 · 자청 제외. 퀴즈마다 가장 늦은 제출 하나의 문항별 맞힘을 ord 순으로.
create or replace function public.quiz_my_last_submissions(p_course_ids text[])
returns table (course_id text, submission_id text, ord int, correct boolean, taken_at timestamptz)
language sql stable security definer set search_path = public as $$
  with mine as (
    select ai.course_id, ai.submission_id, max(ai.created_at) as at
      from public.quiz_attempt_items ai
     where ai.staff_id = auth.uid() and ai.unit_id = public.auth_unit_id()
       and ai.course_id = any((coalesce(p_course_ids, '{}'::text[]))[1:50]) and not ai.self_check
     group by ai.course_id, ai.submission_id),
  last as (
    select distinct on (m.course_id) m.course_id, m.submission_id from mine m order by m.course_id, m.at desc, m.submission_id)
  select ai.course_id, ai.submission_id, ai.ord, ai.correct, ai.created_at
    from last l join public.quiz_attempt_items ai on ai.submission_id = l.submission_id and ai.course_id = l.course_id
   where ai.staff_id = auth.uid()
   order by ai.course_id, ai.ord
$$;
revoke all on function public.quiz_my_last_submissions(text[]) from public, anon;
grant execute on function public.quiz_my_last_submissions(text[]) to authenticated;

-- ── 자가점검 ──
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('quiz_self_servable', 'quiz_self_servable_wide', 'quiz_staff_record_internal')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))) then
    raise exception '0334 자가점검 실패: 내부 판정 함수가 클라에 열려 있다';
  end if;
  if has_function_privilege('anon', 'public.quiz_my_last_submissions(text[])', 'execute') then
    raise exception '0334 자가점검 실패: 지난번 제출 조회가 anon 에 열려 있다';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname = 'quiz_staff_record_internal' and (p.prosrc like '%c.active%' or p.prosrc like '%brand_hidden_at%')) then
    raise exception '0334 자가점검 실패: 퀴즈 활성 판정이 quiz_course_live 밖에 남았다';
  end if;
end $$;
