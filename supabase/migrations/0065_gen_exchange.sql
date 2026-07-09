-- 0065_gen_exchange.sql — 생년월일 필수 수집 + 세대 간 노하우 교류 집계 (IR 임팩트 지표)
--
-- 목표: "노하우를 만든 사람(giver)과 그 노하우로 답을 받은 사람(receiver)의 나이대가
--   서로 다르면 교류 1건"을 측정한다. 수집(가입 UI) 이외의 전부 — 교류 기록·나이대
--   파생·세대 판정·집계 — 를 DB에서 처리한다(클라 트래킹 코드 신설 없음).
--
-- 설계 결정:
--   · SSOT = profiles.birth_date 한 곳. 교류 레코드(knowhow_transfers)에는 나이대를
--     복사 저장하지 않는다 — 집계 뷰가 profiles 를 조인해 조회 시점에 파생하므로
--     "다른 세대" 정의를 바꿔도 과거 데이터 전체가 자동 재집계된다.
--   · 필수화 컷오프 = 2026-07-09 19:00Z(=07-10 04:00 KST). 라이브 최신 계정 생성이
--     07-10 03:39 KST 임을 확인하고 그 뒤로 잡았다 — 기존 계정(파일럿 소수)은 전원
--     면제(이번 범위에서 건드리지 않음), 컷오프 이후 생성 계정은 서버가 강제.
--   · 강제 계층 분리(0030 철학 유지): handle_new_user 트리거는 절대 throw 금지 →
--     메타데이터의 birth_date 를 안전 파싱해 "기록만" 하고, 차단 결정 + named 에러는
--     post-signup RPC(create_store / join_by_invite)가 담당한다.
--   · AI 경로는 엣지 무변경: SERVE(그라운딩 게이트 통과) 판정은 클라가 내리지만 그
--     결과가 이미 서버 테이블 chat_queries 에 영속된다(response_block->>'mode'='served'
--     + matched_entry_ids). 그 INSERT 에 트리거를 걸어 transfer 를 파생한다.
--     mode='generated'(복수 종합)·후보 카드·에스컬레이션 강등은 카운트 제외.
--   · 사장 인박스 경로: unknown_queries 가 status='resolved_with_entry' 로 전이하는
--     UPDATE(클라 resolveUnknown)에 트리거 — 클라 코드 무변경.
--   · 교류 트리거는 전부 fail-open: 기록 실패가 답변/해결 흐름을 절대 막지 않는다.
--   · 노출 통제: profiles_read RLS 는 같은 매장 동료의 행 전체 SELECT 를 허용하고
--     profiles 는 realtime publication 멤버다 → birth_date 를 그냥 추가하면 동료
--     클라이언트에 노출된다. 컬럼 단위 GRANT 로 birth_date 만 클라 권한에서 제외한다
--     (WALRUS/PostgREST 모두 컬럼 권한을 존중 — qa-gen-exchange 가 라이브 실증).
--     knowhow_transfers·집계 뷰는 unit_subscriptions(0036) 패턴 = 클라 정책/권한 0,
--     운영(service_role) 조회 전용.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) profiles.birth_date — SSOT 컬럼 (+ 상식 범위 CHECK)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists birth_date date;

-- 기존 계정 행 때문에 null 허용. 값이 있으면 1920-01-01 이상 · 오늘 이전만.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_birth_date_range' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_birth_date_range
      check (birth_date is null or (birth_date >= date '1920-01-01' and birth_date < current_date));
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 안전 파서 — 가입 트리거용(절대 throw 금지 경로에서 사용)
-- ════════════════════════════════════════════════════════════════════════════
-- 형식 불량·범위 밖이면 null (차단은 RPC 가 named 에러로 담당).
create or replace function public.safe_birth_date(p_raw text)
returns date language plpgsql stable as $$
declare v date;
begin
  v := nullif(btrim(coalesce(p_raw, '')), '')::date;
  if v is null or v < date '1920-01-01' or v >= current_date then return null; end if;
  return v;
