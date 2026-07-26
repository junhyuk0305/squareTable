-- 0083_payment_claims.sql — 계좌이체 입금 신고 → 승인 → 활성화의 "무음 구간" 제거
--
-- ── 배경(§① 증상 → 구조) ──────────────────────────────────────────────────────
-- 지금까지 사장의 '입금 완료했어요'는 mailto 메일 초안을 열 뿐이었다(billing.tsx 주석에 명시).
--   사장 입금 → 메일 → 사람이 읽음 → scripts/activate-store.mjs 수동 실행.
-- 이 사슬엔 DB 흔적이 한 톨도 없다. 메일이 스팸함에 들어가거나 묻히면 **사장은 돈을 냈는데 앱이 안 열리고,
--   우리는 그 사실 자체를 모른다.** 8월 유료 100개면 반드시 터진다.
-- 구조적 결함은 "알림 채널이 약하다"가 아니라 **입금 신고라는 상태가 시스템에 존재하지 않는다**는 것이다.
--
-- ── 처방 ────────────────────────────────────────────────────────────────────────
-- 입금 신고를 1급 행(payment_claims)으로 만든다. 사장이 누르면 pending 행이 남고, 운영자 콘솔이 그 목록을
--   보고, 승인은 활성화(admin_activate_store)까지 **한 트랜잭션**으로 간다. 메일은 보조 경로로 강등.
-- 활성화 경로는 여전히 admin_activate_store 하나뿐이다(§② SSOT) — 이 마이그레이션은 그 앞단에
--   "누가 언제 얼마를 어떤 입금자명으로 냈다고 신고했는가"를 붙일 뿐, 구독 판정/게이트는 손대지 않는다.
--
-- ── 격리/보안(db-rls 규칙) ──────────────────────────────────────────────────────
-- ★0079 교훈: (user, unit) 테이블의 멤버십 가드를 RPC 에만 두면 클라가 PostgREST 로 직접 insert 해
--   우회한다. 여기서는 처음부터 **RLS WITH CHECK 에 멤버십·역할·상태·금액을 전부** 넣는다
--   (RLS 단독으로 성립 — definer RPC 가 없어도 안전).
-- update/delete 는 **정책도 테이블 권한도 주지 않는다** = 기본 deny. 검토(승인·반려)는 service_role 전용
--   RPC 한 곳으로만. 즉 사장이 자기 신고를 스스로 'approved' 로 바꿔 앱을 여는 경로가 존재하지 않는다.
-- RLS 정책 술어의 무인자 안정함수는 (select auth.uid()) 로 감싼다(0019 패턴 — 행마다 재평가 방지).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 테이블
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.payment_claims (
  id             uuid        primary key default gen_random_uuid(),
  -- units.id 는 text(레거시 시드 id 호환) → unit_members.unit_id 와 동일 타입.
  unit_id        text        not null references public.units (id) on delete cascade,
  claimed_by     uuid        not null references auth.users (id) on delete cascade,
  -- 무료는 입금이 없다 → single|multi 만. (플랜 SSOT 표시는 src/lib/config/tiers.ts)
  plan           text        not null check (plan in ('single', 'multi')),
  -- 서버가 계산해 넣는 청구액(원). 클라가 보낸 금액은 신뢰하지 않는다 — payment_claim_amount() SSOT.
  amount_krw     int         not null check (amount_krw >= 0),
  -- ★계좌이체 대사의 유일한 키. 지금까지 아예 받지 않던 값이라 운영자가 은행 내역과 맞출 방법이 없었다.
  depositor_name text        not null check (char_length(btrim(depositor_name)) between 1 and 40),
  months         int         not null default 1 check (months between 1 and 12),
  memo           text        check (memo is null or char_length(memo) <= 500),
  status         text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- 운영자 식별자(관리자 콘솔의 STAFF 이메일). service_role 경로라 auth.uid() 가 없다 → text.
  reviewed_by    text        check (reviewed_by is null or char_length(reviewed_by) <= 120),
  reviewed_at    timestamptz,
  reject_reason  text        check (reject_reason is null or char_length(reject_reason) <= 500),
  created_at     timestamptz not null default now()
);

