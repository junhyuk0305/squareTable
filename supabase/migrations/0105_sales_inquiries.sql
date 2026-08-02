-- 0105_sales_inquiries.sql — 도입 문의(웹 영업 퍼널의 리드 캡처)
--
-- ── 배경(§① 증상 → 구조) ─────────────────────────────────────────────────────
-- 결제는 전부 웹에서 받는다(계좌이체·영업 계약). 다점포·프랜차이즈 본사처럼 표준 3티어에
--   안 담기는 도입은 "문의 → 상담 → 운영자가 요금제 지정" 경로가 정식인데, 그 앞단이
--   mailto 하나뿐이라 메일이 묻히면 리드가 시스템에 흔적 없이 사라진다(입금 신고 0083 과
--   같은 구조의 결함 — "문의라는 상태가 시스템에 존재하지 않는다").
--
-- ── 처방 ────────────────────────────────────────────────────────────────────
-- 도입 문의를 1급 행(sales_inquiries)으로 남긴다. 랜딩(welcome.html)의 비로그인 방문자도
--   남길 수 있어야 하므로 insert 는 anon 포함. 조회·상태 변경은 service_role(운영자) 전용 —
--   방문자 연락처가 클라이언트로 새어 나갈 경로 자체가 없다.
--
-- ── 격리/보안(db-rls 규칙) ───────────────────────────────────────────────────
-- select/update/delete 정책·권한을 주지 않는다 = 기본 deny. 클라 표면은 insert 한 줄.
-- user_id 는 위조 금지(본인 또는 null) — RLS WITH CHECK 로 봉함. 함수 호출은 (select …) 래핑.

-- ────────────────────────────────────────────────────────────────────────────
-- (1) 테이블
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.sales_inquiries (
  id         uuid        primary key default gen_random_uuid(),
  -- 로그인 상태로 문의했다면 계정 연결(선택). 계정이 지워져도 리드는 남긴다 → set null.
  user_id    uuid        references auth.users (id) on delete set null,
  name       text        not null check (char_length(btrim(name)) between 1 and 40),
  -- 형식 검증은 클라(isValidPhone)가 하고, 서버는 길이 캡만 — 해외/유선 번호를 막지 않는다.
  phone      text        not null check (char_length(btrim(phone)) between 8 and 20),
  company    text        check (company is null or char_length(company) <= 80),
  message    text        check (message is null or char_length(message) <= 1000),
  -- 운영자 처리 상태. 전이(new→done)는 service_role 로만 — 클라에 update 경로가 없다.
  status     text        not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);

-- 운영자 조회 기본 정렬(미처리 오래된 순 / 최근 문의 순).
create index if not exists sales_inquiries_status_created_idx
  on public.sales_inquiries (status, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- (2) RLS
-- ────────────────────────────────────────────────────────────────────────────
alter table public.sales_inquiries enable row level security;

-- insert: 비로그인(anon) 방문자 포함 누구나. 단 user_id 는 본인 것 또는 null 만(위조 봉쇄).
drop policy if exists sales_inquiries_insert on public.sales_inquiries;
create policy sales_inquiries_insert on public.sales_inquiries
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- select/update/delete 정책 없음 = deny. 목록은 운영자 콘솔(service_role)·SQL 로만 본다.

-- ────────────────────────────────────────────────────────────────────────────
-- (3) 권한 — 기본 GRANT ALL 을 걷어내고 insert 가능 컬럼만 연다
-- ────────────────────────────────────────────────────────────────────────────
-- 남용 방어: anon 열린 표면이라 id/status/created_at 은 컬럼 GRANT 에서도 뺀다(서버 default 만).
-- 대량 스팸은 길이 캡 + 운영자 정리로 대응하고, 실제 문제가 되면 그때 rate limit 을 단다.
revoke all on public.sales_inquiries from anon, authenticated;
grant insert (user_id, name, phone, company, message) on public.sales_inquiries to anon, authenticated;
