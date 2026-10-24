-- 0340 앱 행동 계측: 서버가 신원을 찍는 묶음 쓰기(log_app_events). 0041 머리말이 미뤄 둔 "서버측 태깅".
-- 옛 앱 호환: 안전 | app_events 에 nullable 칸 3개·인덱스·새 함수만 더한다. 옛 앱·웹의 직접 insert
--   (track.ts·push/notify.ts 의 .from('app_events').insert)와 0041 정책·grant 는 그대로 둔다.
--
-- 왜: 직접 insert 는 클라가 보낸 user_id 가 세션과 어긋나면 RLS 42501 로 조용히 버려진다.
--   묶어 보내면 한 줄 때문에 묶음 전체가 버려진다. 그래서 신원은 서버가 정한다.
--   - user_id = auth.uid(). 단 이벤트에 실린 uid(쌓을 때의 로그인 사용자)가 auth.uid() 와 같을 때만.
--     다르거나 없으면 null. 클라 값으로 신원을 정하지 않고, 확인에만 쓴다.
--     왜: 클라는 묶어서 나중에 보낸다. A 가 쌓고 로그아웃한 뒤 B 가 로그인하면 A 의 기록이 B 의 토큰으로 간다.
--     로그인 전에 쌓은 기록이 로그인 뒤에 가는 것도 같다. 그런 기록은 누구의 것으로도 찍지 않는다.
--   - unit_id·role = 위에서 정한 user_id 로 unit_members 에 (uid, 보낸 unit_id) 행이 있을 때만 그 행에서. 아니면 둘 다 null.
--     auth_member_unit_id() 를 쓰지 않는다: "지금 고른 매장" 하나만 돌려줘서, 다점포 사용자가 매장을 바꾸는
--     순간 앞 매장 이벤트가 null 이 된다. 필요한 판정은 "그 매장 소속인가"다.
--   - 클라 시각 at 은 24시간 전 ~ 5분 뒤만 받는다. 벗어나거나 못 읽으면 now().
--   - 클라가 이벤트마다 붙인 id(uuid)로 저장한다. 같은 id 는 한 번만 들어간다(응답만 잃고 다시 보낸 묶음·
--     탭을 닫을 때 keepalive 로 한 번 더 보낸 묶음). id 가 uuid 가 아니면 서버가 새로 만든다.
--     반환값 = 실제로 새로 들어간 행 수.
-- 거부(묶음 전체, 부분 저장 없음): 배열 아님 · 0건 · 51건 이상 · 이름 형식 · props 2KB 초과 · route 200자 초과 ·
--   platform/app_version/session_id 64자 초과. 오류는 'invalid_argument' 하나만 낸다(AGENTS.md ⑨).
--   클라는 이 오류를 받으면 재시도하지 않고 버린 수로 센다(재시도해도 영영 실패한다).
-- 보관 기간: purge_retention_global(0288)이 12개월 지난 app_events 를 지운다. 바꾸지 않는다.

alter table public.app_events add column if not exists platform    text;
alter table public.app_events add column if not exists app_version text;
alter table public.app_events add column if not exists session_id  text;

-- 콘솔 사용자 타임라인(사용자·날짜로 좁혀 읽기)용.
create index if not exists app_events_user_idx on public.app_events (user_id, created_at desc);

create or replace function public.log_app_events(p_events jsonb)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  v_e    jsonb;
  v_user uuid;
  v_unit text;
  v_role text;
  v_at   timestamptz;
  v_id   uuid;
  v_row  integer;
  v_n    integer := 0;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 50 then
    raise exception 'invalid_argument';
  end if;

  for v_e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e->'event') is distinct from 'string'
       or (v_e->>'event') !~ '^[a-z][a-z0-9_]{1,47}$'
       or coalesce(jsonb_typeof(v_e->'props'), 'null') not in ('object', 'null')
       or octet_length(coalesce(v_e->'props', 'null'::jsonb)::text) > 2048
       or length(coalesce(v_e->>'route', '')) > 200
       or length(coalesce(v_e->>'platform', '')) > 64
       or length(coalesce(v_e->>'app_version', '')) > 64
       or length(coalesce(v_e->>'session_id', '')) > 64 then
      raise exception 'invalid_argument';
    end if;

    v_user := case when v_uid is not null and v_e->>'uid' = v_uid::text then v_uid end;
    v_unit := null;
    v_role := null;
    if v_user is not null and v_e ? 'unit_id' then
      select m.unit_id, m.role into v_unit, v_role
        from public.unit_members m
       where m.user_id = v_user and m.unit_id = v_e->>'unit_id';
    end if;

    begin
      v_at := (v_e->>'at')::timestamptz;
    exception when others then
      v_at := null;
    end;
    if v_at is null or v_at < v_now - interval '24 hours' or v_at > v_now + interval '5 minutes' then
      v_at := v_now;
    end if;

    v_id := case when (v_e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (v_e->>'id')::uuid else gen_random_uuid() end;

    insert into public.app_events (id, unit_id, user_id, role, event, props, route, platform, app_version, session_id, created_at)
    values (v_id, v_unit, v_user, v_role, v_e->>'event', nullif(v_e->'props', 'null'::jsonb), nullif(v_e->>'route', ''),
            nullif(v_e->>'platform', ''), nullif(v_e->>'app_version', ''), nullif(v_e->>'session_id', ''), v_at)
    on conflict (id) do nothing;
    get diagnostics v_row = row_count;
    v_n := v_n + v_row;
  end loop;

  return v_n;
end $$;

-- from public 만으로는 anon·authenticated 가 안 닫힌다(Supabase 가 직접 부여). 한 번 다 닫고 필요한 둘만 연다.
revoke all on function public.log_app_events(jsonb) from public, anon, authenticated;
grant execute on function public.log_app_events(jsonb) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.log_app_events(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_app_events(jsonb)', 'execute') then
    raise exception '0340 자가점검 실패: log_app_events 가 앱에 안 열렸다';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.log_app_events(jsonb)'::regprocedure) then
    raise exception '0340 자가점검 실패: log_app_events 가 security definer 가 아니다';
  end if;
  -- 옛 앱 쓰기 경로(0041)가 그대로인지
  if not has_table_privilege('anon', 'public.app_events', 'insert')
     or not has_table_privilege('authenticated', 'public.app_events', 'insert')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events' and policyname = 'app_events_insert') then
    raise exception '0340 자가점검 실패: 옛 앱의 app_events 직접 insert 경로가 바뀌었다';
  end if;
  -- 읽기는 여전히 service_role 만. 0335 account_access_allowed 는 restrictive(AND 조건)라 읽기를 열지 않는다.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events'
              and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')) then
    raise exception '0340 자가점검 실패: app_events 가 클라에 읽힌다';
  end if;
end $$;
