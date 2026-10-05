-- 0251_iap_prepaid_guard.sql — 선불 기간이 남아 있으면 앱 결제를 잠그기 위한 읽기 함수 (2026-10-05 사용자 결정)
--
-- 앱 결제는 스토어가 하므로 서버에서 막을 수 없다. 앱이 이 값을 읽고 구매 버튼을 잠근다.
-- 끝나기 3일 전부터는 결제할 수 있다(카드 가드 0230 과 같은 기준). 그 판정은 앱 순수 함수(src/lib/iap/prepaidGuard.ts) 몫이다.
--
-- owner_prepaid_until() = 로그인한 사장이 가진 매장 중 선불 매장(unit_prepaid 0235: 유료 · 체험 아님 · 본사 부담 아님 ·
--   앱/카드 구독 흔적이 아니거나 남은 계좌이체·무료 지급 슬롯이 있음)의 가장 늦은 paid_until. 없으면 null.
--   본인 매장만 본다(auth.uid()). 지운 매장은 보지 않는다.
-- 되돌리기: drop function public.owner_prepaid_until();

create or replace function public.owner_prepaid_until()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(us.paid_until)
    from public.units u
    join public.unit_subscriptions us on us.unit_id = u.id
   where u.owner_id = auth.uid()
     and u.deleted_at is null
     and us.paid_until > now()
     and public.unit_prepaid(u.id)
$$;
revoke all on function public.owner_prepaid_until() from public, anon, authenticated;
grant execute on function public.owner_prepaid_until() to authenticated;

-- 자가점검
do $$
declare
  v_bad text := '';
begin
  if not exists (select 1 from pg_proc p where p.oid = 'public.owner_prepaid_until()'::regprocedure and p.prosecdef
                   and 'search_path=public' = any(p.proconfig)) then
    v_bad := v_bad || 'owner_prepaid_until(definer·search_path 아님) ';
  end if;
  if has_function_privilege('anon', 'public.owner_prepaid_until()', 'execute') then
    v_bad := v_bad || 'owner_prepaid_until(anon 실행가능) ';
  end if;
  if not has_function_privilege('authenticated', 'public.owner_prepaid_until()', 'execute') then
    v_bad := v_bad || 'owner_prepaid_until(authenticated 실행 불가) ';
  end if;
  if position('auth.uid()' in pg_get_functiondef('public.owner_prepaid_until()'::regprocedure)) = 0 then
    v_bad := v_bad || 'owner_prepaid_until(본인 한정 없음) ';
  end if;
  if v_bad <> '' then raise exception '0251 자가점검 실패: %', v_bad; end if;
end $$;
