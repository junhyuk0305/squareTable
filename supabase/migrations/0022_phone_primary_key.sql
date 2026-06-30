-- 0022_phone_primary_key.sql — 전화번호를 "사람 단위 중복 차단" 주키로
-- 결정(2026-06-30): 사업자번호=선택(정보용), 전화번호=필수+전체저장+unique.
--   1) 정규화 후 unique — 형식(하이픈/+82)이 달라도 같은 번호로 인식.
--   2) ⚠️ SMS 인증 전까진 "soft 방어"(실수 중복가입·가벼운 계정양산만 차단).
--      문자 인증이 붙으면 동일 unique가 자동으로 hard 방어로 승격된다.
--   3) 충돌 UX는 클라에서 phone_in_use 사전검사로 "이미 가입된 번호" 안내.
-- 기존 행(phone=null)은 unique 대상에서 제외되어 영향 없음.

-- ── 한국 휴대폰 정규화: 숫자만 추출 + 국가코드(82)→0 ──
-- 순수 IMMUTABLE 함수(생성컬럼에서 사용). built-in만 호출하므로 search_path 불필요.
-- 클라(validation.ts normalizePhone)와 규칙 동일하게 유지할 것.
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when regexp_replace(p, '\D', '', 'g') like '82%'
      then '0' || substr(regexp_replace(p, '\D', '', 'g'), 3)
    else regexp_replace(p, '\D', '', 'g')
  end
$$;

-- ── 전체 전화번호 컬럼 + 정규화 생성컬럼 ──
alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists phone_norm text
    generated always as (public.normalize_phone(phone)) stored;

-- ── 정규화 기준 전역 unique(빈값/NULL 제외) ──
create unique index if not exists ux_profiles_phone_norm
  on public.profiles (phone_norm)
  where phone_norm is not null and phone_norm <> '';

-- ── 가입 트리거: 전체 phone 저장 + phone_last4 파생(기존 코드 호환) ──
-- 0010의 보안 불변식 유지(role=junior 고정, unit_id=null). phone 저장만 추가.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, unit_id, name, role, phone, phone_last4)
  values (
    new.id,
    null,                                                   -- 메타데이터 unit_id 무시(테넌트 주입 차단)
    coalesce(new.raw_user_meta_data->>'name',''),           -- 이름은 표시용이라 허용
    'junior',                                               -- 항상 junior로 시작(가입 시 권한상승 차단)
    nullif(new.raw_user_meta_data->>'phone',''),
    coalesce(                                               -- 호환: phone 끝 4자리로 파생(없으면 메타 폴백)
      right(public.normalize_phone(nullif(new.raw_user_meta_data->>'phone','')), 4),
      new.raw_user_meta_data->>'phone_last4'
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ── 사전검사 RPC: 번호 중복 여부(가입 전, 비로그인 호출 가능) ──
-- 보안: boolean만 반환(데이터 미노출). 전역 unique라 테넌트 무관 존재확인.
--   ⚠️ 열거(enumeration) 벡터지만 soft 방어 수준에서 수용(unique 제약이 최종 방어선).
create or replace function public.phone_in_use(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where phone_norm is not null
      and phone_norm = public.normalize_phone(p_phone)
  )
$$;

grant execute on function public.phone_in_use(text) to anon, authenticated;
