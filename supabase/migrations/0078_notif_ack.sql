-- 0078_notif_ack.sql — 알림 '모두 읽기' 기준 시각(사용자×매장)
--
-- ── 배경 ─────────────────────────────────────────────────────────────────────
-- 알림 배지는 멘션·공지(read_by)만 읽음 처리가 가능했고, 합류신청·질문·제안·교대 같은
-- '처리형' 항목은 행 주인이 남(신청자·질문자)이라 read_by 로 읽을 수 없어 배지가 안 사라졌다.
-- → (user, unit) 단위 ack 시각을 두고, 그 시각 이전(at <= ack) 항목은 배지·강조에서 제외한다.
--    항목 자체는 목록에 남아 계속 처리할 수 있다(카톡/슬랙 '모두 읽음' 표준). 새 항목은 ack 이후라
--    다시 배지에 잡힌다. 읽음 '판정'은 기존 SSOT(클라 notifications.ts)가 계속 담당한다.
--
-- 저장 위치 = unit_member_prefs(0076): 이미 (user, unit) 개인 설정 축이고, 클라가 로그인 시
-- 전 매장 행을 한 번에 당겨 크로스매장 알림(0077)에도 그대로 쓸 수 있다.
alter table public.unit_member_prefs
  add column if not exists notif_ack_at timestamptz;

-- 모두 읽기 = 내 (user, unit) 행의 notif_ack_at 갱신(행 없으면 생성).
-- save_unit_member_prefs(0076) 시그니처는 건드리지 않는 별도 함수(정본 단일화 ③ — 구버전 잔존 방지).
-- user_id 는 auth.uid() 강제(위장 불가), 멤버십 가드는 0076 과 동일.
create or replace function public.ack_notifications(p_unit_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.unit_members m
    where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  insert into public.unit_member_prefs as p (user_id, unit_id, notif_ack_at, updated_at)
  values (v_uid, p_unit_id, now(), now())
  on conflict (user_id, unit_id) do update
    set notif_ack_at = now(), updated_at = now();
end $$;

grant execute on function public.ack_notifications(text) to authenticated;
