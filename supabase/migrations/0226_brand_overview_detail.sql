-- 0226_brand_overview_detail.sql — 본사(브랜드) 축 P9-3: 집계 세분화 (2026-09-23)
--
-- 스펙 정본 = `기획/본사대시보드/02_직영가맹_권한모델_2026-09-23.md` §3(이유 2)·§4-1·§10(P9-3).
-- 규칙 = brand-boundary.md. AGENTS ⑧ 최고 번호 베이스 = 0223(brand_overview_rows).
--
-- ★왜 이 두 숫자인가(정본 §3 이유 2). 본사가 진짜로 알고 싶은 것은 "누가 밀리고 있나"다.
--   그 답으로 **개인 이름을 주지 않는다** — 직영이어도 주지 않는다(§3 확정). 대신 매장 단위 집계를
--   더 세밀하게 준다: "미이수 3명" · "오답 몰린 노하우 2건". 본사는 점장에게 말하면 되고, 점장은
--   누군지 안다. 이렇게 하면 "개인 데이터는 경로 자체가 없다"는 문장이 조건 없이 유지된다.
--
-- ★`create or replace` 뿐이다 — RETURNS TABLE 은 0223 이 이미 두 칸(staff_behind·weak_entries)을
--   `null::bigint` 자리표시로 뚫어 뒀다. 그래서 이 장은 **함수 3개를 DROP 하지 않는다**
--   (0212 가 mastery 를 뚫고 0217 이 본문만 채운 것과 같은 방식 · 지시서 §6 #2).
--   ⛔본문을 고치면서 RETURNS TABLE 을 건드리지 않는다. 건드리는 순간 brand_overview·my_brand_mirror 가
--     "cannot change return type of existing function" 으로 막힌다.
--
-- ★두 칸 모두 **운영 공개('ops')에서만** 값이 나간다(정본 §4-1 표) — tasks_done_30d·quiz_courses 와 같은 문.
--   관계(직영/가맹)와는 무관하다. 직영이라고 더 주지 않는다.

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
    -- ── staff_behind — 배포된 본사 노하우를 **하나라도** 아직 안 본 직원 수 ──────────
    -- 분모는 mastery 와 **같은 집합**이다(발행·미숨김 사본). 두 숫자가 다른 재료를 쓰면
    -- "숙지율 100% 인데 미이수 3명" 같은 모순이 화면에 뜬다.
    -- 사본이 0건이면 null — 0명이 아니다(재료 없음과 전원 이수는 다르다 · mastery 와 같은 규칙).
    -- ★이름은 나가지 않는다. `staff_id` 는 exists 안에서만 쓰이고 바깥으로 새지 않는다(정본 §3).
    case when bu.visibility = 'ops' then
      (select case when not exists (
                     select 1 from public.playbook_entries c
                      where c.unit_id = u.id and c.brand_entry_id is not null
                        and c.status = 'published' and c.brand_hidden_at is null)
                   then null
                   else (select count(*) from public.profiles pr
                          where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
                            and exists (
                              select 1 from public.playbook_entries c
                               where c.unit_id = u.id and c.brand_entry_id is not null
                                 and c.status = 'published' and c.brand_hidden_at is null
                                 and not exists (select 1 from public.knowhow_understanding ku
                                                  where ku.entry_id = c.id and ku.staff_id = pr.id)))
              end)
    end,
    -- ── weak_entries — 오답이 몰린 본사 노하우 건수 ───────────────────────────────
    -- 기준은 매장 앱과 **같은 값**이다: 응시 5회 이상 + 오답률 40% 이상
    -- (`src/lib/quiz/useQuizBoard.ts` 의 QUIZ_MISS_MIN_ATTEMPTS=5 · QUIZ_MISS_RATE=0.4).
    -- ⛔여기서 다른 기준을 쓰면 점주 화면의 "자꾸 틀리는 문항"과 본사 숫자가 어긋난다.
    --   그 둘이 어긋나면 본사가 전화해서 말하는 건수와 점주가 보는 건수가 달라진다.
    -- ★이것은 직원 평가가 아니라 **노하우 결함 신호**다(0103 설계 · 매장 앱 C2 되먹임과 같은 뜻).
    --   `knowhow_quiz_stats` 에는 staff_id 가 아예 없다 — 개인으로 되돌릴 경로가 없다.
    case when bu.visibility = 'ops' then
      (select count(*) from public.knowhow_quiz_stats ks
         join public.playbook_entries c on c.id = ks.entry_id
        where ks.unit_id = u.id
          and c.unit_id = u.id and c.brand_entry_id is not null
          and c.status = 'published' and c.brand_hidden_at is null
          and ks.attempt_count >= 5
          and ks.miss_count::numeric / ks.attempt_count >= 0.4)
    end
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
