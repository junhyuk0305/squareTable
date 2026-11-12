-- rollback/0635.sql — 0635 를 되돌린다(댓글 부모 잠금·댓글 같이 지우기 트리거 · 다시 올리기·지우기 함수 · 댓글 인덱스).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0635.sql --linked
-- 주의: 새 웹은 repost_notice·delete_feed_item 을 부른다(src/lib/db.ts repostNotice·deleteFeedItemRpc). 지우면 새 웹의 공지 다시 올리기·글 지우기가 함수 없음으로 실패한다. 옛 길로 돌아가지 않는다.
-- 순서: 새 웹을 올린 뒤라면 웹을 36d5f2e 로 먼저 되돌린 뒤 이 파일을 돌린다. 되돌리기는 0682 → 0600 역순이다. 새 앱이 나간 뒤에는 쓰지 않는다.
begin;
drop trigger if exists trg_work_feed_comment_parent on public.work_feed;
drop trigger if exists trg_work_feed_cascade_comments on public.work_feed;
drop function if exists public.tg_work_feed_comment_parent();
drop function if exists public.tg_work_feed_cascade_comments();
drop function if exists public.repost_notice(text, boolean);
drop function if exists public.delete_feed_item(text);
drop index if exists public.idx_wf_comment_ref;
commit;
