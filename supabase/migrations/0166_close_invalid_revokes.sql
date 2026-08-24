-- 0166_close_invalid_revokes.sql — 아직 안 닫힌 무효 revoke 2건을 **실제로** 닫는다
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 0159 가 밝힌 함정을 퀴즈 밖 도메인까지 전수 조사한 결과다. Supabase 는 anon·authenticated 에
-- 함수 EXECUTE 를 **직접 부여**하므로 `revoke ... from public` 은 PUBLIC 의 몫만 회수하고
-- 직접 부여분을 건드리지 못한다 — 그래서 그 형태의 revoke 는 전부 무해한 no-op 이었다.
--
-- 마이그레이션 전체(163개)에서 함수 revoke 를 전수 확인했고, **아직 안 닫힌 것은 아래 2건뿐**이다.
-- 나머지는 구 시그니처가 drop 됐거나(0036·0062·0083·0116), 0084·0159·0161 이 이미 정정했거나,
-- 처음부터 `from public, anon, authenticated` 로 올바르게 썼다.
--
-- ── 실측(2026-08-24) ──────────────────────────────────────────────────────
-- anon 키로 직접 호출해 확인했다. 둘 다 **권한을 통과하고 본문까지 실행됐다**:
--   anon → quiz_link_resolve('xxx…')   → 행 반환(전 컬럼 null — 매칭 없음). 즉 실행됨.
--   anon → purge_deleted_accounts()    → **0 반환. 삭제 함수가 실제로 돌았다.**
--
-- ② purge_deleted_accounts() — 인증 없이 부를 수 있는 파괴적 삭제 (0035 → 0053 정본)
--   units 하드삭제(cascade) + auth.users 삭제 + ownerless units 백스톱을 소유자 권한으로 실행한다.
--   0035 주석이 스스로 "스케줄러/서비스롤 전용(authenticated grant 없음)"이라고 적어 뒀는데
--   실제로는 anon 이 부를 수 있었다. 지우는 대상 집합 자체는 크론이 매일 지우는 것과 같아서
--   즉시 데이터가 날아가지는 않지만, ⓐ인증 없이 무제한 반복 호출할 수 있고 ⓑ반환값이 파기 건수라
--   대기 중 삭제 계정 수가 새고 ⓒ이 함수에 인자가 하나라도 붙는 순간 anon 이 직결된다.
--   호출자는 0044 의 pg_cron 잡 하나뿐이고 cron 은 postgres 로 돈다 — 회수해도 안 깨진다.
--
-- ③ quiz_link_resolve(text) — 0113 이 "열지 않는다"고 명시한 문 (0113 정본, 이후 재정의 없음)
--   0113 주석 원문: "클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다."
--   유효 토큰 하나만 있으면(= 정상 게스트 전원) quiz_links 행 전체가 나온다:
--   **unit_id** · course_id · id · **created_by(사장 auth.users UUID)** · expires_at · created_at.
--   ★이게 0159 의 안전 근거를 무효화한다. 0159 는 "게스트는 문항 id 는 받지만 unit_id 는 받지
--     않는다"를 즉시 악용 불가의 근거로 삼았는데, 이 문으로 unit_id 를 받을 수 있었다.
--     지금은 0159 가 quiz_grade_item 을 닫아 그 연쇄가 끊겨 있지만, unit_id 를 인자로 받는 함수가
--     앞으로 하나라도 anon 에 열리면 그 순간 크로스테넌트로 승격된다.
--   확정 피해는 테넌트 식별자 + 사장 user UUID 유출이다(토큰 없이 남의 행을 훑을 수는 없다 —
--   본문이 `where token = p_token` 이라 임의 열람은 아니다).
--   호출자 5곳(quiz_link_open·quiz_link_items·quiz_link_grade·quiz_link_submit)이 **전부
--   security definer** 라 소유자 권한으로 안쪽 호출이 그대로 된다 — 0159 와 같은 근거다.
--   클라·엣지·스크립트에서 직접 부르는 코드는 grep 0건.
--
-- ⛔ 건드리지 않는 것: service_role 과 소유자(postgres). definer 실행과 크론·운영 도구가 이걸 쓴다.
-- ⛔ 같이 손대면 안 되는 것: quiz_link_open·quiz_link_items·quiz_link_grade·quiz_link_submit 은
--    **anon 부여가 설계다**(로그인 없이 도는 게스트 응시 경로). revoke 문구만 보고 무효 revoke 로
--    오해해서 닫으면 게스트 응시가 통째로 죽는다.


-- ════════════════════════════════════════════════════════════════════════
-- 1) 실제로 회수
-- ════════════════════════════════════════════════════════════════════════
revoke all on function public.purge_deleted_accounts() from public, anon, authenticated;
revoke all on function public.quiz_link_resolve(text)  from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 2) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다
-- ════════════════════════════════════════════════════════════════════════
-- ★이 블록이 없어서 0035·0113 의 revoke 가 몇 달간 no-op 인 걸 아무도 몰랐다.
--   앞으로 이 둘의 권한이 다시 열리면 마이그레이션이 여기서 멈춘다.
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.purge_deleted_accounts()',
    'public.quiz_link_resolve(text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '내부 전용 함수가 %에게 열려 있다: %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  -- 반대쪽 — 너무 조여서 정작 크론과 definer 래퍼가 못 돌면 계정 파기와 게스트 응시가 죽는다.
  foreach v_fn in array array[
    'public.purge_deleted_accounts()',
    'public.quiz_link_resolve(text)'
  ] loop
    if not has_function_privilege(
         (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn::regprocedure),
         v_fn, 'EXECUTE') then
      raise exception '%를 소유자마저 실행할 수 없다 — 너무 조였다', v_fn;
    end if;
  end loop;

  -- 게스트 응시 경로 4개는 **열려 있어야** 한다. 이걸 같이 닫는 실수가 가장 아프다.
  foreach v_fn in array array[
    'public.quiz_link_open(text)',
    'public.quiz_link_items(text, int)',
    'public.quiz_link_grade(text, text, jsonb)',
    'public.quiz_link_submit(text, text, text, boolean, jsonb)'
  ] loop
    if not has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '게스트 응시 경로가 닫혔다: % — 로그인 없이 도는 유일한 경로다', v_fn;
    end if;
  end loop;
end $$;
