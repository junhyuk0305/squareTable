-- 0634_unknown_query_submit.sql — 받은 질문 보내기: 같은 질문 합치기와 유사 수 +1 을 서버가 (결함 전수 점검 S2 · M13 · 2026-11-12)
--
-- 결함(S0 실측 RED 10/10 두 모양):
--   ① 같은 대기 질문에 두 직원이 동시에 "같은 질문"을 보내면 유사 수가 1만 는다. 앱이 "내 화면 값 + 1" 을 쓰고(useUnknownQueueStore enqueue ·
--      db.ts bumpUnknownSimilar), 0382 트리거는 "한 번에 1만 오른다"로 둘째를 0 으로 만든다.
--   ② 같은 첫 질문을 둘이 동시에 보내면 대기 행이 2개다(중복 판정이 앱 메모리 목록만 본다).
-- 고침: submit_unknown_query 하나. (매장, 다듬은 질문 글) 단위 advisory 잠금을 잡고 → 대기 중 같은 글이 있으면 유사 수 = 지금 값 + 1 →
--   없으면 새로 넣는다. 잠금이 판정 전에 있어 둘째는 첫째 커밋 뒤에 판정한다(race 규칙 2).
--   SECURITY INVOKER 다. uq_insert·uq_update 정책과 트리거(stamp_author 작성자 · guard_unknown_query_write 이름·초기값·+1 상한 ·
--   cap_pending_escalations 대기 10개 상한 too_many_pending)를 그대로 탄다. 그래서 작성자·이름·상태를 앱이 정하지 못한다.
--   "같은 질문" 판정은 앱과 같은 btrim 일치다. 내가 볼 수 있는 대기 행만 합친다(RLS · 앱 화면과 같은 범위).
-- 남긴 것: 옛 앱의 직접 insert·update 는 그대로다. 옛 앱 둘이 겹칠 때의 두 모양(①②)은 옛 앱이 사라질 때까지 남는다.
--   대기 행 unique 는 넣지 않는다. 옛 앱의 둘째 보내기가 "질문을 등록하지 못했어요"로 실패하는 편이 중복 한 줄보다 나쁘다.
--
-- 옛 앱 호환: 안전 | 새 함수 하나만 더한다. 표·정책·트리거 그대로(옛 앱 insertUnknown·bumpUnknownSimilar 그대로 돈다).
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0634.sql

create or replace function public.submit_unknown_query(
  p_id text,
  p_query_text text,
  p_unit_id text default null,
  p_presumed_category text default null,
  p_best_match_confidence numeric default 0,
  p_best_match_entry_id text default null,
  p_asked_at timestamptz default null
) returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_uid  text := auth.uid()::text;
  v_unit text := coalesce(nullif(btrim(coalesce(p_unit_id, '')), ''), public.auth_unit_id());
  v_text text := btrim(coalesce(p_query_text, ''));
  v_at   timestamptz := coalesce(p_asked_at, now());
  v_hit  text;
  v_cnt  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  if coalesce(btrim(p_id), '') = '' or length(p_id) > 120 or v_text = '' or length(v_text) > 2000 then
    raise exception 'invalid_argument';
  end if;
  if v_at > now() + interval '10 minutes' then v_at := now(); end if;

  -- race: (매장, 질문 글) 단위로 판정 전에 잠근다. 같은 질문 동시 보내기는 여기서 한 줄로 선다.
  perform pg_advisory_xact_lock(hashtextextended('uq_submit:' || v_unit || ':' || v_text, 634));

  select u.id into v_hit from public.unknown_queries u
   where u.unit_id = v_unit and u.status = 'pending_owner_answer' and btrim(u.query_text) = v_text and u.id <> p_id
   order by u.asked_at asc
   limit 1;

  if v_hit is not null then
    update public.unknown_queries u set similar_queries_count = u.similar_queries_count + 1
     where u.id = v_hit
    returning u.similar_queries_count into v_cnt;
    if not found then raise exception 'not_found'; end if;   -- RLS 가 고치기를 막았다
    return jsonb_build_object('status', 'merged', 'id', v_hit, 'similar_queries_count', v_cnt);
  end if;

  -- 같은 요청 재시도(응답 유실): 내 행이 이미 있으면 그대로 돌려준다.
  if exists (select 1 from public.unknown_queries u where u.id = p_id and u.unit_id = v_unit and u.junior_id = v_uid) then
    return jsonb_build_object('status', 'created', 'id', p_id, 'similar_queries_count', 0);
  end if;

  -- 열 값은 앱 buildDeflect(useChatStore)와 같다. 작성자·이름·상태 초기값은 트리거가 다시 찍는다.
  insert into public.unknown_queries (
    id, unit_id, junior_id, junior_name, query_text, asked_at, presumed_category, presumed_subcategory,
    match_attempted, best_match_confidence, best_match_entry_id, status, fallback_action,
    owner_notified_at, owner_will_answer, similar_queries_count, ai_general_answer)
  values (
    p_id, v_unit, v_uid, '', v_text, v_at, nullif(btrim(coalesce(p_presumed_category, '')), ''), '',
    true, coalesce(p_best_match_confidence, 0), p_best_match_entry_id, 'pending_owner_answer', '사장님께 알림 전송됨',
    v_at, true, 0, '잠시만요, 사장님 답변을 기다리고 있어요.');
  return jsonb_build_object('status', 'created', 'id', p_id, 'similar_queries_count', 0);
end $$;
comment on function public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz) is
  '0634 받은 질문 보내기. 대기 중 같은 글이 있으면 유사 수 +1(merged), 없으면 새 행(created). {status, id, similar_queries_count} · too_many_pending · invalid_argument';
revoke all on function public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz) to authenticated;

do $$
begin
  if (select prosecdef from pg_proc where oid = 'public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz)'::regprocedure) then
    raise exception '0634: 정의자다 — 질문 트리거(작성자·이름·상한)가 건너뛴다';
  end if;
end $$;
