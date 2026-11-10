-- 0372_purge_backstop_skip_space.sql — 매일 파기의 백스톱이 공간을 지우지 않게 한다 (2026-11-10 · 공간·매장 통합 1번 덩이 라이브 적용 전 보강)
--
-- 문제: purge_deleted_accounts 의 백스톱은 "주인 프로필이 없는 자리"를 지난 하드삭제 잔재로 보고 파기한다.
--   공간은 설계상 units.owner_id 가 비어 있다(3판 5-4 · 주인은 unit_members 의 space_owner 행).
--   그래서 공간 행이 하나라도 생기면 04:00 크론마다 deleted_at 이 찍히고 purge_deleted_store 로 바로 파기된다.
--   지금 라이브에는 공간 행이 0개라(공간 입구 꺼짐) 아직 지워진 것은 없다.
-- 고침: 백스톱 루프에 공간을 빼는 조건 한 줄(★0372). 매장·본사 작업실은 그대로다(작업실은 시스템 계정 프로필이 있다).
--   공간을 언제 정리할지(주인 탈퇴 · 공간 삭제)는 공간 삭제 작업에서 따로 정한다.
--
-- 베이스: 정의 전수 0035 · 0053 · 0166 · 0361 → 최고 번호 0361 본문을 통째로 옮겼다. 바뀐 곳은 ★0372 줄뿐이다.
-- 되돌리기: 0361 의 purge_deleted_accounts 본문을 다시 만든다.

create or replace function public.purge_deleted_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  n       integer;
  v_cutoff timestamptz := now() - interval '30 days';
  u       record;
  v_held  uuid[] := '{}';   -- 매장 파기가 실패한 사장 — 이번에는 계정을 지우지 않는다(지우면 트리거가 매장을 실삭제한다)
  v_err   text;
  v_state text;
begin
  -- 유예 지난 소프트삭제 매장: 파기(통계·콘텐츠 보관 · 근로기록 유지).
  --   ★매장마다 하위 트랜잭션. 한 매장이 실패하면 그 매장만 되돌리고 기록을 남긴 뒤 다음 매장·계정 파기로 넘어간다.
  --   실패한 매장은 그대로 남아 다음 실행에서 다시 시도된다.
  for u in select x.id, x.owner_id from public.units x where x.deleted_at is not null and x.deleted_at < v_cutoff and x.purged_at is null loop
    begin
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      if u.owner_id is not null then v_held := v_held || u.owner_id; end if;
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- 백스톱: 주인 프로필이 존재하지 않는 매장(과거 하드삭제 잔재)도 파기. ★0361: 같은 파기를 지난다(파기 표시 매장은 제외).
  --   ★0372: 공간은 뺀다. 공간은 주인 칸(owner_id)이 원래 비어 있어 잔재로 잘못 잡힌다.
  for u in select x.id from public.units x
            where x.purged_at is null
              and x.kind is distinct from 'space'   -- ★0372
              and not exists (select 1 from public.profiles p where p.id = x.owner_id) loop
    begin
      update public.units set deleted_at = coalesce(deleted_at, now()) where id = u.id;
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- ★0361: 파기 표시 매장 중 근로기록 3년 정리가 끝난 것은 행까지 지운다.
  delete from public.units x where x.purged_at is not null and not public.unit_has_labor_records(x.id);
  get diagnostics n = row_count; v_count := v_count + n;
  -- 유예 지난 소프트삭제 계정: auth.users 삭제(profiles 는 on delete cascade → 아래 트리거도 발동).
  --   ★0360: 매장 기록 표의 계정 cascade 를 풀어 퀴즈 기록·제안·교육 요청이 남는다.
  delete from auth.users au using public.profiles p
    where p.id = au.id and p.deleted_at is not null and p.deleted_at < v_cutoff
      and au.id <> all (v_held);
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;
revoke all on function public.purge_deleted_accounts() from public, anon, authenticated;

-- 자가점검: 백스톱이 공간을 뺀다.
do $$
begin
  if (select prosrc from pg_proc where oid = 'public.purge_deleted_accounts()'::regprocedure) !~ 'kind is distinct from ''space''' then
    raise exception '0372 self-check: purge_deleted_accounts 백스톱이 공간을 빼지 않는다';
  end if;
  if has_function_privilege('authenticated', 'public.purge_deleted_accounts()', 'execute') then
    raise exception '0372 self-check: purge_deleted_accounts 실행 권한이 열려 있다';
  end if;
  raise notice '0372 self-check ok';
end $$;
