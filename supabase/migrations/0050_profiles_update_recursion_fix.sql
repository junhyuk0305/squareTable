-- 0050_profiles_update_recursion_fix.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 증상: 앱 설정에서 본인 프로필(이름/소개/아바타/전화) 저장이 항상 실패.
--       클라는 이 오류를 friendlyError로 "정보를 저장하지 못했어요. 잠시 후 다시 시도"로 표시 →
--       일시적 오류처럼 보이지만 42P17은 결정적이라 영원히 성공 못 함.
--
-- 근본원인(구조): 0032의 profiles_update WITH CHECK가 동결값을 읽으려고
--       `(select p.role/unit_id/pending_unit_id from public.profiles p where p.id = auth.uid())`,
--       즉 **public.profiles 위 정책의 WITH CHECK 안에서 다시 public.profiles를 SELECT** →
--       RLS 정책 평가가 자기 자신을 재호출 → Postgres가 42P17(infinite recursion) 던짐.
--       트리거/ RPC는 security definer라 RLS를 우회해 안 걸리고, 직접 UPDATE하는
--       유일 경로(updateProfileFields → settings 저장)만 100% 죽어 있었다.
--       기존 QA(qa:onboarding)는 프로필 자가수정을 검증하지 않아 못 잡음.
--
-- 고침(의미 100% 보존, 재귀만 제거): 동결 대상의 "현재값"을 RLS를 우회하는
--       security definer 헬퍼로 읽는다 — 이미 쓰고 있는 auth_unit_id()/auth_is_owner()와 동일 패턴.
--       role/unit_id/pending_unit_id 직접변경 금지(권한상승·승인게이트 우회 차단)는 그대로 유지된다.
-- ─────────────────────────────────────────────────────────────────────────

-- 헬퍼: 호출자 본인의 현재 role / pending_unit_id (RLS 우회 — 본인 행 스칼라만 반환, 누출 없음)
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_pending_unit_id()
returns text language sql stable security definer set search_path = public as $$
  select pending_unit_id from public.profiles where id = auth.uid()
$$;

grant execute on function public.auth_role()             to authenticated;
grant execute on function public.auth_pending_unit_id()  to authenticated;

-- profiles_update 재확정(최고 번호 = 정본). 0032와 동일 의미: 본인 행만 수정,
-- role/unit_id/pending_unit_id는 불변. 서브쿼리를 profiles가 아니라 security definer 헬퍼로 대체.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.auth_role())
    and unit_id is not distinct from (select public.auth_unit_id())
    and pending_unit_id is not distinct from (select public.auth_pending_unit_id())
  );
