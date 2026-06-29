-- 0019_rls_perf_indexes.sql — RLS 성능 최적화 + 인덱스 보강 (첫 번째 최적화 패스)
--
-- 배경: 0001~0018 은 기능/보안만 쌓고 성능 최적화가 없었다. 사용자·매장·누적행이 늘면
--   ① 거의 모든 RLS 정책이 auth_unit_id()/auth_is_owner() 를 "행마다" 재평가하고,
--   ② RLS 핵심 경로(profiles.unit_id 등)에 인덱스가 없어 풀스캔이 난다.
--
-- 이 마이그레이션이 하는 일(동작·보안 의미는 100% 보존, 성능만 개선):
--   A) 모든 정책의 무인자 안정함수 호출을 스칼라 서브쿼리로 감싼다:
--        public.auth_unit_id()  → (select public.auth_unit_id())
--        public.auth_is_owner() → (select public.auth_is_owner())
--        auth.uid()             → (select auth.uid())
--      Postgres 는 (select f()) 를 statement 당 1회만 평가(initPlan)하고 그 결과를 캐시한다.
--      → 행당 재평가가 사라진다. Supabase 공식 권장 패턴(RLS performance).
--      ⚠️ 인자 있는 함수(can_see_room(room_id)/is_room_member(id)/room_in_my_unit(room_id))는
--         인자가 행마다 달라 캐시가 안 되므로 그대로 둔다(의미·구조 불변).
--   B) 누락 인덱스 추가: RLS 읽기 경로(profiles.unit_id), FK/조인 컬럼, 정렬 커버링.
--
-- 안전성: 정책 의미를 바꾸지 않는다(USING/WITH CHECK 술어 동일, for/to 절 동일).
--   (select f()) 래핑은 NULL 전파·결과값이 원식과 동일하다(예: id = (select auth_unit_id())
--   에서 함수가 NULL 이면 id = NULL → 행 제외, 원식과 같음). cso 보안 리뷰로 재검증한다.
--   모든 정책을 명시적으로 drop→create 하므로 0001~0018 의 "최종 상태"를 그대로 재현한다.

-- ════════════════════════════════════════════════════════════════════════
-- A. RLS 정책 재정의 (무인자 안정함수 호출 → 스칼라 서브쿼리)
-- ════════════════════════════════════════════════════════════════════════

-- ── units (0001) ────────────────────────────────────────────
drop policy if exists units_read on public.units;
create policy units_read on public.units
  for select using (id = (select public.auth_unit_id()));
drop policy if exists units_write on public.units;
create policy units_write on public.units
  for update using (id = (select public.auth_unit_id()) and owner_id = (select auth.uid()));

-- ── profiles (0001 read + 0007 update) ─────────────────────
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (unit_id = (select public.auth_unit_id()) or id = (select auth.uid()));
-- 0007: 본인 행만, role/unit_id 자기변경 금지(권한상승·테넌트탈취 차단). 내부 서브쿼리는 그대로.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
    and unit_id is not distinct from (select p.unit_id from public.profiles p where p.id = (select auth.uid()))
  );

-- ── playbook_entries (0005: 읽기=매장 전원 / 쓰기=사장) ──────
drop policy if exists playbook_entries_read on public.playbook_entries;
create policy playbook_entries_read on public.playbook_entries
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists playbook_entries_write on public.playbook_entries;
create policy playbook_entries_write on public.playbook_entries
  for all
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── unknown_queries (0001: 매장 단위 for all) ───────────────
drop policy if exists unknown_queries_rw on public.unknown_queries;
create policy unknown_queries_rw on public.unknown_queries
  for all
  using      (unit_id = (select public.auth_unit_id()))
  with check (unit_id = (select public.auth_unit_id()));

-- ── chat_queries (0001: 매장 단위 for all) ──────────────────
drop policy if exists chat_queries_rw on public.chat_queries;
create policy chat_queries_rw on public.chat_queries
  for all
  using      (unit_id = (select public.auth_unit_id()))
  with check (unit_id = (select public.auth_unit_id()));

-- ── playbook_embeddings (0012: 매장 단위 for all) ───────────
drop policy if exists playbook_embeddings_rw on public.playbook_embeddings;
create policy playbook_embeddings_rw on public.playbook_embeddings
  for all
  using      (unit_id = (select public.auth_unit_id()))
  with check (unit_id = (select public.auth_unit_id()));

