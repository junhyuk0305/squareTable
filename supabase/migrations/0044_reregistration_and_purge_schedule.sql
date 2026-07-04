-- 0044_reregistration_and_purge_schedule.sql — 탈퇴자 재가입 영구차단 해소 + purge 스케줄 (리포트 P1-4)
--
-- 문제 1(재가입 영구차단): delete_my_account(0035)는 deleted_at 만 세팅하고 phone 은 그대로 둔다.
--   그런데 phone_norm 은 phone 에서 생성되는 컬럼이고 ux_profiles_phone_norm unique 인덱스에 남아 있어,
--   탈퇴자가 같은 번호로 재가입하면 handle_new_user 의 INSERT 가 unique 위반으로 죽는다(또는 phone_in_use
--   사전검사가 'taken' 을 돌려 클라가 막는다). 번호 주인이 이미 탈퇴했는데도 영구 차단.
--   → 소프트삭제 시 phone 을 null 로 해제(생성컬럼 phone_norm 도 null 이 되어 unique 에서 빠진다).
--     + phone_in_use 는 소프트삭제 행을 애초에 제외(방어 이중화).
--   (탈퇴 계정은 어차피 30일 뒤 purge 로 파기되므로 번호 보존 이득이 없다. 재가입 가능성이 우선.)
--
-- 문제 2(purge 미실행): purge_deleted_accounts(0035)·purge_expired_former_staff(0026)를 호출하는
--   스케줄이 저장소·인프라 어디에도 없어 소프트삭제 계정이 영구 잔류(PIPA "30일 후 파기" 미이행) +
--   위 재가입 차단이 실제로는 30일이 아니라 무기한이었다.
--   → pg_cron 이 있으면 일 1회 service_role 로 자동 실행 예약. (Supabase: Database → Extensions 에서
--     pg_cron 활성화 필요. 미활성 시 이 블록은 조용히 건너뛰고, 외부 크론/Edge 스케줄로 대체 가능.)
--
-- ⚠️ 가입/합류 인접 함수(delete_my_account) 재정의 — 적용 후 반드시 `npm run qa:onboarding` green 확인(AGENTS.md).
--    이 파일이 delete_my_account 의 최종 정본이다(0035 본문 + phone 해제 1줄).

-- ── 1) 소프트삭제 시 전화번호 해제 (재가입 가능) ─────────────────────────────
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 사장이면 소유 매장도 소프트삭제 표시(유예 후 purge가 cascade 파기).
  update public.units    set deleted_at = now() where owner_id = v_uid and deleted_at is null;
  -- 본인 프로필 소프트삭제 + 소속/신청 해제 + 전화번호 해제(phone=null → phone_norm=null → unique 에서 빠짐).
  --   phone_last4(0022 파생 일반컬럼)도 null 로 — 재가입/격리엔 무관하나 잔류 부분 PII 를 즉시 제거(위생).
  update public.profiles
     set deleted_at = now(), unit_id = null, pending_unit_id = null, phone = null, phone_last4 = null
   where id = v_uid;
end $$;

grant execute on function public.delete_my_account() to authenticated;

-- ── 2) 번호 중복 사전검사에서 소프트삭제 행 제외(방어 이중화) ────────────────
create or replace function public.phone_in_use(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where phone_norm is not null
      and deleted_at is null                       -- 탈퇴(소프트삭제) 계정 번호는 재가입 가능하게 제외
      and phone_norm = public.normalize_phone(p_phone)
  )
$$;

grant execute on function public.phone_in_use(text) to anon, authenticated;

-- ── 3) 유예(30일) 경과 소프트삭제 계정 자동 파기 스케줄(pg_cron 있을 때만) ────
-- ⚠️ purge_deleted_accounts 만 예약한다 — 이것만 service_role 전역 함수다.
--    purge_old_records(0027)·purge_expired_former_staff(0026)는 auth.uid()/사장·매장 한정이라
--    무인증 크론에서 동작하지 않는다(앱이 사장 진입 시 기회적으로 호출하는 구조 그대로 유지).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-deleted-accounts', '0 19 * * *',  -- 매일 04:00 KST
      $sql$ select public.purge_deleted_accounts(); $sql$);
  else
    raise notice 'pg_cron 미설치 — purge 스케줄을 건너뜀. Database→Extensions 에서 pg_cron 활성화 후 재적용하거나 외부 크론/Edge 스케줄로 purge_deleted_accounts() 를 일 1회 호출할 것.';
  end if;
end $$;
