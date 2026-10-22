-- 0327 문항 0개 퀴즈는 존재할 수 없다 (2026-10-22 사용자 결정 Q3 · 계획서 P0 · N03 N21)
-- 옛 앱 호환: 안전 | RPC 이름·인자·반환형 변경 없음. 옛 클라 호출(db.ts) 중 영향받는 것은 quiz_items delete/update(status),
--   course_entries delete, quiz_assignments upsert, quiz_links insert 다. 막히는 것은 "문항을 0개로 만드는 쓰기"와
--   "문항 0개 퀴즈 발송·링크 만들기"뿐이다. 옛 앱은 그때 일반 실패 문구를 본다(사용자 결정 D 범위).
--
-- 규칙
--   ① 직접 0개로 만드는 길(사장 상세 빼기·본사 작업실 빼기·만들기 화면 빼기·노하우 빼기 = course_entries 삭제)은
--      서버가 last_quiz_item 으로 막는다. 0326 은 "낸 퀴즈"만 막았다. 이제 살아 있는 퀴즈 전부다(초안·작업실 포함).
--      문항이 원래 0개인 초안(만드는 중)은 막을 것이 없다. 막는 것은 1개 → 0개 전이뿐이다.
--   ② 간접으로 0개가 되는 길(노하우 보관·본사 숨김·형태 미지원)은 막지 않는다. 사장은 노하우를 보관할 수 있어야 한다.
--      대신 그 퀴즈는 멈춘다: 링크가 안 열리고(quiz_link_resolve), 예약 발송이 안 나가고(due_quiz_sends),
--      새 발송·링크를 만들 수 없다(아래 insert 트리거). 이미 나간 발송은 progress total_items=0 이 된다.
--      이것이 "할 퀴즈 아님"의 서버 근거다(클라 pendingCourseAssignment 는 이미 total 0 을 거른다. 벨 통합은 P3).
--      예약 행·링크 행을 지우거나 회수하지 않는 이유: 0248 과 같다. 노하우를 되살리면 그대로 다시 열린다.
--   ③ 직접 경로 판정은 PostgREST 요청(auth.role()='authenticated')에만 건다. service_role(하니스 정리·운영)과
--      정의자 RPC 안 트리거(pg_trigger_depth()>1)·본사 배포(brand.deploying=1)는 지나간다(0326 과 같은 예외 + service_role).

-- ── ① 문항 빼기: 살아 있는 퀴즈의 마지막 문항 (베이스 = 0326 · 낸 퀴즈 조건만 뺐다) ──
create or replace function public.tg_quiz_items_keep_last()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'active' then return coalesce(new, old); end if;
  -- 노하우 보관(0314 트리거)과 본사 배포·회수는 막지 않는다(②). service_role 도 지나간다(③).
  if pg_trigger_depth() > 1 or coalesce(current_setting('brand.deploying', true), '') = '1'
     or coalesce(auth.role(), '') <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.training_courses c
     where c.unit_id = old.unit_id and c.active and c.brand_hidden_at is null
       and (old.course_id is null or c.id = old.course_id)
       and exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id = old.id)
       and not exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.id <> old.id)
       -- UPDATE 는 바뀐 행이 그 코스에 여전히 나가면 통과한다(servable 조건을 NEW 에 그대로 적용).
       --   course_id 옮기기·entry_ids 비우기·미지원 형태로 바꾸기도 마지막 문항을 없애는 길이다.
       and not (tg_op = 'UPDATE' and new.status = 'active' and new.unit_id = c.unit_id
                and new.format = any(public.quiz_known_formats())
                and (new.course_id is null or new.course_id = c.id)
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
-- 0326 트리거는 status 변경만 봤다. servable 을 바꾸는 열 전부로 넓힌다.
drop trigger if exists trg_quiz_items_keep_last on public.quiz_items;
create trigger trg_quiz_items_keep_last
  before delete or update of status, course_id, entry_ids, format, unit_id on public.quiz_items
  for each row execute function public.tg_quiz_items_keep_last();

-- ── ① 노하우 빼기: 남은 노하우로 낼 문항이 없어지면 막는다 ──
-- 코스 삭제의 cascade 는 depth>1 이고 그때는 코스 행도 이미 없다. 본사 사본 동기화는 brand.deploying=1 이다.
create or replace function public.tg_course_entries_keep_last()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or coalesce(current_setting('brand.deploying', true), '') = '1'
     or coalesce(auth.role(), '') <> 'authenticated' then
    return old;
  end if;
  if exists (select 1 from public.training_courses c
              where c.id = old.course_id and c.unit_id = old.unit_id and c.active and c.brand_hidden_at is null)
     and exists (select 1 from public.quiz_course_servable(old.unit_id, old.course_id))
     and not exists (
       select 1 from public.quiz_course_servable(old.unit_id, old.course_id) s
        where exists (select 1 from public.course_entries ce
                       where ce.course_id = old.course_id and ce.unit_id = old.unit_id
                         and ce.entry_id <> old.entry_id and ce.entry_id = any(s.entry_ids))
     ) then
    raise exception 'last_quiz_item' using hint = '마지막 문항은 뺄 수 없어요. 퀴즈를 그만 내려면 퀴즈를 보관하세요.';
  end if;
  return old;
end $$;
revoke all on function public.tg_course_entries_keep_last() from public, anon, authenticated;
drop trigger if exists trg_course_entries_keep_last on public.course_entries;
create trigger trg_course_entries_keep_last
  before delete on public.course_entries
  for each row execute function public.tg_course_entries_keep_last();

-- ── ② 문항 0개 퀴즈는 새로 보내지 못한다 (0231 tg_quiz_assignment_hidden_course 와 같은 모양) ──
-- 사장이 직접 보낸 발행(origin='manual')은 실패를 알린다. 입사 자동 배정·재확인 큐는 조용히 건너뛴다.
create or replace function public.tg_quiz_assignment_no_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.quiz_course_servable(new.unit_id, new.course_id)) then return new; end if;
  -- 그 매장 코스가 아니면 여기서 판정하지 않는다. RLS(qz_insert)가 42501 로 거부한다(오류 이유가 가려지지 않게).
  if not exists (select 1 from public.training_courses c where c.id = new.course_id and c.unit_id = new.unit_id) then
    return new;
  end if;
  -- 시스템 발송(join·recheck)은 raise 하면 approve_member·스윕 전체가 실패하므로 그 행만 만들지 않는다(0231 과 같은 이유).
  if new.origin <> 'manual' then return null; end if;
  -- 문구 = src/lib/quiz/errors.ts quiz_no_items. service_role(운영·하니스 준비)은 막지 않는다(③). 그 행도 due_quiz_sends 가 거른다.
  if coalesce(auth.role(), '') = 'authenticated' then raise exception 'quiz_no_items'; end if;
  return new;
