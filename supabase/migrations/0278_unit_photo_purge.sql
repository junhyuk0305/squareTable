-- 0278_unit_photo_purge.sql — F3(QA 2026-10-05): 매장·계정을 파기할 때 그 매장 사진 파일도 지운다.
--
-- 왜: 처리방침(legal-content.mjs 제3조·제7조)은 사진도 매장 데이터와 함께 파기한다고 적었다.
--   그런데 units 행을 지우면 cascade 로 노하우·채팅·피드 행만 지워지고, 스토리지 파일
--   (playbook-photos/<unit_id>/…)은 지우는 코드가 어디에도 없어 영구히 남았다.
-- 어떻게:
--   · units 가 지워지는 모든 길(탈퇴 30일 파기 purge_deleted_accounts · 매장 삭제 delete_store ·
--     프로필 하드삭제 트리거 0053)이 결국 units 행 삭제라서, units 에 AFTER DELETE 트리거 하나를 둔다.
--     트리거는 그 매장 폴더 파일 경로를 대기열(photo_purge_queue)에 넣기만 한다.
--   · 실제 삭제는 엣지 push 의 5분 크론 틱(mode='task_reminders')이 Storage API 로 한다.
--     ★SQL 로 storage.objects 행만 지우면 호스팅 Supabase 에서는 실제 파일이 저장소에 남는다(행만 사라짐).
--   · 살아 있는 노하우·제안이 아직 가리키는 경로는 돌려주지 않는다. 본사 사본은 작업실 폴더 사진을
--     그대로 가리키므로(0218), 작업실이 지워져도 매장 사본의 사진은 남는다. 그 사본이 지워지면 그때 지운다.
--   · 이미 지워진 매장의 남은 사진도 한 번 대기열에 넣는다(폴더가 있는 경로만 — 폴더 없는 옛 경로는 건드리지 않는다).
-- 범위 밖: 6개월 파기한 업무 피드(work_feed)의 사진. 같은 경로를 할일 완료 표시(DoneMark.photoUrl)도 쓰므로
--   근무 기록 보관 기준이 정해진 뒤에 따로 한다.

create table if not exists public.photo_purge_queue (
  path      text primary key,                 -- playbook-photos 버킷 안 오브젝트 경로
  queued_at timestamptz not null default now()
);
alter table public.photo_purge_queue enable row level security;
revoke all on table public.photo_purge_queue from public, anon, authenticated;
comment on table public.photo_purge_queue is
  '지울 사진 파일 대기열(0278). 엣지 push 크론이 Storage API 로 지우고 뺀다. 앱은 못 읽고 못 쓴다.';

-- units 행이 지워지면 그 매장 폴더 파일을 대기열에 넣는다.
create or replace function public.queue_unit_photos_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.photo_purge_queue(path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'playbook-photos'
     and split_part(o.name, '/', 1) = old.id
  on conflict (path) do nothing;
  return old;
end $$;
revoke execute on function public.queue_unit_photos_on_delete() from public, anon, authenticated;

drop trigger if exists on_unit_deleted_queue_photos on public.units;
create trigger on_unit_deleted_queue_photos
  after delete on public.units
  for each row execute function public.queue_unit_photos_on_delete();

-- 엣지가 지울 경로를 읽는다. 살아 있는 노하우·제안이 아직 가리키는 경로는 빼고 돌려준다.
create or replace function public.photo_purge_due(p_limit integer default 500)
returns setof text language sql stable security definer set search_path = public as $$
  select q.path
    from public.photo_purge_queue q
   where not exists (
           select 1 from public.playbook_entries e, unnest(e.photos) p
            where p = q.path or p like '%/' || q.path)
     and not exists (
           select 1 from public.playbook_suggestions s, unnest(s.photos) p
            where p = q.path or p like '%/' || q.path)
   order by q.queued_at, q.path
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;
revoke execute on function public.photo_purge_due(integer) from public, anon, authenticated;
grant  execute on function public.photo_purge_due(integer) to service_role;

-- 엣지가 Storage API 로 지운 경로를 대기열에서 뺀다.
create or replace function public.photo_purge_done(p_paths text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.photo_purge_queue where path = any(coalesce(p_paths, '{}'::text[]));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.photo_purge_done(text[]) from public, anon, authenticated;
grant  execute on function public.photo_purge_done(text[]) to service_role;

-- 이미 지워진 매장의 남은 사진 한 번 정리는 0298 로 뺐다(되돌릴 수 없는 삭제라 라이브 대상 확인 뒤에만 올린다).
