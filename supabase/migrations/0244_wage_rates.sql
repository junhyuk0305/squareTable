-- 0244 — 시급 이력 wage_rates (J1-b · §8 Q4 · 데이터 검토 H4·"퇴사자 되살리기 금지")
--
-- 사용자 결정(J1): 과거는 그대로, 앞으로만 적용한다. 시급은 "{날짜}부터 얼마"다.
-- 사용자 결정(§8 Q4): 지난 날짜부터 바꾸면 그 기간 급여가 바뀐다 → 서버는 p_confirm_past 를 요구하고 앱이 경고창을 띄운다.
--
-- 무엇이 문제였나
--   wages 의 기본키가 (unit_id, staff_id)라 시급이 하나뿐이다(0004:47-52). 10월에 시급을 올리면 9월 표시 금액도 같이 오른다.
--   기본값 10030(2025년 최저시급)이 남아 있어 값 없이 들어온 행이 사실처럼 보인다.
--
-- 바꾸는 것
--   ① 표 wage_rates(unit_id, staff_id, hourly_wage 0..1000000, effective_from, created_at, created_by). PK (unit_id, staff_id, effective_from).
--      RLS 읽기 = wages_read(0122)와 같다(관리자 전부 · 직원은 본인 행). 쓰기 정책은 없다(정의자 RPC·트리거로만).
--      지난 급여 근거라 사장도 직접 고치거나 지우지 못한다.
--   ② 채우기: 지금 wages 값을 2000-01-01 부터로 넣는다(지난 숫자가 바뀌지 않는 채우기).
--   ③ set_wage_from(직원, 금액, 시작일, p_confirm_past): auth_is_owner()(활성 매장 사장 · 0233) · 대상이 그 매장 멤버 ·
--      금액 0..1000000 · 시작일 2000-01-01 이후 · 오늘보다 이르면 p_confirm_past 필수.
--      upsert 한 뒤 시작일이 오늘 이하이면 wages 거울을 "오늘 적용되는 시급"으로 맞춘다(p_wage 가 아니다 —
--      오늘 행이 따로 있으면 그 값이 오늘 시급이다).
--   ④ wages AFTER INSERT/UPDATE 트리거(옛 앱 경로 · 시드): 그 직원 이력이 없으면 2000-01-01 부터, 있으면 오늘부터 쌓는다.
--      새 값이 이미 오늘 시급과 같으면 아무것도 안 한다. 그래서 set_wage_from 의 거울 갱신과 일일 맞춤이
--      트리거로 오늘 행을 하나 더 만들지 않는다(세션 변수·current_user 판정 없이 값으로 판정 · 0242 가 세션 변수를 버린 이유와 같다).
--   ⑤ sync_wages_from_rates(): 미리 정한 시급이 시작되는 날 wages 를 그 값으로 맞춘다(옛 앱 표시용).
--      지금 멤버만 맞춘다(나간 직원의 wages 를 되살리지 않는다 · 데이터 검토). 미리 정한 행(시작일 전에 만든 행)이고
--      시작일이 최근 7일 안일 때만 본다 — 크론이 하루 빠져도 따라잡고, 옛 시급 행으로 wages 를 덮지 않는다.
--      pg_cron 이 있으면 매일 00:05 KST 에 돈다. 없으면(로컬 도커) 예약만 건너뛴다.
--   ⑥ wages.hourly_wage 기본값(10030)을 지운다. 클라이언트는 항상 값을 보낸다(db.ts setWageDb · 시드 3종).
--
-- 바꾸지 않는 것
--   · wages 표·정책·기본키(옛 앱 upsert 가 이 키를 쓴다). wages 는 "오늘 시급" 거울로 남는다.
--   · wages 를 읽는 정의자 함수(owner_labor_inputs 등)는 그대로 오늘 시급을 본다. 기간별 시급은 앱 C(P4-7 computePeriodPay)가 이 표로 계산한다.
--   · wages 삭제는 이력을 지우지 않는다(나간 달 정산 근거 · 데이터 검토 H4).
--
-- 옛 앱 호환: 옛 앱은 이 표와 RPC 를 모른다. wages 직접 upsert(사장)는 그대로 되고 트리거가 이력을 쌓는다.
-- ★0246 이 이 표에 archived_tenure_id 를 단다. 그때 sync_wages_from_rates · wages 트리거의 "이력 있음" 판정에
--   archived_tenure_id is null 을 붙여야 한다(재입사자에게 옛 시급이 되살아나지 않게). qa:definer-filters 에 토큰을 더한다.
-- 되돌리기: scripts/rollback/0244.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① 표 + RLS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.wage_rates (
  unit_id        text not null references public.units(id) on delete cascade,
  staff_id       text not null,                                   -- wages.staff_id 와 같다(auth uid 문자열 · FK 없음)
  hourly_wage    int  not null check (hourly_wage between 0 and 1000000),
  effective_from date not null,                                   -- 이 날부터 이 시급(다음 행 시작 전날까지)
  created_at     timestamptz not null default now(),
  created_by     uuid,                                            -- 정한 사람(사장). 채우기·시드는 null
  primary key (unit_id, staff_id, effective_from)
);

