-- 0551_space_member_ask.sql — 공간 멤버 묻기 서버 · 답 알림(N4) · 공간 벨 공급 (2026-11-11 밤 · 야간 작업 s1 · 계약 1-1 (나))
-- 옛 앱 호환: 안전 | 새 함수 넷 + unknown_queries 에 AFTER 트리거 하나 + cap_pending_escalations 한 줄(공간만 빼기).
--   옛 앱은 공간을 모른다(공간 입구 = 허용 목록 계정만). 트리거는 공간 행과 링크 질문 행에서만 알림을 넣는다.
--   매장 앱 안 질문(매장 · link_id 없음)은 지금 앱 길(push_client_event_v2 q-answered) 그대로라 건드리지 않는다.
--
-- 정본: 계약 1-1 (나) · 사용자 결정 11-11 밤 6(멤버는 무조건 묻는다 · 결정 146 "보낼까요?" · 결정 150 내 질문만)
--   · 알림사건 N4(답 → 질문한 사람) · 화면지도 S17.
--
-- ── 질문 처리 순서(멤버 · S17) ─────────────────────────────────────────────────
--   멤버 화면은 매장처럼 질문 기록(chat_queries)을 RLS 로 넣고(0371 cq_insert · 멤버 ask 권한 0368) AI 엣지 공간 갈래(placeUser)로 답을 받는다.
--   노하우에 없으면 "보낼까요?"를 확인한 뒤 ① space_question_send 를 부른다. 그 순간 답할 질문(대기)이 생기고 주인에게 알림이 간다.
--   AI 를 다 썼을 때도 같은 함수로 보낸다(멤버 묻기에는 손님처럼 "묻는 순간 바로 보내기" 갈래를 따로 두지 않는다 · 화면이 고른다).
--
-- ── 무엇을 더하나 ───────────────────────────────────────────────────────────
--   ① space_question_send(space, text) → 답할 질문 번호. 멤버만(주인 = practice_only · 남 = not_space_member).
--      같은 사람·같은 공간·같은 글의 대기 질문이 있으면 그 번호(알림 없음 · 두 번 눌러도 한 번 · 가결정 8).
--      묻기 제한·스위치 없음(결정 4·6). 알림 적재 실패는 질문을 되돌리지 않는다.
--   ② space_my_questions(space) — 내가 그 공간에 물은 답할 질문 최근 50(결정 150 · 남의 질문은 안 준다).
--   ③ 트리거 trg_uq_answer_notice — 대기 → 답함(노하우 · 보내기 답)으로 바뀐 순간 질문한 사람에게 question_answered(N4).
--      공간 멤버 질문 → 그 멤버(아직 멤버일 때만) · 링크 질문 → 그 손님 행을 옮겨 받은 계정(링크가 살아 있을 때만).
--      답 쓴 사람 본인은 뺀다. 같은 사건 키 q-answered:<uq> 를 push_client_events 에도 넣어 앱 길과 겹치지 않게 한다(0339 모양).
--      ★지연 트리거(커밋 때 돈다): reply_unknown_query(0378)는 상태를 먼저 바꾸고 답 글(question_replies)을 뒤에 넣는다.
--        바로 도는 트리거면 답 글을 못 읽어 본문이 질문 글로 떨어진다. 그래서 constraint trigger · deferrable initially deferred.
--      실패해도 답 저장을 되돌리지 않는다(예외를 잡아 경고만).
--   ④ my_space_notif_data() — 계정 층 벨 공급(역 ⑩). 넷: space_question · space_answered · link_answered · space_deleted.
--   ⑤ cap_pending_escalations — 베이스 0033 본문(정의 전수 = 0033 하나). ★0551 공간 자리는 세지 않는다(결정 6 · 멤버는 무조건 묻는다).
--      직원당 대기 10개 상한은 매장 도배 방지(남용 #18)라 매장은 그대로다. 공간은 주인 1명이 멤버를 직접 초대해 들인다.
--      (가결정 · 계약 2절 표 밖 객체라 기록에 적었다. 같은 표 unknown_queries 는 A줄 담당이다.)
--
-- 되돌리기: scripts/rollback/0551.sql
--
-- 오류 코드(문구 = src/lib/place/errors.ts): not_authenticated · not_space_member · practice_only(★새) · invalid_argument.

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ cap_pending_escalations (0033 본문 · ★0551 공간 빼기)
--   0033 머리말: 같은 매장에서 그 직원의 '대기(pending_owner_answer)' 미해결 질문이 CAP개 이상이면 새 에스컬레이션 INSERT 를 거부(too_many_pending).
--   ⚠️ 트리거 발화 순서: BEFORE INSERT 트리거는 이름 알파벳 순. 작성자 도장(trg_stamp_author_uq, 0007)이 new.junior_id := auth.uid() 로
--   덮어쓴 "뒤에" 카운트해야 junior_id 스푸핑으로 캡을 우회할 수 없다 → 이름을 'trg_z_…'로 둬 stamp 트리거 다음에 돈다(트리거는 그대로).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cap_pending_escalations()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_cap   int := 10;  -- 직원당 동시 미해결 대기 질문 상한
begin
  if new.status = 'pending_owner_answer' and new.junior_id is not null
     -- ★0551: 공간은 세지 않는다(결정 6 · 멤버는 무조건 묻는다). 매장은 0033 그대로.
     and not exists (select 1 from public.units u where u.id = new.unit_id and u.kind = 'space') then
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

-- ════════════════════════════════════════════════════════════════════════════
-- ① 멤버가 주인에게 보내기
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_question_send(p_space text, p_text text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_text  text := btrim(coalesce(p_text, ''));
  v_role  text;
  v_sname text;
  v_who   text;
  v_uq    text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select m.role, u.store_name into v_role, v_sname
    from public.unit_members m join public.units u on u.id = m.unit_id
   where m.unit_id = p_space and m.user_id = v_uid
     and u.kind = 'space' and u.deleted_at is null and u.purged_at is null;
  if v_role = 'space_owner' then raise exception 'practice_only'; end if;   -- 주인 질문은 연습(저장 안 함 · S05 연습 묻기)
  if v_role is distinct from 'space_member' then raise exception 'not_space_member'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then raise exception 'invalid_argument'; end if;

  -- 두 번 눌러도 한 번(가결정 8): 같은 사람·같은 공간을 줄 세운 뒤 같은 글의 대기 질문을 찾는다.
  perform pg_advisory_xact_lock(hashtext('space-q:' || p_space || ':' || v_uid::text));
  select q.id into v_uq from public.unknown_queries q
   where q.unit_id = p_space and q.junior_id = v_uid::text and q.status = 'pending_owner_answer'
     and q.link_id is null and q.query_text = v_text
   order by q.asked_at desc limit 1;
  if v_uq is not null then return v_uq; end if;

  v_uq := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_who := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = v_uid), '멤버');
  -- junior_id 는 작성자 도장(0007)이 auth.uid() 로 다시 찍고, 이름은 쓰기 보호(0382)가 프로필 이름으로 맞춘다.
  insert into public.unknown_queries (id, unit_id, junior_id, junior_name, query_text, status)
  values (v_uq, p_space, v_uid::text, v_who, v_text, 'pending_owner_answer');

  -- 주인 알림(N 공간 멤버 질문 · 질문마다 · 결정 5). 받는 사람 = 넣는 시점의 space_owner(AGENTS ③).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    select m.user_id, p_space, 'question', v_sname, public._push_snippet(v_who, 20),
           format('%s님의 질문', public._push_snippet(v_who, 20)),
           public._push_snippet(v_text, 120),
           format('/space/answer/%s?space=%s', v_uq, p_space), v_uid
      from public.unit_members m
     where m.unit_id = p_space and m.role = 'space_owner' and m.user_id <> v_uid;
  exception when others then
    raise warning 'space question notice skipped for %: %', v_uq, sqlerrm;
  end;
  return v_uq;