end $$;
revoke all on function public.tg_quiz_assignment_no_items() from public, anon, authenticated;
drop trigger if exists trg_quiz_assignment_no_items on public.quiz_assignments;
create trigger trg_quiz_assignment_no_items
  before insert on public.quiz_assignments
  for each row execute function public.tg_quiz_assignment_no_items();

-- ── ② 문항 0개 퀴즈는 링크를 만들지 못한다 ──
create or replace function public.tg_quiz_link_no_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role 은 막지 않는다(③). 그 링크도 quiz_link_resolve 가 열지 않는다.
  if coalesce(auth.role(), '') = 'authenticated'
     and not exists (select 1 from public.quiz_course_servable(new.unit_id, new.course_id)) then
    raise exception 'quiz_no_items';
  end if;
  return new;
end $$;
revoke all on function public.tg_quiz_link_no_items() from public, anon, authenticated;
drop trigger if exists trg_quiz_link_no_items on public.quiz_links;
create trigger trg_quiz_link_no_items
  before insert on public.quiz_links
  for each row execute function public.tg_quiz_link_no_items();

-- ── ② 링크: 낼 문항이 없는 퀴즈는 열지 않는다 (베이스 = 0248 · 0248 줄을 servable 판정으로 바꿨다) ──
create or replace function public.quiz_link_resolve(p_token text)
returns public.quiz_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.quiz_links l
   where l.token = p_token
     and l.revoked_at is null
     and l.expires_at > now()
     -- ★0231: 숨긴 본사 퀴즈의 링크는 열지 않는다.
     and not exists (select 1 from public.training_courses c
                      where c.id = l.course_id and c.brand_hidden_at is not null)
     -- ★0327: 낼 문항이 없는 퀴즈는 닫는다(되살리면 다시 열린다). 0248 의 "담긴 노하우가 전부 보관" 은 이 경우에 들어간다.
     --   0248 은 담긴 노하우가 없는 코스를 열어 뒀다. 그 코스도 문항이 0개라 이제 닫힌다(Q3).
     and exists (select 1 from public.quiz_course_servable(l.unit_id, l.course_id))
   limit 1
$$;
-- 클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다.
-- ⛔ from public 만 쓰면 안 닫힌다(0166 실측). create or replace 는 권한을 유지하지만 명시로 다시 닫는다.
revoke all on function public.quiz_link_resolve(text) from public, anon, authenticated;

-- ── ② 예약 발송: 낼 문항이 없는 퀴즈는 보내지 않는다 (베이스 = 0301 본문 통째 · 0248 줄만 바꿨다) ──
create or replace function public.due_quiz_sends()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       and c.active
       -- ★0327: 낼 문항이 없는 퀴즈는 보내지 않는다(되살리면 다시 나간다). 0248 의 "담긴 노하우가 전부 보관" 도 여기 들어간다.
       --   후보에서 빼야 한다. 뽑힌 뒤 claim 에서 거르면 그 사람의 다른 퀴즈가 이 행에 막혀 매 스윕 밀린다.
       and exists (select 1 from public.quiz_course_servable(qa.unit_id, qa.course_id))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    --    ★0301: 판정은 unit_uses_schedule 하나(할일 알림과 같음). 지난 하루 근무·옛 재직분 근무는 세지 않는다.
    if public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant execute on function public.due_quiz_sends() to service_role;

-- ── 자가점검 ──
do $$
begin
  if (select count(*) from pg_trigger where tgname in
       ('trg_quiz_items_keep_last', 'trg_course_entries_keep_last', 'trg_quiz_assignment_no_items', 'trg_quiz_link_no_items')) <> 4 then
    raise exception '0327 자가점검 실패: 0문항 가드 트리거가 빠졌다';
  end if;
  if has_function_privilege('anon', 'public.quiz_link_resolve(text)', 'execute')
     or has_function_privilege('authenticated', 'public.quiz_link_resolve(text)', 'execute')
     or has_function_privilege('authenticated', 'public.due_quiz_sends()', 'execute') then
    raise exception '0327 자가점검 실패: 내부 함수가 클라에 열려 있다';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname = 'due_quiz_sends' and p.prosrc like '%unit_uses_schedule(%' and p.prosrc like '%quiz_course_servable(%') <> 1 then
    raise exception '0327 자가점검 실패: due_quiz_sends 가 근무표·문항 판정을 둘 다 쓰지 않는다';
  end if;
end $$;