exception when others then
  return null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) handle_new_user 재확정 — 정본=0030 + birth_date 기록(양 경로). 무결성 책임 ZERO 유지
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0030 대비): raw_user_meta_data->>'birth_date' 를 safe_birth_date 로 파싱해
-- 저장하는 컬럼 1개 추가. throw 금지·보안 불변식(role=junior·unit_id=null) 100% 동일.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_detail text;
begin
  insert into public.profiles (id, unit_id, name, role, phone, phone_last4, birth_date)
  values (
    new.id,
    null,                                                   -- 메타데이터 unit_id 무시(테넌트 주입 차단)
    coalesce(new.raw_user_meta_data->>'name',''),
    'junior',                                               -- 항상 junior로 시작(가입 시 권한상승 차단)
    nullif(new.raw_user_meta_data->>'phone',''),
    coalesce(
      right(public.normalize_phone(nullif(new.raw_user_meta_data->>'phone','')), 4),
      new.raw_user_meta_data->>'phone_last4'
    ),
    public.safe_birth_date(new.raw_user_meta_data->>'birth_date')
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    -- 0030 그대로: phone_norm 충돌만 흡수(계정 생존 우선). 그 외 위반은 전파.
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%(phone_norm)%' then
      raise;
    end if;
    insert into public.profiles (id, unit_id, name, role, phone, phone_last4, birth_date)
    values (
      new.id,
      null,
      coalesce(new.raw_user_meta_data->>'name',''),
      'junior',
      null,                                                 -- phone 보류(충돌)
      null,
      public.safe_birth_date(new.raw_user_meta_data->>'birth_date')
    )
    on conflict (id) do nothing;
    return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 강제 헬퍼 — "이 계정, 생년월일 요건 충족?" 판정 SSOT (create_store·join 공용)
-- ════════════════════════════════════════════════════════════════════════════
-- p_birth_date 가 오면 검증 후 SSOT 에 기록(최초 1회만 — 이미 있으면 보존).
-- 컷오프 이후 생성된 계정인데 birth_date 가 여전히 없으면 named 에러로 거부.
create or replace function public.ensure_birth_date(p_uid uuid, p_birth_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cutoff constant timestamptz := timestamptz '2026-07-09 19:00:00+00'; -- 07-10 04:00 KST
begin
  if p_birth_date is not null then
    if p_birth_date < date '1920-01-01' or p_birth_date >= current_date then
      raise exception 'birth_date_invalid';
    end if;
    update public.profiles p
       set birth_date = coalesce(p.birth_date, p_birth_date)
     where p.id = p_uid;
  end if;
  if exists (
    select 1 from public.profiles p
     where p.id = p_uid and p.created_at >= v_cutoff and p.birth_date is null
  ) then
    raise exception 'birth_date_required';
  end if;
end $$;
-- 클라가 직접 부를 함수가 아님 — create_store/join_by_invite(definer) 내부 전용.
revoke execute on function public.ensure_birth_date(uuid, date) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) create_store 재확정 — 정본=0062 + p_birth_date. 시그니처 변경이라 구버전 drop
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0062 대비): p_birth_date 파라미터 + ensure_birth_date 호출 한 블록.
-- 과금캡·하드상한 15·모호성 방지(#variable_conflict) 등 나머지 로직 100% 동일.
-- 구버전(3인자)을 남기면 오버로드로 강제가 우회되므로 drop — 배포된 구클라의
-- named-args 호출은 default 로 새 함수에 해석된다.
drop function if exists public.create_store(text, text, text);

create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null,
  p_birth_date date default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_code  text;
  v_biz   text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind   text := nullif(btrim(coalesce(p_industry, '')), '');
  v_owned int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- 직원(다른 매장에 소속돼 있고 오너 멤버십이 없음)은 매장 생성 불가 — 직원은 단일매장(축3).
  -- 오너는 이미 매장이 있어도 추가 생성 허용(다점포).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null)
     and not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'already_in_store';
  end if;

  -- 다점포 안전 상한(요금제 티어와 별개의 하드 상한).
  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  -- 매장 수 캡: 2번째 매장부터는 다점포(multi) 플랜 전용. FREE_MODE 면 우회.
  if not public.billing_free_mode() and v_owned >= 1 then
    if exists (
      select 1
        from public.unit_members m
        left join public.unit_subscriptions s on s.unit_id = m.unit_id
       where m.user_id = v_uid and m.role = 'owner'
         and coalesce(s.plan, 'free') <> 'multi'
    ) then
      raise exception 'plan_limit_store';
    end if;
  end if;

  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  -- 오너 멤버십 추가(다점포 소속 SSOT).
  insert into public.unit_members (user_id, unit_id, role)
  values (v_uid, v_unit, 'owner')
  on conflict (user_id, unit_id) do nothing;

  -- unit_id(주매장)는 첫 매장만 세팅해 보존, 활성은 항상 방금 만든 매장으로.
  update public.profiles set
    unit_id        = coalesce(unit_id, v_unit),
    active_unit_id = v_unit,
    role           = 'owner'
  where id = v_uid;

  -- 신규 매장 = 3일 무료체험(0036)·plan 기본 free. ON CONFLICT(unit_id) 대신 WHERE NOT EXISTS(0040).
  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  select v_unit, 'trialing', now() + interval '3 days'
  where not exists (
    select 1 from public.unit_subscriptions s where s.unit_id = v_unit
  );

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) join_by_invite 재확정 — 정본=0038 + p_birth_date. 시그니처 변경이라 구버전 drop
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0038 대비): p_birth_date 파라미터 + ensure_birth_date 호출 한 블록.
-- 브루트포스 잠금·승인 대기 게이트 등 나머지 로직 100% 동일.
-- (신규 직원은 가입 메타데이터 → handle_new_user 로 이미 기록되는 게 정상 경로고,
--  이 파라미터는 그 경로가 새는 경우의 벨트+서스펜더 + 서버 단독 강제 지점이다.)
drop function if exists public.join_by_invite(text);