comment on table public.wage_rates is
  '시급 이력(J1-b · 0244). "effective_from 부터 hourly_wage". 쓰기는 set_wage_from · wages 트리거로만. wages 는 오늘 시급 거울.';

alter table public.wage_rates enable row level security;
revoke all on table public.wage_rates from public, anon, authenticated;
grant select on table public.wage_rates to authenticated;          -- 읽기만. 쓰기는 정의자 RPC·트리거.

drop policy if exists wage_rates_read on public.wage_rates;
create policy wage_rates_read on public.wage_rates
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- ② 채우기 — 지금 값을 2000-01-01 부터(지난 숫자가 바뀌지 않는다)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_by)
select w.unit_id, w.staff_id, w.hourly_wage, date '2000-01-01', null
  from public.wages w
 where w.hourly_wage between 0 and 1000000
on conflict (unit_id, staff_id, effective_from) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ set_wage_from — 새 앱 경로(사장만 · 활성 매장 멤버만 · 지난 날짜는 확인)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_wage_from(
  p_staff text, p_wage int, p_from date, p_confirm_past boolean default false
) returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_today date := public.kst_today();
  v_cur   int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_staff is null or not exists (select 1 from public.unit_members m
                                     where m.unit_id = v_unit and m.user_id::text = p_staff) then
    raise exception 'not_member';
  end if;
  if p_wage is null or p_wage < 0 or p_wage > 1000000 then raise exception 'invalid_wage'; end if;
  if p_from is null or p_from < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if p_from < v_today and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_by)
    values (v_unit, p_staff, p_wage, p_from, auth.uid())
  on conflict (unit_id, staff_id, effective_from)
    do update set hourly_wage = excluded.hourly_wage, created_by = excluded.created_by, created_at = now();

  -- 오늘 이하이면 옛 앱 표시(wages)를 오늘 적용되는 시급으로 맞춘다. 같은 값이면 트리거는 아무것도 안 한다.
  if p_from <= v_today then
    select r.hourly_wage into v_cur from public.wage_rates r
     where r.unit_id = v_unit and r.staff_id = p_staff and r.effective_from <= v_today
     order by r.effective_from desc limit 1;
    insert into public.wages(unit_id, staff_id, hourly_wage) values (v_unit, p_staff, v_cur)
    on conflict (unit_id, staff_id) do update set hourly_wage = excluded.hourly_wage
      where public.wages.hourly_wage is distinct from excluded.hourly_wage;
  end if;
