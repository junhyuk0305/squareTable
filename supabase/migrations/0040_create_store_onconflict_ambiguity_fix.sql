-- 0040_create_store_onconflict_ambiguity_fix.sql — create_store 의 "두 번째 42702" 확정 제거
--
-- ── 왜 또? (0038 로도 안 고쳐진 이유) ────────────────────────────────────────
-- create_store 는 RETURNS TABLE(unit_id text, invite_code text) 로 OUT 파라미터 `unit_id` 를
--   선언한다. 0023 시절의 모호성은 `where id=v_uid and unit_id is not null`(WHERE 미한정)이었고
--   0038 이 p.unit_id 로 고쳤다. 그러나 0036 이 새로 넣은 마지막 줄
--       insert into unit_subscriptions (unit_id, ...) values (...) ON CONFLICT (unit_id) do nothing
--   의 `ON CONFLICT (unit_id)` 가 OUT 파라미터 unit_id 와 이름이 겹쳐 plpgsql 이
--   "column reference unit_id is ambiguous"(42702)를 다시 던진다.
--   이 문장은 유효한 store_name+industry 로 그 지점까지 도달할 때만 준비(prepare)되므로,
--   빈 이름 호출은 store_name_required 로 먼저 빠져 이 버그가 가려졌다(실가입에서만 재현).
--
-- ── 처방(근본 제거 + 안전장치) ──────────────────────────────────────────────
--   ① ON CONFLICT (unit_id) 를 제거하고 WHERE NOT EXISTS(테이블 한정 s.unit_id) 로 치환
--      → 문장에 모호한 unit_id 참조가 0개. (v_unit 은 매 호출 새 uuid 라 경합 없음.)
--   ② 함수 상단에 `#variable_conflict use_column` 지시어 추가 → 이 함수 안의 어떤 식별자든
--      컬럼/변수 모호 시 "컬럼"으로 확정 해석(OUT 파라미터는 오직 대입 대상이라 무영향).
--      이 부류(RETURNS TABLE OUT 파라미터명 == 컬럼명) 버그의 재발을 원천 차단한다.
--   보안·반환·부작용 의미는 0038/0036 과 100% 동일(무료체험 구독행 생성 포함).

create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_biz  text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind  text := nullif(btrim(coalesce(p_industry, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;
  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  -- 신규 매장 = 3일 무료체험(0036). ON CONFLICT(unit_id) 대신 WHERE NOT EXISTS 로 모호성 제거.
  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  select v_unit, 'trialing', now() + interval '3 days'
  where not exists (
    select 1 from public.unit_subscriptions s where s.unit_id = v_unit
  );

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text) to authenticated;

-- 방어적 정리: 원인 규명에 잠시 썼던 진단 함수가 라이브에 남아있으면 제거(멱등, 없으면 no-op).
drop function if exists public._diag_fn_defs();
