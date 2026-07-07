-- 0058_push_subscription_device_dedup.sql — 재설치/구독회전으로 쌓이는 '죽은 구독' 정리
--
-- ── 증상(라이브 확인) ────────────────────────────────────────────────────────
-- 한 사용자(test001)의 아이폰에 push_subscriptions 행이 2개 — 옛것(첫 설치, 삭제됨)과 새것(재설치).
-- 홈화면앱을 삭제 후 재추가하면 서비스워커가 새로 등록돼 endpoint 가 새로 발급되는데, 옛 endpoint 행이
-- DB에 그대로 남는다. Apple(APNs)은 죽은 endpoint 에도 '접수(201)'만 하고 배달은 안 하며 410(만료)도
-- 즉시 주지 않아, 엣지의 404/410 자동 prune 으로도 안 지워진다. → 발송이 sent 를 부풀리고(죽은것 포함),
-- 오래되면 '살아있다고 착각하는 죽은 구독'만 쌓인다.
--   근거: web-push 구독 노화 배달률 급감 + '죽어도 성공코드 반환'(pushpad), 재설치=재구독 필요(WebKit/Progressier).
--
-- ── 처방(근본·SSOT 재확정) ──────────────────────────────────────────────────
-- 저장 RPC(save_push_subscription, 0049 정본)를 '같은 기기의 옛 endpoint 를 교체'하도록 확장한다.
-- 기기 판별 = 같은 사용자(user_id) + 같은 UA. 새 구독을 upsert 한 뒤, 그 사용자의 '같은 UA·다른 endpoint'
-- 행을 삭제한다 → 재설치/회전 잔재가 딱 1개(최신)로 수렴. 다른 기기(다른 UA)와 UA 미상(null)은 손대지 않아
-- 멀티기기(폰+데스크톱) 구독은 그대로 보존된다.
--   ⚠️ AGENTS.md ③ 정본 단일화: 흩어진 함수는 항상 최고 번호가 최종본 → 0049 본문을 여기서 전체 재확정한다.
--   security definer 라 삭제는 RLS 우회로 원자적 수행(테넌트 위험 없음 — v_uid 본인 행만 건드림).

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_unit_id  text default null,
  p_ua       text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_endpoint,'') = '' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions as ps (user_id, unit_id, endpoint, p256dh, auth, ua, updated_at)
  values (v_uid, p_unit_id, p_endpoint, p_p256dh, p_auth, p_ua, now())
  on conflict (endpoint) do update
    set user_id    = v_uid,               -- endpoint(=이 브라우저) 소유권을 현재 로그인 사용자로 이전
        unit_id    = excluded.unit_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        ua         = excluded.ua,
        updated_at = now();

  -- 같은 기기(같은 UA)의 옛 endpoint 정리 — 재설치/구독회전 잔재를 최신 1개로 수렴.
  -- UA 미상(null/빈값)이면 기기 판별 불가 → 아무것도 지우지 않는다(과잉 삭제 금지).
  if coalesce(p_ua, '') <> '' then
    delete from public.push_subscriptions
    where user_id = v_uid
      and ua = p_ua
      and endpoint <> p_endpoint;
  end if;
end $$;

grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
