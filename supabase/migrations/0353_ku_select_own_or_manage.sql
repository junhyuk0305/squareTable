-- 0353_ku_select_own_or_manage.sql — 이해 확인 기록(knowhow_understanding) 읽기 = 본인 행 또는 관리자 (2026-11-05 · M1 (2))
-- 계획 = 산출물/업계표준대비_2026-11-04/계획_M1_누적표윈도.md §1 (2) · §3 · 사용자 결정 M1-4
--
-- 옛 앱 호환: 안전 | 옛 클라의 `.from('knowhow_understanding')` 호출은 db.ts:2256(fetchKnowhowUnderstandingResult) 하나다.
--   · 직원 소비처는 전부 본인 행만 쓴다 — WorkBoard.tsx:427·441·474(understandsTask·myRow = staff_id 본인) · JuniorMySpace.tsx:115(`u.staffId !== me` 건너뜀).
--     행이 줄어도 화면이 같다.
--   · 사장·매니저(useQuizBoard 히트맵·TrainingInsights)는 auth_can_manage() 로 전량 그대로.
--   · definer RPC(my_training_history·owner_knowhow_stats·브랜드 RPC)는 RLS 를 타지 않아 무관.
--   · realtime 구독(db.ts:3809)은 직원이 남의 행 이벤트를 못 받게 될 뿐이다. 직원 화면은 남의 행을 쓰지 않는다.
--   · 쓰기 정책(ku_insert·ku_update·ku_delete)은 손대지 않는다. 옛 앱의 upsert(본인 행)는 그대로 된다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   0111 의 ku_select 는 `unit_id = auth_unit_id()` 뿐이라 같은 매장 직원이 동료 전원의 통과 기록(누가 무엇을 언제 통과했나)을 읽을 수 있었다.
--   "직원은 본인 행 · 관리자는 전량"은 chat_queries(cq_select · 0239)·quiz_assignments(qz_select · 0139)에 이미 있는 규칙이다. 이 표만 빠져 있었다.
--
-- 고친 것
--   ku_select 하나만 교체. 술어 = cq_select(0239:62) 와 같은 모양 — `unit_id = (select auth_unit_id()) and (staff_id = (select auth.uid()) or (select auth_can_manage()))`.
--   좌석 잠긴 매니저 = auth_can_manage()(0315) 가 false 라 본인 행만. qz_select·cq_select 와 같은 동작(M1-4 사용자 결정).
--   보안 변경만이다. 성능(인덱스·래핑 방식)은 바꾸지 않는다.
--
-- 정책 담당표(최고 번호 = 정본 · AGENTS ⑧): ku_select 0111 → 0353 · ku_insert/ku_update 0111 · ku_delete(별도 파일) 그대로.
-- 롤백: drop policy ku_select → 0111:111 의 `for select using (unit_id = (select public.auth_unit_id()))` 재생성.

drop policy if exists ku_select on public.knowhow_understanding;
create policy ku_select on public.knowhow_understanding
  for select to authenticated
  using (
    unit_id = (select public.auth_unit_id())
    and (staff_id = (select auth.uid()) or (select public.auth_can_manage()))
  );

-- 자가점검: 정책이 있고, 술어에 본인 행 조건과 관리자 조건이 둘 다 들어 있다.
do $$
declare
  v_qual text;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'knowhow_understanding' and policyname = 'ku_select' and cmd = 'SELECT';
  if v_qual is null then
    raise exception '0353 self-check: ku_select 정책이 없다';
  end if;
  if position('auth_can_manage' in v_qual) = 0 or position('staff_id' in v_qual) = 0 or position('auth_unit_id' in v_qual) = 0 then
    raise exception '0353 self-check: ku_select 술어가 기대와 다르다 — %', v_qual;
  end if;
end $$;
