-- 0103_quiz_stats.sql — 퀴즈 오답의 문항(노하우) 귀속 집계 (차별점 ①: 오답 → 노하우 결함 검출)
--
-- 원칙(2026-07-29 확정, B안): 오답은 개인이 아니라 문항이 근거한 노하우에 귀속한다.
--  · 개인 오답 저장 금지 — 0072 "실패는 저장하지 않는다"(심리적 안전)와 양립하는 유일 경로.
--    staff_id 컬럼 자체가 없다(누가 틀렸는지는 어디에도 남지 않는다).
--  · 읽기는 관리자(사장·매니저)만 — "이 노하우 문항 오답률 40%"는 노하우 결함 신호이지 직원 평가가 아니다.
--  · 쓰기는 RPC 한 곳(record_quiz_stats, definer) — 테이블 write 정책 ZERO(0036 unit_subscriptions 패턴).
--    채점은 클라가 하므로 서버는 활성 매장 소속 엔트리에 한해 합산만 한다.

create table if not exists public.knowhow_quiz_stats (
  entry_id text primary key references public.playbook_entries(id) on delete cascade,
  unit_id text not null,
  attempt_count integer not null default 0,
  miss_count integer not null default 0,
  last_missed_at timestamptz
);

create index if not exists idx_quiz_stats_unit on public.knowhow_quiz_stats (unit_id);

alter table public.knowhow_quiz_stats enable row level security;

drop policy if exists qs_select on public.knowhow_quiz_stats;
create policy qs_select on public.knowhow_quiz_stats
  for select using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- 채점 결과 합산 — p_stats = [{entry_id, attempts, misses}].
-- 호출자의 활성 매장 소속 엔트리만 반영(남의 매장 entry_id를 넣어도 0행). 퀴즈는 최대 3문항이라
-- 항목 수·수치에 상한을 둬 조작성 폭주를 막는다(문항당 attempts 1이 정상 경로).
create or replace function public.record_quiz_stats(p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if p_stats is null or jsonb_typeof(p_stats) <> 'array' then
    return;
  end if;
  for r in
    select e ->> 'entry_id' as entry_id,
           least(greatest(coalesce((e ->> 'attempts')::int, 0), 0), 10) as attempts,
           least(greatest(coalesce((e ->> 'misses')::int, 0), 0), 10) as misses
      from jsonb_array_elements(p_stats) e
     limit 10
  loop
    if r.entry_id is null or r.attempts <= 0 or r.misses > r.attempts then
      continue;
    end if;
    insert into public.knowhow_quiz_stats as k (entry_id, unit_id, attempt_count, miss_count, last_missed_at)
    select p.id, p.unit_id, r.attempts, r.misses, case when r.misses > 0 then now() end
      from public.playbook_entries p
     where p.id = r.entry_id
       and p.unit_id = (select public.auth_unit_id())
    on conflict (entry_id) do update set
      attempt_count = k.attempt_count + excluded.attempt_count,
      miss_count = k.miss_count + excluded.miss_count,
      last_missed_at = coalesce(excluded.last_missed_at, k.last_missed_at);
  end loop;
end;
$$;

grant execute on function public.record_quiz_stats(jsonb) to authenticated;
