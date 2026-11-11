-- rollback/0581.sql — 0581 을 되돌린다. 사진 복사 엣지(knowhow-photo-copy)를 먼저 내리거나 그대로 둔다(함수가 없으면 500 → 화면은 사진 없이 승인).
-- 이미 복사한 사진 파일과 사본 노하우의 photos 는 그대로 둔다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0581.sql --linked
begin;
drop function if exists public._set_proposal_photos(text, text[]);
drop function if exists public._proposal_photo_source(text, uuid);
commit;
