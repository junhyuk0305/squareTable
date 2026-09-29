-- 0227 — set_owner_can_end: 직영의 '점주 해제권'을 본사가 끄고 켠다 (2026-09-26)
--
-- ★왜 이 파일이 따로 필요한가: 0224 가 `owner_can_end` 컬럼과 방어선(CHECK ①·`end_brand_unit` 의
--   `owner_cannot_end` 거부·점주 앱 자물쇠 분기)을 전부 만들어 놓고 **그 값을 false 로 만드는 경로를
--   만들지 않았다.** 정본 02 §6 의 "신설 2개"(`admin_set_brand_relation`·`set_visibility_floor`)에도
--   없다 — 기획 단계에서 빠진 자리다(2026-09-26 실측으로 발견). 그래서 자물쇠 분기가 도달 불가였다.
--
-- 베이스 = 0224 의 `set_content_required`(같은 모양: 본사 담당자 · 직영에서만 · 멱등 · 감사 로그).
-- 정의 전수 확인(AGENTS ⑧): `set_owner_can_end` 는 이 파일이 처음이다.

-- ── 1) 점주 알림 kind 한 종 추가 ────────────────────────────────────────────
-- 0224 목록 + 해제권 변경 고지. 하한 변경(`brand_floor_changed`)에도 알림이 가는데,
-- **연결을 끊을 권리가 사라지는 것은 그보다 큰 일**이라 조용히 바뀌면 안 된다.
-- 기존 kind 재사용 금지 이유는 0224 와 같다 — 라우팅·아이콘·알림 on/off 를 따로 줄 수 있어야 한다.
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended',
                  'brand_deploy', 'brand_plan_choice',
                  'brand_relation_changed', 'brand_floor_changed', 'brand_end_right_changed'));

-- ── 2) set_owner_can_end ────────────────────────────────────────────────────
-- ★가맹에서 끄려 하면 `franchise_can_end` 다 — CHECK ①(`brand_units_franchise_limits`)도 23514 로
--   막지만, 화면이 쓸 수 있는 이름으로 먼저 돌려준다(0224 의 `franchise_floor_fixed` 와 같은 손길).
-- ★되돌리기(true)는 관계와 무관하게 언제나 허용한다 — 푸는 쪽을 막을 이유가 없다.
create or replace function public.set_owner_can_end(p_unit_id text, p_can_end boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_row   public.brand_units%rowtype;
  v_name  text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select * into v_row from public.brand_units
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if not p_can_end and v_row.relation <> 'direct' then raise exception 'franchise_can_end'; end if;
  if v_row.owner_can_end = p_can_end then return; end if;   -- 멱등

  update public.brand_units set owner_can_end = p_can_end where id = v_row.id;
  perform public.brand_log(v_brand, p_unit_id, 'owner_can_end_changed',
    jsonb_build_object('can_end', p_can_end));

  select name into v_name from public.brands where id = v_brand;
  perform public.brand_alert(p_unit_id, 'brand_end_right_changed',
    to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    case when p_can_end then '연결을 끝낼 수 있게 됐어요' else '연결 끝내기는 본사에 문의해 주세요' end,
    case when p_can_end
      then format('%s가 이 매장에서 연결을 끝낼 수 있게 했어요. 설정 > 본사 연결에서 하실 수 있어요.',
                  coalesce(v_name, '본사'))
      else format('%s가 이 매장(직영)의 연결 끝내기를 본사 문의로 바꿨어요. 받았던 노하우는 그대로 남아요.',
                  coalesce(v_name, '본사'))
    end);
end $$;
grant execute on function public.set_owner_can_end(text, boolean) to authenticated;
