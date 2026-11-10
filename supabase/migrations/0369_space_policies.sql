-- 0369_space_policies.sql — 공간 부품 정책을 "현재 매장 또는 현재 공간"으로 넓힌다 + realtime 확인 (2026-11-10 · 공간·매장 통합 1번 덩이 9·10단계)
-- 옛 앱 호환: 안전 | 정책마다 매장 술어를 글자 그대로 두고 공간 갈래를 OR 로만 붙인다.
--   공간 갈래는 unit_id = auth_space_id() 일 때만 참이 될 수 있다. auth_space_id() 는 enter_space 로 기기 기록을 만든
--   세션에서만 값이 있다(0366 · 5-2). 옛 앱은 enter_space 를 모르므로 늘 null → 공간 갈래는 거짓 → 판정 = 지금 매장 술어.
--   표·칸·grant·publication 멤버십 무변경(realtime 은 이미 멤버인지 확인만 한다).
--
-- 정본: 산출물/공간매장통합_2026-11-10/데이터구조_A안_3판_2026-11-10.md 4장 · 5-2 · 8-2 · 부록 A-5 · 부록 C 9·10단계.
-- 앞선 파일: 0366(auth_space_id() · auth_can(unit, perm)) · 0368(질문 덧칸).
--
-- 매장 술어 보존 방식(정본 A-5 의 `unit_id in (매장, 공간)` 모양을 쓰지 않은 이유):
--   매장 술어에는 auth_can_manage()·auth_owns_unit(auth_unit_id()) 처럼 "현재 매장" 역할을 보는 조건이 붙어 있다.
--   unit_id 만 in (매장, 공간) 으로 넓히면 그 조건이 공간 행에도 걸린다 → 매장 매니저가 자기가 멤버인 공간의
--   노하우를 쓰고, 공간 멤버들의 질문을 읽는다(4장 함정). 그래서 모양을
--     alter policy … using ( <지금 매장 술어 그대로> or (unit_id = (select auth_space_id()) and <공간 조건>) )
--   로 했다. 공간 조건은 늘 그 자리 번호의 권한(auth_can)으로 본다. 공간 자리 = auth_space_id() 이므로
--   auth_can((select auth_space_id()), …) 은 행마다가 아니라 한 번만 계산된다(db-rls `(select …)` 래핑).
--   현재 매장에는 공간이 절대 안 담긴다(5-1 · 0363~0365 auth_member_unit_id 허용 목록) → 두 갈래가 같은 행에 겹치지 않는다.
--   alter policy 라 정책 이름·명령·대상 역할(TO)은 그대로다. 맨 아래 자가점검이 "옛 술어가 새 술어 안에 글자 그대로 있다"를 잰다.
--
-- 각 정책 베이스(최신 정의 · grep `create policy <이름>` / `drop policy` / `alter policy` 전수):
--   playbook_entries_read · playbook_entries_write  = 0248:72 · 0248:84 (0005→0019→0064→0093→0231→0248)
--   playbook_embeddings_select · playbook_embeddings_write = 0321:125 · 0321:127
--   cq_select · cq_insert · cq_update · cq_delete    = 0246:493-511 (alter policy · 0239:62-91 + archived_tenure_id)
--   uq_select · uq_insert · uq_update · uq_delete    = 0239:101-119
--   ai_usage_read                                    = 0062:78
--
-- 공간 조건(4장 권한표):
--   노하우 읽기 = 발행된 것은 'read', 초안까지는 'write_knowhow'(매장의 "발행 또는 관리자"와 같은 모양). 보관·본사 숨김 행은 안 보인다.
--   노하우 쓰기·색인 쓰기 = 'write_knowhow'(공간 주인). 색인 읽기 = 'read'.
--   질문 기록·답할 질문 읽기·고치기·지우기 = 질문자 본인 또는 'answer_direct'(공간 주인 · 결정 150 "멤버는 내 질문만").
--   질문 넣기 = 본인 행 + 'ask' + 'answer_direct' 아님. 공간에서 'answer_direct' 는 공간 주인만 가진다(4장) →
--     "공간 주인 본인의 질문은 저장하지 않는다"(8-2 · 결정 154)를 권한표 한 곳으로 판정한다.
--     unit_members 를 직접 보지 않는 이유: 정책 안 하위 조회는 um_select_same_unit(현재 매장만)에 걸려 공간 멤버 행이 안 보인다 → 주인도 통과해 버린다.
--   AI 사용량 읽기 = 'read'.
--   질문 넣기(cq_insert·uq_insert) 맨 바깥에 `and link_id is null`: 클라는 링크 번호를 못 단다(남의 답을 링크에 밀어 넣는 위조 차단).
--     링크 질문은 덩이 3 손님 함수(정의자 · RLS 를 안 탄다)만 넣는다. 옛 앱은 이 칸을 몰라 늘 비어 있다.
--
-- 바꾸지 않는 것: 사진 정책(덩이 2) · units_read/units_write · um_select_same_unit · profiles_read(공간은 전용 함수로 준다 · A-5).
--   account_access_allowed(0335 · RESTRICTIVE)는 그대로 AND 로 걸린다.
-- 되돌리기: 아래 alter policy 를 위 베이스 줄의 술어로 다시 alter 한다(공간 갈래만 빠진다).

