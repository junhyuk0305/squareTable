-- 0811_notif_row_read.sql — 알림 한 줄 읽음(2026-11-16 사용자 결정 · R-13 후속 · "눌러서 들어가면 그 알림은 읽음")
--
-- 지금(0810 까지): 줄 하나를 눌러도 읽음이 되는 것은 멘션(read_by)뿐이다. 나머지(내 질문에 온 답 · 제안 결과 · 근무 변경 · 역할 변경 ·
--   합류 결과 · 입금 결과 · 사장 알림 · 퀴즈 완료 · 공간 알림 등)는 전체 읽음으로만 꺼졌다.
-- 이 표 = 내가 눌러 본 줄의 열쇠. 열쇠 = 앱 줄 번호 + '|' + 줄 시각(notifications.ts notifRowKey).
--   시각을 넣는 이유: 매일 반복되는 배정 할일은 줄 번호가 같다. 다음 날 다시 오면 새 알림이다. 교대처럼 상태가 바뀌면 시각도 바뀌어 다시 켜진다.
-- 판정(앱): 안 읽음 = (자리 읽은 시각 뒤) 그리고 (이 표에 열쇠 없음). 목록·벨·허브·앱 배지가 같은 줄 배열에서 센다.
--
-- 옛 앱 호환: 안전 | 근거 = 새 표·새 함수만 더한다 · 옛 앱은 이 표를 모른다(옛 앱에서는 지금처럼 전체 읽음으로만 꺼진다).
-- 보관: 90일 지난 열쇠는 쓸 때 지운다(그 줄은 이미 전체 읽음이나 기한으로 사라졌을 때다).

begin;

create table if not exists public.notif_row_read (
  user_id uuid not null references auth.users(id) on delete cascade,
  row_key text not null check (char_length(row_key) between 1 and 300),
  read_at timestamptz not null default now(),
  primary key (user_id, row_key)
);
create index if not exists notif_row_read_user_at on public.notif_row_read (user_id, read_at desc);

alter table public.notif_row_read enable row level security;
revoke all on table public.notif_row_read from public, anon, authenticated;
grant select on table public.notif_row_read to authenticated;   -- 쓰기는 mark_notif_rows_read 로만

drop policy if exists notif_row_read_self_read on public.notif_row_read;
create policy notif_row_read_self_read on public.notif_row_read for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists account_access_allowed on public.notif_row_read;
create policy account_access_allowed on public.notif_row_read as restrictive for all to authenticated
  using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()));

-- 줄 읽음 쓰기. 쓰는 것은 내 열쇠뿐이다(user_id = 나) — 열쇠가 어느 줄인지 서버는 따지지 않는다(내 화면 상태일 뿐 · 남에게 영향 없음).
create or replace function public.mark_notif_rows_read(p_keys text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then return; end if;
  if cardinality(p_keys) > 100 then raise exception 'invalid_argument'; end if;
  if exists (select 1 from unnest(p_keys) k where k is null or char_length(k) not between 1 and 300) then
    raise exception 'invalid_argument';
  end if;
  insert into public.notif_row_read (user_id, row_key, read_at)
  select v_uid, k, now() from (select distinct unnest(p_keys) as k) x
  on conflict (user_id, row_key) do nothing;
  -- race: 내 행만 지우는 보관 정리다(겹쳐 지워도 결과가 같다).
  delete from public.notif_row_read where user_id = v_uid and read_at < now() - interval '90 days';
end $$;

revoke all on function public.mark_notif_rows_read(text[]) from public, anon;
grant execute on function public.mark_notif_rows_read(text[]) to authenticated;

-- 실시간 — 한 기기에서 눌러 본 줄이 같은 계정의 다른 기기에서도 꺼진다(0810 과 같은 결정).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notif_row_read') then
    alter publication supabase_realtime add table public.notif_row_read;
  end if;
end $$;

commit;
