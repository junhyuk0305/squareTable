-- 0582_suggestion_cleanup.sql — 매장 제안 결함 둘: 해결된 질문의 남은 제안 정리 · 취소 때 출처 칸 (야간 작업 11-11 · sb)
--
-- 정본: 야간작업_2026-11-11/계약.md 1-3 · 7절 가결정 12 · 조사_착수 3절 b·d
--
-- ① 남은 제안 정리(트리거 trg_uq_close_pending_suggestions · AFTER UPDATE OF status on unknown_queries)
--   결함: 질문이 해결돼도(직접 답 · 다른 제안 승인 · 기각) 그 질문에 달린 다른 직원 제안이 대기로 남아 검토함·벨에 계속 떴다.
--   규칙: 질문이 대기(pending_owner_answer)에서 벗어나면 그 질문(source_uq_id)의 다른 대기 제안을
--     rejected · reviewed_at = now() · owner_note = '다른 답으로 해결된 질문이에요.' 로 바꾼다.
--   빼는 것: 승인으로 해결된 경우(approved_by 있음) 그 답 쓴 사람(answer_author_id)의 제안 = 지금 승인되는 그 제안.
--     from_space 행은 대상이 아니다(source_uq_id 가 없다 · 그래도 kind 로 한 번 더 뺀다).
--   푸시는 안 보낸다(결과는 벨 파생으로 보인다 · 가결정 12).
--   옛 사장 앱 승인 길(답 저장 → 제안 승인 두 번 쓰기)에서는 그 제안이 잠깐 반려됐다가 앱의 승인 update 가 덮는다.
--     ps_update 정책(0093)은 상태 전이를 막지 않는다 → 최종 상태는 승인이다(가결정 12).
--   정의자 함수라 current_user = 소유자 → 0319 도장 트리거가 건너뛴다(reviewed_by 는 비어 있다 = 사람이 반려하지 않았다).
--   0490 from_space 가드는 from_space 행만 본다 → 이 update 와 무관.
--   같은 표의 다른 트리거: 0382 guard_unknown_query_write(BEFORE)와 A줄 trg_uq_answer_notice(AFTER)는 서로의 결과를 읽지 않는다.
--
-- ② 취소 때 출처 칸(playbook_suggestions_withdrawn + suggestion_withdraw)
--   결함: 0355 보관 표에 0490 출처 칸 셋(source_unit_id · source_entry_id · source_snapshot)이 없어 공간 제안을 취소하면 출처가 사라졌다.
--   칸 셋을 null 허용으로 더하고 suggestion_withdraw 가 같이 옮긴다. 서명·반환·오류 코드 그대로.
--
-- ③ publication: g5 실시간에 필요한 표(playbook_entries · unknown_queries)가 supabase_realtime 에 없을 때만 더한다.
--
-- 옛 앱 호환(⑪ 확장만): 새 트리거 하나 · 칸 셋(null 허용) · 함수 본문 확장. 옛 취소 길(suggestion_withdraw)은 그대로 돈다.
-- 재정의 3단계(AGENTS ⑧): suggestion_withdraw 정의 전수 = 0355 하나 → 0355 본문 통째 · 주석 옮김. 적용 뒤 qa:suggestion-edit:local.

-- ════════════════════════════════════════════════════════════════════════════
-- ① 남은 제안 정리
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_uq_close_pending_suggestions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending_owner_answer' and new.status is distinct from 'pending_owner_answer' then
    update public.playbook_suggestions ps
       set status = 'rejected',
           reviewed_at = now(),
           owner_note = '다른 답으로 해결된 질문이에요.'
     where ps.source_uq_id = new.id
       and ps.unit_id = new.unit_id
       and ps.status = 'pending'
       and ps.kind <> 'from_space'
       -- 승인으로 해결됐으면 그 답 쓴 사람(= 승인되는 제안의 제안자)의 제안은 둔다. 그 제안은 승인 흐름이 처리한다.
       and not (new.approved_by is not null and new.answer_author_id is not null and ps.proposer_id = new.answer_author_id);
  end if;
  return null;
end $$;
comment on function public.tg_uq_close_pending_suggestions() is
  '0582 질문이 대기에서 벗어나면 그 질문의 다른 대기 제안을 반려(메모 = 다른 답으로 해결된 질문이에요.)로 바꾼다. 푸시 없음.';
revoke all on function public.tg_uq_close_pending_suggestions() from public, anon, authenticated;

