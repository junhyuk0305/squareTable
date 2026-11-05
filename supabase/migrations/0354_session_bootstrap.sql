-- 0354_session_bootstrap.sql — 세션 로드 1회 RPC (2026-11-05 · M3 세션 로딩 다이어트 · 계획 §1 (1)·§2 단계 1)
-- 옛 앱 호환: 안전 · 새 함수 추가만 · 기존 함수·열·grant·publication 무변경
--   옛 클라(main 웹 · 출시 iOS·안드)는 loadProfile 에서 profiles select → session_unit → units select → unit_subscriptions select
--   → billing_free_mode → iap_enabled → needs_downgrade_choice → my_units → my_seat_locked → my_unit_locked → my_brand 를 따로 부른다.
--   이 파일은 그 함수·테이블·정책을 하나도 건드리지 않는다. 새 클라만 session_bootstrap 을 부른다.
--
-- 왜 RPC 1개인가
--   부팅·auth 이벤트·탭 복귀·폴링마다 위 11개 왕복이 직렬로 돌았다(계획 근거 ①). 요청 수를 1로 닫아야
--   폴링·이벤트 비용이 같이 닫힌다. Promise.all 은 지연만 줄이고 요청 수는 그대로라 버렸다(계획 §1 (1)(b)).
--
-- 왜 판정을 복제하지 않나(SSOT)
--   매장·역할·잠금·브랜드 판정은 각각 session_unit(0303)·my_units(0303)·my_unit_locked(0303)·my_seat_locked(0264)·
--   needs_downgrade_choice(0336)·my_brand(0212)·billing_free_mode(0062)·iap_enabled(0187) 한 곳에 있다.
--   여기서는 그 함수를 그대로 부르고 결과를 묶기만 한다. 규칙이 바뀌면 그 함수만 고치면 이 RPC 도 같이 바뀐다.
--
-- 왜 volatile 인가
--   session_unit() 은 첫 호출에 session_unit_set 쓰기를 한다(0285:78 · 계획 근거 ⑧). 이를 품는 함수가 stable 이면
--   플래너가 호출을 접거나 쓰기가 거부된다. 그래서 기본값(volatile)을 쓰고 아래 자가점검이 못박는다.
--
-- 왜 security invoker 인가(계획은 "정의자"라고 적었다 · 코드로 확인한 차이)
--   profiles·units·unit_subscriptions 는 클라가 지금 RLS 를 통해 읽는다. units_read·unit_subscriptions_read 는
--   `id = (select auth_unit_id())` 인데 0303 뒤 잠긴 매장에서는 auth_unit_id() 가 null 이라 닫힌 매장 직원에게 두 행이
--   안 보인다(storeName '' · 구독 없음). 정의자가 테이블을 직접 읽으면 그 직원에게 값이 생겨 지금 클라와 달라진다.
--   같게 하려면 정책 술어를 여기 다시 적어야 하는데 그건 복제다. invoker 로 두면 세 테이블은 클라와 같은 RLS 를 타고,
--   나머지 판정 함수는 각자 definer 라 호출에 지장이 없다. 결과 = "클라가 11번 부른 것과 같은 값" 이 보장된다.
--   (qa-session-bootstrap 이 4축 × 키마다 deepEqual 로 이를 증명한다.)
--
-- 맨 먼저 session_unit() 을 부른다(계획 §3). 첫 호출이 이 세션의 매장을 고정하므로 뒤의 조회가 전부 같은 매장 기준이다.
-- 실패 원칙: 안의 함수가 예외를 내면 그대로 전파한다(부분 성공 없음 · 계획 "실패 원칙"). 클라는 지금의 profileErr 경로를 탄다.
-- 반환 키(클라 db.ts SessionBootstrap 과 1:1 · 이름 고정):
--   deleted · profile · unit_id · unit · subscription · free_mode · iap_enabled · needs_downgrade_choice · my_units
--   · my_seat_locked · my_unit_locked · my_brand
--   탈퇴 계정(account_access_allowed() = false · 0335)은 {"deleted": true} 만 돌려준다. profiles 행이 없으면 profile=null 로
--   나머지를 채운다(클라의 "프로필 없음" 경로 = 신규/트리거 레이스 · error 없이 profile=null).
--   함수 담당표: account_access_allowed 0335 · session_unit·my_units·my_unit_locked 0303 · my_seat_locked 0264 ·
--   needs_downgrade_choice 0336 · my_brand 0212 · billing_free_mode 0062 · iap_enabled 0187 — 전부 그대로 호출.

