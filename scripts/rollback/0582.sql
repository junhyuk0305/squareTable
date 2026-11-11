-- rollback/0582.sql — 0582 를 되돌린다. 트리거·함수를 지우고 suggestion_withdraw 를 0355 본문으로 돌린다.
--   보관 표 출처 칸 셋은 지우지 않는다(null 허용 · 옛 본문은 안 쓴다 · 지우면 이미 옮긴 출처가 사라진다). publication 은 그대로.
--   이미 반려로 바뀐 제안은 되돌리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0582.sql --linked
begin;
drop trigger if exists trg_uq_close_pending_suggestions on public.unknown_queries;
drop function if exists public.tg_uq_close_pending_suggestions();
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
    withdrawn_at, withdrawn_by)
  values (
    r.id, r.unit_id, r.kind, r.target_entry_id, r.target_title, r.proposer_id, r.proposer_name, r.text, r.photos, r.status,
    r.owner_note, r.resulting_entry_id, r.created_at, r.reviewed_at, r.reviewed_by, r.source_template_id, r.source_uq_id,
    now(), v_uid);
  delete from public.playbook_suggestions where id = p_id;
end $$;
revoke execute on function public.suggestion_withdraw(text) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;
commit;
