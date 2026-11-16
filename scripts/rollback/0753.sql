-- rollback/0753.sql — 0753 을 되돌린다(suggestion_withdraw = 0582 본문 · delete_space = 0553 본문 · _suggestion_move_withdrawn drop).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0753.sql --linked
-- 웹·앱이 부르는 함수 둘은 이름·인자·반환형이 같다. 순서 제약 없음. 이미 보관 표로 옮긴 제안은 되돌리지 않는다.
begin;
create or replace function public.suggestion_withdraw(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
begin
  select * into r from public.playbook_suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_uid is null or r.proposer_id <> v_uid
     or not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = r.unit_id) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  insert into public.playbook_suggestions_withdrawn (
    id, unit_id, kind, target_entry_id, target_title, proposer_id, proposer_name, text, photos, status,
    owner_note, resulting_entry_id, created_at, reviewed_at, reviewed_by, source_template_id, source_uq_id,
    source_unit_id, source_entry_id, source_snapshot,   -- ★0582 출처 칸 셋(0490)
    withdrawn_at, withdrawn_by)
  values (
    r.id, r.unit_id, r.kind, r.target_entry_id, r.target_title, r.proposer_id, r.proposer_name, r.text, r.photos, r.status,
    r.owner_note, r.resulting_entry_id, r.created_at, r.reviewed_at, r.reviewed_by, r.source_template_id, r.source_uq_id,
    r.source_unit_id, r.source_entry_id, r.source_snapshot,   -- ★0582
    now(), v_uid);
  delete from public.playbook_suggestions where id = p_id;
end $$;
revoke execute on function public.suggestion_withdraw(text) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;
create or replace function public.delete_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 행 잠금: 같은 공간을 동시에 지우면 뒤 호출은 앞 호출을 기다렸다가 지운 공간을 보고 not_space_owner 로 끝난다.
  perform 1 from public.units u
   where u.id = p_space and u.kind = 'space' and u.deleted_at is null
     and exists (select 1 from public.unit_members m
                  where m.unit_id = u.id and m.user_id = v_uid and m.role = 'space_owner')
     for update;
  if not found then raise exception 'not_space_owner'; end if;

  perform public.space_close(p_space);
  -- ★0553: 멤버를 지우기 전에 주인이 아닌 멤버 각자에게 알린다(가결정 13 · 새 종류 space_deleted).
  --   알림 적재가 실패해도 삭제를 되돌리지 않는다(0460 과 같은 태도).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select m.user_id, p_space, 'space_deleted', u.store_name,
           '공간이 지워졌어요', '이제 이 공간의 노하우를 볼 수 없어요.', '/stores'
      from public.unit_members m join public.units u on u.id = m.unit_id
     where m.unit_id = p_space and m.role <> 'space_owner';
  exception when others then
    raise warning 'space deleted notice skipped for %: %', p_space, sqlerrm;
  end;
  -- 멤버 전원(주인 포함) 내보내기. 현재 공간 기록(session_active_spaces)은 멤버십 FK cascade 로 같이 간다.
  delete from public.unit_members where unit_id = p_space;
  -- 이 공간으로 합류를 기다리던 사람(있다면)도 끊는다. 매장 삭제(0358)와 같은 정리.
  update public.profiles set pending_unit_id = null where pending_unit_id = p_space;
end $$;
revoke all on function public.delete_space(text) from public, anon;
grant execute on function public.delete_space(text) to authenticated;
drop function if exists public._suggestion_move_withdrawn(text, uuid);
commit;
