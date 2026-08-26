-- 0179 — 교대 상태 전이를 서버로 + 승인 시 근무를 **실제로** 이전한다 (작업 6-1 · 6-2 · 6-3 / 감사 #41)
--
-- ## 무엇이 문제였나
-- 승인된 교대는 지금까지 **파생으로만** 반영됐다. shiftsOn()·workers_at() 이 그릴 때마다
-- "승인된 교대가 있으면 담당자를 바꿔서 보여준다"로 계산할 뿐, 원본 shift_templates 행은
-- 여전히 원 담당자 것이다. 그래서 감사 #41 이 난다:
--   교대 승인된 날의 근무를 편집·삭제하면 **원 담당자의 매주 반복 근무**가 수정된다.
--   시트 제목은 "{대타}님 수요일 근무"인데 저장은 원 담당자 템플릿에 적용된다.
-- 사용자가 말한 "승인하면 완전히 그 사람에게 넘어간다"를 구현하면 이 버그가 같이 닫힌다.
--
-- ## ★이중 적용 금지 — 둘 중 하나만 남긴다
-- 실제 이전을 하면서 파생 로직을 그대로 두면 담당자가 **두 번** 바뀐다. 그래서:
--   · workers_at 에서 승인 교대 치환 루프를 **걷어낸다**(이 파일).
--   · shiftsOn(TS SSOT)에서도 같은 루프를 걷어낸다(같은 커밋의 클라 변경).
--   · 대신 둘 다 shift_exceptions("그날은 없는 것으로 친다")를 반영한다.
--     안 하면 그날 근무가 **두 벌**로 보인다(원본 반복 + 새로 만든 조각).
--
-- ## 기존 approved 행 처리 방침
-- **전부 소급 이전한다**(과거 날짜 포함). 파생 로직을 걷어내는 순간 소급하지 않으면 그날 근무자가
-- 원 담당자로 되돌아가 **지금 보이는 것이 바뀐다**. 적용 시점 실측 5건(대부분 QA·데모 잔재)이라
-- 비용이 없다. 대상 템플릿이 이미 사라진 행은 건너뛴다(정리된 QA 매장).
--
-- ## 왜 상태 전이를 RPC 로 올리나
-- 수락은 **선착순 경쟁**이고(여러 명에게 보낸 요청), 승인은 상태 변경 + 근무 이전이 **한 트랜잭션**
-- 이어야 한다. 클라가 여러 번 쓰면 중간에 실패했을 때 "승인은 됐는데 근무는 안 넘어간" 상태가 남는다.

-- ── 1) 근무 한 칸을 (일부라도) 남에게 넘긴다 ───────────────────────────────
-- p_part_start/p_part_end 가 null 이면 근무 전체. 아니면 그 구간만 넘기고 나머지는 원 담당자에게 남긴다.
-- ★조각이 3개가 될 수 있다: 가운데를 떼면 앞(원래)·가운데(수락자)·뒤(원래).
-- ★원본이 '날짜 지정'이면 **행을 지우지 않는다** — swap_requests.template_id 가 on delete cascade 라
--   지우면 교대 요청 자체가 함께 사라진다. 남는 조각 하나로 **줄여서** id 를 살린다.
create or replace function public.transfer_shift(
  p_template_id text, p_date text, p_to text, p_part_start text, p_part_end text
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  t record; v_tlen int; v_off int; v_plen int; ps text; pe text;
  v_head boolean; v_tail boolean;
  newid text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  select * into t from public.shift_templates where id = p_template_id for update;
  if not found then return false; end if;

  ps := coalesce(p_part_start, t.start_time);
  pe := coalesce(p_part_end,   t.end_time);
  v_tlen := public.shift_span_min(t.start_time, t.end_time);
  v_off  := public.shift_span_min(t.start_time, ps);
  v_plen := public.shift_span_min(ps, pe);
  -- 구간은 근무 **안**에 있어야 하고 0분이면 안 된다. 클라 말을 믿지 않는다(서버가 무결성 경계).
  if v_plen = 0 or v_off + v_plen > v_tlen then return false; end if;

  v_head := v_off > 0;                       -- 앞 조각(원 담당자)
  v_tail := v_off + v_plen < v_tlen;         -- 뒤 조각(원 담당자)

  -- ① 근무 전체를 넘기는 경우
  if not v_head and not v_tail then
    if t.shift_date is not null then
      update public.shift_templates set staff_id = p_to where id = t.id;   -- 하루짜리 → 담당자만 교체
    else
      insert into public.shift_exceptions(template_id, unit_id, date)
        values (t.id, t.unit_id, p_date::date) on conflict do nothing;
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (newid, t.unit_id, p_to, null, p_date::date, t.start_time, t.end_time);
    end if;
    return true;
  end if;

  -- ② 일부만 넘기는 경우 — 원본을 그날에서 물러나게 하고 조각을 만든다
  if t.shift_date is null then
    -- 요일 반복: 그날만 예외로 떼어내고, 그날짜 지정 조각들을 새로 만든다(⛔반복을 전개하지 않는다)
    insert into public.shift_exceptions(template_id, unit_id, date)
      values (t.id, t.unit_id, p_date::date) on conflict do nothing;
    if v_head then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, t.start_time, ps);
    end if;
    if v_tail then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, pe, t.end_time);
    end if;
  else
    -- 날짜 지정: 원본 행을 남는 조각 하나로 **줄인다**(지우면 교대 요청이 cascade 로 사라진다).
    if v_head then
      update public.shift_templates set end_time = ps where id = t.id;
      if v_tail then
        insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
          values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, t.shift_date, pe, t.end_time);
      end if;
    else
      update public.shift_templates set start_time = pe where id = t.id;   -- 앞을 떼갔으니 뒤만 남는다
    end if;
  end if;

  -- 수락자 조각
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
    values (newid, t.unit_id, p_to, null, p_date::date, ps, pe);
  return true;