end $$;
revoke all on function public.space_question_send(text, text) from public, anon;
grant execute on function public.space_question_send(text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 내 질문 읽기 (결정 150 · 남의 질문·손님 질문은 안 준다)
--   state: answered(노하우로 해결 · 보내기 답) · waiting(그 밖 · 대기 등). entry_* 는 해결 노하우가 지금 그 공간에 발행돼 있을 때만.
--   answered_at = 보내기 답 시각(노하우 답은 null · edu_link_answers 와 같은 규칙).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_my_questions(p_space text)
returns table (uq_id text, query_text text, asked_at timestamptz, state text, reply_body text,
               entry_id text, entry_title text, entry_square jsonb, answered_at timestamptz, answerer_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or not exists (select 1 from public.unit_members m join public.units u on u.id = m.unit_id
                     where m.unit_id = p_space and m.user_id = v_uid and u.kind = 'space' and u.deleted_at is null) then
    raise exception 'not_space_member';
  end if;
  return query
    select q.id, q.query_text, q.asked_at,
           case when q.status in ('resolved_with_entry', 'answered_direct') then 'answered' else 'waiting' end,
           case when q.status = 'answered_direct' then qr.body end,
           pe.id, pe.title, pe.square,
           case when q.status = 'answered_direct' then qr.created_at end,
           case when q.status in ('resolved_with_entry', 'answered_direct') then
             coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = q.answer_author_id),
                      (select nullif(btrim(p.name), '') from public.profiles p where p.id = q.answered_by)) end
      from public.unknown_queries q
      left join lateral (select r.body, r.created_at from public.question_replies r
                          where r.uq_id = q.id order by r.created_at desc limit 1) qr on true
      left join public.playbook_entries pe
        on q.status = 'resolved_with_entry' and pe.id = q.resolved_with_entry_id and pe.unit_id = q.unit_id
       and pe.status = 'published' and pe.archived_at is null and pe.brand_hidden_at is null
     where q.unit_id = p_space and q.junior_id = v_uid::text and q.link_id is null
     order by q.asked_at desc
     limit 50;
