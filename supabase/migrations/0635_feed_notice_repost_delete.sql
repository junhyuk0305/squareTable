-- 0635_feed_notice_repost_delete.sql — 공지 다시 올리기 · 공지 지우기와 댓글 (결함 전수 점검 S2 · M14 · 2026-11-12)
--
-- 결함(S0 실측 RED 두 모양):
--   ① 같은 문구 공지를 다시 올리면 앱은 그 공지(남이 쓴 것일 수 있음) 행을 통째 upsert 한다(useWorkStore postNotice dup 갈래).
--      wf_update(0177·0285)는 작성자 본인만 고치게 해서 남의 공지면 매번 42501 이다(순차로도).
--   ② 공지를 지우는 동안 단 댓글이 고아로 남는다(10/10). 앱이 지울 때 아는 댓글만 따로 지우고(deleteFeedItem),
--      그 사이 들어온 댓글은 아무도 안 지운다.
-- 고침:
--   repost_notice     = 공지 다시 올리기. 남이 만든 행은 이 정의자 함수의 update 로만 고친다(작성자는 그대로).
--                       createdAt 을 지금으로, 읽음(read_by)을 비운다. 긴급 표시(important)는 관리자만 바꾼다(0319 도장 트리거와 같은 판정).
--   delete_feed_item  = 지우기 하나. 권한은 wf_delete 와 같다(작성자 또는 관리자 · 같은 매장 · 볼 수 있는 방). 댓글은 아래 트리거가 같이 지운다.
--   trg_work_feed_cascade_comments(AFTER DELETE) = 글이 지워지면 그 글에 단 댓글(kind comment · refId = 지운 id)을 같이 지운다.
--   trg_work_feed_comment_parent(BEFORE INSERT)   = 댓글을 넣을 때 부모 글을 for share 로 잡는다. 부모가 없으면(지워짐) feed_parent_gone.
--     두 트리거가 겹침을 막는다: 지우기가 먼저면 댓글은 커밋을 기다린 뒤 부모가 없어 진다 · 댓글이 먼저면 지우기가 기다린 뒤 그 댓글까지 지운다.
--     옛 앱의 직접 delete·upsert 에도 걸린다. 그래서 ② 는 옛 앱 길도 고쳐진다.
--   트리거 함수는 정의자다. 부모 행 잠금·남의 댓글 지우기가 RLS(wf_update·wf_delete 작성자 조건)를 지나야 해서다.
--     current_user 로 판정하지 않으므로 0319 의 invoker 규칙(도장 트리거)과 부딪치지 않는다.
--   댓글 찾기 인덱스 idx_wf_comment_ref(unit_id, refId) where kind = comment — 매장 삭제처럼 글이 한꺼번에 지워질 때 행마다 훑지 않게.
-- 남긴 것: ① 옛 앱의 남의 공지 upsert 는 옛 앱이 사라질 때까지 42501 이다(정책을 열면 남의 본문 고치기가 다시 열린다 · 0177 #30).
--
-- 옛 앱 호환: 안전 | 옛 앱의 work_feed upsert·delete 는 그대로 돈다. 바뀌는 것: 지운 글의 댓글이 같이 지워진다(앱이 하려던 일 ·
--   옛 앱이 따로 보내는 댓글 delete 는 0행 = already 로 실패가 아니다 · useWorkStore deleteFeedItem) · 지워진 글에 단 댓글은
--   feed_parent_gone 으로 진다(앱 write = boolean · "댓글" 실패 문구 · 원문은 reportError).
-- realtime: 표를 바꾸지 않는다(트리거가 지운 댓글도 DELETE 이벤트로 나간다).
-- 되돌리기: scripts/rollback/0635.sql

create index if not exists idx_wf_comment_ref
  on public.work_feed (unit_id, (data ->> 'refId'))
  where data ->> 'kind' = 'comment';

create or replace function public.tg_work_feed_comment_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text := new.data ->> 'refId';
begin
  if coalesce(new.data ->> 'kind', '') <> 'comment' or v_ref is null then return new; end if;
  -- 부모 글을 잡는다(지우기와 겹침을 가른다). 지우는 중이면 그 커밋을 기다린 뒤 다시 본다.
  perform 1 from public.work_feed f where f.id = v_ref and f.unit_id = new.unit_id for share;
  if not found then raise exception 'feed_parent_gone'; end if;
  return new;
end $$;
revoke all on function public.tg_work_feed_comment_parent() from public, anon, authenticated;
drop trigger if exists trg_work_feed_comment_parent on public.work_feed;
create trigger trg_work_feed_comment_parent before insert on public.work_feed
  for each row execute function public.tg_work_feed_comment_parent();

create or replace function public.tg_work_feed_cascade_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.data ->> 'kind', '') = 'comment' then return null; end if;
  delete from public.work_feed f
   where f.unit_id = old.unit_id and f.data ->> 'kind' = 'comment' and f.data ->> 'refId' = old.id;
  return null;