end $$;
revoke execute on function public.transfer_shift(text, text, text, text, text) from public, anon, authenticated;

-- ── 2) 수락 — 선착순 선점 ──────────────────────────────────────────────────
-- 여러 명에게 보낸 요청은 **먼저 누른 사람이 가져간다**. 두 명이 동시에 눌러도 한 명만 성공해야 한다.
-- for update 로 행을 잠그고 status='open' 을 다시 본다 → 두 번째 호출은 false 를 받는다.
create or replace function public.accept_swap(p_id text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare s record; v_uid text := auth.uid()::text; v_targets text[];
begin
  if auth.uid() is null then return false; end if;
  select * into s from public.swap_requests where id = p_id for update;
  if not found then return false; end if;
  if s.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if s.status <> 'open' then return false; end if;                 -- ★이미 다른 사람이 가져갔다
  if s.requester_id = v_uid then return false; end if;             -- 0128 셀프 수락 차단(유지)
  -- 지정 발송이면 목록에 든 사람만. 대타(전체 공개)는 목록이 없다.
  v_targets := coalesce(
    s.target_staff_ids,
    case when s.target_staff_id is null then null else array[s.target_staff_id] end
  );
  if v_targets is not null and not (v_uid = any(v_targets)) then return false; end if;
  update public.swap_requests
     set status = 'accepted', accepted_by = v_uid, updated_at = now()
   where id = p_id and status = 'open';
  return true;
end $$;
revoke execute on function public.accept_swap(text) from public, anon, authenticated;
grant  execute on function public.accept_swap(text) to authenticated;

-- ── 3) 승인 — 상태 변경 + 실제 이전을 **한 트랜잭션**으로 ──────────────────
create or replace function public.approve_swap(p_id text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare s record;
begin
  if not public.auth_can_manage() then return false; end if;
  select * into s from public.swap_requests where id = p_id for update;
  if not found then return false; end if;
  if s.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if s.status <> 'accepted' or s.accepted_by is null then return false; end if;

  -- 요청자가 내놓은 근무(또는 그 구간)를 수락자에게
  if not public.transfer_shift(s.template_id, s.date, s.accepted_by, s.part_start, s.part_end) then
    return false;  -- 근무가 사라졌거나 구간이 근무 밖 → 승인 자체를 하지 않는다(반쪽 승인 금지)
  end if;
  -- 맞교환이면 상대 근무를 요청자에게(맞교환에는 구간 개념을 붙이지 않는다 — 전체만)
  if s.kind = 'swap' and s.target_template_id is not null and s.target_date is not null then
    if not public.transfer_shift(s.target_template_id, s.target_date, s.requester_id, null, null) then
      return false;
    end if;
  end if;

  update public.swap_requests set status = 'approved', updated_at = now() where id = p_id;
  return true;
end $$;
revoke execute on function public.approve_swap(text) from public, anon, authenticated;
grant  execute on function public.approve_swap(text) to authenticated;

-- ── 4) 기존 approved 행 소급 이전 ─────────────────────────────────────────
-- 파생 로직을 걷어내기 **전에** 돌려야 지금 보이는 것이 그대로 유지된다.
do $$
declare r record; n int := 0; skipped int := 0;
begin
  for r in select * from public.swap_requests where status = 'approved' and accepted_by is not null loop
    if public.transfer_shift(r.template_id, r.date, r.accepted_by, r.part_start, r.part_end) then
      n := n + 1;
    else
      skipped := skipped + 1;   -- 대상 근무가 이미 사라진 행(정리된 QA 매장 등)
    end if;
    if r.kind = 'swap' and r.target_template_id is not null and r.target_date is not null then
      perform public.transfer_shift(r.target_template_id, r.target_date, r.requester_id, null, null);
    end if;
  end loop;
  raise notice '0179 소급 이전: % 건 반영 · % 건 건너뜀(근무 없음)', n, skipped;