-- 자가점검용: 바꾸기 전 술어를 잡아 둔다.
-- on commit drop 을 안 쓴다: 파일이 트랜잭션 밖에서 돌면 만든 즉시 지워진다. 자가점검 끝에서 지운다.
drop table if exists pg_temp._0369_before;
create temp table _0369_before as
  select tablename::text as t, policyname::text as p, coalesce(qual, '') as q, coalesce(with_check, '') as w
    from pg_policies
   where schemaname = 'public'
     and policyname in ('playbook_entries_read', 'playbook_entries_write',
                        'playbook_embeddings_select', 'playbook_embeddings_write',
                        'cq_select', 'cq_insert', 'cq_update', 'cq_delete',
                        'uq_select', 'uq_insert', 'uq_update', 'uq_delete',
                        'ai_usage_read');

-- ════════════════════════════════════════════════════════════════════════════
-- 노하우 (베이스 0248 S2 · 주석 그대로 유효)
--   `for all` 은 SELECT·DELETE 에도 붙는다 → 여기에도 같은 술어. with check 의 술어는 직접 UPDATE 로
--   archived_at 을 채우는 길(매니저 · 옛 앱)을 닫는다. 보관·되살리기는 archive_knowhow(정의자)만 한다.
-- ════════════════════════════════════════════════════════════════════════════
alter policy playbook_entries_read on public.playbook_entries
  using (
    (
      unit_id = (select public.auth_unit_id())
      and (status = 'published' or (select public.auth_can_manage()))
      -- ★0231: 숨긴 본사 사본은 소유주만(되살리기 목록). 매니저·직원은 0행.
      and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))
      -- ★0248: 보관(삭제)한 노하우는 아무도 읽지 않는다(2026-10-05 · 보관함 없음).
      and archived_at is null
    )
    -- ★0369: 현재 공간. 발행된 것은 멤버 누구나, 초안은 노하우를 쓰는 사람(공간 주인)만.
    or (
      unit_id = (select public.auth_space_id())
      and (
        (status = 'published' and (select public.auth_can((select public.auth_space_id()), 'read')))
        or (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))
      )
      and brand_hidden_at is null
      and archived_at is null
    )
  );

alter policy playbook_entries_write on public.playbook_entries
  using (
    (
      unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
      and archived_at is null                                                                          -- ★0248
    )
    or (                                                                                               -- ★0369
      unit_id = (select public.auth_space_id())
      and (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))
      and brand_hidden_at is null
      and archived_at is null
    )
  )
  with check (
    (
      unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
      and archived_at is null                                                                          -- ★0248
    )
    or (                                                                                               -- ★0369
      unit_id = (select public.auth_space_id())
      and (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))
      and brand_hidden_at is null
      and archived_at is null
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 검색 색인 (베이스 0321 §9: 읽기는 매장 · 쓰기는 관리자만)
-- ════════════════════════════════════════════════════════════════════════════
alter policy playbook_embeddings_select on public.playbook_embeddings
  using (
    unit_id = (select public.auth_unit_id())
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (select public.auth_can((select public.auth_space_id()), 'read')))
  );

