-- 0188 게스트 응시 링크 — 문항 표본 상한 폐기(2026-09-08, 사용자 결정)
--
-- 0113 은 게스트에게 코스 문항 중 **5개 표본**만 내보냈다(`limit least(greatest(coalesce(p_limit,5),1),20)`).
-- "단기 알바에게 30문제를 내지 않는다"는 전제였는데, 사장이 이미 문항 수를 정해 만들었으므로
-- 앱이 다시 5개로 깎을 이유가 없다 → **코스에 담긴 문항 전부**를 내보낸다.
--
-- 시그니처(text, int)는 그대로 둔다 — 바꾸면 anon GRANT 와 클라 호출을 같이 고쳐야 한다.
-- p_limit 은 null(또는 0 이하) 이면 **제한 없음**이다. 양수를 주면 그만큼만(QA 하니스가 쓴다).
-- ⛔ 상한을 여기서 되살리지 말 것. 개수 판단은 퀴즈를 만드는 사장이 한다.
create or replace function public.quiz_link_items(p_token text, p_limit int default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then return; end if;   -- 만료·회수된 링크는 문항을 한 건도 내주지 않는다
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = l.unit_id
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- fail-closed(0107 §3)
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(q.entry_ids)
       )
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;

-- ── 자가점검 — **동작을 잰다**(이름·개수만 세는 점검은 죽은 분기를 통과시킨다, 0170 교훈) ──
do $$
declare
  v_unit   text;
  v_course text;
  v_token  text := 'selfcheck_0188_' || md5(clock_timestamp()::text);
  v_link   text := 'ql_selfcheck_0188';
  v_all    int;
  v_got    int;
  v_capped int;
begin
  -- anon 이 못 부르면 게스트 응시가 통째로 죽는다(CREATE OR REPLACE 는 GRANT 를 보존하지만 확인한다).
  if not has_function_privilege('anon', 'public.quiz_link_items(text, int)', 'EXECUTE') then
    raise exception '게스트 응시 경로가 닫혔다: quiz_link_items 를 anon 이 부를 수 없다';
  end if;

  -- 문항이 21건 이상인 코스를 찾아 **실제로 21건 넘게 나오는지** 잰다(옛 상한 20 이 살아 있으면 20 에서 멈춘다).
  select ce.unit_id, ce.course_id, count(*)::int
    into v_unit, v_course, v_all
    from public.course_entries ce
    join public.quiz_items q
      on q.unit_id = ce.unit_id
     and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and ce.entry_id = any(q.entry_ids)
   group by ce.unit_id, ce.course_id
  having count(*) > 20
   order by count(*) desc
   limit 1;

  if v_course is null then
    raise notice '0188 자가점검: 문항 21건 이상인 코스가 없어 상한 해제를 실측하지 못했다(참: 함수 정의는 교체됨)';
    return;
  end if;

  insert into public.quiz_links (id, course_id, unit_id, token, expires_at, revoked_at, created_at)
  values (v_link, v_course, v_unit, v_token, now() + interval '1 minute', null, now());

  select count(*)::int into v_got    from public.quiz_link_items(v_token, null);
  select count(*)::int into v_capped from public.quiz_link_items(v_token, 3);

  delete from public.quiz_links where id = v_link;

  if v_got <> v_all then
    raise exception '0188: 코스 문항 %건 중 %건만 나왔다 — 상한이 아직 살아 있다', v_all, v_got;
  end if;
  if v_capped <> 3 then
    raise exception '0188: p_limit=3 인데 %건이 나왔다 — 양수 제한이 안 먹는다', v_capped;
  end if;
  raise notice '0188 자가점검 통과: 문항 %건 전부 나옴(옛 상한 20 해제 확인) · p_limit=3 은 3건', v_got;
exception
  when others then
    delete from public.quiz_links where id = v_link;
    raise;
end $$;
