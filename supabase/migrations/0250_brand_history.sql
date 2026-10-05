-- 0250 — 끝난 본사 연결을 사장과 본사가 본다 (Q28 · Q29 · 설계 05 §10·11 M-E · 마스터 계획 P5-3)
--
-- 무엇이 문제였나
--   ① Q29: 본사가 연결을 끊으면 점주는 "○○와의 연결이 끝났어요" 알림을 받고 /owner/brand-link 로 간다.
--      그 화면은 my_brand_view(active 연결만)를 그려서 "연결된 본사가 없어요" 빈 안내만 뜬다.
--   ② Q28: 점주가 끊을 때 해제 시트가 "사유는 본사에 그대로 전해져요"라고 한다. 사유는 brand_units.end_reason 과
--      brand_events 에만 남고, 둘 다 정책 0개라 본사가 읽을 길이 없다.
--
-- 바꾸는 것(읽기 RPC 2개만 더한다)
--   ① my_brand_history() — 정의자. 내가 소유한 매장(units.owner_id = auth.uid() · 삭제 안 됨)의 끝난 연결 중
--      180일 안의 것. 같은 매장·같은 본사는 마지막 한 줄이고, 그 본사와 다시 연결돼 있으면 뺀다.
--      칸 = 매장 id · 매장 이름 · 본사 이름 · 끝난 시각 · 누가(owner/brand/admin) · 사유 키.
--   ② brand_ended_units() — 정의자. auth_brand_id() 의 끝난 매장. 매장마다 마지막 한 줄이고, 지금 다시 연결된 매장은 뺀다.
--      칸 = 매장 id · 매장 이름 · 끝난 시각 · 누가 · 사유 키. 운영 표(직원·출퇴근·노하우·질문·급여)는 읽지 않는다.
--   "누가" = ended_by 가 매장 소유자면 owner · 비어 있으면 admin(service_role 직접 수정) · 그 밖은 brand.
--     end_brand_unit 은 소유자 판정을 먼저 하므로(0224) 본사 담당자가 자기 직영 매장을 끊어도 owner 로 남는다. 판정이 같다.
--
-- 바꾸지 않는 것
--   · 0224 의 법적 경계 CHECK 2개(brand_units_franchise_limits · brand_units_visibility_floor)와 end_brand_unit.
--   · brand_units·brand_events 는 여전히 정책 0개다. 본사·점주 판정은 기존 RPC 와 같은 술어를 쓴다
--     (본사 = auth_brand_id() · 0221 brand_payer_dates 와 같음 / 점주 = units.owner_id = auth.uid() · 0215 auth_owns_unit 과 같음).
--   · 끝난 매장의 운영 데이터는 기존 RPC(brand_overview_rows · brand_unit_entries · brand_unit_questions)가
--     status = 'active' 로 막는다. 이 파일은 그 함수들을 건드리지 않는다.
--
-- 옛 앱 호환: 함수를 더하기만 한다. 옛 앱·옛 웹은 이 RPC 를 부르지 않는다.
-- 되돌리기: drop function public.my_brand_history(); drop function public.brand_ended_units();

create or replace function public.my_brand_history()
returns table(unit_id text, store_name text, brand_name text, ended_at timestamptz, ended_by text, end_reason text)
language sql stable security definer set search_path = public as $$
  select x.unit_id, x.store_name, x.brand_name, x.ended_at, x.ended_by, x.end_reason
    from (
      select distinct on (bu.unit_id, bu.brand_id)
             bu.unit_id, u.store_name, b.name as brand_name, bu.ended_at,
             case when bu.ended_by is null then 'admin'
                  when bu.ended_by = u.owner_id then 'owner'
                  else 'brand' end as ended_by,
             bu.end_reason
        from public.brand_units bu
        join public.units u on u.id = bu.unit_id
        join public.brands b on b.id = bu.brand_id
       where u.owner_id = auth.uid()
         and u.deleted_at is null
         and bu.status = 'ended'
         and bu.ended_at > now() - interval '180 days'
         and not exists (select 1 from public.brand_units a
                          where a.unit_id = bu.unit_id and a.brand_id = bu.brand_id and a.status = 'active')
       order by bu.unit_id, bu.brand_id, bu.ended_at desc
    ) x
   order by x.ended_at desc
