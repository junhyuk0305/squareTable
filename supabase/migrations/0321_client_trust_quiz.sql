-- 0321 클라 주장 신뢰 근본 수정 ③ — 퀴즈·이해 확인·통계·검색 색인·게스트 번호 (2026-10-19 지시서 §3-7·9·11)
--
-- 남아 있던 구멍:
--   7  직원이 quiz_attempts 에 맞힌 수를 직접 넣었다(qa_insert) → 발송 완료 판정(mark_quiz_completed)이 그 행을 보고 '다 풀었어요'.
--      knowhow_understanding.verified_at 을 직접 찍었다 → 퀴즈 없이 '이해 확인됨'.
--   9  record_quiz_stats 가 앱이 센 attempts·misses 를 그대로 더했다 → 직원이 사장 화면의 오답률을 조작.
--      playbook_embeddings 가 같은 매장이면 누구나 쓰기(for all) → 직원이 검색 색인을 망가뜨림.
--   11 quiz_link_submit 이 p_phone_verified=true 주장을 저장 → 남의 번호로 응시 이력을 만들어 합류 때 승계. 링크당 제출 상한 없음.
-- 해법(근거는 서버가 가진 사실):
--   · 직원 문항 채점(grade_quiz)이 정오답을 quiz_grade_log 에 남긴다. 이해 확인·통계는 이 기록으로만 판정·집계한다.
--     옛 앱은 문항마다 grade_quiz 를 부른 뒤 이해 확인을 저장한다 → 순서가 맞아 그대로 통과(응시 기록 저장은 순서가 정해져 있지 않아 근거로 쓰지 않는다).
--   · quiz_attempts 직접 insert 를 회수한다. 앱 쓰기는 정의자 RPC(quiz_staff_record·quiz_link_submit)뿐이다(src 직접 insert 0건).
--   · playbook_embeddings 쓰기는 관리자만(앱 색인 표시는 관리자 화면에서만 돈다 · 엣지는 service_role).
--   · 게스트 '번호 확인됨'은 phone_otps 인증 기록(1시간 안)이 있을 때만. 링크당 10분 30회.
-- 옛 앱 호환: 함수 이름·인자·반환 모양 그대로. grade_quiz 는 STABLE → VOLATILE(기록을 남기므로 · 반환 모양 불변).

-- ── 7. 직원 응시 기록 직접 insert 회수 ───────────────────────────────────────
drop policy if exists qa_insert on public.quiz_attempts;

-- ── 채점 기록(서버가 채점한 사실) ───────────────────────────────────────────
create table if not exists public.quiz_grade_log (
  id        bigserial primary key,
  unit_id   text not null,
  staff_id  uuid not null,
  item_id   text not null,
  entry_ids text[] not null,
  correct   boolean not null,
  graded_at timestamptz not null default now(),
  counted   boolean not null default false
);
create index if not exists quiz_grade_log_staff_idx on public.quiz_grade_log (staff_id, graded_at desc);
alter table public.quiz_grade_log enable row level security;
revoke all on public.quiz_grade_log from anon, authenticated;

create or replace function public.grade_quiz(p_item_id text, p_response jsonb)
returns table(correct boolean, explain text, answer jsonb)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  g record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  select * into g from public.quiz_grade_item(p_item_id, v_unit, p_response);
  -- ★0321: 채점한 사실을 남긴다 — 이해 확인(knowhow_understanding)·오답 통계(record_quiz_stats)의 근거.
  insert into public.quiz_grade_log (unit_id, staff_id, item_id, entry_ids, correct)
  select v_unit, auth.uid(), qi.id, qi.entry_ids, coalesce(g.correct, false)
    from public.quiz_items qi where qi.id = p_item_id and qi.unit_id = v_unit;
  return query select g.correct, g.explain, g.answer;
end $$;
revoke execute on function public.grade_quiz(text, jsonb) from public, anon;
grant execute on function public.grade_quiz(text, jsonb) to authenticated;

-- ── 7. 이해 확인은 맞힌 채점 기록이 있을 때만 · 시각은 서버 시계 ──────────────────
-- 내가 최근 2시간 안에 이 노하우의 문항을 맞혔나(채점 기록은 클라에 닫혀 있어 정의자로 읽는다).
create or replace function public.my_recent_correct_grade(p_unit text, p_entry text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quiz_grade_log g
                  where g.staff_id = auth.uid() and g.unit_id = p_unit and g.correct
                    and p_entry = any(g.entry_ids) and g.graded_at > now() - interval '2 hours')
$$;
revoke execute on function public.my_recent_correct_grade(text, text) from public, anon;
grant execute on function public.my_recent_correct_grade(text, text) to authenticated;

create or replace function public.knowhow_understanding_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- 앱의 직접 쓰기만 본다. 정의자 함수가 쓰는 경로는 그 함수가 판정한다.
  if current_user <> 'authenticated' or auth.uid() is null then return new; end if;
  new.staff_name := coalesce(public.my_profile_name(), new.staff_name);
  if new.verified_at is not null
     and (tg_op = 'INSERT' or new.verified_at is distinct from old.verified_at) then
    if public.my_recent_correct_grade(new.unit_id, new.entry_id) then
      new.verified_at := now();
    else
      new.verified_at := case when tg_op = 'UPDATE' then old.verified_at end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_knowhow_understanding_guard on public.knowhow_understanding;
