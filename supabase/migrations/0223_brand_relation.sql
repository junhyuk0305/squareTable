-- 0223_brand_relation.sql — 본사(브랜드) 축 P9-1: 매장별 관계(직영/가맹) 컬럼과 자리 (2026-09-23)
--
-- 스펙 정본 = `기획/본사대시보드/02_직영가맹_권한모델_2026-09-23.md` §2·§6·§9·§10(P9-1·P9-3).
-- 지시서 = 루트 `메가프롬프트_본사대시보드_P9_직영가맹_2026-09-23.md` §3-1·§3-3. 규칙 = brand-boundary.md.
--
-- ★이 장은 **판정을 하나도 바꾸지 않는다.** 관계를 담을 칸을 만들고, 그 값을 읽는 길(조회 RPC·내부 콘솔)만 낸다.
--   규칙(하한·해제권·필수 배포·RPC 거부)은 전부 다음 장(P9-2)이다.
--
-- ★왜 브랜드가 아니라 매장에 붙나(정본 §2 ①): 현실의 본사는 거의 다 혼합이다(직영 3 + 가맹 40).
--   브랜드 단위 플래그는 처음부터 틀린 답이라 `brands` 가 아니라 `brand_units` 에 붙인다.
--
-- ★왜 본사가 아니라 우리가 정하나(정본 §12 R3): 본사가 스스로 '직영'을 켜면 가맹에 직영 규칙이 샌다.
--   그래서 쓰기 경로는 service_role 전용 `admin_set_brand_relation` **하나**다. 본사 담당자용 RPC 는 없다.
--
-- ★P9-3(집계 세분화)의 컬럼 두 개를 **여기서 미리 뚫는다**(정본 §10 · 지시서 §6 #2).
--   `brand_overview_rows` 는 RETURNS TABLE 이 바뀔 때마다 그 위 함수 3개를 DROP 해야 한다(P5 에서 확인).
--   0212 가 `mastery` 를 `null::numeric` 자리표시로 뚫고 0217 이 본문만 채운 것과 같은 방식 — DROP 은 한 번이다.

-- ── 1) 관계 컬럼 ────────────────────────────────────────────────────────────
-- 기존 행은 전부 'franchise' 로 시작한다(안전한 쪽 — 직영 규칙은 아무 데도 안 붙는다).
-- 직영은 우리가 내부 콘솔에서 하나씩 바꾼다. 인덱스는 만들지 않는다(브랜드당 매장 수가 수십 규모 ·
-- 관계 필터는 이미 `brand_id` 인덱스로 좁혀진 뒤의 후처리다).
alter table public.brand_units
  add column if not exists relation text not null default 'franchise';

alter table public.brand_units drop constraint if exists brand_units_relation_check;
alter table public.brand_units add constraint brand_units_relation_check
  check (relation in ('direct', 'franchise'));

comment on column public.brand_units.relation is
  '이 매장이 본사와 어떤 관계인가. direct=직영(본사 고용) · franchise=가맹(독립 사업자). '
  '우리(내부 콘솔 · service_role)만 바꾼다 — 본사 담당자에게는 쓰기 경로가 없다(정본 §12 R3).';

