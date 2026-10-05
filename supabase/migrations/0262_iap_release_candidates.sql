-- 0262 · 앱 "매장 수 줄이기"의 닫을 매장은 구독으로 연 매장만(QA 논리 점검 2026-10-05 B4)
--
-- 예전: 앱 화면은 잠기지 않은 소유 매장 전부를 닫을 후보로 세고, choose_iap_release(0196)는 소유만 확인했다.
--   계좌이체·본사 부담·코드로 연 매장도 후보·개수에 들어가 사장이 필요 없는 매장까지 골라야 했다.
--   그 매장을 고르면 화면은 "닫혀요"라고 했지만 sync_iap_slots 는 구독 흔적만 다뤄 실제로는 안 닫혔다.
--   카드 쪽은 0230 card_release_candidates · card_begin_change(release_mismatch)로 이미 고쳤다.
-- 지금: 후보 = card_release_candidates(구독 흔적이 있는 · 지금 열린 소유 매장, 카드·스토어 공용).
--   고른 매장이 후보 밖이면 release_mismatch. 새 매장 수(p_count)를 주면 개수 = max(0, 후보 수 − 새 매장 수)도 검증한다.
--   p_count 는 기본 null 이다 — 옛 앱(1인자 호출)은 후보 포함만 검증한다.
-- 본문: 0196 승계. 인자가 늘어 옛 1인자 판을 지운다(남기면 PostgREST 이름 인자 호출이 모호해진다).
-- ⚠️ 앱 빌드보다 먼저 적용한다(새 앱은 p_count 를 보낸다).
-- 되돌리기: drop function public.choose_iap_release(text[], int); 뒤 0196 의 choose_iap_release 다시 적용.

drop function if exists public.choose_iap_release(text[]);
create or replace function public.choose_iap_release(p_units text[], p_count int default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_n    int;
  v_open text[];   -- ★0262: 닫을 매장 후보(구독으로 연 · 지금 열린 소유 매장)
  v_rel  text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_units is null or coalesce(array_length(p_units, 1), 0) = 0 then raise exception 'units_required'; end if;
  -- 전부 본인 소유여야 한다(남의 매장을 "닫을 매장"으로 고를 수 없다).
  select count(*) into v_n
    from unnest(p_units) u
    join public.unit_members m on m.unit_id = u and m.user_id = v_uid and m.role = 'owner';
  if v_n <> array_length(p_units, 1) then raise exception 'not_owner'; end if;

  -- ★0262(B4): 후보 포함 · 개수 검증(card_begin_change 와 같은 규칙). 서버가 대신 고르지 않는다.
  select coalesce(array_agg(c.unit_id), '{}') into v_open
    from public.card_release_candidates(v_uid) c;
  v_rel := array(select distinct x from unnest(p_units) x where x is not null);
  if not (v_rel <@ v_open) then raise exception 'release_mismatch'; end if;
  if p_count is not null and cardinality(v_rel) <> greatest(0, cardinality(v_open) - p_count) then
    raise exception 'release_mismatch';
  end if;

  delete from public.iap_release_choice where owner_id = v_uid;   -- 덮어쓰기
  insert into public.iap_release_choice (owner_id, unit_id)
  select v_uid, u from unnest(p_units) u
  on conflict do nothing;
  return v_n;
end $$;
revoke all on function public.choose_iap_release(text[], int) from public, anon, authenticated;
grant execute on function public.choose_iap_release(text[], int) to authenticated;