end $$;
revoke all on function public.space_my_questions(text) from public, anon;
grant execute on function public.space_my_questions(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 답 알림 (N4) — 지연 트리거
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_uq_answer_notice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind    text;
  v_uname   text;
  v_author  uuid := coalesce(new.answer_author_id, new.answered_by, auth.uid());
  v_aname   text;
  v_body    text;
  v_target  uuid;
  v_url     text;
  v_key     text := 'q-answered:' || new.id;
begin
  if old.status is distinct from 'pending_owner_answer' or new.status not in ('resolved_with_entry', 'answered_direct') then
    return null;
  end if;
  begin
    select u.kind, u.store_name into v_kind, v_uname from public.units u where u.id = new.unit_id;

    if v_kind = 'space' and new.link_id is null and new.junior_id ~ '^[0-9a-fA-F-]{36}$' then
      -- ① 공간 멤버 질문 → 그 멤버(아직 멤버일 때만 · 나간 사람은 그 화면을 못 연다)
      select m.user_id into v_target from public.unit_members m
       where m.unit_id = new.unit_id and m.user_id = new.junior_id::uuid and m.role = 'space_member';
      v_url := format('/space/joined/%s?uqId=%s', new.unit_id, new.id);
    elsif new.link_id is not null then
      -- ② 링크 질문 → 그 손님 행을 옮겨 받은 계정(링크가 살아 있을 때만 · 닫히면 전부 끊김)
      if (public._edu_link_by_id(new.link_id)).id is null then return null; end if;
      select g.claimed_by into v_target
        from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
       where q.uq_id = new.id;
      v_url := format('/link/%s?uqId=%s', new.link_id, new.id);
    else
      return null;   -- 매장 앱 안 질문은 지금 앱 길 그대로
    end if;
    if v_target is null or v_target is not distinct from v_author then return null; end if;
    if exists (select 1 from public.profiles p where p.id = v_target and p.deleted_at is not null) then return null; end if;

    -- 같은 사건 한 번(앱 길 push_client_event_v2 와 같은 키 · 같은 잠금 이름).
    perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
    if exists (select 1 from public.push_client_events e where e.key = v_key and e.sent_at > now() - interval '24 hours') then
      return null;
    end if;

    v_aname := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = new.answer_author_id),
                        (select nullif(btrim(p.name), '') from public.profiles p where p.id = new.answered_by),
                        case when v_kind = 'space' then '공간 주인' else '사장님' end);
    if new.status = 'answered_direct' then
      select r.body into v_body from public.question_replies r where r.uq_id = new.id order by r.created_at desc limit 1;
    end if;
    v_body := public._push_snippet(coalesce(nullif(btrim(v_body), ''), new.query_text), 120);

    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    values (v_target, new.unit_id, 'question_answered', v_uname, public._push_snippet(v_aname, 20),
            format('%s님이 내 질문에 답했어요', public._push_snippet(v_aname, 20)), v_body, v_url, v_author);
    insert into public.push_client_events (key) values (v_key);
  exception when others then
    raise warning 'question answered notice skipped for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tg_uq_answer_notice() from public, anon, authenticated;