-- ── 2) 관계 변경 — service_role 전용 ────────────────────────────────────────
-- 사유 필수 · `brand_events` 감사 로그(정본 §8 "둘 다 우리가 내부 콘솔에서만, 사유 필수, 감사 로그").
-- ★P9-2 가 이 함수를 재정의해 §8 자동 재조정(직영 전용 값 되돌림 · 동의 재요청 · 점장 알림)을 더한다.
--   지금은 값만 바꾼다 — 되돌릴 직영 전용 값 자체가 아직 없다.
create or replace function public.admin_set_brand_relation(p_unit_id text, p_relation text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.brand_units%rowtype;
begin
  if p_relation not in ('direct', 'franchise') then raise exception 'invalid_relation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if v_row.relation = p_relation then raise exception 'same_relation'; end if;

  update public.brand_units set relation = p_relation where id = v_row.id;
  perform public.brand_log(v_row.brand_id, p_unit_id, 'relation_changed',
    jsonb_build_object('from', v_row.relation, 'to', p_relation, 'reason', p_reason));
end $$;
revoke execute on function public.admin_set_brand_relation(text, text, text) from public, anon, authenticated;

-- ── 3) 조회 RPC 3개 재생성 — RETURNS TABLE 에 relation + P9-3 자리 두 개 ─────
-- AGENTS ⑧(정의 전수 → 최고 번호 베이스): brand_overview_rows·my_brand_mirror = 0217,
--   brand_overview = 0217. 본문은 **`brand_overview_rows` 한 곳만** 고치고 두 입구는 그대로 옮긴다.
-- 의존이 있어 입구 둘을 먼저 떨어뜨린다.
drop function if exists public.brand_overview();
drop function if exists public.my_brand_mirror();
drop function if exists public.brand_overview_rows(text, text[]);

create or replace function public.brand_overview_rows(p_brand text, p_units text[])
returns table(
  unit_id              text,
  store_name           text,
  industry             text,
  relation             text,
  payer                text,
  visibility           text,
  visibility_requested text,
  payer_proposed       text,
  payer_proposed_by_brand boolean,
  accepted_at          timestamptz,
  staff                bigint,
  knowhow_own          bigint,
  pending_q            bigint,
  ai_used              bigint,
  mastery              numeric,
  tasks_done_30d       bigint,
  quiz_courses         bigint,
  -- ★P9-3 자리표시(정본 §4-1 🔜). 지금은 언제나 null — 본문은 P9-3 이 `create or replace` 로만 채운다.
  --   개인 식별은 어느 쪽에도 없다: '몇 명'과 '어느 노하우'까지다(정본 §3).
  staff_behind         bigint,
  weak_entries         bigint
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    u.industry,
    bu.relation,
    bu.payer,
    bu.visibility,
    bu.visibility_requested,
    bu.payer_proposed,
    (bu.payer_proposed is not null and bu.payer_proposed_by is not null
       and exists (select 1 from public.brand_members bm where bm.user_id = bu.payer_proposed_by and bm.brand_id = bu.brand_id)),
    bu.accepted_at,
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    -- ★매장 '자체' 노하우 = 사본이 아닌 것. P4 에서 사본이 섞이기 시작하므로 조건이 한 줄 늘었다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.brand_entry_id is null),
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    (select case when count(*) = 0 then null
                 else round(count(*) filter (
                        where exists (select 1 from public.knowhow_understanding ku where ku.entry_id = c.id)
                      )::numeric / count(*), 3) end
       from public.playbook_entries c
      where c.unit_id = u.id and c.brand_entry_id is not null
        and c.status = 'published' and c.brand_hidden_at is null),
    case when bu.visibility = 'ops' then
      (select count(*) from public.work_feed wf
         where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'
           and wf.created_at >= now() - interval '30 days')
    end,
    case when bu.visibility = 'ops' then
      (select count(*) from public.training_courses tc where tc.unit_id = u.id)
    end,
    null::bigint,   -- staff_behind — P9-3
    null::bigint    -- weak_entries — P9-3
  from public.brand_units bu
  join public.units u on u.id = bu.unit_id and u.deleted_at is null
  -- ★★인자가 둘 다 null 이면 **0행**이다. 예전 술어는 `(p_brand is null or ...)` 뿐이라
  --   둘 다 null 일 때 필터가 통째로 사라져 **전 브랜드의 연결 매장이 나갔다.**
  --   `brand_overview()` 는 `auth_brand_id()` 를 넘기는데 그 값은 **담당자가 아닌 모든 사람에게 null**
  --   이고(정지 브랜드 포함 — 0208 이 status='active' 만 본다), 이 함수는 authenticated 전체에 열려 있다.
  --   = 직원 계정이 남의 브랜드 매장 이름·직원 수·AI 사용량·숙지율을 받았다.
  --   2026-09-23 로컬 리허설 F1 에서 잡았다(직원 로그인으로 1행 수신 실측). ⛔이 줄을 옮길 때 빠뜨리지 않는다.
  where (p_brand is not null or p_units is not null)    -- ★입구가 하나도 없으면 아무것도 주지 않는다
    and (p_brand is null or bu.brand_id = p_brand)
    and (p_units is null or bu.unit_id = any(p_units))
    and bu.status = 'active'                            -- ★해제 즉시 0행(양쪽 입구 공통)
  order by u.store_name