-- 중복 신고 방지의 **최종 방어선**. submit_payment_claim 이 pending 을 갱신하도록 짜여 있지만,
-- 직접 insert 경로(RLS 허용)나 동시 탭 두 번 누름에서도 매장당 pending 은 하나여야 한다.
create unique index if not exists payment_claims_one_pending_per_unit
  on public.payment_claims (unit_id) where status = 'pending';

-- 운영자 콘솔 기본 정렬(대기 오래된 순 / 최근 신고 순).
create index if not exists payment_claims_status_created_idx
  on public.payment_claims (status, created_at desc);
-- 사장 화면(내 매장 최근 신고 1건) · 알림 파생.
create index if not exists payment_claims_unit_created_idx
  on public.payment_claims (unit_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 청구액 계산 — 서버 SSOT (클라 금액 불신)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ 카운터파트: src/lib/config/tiers.ts 의 PLANS.single.monthlyKrw / PLANS.multi.monthlyKrw 와
--    planMonthlyPrice(). 파일럿 할인가(single 9,000 · multi 매장당 19,000)를 바꾸면 **양쪽을 함께** 바꾼다.
--    (0062 가 캡을 클라·서버 양쪽에 두고 있는 것과 같은 구조 — 클라=표시, 서버=강제.)
-- multi 는 "매장당" 요금이라 소유 매장 수가 곱해진다 = 클라 planMonthlyPrice(plan, ownedCount) 와 동일식.
create or replace function public.payment_claim_amount(p_uid uuid, p_plan text, p_months int)
returns int language sql stable security definer set search_path = public as $$
  select case p_plan
    when 'single' then 9000 * greatest(coalesce(p_months, 1), 1)
    when 'multi'  then 19000 * greatest(coalesce(p_months, 1), 1) * greatest(
      (select count(*)::int from public.unit_members m where m.user_id = p_uid and m.role = 'owner'), 1)
    else null
  end
$$;
grant execute on function public.payment_claim_amount(uuid, text, int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) RLS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.payment_claims enable row level security;

-- 조회: 그 매장의 **사장만**. 남의 매장 행은 존재 자체가 안 보인다(크로스테넌트).
drop policy if exists payment_claims_select on public.payment_claims;
create policy payment_claims_select on public.payment_claims
  for select to authenticated
  using (
    exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid())
        and m.unit_id = payment_claims.unit_id
        and m.role = 'owner'
    )
  );

-- 생성: 사장 본인이 · 자기 매장에 · pending 으로만 · 서버 계산 금액으로만 · 검토필드는 비워서.
-- ★이 WITH CHECK 가 RPC 우회(PostgREST 직접 insert)를 단독으로 막는다(0079 교훈).
--   빠뜨리면 남의 매장 신고 위조 / 'approved' 위조 / 금액 위조가 전부 열린다.
drop policy if exists payment_claims_insert on public.payment_claims;
create policy payment_claims_insert on public.payment_claims
  for insert to authenticated
  with check (
    claimed_by = (select auth.uid())
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and reject_reason is null
    and amount_krw = public.payment_claim_amount((select auth.uid()), plan, months)
    and exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid())
        and m.unit_id = payment_claims.unit_id
        and m.role = 'owner'
    )
  );

