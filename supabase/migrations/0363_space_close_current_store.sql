-- 0363_space_close_current_store.sql — 공간·매장 통합 1번 덩이 2단계: 현재 매장에 공간이 안 담기게 한다 (2026-11-10 · 데이터구조 A안 3판 5-1 · 부록 C 2단계 · A-4)
-- 옛 앱 호환: 안전 · 함수 이름·인자·반환형·언어(sql)·stable·security definer·search_path·권한 그대로 · drop 없음.
--   매장(store)과 본사 작업실(brand_workspace)을 가리키는 기록은 지금과 같은 값을 돌려준다. 공간 행은 아직 하나도 없다(입구 꺼짐).
--   옛 앱 1.1.0 은 session_unit(db.ts:223), 1.1.1 은 session_bootstrap(db.ts:249)으로 현재 매장을 받는다. 둘 다 이 함수를 탄다(3판 16장).
--   공간만 가진 계정은 "매장이 없는 계정"으로 보인다(합류·만들기 화면) = 3판 16장 "옛 앱이 공간이 있는 계정으로 로그인" 안전.
--
-- 무엇이 바뀌나: auth_member_unit_id() — 0303:19 본문 통째 승계(최고 번호 정의 · grep -niE 전수 확인 · 정의는 0303 하나).
--   세 기록(기기 기록 session_active_units → 계정 기록 profiles.active_unit_id → 옛 주매장 칸 profiles.unit_id) 각각에
--   "가리키는 units.kind 가 ('store','brand_workspace') 안에 있을 때만" 조건을 더한다(★0363).
--   조건에 안 맞는 기록은 null 이 되어 coalesce 가 다음 기록으로 넘어간다. 셋 다 안 맞으면 null(= 현재 매장 없음).
--   허용 목록 방식이다. 나중에 종류가 늘어도 이 함수는 닫힌 쪽(현재 매장 아님)으로 틀린다(3판 5-1).
--   본사 작업실은 지금도 의도적으로 현재 매장이 될 수 있다(brand_enter_workspace 0285:159). 바꾸지 않는다.
-- 바꾸지 않는 것: auth_unit_id(0303:52 · 다른 세션 0358 이 고치는 중 · 이 함수를 부르므로 자동으로 같이 걸러진다),
--   session_unit · my_unit_locked · leave_store(0303) · session_bootstrap(0354) 본문, 세 기록의 순서와 멤버십 조건.
--   옛 주매장 칸(세 번째 기록)은 지금도 멤버십을 안 본다. 그 성질은 그대로 두고 종류 조건만 더한다.
-- 같음 근거: profiles.unit_id · profiles.active_unit_id 는 units(id) FK(on delete set null)이고 session_active_units 는
--   unit_members FK 라, 가리키는 units 행은 늘 있다. 지금 모든 units.kind 는 store 또는 brand_workspace(0209:26 · 0362 전 CHECK)다.
--   그래서 공간이 없는 지금 더한 exists 는 늘 참이고 결과가 글자 단위로 같다.
-- 성능: 기록마다 units PK 1행 조회가 하나씩 는다. 이 함수는 auth_unit_id 를 거쳐 매장 RLS 정책에서 (select …) 로 감싸
--   문장마다 1번 돈다(0303 머리말). 3판 부록 C 2단계 = 0303 주석의 1,000회 실측과 같은 방법으로 전후 비교한다(적용 뒤 · 이 파일은 측정 안 함).
--   language sql 은 그대로 둔다. auth_unit_id 를 plpgsql 로 둔 이유(계획 캐시 · 0303:54-55)는 바깥 함수의 일이고,
--   이 함수는 0285 부터 sql 이었다. 언어를 바꾸면 성능 비교의 기준이 흔들린다.
-- 적용 뒤 게이트(3판 부록 C 2단계): 단위 검사(세 기록에 공간 번호를 억지로 넣어도 안 나옴 · 매장과 본사 작업실은 그대로) ·
--   qa:multistore · qa:session-bootstrap:local · 방 격리 셋(qa:room-isolation · qa:room-matrix · qa:room-cso) · 보안 검토.

-- ── 잠금 전 활성 매장 = 0285 auth_unit_id 본문 그대로 (0303) + ★0363 자리 종류 허용 목록 ──
create or replace function public.auth_member_unit_id()
returns text
language sql
stable security definer
set search_path = public
as $$
  select coalesce(
    -- ★0285: 이 세션이 고른 매장. 내 행이고 멤버십이 살아 있을 때만(FK cascade 와 겹치는 방어선).
    (select s.unit_id
       from public.session_active_units s
      where s.session_id = public.jwt_session_uuid()
        and s.user_id = auth.uid()
        and exists (
          select 1 from public.unit_members m
          where m.user_id = s.user_id and m.unit_id = s.unit_id
        )
        -- ★0363: 매장·본사 작업실만. 공간이면 이 기록을 건너뛴다(다음 기록으로).
        and exists (
          select 1 from public.units u
          where u.id = s.unit_id and u.kind in ('store', 'brand_workspace')
        )),
    (select coalesce(
      (select p.active_unit_id
         from public.profiles p
        where p.id = auth.uid()
          and p.active_unit_id is not null
          and exists (
            select 1 from public.unit_members m
            where m.user_id = p.id and m.unit_id = p.active_unit_id
          )
          -- ★0363: 매장·본사 작업실만.
          and exists (
            select 1 from public.units u
            where u.id = p.active_unit_id and u.kind in ('store', 'brand_workspace')
          )),
      -- ★0363: 옛 주매장 칸도 매장·본사 작업실만. 비어 있으면 지금처럼 null.
      (select p.unit_id
         from public.profiles p
        where p.id = auth.uid()
          and exists (
            select 1 from public.units u
            where u.id = p.unit_id and u.kind in ('store', 'brand_workspace')
          ))
    ))
  )
$$;
revoke all on function public.auth_member_unit_id() from public, anon;
grant execute on function public.auth_member_unit_id() to authenticated;

-- ── 자가점검 ──
do $$
declare v_src text := (select p.prosrc from pg_proc p where p.oid = 'public.auth_member_unit_id()'::regprocedure);
begin
  if v_src not like '%brand_workspace%'
     or v_src not like '%session_active_units%'
     or v_src not like '%active_unit_id%'
     or (length(v_src) - length(replace(v_src, 'u.kind in (''store'', ''brand_workspace'')', '')))
          / length('u.kind in (''store'', ''brand_workspace'')') <> 3 then
    raise exception '0363 자가점검 실패';
  end if;
end $$;