create or replace function public.join_by_invite(p_code text, p_birth_date date default null)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- 최근 10분 실패 5회 이상 잠금(무차별 대입 차단). 감사 INSERT 없는 경로라 raise 유지.
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too_many_attempts';
  end if;

  -- 이미 소속(unit_id) 또는 신청중(pending_unit_id)이면 중복 신청 차단.
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  select u.id, u.store_name into v_unit, v_name
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- raise 대신 정상 return → INSERT 커밋(실패비용 누적, 0031 잠금 작동). 0행 = invalid_code 신호.
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id 는 사장 승인(approve_member) 때 비로소 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;
grant execute on function public.join_by_invite(text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) 노출 통제 — profiles 컬럼 단위 GRANT (birth_date 만 클라 권한에서 제외)
-- ════════════════════════════════════════════════════════════════════════════
-- profiles_read RLS(0032)는 같은 매장 동료·합류 신청자의 "행"을 허용한다(의미 무변경 유지).
-- 컬럼 축은 GRANT 로 통제: 테이블 SELECT 를 회수하고 birth_date 를 뺀 전 컬럼을 재부여.
-- 목록을 하드코딩하지 않고 카탈로그에서 유도 — 누락 컬럼으로 기존 select 가 깨지는 사고 방지.
-- (PostgREST 명시 컬럼 select·realtime(WALRUS) 모두 컬럼 권한을 존중한다. service_role 불변.)
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name <> 'birth_date';

  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', cols);

  -- UPDATE 도 실사용 컬럼으로 좁힌다(본인 birth_date 사후 변조/삭제 차단 — 커버리지 지표 보호).
  -- 클라 update 경로는 db.ts updateProfileFields(name/phone/bio 등) 하나뿐(계층 경계).
  -- role/unit_id/pending_unit_id 는 이미 RLS WITH CHECK 로 잠겨 있고, 여기서 추가로 컬럼 권한도 좁힌다.
  revoke update on public.profiles from anon, authenticated;
  grant update (name, phone, phone_last4, avatar, bio, meta) on public.profiles to authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (8) knowhow_transfers — 교류 기록 (서버 전용, 나이대·생년월일 컬럼 없음)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.knowhow_transfers (
  id          bigint generated always as identity primary key,
  giver_id    text not null,                 -- 노하우 작성자/답변자 (auth.uid()::text 문자열)
  receiver_id text not null,                 -- 질문자
  knowhow_id  text,                          -- 근거 노하우(playbook_entries.id, 있으면)
  unit_id     text not null references public.units(id) on delete cascade,
  source      text not null check (source in ('ai_serve','owner_answer')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_kt_unit_created on public.knowhow_transfers(unit_id, created_at desc);
create index if not exists idx_kt_created on public.knowhow_transfers(created_at);

-- unit_subscriptions(0036) 패턴 강화판: RLS enable + 클라 정책 0개(읽기까지 서버 전용).
-- 벨트+서스펜더로 테이블 권한 자체도 회수 — 쓰기는 트리거(definer), 읽기는 service_role 만.
alter table public.knowhow_transfers enable row level security;
revoke all on table public.knowhow_transfers from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (9) 기록 트리거 a — AI SERVE: chat_queries INSERT 파생 (클라·엣지 무변경)
-- ════════════════════════════════════════════════════════════════════════════
-- 카운트 대상 = response_block->>'mode' = 'served' (그라운딩 게이트 통과·저장답 그대로 서빙)만.
--   'generated'(복수 노하우 AI 종합)·후보 카드(mode 없음)·에스컬레이션 강등은 제외.
-- giver = 근거 노하우(matched_entry_ids[1])의 작성자, receiver = 질문자(junior_id).
-- 자기 노하우를 자기가 서빙받은 경우(giver=receiver)는 교류가 아니므로 제외.
-- fail-open: 어떤 예외도 삼켜 채팅 기록 INSERT(답변 영속)를 절대 막지 않는다.
create or replace function public.log_transfer_from_chat()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_giver text;
begin
  if coalesce(new.response_block->>'mode', '') <> 'served' then return new; end if;
  if new.junior_id is null or coalesce(array_length(new.matched_entry_ids, 1), 0) = 0 then return new; end if;

  select pe.creator_id into v_giver
    from public.playbook_entries pe
   where pe.id = new.matched_entry_ids[1];

  if v_giver is null or v_giver = new.junior_id then return new; end if;

  insert into public.knowhow_transfers (giver_id, receiver_id, knowhow_id, unit_id, source)
  values (v_giver, new.junior_id, new.matched_entry_ids[1], new.unit_id, 'ai_serve');
  return new;
exception when others then
  raise warning 'log_transfer_from_chat swallowed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_log_transfer_cq on public.chat_queries;
create trigger trg_log_transfer_cq
  after insert on public.chat_queries
  for each row execute function public.log_transfer_from_chat();

-- ════════════════════════════════════════════════════════════════════════════
-- (10) 기록 트리거 b — 사장 인박스 답변: unknown_queries 해결 전이 파생 (클라 무변경)
-- ════════════════════════════════════════════════════════════════════════════
-- 신호 = status 가 'resolved_with_entry' 로 "전이"(재저장·중복 발화 방지) + 답 엔트리 존재.
-- giver = 발행된 노하우(resolved_with_entry_id)의 작성자(=답변한 사장),
--   폴백 = 이 UPDATE 를 실행한 세션(auth.uid()) — 레거시 엔트리에 creator_id 가 없을 때.
create or replace function public.log_transfer_from_inbox()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_giver text;
begin
  if new.status <> 'resolved_with_entry' or old.status is not distinct from new.status then return new; end if;
  if new.resolved_with_entry_id is null or new.junior_id is null then return new; end if;

  select pe.creator_id into v_giver
    from public.playbook_entries pe
   where pe.id = new.resolved_with_entry_id;
  v_giver := coalesce(v_giver, auth.uid()::text);

  if v_giver is null or v_giver = new.junior_id then return new; end if;

  insert into public.knowhow_transfers (giver_id, receiver_id, knowhow_id, unit_id, source)
  values (v_giver, new.junior_id, new.resolved_with_entry_id, new.unit_id, 'owner_answer');
  return new;
exception when others then
  raise warning 'log_transfer_from_inbox swallowed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_log_transfer_uq on public.unknown_queries;
create trigger trg_log_transfer_uq
  after update on public.unknown_queries
  for each row execute function public.log_transfer_from_inbox();

-- ════════════════════════════════════════════════════════════════════════════
-- (11) 나이대 파생 + 집계 뷰 (운영 service_role 조회 전용 — 클라 노출 불필요)
-- ════════════════════════════════════════════════════════════════════════════
-- 10년 단위 밴드(10대~60대+). 20세 미만은 '10대'로 흡수, 60세 이상은 '60대+'.
-- 정의를 바꾸면 이 함수 하나만 고치면 된다(뷰가 조회 시점에 파생 — 과거 전체 자동 재집계).
create or replace function public.age_band(p_birth date)
returns text language sql stable as $$
  select case
    when p_birth is null then null
    when extract(year from age(current_date, p_birth)) >= 60 then '60대+'
    when extract(year from age(current_date, p_birth)) < 20 then '10대'
    else (floor(extract(year from age(current_date, p_birth)) / 10) * 10)::int || '대'
  end
$$;

-- 행 단위 상세: transfer + giver/receiver 나이대 + cross_gen 판정.
-- cross_gen = 양쪽 birth_date 가 모두 존재(both_known)하고 나이대가 서로 다름.
-- birth_date 가 null 인 쪽이 있으면 교류 자체는 남되 판정에서 제외(커버리지로 표시).
create or replace view public.gen_exchange_detail as
select
  t.id, t.unit_id, t.source, t.created_at,
  t.giver_id, t.receiver_id, t.knowhow_id,
  public.age_band(gp.birth_date) as giver_band,
  public.age_band(rp.birth_date) as receiver_band,
  (gp.birth_date is not null and rp.birth_date is not null) as both_known,
  (gp.birth_date is not null and rp.birth_date is not null
   and public.age_band(gp.birth_date) <> public.age_band(rp.birth_date)) as cross_gen
from public.knowhow_transfers t
left join public.profiles gp on gp.id::text = t.giver_id     -- id 는 uuid, 기록은 text — text 쪽으로 캐스팅(레거시 id 안전)
left join public.profiles rp on rp.id::text = t.receiver_id;

-- 요약 1행: 총 교류·세대 간 교류·주간 추이·giver×receiver 나이대 매트릭스·입력 커버리지 %.
create or replace view public.gen_exchange_stats as
select
  (select count(*) from public.gen_exchange_detail)                                    as total_transfers,
  (select count(*) from public.gen_exchange_detail where both_known)                   as judgeable_transfers,
  (select count(*) from public.gen_exchange_detail where cross_gen)                    as cross_gen_transfers,
  (select round(100.0 * count(*) filter (where birth_date is not null) / greatest(count(*), 1), 1)
     from public.profiles where deleted_at is null)                                    as birth_coverage_pct,
  (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'total', total, 'cross_gen', cg) order by w), '[]'::jsonb)
     from (
       select (date_trunc('week', created_at at time zone 'Asia/Seoul'))::date as w,
              count(*) as total,
              count(*) filter (where cross_gen) as cg
         from public.gen_exchange_detail
        group by 1
     ) wk)                                                                             as weekly,
  (select coalesce(jsonb_agg(jsonb_build_object('giver', giver_band, 'receiver', receiver_band, 'count', c)
                             order by giver_band, receiver_band), '[]'::jsonb)
     from (
       select giver_band, receiver_band, count(*) as c
         from public.gen_exchange_detail
        where both_known
        group by 1, 2
     ) mx)                                                                             as band_matrix;

-- 뷰는 소유자(postgres) 권한으로 실행돼 RLS 를 우회하므로 클라 권한을 전부 회수한다.
revoke all on public.gen_exchange_detail from anon, authenticated;
revoke all on public.gen_exchange_stats  from anon, authenticated;
grant select on public.gen_exchange_detail to service_role;
grant select on public.gen_exchange_stats  to service_role;

-- PostgREST 스키마 캐시 갱신(시그니처 변경 즉시 반영).
notify pgrst, 'reload schema';
