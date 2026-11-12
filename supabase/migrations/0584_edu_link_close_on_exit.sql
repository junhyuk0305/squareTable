-- 0584_edu_link_close_on_exit.sql — 링크를 만든 사람이 그 자리를 떠나면 그 사람의 열린 교육 링크를 닫는다
--   (2026-11-12 · 결함 수정 3번 · CSO 6번)
--
-- 왜: _edu_link_live(0555)는 만든 사람이 허용 목록에 있는지만 본다. 만든 사람이 매장에서 나가도 링크는 만료·닫기 전까지(최대 30일)
--   열려 손님이 그 매장 노하우를 읽고 묻는다. 알림은 _edu_link_escalate 가 사장에게 돌리지만 링크 자체는 살아 있었다.
-- 무엇을: unit_members 의 AFTER DELETE 트리거 하나(wt_drop_departed_assignee 0269 와 같은 모양).
--   멤버 행을 지우는 길이 여럿이다: close_member_tenure(0366 · remove_staff · leave_store · delete_my_account 가 부른다) ·
--   좌석 줄이기(0235) · 매장 삭제(0358) · 공간 삭제(0553) · 공간 내보내기·나가기(0460). 함수마다 고치면 빠지는 길이 생겨 한 곳에 둔다.
--   닫는 조건 = 그 자리(unit_id) · 그 사람이 만든 것(created_by) · 아직 열린 것. closed_at = now() 만 적는다.
--     tg_edu_links_stamp(0555)는 UPDATE 에서 closed_at 을 막지 않는다(이미 닫힌 것만 그대로 둔다) → 닫기만 하는 UPDATE 는 지난다.
--   매니저 → 직원 강등(역할 UPDATE)은 닫지 않는다. 아직 매장 사람이라 노하우를 읽을 수 있다. 알림은 _edu_link_escalate 가 사장에게 돌린다.
--   ⚠️매장 링크 만들기는 사장·매니저다. 직원이 만든 링크는 없어 강등 뒤에도 그 사람 링크는 그대로 열린다(정해 둔 방향).
-- 이미 나간 사람이 만든 열린 링크도 이 파일에서 한 번 닫는다(라이브 매장 링크 0개 · 공간 링크는 주인이 나갈 수 없어 사실상 0).
-- 옛 앱 호환(⑪): 새 트리거 하나 · 표·함수 서명 무변경. 옛 앱은 링크 닫힘을 이미 안다(닫기 = 0400 부터 있음).
-- 되돌리기: scripts/rollback/0584.sql(트리거·함수 drop · 닫은 링크는 다시 열지 않는다 = 결정 78).

create or replace function public.edu_links_close_departed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.edu_links
     set closed_at = now()
   where unit_id = old.unit_id
     and created_by = old.user_id
     and closed_at is null;
  return old;
end $$;
comment on function public.edu_links_close_departed() is
  '0584 unit_members AFTER DELETE: 나간 사람이 그 자리에서 만든 열린 교육 링크를 닫는다. 트리거 전용.';
revoke all on function public.edu_links_close_departed() from public, anon, authenticated;

drop trigger if exists edu_links_close_departed on public.unit_members;
create trigger edu_links_close_departed
  after delete on public.unit_members
  for each row execute function public.edu_links_close_departed();

-- ── 이미 나간 사람이 만든 열린 링크 정리 ──
update public.edu_links l
   set closed_at = now()
 where l.closed_at is null
   and l.created_by is not null
   and not exists (select 1 from public.unit_members m where m.unit_id = l.unit_id and m.user_id = l.created_by);

-- ── 자가점검 ──
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'edu_links_close_departed' and tgrelid = 'public.unit_members'::regclass and not tgisinternal) then
    raise exception '0584 자가점검 실패 — 트리거가 없다';
  end if;
  if has_function_privilege('authenticated', 'public.edu_links_close_departed()', 'execute')
     or has_function_privilege('anon', 'public.edu_links_close_departed()', 'execute') then
    raise exception '0584 자가점검 실패 — 트리거 함수가 클라에 열렸다';
  end if;
  if exists (select 1 from public.edu_links l
              where l.closed_at is null and l.created_by is not null
                and not exists (select 1 from public.unit_members m where m.unit_id = l.unit_id and m.user_id = l.created_by)) then
    raise exception '0584 자가점검 실패 — 만든 사람이 없는 열린 링크가 남았다';
  end if;
  raise notice '0584 자가점검 통과';
end $$;