end $$;
revoke all on function public.tg_work_feed_cascade_comments() from public, anon, authenticated;
drop trigger if exists trg_work_feed_cascade_comments on public.work_feed;
create trigger trg_work_feed_cascade_comments after delete on public.work_feed
  for each row execute function public.tg_work_feed_cascade_comments();

create or replace function public.repost_notice(p_id text, p_important boolean default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  f      public.work_feed%rowtype;
  v_now  timestamptz := now();
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  select * into f from public.work_feed w where w.id = p_id for update;
  if not found or f.unit_id is distinct from v_unit
     or (f.room_id is not null and not public.can_see_room(f.room_id, v_unit)) then
    raise exception 'not_found';
  end if;
  if coalesce(f.data ->> 'kind', '') <> 'notice' then raise exception 'invalid_argument'; end if;
  update public.work_feed w
     set data = w.data
                || jsonb_build_object('createdAt', v_now, 'read_by', '[]'::jsonb)
                || case when p_important is not null and public.auth_can_manage()
                        then jsonb_build_object('important', p_important) else '{}'::jsonb end
   where w.id = p_id;
  return jsonb_build_object('status', 'ok', 'id', p_id, 'createdAt', v_now);
end $$;
comment on function public.repost_notice(text, boolean) is
  '0635 같은 문구 공지 다시 올리기(작성자 그대로 · createdAt 지금 · 읽음 비움 · important 는 관리자만). {status: ok, id, createdAt} · not_found · invalid_argument';
revoke all on function public.repost_notice(text, boolean) from public, anon;
grant execute on function public.repost_notice(text, boolean) to authenticated;

create or replace function public.delete_feed_item(p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  f      public.work_feed%rowtype;
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  select * into f from public.work_feed w where w.id = p_id for update;
  if not found then return jsonb_build_object('status', 'already'); end if;
  if f.unit_id is distinct from v_unit or (f.room_id is not null and not public.can_see_room(f.room_id, v_unit)) then
    return jsonb_build_object('status', 'already');   -- 남의 매장 행은 있다는 것도 알리지 않는다
  end if;
  -- wf_delete(0177 · 0285)와 같은 판정: 작성자 본인 또는 관리자.
  if coalesce(f.data ->> 'authorId', '') <> v_uid::text and not public.auth_can_manage() then raise exception 'forbidden'; end if;
  delete from public.work_feed w where w.id = p_id;   -- 댓글은 trg_work_feed_cascade_comments 가 같이 지운다
  return jsonb_build_object('status', 'ok');
end $$;
comment on function public.delete_feed_item(text) is
  '0635 피드 글 지우기(작성자 또는 관리자). 그 글의 댓글도 같이 지운다. {status: ok|already} · forbidden';
revoke all on function public.delete_feed_item(text) from public, anon;
grant execute on function public.delete_feed_item(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.repost_notice(text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_feed_item(text)', 'execute') then
    raise exception '0635: 실행 권한이 틀렸다';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.work_feed'::regclass and not tgisinternal
        and tgname in ('trg_work_feed_comment_parent', 'trg_work_feed_cascade_comments')) <> 2 then
    raise exception '0635: 트리거가 없다';
  end if;
end $$;
