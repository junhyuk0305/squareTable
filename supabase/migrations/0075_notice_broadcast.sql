-- 0075_notice_broadcast.sql — 전 매장 동시 공지 발송 + 매장 단위 읽음 집계(S3 #3)
--
-- ── 왜 definer RPC 인가 ───────────────────────────────────────────────────────
-- 공지는 work_feed(kind='notice') 단일 unit_id 행이고, RLS 는 활성 1매장만 노출/쓰기 허용한다
-- (wf_insert: notice 는 사장만 + 활성매장). 그래서 "다른 내 매장에도 같은 공지"를 클라가 직접 못 넣는다.
-- → definer 로 소유 검증 후 각 매장에 notice 행을 서버가 직접 insert. ★유일 방어선 = units.owner_id=auth.uid().
--   ★notice 본문(jsonb)은 클라가 아니라 서버가 구성한다(신뢰경계) — authorId=auth.uid() 강제, id 서버 생성,
--    read_by 없음(빈 시작). 클라 임의 jsonb 를 타 매장에 심지 못하게.
--
-- 같은 발송 묶음은 broadcast_id(uuid)로 잇는다(data jsonb 내부 — 물리 컬럼 추가 없음).
-- 읽음 "2/3" = 그 broadcast_id 를 가진 매장 중 read_by 가 비어있지 않은(직원 1명 이상 읽은) 매장 수 / 전체.
--
-- RLS/USING 술어 변경 없음(신규 함수만) — /cso + /qa 게이트 후 적용. 적용 후 pg_get_functiondef 확인.

-- ── 1) 다중 발송: 소유 매장들에 같은 공지를 한 번에 ──────────────────────────
create or replace function public.broadcast_notice(p_units text[], p_text text, p_important boolean default false)
returns table(broadcast_id text, sent int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_bid   text := replace(gen_random_uuid()::text, '-', '');
  v_date  text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  v_now   text := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_txt   text := left(btrim(coalesce(p_text, '')), 2000);
  v_uid_txt text := v_uid::text;
  v_units text[];
  v_total int;
  u       text;
  v_fid   text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_txt = '' then raise exception 'empty_text'; end if;
  -- 중복 대상 제거(같은 매장 두 번 넣어도 공지 하나) + null 제거.
  select array_agg(distinct e) into v_units from unnest(coalesce(p_units, '{}'::text[])) e where e is not null;
  v_total := coalesce(array_length(v_units, 1), 0);
  if v_total = 0 then raise exception 'no_targets'; end if;
  if v_total > 50 then raise exception 'too_many'; end if;        -- 남용 하드상한

  -- ★모든 대상 매장이 caller 소유여야 함(하나라도 아니면 전체 거부 — 부분 주입 방지).
  if exists (
    select 1 from unnest(v_units) as t(uid)
    where not exists (select 1 from public.units x where x.id = t.uid and x.owner_id = v_uid)
  ) then
    raise exception 'not_owner';
  end if;

  select name into v_name from public.profiles where id = v_uid;

  foreach u in array v_units
  loop
    v_fid := 'f_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.work_feed (id, unit_id, feed_date, room_id, data)
    values (
      v_fid, u, v_date, null,
      jsonb_build_object(
        'id', v_fid,
        'date', v_date,
        'kind', 'notice',
        'text', v_txt,
        'authorId', v_uid_txt,
        'authorName', coalesce(v_name, '사장'),
        'authorRole', 'owner',
        'createdAt', v_now,
        'reactions', '{}'::jsonb,
        'important', coalesce(p_important, false),
        'pinned', false,
        'broadcast_id', v_bid,
        'broadcast_total', v_total
      )
    );
  end loop;

  return query select v_bid, v_total;
end $$;

-- ── 2) 매장 단위 읽음 집계: "읽은 매장 수 / 전체 매장 수" ────────────────────
create or replace function public.broadcast_read_status(p_broadcast_id text)
returns table(total int, read_count int)
language sql stable security definer set search_path = public as $$
  select
    count(*)::int as total,
    count(*) filter (
      where jsonb_array_length(coalesce(wf.data->'read_by', '[]'::jsonb)) > 0
    )::int as read_count
  from public.work_feed wf
  join public.units u on u.id = wf.unit_id
  where u.owner_id = auth.uid()                       -- ★소유 매장만(유일 방어선)
    and wf.data->>'broadcast_id' = p_broadcast_id;
$$;

grant execute on function public.broadcast_notice(text[], text, boolean) to authenticated;
grant execute on function public.broadcast_read_status(text)            to authenticated;
