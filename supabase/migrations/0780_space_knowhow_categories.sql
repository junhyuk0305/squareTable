-- 0780_space_knowhow_categories.sql — 공간 주인이 자기 공간의 노하우 카테고리 목록을 읽고 쓴다 (2026-11-16 · 실측 결함 R-3)
-- 옛 앱 호환: 안전 | 새 함수 둘만 더한다. schedule_config 표·정책(sc_read · sc_write)·기존 함수는 다시 정의하지 않는다.
--   옛 앱 1.1.1 은 공간을 모르고 이 함수를 부르지 않는다. 매장 화면은 지금처럼 표를 직접 읽고 쓴다(db.ts fetch/saveKnowhowCategories).
--
-- 결함: 매장 노하우 목록의 사용자 카테고리는 schedule_config.knowhow_categories(0096)에 산다.
--   sc_read = unit_id = auth_unit_id() · sc_write = unit_id = auth_unit_id() and auth_can_manage()(최신 = 0151 · 0016→0019→0093→0151).
--   auth_unit_id() 는 현재 매장만 돌려준다(공간은 절대 안 담긴다 · 0371 머리말). 그래서 공간 주인은 공간 카테고리 목록을 못 읽고 못 쓴다.
--
-- 정책을 넓히지 않고 함수로 한 이유:
--   ① 매장 읽기 셋(fetchKnowhowCategories · fetchRegularDueDays · fetchScheduleConfig)은 unit_id 를 걸지 않고 RLS 한 행에 기대
--      maybeSingle 로 읽는다. sc_read 에 공간 갈래를 붙이면 매장과 공간에 같이 들어가 있는 세션(auth_unit_id · auth_space_id 둘 다 값)에서
--      두 행이 와 매장 화면 읽기가 깨진다.
--   ② sc_write 는 표 전체(open·close·dayparts…)를 연다. 공간 주인에게 필요한 건 카테고리 칸 하나다.
--      dayparts 를 쓸 수 있으면 루틴 알림 크론(0301 · 0352)이 공간 행을 읽는다. 함수는 knowhow_categories 만 쓴다.
--
-- 공간 조건(0368 auth_can · 4장 권한표): 'write_knowhow' = 공간 주인만. 공간 멤버(read·ask)는 거절한다.
--   auth_can(공간, …) 은 그 공간이 지금 들어간 공간(auth_space_id)일 때만 참이다 → 다른 공간 주인 · 다른 매장 사장은 거절된다.
--   매장 번호를 넘기면 invalid_argument(매장은 표 경로를 쓴다 · 매니저 권한이 이 길로 새지 않게).
-- 오류 코드: invalid_argument · not_space_owner(둘 다 src/lib/place/errors.ts 에 문구가 있다).
-- 되돌리기: scripts/rollback/0780.sql (함수 둘 drop · 이미 쓴 공간 행은 남는다 · 공간을 지우면 FK cascade 로 같이 지워진다).

-- ════════════════════════════════════════════════════════════════════════════
-- ① 읽기 — 공간 카테고리 목록(jsonb 배열 · 없으면 [])
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_knowhow_categories(p_unit text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_unit is null or not exists (select 1 from public.units u where u.id = p_unit and u.kind = 'space') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.auth_can(p_unit, 'write_knowhow') then
    raise exception 'not_space_owner' using errcode = '42501';
  end if;
  select sc.knowhow_categories into v from public.schedule_config sc where sc.unit_id = p_unit;
  return coalesce(v, '[]'::jsonb);
end $$;
revoke all on function public.space_knowhow_categories(text) from public, anon;
grant execute on function public.space_knowhow_categories(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 쓰기 — 목록 통째 바꾸기(매장 화면 저장과 같은 모양 · 정리는 앱 sanitizeCustomCategories 가 한다)
--   배열만 받는다. 100개 · 16KB 를 넘으면 invalid_argument(앱 카테고리 편집이 닿을 수 없는 크기 · 마지막 방어선).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_save_knowhow_categories(p_unit text, p_cats jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_unit is null or not exists (select 1 from public.units u where u.id = p_unit and u.kind = 'space') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.auth_can(p_unit, 'write_knowhow') then
    raise exception 'not_space_owner' using errcode = '42501';
  end if;
  if p_cats is null or jsonb_typeof(p_cats) <> 'array'
     or jsonb_array_length(p_cats) > 100 or octet_length(p_cats::text) > 16384 then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  -- race: 목록을 통째로 덮어쓰는 한 문장이다(읽고 판정하지 않는다 · 매장 화면 upsert 와 같다). 두 기기가 겹치면 나중 것이 남는다.
  insert into public.schedule_config (unit_id, knowhow_categories, updated_at)
  values (p_unit, p_cats, now())
  on conflict (unit_id) do update set knowhow_categories = excluded.knowhow_categories, updated_at = now();
end $$;
revoke all on function public.space_save_knowhow_categories(text, jsonb) from public, anon;
grant execute on function public.space_save_knowhow_categories(text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검 (구조만)
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'space_knowhow_categories' and p.prosecdef) then
    raise exception '0780: space_knowhow_categories 가 정의자 함수가 아니다';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'space_save_knowhow_categories' and p.prosecdef) then
    raise exception '0780: space_save_knowhow_categories 가 정의자 함수가 아니다';
  end if;
  if has_function_privilege('anon', 'public.space_save_knowhow_categories(text, jsonb)', 'execute') then
    raise exception '0780: anon 이 공간 카테고리를 쓸 수 있다';
  end if;
end $$;
