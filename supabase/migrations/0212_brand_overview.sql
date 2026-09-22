-- 0212_brand_overview.sql — 본사(브랜드) 축 P2 ④: 조회 — 연결 매장 요약 · 수준별 컬럼 null (2026-09-22)
--
-- 스펙 = 정본 §4-A(공개 수준표)·§3-4·§6-2 ①·§6-3. 규칙 = brand-boundary.md.
--
-- ★이것이 본사가 매장 데이터를 읽는 **유일한 경로**다. 매장 테이블에 브랜드 축 RLS 정책은 없다.
--   방어선 = 이 본문의 `brand_has_unit`(active 연결) + 수준 case. `qa:brand-boundary` 가 1:1 로 실증한다.
--
-- 수준별 컬럼(§4-A):
--   요약(summary)  = 상태·payer·직원 수·노하우 수·미해결 질문 **수**·AI 사용량 (+숙지율·오답 집중은 P4·P5 재료가 생기면)
--   노하우 공개    = 요약 + 매장 자체 노하우 제목·본문 읽기(brand_unit_entries)
--   운영 공개      = 노하우 공개 + 미해결 질문 **내용**(발화자 비식별, brand_unit_questions) + 업무 완료 수 + 자체 퀴즈 수
--   어느 수준에도 없음 = 급여·근태·직원 이름·전화·개인별 점수·개인 로그·채팅 → 이 파일 어디에도 그 테이블이 없다.
--
-- 숙지율(mastery)은 "배포한 브랜드 노하우 중 그 매장 직원이 1명 이상 아는 것의 비율"이라 사본(P4)이
-- 생기기 전엔 재료가 없다 → 지금은 null. 컬럼을 미리 두는 이유 = RETURNS TABLE 열 변경은 DROP 이 필요해
-- (42P13) 클라 타입까지 같이 흔들린다. P4 에서 본문만 바꾼다.

create or replace function public.brand_overview()
returns table(
  unit_id              text,
  store_name           text,
  industry             text,
  payer                text,
  visibility           text,
  visibility_requested text,
  payer_proposed       text,
  payer_proposed_by_brand boolean,
  accepted_at          timestamptz,
  staff                bigint,     -- 요약: 직원 수(owner_overview 와 같은 원천: profiles role=junior)
  knowhow_own          bigint,     -- 요약: 매장 자체 발행 노하우 수
  pending_q            bigint,     -- 요약: 미해결 질문 **수**
  ai_used              bigint,     -- 요약: 이번달(KST) AI 사용량
  mastery              numeric,    -- 요약: 숙지율 — P4 사본 전엔 null
  tasks_done_30d       bigint,     -- 운영 공개만, 아니면 null
  quiz_courses         bigint      -- 운영 공개만, 아니면 null
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    u.industry,
    bu.payer,
    bu.visibility,
    bu.visibility_requested,
    bu.payer_proposed,
    (bu.payer_proposed is not null and bu.payer_proposed_by is not null
       and exists (select 1 from public.brand_members bm where bm.user_id = bu.payer_proposed_by and bm.brand_id = bu.brand_id)),
    bu.accepted_at,
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'),
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    null::numeric,
    case when bu.visibility = 'ops' then
      (select count(*) from public.work_feed wf
         where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'
           and wf.created_at >= now() - interval '30 days')
    end,
    case when bu.visibility = 'ops' then
      (select count(*) from public.training_courses tc where tc.unit_id = u.id)
    end
  from public.brand_units bu
  join public.units u on u.id = bu.unit_id and u.deleted_at is null
  where bu.brand_id = (select public.auth_brand_id())   -- ★자기 브랜드
    and bu.status = 'active'                            -- ★active 연결만(해제 즉시 0행)
  order by u.store_name
$$;
grant execute on function public.brand_overview() to authenticated;

-- ── 노하우 공개 이상: 매장 자체 노하우 제목·본문 **읽기만** ───────────────────
-- 작성자 이름(creator_name)·사진·통계는 주지 않는다 — 개인 축이거나 이 수준의 약속 밖이다.
create or replace function public.brand_unit_entries(p_unit_id text)
returns table(id text, title text, category text, subcategory text, square jsonb, execution jsonb,
              version int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.category, e.subcategory, e.square, e.execution, e.version, e.updated_at
    from public.playbook_entries e
   where public.brand_has_unit((select public.auth_brand_id()), p_unit_id)
     and public.brand_visibility(p_unit_id) in ('knowhow', 'ops')
     and e.unit_id = p_unit_id
     and e.status = 'published'
   order by e.updated_at desc
$$;
grant execute on function public.brand_unit_entries(text) to authenticated;

-- ── 운영 공개만: 미해결 질문 **내용**(발화자 비식별) ───────────────────────────
create or replace function public.brand_unit_questions(p_unit_id text)
returns table(id text, query_text text, asked_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  select q.id, q.query_text, q.asked_at, q.status
    from public.unknown_queries q
   where public.brand_has_unit((select public.auth_brand_id()), p_unit_id)
     and public.brand_visibility(p_unit_id) = 'ops'
     and q.unit_id = p_unit_id
     and q.status = 'pending_owner_answer'
   order by q.asked_at desc
   limit 200
$$;
grant execute on function public.brand_unit_questions(text) to authenticated;

-- ── 본사 구성원 목록(설정 > 구성원) — 담당자 이름은 개인 축이 아니다(본사 자기 사람) ──
create or replace function public.brand_members_list()
returns table(user_id uuid, name text, joined_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(p.name, ''), m.joined_at, (m.user_id = auth.uid())
    from public.brand_members m
    left join public.profiles p on p.id = m.user_id
   where m.brand_id = (select public.auth_brand_id())
   order by m.joined_at
$$;
grant execute on function public.brand_members_list() to authenticated;

-- ── my_brand 확장: 설정 화면이 계약가·payer 기본값·결제 표시(§5-2 설정, 표시만)를 같이 읽는다 ──
-- RETURNS TABLE 열 추가 = DROP 선행(42P13). 0208 본문 베이스, 열만 추가 — 세션은 brand_id·brand_name 만 쓴다.
drop function if exists public.my_brand();
create or replace function public.my_brand()
returns table(brand_id text, brand_name text, biz_no text, default_payer text, price_per_store_krw int,
              paid_until date, workspace_unit_id text)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.biz_no, b.default_payer, b.price_per_store_krw, b.paid_until, b.workspace_unit_id
    from public.brands b
   where b.id = (select public.auth_brand_id())
$$;
grant execute on function public.my_brand() to authenticated;