end $$;
revoke all on function public.set_wage_from(text, int, date, boolean) from public, anon, authenticated;
grant execute on function public.set_wage_from(text, int, date, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ wages 트리거 — 옛 앱(직접 upsert)·시드 경로를 이력으로 남긴다
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.wages_to_wage_rates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  v_cur   int;
  v_any   boolean;
begin
  select r.hourly_wage into v_cur from public.wage_rates r
   where r.unit_id = new.unit_id and r.staff_id = new.staff_id and r.effective_from <= v_today
   order by r.effective_from desc limit 1;
  -- 이미 오늘 시급과 같다(set_wage_from 거울 · 일일 맞춤 · 같은 값 재저장) → 이력을 늘리지 않는다.
  if v_cur is not distinct from new.hourly_wage then return null; end if;

  v_any := exists (select 1 from public.wage_rates r where r.unit_id = new.unit_id and r.staff_id = new.staff_id);
  insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_by)
    values (new.unit_id, new.staff_id, new.hourly_wage,
            case when v_any then v_today else date '2000-01-01' end,   -- 처음 정하는 시급은 처음부터, 바꾸는 시급은 오늘부터
            auth.uid())
  on conflict (unit_id, staff_id, effective_from)
    do update set hourly_wage = excluded.hourly_wage, created_by = excluded.created_by, created_at = now();
  return null;
end $$;
revoke all on function public.wages_to_wage_rates() from public, anon, authenticated;

drop trigger if exists trg_wages_to_wage_rates on public.wages;
create trigger trg_wages_to_wage_rates
  after insert or update on public.wages
  for each row execute function public.wages_to_wage_rates();

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 일일 맞춤 — 미리 정한 시급이 시작되는 날 wages 를 맞춘다(지금 멤버만)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sync_wages_from_rates()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  n       int;
begin
  with cur as (   -- (매장, 직원)마다 오늘 적용되는 시급 한 행
    select distinct on (r.unit_id, r.staff_id) r.unit_id, r.staff_id, r.hourly_wage, r.effective_from, r.created_at
      from public.wage_rates r
     where r.effective_from <= v_today
     order by r.unit_id, r.staff_id, r.effective_from desc
  )
  insert into public.wages(unit_id, staff_id, hourly_wage)
  select c.unit_id, c.staff_id, c.hourly_wage
    from cur c
   where c.effective_from > v_today - 7                                              -- 최근 7일 안에 시작(크론 누락 따라잡기)
     and c.created_at < (c.effective_from::timestamp at time zone 'Asia/Seoul')       -- 시작일 전에 미리 정한 행
     and exists (select 1 from public.unit_members m                                 -- 지금 멤버만(퇴사자 되살리기 금지)
                  where m.unit_id = c.unit_id and m.user_id::text = c.staff_id)
  on conflict (unit_id, staff_id) do update set hourly_wage = excluded.hourly_wage
    where public.wages.hourly_wage is distinct from excluded.hourly_wage;
  get diagnostics n = row_count;
  return n;