alter policy playbook_embeddings_write on public.playbook_embeddings
  using (
    (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (select public.auth_can((select public.auth_space_id()), 'write_knowhow')))
  )
  with check (
    (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (select public.auth_can((select public.auth_space_id()), 'write_knowhow')))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 질문 기록 chat_queries (베이스 0246 · 0239 TO authenticated 그대로)
--   0239: 읽기·고치기·지우기 = 본인 또는 관리자. 넣기 = 본인 junior_id 만(stamp_author 가 호출자로 덮는다).
--   0246: 퇴사로 보관된 행(archived_tenure_id)은 안 보인다. 공간 멤버는 재직 기록을 안 쓰지만 같은 조건을 둔다.
-- ════════════════════════════════════════════════════════════════════════════
alter policy cq_select on public.chat_queries
  using (
    (unit_id = (select public.auth_unit_id())
     and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
     and archived_tenure_id is null)
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
        and archived_tenure_id is null)
  );

alter policy cq_insert on public.chat_queries
  with check (
    (
      (unit_id = (select public.auth_unit_id())
       and junior_id = (select auth.uid())::text
       and archived_tenure_id is null)
      -- ★0369: 공간 질문은 묻기 권한이 있고 공간 주인이 아닐 때만 저장한다(8-2 연습 질문은 저장하지 않는다).
      or (unit_id = (select public.auth_space_id())
          and junior_id = (select auth.uid())::text
          and archived_tenure_id is null
          and (select public.auth_can((select public.auth_space_id()), 'ask'))
          and not (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
    )
    -- ★0369: 클라 넣기는 링크 번호를 못 단다. 링크 질문은 덩이 3 손님 함수(정의자 · RLS 를 안 탄다)만 넣는다.
    --   옛 앱은 이 칸을 모르므로 늘 비어 있다 → 판정 그대로.
    and link_id is null
  );

alter policy cq_update on public.chat_queries
  using (
    (unit_id = (select public.auth_unit_id())
     and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
     and archived_tenure_id is null)
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
        and archived_tenure_id is null)
  )
  with check (
    (unit_id = (select public.auth_unit_id())
     and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
     and archived_tenure_id is null)
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
        and archived_tenure_id is null)
  );

alter policy cq_delete on public.chat_queries
  using (
    (unit_id = (select public.auth_unit_id())
     and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
     and archived_tenure_id is null)
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
        and archived_tenure_id is null)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 답할 질문 unknown_queries (베이스 0239 (2))
--   0239: 읽기·넣기·고치기는 매장 전원. 지우기만 본인 또는 관리자.
--   열 제한은 guard_unknown_query_write(0368 승계)가 한다(동료 답변이 직접 UPDATE 라서 정책으로는 열을 못 가른다).
--   ★0369 공간: 매장과 달리 멤버는 남의 질문을 못 본다(결정 150 · 사람별 건수 비공개를 구조로 막는다).
-- ════════════════════════════════════════════════════════════════════════════
alter policy uq_select on public.unknown_queries
  using (
    unit_id = (select public.auth_unit_id())
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct'))))
  );

alter policy uq_insert on public.unknown_queries
  with check (
    (
      unit_id = (select public.auth_unit_id())
      -- ★0369: 공간 질문은 묻기 권한이 있고 공간 주인이 아닐 때만(8-2). junior_id 는 stamp_author 가 호출자로 덮는다.
      or (unit_id = (select public.auth_space_id())
          and junior_id = (select auth.uid())::text
          and (select public.auth_can((select public.auth_space_id()), 'ask'))
          and not (select public.auth_can((select public.auth_space_id()), 'answer_direct')))
    )
    -- ★0369: 클라 넣기는 링크 번호를 못 단다(링크 위조 차단). 링크 질문은 덩이 3 손님 함수(정의자)만 넣는다.
    and link_id is null
  );

alter policy uq_update on public.unknown_queries
  using (
    unit_id = (select public.auth_unit_id())
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct'))))
  )
  with check (
    unit_id = (select public.auth_unit_id())
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct'))))
  );