drop trigger if exists trg_uq_close_pending_suggestions on public.unknown_queries;
create trigger trg_uq_close_pending_suggestions
  after update of status on public.unknown_queries
  for each row execute function public.tg_uq_close_pending_suggestions();

-- ════════════════════════════════════════════════════════════════════════════
-- ② 보관 표 출처 칸 + suggestion_withdraw
-- ════════════════════════════════════════════════════════════════════════════
alter table public.playbook_suggestions_withdrawn
  add column if not exists source_unit_id  text,
  add column if not exists source_entry_id text,
  add column if not exists source_snapshot jsonb;
comment on column public.playbook_suggestions_withdrawn.source_unit_id  is '0582 취소한 공간 제안의 보낸 공간 번호(0490 원래 칸 그대로)';
comment on column public.playbook_suggestions_withdrawn.source_entry_id is '0582 취소한 공간 제안의 원본 노하우 번호';
comment on column public.playbook_suggestions_withdrawn.source_snapshot is '0582 취소한 공간 제안의 보낼 때 본문';

-- 0355 머리말(옮김):
--   suggestion_withdraw(p_id text) returns void — 본인 제안 · pending 일 때만 → 보관 테이블로 옮기고 원래 행 delete.
--   오류 = 맨 앞에서 끝낸다(AGENTS ⑨): not_found(남의 매장 행 포함) · forbidden(로그인 안 함 · 제안자가 아님 · 그 매장 멤버가 아님) ·
--     not_pending(이미 검토됨). 검사 순서 = 존재 → 권한 → 상태. 남의 제안이면 상태를 알려 주지 않는다.
--   옛 앱에게 취소는 "행이 사라짐"이다(표에 없는 상태 'withdrawn' 이 내려가면 옛 앱 칩 색 조회가 죽는다 · 2026-11-05 사용자 결정).
--   배지·알림: 검토 대기 수는 status = 'pending' 파생이라 행이 지워지면 자연히 준다.
create or replace function public.suggestion_withdraw(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
begin
  select * into r from public.playbook_suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_uid is null or r.proposer_id <> v_uid
     or not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = r.unit_id) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  insert into public.playbook_suggestions_withdrawn (
    id, unit_id, kind, target_entry_id, target_title, proposer_id, proposer_name, text, photos, status,
    owner_note, resulting_entry_id, created_at, reviewed_at, reviewed_by, source_template_id, source_uq_id,
    source_unit_id, source_entry_id, source_snapshot,   -- ★0582 출처 칸 셋(0490)
    withdrawn_at, withdrawn_by)
  values (
    r.id, r.unit_id, r.kind, r.target_entry_id, r.target_title, r.proposer_id, r.proposer_name, r.text, r.photos, r.status,
    r.owner_note, r.resulting_entry_id, r.created_at, r.reviewed_at, r.reviewed_by, r.source_template_id, r.source_uq_id,
    r.source_unit_id, r.source_entry_id, r.source_snapshot,   -- ★0582
    now(), v_uid);
  delete from public.playbook_suggestions where id = p_id;
end $$;
revoke execute on function public.suggestion_withdraw(text) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ publication(없을 때만)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0582: supabase_realtime publication 없음 · 건너뜀';
    return;
  end if;
  foreach t in array array['playbook_entries', 'unknown_queries'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice '0582: publication 에 % 더함', t;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare d text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_uq_close_pending_suggestions'
                   and tgrelid = 'public.unknown_queries'::regclass and not tgisinternal) then
    raise exception '0582 자가점검 실패 — 남은 제안 정리 트리거가 없다';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'playbook_suggestions_withdrawn'
         and column_name in ('source_unit_id', 'source_entry_id', 'source_snapshot')) <> 3 then
    raise exception '0582 자가점검 실패 — 보관 표 출처 칸';
  end if;
  d := pg_get_functiondef('public.suggestion_withdraw(text)'::regprocedure);
  if position('r.source_snapshot' in d) = 0 or position('r.source_uq_id' in d) = 0 then
    raise exception '0582 자가점검 실패 — suggestion_withdraw 가 출처 칸을 안 옮긴다';
  end if;
  if has_function_privilege('anon', 'public.suggestion_withdraw(text)', 'execute') then
    raise exception '0582 자가점검 실패 — suggestion_withdraw 가 anon 에 열렸다';
  end if;
  raise notice '0582 자가점검 통과';
end $$;
