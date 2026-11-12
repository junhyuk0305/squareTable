-- rollback/0586.sql — 0586 을 되돌린다(0581 본문 · "결과 노하우가 비었으면 적는다"). photos_written_at 칸은 남긴다(확장 → 축소 · 비어 있어도 무해).
--   ⚠️되돌리면 사장이 지운 사진이 엣지 재호출로 되살아나는 결함이 돌아온다. 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0586.sql --linked
begin;
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
commit;
