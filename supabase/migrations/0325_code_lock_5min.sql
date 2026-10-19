-- 0325 코드 대입 잠금 = 10분에 5번 틀리면 5분 · 게스트 퀴즈 제출 = 같은 사람 10분 10번 + 링크 10분 300번 (2026-10-20 사용자 결정)
--
-- 0323 까지는 "최근 10분 실패가 5번 이상이면 거부"였다 → 실제 잠금이 최대 10분이었고, 풀린 직후 한 번만 더 틀려도 다시 잠겼다.
-- 바꾼 규칙: 10분 안에 5번 틀리면 그때부터 5분 잠근다. 잠금이 풀리면 횟수는 처음부터 센다(풀리기 전 실패는 세지 않는다).
--   초대코드(join)·할인코드(promo) 둘 다. 같은 전화번호를 쓰는 계정(사장·직원 계정)은 함께 잠긴다.
-- 옛 앱 호환: 오류 코드는 그대로 too_many_attempts 다.

create table if not exists public.code_locks (
  uid          uuid not null,
  kind         text not null check (kind in ('join', 'promo')),
  locked_until timestamptz not null,
  primary key (uid, kind)
);
alter table public.code_locks enable row level security;
revoke all on public.code_locks from anon, authenticated;

-- 나 + 같은 전화번호 계정
create or replace function public.code_lock_group(p_uid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_uid
  union
  select p2.id from public.profiles p1 join public.profiles p2 on p2.phone_norm = p1.phone_norm
   where p1.id = p_uid and p1.phone_norm is not null and p1.phone_norm <> ''
$$;

create or replace function public.code_locked(p_uid uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.code_locks l
                  where l.kind = p_kind and l.locked_until > now()
                    and l.uid in (select public.code_lock_group(p_uid)))
$$;

-- 실패 1번을 적은 직후 부른다. 마지막 잠금이 풀린 뒤 · 최근 10분 실패가 5번이면 5분 잠근다.
create or replace function public.code_note_failure(p_uid uuid, p_kind text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_since timestamptz;
  v_n     int;
begin
  select greatest(now() - interval '10 minutes', coalesce(max(l.locked_until), '-infinity'::timestamptz)) into v_since
    from public.code_locks l where l.kind = p_kind and l.uid in (select public.code_lock_group(p_uid));
  if p_kind = 'join' then
    select count(*) into v_n from public.join_attempts ja
     where ja.ok = false and ja.attempted_at > v_since and ja.uid in (select public.code_lock_group(p_uid));
  else
    select count(*) into v_n from public.promo_attempts pa
     where pa.attempted_at > v_since and pa.uid in (select public.code_lock_group(p_uid));
  end if;
  if v_n >= 5 then
    insert into public.code_locks (uid, kind, locked_until) values (p_uid, p_kind, now() + interval '5 minutes')
    on conflict (uid, kind) do update set locked_until = excluded.locked_until;
  end if;
end $$;

revoke execute on function public.code_lock_group(uuid) from public, anon, authenticated;
revoke execute on function public.code_locked(uuid, text) from public, anon, authenticated;
revoke execute on function public.code_note_failure(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_by_invite(p_code text, p_birth_date date DEFAULT NULL::date)
 RETURNS TABLE(unit_id text, store_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
  v_role    text;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★0323: 번호 인증을 코드 대조보다 먼저 본다. 예전엔 합류가 성공할 때만(profiles 트리거) 봤다 —
  --   번호 없는 이메일 계정을 새로 만들어 가며 코드를 대입할 수 있었고, 맞는 코드는 PHONE_NOT_VERIFIED 로 티가 났다.
  --   오류 코드는 그 트리거와 같다(옛 앱 문구 매핑 그대로).
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- ★0325: 10분에 5번 틀리면 5분 잠근다(같은 전화번호 계정 합산 · 잠금이 풀리면 처음부터 센다).
  if public.code_locked(v_uid, 'join') then raise exception 'too_many_attempts'; end if;

  -- 오너는 초대 합류 불가(남의 매장 junior로 강등 방지).
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role = 'owner' then raise exception 'owner_cannot_join'; end if;

  -- 신청중이면 중복 신청 차단(한 번에 하나). 다점포: 이미 소속이어도 '다른 매장' 신청은 허용(already_in_store 제거).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  select u.id, u.store_name, u.deleted_at into v_unit, v_name, v_deleted
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- 0행 = invalid_code 신호(실패비용 누적 → 잠금).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return;
  end if;

  -- ★0266: 사장이 탈퇴해 삭제 대기인 매장, 무료 초과로 잠긴 매장은 신청을 받지 않는다.
  --   신청을 넣으면 승인할 사람이 없어 신청자가 대기에 갇힌다.
  if v_deleted is not null or public.unit_access_locked(v_unit) then
    raise exception 'store_not_accepting';
  end if;

  -- 이미 이 매장의 멤버면 차단(다점포: 다른 매장은 위에서 통과).
  if exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = v_unit) then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    raise exception 'already_member';
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id/unit_members는 사장 승인(approve_member) 때 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text)
 RETURNS TABLE(unit_id text, status text, paid_until timestamp with time zone, plan text, days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes;
  v_cur_plan  text;
  v_cur_until timestamptz;  -- 'infinity' = 수동 무기한
  v_new_until timestamptz;
  v_rank_cur  int;          -- free 0 · single 1 · multi 2
  v_rank_new  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_norm = '' then raise exception 'code_required'; end if;

  -- 클라가 보낸 unit_id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  -- ★0325: 10분에 없는 코드를 5번 넣으면 5분 잠근다(같은 전화번호 계정 합산 · 잠금이 풀리면 처음부터 센다).
  if public.code_locked(v_uid, 'promo') then raise exception 'too_many_attempts'; end if;

  -- 코드 행 잠금 — 동시 리딤이 캡(max_redemptions)을 넘지 못하게 검사~카운트 증가를 직렬화.
  select * into v_code from public.promo_codes c where c.code = v_norm for update;
  -- ★0323: 없는 코드는 예외 대신 빈 결과로 끝낸다 — 예외면 시도 기록이 함께 되돌려져 잠금이 쌓이지 않는다.
  --   새 앱은 빈 결과를 '등록되지 않은 코드'로 읽는다. 옛 앱은 '코드 적용에 실패했어요'를 띄운다(문구만 덜 정확해진다).
  if not found then
    insert into public.promo_attempts (uid) values (v_uid);
    perform public.code_note_failure(v_uid, 'promo');
    return;
  end if;
  if not v_code.active then raise exception 'code_inactive'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'code_expired';
  end if;
  if v_code.max_redemptions is not null and v_code.redeemed_count >= v_code.max_redemptions then
    raise exception 'code_exhausted';
  end if;

  -- 판정(0135 규칙 · 0136 에서 헬퍼로 정리):
  --   ① 진짜 유료 매장에는 코드가 안 든다 — 코드는 획득 수단이지 기존 고객이 쓰는 물건이 아니다(0092·0133).
  --   ② 가입 체험(0134)은 '유료'로 치지 않는다 — 안 그러면 모든 신규 매장이 코드를 못 쓴다.
  --   ③ 체험 중이라도 나빠지는 교환은 막는다 — admin_activate_store 는 기간을 더하지 않고
  --      now + days 로 **덮어쓰므로**, 30일 체험에 7일 코드를 넣으면 고객이 손해다.
  v_cur_plan := public.effective_plan(v_unit);
  if v_cur_plan <> 'free' then
    if not public.is_signup_trial(v_unit) then
      raise exception 'already_paid';
    end if;
    v_cur_until := public.effective_until(v_unit);
    v_new_until := now() + make_interval(days => v_code.days);
    v_rank_cur  := case v_cur_plan  when 'multi' then 2 when 'single' then 1 else 0 end;
    v_rank_new  := case v_code.plan when 'multi' then 2 when 'single' then 1 else 0 end;
    -- 허용 = 기간이 늘어난다  OR  (플랜이 올라가면서 기간이 짧아지지 않는다)
    if not (
      v_new_until > v_cur_until
      or (v_rank_new > v_rank_cur and v_new_until >= v_cur_until)
    ) then
      raise exception 'already_paid';
    end if;
  end if;

  begin
    insert into public.promo_redemptions (code, unit_id, redeemed_by)
    values (v_norm, v_unit, v_uid);
  exception when unique_violation then
    raise exception 'already_redeemed';
  end;

  update public.promo_codes c set redeemed_count = c.redeemed_count + 1 where c.code = v_norm;

  -- 활성화는 SSOT 한 곳(admin_activate_store)으로 — definer 라 EXECUTE 권한은 소유자 기준이라 호출 가능.
  return query
    select a.unit_id, a.status, a.paid_until, a.plan, v_code.days
    from public.admin_activate_store(v_unit, v_code.days, v_code.plan) a;
end $function$;

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