-- update/delete 정책 없음 = 기본 deny. 아래 grant 에서도 update/delete 를 주지 않는다(이중 자물쇠).
grant select, insert on public.payment_claims to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 신고 RPC — 사장만, 활성 매장 기준, 중복 신고는 갱신
-- ════════════════════════════════════════════════════════════════════════════
-- p_amount 는 클라가 화면에 표시했던 금액이지만 **저장하지 않는다**(위조 방지). 서버가 다시 계산한다.
--   시그니처에 남겨 두는 이유: 호출부가 보낸 값이 서버 값과 달라지는 순간 = tiers.ts ↔ 이 함수의 드리프트라,
--   운영자 콘솔이 금액 불일치로 눈에 띄게 된다(실패로 막지는 않는다 — 결제 시점 outage 를 만들지 않기 위해).
create or replace function public.submit_payment_claim(
  p_plan      text,
  p_amount    int  default null,
  p_depositor text default null,
  p_months    int  default 1,
  p_memo      text default null
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_months int  := greatest(coalesce(p_months, 1), 1);
  v_dep    text := nullif(btrim(coalesce(p_depositor, '')), '');
  v_amount int;
  v_row    public.payment_claims;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  -- 입금자명이 없으면 대사가 불가능하다 → 애초에 행을 만들지 않는다(운영자에게 못 맞추는 행 넘기기 금지).
  if v_dep is null then raise exception 'depositor_required'; end if;

  -- 클라가 보낸 unit_id 는 받지 않는다. 활성 매장(auth_unit_id)에서 **사장 멤버십**을 서버가 확인한다.
  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  v_amount := public.payment_claim_amount(v_uid, p_plan, v_months);

  -- 중복 신고 = 새 행이 아니라 기존 pending 갱신(운영자 목록이 같은 매장으로 도배되지 않게).
  -- created_at 은 **건드리지 않는다** — 대기 경과시간이 리셋되면 오래 기다린 사장이 목록에서 묻힌다.
  update public.payment_claims c
     set plan = p_plan, amount_krw = v_amount, depositor_name = v_dep, months = v_months, memo = p_memo
   where c.unit_id = v_unit and c.status = 'pending'
  returning c.* into v_row;
  if found then return v_row; end if;

  insert into public.payment_claims (unit_id, claimed_by, plan, amount_krw, depositor_name, months, memo)
  values (v_unit, v_uid, p_plan, v_amount, v_dep, v_months, p_memo)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.submit_payment_claim(text, int, text, int, text) from public;
grant execute on function public.submit_payment_claim(text, int, text, int, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) 검토 RPC — service_role 전용. 승인은 활성화까지 한 트랜잭션.
-- ════════════════════════════════════════════════════════════════════════════
-- 승인과 활성화가 갈라지면 "승인은 눌렀는데 매장은 안 열린" 상태가 생긴다(지금 수동 운영의 실패 모드 그대로).
-- admin_activate_store 가 실패하면 status 갱신도 함께 롤백된다 → 목록에 pending 으로 남아 다시 보인다.
create or replace function public.review_payment_claim(
  p_id       uuid,
  p_approve  boolean,
  p_reason   text default null,
  p_reviewer text default null
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_row    public.payment_claims;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- for update: 두 운영자가 동시에 승인을 눌러도 두 번 활성화되지 않는다(아래 pending 검사와 한 쌍).
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'claim_not_found: %', p_id; end if;
  if v_row.status <> 'pending' then raise exception 'claim_not_pending: %', v_row.status; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'reject_reason_required'; end if;

  if p_approve then
    -- 기간 계산은 admin_activate_store 소유(greatest(paid_until, now()) + interval) — 조기·중복 입금에도 손실 없음.
    perform * from public.admin_activate_store(v_row.unit_id, v_row.months * 30, v_row.plan);
  end if;

  update public.payment_claims set
    status        = case when p_approve then 'approved' else 'rejected' end,
    reviewed_at   = now(),
    reviewed_by   = nullif(btrim(coalesce(p_reviewer, '')), ''),
    reject_reason = case when p_approve then null else v_reason end
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;
-- 로그인 사용자는 호출 불가 — 자기 신고를 스스로 승인하는 경로를 원천 차단.
-- ★ `from public` 만으로는 못 막는다. Supabase 는 public 스키마 신규 함수에 anon/authenticated 로
--   **역할별 EXECUTE 를 따로** 부여한다(alter default privileges) → PUBLIC 회수는 그 grant 를 안 건드린다.
--   0036/0062 가 정확히 이 함정에 빠져 있었다(0084 에서 함께 교정). 반드시 역할을 명시해 회수한다.
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;

-- ── 적용 후 게이트 ───────────────────────────────────────────────────────────
--   node scripts/qa-payment-claims.mjs   (신고·크로스테넌트·RLS 우회 차단·승인 활성화·반려 사유·중복 신고)
--   node scripts/qa-billing-tiers.mjs    (과금층 회귀 — admin_activate_store 를 새 경로가 부르므로)
--   node scripts/audit-crosstenant.mjs   (테넌트 격리 회귀)
