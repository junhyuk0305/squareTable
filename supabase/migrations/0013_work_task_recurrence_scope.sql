-- 업무 탭 고도화: 할일 모델 확장(반복요일·공유범위·기타 직접라벨) + 공지 댓글/멘션
-- 기획: 업무탭_고도화_기획_v1.md
--
-- work_templates:
--   recurrence  jsonb  → { "weekly": [0..6] } (요일 반복) | "once" (일회성). NULL=레거시(매일 루틴)
--   date        text   → 'once'일 때 예정일 'YYYY-MM-DD' (기존 due_date를 대체, due_date는 호환 유지)
--   scope       text   → 'shared'(가게 전체) | 'private'(나만 보기). 기본 'shared'
--   owner_id    uuid   → private 작성자(본인+사장만 조회)
--   section_note text  → section='etc'일 때 직접 입력 라벨
alter table public.work_templates
  add column if not exists recurrence   jsonb,
  add column if not exists date         text,
  add column if not exists scope        text not null default 'shared',
  add column if not exists owner_id      uuid references auth.users(id) on delete set null,
  add column if not exists section_note  text;

create index if not exists idx_wt_unit_date  on public.work_templates(unit_id, date);
create index if not exists idx_wt_unit_scope on public.work_templates(unit_id, scope);

-- 기존 due_date(레거시)를 date로 복사(있을 때만). 이후 코드는 date를 우선 사용.
update public.work_templates set date = due_date where date is null and due_date is not null;

-- RLS: private 할일은 작성자 + 사장만 조회.
-- ⚠️ 0004 의 work_templates_rw 는 `for all`(SELECT 포함) 이라 그대로 두면
--    permissive 정책이 OR 로 결합되어 private SELECT 제한이 무력화된다.
--    → _rw 를 드롭하고 SELECT 는 scope 제한 정책으로, 쓰기는 명령별 정책으로 분리한다.
-- 0001/0005/0007 의 auth_unit_id() / auth_is_owner() 헬퍼를 재사용한다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    -- 기존 통합 정책 제거(SELECT 누수 차단의 핵심)
    drop policy if exists work_templates_rw on public.work_templates;

    -- SELECT: 같은 매장 + (shared 이거나 본인 private 이거나 사장)
    drop policy if exists wt_select_scope on public.work_templates;
    create policy wt_select_scope on public.work_templates
      for select using (
        unit_id = public.auth_unit_id()
        and (
          coalesce(scope, 'shared') = 'shared'
          or owner_id = auth.uid()
          or public.auth_is_owner()
        )
      );

    -- INSERT/UPDATE/DELETE: 같은 매장(기존 _rw 쓰기 동작 유지). SELECT 만 위에서 제한.
    drop policy if exists wt_insert on public.work_templates;
    create policy wt_insert on public.work_templates
      for insert with check (unit_id = public.auth_unit_id());
    drop policy if exists wt_update on public.work_templates;
    create policy wt_update on public.work_templates
      for update using (unit_id = public.auth_unit_id())
                with check (unit_id = public.auth_unit_id());
    drop policy if exists wt_delete on public.work_templates;
    create policy wt_delete on public.work_templates
      for delete using (unit_id = public.auth_unit_id());
  end if;
end $$;

-- work_feed RLS: 알바는 '공지(notice)' 작성/삭제 불가(사장 전용). 메시지/댓글/완료알림은 공통.
-- ⚠️ 0004 의 work_feed_rw(for all) 도 동일하게 OR 결합되므로 드롭하고 명령별로 분리.
--   - SELECT/UPDATE 는 매장 단위 유지(UPDATE 는 알바의 공지 반응·읽음추적이 같은 row.data 를
--     갱신하므로 notice 라고 막으면 안 됨).
--   - INSERT/DELETE 만 notice 일 때 사장으로 제한.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists work_feed_rw on public.work_feed;

    drop policy if exists wf_select on public.work_feed;
    create policy wf_select on public.work_feed
      for select using (unit_id = public.auth_unit_id());

    drop policy if exists wf_update on public.work_feed;
    create policy wf_update on public.work_feed
      for update using (unit_id = public.auth_unit_id())
                with check (unit_id = public.auth_unit_id());

    drop policy if exists wf_insert on public.work_feed;
    create policy wf_insert on public.work_feed
      for insert with check (
        unit_id = public.auth_unit_id()
        and (coalesce(data->>'kind', '') <> 'notice' or public.auth_is_owner())
      );

    drop policy if exists wf_delete on public.work_feed;
    create policy wf_delete on public.work_feed
      for delete using (
        unit_id = public.auth_unit_id()
        and (coalesce(data->>'kind', '') <> 'notice' or public.auth_is_owner())
      );
  end if;
end $$;

-- work_feed: 공지 댓글(kind='comment', data.refId=공지ID) + @멘션은 data.mentions[]로 들어가므로
-- 별도 컬럼 불요(현 스키마가 row.data JSONB에 FeedItem 전체를 저장). 검색/알림용 보조 컬럼만 옵션 추가.
alter table public.work_feed
  add column if not exists mentions text[];

-- (선택) 멘션 알림용 인덱스 — 추후 인앱 알림 파이프라인에서 사용.
create index if not exists idx_wf_mentions on public.work_feed using gin (mentions);
