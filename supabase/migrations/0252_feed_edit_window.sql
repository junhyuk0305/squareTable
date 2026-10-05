-- 0252_feed_edit_window.sql — 내 채팅 메시지는 24시간 안에만 고친다 (J15 ② · 2026-10-05 사용자 결정 · 보안 L3)
--
-- ① edit_feed_text(0177 본문 통째 복사) — kind='message' 면 createdAt 24시간 안일 때만 고친다(edit_window_passed).
--    고치면 data.editedAt 을 남긴다(앱 "(수정됨)"). 공지는 지금처럼 기간 제한이 없다.
--    "본인 것만"은 지금처럼 wf_update 정책이 판정한다(invoker). 남의 글이면 0행 = false.
-- ② work_feed BEFORE UPDATE 트리거 — 옛 앱·직접 UPDATE 도 같은 24시간 규칙. 본문(text)이 바뀔 때만 본다.
--    앱 요청(current_user = authenticated)만 막는다. 정의자 RPC(읽음·반응·고정 0176)와 service_role 은 그대로다.
--    옛 앱은 메시지 본문을 고치는 화면이 없다(공지만) → 옛 앱 동작은 바뀌지 않는다.
-- 되돌리기: drop trigger trg_work_feed_edit_window on public.work_feed; 그리고 0177 의 edit_feed_text 를 다시 적용.

create or replace function public.edit_feed_text(p_feed_id text, p_text text)
returns boolean language plpgsql volatile security invoker set search_path = public as $$
declare v_n int;
begin
  if p_text is null then return false; end if;
  -- ★0252: 24시간 규칙은 아래 트리거가 판정한다(직접 UPDATE 와 한 곳). 여기서는 editedAt 을 함께 남긴다.
  update public.work_feed
     set data = jsonb_set(jsonb_set(data, '{text}', to_jsonb(p_text), true),
                          '{editedAt}', to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true)
   where id = p_feed_id;
  get diagnostics v_n = row_count;
  return v_n > 0;   -- 0행 = RLS 차단(남의 글) 또는 대상 없음. 유령 성공 금지.
end $$;
revoke execute on function public.edit_feed_text(text, text) from public, anon, authenticated;
grant  execute on function public.edit_feed_text(text, text) to authenticated;

create or replace function public.tg_work_feed_edit_window()
returns trigger language plpgsql set search_path = public as $$
declare v_at timestamptz;
begin
  if current_user <> 'authenticated' then return new; end if;
  if coalesce(old.data->>'kind', '') <> 'message' then return new; end if;
  if (new.data->>'text') is not distinct from (old.data->>'text') then return new; end if;
  begin
    v_at := (old.data->>'createdAt')::timestamptz;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < now() - interval '24 hours' then
    raise exception 'edit_window_passed';
  end if;
  return new;
end $$;
revoke all on function public.tg_work_feed_edit_window() from public, anon, authenticated;

drop trigger if exists trg_work_feed_edit_window on public.work_feed;
create trigger trg_work_feed_edit_window
  before update on public.work_feed
  for each row execute function public.tg_work_feed_edit_window();

-- 자가점검
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_work_feed_edit_window' and not tgisinternal) then
    raise exception '0252: 24시간 트리거가 없다';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.tg_work_feed_edit_window()'::regprocedure) then
    raise exception '0252: 트리거 함수가 정의자다 — current_user 판정이 깨진다';
  end if;
  if has_function_privilege('anon', 'public.edit_feed_text(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.edit_feed_text(text, text)', 'execute') then
    raise exception '0252: edit_feed_text 권한이 어긋났다';
  end if;
end $$;
