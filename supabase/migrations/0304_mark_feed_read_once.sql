-- 0304_mark_feed_read_once.sql — 채팅 '모두 읽음'에서 auth_unit_id 를 행마다 부르지 않는다 (사장님 10-07 결정 3 · 성능)
--
-- 문제: 0303 으로 auth_unit_id() 가 직원·매니저일 때 호출당 약 0.25ms 비싸졌다. 정책(RLS)은 0285 부터
--   (select auth_unit_id()) 로 쿼리당 한 번만 부른다(로컬 실측: 직원 work_feed 1000행 읽기 0303 전후 모두 약 19ms · 차이 없음).
--   행마다 부르는 길은 mark_all_feed_read 하나였다. 본문의 can_see_room(rid) 1인자 판본이 행마다 auth_unit_id() 를 다시 불렀다.
--   로컬 실측(직원 · 방 메시지 1000건 읽음 처리): 0303 = 약 260ms.
-- 고침: 이미 구한 v_unit 을 2인자 판본 can_see_room(rid, p_unit)(0285)에 넘긴다. 뜻은 같다(1인자 판본이 부르던 값 = v_unit).
--   고친 뒤 약 40ms(0303 전 0285 판본보다도 빠르다).
-- 베이스(⑧) = 0176_work_feed_atomic_meta.sql 본문. 바뀐 곳은 ★0304 한 줄이다. 인자·반환형·권한 불변(create or replace).
-- 옛 앱 호환: 안전 | 같은 RPC 이름·인자·반환. 결과 행도 같다.
-- feed_row_for_write 도 1인자 can_see_room 을 부르지만 한 행만 본다(비용 1회) · 그대로 둔다.

create or replace function public.mark_all_feed_read(p_feed_ids text[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_uid jsonb := to_jsonb(auth.uid()::text); v_unit text; v_n int;
begin
  if auth.uid() is null or p_feed_ids is null then return 0; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then return 0; end if;
  update public.work_feed f
     set data = jsonb_set(f.data, '{read_by}', coalesce(f.data->'read_by', '[]'::jsonb) || v_uid, true)
   where f.id = any(p_feed_ids)
     and f.unit_id = v_unit
     and (f.room_id is null or public.can_see_room(f.room_id, v_unit))   -- ★0304: 행마다 auth_unit_id 를 다시 부르지 않는다
     and not coalesce(f.data->'read_by', '[]'::jsonb) @> v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 자가점검 ──
do $$
begin
  if (select prosrc from pg_proc where oid = 'public.mark_all_feed_read(text[])'::regprocedure) not like '%can_see_room(f.room_id, v_unit)%' then
    raise exception '0304 자가점검 실패';
  end if;
end $$;
