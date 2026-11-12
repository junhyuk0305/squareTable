-- 0680_edu_link_live_creator_can.sql — 링크를 만든 사람이 지금도 링크를 만들 수 있을 때만 손님에게 링크가 열린다
--   (2026-11-12 · 결함 전수 점검 S6 2번 · 인수인계 남은 것 3 · 보안 Low)
--
-- 왜: 0584 는 만든 사람이 그 자리를 떠나면 링크를 닫는다. 매니저 → 직원 강등과 무료 좌석 잠금은 떠나는 게 아니라서
--   그 매니저가 만든 링크는 만료(최대 30일)까지 손님에게 열려 있었다. 링크 만들기 권한(auth_can 'manage_links')은 이미 잃은 사람이다.
-- 무엇을: _edu_link_live(0555 본문)에 한 줄. 만든 사람의 그 자리 멤버 행이 링크 권한 역할이어야 한다.
--   역할 판정은 auth_can(0368)과 같다: 사장 · 공간 주인 = 됨 · 매니저 = 좌석이 안 잠겼을 때만(seat_locked_for 0336) · 나머지 = 안 됨.
--   auth_can 은 auth.uid() 와 지금 자리를 보므로 손님(anon) 판정에 못 쓴다. 그래서 같은 역할 표를 만든 사람 기준으로 적는다.
--   ⚠️역할 표를 바꾸면 auth_can(0368) 과 이 함수를 같이 고친다.
--   닫지 않는다(closed_at 무변경). 다시 매니저가 되거나 좌석이 풀리면 링크가 다시 열린다. 닫기는 떠날 때만(0584 · 결정 78).
--   만든 사람이 비면(계정 삭제 · on delete set null) 멤버 행이 없어 거짓이다. 그런 열린 링크는 0584 가 이미 닫았다(로컬 0행).
-- 옛 앱 호환(⑪): 함수 서명 무변경 · 옛 앱은 닫힌 링크 응답(link_closed · ok=false)을 이미 안다.
-- 되돌리기: scripts/rollback/0680.sql(0555 본문으로).

create or replace function public._edu_link_live(l public.edu_links)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select l.id is not null
     and l.closed_at is null
     and l.expires_at > now()
     and exists (select 1 from public.units u
                  where u.id = l.unit_id
                    and u.deleted_at is null
                    and u.purged_at is null
                    and u.kind in ('space', 'store')
                    -- ★0550: 기능 줄(0368 · 공간 켬 · 매장 끔). 예전에는 묻기·보내기·신고·AI 재료 네 함수에 흩어져 있었다.
                    -- ★0555: 기능 줄 하나 → "만든 사람 허용 목록 또는 (edu_links + edu_guest)"(결정 8 · 가결정 1).
                    --   만든 사람이 비면(계정 삭제 · on delete set null) 허용 목록 갈래는 거짓이다.
                    and public._edu_link_open_for(u.kind, l.created_by))
     -- ★0680: 만든 사람이 지금도 링크 권한 역할이다(auth_can 0368 역할 표 · 잠긴 매니저 = 직원 줄). 강등 · 좌석 잠금이면 안 열린다.
     and exists (select 1 from public.unit_members m
                  where m.unit_id = l.unit_id
                    and m.user_id = l.created_by
                    and (m.role in ('owner', 'space_owner')
                         or (m.role = 'manager' and not public.seat_locked_for(l.unit_id, l.created_by))))
$$;
revoke all on function public._edu_link_live(public.edu_links) from public, anon, authenticated;

-- ── 자가점검 ──
do $$
begin
  if has_function_privilege('anon', 'public._edu_link_live(public.edu_links)', 'execute')
     or has_function_privilege('authenticated', 'public._edu_link_live(public.edu_links)', 'execute') then
    raise exception '0680 자가점검 실패 — _edu_link_live 가 클라에 열렸다';
  end if;
  if position('seat_locked_for' in (select prosrc from pg_proc where oid = 'public._edu_link_live(public.edu_links)'::regprocedure)) = 0 then
    raise exception '0680 자가점검 실패 — 좌석 잠금 줄이 없다';
  end if;
  raise notice '0680 자가점검 통과';
end $$;
