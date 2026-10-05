-- 0272_task_assigned_meta.sql — 담당자별 배정 시각·배정한 사람 (2026-10-06 · 논리 점검 D11 ①)
--
-- 3일 전에 만든 할일에 오늘 B 를 담당자로 넣으면 B 폰에는 배정 푸시가 온다. 그런데 알림함은
-- 배정 행의 시각을 할일을 만든 시각(created_at)으로 잡았다. B 가 어제 "모두 읽기"를 눌렀으면
-- 이 배정은 읽은 것으로 묻혔고, 제목의 이름도 처음 만든 사람이었다.
--
-- assigned_meta = { "<담당자 uid>": { "at": 배정 시각, "by": 배정한 사람 } }
--   · 새로 들어온 담당자만 지금 시각·지금 사용자로 적는다. 그대로인 담당자는 예전 값을 둔다.
--   · 빠진 담당자는 지운다. 클라가 보낸 값은 쓰지 않는다(서버가 정본).
--   · 트리거 이름은 wt_sync_owner_ids(0254) 뒤에 돈다(같은 시점 트리거는 이름 순).
--     옛 앱이 owner_id 만 바꿔도 그 트리거가 owner_ids 를 맞춘 뒤 여기서 배정 시각이 찍힌다.
-- 옛 앱은 이 열을 모른다(그대로 created_at 기준으로 보인다).

-- ── ① 열 ──────────────────────────────────────────────────────────────────
alter table public.work_templates
  add column if not exists assigned_meta jsonb not null default '{}'::jsonb;

-- ── ② 지금 담당자는 만든 시각·만든 사람으로 채운다(트리거보다 먼저 · 트리거가 있으면 지금 시각이 된다) ──
update public.work_templates w
   set assigned_meta = (
         select coalesce(jsonb_object_agg(x::text, jsonb_build_object('at', w.created_at, 'by', w.created_by)), '{}'::jsonb)
           from unnest(w.owner_ids) x
       )
 where cardinality(w.owner_ids) > 0
   and w.assigned_meta = '{}'::jsonb;

-- ── ③ 트리거 ──────────────────────────────────────────────────────────────
create or replace function public.wt_track_assigned()
returns trigger language plpgsql set search_path = public as $$
declare
  v_old  jsonb := case when tg_op = 'UPDATE' then coalesce(old.assigned_meta, '{}'::jsonb) else '{}'::jsonb end;
  v_meta jsonb := '{}'::jsonb;
  x uuid;
begin
  foreach x in array coalesce(new.owner_ids, '{}'::uuid[]) loop
    if v_old ? x::text then
      v_meta := v_meta || jsonb_build_object(x::text, v_old -> x::text);
    else
      v_meta := v_meta || jsonb_build_object(x::text,
        jsonb_build_object('at', now(), 'by', coalesce(auth.uid(), new.created_by)));
    end if;
  end loop;
  new.assigned_meta := v_meta;
  return new;
end $$;
revoke all on function public.wt_track_assigned() from public, anon, authenticated;

drop trigger if exists wt_track_assigned on public.work_templates;
create trigger wt_track_assigned
  before insert or update on public.work_templates
  for each row execute function public.wt_track_assigned();

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.work_templates w
   where cardinality(w.owner_ids) > 0
     and exists (select 1 from unnest(w.owner_ids) x where not (w.assigned_meta ? x::text));
  if v_bad > 0 then
    raise exception '0272 자가점검 실패 — 배정 기록이 빠진 할일 %개', v_bad;
  end if;
  raise notice '0272 자가점검 통과';
end $$;
