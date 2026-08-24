-- 0167_essential_sections.sql — "이 매장에서 꼭 알아야 하는 것" = 필수 카테고리 스코프
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 사장이 첫 퀴즈를 만들 때 노하우 수십 건에서 무엇부터 낼지 못 고른다.
-- 그렇다고 우리가 "필수 노하우 9종" 같은 고정 리스트를 정해 주면 안 된다 — 매장마다 필수가 다르고,
-- 그 방향은 이미 기각됐다("우리가 정하면 안 된다, 시스템이 필요하다").
--
-- 그래서 축을 둘로 나눈다.
--   · **스코프는 사장이** — 이 컬럼. 이미 있는 카테고리(playbook_entries.section)를 복수로 고른다.
--   · **압축은 코드가** — 고른 카테고리 안에서 4기준 rubric 이 상위를 뽑는다
--     (SSOT = `src/lib/quiz/essential.ts`. 점수 계산을 화면이나 DB 에 복제하지 않는다).
--
-- ② 왜 새 표가 아니라 units 컬럼인가
-- ══════════════════════════════════════════════════════════════════════════
-- · 매장당 정확히 한 벌인 **설정값**이다. 행이 여러 개 생길 일이 없다.
-- · 값의 후보 목록을 담을 필요가 없다 — 후보는 이미 `lib/config/sections.ts` 표준 세트 +
--   매장이 실제로 쓰고 있는 section 값이다. 0164(store_parts)가 표를 만든 이유("표준 세트를 줄 수 없어
--   매장이 쓴 값이 곧 후보 목록이라 담을 자리가 필요하다")가 여기엔 해당하지 않는다.
-- · units 에는 같은 성격의 매장 설정이 이미 산다(0054 payroll_settings). 그 자리를 재사용한다.
--
-- ③ null / 빈 배열 의 뜻
-- ══════════════════════════════════════════════════════════════════════════
-- **둘 다 "아직 안 골랐다" = 매장 전체가 스코프**다(0164 가 "파트 없는 매장은 전부 공통"으로 정한 것과
-- 같은 폴백). 설정을 안 한 매장에서 기능이 아무 일도 안 하면 죽은 기능이 된다.
-- 두 값을 구별하지 않으므로 클라이언트가 어느 쪽을 보내든 결과가 같다.

alter table public.units add column if not exists essential_sections text[];

-- ════════════════════════════════════════════════════════════════════════
-- 2) 쓰기 — RPC 하나. units 직접 update 를 열지 않는다
-- ════════════════════════════════════════════════════════════════════════
-- units_write(0019)는 **소유자 전용**이라 매니저가 못 쓴다. 0093 이 payroll_settings 에서 쓴 것과
-- 같은 해법을 그대로 따른다: auth_can_manage() 게이트 + **이 컬럼 하나만** 건드리는 security definer 함수.
-- (읽기는 units_read 가 이미 "같은 매장 구성원"으로 좁혀 준다 — 따로 만들 것이 없다.)
--
-- 값 정리를 여기서 한다: 앞뒤 공백 제거 · 빈 값 제거 · 중복 제거 · 지나치게 긴 값 제거.
-- 카테고리 이름은 칩 한 줄에 들어가는 짧은 말이다(store_parts 가 같은 이유로 길이를 스키마에 못박았다).
create or replace function public.save_essential_sections(p_sections text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_clean text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if not public.auth_can_manage() then raise exception 'manager_only'; end if;

  select coalesce(array_agg(distinct btrim(raw) order by btrim(raw)), '{}'::text[])
    into v_clean
    from unnest(coalesce(p_sections, '{}'::text[])) as raw
   where btrim(raw) <> '' and length(btrim(raw)) <= 40;

  update public.units set essential_sections = v_clean where id = v_unit;
end $$;

-- ★`from public` 만으로는 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다(0159·0160).
--   security definer 함수는 생성 시 PUBLIC 에 EXECUTE 가 붙으므로 먼저 전부 걷어내고 다시 연다.
--   (anon 이 불러도 auth.uid() is null 로 막히지만, "막힌다"에 기대지 않고 문 자체를 닫는다.)
revoke all on function public.save_essential_sections(text[]) from public, anon, authenticated;
grant execute on function public.save_essential_sections(text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159·0160·0164 와 같은 이유)
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  -- 컬럼이 실제로 붙었나. 안 붙으면 저장은 성공한 척하고 설정이 매번 초기화된다.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'units' and column_name = 'essential_sections'
  ) then
    raise exception 'units.essential_sections 컬럼이 없다';
  end if;

  -- anon 에게 열려 있으면 안 된다.
  if has_function_privilege('anon', 'public.save_essential_sections(text[])', 'EXECUTE') then
    raise exception 'save_essential_sections 가 anon 에게 열려 있다';
  end if;

  -- 반대로 authenticated 가 못 부르면 사장이 설정을 아예 저장할 수 없다(무음 실패).
  if not has_function_privilege('authenticated', 'public.save_essential_sections(text[])', 'EXECUTE') then
    raise exception 'save_essential_sections 가 authenticated 에게 안 열려 있다';
  end if;

  -- 읽기는 units RLS 에 얹혀 간다 — 꺼져 있으면 매장 설정이 전 매장에 공개된다.
  if not (select relrowsecurity from pg_class where oid = 'public.units'::regclass) then
    raise exception 'units 에 RLS 가 꺼져 있다';
  end if;
end $$;
