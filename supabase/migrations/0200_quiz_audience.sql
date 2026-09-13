-- 0200_quiz_audience.sql — 퀴즈가 **누구에게 나가는 것인가**를 저장한다
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 만들기 1단계는 이미 '우리 직원 / 외부 사람'을 묻는다(quiz-new `audience` 상태). 그런데 그 답이
-- **어디에도 저장되지 않았다** — 발행 시 분기에만 쓰고 버렸다. 그래서 나중에 퀴즈를 열면
-- 화면은 그 퀴즈가 내부용인지 외부용인지 알 방법이 없고, 배포 탭은 늘 '링크'만 보여줬다.
-- 사장 요청(2026-09-13): 설정 탭의 배포 섹션은 **내부면 사람 고르기만, 외부면 링크만** 보여준다.
-- 그 분기의 근거가 이 컬럼이다.
--
-- ── 백필 ────────────────────────────────────────────────────────────────────────────────
-- 이미 있는 퀴즈는 흔적으로 판정한다. 흔적이 둘 다 있으면(링크도 있고 발송도 있음) 'staff' 로 둔다 —
-- 내부 발송이 더 강한 신호이고, 외부 링크는 그 위에 덧붙였을 수 있다.
-- 흔적이 없으면(만들던 퀴즈) null 로 남긴다 — **지어내지 않는다**. 화면은 null 을 "아직 안 정했다"로
-- 읽고 설정 탭에서 고르게 한다.

alter table public.training_courses
  add column if not exists audience text
    check (audience is null or audience in ('staff', 'guest'));

comment on column public.training_courses.audience is
  '누구에게 나가는 퀴즈인가 — staff=우리 직원(발송 원장) · guest=외부 사람(링크). null=아직 안 정함';

update public.training_courses c
   set audience = 'staff'
 where c.audience is null
   and exists (select 1 from public.quiz_assignments a where a.course_id = c.id);

update public.training_courses c
   set audience = 'guest'
 where c.audience is null
   and exists (select 1 from public.quiz_links l where l.course_id = c.id);

-- RLS 변경 없음 — training_courses 의 tc_* 정책(0108)이 그대로 적용된다(읽기=매장 전원, 쓰기=관리 권한).
-- 적용 후 확인: 기존 퀴즈의 audience 가 링크/발송 흔적과 맞는지, 만들던 퀴즈는 null 인지.
