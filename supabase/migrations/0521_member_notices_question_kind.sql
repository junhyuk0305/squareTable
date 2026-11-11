-- 0521 알림 종류 question 을 member_notices CHECK 에 더한다(0401 공간 링크 질문 N2 → 공간 주인).
-- 왜 따로 있나: 원래 0401 안에 있었다. 0401 은 0460·0490 보다 번호가 낮아 db reset(파일 번호 순 재생)에서
--   0460·0490 의 종류 가드가 'question' 을 모르는 값으로 보고 멈춘다(그 가드는 의도대로 작동한 것이다).
--   그래서 종류 목록 변경만 최고 번호 뒤로 옮겼다. 0401 의 함수 본문이 'question' 행을 넣는 것은 실행 때라 순서와 무관하다.
-- 베이스 = 0490 목록 그대로 + 한 값. 라이브·로컬 어디서 다시 돌려도 같은 결과다(가드가 question 을 안다).
-- 되돌리기: 0490 목록으로 CHECK 를 다시 만든다(question 행이 있으면 먼저 지운다).

-- 가드: 다른 작업이 이 파일보다 먼저 값을 더했으면 멈춘다(0460·0490 과 같은 모양 · 조용히 지우지 않게).
do $$
declare v_def text; v_extra text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.conname = 'member_notices_kind_check';
  select string_agg(m[1], ',') into v_extra
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as t(m)
   where m[1] <> all(array['approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
                           'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
                           'join_request','join_approved','suggestion','question']);
  if v_extra is not null then raise exception '0521: 알림 종류에 이 파일이 모르는 값이 있다(먼저 올라간 작업): %', v_extra; end if;
end $$;
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
 'join_request','join_approved',
 'suggestion',
 'question'));   -- ★0401 공간 링크 질문(N2) → 공간 주인
