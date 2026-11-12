-- 0691_edu_guest_key_dies_on_claim.sql — 계정으로 옮긴 손님 행은 원래 손님 열쇠로 풀리지 않는다
--   (2026-11-13 · 새 관점 결함 점검 C-1 · 결함목록_2026-11-13.md 판정 원칙)
--
-- 왜: 손님 질문을 계정으로 옮긴 뒤에도(edu_link_claim_guest · edu_link_claim_code 가 claimed_by 를 적는다) 기기에 남은
--   손님 열쇠가 계속 같은 손님 행을 풀었다. 공용 PC 브라우저에서 옮긴 뒤 다음 사람이 같은 링크를 열면
--   앞사람 질문과 사장 답을 보고, 새로 물은 질문은 앞사람 계정의 손님 행에 붙어 그 사람 앱(/link/[id])에 나타났다.
--   재현 = 손님 행을 claimed 로 바꾼 뒤 anon 으로 edu_link_answers(토큰, 옛 열쇠) → 1행.
-- 판정(결함목록 판정 원칙): 옮긴 손님 열쇠를 끊는다. 옮긴 사람은 앱(/link/[id])에서 계정 길(edu_link_me_key 열쇠)로 기록을 본다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   _edu_guest_of — 베이스 0552 본문 통째(정의 전수 0401 · 0552). ★0691 한 줄:
--     손님 행의 원래 열쇠(key_hash)는 claimed_by 가 비어 있을 때만 맞는다. 기기별 열쇠 표(edu_link_guest_keys · edu_link_me_key 가 만든다)는 그대로다.
--   옮긴 열쇠로 부르면 모든 손님 함수가 "열쇠 없음"으로 돈다(묻기 = 새 손님 · 답 목록 = 0행 · 보내기·신고 = question_not_found ·
--     이어받기 코드 = handoff_needs_question). 새 오류 코드는 없다.
--   _edu_guest_for_me 가 만든 손님 행(처음부터 claimed)의 key_hash 는 원문을 버린 난수라 처음부터 아무도 못 쓴다 → 영향 없음.
--   edu_link_claim_guest 는 이 함수를 지나지 않고 key_hash 를 직접 본다(같은 계정이 다시 옮기면 claimed = true) → 그대로.
--
-- 옛 앱 호환(⑪): 안전 | 내부 함수(클라 권한 0) · 이름·인자·반환형 그대로. 옛 앱 1.1.1 에는 손님 열쇠를 옮기는 길이 없다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0691.sql

-- ════════════════════════════════════════════════════════════════════════════
-- _edu_guest_of (0552 본문 · ★0691 옮긴 행의 원래 열쇠는 안 맞는다)
--   0401: 열쇠 → 그 링크의 손님 행. 틀린 열쇠·다른 링크 열쇠·빈 열쇠 = null.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  with k as (select encode(extensions.digest(p_key, 'sha256'), 'hex') as h
              where p_key is not null and length(p_key) between 20 and 100)
  select g.* from public.edu_link_guests g, k
   where g.link_id = p_link
     -- ★0691: 계정으로 옮긴 행(claimed_by)은 원래 손님 열쇠로 풀지 않는다(기기에 남은 열쇠로 다음 사람이 보지 않게 · C-1).
     and ((g.key_hash = k.h and g.claimed_by is null)
          -- ★0552: 로그인한 링크 사용자의 기기별 열쇠(edu_link_me_key). 같은 손님 행으로 푼다.
          or exists (select 1 from public.edu_link_guest_keys gk where gk.key_hash = k.h and gk.guest_id = g.id))
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- ── 자가점검 ──
do $$
declare d text := (select prosrc from pg_proc where oid = 'public._edu_guest_of(text, text)'::regprocedure);
begin
  if d not like '%g.claimed_by is null%' or d not like '%edu_link_guest_keys%' then
    raise exception '0691 자가점검 실패: _edu_guest_of 본문';
  end if;
  if has_function_privilege('anon', 'public._edu_guest_of(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._edu_guest_of(text, text)', 'execute') then
    raise exception '0691 자가점검 실패: _edu_guest_of 가 클라에 열렸다';
  end if;
  raise notice '0691 자가점검 통과';
end $$;
