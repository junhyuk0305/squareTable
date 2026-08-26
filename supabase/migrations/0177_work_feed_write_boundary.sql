-- 0177 — work_feed 쓰기 경계 (감사 #30) · 본문 수정도 키 하나만 (감사 #31 의 나머지 절반)
--
-- ★선행조건: 0176 이 먼저다. 읽음·반응·고정·승격이 definer RPC 로 옮겨간 뒤에야 여기를 좁힐 수 있다.
--   순서를 바꾸면 "직원이 사장 공지를 읽음 처리"가 통째로 죽는다.
--
-- 정본 확인(AGENTS ⑧ — 최고 번호가 정본):
--   wf_insert : 0013 · 0015 · 0019 · **0093**  → 0093 을 베이스로 삼는다
--   wf_update : 0013 · 0015 · **0019**         → 0019 를 베이스로 삼는다
--   wf_delete : 0013 · 0015 · 0019 · **0093**  → 0093 을 베이스로 삼는다
--   (감사 문서 #30 의 "0019 정본, 이후 재정의 없음"은 오기다. 0093 이 insert·delete 만 다시 만들면서
--    update 를 빠뜨린 것이 결함의 정체다.)
--
-- 목표 상태(2026-08-26 사용자 확정):
--   · 공지는 **누구나** 쓴다 — 0093 의 `kind='notice' → auth_can_manage()` 를 푼다.
--     자기 메시지를 공지로 승격하는 것도 허용된다. (현장에서 알려야 할 일은 직원이 먼저 안다.)
--   · 수정은 **본인이 쓴 것만**. 사장도 예외 없다 — 남의 말을 고치는 건 지우는 것보다 위험하다.
--   · 삭제는 본인 것 + **사장·매니저**(모더레이션). 직원이 부적절한 공지를 올렸을 때
--     사장에게 지울 수단이 없으면 안 된다.
--
-- ★USING 에도 작성자 조건을 넣는 이유: WITH CHECK 에만 있으면 authorId 를 자기 id 로 바꿔 쓰는
--   UPDATE 가 통과한다(바뀐 행 기준으로만 보므로). 고치기 전에도 내 것이어야 한다.

-- ── 1) 본문 수정도 "그 키만" 바꾼다 ────────────────────────────────────────
-- 왜 여기 있나: 읽음을 jsonb_set 으로 옮겨도(0176), 본문 수정이 여전히 data 를 통째로 덮으면
--   **반대 방향으로** 같은 사고가 난다 — 사장이 공지를 고치는 순간, 그 사이 쌓인 읽음·반응이
--   사장 화면의 옛 스냅샷으로 사라진다. #31 은 양방향이다.
-- ★security **invoker** 다(0176 의 definer 들과 다르다). 권한 판정은 아래 wf_update 정책이 한다 —
--   "본인 것만 수정"이라는 규칙을 함수 안에 또 쓰면 규칙이 두 벌이 된다(AGENTS ②).
create or replace function public.edit_feed_text(p_feed_id text, p_text text)
returns boolean language plpgsql volatile security invoker set search_path = public as $$
declare v_n int;
begin
  if p_text is null then return false; end if;
  update public.work_feed set data = jsonb_set(data, '{text}', to_jsonb(p_text), true)
   where id = p_feed_id;
  get diagnostics v_n = row_count;
  return v_n > 0;   -- 0행 = RLS 차단(남의 글) 또는 대상 없음. 유령 성공 금지.
end $$;
revoke execute on function public.edit_feed_text(text, text) from public, anon, authenticated;
grant  execute on function public.edit_feed_text(text, text) to authenticated;

-- ── 2) 쓰기 경계 ───────────────────────────────────────────────────────────
-- 공지 작성 제한 해제(0093 의 마지막 줄을 뺀다). 나머지는 0093 그대로.
drop policy if exists wf_insert on public.work_feed;
create policy wf_insert on public.work_feed
  for insert with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
  );

-- 0019 에 작성자 조건을 더한다. 남의 행에 남기는 표시는 전부 0176 의 RPC 로 갔다.
drop policy if exists wf_update on public.work_feed;
create policy wf_update on public.work_feed
  for update using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and data->>'authorId' = (select auth.uid())::text
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and data->>'authorId' = (select auth.uid())::text
  );

-- 0093 은 공지만 막고 **남의 일반 메시지 삭제는 열어 뒀다**. 작성자 조건으로 닫고, 관리자 모더레이션을 남긴다.
drop policy if exists wf_delete on public.work_feed;
create policy wf_delete on public.work_feed
  for delete using (
    unit_id = (select public.auth_unit_id())
    and (room_id is null or public.can_see_room(room_id))
    and (data->>'authorId' = (select auth.uid())::text or (select public.auth_can_manage()))
  );

-- ── 3) 자가점검 — 개수가 아니라 **본문**으로 본다 ──────────────────────────
do $$
declare v_ins text; v_upd_u text; v_upd_c text; v_del text; v_bad text := '';
begin
  select pg_get_expr(polwithcheck, polrelid) into v_ins
    from pg_policy where polname = 'wf_insert' and polrelid = 'public.work_feed'::regclass;
  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) into v_upd_u, v_upd_c
    from pg_policy where polname = 'wf_update' and polrelid = 'public.work_feed'::regclass;
  select pg_get_expr(polqual, polrelid) into v_del
    from pg_policy where polname = 'wf_delete' and polrelid = 'public.work_feed'::regclass;

  -- 공지 제한이 실제로 풀렸는가
  if position('notice' in coalesce(v_ins, '')) > 0 then v_bad := v_bad || 'wf_insert(notice 제한 남음) '; end if;
  -- 수정이 작성자로 좁혀졌는가 — USING·WITH CHECK **둘 다**
  if position('authorId' in coalesce(v_upd_u, '')) = 0 then v_bad := v_bad || 'wf_update USING(authorId 없음) '; end if;
  if position('authorId' in coalesce(v_upd_c, '')) = 0 then v_bad := v_bad || 'wf_update WITH CHECK(authorId 없음) '; end if;
  -- 수정에는 관리자 예외가 **없어야** 한다(사용자 확정: 사장도 남의 글은 못 고친다)
  if position('auth_can_manage' in coalesce(v_upd_u, '') || coalesce(v_upd_c, '')) > 0 then
    v_bad := v_bad || 'wf_update(관리자 예외가 들어감) ';
  end if;
  -- 삭제는 작성자 + 관리자
  if position('authorId' in coalesce(v_del, '')) = 0 then v_bad := v_bad || 'wf_delete(authorId 없음) '; end if;
  if position('auth_can_manage' in coalesce(v_del, '')) = 0 then v_bad := v_bad || 'wf_delete(모더레이션 없음) '; end if;
  -- 본문 수정 함수는 키 하나만 바꿔야 한다
  if position('jsonb_set' in pg_get_functiondef('public.edit_feed_text(text, text)'::regprocedure)) = 0 then
    v_bad := v_bad || 'edit_feed_text(jsonb_set 없음) ';
  end if;
  if has_function_privilege('anon', 'public.edit_feed_text(text, text)'::regprocedure, 'execute') then
    v_bad := v_bad || 'edit_feed_text(anon 실행가능) ';
  end if;

  if v_bad <> '' then raise exception '0177 자가점검 실패: %', v_bad; end if;
end $$;
