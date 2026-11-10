-- 0381_ai_quota_status_at.sql — 자리를 골라 읽는 AI 사용량 상태 (2026-11-10 · 공간·매장 통합 2번 덩이 4·7)
-- 옛 앱 호환: 안전 | 새 함수 하나만 더한다. ai_quota_status(int)(0369:149 · 옛 엣지·앱이 부름)는 서명·본문 그대로다.
--
-- 정본: 데이터구조 3판 11장(공간 상한은 unit_ai_cap 한 곳 · 무료 모드 무시 · 앱 안 질문은 현재 공간이 요청한 공간과 같은지 본다) ·
--   인수인계_2번덩이 착수 지점 4·7. 이름·서명은 엣지 담당과 맞춘 약속이다(바꾸지 않는다).
--
-- ai_quota_status_at(p_unit, p_extra default 0) → (used_count, cap_count, exceeded) — ai_quota_status 와 같은 열.
--   p_unit = auth_unit_id()  → ai_quota_status(p_extra) 를 그대로 부른 결과(매장 판정을 다시 적지 않는다 · 한 곳).
--   p_unit = auth_space_id() → 그 공간의 이번 달 사용량 · 상한 unit_ai_cap(공간 300) · 무료 모드 무시(follow_free_mode = false).
--   둘 다 아니면(남의 자리 · 없는 번호 · null) forbidden. 매장 번호가 현재 매장이면서 현재 공간일 수는 없다(5-1).
--   p_extra = 이번 호출에 필요한 단위. ai_quota_status 의 p_units 와 같은 뜻 · 같은 범위(1~60 · 0 이하나 null 은 1).
--     그래서 기본값(0)으로 부르면 ai_quota_status() 기본(1)과 같은 판정이다: exceeded = used + 1 > cap ⇔ used >= cap.
--   읽기 권한: 현재 공간이면 그 공간 멤버 누구나(ai_usage_read 0371 공간 갈래 = 'read' 와 같다). 엣지는 호출자 JWT 로 부른다.
-- 엣지 쪽 확인(읽기만 · supabase/functions/ai/index.ts): match_playbook 은 invoker 라 0371 정책(현재 공간 갈래)으로 공간 노하우를
--   찾는다 · 색인 쓰기(handleEmbed)는 사용자 JWT 로 playbook_entries 읽기 + playbook_embeddings upsert = 0371 공간 갈래(write_knowhow) ·
--   차감 consume_ai_quota_for(p_unit)은 service_role 이고 자리 번호를 받는다(0369 · 공간 300 · 무료 모드 무시).
--   세 길 모두 DB 변경이 필요 없다(하니스로 확인 · 0381 머리말).

create or replace function public.ai_quota_status_at(p_unit text, p_extra int default 0)
returns table(used_count int, cap_count int, exceeded boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_month  text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_units  int  := least(greatest(coalesce(p_extra, 1), 1), 60);
  v_used   int;
  v_cap    int;
  v_follow boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'forbidden'; end if;

  if p_unit = public.auth_unit_id() then
    return query select s.used_count, s.cap_count, s.exceeded from public.ai_quota_status(v_units) s;
    return;
  end if;

  if p_unit is distinct from public.auth_space_id() then raise exception 'forbidden'; end if;

  select coalesce(au.used, 0) into v_used
    from public.ai_usage_monthly au where au.unit_id = p_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);
  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(p_unit) c;

  used_count := v_used;
  cap_count  := v_cap;
  exceeded   := (not (v_follow and public.billing_free_mode())) and v_used + v_units > v_cap;   -- 공간은 v_follow = false
  return next;
end $$;
revoke all on function public.ai_quota_status_at(text, int) from public, anon, authenticated;
grant execute on function public.ai_quota_status_at(text, int) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ai_quota_status_at(text, int)', 'execute')
     or not has_function_privilege('authenticated', 'public.ai_quota_status_at(text, int)', 'execute') then
    raise exception '0381: 실행 권한이 틀렸다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.ai_quota_status_at(text, int)'::regprocedure) ~ '\m(200|300|3000)\M' then
    raise exception '0381: 상한 숫자가 unit_ai_cap 밖에 있다';
  end if;
end $$;
