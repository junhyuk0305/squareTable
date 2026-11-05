-- 0355_suggestion_withdraw_edit.sql — 직원이 자기 대기 제안을 취소·수정한다 (2026-11-05 · 줄기 A1)
-- 옛 앱 호환: 안전 · 새 테이블 1개 + 새 함수 2개 추가만 · playbook_suggestions 의 열·CHECK·RLS·트리거·publication 무변경
--   옛 앱(ios-v1.1.0·android-v1.1.0)은 owner/suggestions.tsx:60 에서 status !== 'pending' 전부를 '처리됨'에 그리고
--   :142 STATUS_CHIP[s.status].bg 로 칩 색을 고른다. junior/suggest.tsx:245 도 같다. 표에 없는 상태('withdrawn')가
--   내려오면 undefined.bg 로 화면이 죽는다. 그래서 취소는 상태를 바꾸지 않고 행을 보관 테이블로 옮긴 뒤 지운다
--   (2026-11-05 사용자 결정). 옛 앱에게 취소는 "행이 사라짐"이다. 이건 ps_delete(0093)로 이미 있던 모양이라 새 표시가 없다.
--
-- 계약(클라 A2 와 공유)
--   suggestion_withdraw(p_id text) returns void — 본인 제안 · pending 일 때만 → 보관 테이블로 옮기고 원래 행 delete.
--   suggestion_edit(p_id text, p_patch jsonb) returns void — 본인 제안 · pending 일 때만 → text 만 바꾼다.
--   id 가 text 인 이유: playbook_suggestions.id 는 text 다(0014 · 앱 genId('sug') = "sug_…").
--   오류 = 맨 앞에서 끝낸다(AGENTS ⑨ · 원문에 열 이름이 안 실린다):
--     not_found        행이 없다(남의 매장 행 포함 · 정의자라 RLS 를 안 타므로 여기서 가른다)
--     forbidden        로그인 안 함 · 제안자가 아님 · 그 매장 멤버가 아님(나간 매장의 행은 못 건드린다)
--     not_pending      이미 검토됐다(approved·rejected)
--     invalid_argument (edit) patch 에 text 가 없거나 공백뿐이다(text not null 제약 원문이 화면에 안 나가게)
--   검사 순서 = 존재 → 권한 → 상태. 남의 제안이면 상태를 알려 주지 않는다.
--
-- 수정 가능 열 = text 하나
--   0014·0070·0071 의 열 중 사용자가 직접 쓰는 본문은 text 뿐이다. target_title 은 대상 노하우 제목의 스냅샷이고
--   (useSuggestionStore 가 노하우에서 복사), 지금 앱은 photos 를 보내지 않는다(junior/suggest.tsx send()).
--   unit_id·kind·status·proposer_*·reviewed_*·owner_note·resulting_entry_id·source_* 는 patch 에 있어도 무시한다.
--   본문은 앞뒤 공백을 지우고 저장한다.
--
-- 보관 테이블 playbook_suggestions_withdrawn
--   원래 열 전부 + withdrawn_at·withdrawn_by. RLS 켬 · 정책 없음 = 앱 사용자 누구도 못 읽는다(service_role·분석용).
--   FK 는 원래 테이블과 같게 건다: 매장 삭제·계정 삭제 때 같이 지워진다(테넌트·개인정보 정리 경로를 따로 안 만든다).
--   원래 테이블을 FK 로 참조하는 자식은 없다(pg_constraint 실측 0건). 사진 Storage 객체는 지우지 않는다 — 보관 행이 경로를 가진다.
--   photo_purge_due(0278)는 보관 테이블을 안 보지만, 큐는 매장 삭제 때만 차고 그때 보관 행도 cascade 로 같이 지워진다.
--
-- 트리거 메모: playbook_suggestions_stamp(0319)는 current_user = 'authenticated' 일 때만 일한다.
--   정의자 함수 안은 함수 소유자(postgres)라 건너뛴다 → edit 가 reviewed_by 를 찍지 않는다(검토가 아니므로 맞다).
-- 배지·알림: 검토 대기 수는 status = 'pending' 파생(notifications.isPendingSuggestionToReview · 0285·0346 카운트)이라
--   행이 지워지면 자연히 준다. 새 제안 푸시 검증(0350 'suggestion')도 pending 행을 찾으므로 취소된 제안은 no_event.

create table if not exists public.playbook_suggestions_withdrawn (
  id                 text primary key,
  unit_id            text not null references public.units(id) on delete cascade,
  kind               text not null,
  target_entry_id    text,
  target_title       text,
  proposer_id        uuid not null references auth.users(id) on delete cascade,
  proposer_name      text not null default '',
  text               text not null,
  photos             text[],
  status             text not null,
  owner_note         text,
  resulting_entry_id text,
  created_at         timestamptz not null,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  source_template_id text,
  source_uq_id       text,
  withdrawn_at       timestamptz not null default now(),
  withdrawn_by       uuid
);
create index if not exists idx_psw_unit on public.playbook_suggestions_withdrawn(unit_id);
create index if not exists idx_psw_proposer on public.playbook_suggestions_withdrawn(proposer_id);
alter table public.playbook_suggestions_withdrawn enable row level security;
revoke all on table public.playbook_suggestions_withdrawn from anon, authenticated;
comment on table public.playbook_suggestions_withdrawn is
  '0355 직원이 취소한 제안 보관. 앱 사용자 읽기 불가(RLS 정책 없음). 매장·계정 삭제 시 cascade.';

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
    withdrawn_at, withdrawn_by)
  values (
    r.id, r.unit_id, r.kind, r.target_entry_id, r.target_title, r.proposer_id, r.proposer_name, r.text, r.photos, r.status,
    r.owner_note, r.resulting_entry_id, r.created_at, r.reviewed_at, r.reviewed_by, r.source_template_id, r.source_uq_id,
    now(), v_uid);
  delete from public.playbook_suggestions where id = p_id;
end $$;

create or replace function public.suggestion_edit(p_id text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
  v_text text := btrim(coalesce(p_patch ->> 'text', ''));
begin
  select * into r from public.playbook_suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_uid is null or r.proposer_id <> v_uid
     or not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = r.unit_id) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_text = '' then raise exception 'invalid_argument'; end if;

  update public.playbook_suggestions set text = v_text where id = p_id;
end $$;

revoke execute on function public.suggestion_withdraw(text) from public, anon;
revoke execute on function public.suggestion_edit(text, jsonb) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;
grant execute on function public.suggestion_edit(text, jsonb) to authenticated;