$$;
revoke all on function public.my_brand_history() from public, anon, authenticated;
grant execute on function public.my_brand_history() to authenticated;

create or replace function public.brand_ended_units()
returns table(unit_id text, store_name text, ended_at timestamptz, ended_by text, end_reason text)
language sql stable security definer set search_path = public as $$
  select x.unit_id, x.store_name, x.ended_at, x.ended_by, x.end_reason
    from (
      select distinct on (bu.unit_id)
             bu.unit_id, u.store_name, bu.ended_at,
             case when bu.ended_by is null then 'admin'
                  when bu.ended_by = u.owner_id then 'owner'
                  else 'brand' end as ended_by,
             bu.end_reason
        from public.brand_units bu
        join public.units u on u.id = bu.unit_id
       where bu.brand_id = (select public.auth_brand_id())
         and bu.status = 'ended'
         and not exists (select 1 from public.brand_units a
                          where a.unit_id = bu.unit_id and a.brand_id = bu.brand_id and a.status = 'active')
       order by bu.unit_id, bu.ended_at desc
    ) x
   order by x.ended_at desc
$$;
revoke all on function public.brand_ended_units() from public, anon, authenticated;
grant execute on function public.brand_ended_units() to authenticated;

-- ── 자가점검 ────────────────────────────────────────────────────────────────
do $$
declare
  v_bad text := '';
  v_def text;
  t text;
  f text;
begin
  foreach f in array array['public.my_brand_history()', 'public.brand_ended_units()'] loop
    if has_function_privilege('anon', f, 'execute') then v_bad := v_bad || f || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', f, 'execute') then v_bad := v_bad || f || '(authenticated 실행불가) '; end if;
    if exists (select 1 from pg_proc p where p.oid = f::regprocedure
                 and not (p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')))) then
      v_bad := v_bad || f || '(정의자·search_path 아님) ';
    end if;
  end loop;

  v_def := pg_get_functiondef('public.my_brand_history()'::regprocedure);
  foreach t in array array['owner_id = auth.uid()', 'deleted_at is null', 'status = ''ended''', '180 days'] loop
    if position(t in v_def) = 0 then v_bad := v_bad || 'my_brand_history(' || t || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.brand_ended_units()'::regprocedure);
  foreach t in array array['auth_brand_id()', 'status = ''ended''', 'status = ''active'''] loop
    if position(t in v_def) = 0 then v_bad := v_bad || 'brand_ended_units(' || t || ' 없음) '; end if;
  end loop;
  -- 끝난 매장의 운영 표를 읽는 줄이 붙으면 안 된다.
  foreach t in array array['unit_members', 'attendance', 'playbook_entries', 'unknown_queries', 'wages', 'brand_overview_rows'] loop
    if position(t in v_def) > 0 then v_bad := v_bad || 'brand_ended_units(' || t || ' 있음) '; end if;
  end loop;

  -- 법적 경계 CHECK 2개는 그대로여야 한다(0224).
  if (select count(*) from pg_constraint where conrelid = 'public.brand_units'::regclass
        and conname in ('brand_units_franchise_limits', 'brand_units_visibility_floor') and convalidated) <> 2 then
    v_bad := v_bad || '(brand_units 법적 경계 CHECK 2개 없음) ';
  end if;
  -- brand_units 는 여전히 정책 0개다.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brand_units') then
    v_bad := v_bad || '(brand_units 에 정책이 생겼다) ';
  end if;

  if v_bad <> '' then raise exception '0250 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
