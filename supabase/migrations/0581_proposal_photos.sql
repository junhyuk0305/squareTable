-- 0581_proposal_photos.sql — 공간 제안 승인 뒤 사진 사본 기록 (야간 작업 11-11 · sb · 5번 덩이 사진 길)
--
-- 정본: 야간작업_2026-11-11/계약.md 1-3(`_set_proposal_photos` · 엣지 knowhow-photo-copy) · 사용자 결정 9(11-11 밤)
--   매장이 공간 제안을 승인하는 순간 새 엣지 함수가 서비스 권한으로 사진 파일을 매장 폴더로 복사하고 사본 경로를 기록한다.
--   엣지가 승인자의 권한과 그 경로가 그 제안의 것인지를 직접 검증한다. 매니저 승인도 된다(매니저 자기 제안 승인 = 결정 193).
--   원본 사진이 그사이 지워졌으면 그 장만 빠진다(사진 없이 승인).
--
-- 왜 서비스 권한인가: 승인자는 공간 폴더를 못 읽는다(사진 정책 0377 · 첫 폴더 = 현재 자리). 0490 승인은 원본 경로만 돌려준다.
--   SQL 로는 저장소 파일을 복사할 수 없다 → 엣지가 서비스 키로 복사한다. 그래서 권한 검증이 엣지와 이 두 함수의 본체다.
--
-- 함수 둘(둘 다 service_role 만 · anon·authenticated 실행 못 함):
--   _proposal_photo_source(p_suggestion, p_uid) → jsonb
--     엣지가 "누가 · 어느 제안 · 어떤 경로"를 한 번에 판정받는다. 판정 규칙을 TS 와 SQL 두 곳에 흩지 않으려고 여기 둔다(AGENTS ②).
--     status = 'forbidden'  제안 없음 · 부른 사람이 그 제안 매장(unit_id)의 owner·manager 가 아님 · 탈퇴 계정 · 매장 잠김 · 매니저 좌석 잠김
--              (없는 제안과 남의 제안을 가르지 않는다 = 있는지 알려 주지 않는다)
--     status = 'not_ready'  공간 제안이 아님 · 승인 전 · 결과 노하우 없음(또는 그 매장 행이 아님)
--     status = 'ok'         store(매장 번호) · source(보낸 공간 번호) · existing(결과 노하우의 지금 사진) ·
--                           paths(스냅샷 photos 중 첫 폴더 = 보낸 공간이고 모양이 맞는 것만 · 본문 값은 받지 않는다)
--   _set_proposal_photos(p_suggestion, p_paths) → text[]
--     제안이 from_space · approved · 결과 노하우 있음 → 경로마다 첫 폴더 = 그 제안의 매장 → 결과 노하우 photos 가 비어 있을 때만 채운다
--     (두 번 불러도 한 번) → 결과 노하우의 photos 를 돌려준다(채웠으면 채운 목록 · 이미 있었으면 그 목록).
--     오류 = invalid_argument 하나(엣지 전용이라 화면에 안 나간다 · 엣지는 500 으로 바꾼다).
--
-- 옛 앱 호환(⑪ 확장만): 새 함수 둘. 표·정책·0490 함수 무변경. 옛 앱 승인 = 사진 없이(지금과 같다).
-- 0198 set_knowhow_photos(사장만 · 현재 자리)는 다시 정의하지 않는다. 그 함수는 매니저·공간 폴더를 모른다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① _proposal_photo_source — 엣지 판정 한 곳
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._proposal_photo_source(p_suggestion text, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s      public.playbook_suggestions%rowtype;
  v_role text;
  v_existing text[];
  v_paths text[];
begin
  if p_suggestion is null or p_uid is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into s from public.playbook_suggestions where id = p_suggestion;
  if not found then return jsonb_build_object('status', 'forbidden'); end if;

  -- 부른 사람 = 그 제안 매장의 사장·매니저(행의 자리 번호로 본다 · 현재 자리가 아니어도 된다 · 엣지는 세션 자리를 모른다).
  select m.role into v_role
    from public.unit_members m
    join public.profiles p on p.id = m.user_id and p.deleted_at is null
    join public.units u on u.id = m.unit_id and u.kind = 'store' and u.deleted_at is null
   where m.unit_id = s.unit_id and m.user_id = p_uid and m.role in ('owner', 'manager');
  if v_role is null
     or public.unit_access_locked(s.unit_id)
     or (v_role = 'manager' and public.seat_locked_for(s.unit_id, p_uid)) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if s.kind <> 'from_space' or s.status <> 'approved' or s.resulting_entry_id is null or s.source_unit_id is null then
    return jsonb_build_object('status', 'not_ready');
  end if;
  select e.photos into v_existing from public.playbook_entries e where e.id = s.resulting_entry_id and e.unit_id = s.unit_id;
  if not found then return jsonb_build_object('status', 'not_ready'); end if;

  -- 복사할 경로 = 그 제안 스냅샷의 사진뿐. 첫 폴더 = 보낸 공간 · 파일 이름 한 칸 · 이상한 글자 없음.
  select coalesce(array_agg(x order by ord), '{}'::text[]) into v_paths
    from jsonb_array_elements_text(case when jsonb_typeof(s.source_snapshot -> 'photos') = 'array'
                                        then s.source_snapshot -> 'photos' else '[]'::jsonb end) with ordinality as t(x, ord)
   where split_part(x, '/', 1) = s.source_unit_id
     and x ~ '^[^/]+/[A-Za-z0-9._-]{1,200}$'
     and position('..' in x) = 0;

  return jsonb_build_object(
    'status', 'ok',
    'store', s.unit_id,
    'source', s.source_unit_id,
    'existing', to_jsonb(coalesce(v_existing, '{}'::text[])),
    'paths', to_jsonb(v_paths[1:20]));
end $$;
comment on function public._proposal_photo_source(text, uuid) is
  '0581 엣지(knowhow-photo-copy) 전용: 부른 사람·제안 상태·복사할 원본 경로를 한 번에 판정한다. service_role 만.';
revoke all on function public._proposal_photo_source(text, uuid) from public, anon, authenticated;
grant execute on function public._proposal_photo_source(text, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ② _set_proposal_photos — 사본 경로 기록(두 번 불러도 한 번)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._set_proposal_photos(p_suggestion text, p_paths text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare
  s       public.playbook_suggestions%rowtype;
  v_cur   text[];
  v_paths text[];
  v_n     int;
begin
  select * into s from public.playbook_suggestions where id = p_suggestion;
  if not found or s.kind <> 'from_space' or s.status <> 'approved' or s.resulting_entry_id is null then
    raise exception 'invalid_argument';
  end if;

  select array_agg(distinct x) into v_paths from unnest(coalesce(p_paths, '{}'::text[])) x;
  v_n := coalesce(array_length(v_paths, 1), 0);
  if v_n > 20 then raise exception 'invalid_argument'; end if;
  -- 경로마다 첫 폴더 = 그 제안의 매장(사진 정책 0377 · 업로드 규약 {unit_id}/{ts}-{rand}.{ext}). 하나라도 아니면 아무것도 안 적는다.
  if exists (select 1 from unnest(coalesce(v_paths, '{}'::text[])) x
              where split_part(x, '/', 1) <> s.unit_id
                 or x !~ '^[^/]+/[A-Za-z0-9._-]{1,200}$'
                 or position('..' in x) > 0) then
    raise exception 'invalid_argument';
  end if;

  -- 결과 노하우를 잠그고 비어 있을 때만 채운다. 동시에 두 번 와도 뒤의 것은 앞의 목록을 받는다.
  select e.photos into v_cur from public.playbook_entries e
   where e.id = s.resulting_entry_id and e.unit_id = s.unit_id for update;
  if not found then raise exception 'invalid_argument'; end if;
  if coalesce(cardinality(v_cur), 0) > 0 or v_n = 0 then
    return coalesce(v_cur, '{}'::text[]);
  end if;

  update public.playbook_entries set photos = v_paths where id = s.resulting_entry_id;
  return v_paths;
end $$;
comment on function public._set_proposal_photos(text, text[]) is
  '0581 엣지(knowhow-photo-copy) 전용: 승인된 공간 제안의 결과 노하우에 매장 폴더 사진 사본을 한 번만 적는다. service_role 만.';
revoke all on function public._set_proposal_photos(text, text[]) from public, anon, authenticated;
grant execute on function public._set_proposal_photos(text, text[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array['public._proposal_photo_source(text, uuid)', 'public._set_proposal_photos(text, text[])'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0581 자가점검 실패 — % 가 앱에 열렸다', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0581 자가점검 실패 — % 를 service_role 이 못 부른다', f;
    end if;
  end loop;
  if position('source_snapshot' in pg_get_functiondef('public._proposal_photo_source(text, uuid)'::regprocedure)) = 0 then
    raise exception '0581 자가점검 실패 — 복사할 경로를 스냅샷에서 읽지 않는다';
  end if;
  raise notice '0581 자가점검 통과';
end $$;
