-- 0586_proposal_photos_written_once.sql — 공간 제안 사진은 한 번만 적는다(제안 행에 표시) (2026-11-12 · 결함 수정 6번 · CSO 메모)
--
-- 왜: _set_proposal_photos(0581)는 "결과 노하우의 사진이 비어 있으면 적는다"로 한 번만 적기를 판정했다. 사장이 사진을 다 지우면 다시
--   빈 상태가 돼, 사장·매니저가 knowhow-photo-copy 를 다시 부르면 스냅샷 원본에서 사진이 되살아났다.
-- 무엇을: playbook_suggestions.photos_written_at(새 칸 · null 허용) = 이 제안의 사진을 결과 노하우에 적은 시각.
--   _set_proposal_photos 는 이 칸이 있으면 안 적는다 · 적으면 이 칸을 찍는다. _proposal_photo_source 는 이 칸이 있으면 paths 를 비운다.
--   엣지 코드는 안 바꾼다(paths 가 비면 복사 0 → photos [] 를 돌려준다 · existing 이 있으면 그 목록을 돌려준다 = 0581 그대로).
--   스냅샷의 photos 를 비우는 길은 고르지 않았다: 스냅샷은 사장 검토 화면이 읽는 원본 기록이다.
-- 이미 적은 행 채우기: 결과 노하우에 사진이 있는 승인된 공간 제안 = 적었다고 본다(라이브 = 0581 이 처음 올라가 0행).
-- 옛 앱 호환(⑪ 확장): 새 칸 하나(기본 null) · 두 함수 서명 그대로(service_role 전용 · 앱은 안 부른다).
-- 재정의 3단계(AGENTS ⑧): 정의 전수 = 둘 다 0581 하나 → 0581 본문 통째(주석 포함) · 바뀐 줄 = ★0586.
-- 되돌리기: scripts/rollback/0586.sql(0581 본문 · 칸은 남긴다).

alter table public.playbook_suggestions add column if not exists photos_written_at timestamptz;
comment on column public.playbook_suggestions.photos_written_at is
  '0586 공간 제안 사진을 결과 노하우에 적은 시각. 있으면 knowhow-photo-copy 가 다시 적지 않는다(사장이 지운 사진을 되살리지 않는다).';

update public.playbook_suggestions s
   set photos_written_at = now()
 where s.kind = 'from_space' and s.status = 'approved' and s.photos_written_at is null and s.resulting_entry_id is not null
   and exists (select 1 from public.playbook_entries e
                where e.id = s.resulting_entry_id and e.unit_id = s.unit_id and coalesce(cardinality(e.photos), 0) > 0);

-- ════════════════════════════════════════════════════════════════════════════
-- ① _proposal_photo_source — 엣지 판정 한 곳 (0581 본문 · ★0586)
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
  -- ★0586: 이미 한 번 적은 제안(photos_written_at)은 복사할 경로를 비운다 → 엣지가 복사하지 않고 빈 목록을 돌려준다.
  --   사장이 사본 노하우 사진을 다 지운 뒤 다시 불러도 되살아나지 않는다(결함 6).
  if s.photos_written_at is not null then
    return jsonb_build_object('status', 'ok', 'store', s.unit_id, 'source', s.source_unit_id,
                              'existing', to_jsonb(coalesce(v_existing, '{}'::text[])), 'paths', '[]'::jsonb);
  end if;
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
-- ② _set_proposal_photos — 사본 경로 기록(두 번 불러도 한 번) (0581 본문 · ★0586)
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

  -- 결과 노하우를 잠그고 한 번만 채운다. 동시에 두 번 와도 뒤의 것은 앞의 목록을 받는다.
  -- ★0586: "한 번"의 판정 = 제안 행의 photos_written_at. 0581 은 "결과 노하우 사진이 비었나"로 봐서
  --   사장이 사진을 다 지우면 다시 비어 엣지 재호출로 되살아났다. 제안 행도 잠가 같은 제안의 동시 호출을 줄 세운다.
  perform 1 from public.playbook_suggestions where id = s.id for update;
  select e.photos into v_cur from public.playbook_entries e
   where e.id = s.resulting_entry_id and e.unit_id = s.unit_id for update;
  if not found then raise exception 'invalid_argument'; end if;
  if (select ps.photos_written_at from public.playbook_suggestions ps where ps.id = s.id) is not null or v_n = 0 then
    return coalesce(v_cur, '{}'::text[]);
  end if;
  -- ★0586(CSO Low): 결과 노하우에 이미 사진이 있으면(사장이 먼저 넣음) 덮지 않는다. 이때도 "적었다"로 찍는다.
  --   안 찍으면 사장이 그 사진을 다 지운 뒤 엣지 재호출로 스냅샷 사진이 되살아난다. 위 백필과 같은 판정이다.
  if coalesce(cardinality(v_cur), 0) > 0 then
    update public.playbook_suggestions set photos_written_at = now() where id = s.id;
    return v_cur;
  end if;

  update public.playbook_entries set photos = v_paths where id = s.resulting_entry_id;
  update public.playbook_suggestions set photos_written_at = now() where id = s.id;
  return v_paths;
end $$;
comment on function public._set_proposal_photos(text, text[]) is
  '0581 엣지(knowhow-photo-copy) 전용: 승인된 공간 제안의 결과 노하우에 매장 폴더 사진 사본을 한 번만 적는다. service_role 만.';
revoke all on function public._set_proposal_photos(text, text[]) from public, anon, authenticated;
grant execute on function public._set_proposal_photos(text, text[]) to service_role;

do $$
declare f text;
begin
  foreach f in array array['public._proposal_photo_source(text, uuid)', 'public._set_proposal_photos(text, text[])'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0586 자가점검 실패 — % 가 앱에 열렸다', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0586 자가점검 실패 — % 를 service_role 이 못 부른다', f;
    end if;
    if position('photos_written_at' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '0586 자가점검 실패 — % 가 한 번 적은 표시를 안 본다', f;
    end if;
  end loop;
  raise notice '0586 자가점검 통과';
end $$;