end $$;

-- ── 5) workers_at — 파생 치환을 걷어내고 예외를 반영한다 ───────────────────
-- 0138 의 정본을 여기로 이관한다. 승인 교대 루프가 사라진 자리에 shift_exceptions 검사가 들어간다.
-- (심야 근무 시각 판정은 0138 그대로 — 자정 넘김은 start > end 로 표현된다.)
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language sql stable set search_path = public as $$
  select st.staff_id
    from public.shift_templates st
   where st.unit_id = p_unit
     and (case when st.shift_date is null then st.weekday = extract(dow from p_day::date)::int
               else st.shift_date = p_day::date end)
     -- ★그날 예외로 떼어낸 반복은 없는 것으로 친다(0178). 빠뜨리면 근무가 두 벌로 잡힌다.
     and (st.shift_date is not null or not exists (
            select 1 from public.shift_exceptions e
             where e.template_id = st.id and e.date = p_day::date))
     and case when st.start_time <= st.end_time
              then (p_time >= st.start_time and p_time < st.end_time)
              else (p_time >= st.start_time or p_time < st.end_time)   -- 심야(22:00~02:00)
         end
$$;
revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;

-- ── 자가점검 — 본문으로 ───────────────────────────────────────────────────
do $$
declare v_bad text := ''; v_wa text; v_ac text; v_ap text;
begin
  v_wa := pg_get_functiondef('public.workers_at(text, text, text)'::regprocedure);
  if position('swap_requests' in v_wa) > 0 then
    v_bad := v_bad || 'workers_at(파생 치환이 남아 있다 = 이중 적용) ';
  end if;
  if position('shift_exceptions' in v_wa) = 0 then
    v_bad := v_bad || 'workers_at(예외 미반영 = 근무가 두 벌) ';
  end if;
  v_ac := pg_get_functiondef('public.accept_swap(text)'::regprocedure);
  if position('status = ''open''' in v_ac) = 0 then v_bad := v_bad || 'accept_swap(선점 조건 없음) '; end if;
  if position('requester_id = v_uid' in v_ac) = 0 then v_bad := v_bad || 'accept_swap(셀프 수락 차단 없음) '; end if;
  if position('target_staff_ids' in v_ac) = 0 then v_bad := v_bad || 'accept_swap(지정 목록 미검사) '; end if;
  v_ap := pg_get_functiondef('public.approve_swap(text)'::regprocedure);
  if position('transfer_shift' in v_ap) = 0 then v_bad := v_bad || 'approve_swap(실제 이전 없음) '; end if;
  if position('auth_can_manage' in v_ap) = 0 then v_bad := v_bad || 'approve_swap(관리자 검사 없음) '; end if;
  if has_function_privilege('anon', 'public.accept_swap(text)'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.approve_swap(text)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.transfer_shift(text, text, text, text, text)'::regprocedure, 'execute') then
    v_bad := v_bad || '권한(anon 또는 transfer_shift 직접 실행이 열려 있다) ';
  end if;
  if v_bad <> '' then raise exception '0179 자가점검 실패: %', v_bad; end if;
end $$;