-- ── playbook_suggestions (0014) ─────────────────────────────
drop policy if exists ps_select on public.playbook_suggestions;
create policy ps_select on public.playbook_suggestions
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or proposer_id = (select auth.uid()))
  );
drop policy if exists ps_insert on public.playbook_suggestions;
create policy ps_insert on public.playbook_suggestions
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and proposer_id = (select auth.uid())
  );
drop policy if exists ps_update on public.playbook_suggestions;
create policy ps_update on public.playbook_suggestions
  for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
            with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));
drop policy if exists ps_delete on public.playbook_suggestions;
create policy ps_delete on public.playbook_suggestions
  for delete using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or proposer_id = (select auth.uid()))
  );

-- ── work_templates (0017 select + 0015 ins/upd/del) ─────────
-- can_see_room(room_id) 는 인자 의존 → 래핑 안 함(의미 보존).
drop policy if exists wt_select_scope on public.work_templates;
create policy wt_select_scope on public.work_templates
  for select using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (
      coalesce(scope, 'shared') = 'shared'
      or owner_id = (select auth.uid())
      or created_by = (select auth.uid())
      or (created_by is null and (select public.auth_is_owner()))
    )
  );
drop policy if exists wt_insert on public.work_templates;
create policy wt_insert on public.work_templates
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );
drop policy if exists wt_update on public.work_templates;
create policy wt_update on public.work_templates
  for update using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );
drop policy if exists wt_delete on public.work_templates;
create policy wt_delete on public.work_templates
  for delete using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );

-- ── work_done (0015: 방 가시성 for all) ─────────────────────
drop policy if exists work_done_rw on public.work_done;
create policy work_done_rw on public.work_done
  for all
  using      (unit_id = (select public.auth_unit_id()) and (room_id is null or public.can_see_room(room_id)))
  with check (unit_id = (select public.auth_unit_id()) and (room_id is null or public.can_see_room(room_id)));

-- ── work_feed (0015 최종: 방 가시성 + 공지 사장전용) ─────────
drop policy if exists wf_select on public.work_feed;
create policy wf_select on public.work_feed
  for select using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );
drop policy if exists wf_insert on public.work_feed;
create policy wf_insert on public.work_feed
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (coalesce(data->>'kind', '') <> 'notice' or (select public.auth_is_owner()))
  );
drop policy if exists wf_update on public.work_feed;
create policy wf_update on public.work_feed
  for update using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );
drop policy if exists wf_delete on public.work_feed;
create policy wf_delete on public.work_feed
  for delete using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (coalesce(data->>'kind', '') <> 'notice' or (select public.auth_is_owner()))
  );

-- ── attendance (0007: 읽기=매장 / 쓰기=사장 or 본인기록) ─────
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or staff_id = (select auth.uid())::text)
  );
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update
  using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or staff_id = (select auth.uid())::text)
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or staff_id = (select auth.uid())::text)
  );
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or staff_id = (select auth.uid())::text)
  );

-- ── wages (0007: 읽기=매장 / 쓰기=사장) ─────────────────────
drop policy if exists wages_read on public.wages;
create policy wages_read on public.wages
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists wages_write on public.wages;
create policy wages_write on public.wages
  for all
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── work_rooms (0018 select + 0015 ins/upd/del) ─────────────
-- is_room_member(id) 는 인자 의존 → 래핑 안 함.
drop policy if exists wr_select on public.work_rooms;
create policy wr_select on public.work_rooms
  for select using (
    unit_id = (select public.auth_unit_id())
    and (is_default or (select public.auth_is_owner()) or public.is_room_member(id))
  );
drop policy if exists wr_insert on public.work_rooms;
create policy wr_insert on public.work_rooms
  for insert with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));
drop policy if exists wr_update on public.work_rooms;
create policy wr_update on public.work_rooms
  for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
            with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));
drop policy if exists wr_delete on public.work_rooms;
create policy wr_delete on public.work_rooms
  for delete using (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()) and not is_default);

-- ── work_room_members (0018) ────────────────────────────────
-- room_in_my_unit(room_id) 는 인자 의존 → 래핑 안 함.
drop policy if exists wrm_select on public.work_room_members;
create policy wrm_select on public.work_room_members
  for select using (
    user_id = (select auth.uid())
    or ((select public.auth_is_owner()) and public.room_in_my_unit(room_id))
  );
