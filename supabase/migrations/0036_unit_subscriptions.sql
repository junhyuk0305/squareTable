-- 0036_unit_subscriptions.sql — 매장 단위 구독상태(무료체험/유료/만료).
--
-- 유료 전환(2026-07): PG 없이 계좌이체 수동과금. 게이팅 단위 = 매장(테넌트).
-- ⚠️ 보안 핵심: units_write 정책은 '사장이 자기 units row UPDATE 가능'을 허용한다.
--    구독 컬럼을 units 에 두면 사장이 클라이언트에서 스스로 active 로 바꿔 과금을 무력화할 수 있다.
--    → 구독상태는 **별도 테이블 + 클라 write 정책 ZERO**로 격리한다.
--    읽기만 매장 멤버에게 열고, 쓰기는 SECURITY DEFINER 함수(create_store·admin_activate_store)로만.

-- ── 구독 테이블 ─────────────────────────────────────────────
create table if not exists public.unit_subscriptions (
  unit_id       text primary key references public.units(id) on delete cascade,
  status        text not null default 'trialing'
                  check (status in ('trialing','active','expired')),
  trial_ends_at timestamptz,           -- 무료체험 만료 시각(trialing 기준)
  paid_until    timestamptz,           -- 유료 활성 만료 시각(active 기준, null=무기한)
  updated_at    timestamptz not null default now()
);

alter table public.unit_subscriptions enable row level security;

-- 읽기: 내 매장 구독만(사장·직원 공통). 무인자 안정함수는 (select ...)로 감싸 행별 재평가 회피.
drop policy if exists unit_subscriptions_read on public.unit_subscriptions;
create policy unit_subscriptions_read on public.unit_subscriptions
  for select using (unit_id = (select public.auth_unit_id()));

-- 쓰기(insert/update/delete) 정책 없음 → authenticated/anon 은 절대 변경 불가.
-- 변경은 SECURITY DEFINER 함수(정의자=테이블 소유자)가 RLS 우회로만 수행한다.

-- ── 기존 매장 백필 ──────────────────────────────────────────
-- 이미 무료로 쓰던 파일럿 매장을 갑자기 만료시키지 않도록, 넉넉한 유예(체험)로 시작한다.
-- (push 시점 기준 +7일. 이후 정책은 admin_activate_store / 수동 조정으로 관리.)
insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
select u.id, 'trialing', now() + interval '7 days'
from public.units u
on conflict (unit_id) do nothing;

-- ── create_store 확장: 신규 매장 = 3일 무료체험으로 시작 ─────
-- 0028 의 본문을 그대로 유지하고 구독행 insert 만 추가(의미 회귀 없음: 기존 반환/부작용 동일).
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_biz  text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind  text := nullif(btrim(coalesce(p_industry, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
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

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  -- 신규 매장 = 3일 무료체험. 만료 후 계좌이체 → admin_activate_store 로 active 전환.
  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  values (v_unit, 'trialing', now() + interval '3 days')
  on conflict (unit_id) do nothing;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text) to authenticated;

-- ── 운영 활성화 RPC (입금 확인 후 수동 active 전환) ──────────
-- service_role/postgres 전용. 클라이언트(anon/authenticated)에는 EXECUTE 미부여.
-- p_days 만큼 유료 기간 연장(갱신 시 현재 paid_until 이 미래면 거기서, 아니면 now()에서 연장).
create or replace function public.admin_activate_store(p_unit_id text, p_days int default 30)
returns table(unit_id text, status text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.units u where u.id = p_unit_id) then
    raise exception 'unit_not_found: %', p_unit_id;
  end if;

  insert into public.unit_subscriptions (unit_id, status, paid_until, updated_at)
  values (p_unit_id, 'active', now() + make_interval(days => p_days), now())
  on conflict (unit_id) do update set
    status     = 'active',
    -- 갱신: 기존 paid_until 이 미래면 거기서, 아니면 now()에서 연장. (ON CONFLICT 기존행은 대상 테이블명으로 참조)
    paid_until = greatest(coalesce(unit_subscriptions.paid_until, now()), now())
                 + make_interval(days => p_days),
    updated_at = now();

  return query
    select s.unit_id, s.status, s.paid_until
    from public.unit_subscriptions s where s.unit_id = p_unit_id;
end $$;

-- 기본 PUBLIC EXECUTE 회수 → 로그인 사용자도 호출 불가. 운영자(service_role)만.
revoke all on function public.admin_activate_store(text, int) from public;
grant execute on function public.admin_activate_store(text, int) to service_role;

-- ── (선택) 만료 처리 RPC — 필요 시 운영자가 강제 만료 ────────
create or replace function public.admin_expire_store(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.unit_subscriptions
    set status = 'expired', paid_until = now(), updated_at = now()
    where unit_id = p_unit_id;
end $$;
revoke all on function public.admin_expire_store(text) from public;
grant execute on function public.admin_expire_store(text) to service_role;