$$;
revoke execute on function public.brand_overview_rows(text, text[]) from public, anon, authenticated;

-- 입구 ① 본사 — 내 브랜드의 모든 active 연결.
create or replace function public.brand_overview()
returns table(
  unit_id text, store_name text, industry text, relation text, payer text, visibility text,
  visibility_requested text, payer_proposed text, payer_proposed_by_brand boolean,
  accepted_at timestamptz, staff bigint, knowhow_own bigint, pending_q bigint, ai_used bigint,
  mastery numeric, tasks_done_30d bigint, quiz_courses bigint, staff_behind bigint, weak_entries bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.brand_overview_rows((select public.auth_brand_id()), null)
$$;
grant execute on function public.brand_overview() to authenticated;

-- 입구 ② 점주 — "본사가 보는 화면 그대로"(§4-E ②). **내가 사장인 매장만.**
-- 관계도 같이 나간다 — 점주(직영이면 점장)는 자기 매장이 어떤 규칙으로 도는지 알아야 한다(정본 §7 고지).
create or replace function public.my_brand_mirror()
returns table(
  unit_id text, store_name text, industry text, relation text, payer text, visibility text,
  visibility_requested text, payer_proposed text, payer_proposed_by_brand boolean,
  accepted_at timestamptz, staff bigint, knowhow_own bigint, pending_q bigint, ai_used bigint,
  mastery numeric, tasks_done_30d bigint, quiz_courses bigint, staff_behind bigint, weak_entries bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.brand_overview_rows(
    null,
    array(select m.unit_id from public.unit_members m
           where m.user_id = auth.uid() and m.role = 'owner')
  )
$$;
grant execute on function public.my_brand_mirror() to authenticated;

-- ── 4) 점주 설정 > 본사 연결에도 관계를 실어 보낸다 ──────────────────────────
-- AGENTS ⑧ 최고 번호 베이스 = 0221. RETURNS TABLE 이 바뀌므로 drop 후 재생성(그 위에 얹힌 함수는 없다).
-- 점주 화면이 "가맹이라 내가 정한다 / 직영이라 본사가 정한다"를 그리는 재료다(P9-2 가 쓴다).
drop function if exists public.my_brand_view();
create or replace function public.my_brand_view()
returns table(unit_id text, brand_id text, brand_name text, brand_biz_no text, relation text, payer text, visibility text,
              visibility_requested text, payer_proposed text, payer_proposed_by_me boolean, accepted_at timestamptz,
              payer_effective_from date, brand_paid_through date)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, b.id, b.name, b.biz_no, bu.relation, bu.payer, bu.visibility,
         bu.visibility_requested, bu.payer_proposed, (bu.payer_proposed_by = auth.uid()), bu.accepted_at,
         bu.payer_effective_from, bu.brand_paid_through
    from public.brand_units bu
    join public.brands b on b.id = bu.brand_id
    join public.unit_members m on m.unit_id = bu.unit_id and m.user_id = auth.uid() and m.role = 'owner'
   where bu.status = 'active'
   order by bu.accepted_at
$$;
grant execute on function public.my_brand_view() to authenticated;

-- ── 5) 내부 콘솔이 읽는 연결 매장 표에 관계를 더한다 ────────────────────────
-- 내부 콘솔은 service_role 로 `brand_units` 를 직접 읽는다(RLS 우회) — 별도 RPC 가 없다.
-- 여기서는 할 일이 없고, 콘솔 쪽 select 목록에 `relation` 을 더하는 것이 P9-1 의 나머지다.