drop policy if exists wrm_write on public.work_room_members;
create policy wrm_write on public.work_room_members
  for all
  using      ((select public.auth_is_owner()) and public.room_in_my_unit(room_id))
  with check ((select public.auth_is_owner()) and public.room_in_my_unit(room_id));

-- ── schedule_config (0016: 읽기=매장 / 쓰기=사장) ───────────
drop policy if exists sc_read on public.schedule_config;
create policy sc_read on public.schedule_config
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists sc_write on public.schedule_config;
create policy sc_write on public.schedule_config
  for all using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
          with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── shift_templates (0016: 읽기=매장 / 쓰기=사장) ───────────
drop policy if exists st_read on public.shift_templates;
create policy st_read on public.shift_templates
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists st_write on public.shift_templates;
create policy st_write on public.shift_templates
  for all using      (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()))
          with check (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── swap_requests (0016) ────────────────────────────────────
drop policy if exists swap_read on public.swap_requests;
create policy swap_read on public.swap_requests
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists swap_insert on public.swap_requests;
create policy swap_insert on public.swap_requests
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and requester_id = (select auth.uid())::text
  );
drop policy if exists swap_update on public.swap_requests;
create policy swap_update on public.swap_requests
  for update
  using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or requester_id = (select auth.uid())::text or accepted_by is null)
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_is_owner()) or status in ('open','accepted','cancelled'))
  );

-- ── storage.objects: 사진 버킷 (0008) ──────────────────────
-- read 정책(photos_public_read)은 함수 호출이 없어 변경 불요. insert/update/delete 만 재정의.
drop policy if exists photos_auth_upload on storage.objects;
create policy photos_auth_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'playbook-photos'
    and (storage.foldername(name))[1] = (select public.auth_unit_id())
    and public.is_allowed_photo_ext(name)
  );
drop policy if exists photos_owner_update on storage.objects;
create policy photos_owner_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()))
  with check (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()));
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()));

-- ════════════════════════════════════════════════════════════════════════
-- B. 인덱스 보강
-- ════════════════════════════════════════════════════════════════════════

-- (B-1) RLS 읽기 핵심 경로 — profiles_read 가 unit_id 로 동료를 거르는데 인덱스가 없었다.
--   auth_unit_id() 자체도 profiles(id=PK) 조회라 OK 지만, profiles_read/fetchStaffProfiles 는
--   unit_id 필터라 매번 풀스캔이었다.
create index if not exists idx_profiles_unit on public.profiles(unit_id);

-- (B-2) FK/조인 컬럼 — 인덱스 없으면 조인·cascade 삭제가 느리다.
create index if not exists idx_swap_template        on public.swap_requests(template_id);
create index if not exists idx_swap_target_template on public.swap_requests(target_template_id);
create index if not exists idx_wd_template          on public.work_done(template_id);

-- (B-3) 정렬 커버링 — fetch* 가 (RLS unit 필터 + order) 로 읽는다. 복합 인덱스로 정렬까지 커버.
--   기존 단일/부분 인덱스를 prefix 로 포함하므로 그 인덱스는 drop 해 용량을 아낀다.
--   playbook_entries: order created_at desc  (기존 idx_pb_unit(unit_id) 포함)
create index if not exists idx_pb_unit_created on public.playbook_entries(unit_id, created_at desc);
drop index if exists public.idx_pb_unit;
--   chat_queries: junior 별 + asked_at 정렬  (기존 idx_cq_unit(unit_id,junior_id) 포함)
create index if not exists idx_cq_unit_junior_asked on public.chat_queries(unit_id, junior_id, asked_at);
drop index if exists public.idx_cq_unit;
--   swap_requests: order created_at desc  (status 인덱스는 swap_read 외 용도라 유지)
create index if not exists idx_swap_unit_created on public.swap_requests(unit_id, created_at desc);
--   unknown_queries: order asked_at desc  (status 인덱스 idx_uq_unit_status 는 유지 — 상태필터 별도용도)
create index if not exists idx_uq_unit_asked on public.unknown_queries(unit_id, asked_at desc);

-- 끝. 적용 후 cso 보안 리뷰로 테넌트 격리 유지를 재검증한다.