alter policy uq_delete on public.unknown_queries
  using (
    (unit_id = (select public.auth_unit_id())
     and (junior_id = (select auth.uid())::text or (select public.auth_can_manage())))
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (junior_id = (select auth.uid())::text
             or (select public.auth_can((select public.auth_space_id()), 'answer_direct'))))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- AI 사용량 (베이스 0062: 읽기 = 내 매장 사용량만 · 쓰기 정책 없음 → 클라 조작 불가)
-- ════════════════════════════════════════════════════════════════════════════
alter policy ai_usage_read on public.ai_usage_monthly
  using (
    unit_id = (select public.auth_unit_id())
    or (unit_id = (select public.auth_space_id())                                                      -- ★0369
        and (select public.auth_can((select public.auth_space_id()), 'read')))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 10단계 realtime — 새 앱이 구독할 표 = supabase_realtime 멤버(AGENTS ⑤ · 옛 0347:652-657 모양)
--   unknown_queries · chat_queries 는 11-10 로컬 조회로 이미 멤버다. 빠졌으면 넣는다(멱등).
--   edu_links 는 새 앱 구독 계획이 정본에 없어 넣지 않는다. 구독마다 자리 번호 필터를 거는 것은 새 앱 몫이다(5-2).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['unknown_queries', 'chat_queries'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice '0369: % 을 supabase_realtime 에 넣었다', t;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검 — ① 13개 정책 전부 있음 ② 옛 매장 술어가 새 술어 안에 글자 그대로 ③ 공간 갈래가 붙음
--            ④ 공간 갈래에 매장 역할 함수가 안 섞임(대략: auth_space_id 뒤에 auth_can_manage 가 없다) ⑤ realtime
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  r record;
  v_q text;
  v_w text;
  v_tail text;
  v int;
begin
  select count(*) into v from _0369_before;
  if v <> 13 then v_bad := v_bad || '(바꾸기 전 정책 ' || v || '/13) '; end if;

  for r in select * from _0369_before loop
    select coalesce(qual, ''), coalesce(with_check, '') into v_q, v_w
      from pg_policies where schemaname = 'public' and tablename = r.t and policyname = r.p;
    if r.q <> '' and position(r.q in v_q) = 0 then v_bad := v_bad || '(' || r.p || ' using 매장 술어 바뀜) '; end if;
    if r.w <> '' and position(r.w in v_w) = 0 then v_bad := v_bad || '(' || r.p || ' with check 매장 술어 바뀜) '; end if;
    if (r.q <> '' and position('auth_space_id' in v_q) = 0) or (r.w <> '' and position('auth_space_id' in v_w) = 0) then
      v_bad := v_bad || '(' || r.p || ' 공간 갈래 없음) ';
    end if;
    -- 공간 갈래(술어마다 첫 auth_space_id 뒤 · 매장 갈래가 앞에 온다)에 현재 매장 역할 함수가 나오면 안 된다(4장 함정).
    foreach v_tail in array array[v_q, v_w] loop
      if position('auth_space_id' in v_tail) > 0
         and substr(v_tail, position('auth_space_id' in v_tail)) ~ 'auth_can_manage|auth_owns_unit|auth_is_owner' then
        v_bad := v_bad || '(' || r.p || ' 공간 갈래에 매장 역할 함수) ';
      end if;
    end loop;
  end loop;

  -- 클라 넣기 정책은 링크 번호를 막는다(링크 위조 차단).
  select count(*) into v from pg_policies
   where schemaname = 'public' and policyname in ('cq_insert', 'uq_insert')
     and with_check like '%(link_id IS NULL)%';
  if v <> 2 then v_bad := v_bad || '(넣기 정책 link_id is null ' || v || '/2) '; end if;

  foreach v_q in array array['unknown_queries', 'chat_queries'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_q) then
      v_bad := v_bad || '(' || v_q || ' realtime 아님) ';
    end if;
  end loop;

  if v_bad <> '' then raise exception '0369 자가점검 실패: %', v_bad; end if;
  raise notice '0369 자가점검 통과';
end $$;
drop table if exists pg_temp._0369_before;
