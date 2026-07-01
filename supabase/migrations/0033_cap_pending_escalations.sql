-- 0033_cap_pending_escalations.sql — 직원당 미해결 에스컬레이션 수 상한 (남용 #18)
--
-- 왜: 한 직원이 무의미·장난성 질문을 대량 등록하면 신뢰도<0.45로 전부 사장 인박스로 떨어져
--   도배된다(진짜 질문이 묻힘). 클라 체크는 우회 가능 → DB 트리거가 유일하게 확실한 방어선.
--
-- 정책: 같은 매장에서 그 직원의 '대기(pending_owner_answer)' 미해결 질문이 CAP개 이상이면
--   새 에스컬레이션 INSERT를 거부(too_many_pending). 사장이 답변/보관하면 카운트가 줄어 다시 가능.
--   같은 질문 중복은 클라 enqueue가 이미 묶으므로(similar_queries_count), 여기 카운트는 '서로 다른' 대기 질문 수다.
--
-- ⚠️ 트리거 발화 순서: BEFORE INSERT 트리거는 이름 알파벳 순. 작성자 도장(trg_stamp_author_uq, 0007)이
--   new.junior_id := auth.uid()로 덮어쓴 "뒤에" 카운트해야 junior_id 스푸핑으로 캡을 우회할 수 없다.
--   → 이름을 'trg_z_…'로 둬 stamp 트리거 다음에 돈다.

create or replace function public.cap_pending_escalations()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_cap   int := 10;  -- 직원당 동시 미해결 대기 질문 상한
begin
  if new.status = 'pending_owner_answer' and new.junior_id is not null then
    select count(*) into v_count
      from public.unknown_queries
      where unit_id = new.unit_id
        and junior_id = new.junior_id
        and status = 'pending_owner_answer';
    if v_count >= v_cap then
      raise exception 'too_many_pending';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_z_cap_pending_uq on public.unknown_queries;
create trigger trg_z_cap_pending_uq
  before insert on public.unknown_queries
  for each row execute function public.cap_pending_escalations();
