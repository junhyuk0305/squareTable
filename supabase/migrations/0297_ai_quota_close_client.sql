-- 0297_ai_quota_close_client.sql — 클라의 AI 사용량 직접 차감을 닫는다 (2026-10-06 · 논리 점검 E9 ② · 0276 의 축소 단계)
--
-- 0276 은 엣지 전용 consume_ai_quota_for 를 더했다(확장). 옛 ai 엣지가 consume_ai_quota(int) 를 사용자 토큰으로 부르므로
-- 그 권한은 0276 에서 닫지 않았다. 이 파일이 닫는다. 직원이 rpc 로 60단위씩 불러 매장 한도를 다 쓰는 길이 막힌다.
--
-- 올리기 조건: 새 ai 엣지(consume_ai_quota_for 를 service_role 로 부름)가 라이브에 배포된 뒤.
-- 옛 앱 호환: 안전 | 옛 앱·웹(src)은 consume_ai_quota 를 부르지 않는다(main grep 0건). 엣지만 부른다.
-- 함수는 남긴다(되돌릴 때 grant 한 줄이면 된다).

revoke all on function public.consume_ai_quota(int) from public, anon, authenticated;
grant  execute on function public.consume_ai_quota(int) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.consume_ai_quota(int)', 'execute') then
    raise exception '0297 자가점검 실패 — consume_ai_quota 가 클라에 열려 있다';
  end if;
  raise notice '0297 자가점검 통과';
end $$;