drop trigger if exists trg_uq_answer_notice on public.unknown_queries;
create constraint trigger trg_uq_answer_notice
  after update of status on public.unknown_queries
  deferrable initially deferred
  for each row
  when (old.status = 'pending_owner_answer' and new.status in ('resolved_with_entry', 'answered_direct'))
  execute function public.tg_uq_answer_notice();

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 공간 벨 공급 (계정 층 · 역 ⑩)
--   space_question  = 내가 주인인 살아 있는 공간의 대기 질문(멤버 질문 + 링크 질문 · 최근 50). 대기 행에서 파생(처리하면 사라진다).
--   space_answered  = 내가 그 공간에 물은 질문 중 14일 안에 답 알림이 온 것(아직 멤버 · 아직 답함).
--   link_answered   = 내가 옮겨 받은 손님 질문 중 14일 안에 답 알림이 온 것(링크가 살아 있을 때만).
--   space_deleted   = 나에게 온 공간 삭제 알림 14일.
--   답 알림 둘의 시각은 그 알림 행(question_answered)에서 읽는다. 답할 질문 표에는 답한 시각 칸이 없다.
--   손님 번호·남의 질문은 안 준다(결정 150). 지운 공간은 빼고, 자리 잠김 규칙은 my_units_notif_data(0314)와 같게 멤버에게만 건다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_space_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  mine as (
    select m.unit_id, m.role, u.store_name
      from public.unit_members m join public.units u on u.id = m.unit_id, me
     where me.uid is not null and m.user_id = me.uid
       and u.kind = 'space' and u.deleted_at is null and u.purged_at is null
       and not (m.role = 'space_member' and public.unit_access_locked(m.unit_id))
  ),
  qa as (   -- 나에게 온 답 알림(14일) · url 의 uqId 로 질문을 찾는다
    select n.id as notice_id, n.unit_id, n.created_at, n.actor_name, n.url,
           substring(n.url from 'uqId=([A-Za-z0-9_-]+)') as uq_id,
           substring(n.url from '^/link/([A-Za-z0-9_-]+)') as link_id
      from public.member_notices n, me
     where n.user_id = me.uid and n.kind = 'question_answered'
       and n.created_at > now() - interval '14 days'
       and (n.url like '/space/joined/%' or n.url like '/link/%')
  )
  select x.unit_id, 'space_question'::text, x.payload
    from (
      select q.unit_id,
             jsonb_build_object('id', q.id, 'query_text', q.query_text, 'junior_name', q.junior_name,
                                'asked_at', q.asked_at, 'from_link', q.link_id is not null, 'space_name', mi.store_name) as payload,
             row_number() over (partition by q.unit_id order by q.asked_at desc) as rn
        from public.unknown_queries q join mine mi on mi.unit_id = q.unit_id and mi.role = 'space_owner'
       where q.status = 'pending_owner_answer'
    ) x where x.rn <= 50

  union all
  select qa.unit_id, 'space_answered'::text,
         jsonb_build_object('id', q.id, 'notice_id', qa.notice_id, 'query_text', q.query_text, 'answered_at', qa.created_at,
                            'answerer_name', qa.actor_name, 'space_name', mi.store_name)
    from qa
    join mine mi on mi.unit_id = qa.unit_id and mi.role = 'space_member'
    join public.unknown_queries q on q.id = qa.uq_id and q.unit_id = qa.unit_id
    cross join me
   where qa.url like '/space/joined/%'
     and q.junior_id = me.uid::text and q.status in ('resolved_with_entry', 'answered_direct')

  union all
  select qa.unit_id, 'link_answered'::text,
         jsonb_build_object('id', q.id, 'notice_id', qa.notice_id, 'link_id', qa.link_id, 'query_text', q.query_text,
                            'answered_at', qa.created_at, 'answerer_name', qa.actor_name)
    from qa
    join public.unknown_queries q on q.id = qa.uq_id and q.link_id = qa.link_id
    cross join me
   where qa.url like '/link/%'
     and q.status in ('resolved_with_entry', 'answered_direct')
     and (public._edu_link_by_id(qa.link_id)).id is not null
     and exists (select 1 from public.edu_guest_questions gq join public.edu_link_guests g on g.id = gq.guest_id
                  where gq.uq_id = q.id and g.claimed_by = me.uid)

  union all
  select n.unit_id, 'space_deleted'::text,
         jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'space_name', n.store_name, 'created_at', n.created_at)
    from public.member_notices n, me
   where n.user_id = me.uid and n.kind = 'space_deleted' and n.created_at > now() - interval '14 days'
$$;
revoke all on function public.my_space_notif_data() from public, anon;
grant execute on function public.my_space_notif_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public.space_question_send(text,text)', 'public.space_my_questions(text)', 'public.my_space_notif_data()'] loop
    if has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 가능) '; end if;
    if not has_function_privilege('authenticated', fn, 'execute') then v_bad := v_bad || '(' || fn || ' 로그인 실행 불가) '; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.tg_uq_answer_notice()', 'execute') then
    v_bad := v_bad || '(트리거 함수가 클라에 열려 있다) ';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_uq_answer_notice' and tgrelid = 'public.unknown_queries'::regclass
                    and tgdeferrable and tginitdeferred) then
    v_bad := v_bad || '(답 알림 트리거가 지연 트리거가 아니다) ';
  end if;
  if (select prosrc from pg_proc where oid = 'public.cap_pending_escalations()'::regprocedure) !~ 'too_many_pending' then
    v_bad := v_bad || '(매장 대기 상한이 사라졌다) ';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('space_question_send', 'space_my_questions', 'tg_uq_answer_notice', 'my_space_notif_data', 'cap_pending_escalations')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  if v_bad <> '' then raise exception '0551 자가점검 실패: %', v_bad; end if;
end $$;