create or replace function public.session_bootstrap()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_profile jsonb;
  v_unitrow jsonb;
  v_sub     jsonb;
  v_units   jsonb;
  v_brand   jsonb;
  v_dg      record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ① 이 세션의 매장을 먼저 고정한다(0285 첫 호출 = session_unit_set 쓰기).
  v_unit := public.session_unit();

  -- ② 탈퇴 판정 = account_access_allowed()(0335 정본 · definer). 0335 뒤 탈퇴 계정은 RLS 제한정책으로 자기 profiles 행도
  --    못 읽으므로(행 없음으로 보인다) deleted_at 을 여기서 다시 읽어 판정하면 안 된다. REST 는 보통 pre-request 가 먼저 막는다.
  if not public.account_access_allowed() then
    return jsonb_build_object('deleted', true);
  end if;

  -- ③ 내 profiles 행 — 클라 fetchSessionProfile 이 select 하던 열만. 행 없음 = null(신규/트리거 레이스 · 오류 아님).
  select to_jsonb(x) into v_profile
    from (select p.id, p.name, p.role, p.unit_id, p.active_unit_id, p.pending_unit_id, p.bio, p.phone, p.deleted_at
            from public.profiles p where p.id = v_uid) x;

  -- ④ 매장·구독 — 클라 fetchUnitInfo · fetchUnitSubscription 이 읽던 열만. RLS 는 호출자 그대로(invoker).
  if v_unit is not null then
    select to_jsonb(x) into v_unitrow
      from (select u.store_name, u.invite_code, u.invite_expires_at, u.industry
              from public.units u where u.id = v_unit) x;
    select to_jsonb(x) into v_sub
      from (select s.status, s.trial_ends_at, s.paid_until, s.plan
              from public.unit_subscriptions s where s.unit_id = v_unit) x;
  end if;

  -- ⑤ 판정 함수들 — 그대로 호출. 조건부 호출(역할·unitId)은 두지 않는다. 대상이 아니면 서버가 false 를 준다.
  select * into v_dg from public.needs_downgrade_choice();
  select coalesce(jsonb_agg(to_jsonb(m) - 'ord' order by m.ord), '[]'::jsonb) into v_units
    from public.my_units() with ordinality as m(unit_id, store_name, role, industry, is_active, ord);
  select to_jsonb(b) into v_brand from public.my_brand() b limit 1;

  return jsonb_build_object(
    'deleted',               false,
    'profile',               v_profile,
    'unit_id',               v_unit,
    'unit',                  v_unitrow,
    'subscription',          v_sub,
    'free_mode',             public.billing_free_mode(),
    'iap_enabled',           public.iap_enabled(),
    'needs_downgrade_choice', coalesce(v_dg.need_store, false) or coalesce(v_dg.need_seats, false),
    'my_units',              v_units,
    'my_seat_locked',        public.my_seat_locked(),
    'my_unit_locked',        public.my_unit_locked(),
    'my_brand',              v_brand
  );
end $$;

revoke all on function public.session_bootstrap() from public, anon, authenticated;
grant execute on function public.session_bootstrap() to authenticated;

-- ── 자가점검 ──
do $$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid = 'public.session_bootstrap()'::regprocedure;
  if p.provolatile <> 'v' then raise exception '0354 자가점검 실패: volatile 이어야 한다(session_unit 첫 호출 쓰기)'; end if;
  if p.prosecdef then raise exception '0354 자가점검 실패: invoker 여야 한다(테이블 읽기는 클라와 같은 RLS)'; end if;
  if coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%' then raise exception '0354 자가점검 실패: search_path'; end if;
  if has_function_privilege('anon', 'public.session_bootstrap()', 'execute') then raise exception '0354 자가점검 실패: anon 실행 가능'; end if;
  if not has_function_privilege('authenticated', 'public.session_bootstrap()', 'execute') then raise exception '0354 자가점검 실패: authenticated 실행 불가'; end if;
end $$;
