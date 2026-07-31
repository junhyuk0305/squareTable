-- 0099: 노하우 저자 역할 스냅샷 — 표기용 (권한체계 정본 §5-3 #2 "김OO 매니저")
--
-- 배경: 매니저(0093)가 owner 표면으로 노하우를 직접 발행하면서 "작성 경로=owner → 사장님"
-- 가정이 깨졌다. 클라 knowhowSourceLabel 이 저자 역할을 알 수 없어 매니저 저자도
-- "○○ 사장님"으로 표기되는 문제(source 필드는 컬럼이 없어 저장 자체가 안 됨).
-- 해결: 작성 시점 역할을 컬럼으로 스냅샷. 이후 역할이 바뀌어도 저자 크레딧은 작성 당시 기준.
-- RLS/권한 변경 없음 — 표기용 컬럼 추가 + 데이터 백필만.

alter table public.playbook_entries
  add column if not exists creator_role text
    check (creator_role in ('owner','manager'));

-- 백필: 역할 미저장 기존 엔트리 중 저자가 그 매장의 현 매니저인 것만 'manager'로.
-- (owner 는 백필 불필요 — creator_role null 이면 클라가 기존 규칙대로 "사장님"을 붙인다.
--  매니저 역할은 0093(전날) 도입이라 그 이전 엔트리의 오분류 위험은 사실상 없다.)
update public.playbook_entries pe
   set creator_role = 'manager'
  from public.unit_members um
 where um.unit_id = pe.unit_id
   and um.user_id::text = pe.creator_id
   and um.role = 'manager'
   and pe.creator_role is null;
