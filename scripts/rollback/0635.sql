-- rollback/0635.sql — 0635 를 되돌린다(댓글 부모 잠금·댓글 같이 지우기 트리거 · 다시 올리기·지우기 함수 · 댓글 인덱스).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0635.sql --linked
begin;
drop trigger if exists trg_work_feed_comment_parent on public.work_feed;
drop trigger if exists trg_work_feed_cascade_comments on public.work_feed;
drop function if exists public.tg_work_feed_comment_parent();
drop function if exists public.tg_work_feed_cascade_comments();
drop function if exists public.repost_notice(text, boolean);
drop function if exists public.delete_feed_item(text);
drop index if exists public.idx_wf_comment_ref;
commit;