end $$;
-- 전 매장을 훑는 전역 함수 — cron(postgres)·service_role 만.
revoke all on function public.sync_wages_from_rates() from public, anon, authenticated;
grant execute on function public.sync_wages_from_rates() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sync-wage-rates') where exists (select 1 from cron.job where jobname = 'sync-wage-rates');
    perform cron.schedule('sync-wage-rates', '5 15 * * *',  -- 매일 00:05 KST
      $sql$ select public.sync_wages_from_rates(); $sql$);
  else
    raise notice 'pg_cron 미설치 — 시급 일일 맞춤 스케줄을 건너뜀. pg_cron 을 켠 뒤 재적용하거나 sync_wages_from_rates() 를 매일 00:05 KST 에 호출할 것.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ wages.hourly_wage 기본값 제거(10030)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.wages alter column hourly_wage drop default;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 자가점검 — 표 · 정책 · 채우기 · 트리거 · 본문 · 권한 · 크론
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  r     record;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.wage_rates'::regclass) then
    v_bad := v_bad || 'wage_rates(RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.wage_rates', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'wage_rates(anon 권한 남음) ';
  end if;
  if has_table_privilege('authenticated', 'public.wage_rates', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'wage_rates(authenticated 쓰기 권한 남음) ';
  end if;
  if not has_table_privilege('authenticated', 'public.wage_rates', 'SELECT') then
    v_bad := v_bad || 'wage_rates(authenticated 읽기 없음) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'wage_rates') <> 1
     or position('auth_can_manage' in coalesce((select qual from pg_policies where schemaname = 'public'
                   and tablename = 'wage_rates' and policyname = 'wage_rates_read' and cmd = 'SELECT'), '')) = 0 then
    v_bad := v_bad || 'wage_rates(정책은 wage_rates_read 하나 · 관리자 또는 본인) ';
  end if;
  -- RLS 안에서 부르는 함수는 authenticated 가 실행할 수 있어야 한다.
  if not has_function_privilege('authenticated', 'public.auth_unit_id()', 'execute')
     or not has_function_privilege('authenticated', 'public.auth_can_manage()', 'execute')
     or not has_function_privilege('authenticated', 'public.kst_today()', 'execute') then
    v_bad := v_bad || '(RLS 헬퍼 실행 권한 없음) ';
  end if;

  -- 채우기: 지금 wages 값이 모두 오늘 시급과 같다
  if exists (select 1 from public.wages w
              where w.hourly_wage is distinct from (select x.hourly_wage from public.wage_rates x
                                                     where x.unit_id = w.unit_id and x.staff_id = w.staff_id
                                                       and x.effective_from <= public.kst_today()
                                                     order by x.effective_from desc limit 1)) then
    v_bad := v_bad || '(wages 와 오늘 시급이 다른 행 있음 — 채우기 실패) ';
  end if;
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'wages' and column_name = 'hourly_wage') is not null then
    v_bad := v_bad || 'wages.hourly_wage(기본값 남음) ';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.wages'::regclass and tgname = 'trg_wages_to_wage_rates'
         and not tgisinternal) <> 1 then
    v_bad := v_bad || '(wages 트리거 없음 — 옛 앱 시급 변경이 이력에 안 남는다) ';
  end if;

  -- 본문
  v_def := pg_get_functiondef('public.set_wage_from(text, integer, date, boolean)'::regprocedure);
  if position('auth_is_owner' in v_def) = 0 or position('auth_can_manage' in v_def) > 0
     or position('unit_members' in v_def) = 0 or position('p_confirm_past' in v_def) = 0 then
    v_bad := v_bad || 'set_wage_from(사장만·멤버 확인·지난 날짜 확인 중 빠짐) ';
  end if;
  v_def := pg_get_functiondef('public.sync_wages_from_rates()'::regprocedure);
  if position('unit_members' in v_def) = 0 then
    v_bad := v_bad || 'sync_wages_from_rates(지금 멤버 조건 없음 — 퇴사자 wages 를 되살린다) ';
  end if;

  -- 권한
  if has_function_privilege('anon', 'public.set_wage_from(text, integer, date, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_wage_from(text, integer, date, boolean)', 'execute') then
    v_bad := v_bad || 'set_wage_from(anon 불가 · authenticated 가능 이어야 함) ';
  end if;
  if has_function_privilege('anon', 'public.sync_wages_from_rates()', 'execute')
     or has_function_privilege('authenticated', 'public.sync_wages_from_rates()', 'execute')
     or not has_function_privilege('service_role', 'public.sync_wages_from_rates()', 'execute') then
    v_bad := v_bad || 'sync_wages_from_rates(service_role 전용이어야 함) ';
  end if;
  if has_function_privilege('anon', 'public.wages_to_wage_rates()', 'execute')
     or has_function_privilege('authenticated', 'public.wages_to_wage_rates()', 'execute') then
    v_bad := v_bad || 'wages_to_wage_rates(내부 전용인데 열려 있음) ';
  end if;
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('set_wage_from', 'wages_to_wage_rates', 'sync_wages_from_rates')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;

  -- 크론: pg_cron 이 있으면 예약돼 있어야 한다. 없으면(로컬) 알림만.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'sync-wage-rates') then
      v_bad := v_bad || '(pg_cron 이 있는데 sync-wage-rates 예약 없음) ';
    end if;
  else
    raise notice '0244 자가점검: pg_cron 없음 — sync-wage-rates 예약 확인 건너뜀';
  end if;

  if v_bad <> '' then raise exception '0244 자가점검 실패: %', v_bad; end if;
end $$;
