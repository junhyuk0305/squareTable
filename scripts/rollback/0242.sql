-- rollback/0242.sql — 0242 의 시리즈 트리거만 끈다. 원장(migration list)은 건드리지 않는다.
--
-- 언제 쓰나: 옛 앱의 근무 수정·삭제가 0242 트리거 때문에 실패할 때(예: 라이브에서만 나는 오류).
-- 무엇을 하나: trg_shift_series_guard · trg_shift_first_series 를 지운다. 그 뒤 옛 앱의 직접 쓰기는 0242 전처럼 행을 그대로 고친다
--   (지난 급여가 다시 바뀔 수 있다). 적용 기간 컬럼·백필·RPC·판정 함수는 그대로 둔다(백필은 지난 값을 바꾸지 않는 채우기다).
--
-- ⚠️ st_write(FOR ALL)는 되살리지 않는다. 계획 §3 의 롤백 문구는 "st_write 재생성"이지만, FOR ALL 은 SELECT 도 허용해서
--    관리자 옛 앱이 이미 만들어진 지난 구간 복사본(valid_to < 오늘)까지 읽는다. 옛 앱은 기간을 모르므로 그 요일에 근무가
--    두 번 잡히고 급여도 두 배가 된다. st_read 기간 필터와 st_insert/st_update/st_delete 는 그대로 둔다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0242.sql --linked

drop trigger if exists trg_shift_series_guard on public.shift_templates;
drop trigger if exists trg_shift_first_series on public.shift_templates;
