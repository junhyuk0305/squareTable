-- 0358_store_soft_delete.sql — 매장 삭제 = 소프트 삭제 + 지운 매장으로 새는 곳 5개 막기 (W5 묶음 1 · 2026-11-10)
--
-- 정본: 산출물/매장측_후속작업_2026-11-03/설계_W5_보관규칙_시프티방식_2026-11-10.md(1·2·3장) ·
--       조사_W5-0_매장소프트삭제_2026-11-10.md(새는 곳 5개).
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   예전: delete_store 가 units 행을 바로 지웠다(cascade 로 매장 기록 전부 즉시 삭제).
--   지금: deleted_at 을 찍고 멤버십(사장 1행)을 끊는다. 매장 기록은 남는다. 30일 뒤 파기는 0361 이 한다.
--     · 사용자 쪽에서는 끝이다(되살리기 없음 · 11-10 사용자 결정). reopen_store 도 지운 매장은 거부한다.
--     · 옛 cascade 가 함께 지우던 "계정 상태" 행(구독·남길 매장 선택·좌석 보관·잠금 기록·알림 대기)은 지금처럼 바로 지운다.
--       남겨 두면 unit_access_locked·슬롯 계산이 지운 매장을 계속 본다(owner_kept_unit 이 지운 매장을 가리키면
--       남은 무료 매장이 전부 잠긴다).
--     · 초대 코드·사업자번호를 비운다. 같은 번호로 새 매장을 다시 만들 수 있어야 한다(예전엔 행이 바로 사라졌다).
--   새는 곳 5개(W5-0 표):
--     ① quiz_course_live(0332) — 매장이 지워졌으면 false. 게스트 링크 resolve·items·grade·submit 과 예약 발송이
--        모두 quiz_course_servable → quiz_course_live 를 지나므로 한 곳에서 막힌다(복제 금지 · 0332 SSOT).
--     ② auth_owns_unit(0215) — 지운 매장은 false. 사진 storage 정책·copy_knowhow_between·브랜드 RPC 가 한 번에 막힌다.
--     ③ auth_unit_id(0303) — 활성 매장이 지운 매장이면 null. profiles.unit_id 폴백이 지운 매장을 가리켜도 RLS 112개가 닫힌다.
--     ④ unit_access_locked(0196) — 지운 매장은 맨 먼저 true(fail-open 앞에서). due_task_reminders 가 거른다.
--     ⑤ delete_store_preview(0235) — 지운 매장은 not_owner.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   delete_store 의 오류 코드(not_owner·last_store·brand_locked·brand_linked·store_has_staff)·반환형·권한.
--   사장 탈퇴(delete_my_account)는 지금처럼 deleted_at 만 찍는다(멤버십 보존 · 0335).
--
-- 옛 앱 호환: 안전 | 옛 클라 useSessionStore.deleteStore 는 rpc('delete_store') 의 같은 반환·오류 코드를 쓴다. 지운 뒤
--   my_units(멤버십 join)에서 사라지는 것도 같다. 옛 앱 확인창 "영구 삭제돼요"(storeCopy.ts:62)는 사용자 쪽에서는 맞다
--   (되살리기 없음). 함수 이름·인자·반환형 전부 그대로.

