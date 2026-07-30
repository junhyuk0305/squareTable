-- 0087_phone_otps.sql — 전화번호 SMS 인증(솔라피) 저장소
--
-- 엣지 함수 otp(supabase/functions/otp) 전용 테이블. 클라이언트는 절대 직접 접근하지 않는다.
-- RLS 정책을 하나도 만들지 않는 것이 의도다(= anon/authenticated 전면 차단, service_role만 접근).
-- verified_at 이 남아 있는 행 = "이 번호는 한 번 인증됐다" — 서버 게이트(_hold/0088)가 이 행을 본다.
-- 행은 번호당 1개(주키)로 유지되고, 재발송 upsert 시 verified_at 은 덮어쓰지 않는다(엣지 함수 참조).

create table if not exists public.phone_otps (
  phone         text primary key,                              -- normalize_phone 형식(01012345678)
  code_hash     text not null,                                 -- sha256(phone||':'||code) hex — 평문 저장 금지
  expires_at    timestamptz not null,                          -- 발급 +3분
  attempts      int  not null default 0,                       -- 오답 5회면 코드 무효(재발송 필요)
  last_sent_at  timestamptz not null default now(),            -- 재발송 쿨다운 60초 기준
  sent_count    int  not null default 1,                       -- 일일 발송 캡(5건) 카운터
  sent_reset_at timestamptz not null default now() + interval '1 day',
  verified_at   timestamptz                                    -- 인증 성공 시각(영구 보존 — 게이트 판정 근거)
);

alter table public.phone_otps enable row level security;
-- 정책 0개 = deny-all(의도). 컬럼 GRANT 차단(0065 패턴)까지 겹으로 — SMS 코드 해시라도 새면 안 된다.
revoke all on table public.phone_otps from anon, authenticated;