create trigger trg_knowhow_understanding_guard before insert or update on public.knowhow_understanding
  for each row execute function public.knowhow_understanding_guard();

-- ── 9. 오답 통계는 채점 기록에서 센다(앱이 센 숫자는 쓰지 않는다) ─────────────────
create or replace function public.record_quiz_stats(p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  r      record;
begin
  if v_uid is null or v_unit is null or p_stats is null or jsonb_typeof(p_stats) <> 'array' then return; end if;
  -- 앱이 보낸 것은 "어느 노하우를 셀지"뿐이다. 몇 번 풀고 몇 번 틀렸는지는 아직 안 센 내 채점 기록에서 센다.
  for r in
    with want as (
      select distinct e ->> 'entry_id' as entry_id from jsonb_array_elements(p_stats) e limit 10
    ),
    mine as (
      update public.quiz_grade_log g set counted = true
       where g.staff_id = v_uid and g.unit_id = v_unit and not g.counted
         and g.graded_at > now() - interval '2 hours'
         and g.entry_ids && array(select entry_id from want)
      returning g.entry_ids, g.correct
    )
    select w.entry_id, count(*)::int as attempts, count(*) filter (where not m.correct)::int as misses
      from want w join mine m on w.entry_id = any(m.entry_ids)
     group by w.entry_id
  loop
    insert into public.knowhow_quiz_stats as k (entry_id, unit_id, attempt_count, miss_count, last_missed_at)
    select p.id, p.unit_id, r.attempts, r.misses, case when r.misses > 0 then now() end
      from public.playbook_entries p
     where p.id = r.entry_id and p.unit_id = v_unit
    on conflict (entry_id) do update set
      attempt_count = k.attempt_count + excluded.attempt_count,
      miss_count = k.miss_count + excluded.miss_count,
      last_missed_at = coalesce(excluded.last_missed_at, k.last_missed_at);
  end loop;
end $$;

-- ── 9. 검색 색인: 읽기는 매장 · 쓰기는 관리자만 ────────────────────────────────
drop policy if exists playbook_embeddings_rw on public.playbook_embeddings;
drop policy if exists playbook_embeddings_select on public.playbook_embeddings;
drop policy if exists playbook_embeddings_write on public.playbook_embeddings;
create policy playbook_embeddings_select on public.playbook_embeddings for select
  using (unit_id = (select public.auth_unit_id()));
create policy playbook_embeddings_write on public.playbook_embeddings for all
  using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ── 11. 게스트 퀴즈: 번호 확인은 서버 인증 기록으로 · 링크당 제출 상한 ─────────────
CREATE OR REPLACE FUNCTION public.quiz_link_submit(p_token text, p_guest_name text, p_guest_phone text, p_phone_verified boolean, p_answers jsonb)
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

  -- ★0321: 링크 하나로 10분에 30번까지만 제출을 받는다(카톡방에 도는 링크로 기록·통계를 채우지 못하게).
  --   같은 링크의 동시 제출은 한 줄로 세운다(세는 사이에 끼어들지 못하게).
  perform pg_advisory_xact_lock(hashtext('quiz_link_submit:' || l.id));
  if (select count(distinct qa.submission_id) from public.quiz_attempts qa
       where qa.course_id = l.course_id and qa.unit_id = l.unit_id and qa.staff_id is null
         and qa.taken_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too_many_submissions';
  end if;

  if v_name = '' then raise exception 'name_required'; end if;
  v_name := left(v_name, 20);

  -- ★0195: 전화번호는 **선택**이다. 0160 은 식별키라 필수로 뒀지만, 로그인 없는 외부 사람에게
  --   번호까지 요구하는 것은 개인정보 최소수집 원칙과 맞지 않았다(2026-09-13 사용자 결정).
  --   안 적으면 null 로 남는다 — 그 응시는 재응시 묶기·합류 시 이력 잇기가 안 된다(화면이 그렇게 말한다).
  --   적었으면 휴대폰 형식이어야 한다(잘못 적은 번호를 식별키로 쓰면 남의 이력에 붙는다).
  if v_phone = '' then v_phone := null; end if;
  if v_phone is not null and v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'bad_phone'; end if;

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
    select * into q
      from public.quiz_items qi
     where qi.id = a.item_id
       and qi.unit_id = l.unit_id
       and qi.status = 'active'
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(qi.entry_ids)
       );
    continue when not found;

    -- 로그인 경로와 **같은 판정 함수**다. 클라가 보낸 정오답을 믿지 않는다.
    -- 문항이 깨져 있으면 여기서 예외가 난다 — 조용한 오답으로 뭉개지 않는다(0107 §3 과 같은 태도).
    select * into g from public.quiz_grade_item(a.item_id, l.unit_id, a.response);

    insert into public.quiz_attempt_items
      (unit_id, submission_id, item_id, ord, format, payload, response, correct)
    values
      (l.unit_id, v_sub, q.id, a.ord, q.format, q.payload, a.response, coalesce(g.correct, false));
  end loop;

  -- ── 노하우별 집계 → quiz_attempts (0112 행 단위 그대로) ─────────────────
  -- 문항 하나가 노하우 여러 건에 걸리면 각 노하우에 1건씩 센다 — 0103 매장 통계와 같은 귀속 방식.
  with agg as (
    select unnest(qi.entry_ids) as entry_id, ai.correct
      from public.quiz_attempt_items ai
      join public.quiz_items qi on qi.id = ai.item_id
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