-- ════════════════════════════════════════════════════════════════════════════
-- ① quiz_course_live — 베이스 0332 본문 + 매장 생존 한 줄
-- ════════════════════════════════════════════════════════════════════════════
-- ── ① 퀴즈가 살아 있나 ──
-- ★0358: 매장이 지워졌으면(units.deleted_at) 퀴즈도 죽었다. 게스트 링크는 멤버십이 막지 못하는 유일한 길이다.
create or replace function public.quiz_course_live(p_unit text, p_course text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.training_courses c
     where c.id = p_course and c.unit_id = p_unit and c.active and c.brand_hidden_at is null
       and exists (select 1 from public.units u where u.id = c.unit_id and u.deleted_at is null)
       and exists (select 1 from public.course_entries ce
                    join public.playbook_entries pe on pe.id = ce.entry_id and pe.unit_id = ce.unit_id
                   where ce.course_id = c.id and ce.unit_id = p_unit
                     and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_course_live(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② auth_owns_unit — 베이스 0215 본문 + 지운 매장 제외
-- ════════════════════════════════════════════════════════════════════════════
-- (0215) 본문은 0198 것으로 되돌린다(AGENTS ⑧: 정의 전수 = 0198·0211 둘, 의미 정본은 0198 의 주석이 선언한 SSOT).
--   `units.owner_id = auth.uid()` — 매니저·직원은 false. 0211·0213 이 쓰는 "그 매장의 점주인가"와 같은 뜻이고
--   §3-4(수락·거절·공개 수준 변경 = 점주만)를 그대로 만족한다.
-- ★0358: 지운 매장(deleted_at)은 아무도 소유하지 않는다. 사진 storage 정책(0218)·copy_knowhow_between(0248)·
--   브랜드 RPC 가 이 술어 하나로 막힌다.
create or replace function public.auth_owns_unit(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.units u
    where u.id = p_unit and u.owner_id = auth.uid() and u.deleted_at is null
  )
$$;
comment on function public.auth_owns_unit(text) is
  '요청자가 이 매장의 사장인가(units.owner_id = auth.uid() · 지운 매장 제외 0358). 크로스테넌트 방어 술어 SSOT(0198) + 브랜드 축 점주 판정(0211).';
grant execute on function public.auth_owns_unit(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ auth_unit_id — 베이스 0303 본문 + 지운 매장이면 null
-- ════════════════════════════════════════════════════════════════════════════
-- ── auth_unit_id = 잠금 전 값, 단 닫힌 매장의 직원·매니저면 null ──
create or replace function public.auth_unit_id()
returns text language plpgsql stable security definer set search_path = public as $$
-- plpgsql 로 둔다: 계획이 캐시돼 호출당 비용이 작다(로컬 실측 1,000회 · 직원 0.35초 · 사장 0.12초 · 잠금 전 값 0.10초).
--   같은 본문을 sql 함수로 쓰면 직원 1,000회 3.3초였다(호출마다 다시 계획).
declare v_unit text := public.auth_member_unit_id();
begin
  if v_unit is null then return null; end if;
  -- ★0358: 지운 매장(deleted_at)은 누구의 활성 매장도 아니다. auth_member_unit_id 의 profiles.unit_id 폴백(0303:44)은
  --   멤버십을 보지 않아서, 그 값이 지운 매장을 가리키면 매장 RLS 112개가 다시 열렸다(W5-0 새는 곳 3).
  --   PK 1행 조회라 비용이 작다.
  if exists (select 1 from public.units u where u.id = v_unit and u.deleted_at is not null) then
    return null;
  end if;
  if exists (select 1 from public.unit_members m
              where m.unit_id = v_unit and m.user_id = auth.uid() and m.role in ('junior', 'manager'))
     and public.unit_access_locked(v_unit) then
    return null;      -- ★0303(C2): 닫힌 매장 직원·매니저는 매장 데이터에 닿지 않는다
  end if;
  return v_unit;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ unit_access_locked — 베이스 0196 본문 + 지운 매장이면 먼저 true
-- ════════════════════════════════════════════════════════════════════════════
-- 0142 ③ "무료 매장이 1개뿐이면 안 잠근다"는 진짜 무료 사용자(유료 매장 0개)를 위한 것이었다.
-- 4→3 으로 줄인 사장의 4호점은 그 규칙으로 **무료 매장으로 계속 열렸다**(줄였는데 안 닫힘).
-- → 유료 매장을 1개 이상 가진 사장에게 무료 매장은 0개다(전부 잠김 = 이전 매장).
--   유료 매장이 0개인 사장은 현행 그대로(무료 1개·선택 전엔 안 잠금 — fail-open 뼈대 유지).
create or replace function public.unit_access_locked(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_kept  text;
begin
  if p_unit is null then return false; end if;
  -- ⓪ ★0358: 지운 매장은 무조건 잠겼다. 아래 fail-open(사장 멤버십을 못 찾으면 false)보다 먼저 본다.
  --    delete_store 가 사장 멤버십을 끊으므로 이 줄이 없으면 지운 매장이 "열림"으로 판정된다(W5-0 새는 곳 4).
  if exists (select 1 from public.units u where u.id = p_unit and u.deleted_at is not null) then return true; end if;
  -- ① 전면 무료 모드면 아무것도 잠그지 않는다(0062 스위치는 모든 캡을 우회한다).
  if public.billing_free_mode() then return false; end if;
  -- ② ★유료 매장은 절대 잠그지 않는다 — 판정 1순위. 돈을 낸 매장이 잠기는 사고를 구조적으로 봉쇄.
  if public.effective_plan(p_unit) <> 'free' then return false; end if;

  -- 사장 = unit_members(role='owner'). units.owner_id 는 nullable 이라 멤버십을 정본으로 쓴다
  -- (create_store·assign_open_slots 도 같은 기준).
  select m.user_id into v_owner
    from public.unit_members m
   where m.unit_id = p_unit and m.role = 'owner'
   order by m.created_at asc
   limit 1;
  -- 사장을 못 찾으면 잠그지 않는다(fail-open) — 데이터 이상으로 매장을 막지 않는다.
  if v_owner is null then return false; end if;

  -- ★0196 ②-b: 이 사장에게 유료 매장이 하나라도 있으면 무료 매장은 전부 잠긴다(이전 매장).
  --   유료 매장을 못 찾으면 아래 기존 규칙으로 — "못 찾으면 잠그지 않음"은 그대로다.
  if exists (
    select 1 from public.unit_members m2
     where m2.user_id = v_owner and m2.role = 'owner'
       and public.effective_plan(m2.unit_id) <> 'free'
  ) then return true; end if;

  -- ③ 무료 매장이 1개뿐이면 넘칠 것이 없다.
  if public.owner_free_unit_count(v_owner) <= 1 then return false; end if;

  -- ④⑤ 선택이 있으면 고른 매장만 열린다. 선택이 없으면 **아무것도 잠그지 않는다**(★fail-open).
  --     여기가 이 파일에서 제일 중요한 줄이다 — 잠그고 나서 고르게 하면 계정이 갇힌다.
  v_kept := public.owner_kept_unit_id(v_owner);
  if v_kept is null then return false; end if;
  return v_kept is distinct from p_unit;
end $$;
revoke all on function public.unit_access_locked(text) from public, anon, authenticated;
grant execute on function public.unit_access_locked(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ delete_store_preview — 베이스 0235 본문 + 지운 매장 제외
-- ════════════════════════════════════════════════════════════════════════════
-- 삭제 확인창이 문구를 고르는 데 쓴다(정책 M2 — 돌려주지 않는 매장에 "돌려준다"고 약속하지 않게). 읽기 전용 · 소유자만.
create or replace function public.delete_store_preview(p_unit text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_slot  uuid;
  v_claim uuid;
  v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- ★0358: 지운 매장은 소유자도 없다(not_owner).
  if not exists (select 1 from public.units u where u.id = p_unit and u.owner_id = auth.uid() and u.deleted_at is null) then
    raise exception 'not_owner';
  end if;
  select r.slot_id, r.claim_id, r.paid_until into v_slot, v_claim, v_until
    from public.store_return_slot(p_unit) r;
  return jsonb_build_object(
    'returns_slot', (v_slot is not null or v_claim is not null),
    'paid_until', case when v_slot is not null or v_claim is not null then v_until end
  );
end $$;
revoke all on function public.delete_store_preview(text) from public, anon, authenticated;
grant execute on function public.delete_store_preview(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ delete_store — 베이스 0300 본문 · 마지막 "실삭제"만 소프트 삭제로
-- ════════════════════════════════════════════════════════════════════════════
-- (0300) 본사 연결 검사를 직원 검사 앞으로 (라이브 QA 10-06 결함 9).
-- (0281) 본사 연결이 살아 있는 매장은 삭제를 거부한다. 지우면 cascade 로 연결 기록까지 사라졌다.
--   ★0358 뒤로는 행이 남지만 거부는 그대로 둔다(본사가 묶은 매장을 점주가 혼자 끝내지 못하게 · end_brand_unit 이 기록을 남긴다).
-- (0235) 반환형 jsonb · 몫 돌려주기 · 대기 신고 닫기.
create or replace function public.delete_store(p_unit_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alt   text;
  v_slot  uuid;
  v_claim uuid;
  v_until timestamptz;
  v_plan  text;
  v_back  boolean := false;
  v_can_end boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★소유검증(유일 방어선) + ★0235(리뷰 ⑲-e) 행 잠금 — 같은 매장을 동시에 지우면 뒤 호출은 앞 호출이 끝날 때까지
  --   기다렸다가 매장이 없어진 것을 보고 not_owner 로 끝난다(몫이 두 번 돌아오지 않는다).
  --   ★0358: 행이 남으므로 "없어진 것" = deleted_at 이 찍힌 것. 이 조건이 없으면 같은 매장을 두 번 지워 몫을 두 번 받는다.
  perform 1 from public.units u where u.id = p_unit_id and u.owner_id = v_uid and u.deleted_at is null for update;
  if not found then raise exception 'not_owner'; end if;

  -- ★마지막(유일) 매장은 삭제 불가 → 계정삭제로 유도
  if (select count(*) from public.units u where u.owner_id = v_uid and u.deleted_at is null) <= 1 then
    raise exception 'last_store';
  end if;

  -- ★0300: 본사 연결 검사를 직원 검사보다 먼저 한다(라이브 QA 결함 9). 직원을 다 내보낸 뒤에야
  --   "본사에 문의" 가 나오면 해제 불가 매장의 사장은 직원만 잃고 결국 못 지운다.
  -- ★0281(C9): 본사 연결이 살아 있으면 차단한다.
  --   해제 불가로 묶인 연결은 본사에 문의하게 하고, 끊을 수 있는 연결은 먼저 끊게 한다(end_brand_unit 이 기록을 남긴다).
  select bu.owner_can_end into v_can_end
    from public.brand_units bu
   where bu.unit_id = p_unit_id and bu.status = 'active'
   limit 1;
  if found then
    if not v_can_end then raise exception 'brand_locked'; end if;
    raise exception 'brand_linked';
  end if;

  -- ★직원(나 외 멤버)이 있으면 차단 — 먼저 내보내라
  if exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id <> v_uid) then
    raise exception 'store_has_staff';
  end if;

  -- ★0235(J8): 남은 몫을 새 매장용 슬롯으로 돌려준다. 지우기 **전에** 계산한다(매장 행이 있어야 판정된다).
  select r.slot_id, r.claim_id, r.paid_until, r.plan into v_slot, v_claim, v_until, v_plan
    from public.store_return_slot(p_unit_id) r;
  if v_slot is not null then
    update public.store_slots
       set consumed_at = null, consumed_unit_id = null, paid_until = v_until, plan = v_plan, prepaid_until = null, carry = interval '0'
     where id = v_slot;
    v_back := true;
  elsif v_claim is not null then
    insert into public.store_slots (owner_id, paid_until, claim_id, source, plan)
    values (v_uid, v_until, v_claim, 'claim', v_plan);
    v_back := true;
  end if;

  -- ★0235(M7): 그 매장의 대기 신고를 닫는다. 남겨 두면 unit_id 가 빈 대기 신고가 카드 결제 시작을 막는다.
  update public.payment_claims
     set status = 'rejected', reviewed_at = now(), reviewed_by = 'system', reject_reason = 'store_deleted'
   where unit_id = p_unit_id and status = 'pending';

  -- 활성/주매장이 이 매장이면 다른 내 매장(가장 오래된)으로 재지정
  select u.id into v_alt
    from public.units u
   where u.owner_id = v_uid and u.id <> p_unit_id and u.deleted_at is null
   order by u.created_at
   limit 1;
  update public.profiles
     set active_unit_id = case when active_unit_id = p_unit_id then v_alt else active_unit_id end,
         unit_id        = case when unit_id        = p_unit_id then v_alt else unit_id        end
   where id = v_uid;

  -- ★0358: 예전 실삭제가 FK(on delete set null)로 하던 일을 그대로 한다. 다른 사람(지난 직원·합류 대기자)의
  --   프로필이 이 매장을 가리키면 비운다. 남기면 auth_member_unit_id 폴백이 지운 매장을 활성 매장으로 고른다.
  update public.profiles set unit_id = null where unit_id = p_unit_id;
  update public.profiles set active_unit_id = null where active_unit_id = p_unit_id;
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit_id;
  update public.store_slots set consumed_unit_id = null where consumed_unit_id = p_unit_id;
  -- 결제 기록(5년 · 전자상거래법)은 남기고 매장 연결만 비운다(예전 on delete set null · qa-iap ⑱-d).
  update public.payment_claims set unit_id = null where unit_id = p_unit_id;

  -- ★0358: 예전 cascade 가 같이 지우던 "계정 상태" 행은 지금 지운다. 매장 기록(노하우·퀴즈·채팅·출퇴근…)은 남긴다.
  --   구독(유료 판정) · 남길 매장 선택(unit_access_locked ④⑤) · 좌석 보관 · 잠금·알림 대기열은 지운 매장을 보면 안 된다.
  delete from public.unit_subscriptions  where unit_id = p_unit_id;
  delete from public.owner_kept_unit     where unit_id = p_unit_id;
  delete from public.unit_kept_seats     where unit_id = p_unit_id;
  delete from public.iap_release_choice  where unit_id = p_unit_id;
  delete from public.seat_lock_episodes  where unit_id = p_unit_id;
  delete from public.owner_alerts        where unit_id = p_unit_id;
  delete from public.unit_closure_alerts where unit_id = p_unit_id;
  delete from public.task_reminder_sent  where unit_id = p_unit_id;

  -- ★0358: 소프트 삭제. 초대 코드·사업자번호는 비운다(코드로 합류 못 하게 · 같은 사업자번호로 새 매장을 열 수 있게).
  --   멤버십(사장 1행 · 직원은 위에서 0명 확인)을 끊는다. session_active_units 는 멤버십 FK cascade 로 같이 간다.
  --   매장 기록 파기는 30일 뒤 purge_deleted_accounts → purge_deleted_store(0361)가 한다.
  update public.units
     set deleted_at = now(), invite_code = null, invite_expires_at = null, biz_no = null
   where id = p_unit_id;
  delete from public.unit_members where unit_id = p_unit_id;

  return jsonb_build_object('returned_slot', v_back, 'paid_until', case when v_back then v_until end);
end $$;
revoke all on function public.delete_store(text) from public, anon, authenticated;
grant execute on function public.delete_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ reopen_store — 베이스 0356 본문 + 지운 매장 거부
-- ════════════════════════════════════════════════════════════════════════════
-- (4) reopen_store — 0282 본문 승계(0246 → 0282). ★0356: 초대 코드 재발급 = _new_join_code · 충돌 재시도.
-- ★0358: 사용자가 지운 매장(deleted_at)과 사장이 탈퇴한 매장은 다시 열지 않는다(되살리기 없음 · 11-10 사용자 결정).
--   delete_store 가 사장 멤버십을 끊어서 not_owner 로 이미 막히지만, unit_access_locked 가 지운 매장에 true 를 주므로
--   멤버십이 남은 경로(사장 탈퇴 · 0335 는 멤버십을 보존한다)가 not_locked 를 지나지 않게 여기서 한 번 더 막는다.
create or replace function public.reopen_store(p_unit text)
returns table(unit_id text, invite_code text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_slot  uuid;
  v_until timestamptz;
  v_splan text;   -- ★0235: 슬롯의 요금제
  v_code  text;
  r       record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  -- ★0358: 지운 매장은 소유자가 없다(같은 not_owner · 앱 문구 그대로).
  if exists (select 1 from public.units u where u.id = p_unit and u.deleted_at is not null) then
    raise exception 'not_owner';
  end if;
  -- 잠긴 매장만 다시 연다. 열려 있는 매장에 슬롯을 태우면 이용권이 조용히 사라진다.
  if not public.unit_access_locked(p_unit) then raise exception 'not_locked'; end if;

  -- create_store 와 같은 슬롯 소비. 전면 무료 모드면 잠긴 매장이 없으므로 여기 오지 않는다.
  select id, s.paid_until, s.plan into v_slot, v_until, v_splan
    from public.store_slots s
   where s.owner_id = v_uid and s.consumed_at is null and s.paid_until > now()
   order by s.paid_until asc
   limit 1
   for update skip locked;
  if v_slot is null then raise exception 'no_store_slot'; end if;

  -- ── 직원 비움(사장 제외 전원) — ★0246: 직원마다 정리 함수(근무표는 오늘로 닫고 미래만 지움 · 교대 이력 · 출퇴근은 남김) ──
  for r in
    select m.user_id
      from public.unit_members m
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(p_unit, r.user_id, 'reopen', false);
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;
  -- ★0235: 이 매장에 대기 중인 합류 신청을 비운다(다시 연 매장은 새 초대 코드로 다시 받는다).
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;

  -- ── 초대 코드 재발급(rotate_invite_code 와 같은 규칙: ★0356 영문·숫자 6자 · ★0282(C6) 만료 없음) ──
  --   ★0356: 동시에 같은 코드가 들어가 23505 가 나면 새로 뽑는다(5번).
  for v_try in 1 .. 5 loop
    v_code := public._new_join_code();
    begin
      update public.units set invite_code = v_code, invite_expires_at = null where id = p_unit;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise exception 'invite_code_busy'; end if;
    end;
  end loop;

  -- ── 슬롯 소비 + 열기(create_store 와 같은 값 · ★0235 요금제 = 슬롯의 plan) ────
  update public.store_slots set consumed_at = now(), consumed_unit_id = p_unit where id = v_slot;
  insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
  values (p_unit, 'active', coalesce(v_splan, 'multi'), v_until)
  on conflict (unit_id) do update set
    status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();

  unit_id := p_unit; invite_code := v_code; paid_until := v_until;
  return next;
end $$;
revoke all on function public.reopen_store(text) from public, anon, authenticated;
grant execute on function public.reopen_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  fn  text;
  def text;
begin
  -- 본문: 다섯 곳과 delete_store·reopen_store 에 지운 매장 판정이 있다.
  foreach fn in array array[
    'public.quiz_course_live(text,text)', 'public.auth_owns_unit(text)', 'public.auth_unit_id()',
    'public.unit_access_locked(text)', 'public.delete_store_preview(text)', 'public.delete_store(text)',
    'public.reopen_store(text)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if def not like '%deleted_at%' then raise exception '0358 자가점검 실패 — %에 지운 매장 판정이 없다', fn; end if;
  end loop;
  -- delete_store 는 더 이상 units 를 실삭제하지 않는다.
  if pg_get_functiondef('public.delete_store(text)'::regprocedure) ~* 'delete\s+from\s+public\.units\M' then
    raise exception '0358 자가점검 실패 — delete_store 가 아직 units 를 지운다';
  end if;
  -- 권한: 게스트 경로는 열려 있고(0166 자가점검과 같은 목록) 내부 헬퍼는 닫혀 있다.
  if has_function_privilege('anon', 'public.quiz_course_live(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.quiz_course_live(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_store(text)', 'EXECUTE') then
    raise exception '0358 자가점검 실패 — 내부 함수 권한이 열렸다';
  end if;
  foreach fn in array array['public.quiz_link_open(text)', 'public.quiz_link_items(text, int)',
                            'public.quiz_link_grade(text, text, jsonb)', 'public.quiz_link_submit(text, text, text, boolean, jsonb)'] loop
    if not has_function_privilege('anon', fn, 'EXECUTE') then raise exception '0358 자가점검 실패 — 게스트 경로가 닫혔다: %', fn; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.delete_store(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reopen_store(text)', 'EXECUTE') then
    raise exception '0358 자가점검 실패 — 사장 경로가 닫혔다';
  end if;
  raise notice '0358 자가점검 통과';
end $$;
