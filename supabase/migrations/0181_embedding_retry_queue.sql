-- 0181_embedding_retry_queue.sql — 색인(임베딩)이 자동으로 채워지는 경로를 만든다.
--
-- ── 배경(감사 #15 · #16 · 프로세스 결함) ────────────────────────────────────
-- 색인은 지금까지 **한 번 실패하면 영영 끝**이었다. 경로가 둘인데 둘 다 닫혀 있지 않았다.
--   (1) 클라 경로: embedEntry()(searchClient.ts)는 파이어앤포겟 + 3회 재시도. 3회가 다 실패하면
--       reportError 만 남기고 포기한다 — 그 노하우는 의미검색에서 영구히 빠지는데
--       사장은 검색되는 줄 안다. **다시 시도되는 경로가 없다.**
--   (2) 서버 경로: 허브에서 다른 매장에 노하우를 쓰면 owner_insert_knowhow(0121)로 직행하는데
--       이 함수는 playbook_embeddings 를 아예 건드리지 않는다 → **그 경로 노하우는 100% 미색인**.
--
-- ── 왜 새 테이블(embedding_backlog)을 만들지 않는가 ─────────────────────────
-- playbook_embeddings 가 이미 "노하우 1건 = 행 1개"이고 RLS(매장 격리)·인덱스·복제(0059·0073)가
-- 전부 이 테이블 기준으로 서 있다. 백로그를 따로 만들면 같은 사실을 두 곳에 적게 되고(정합 대상이
-- 하나 더 늘고) 격리 정책도 새로 세워야 한다. **이 테이블에 재시도 메타 3칸만 더한다.**
--
-- ── 대기 판정은 embedding IS NULL 이 아니라 next_attempt_at IS NOT NULL 이다 ─
-- ★수정 재색인 때문이다. 이미 색인된 노하우를 고치면 재색인 대상이 되는데, 이때 embedding 을
--   NULL 로 비우면 재색인이 끝날 때까지 **그 노하우가 의미검색에서 사라진다**(낡은 벡터라도 있는
--   편이 없는 것보다 낫다). 그래서 벡터는 그대로 두고 "다시 시도할 시각"만 세운다.
--     next_attempt_at IS NOT NULL  → 색인 대기(클라가 소진한다)
--     next_attempt_at IS NULL      → 정합(색인 성공했거나 대상 아님)

-- ── 재시도 메타 ──────────────────────────────────────────────────────────────
alter table public.playbook_embeddings
  add column if not exists attempts        integer not null default 0,
  add column if not exists last_error      text,
  add column if not exists next_attempt_at timestamptz;

comment on column public.playbook_embeddings.attempts is
  '색인 재시도 횟수. 성공 시 0으로 리셋. 상한을 넘으면 클라가 백오프를 늘린다.';
comment on column public.playbook_embeddings.last_error is
  '마지막 실패 사유(엣지의 forbidden·embed_read·embed_write·모델 404 등). 진단용.';
comment on column public.playbook_embeddings.next_attempt_at is
  '★색인 대기 판정 기준. NOT NULL = 아직 색인이 필요하다. 이 시각 이후에 다시 시도한다.';

-- 대기분 조회는 "이 매장의 대기 행"만 훑는다 — 대기가 없는 매장(대부분)은 인덱스만 보고 끝난다.
create index if not exists idx_pb_emb_pending
  on public.playbook_embeddings (unit_id, next_attempt_at)
  where next_attempt_at is not null;

-- ── 서버 삽입 경로에도 색인을 건다 (#16) ────────────────────────────────────
-- 0121 본문을 그대로 베이스로 하고 **맨 끝의 대기 등록만 더한다**(설계 근거 주석도 함께 옮겼다).
-- RPC 안에서 임베딩을 직접 만들 수는 없다(Gemini 호출은 엣지의 몫) → 대기로 남기고
-- 클라 재시도 러너(embedBacklog.ts)가 소진한다.
create or replace function public.owner_insert_knowhow(p_unit_id text, p_entry jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_defaults jsonb;
  v_in       jsonb;
  v_row      public.playbook_entries%rowtype;
begin
  -- ★★ 유일한 방어선. 지우지 말 것.
  if not exists (
    select 1 from public.units u
     where u.id = p_unit_id
       and u.owner_id = (select auth.uid())
       and u.deleted_at is null
  ) then
    raise exception 'not_owner';
  end if;

  -- 본문이 객체가 아니면 아래 jsonb_each 가 원시 에러를 던진다(cannot deconstruct an array).
  -- 소유 검사 뒤라 누출은 없지만, 실패 모드는 우리 말로 나가야 한다(/cso M1).
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'bad_entry';
  end if;

  -- not null 컬럼의 기본값 — jsonb_populate_record 는 없는 키를 NULL 로 채우므로
  -- 컬럼 default 가 발동하지 않는다(명시적 NULL 은 default 를 타지 않는다).
  v_defaults := jsonb_build_object(
    'tags', '[]'::jsonb, 'search_keywords', '[]'::jsonb,
    'square', '{}'::jsonb, 'execution', '{}'::jsonb, 'stats', '{}'::jsonb,
    'photos', '[]'::jsonb, 'version', 1, 'status', 'published', 'quality_score', 0,
    'is_template', false, 'needs_review', false, 'correction_points', '[]'::jsonb,
    'order_index', 0, 'created_at', now(), 'updated_at', now()
  );

  -- 클라 전용 필드(source)는 컬럼이 아니다 — db.ts stripNonColumns 와 같은 규칙.
  -- unit_id 는 아래에서 인자로 덮으므로 여기서 미리 뺀다.
  -- not null 컬럼 키가 명시적 null 로 들어오면 그 키를 버려 기본값이 살아나게 한다.
  select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
    into v_in
    from jsonb_each(p_entry - 'source' - 'unit_id') as t(k, v)
   where not (t.v = 'null'::jsonb and v_defaults ? t.k);

  v_row := jsonb_populate_record(
             null::public.playbook_entries,
             v_defaults || v_in || jsonb_build_object('unit_id', p_unit_id)
           );
  -- 저자는 언제나 호출자다 — 본문이 남을 저자로 적어 보내는 것을 받아주지 않는다.
  v_row.creator_id := (select auth.uid())::text;

  -- not null 컬럼 중 기본값을 줄 수 없는 셋(무엇을 쓰는지는 호출부만 안다)은 같은 잣대로 검증한다 —
  -- 하나만 빠뜨리면 그 컬럼만 원시 not-null 위반으로 새어 나간다(/cso M2).
  if v_row.id is null or v_row.id = '' then raise exception 'missing_id'; end if;
  if v_row.title is null or v_row.title = '' then raise exception 'missing_title'; end if;
  if v_row.category is null or v_row.category = '' then raise exception 'missing_category'; end if;

  insert into public.playbook_entries values (v_row.*);

  -- ★0181: 색인 대기 등록(#16). 발행 상태만 색인 대상이다(초안은 검색에서 제외되므로 불요) —
  --   embedEntry() 의 `if (e.status !== 'published') return` 과 같은 잣대다.
  --   definer 로 도는 함수라 대상 매장(p_unit_id)이 호출자의 활성 매장이 아니어도 등록된다.
  --   ★대상 매장은 여기서도 p_unit_id 다 — 위 소유 검사를 통과한 그 매장이다.
  if v_row.status = 'published' then
    insert into public.playbook_embeddings (entry_id, unit_id, next_attempt_at)
    values (v_row.id, p_unit_id, now())
    on conflict (entry_id) do update
      set next_attempt_at = now(), attempts = 0, last_error = null;
  end if;

  return v_row.id;
end $$;

grant execute on function public.owner_insert_knowhow(text, jsonb) to authenticated;

-- ── 자가점검 — 개수가 아니라 **본문**으로 본다 ──────────────────────────────
-- ★"함수가 존재한다"·"컬럼이 3개다"는 아무것도 보증하지 않는다. 0121 본문을 그대로 베껴 온 뒤
--   대기 등록만 덧붙였는지, 그 과정에서 **유일한 방어선(소유 검사)이 살아남았는지**를 문자열로 본다.
do $$
declare v_def text; v_bad text := '';
begin
  v_def := pg_get_functiondef('public.owner_insert_knowhow(text, jsonb)'::regprocedure);

  -- ① #16 의 본체: 서버 삽입 경로가 색인 대기를 실제로 남기는가
  if position('playbook_embeddings' in v_def) = 0 then
    v_bad := v_bad || 'owner_insert_knowhow(색인 대기 등록 없음 · #16 미해결) ';
  end if;
  if position('next_attempt_at' in v_def) = 0 then
    v_bad := v_bad || 'owner_insert_knowhow(next_attempt_at 안 씀 — 대기로 안 잡힌다) ';
  end if;
  -- 초안까지 색인 대기로 넣으면 안 된다(embedEntry 와 잣대가 어긋난다)
  if position('published' in v_def) = 0 then
    v_bad := v_bad || 'owner_insert_knowhow(발행 상태 조건 없음) ';
  end if;

  -- ② 베껴 오면서 방어선이 사라지지 않았는가 — 0121 이 "절대 지우지 말 것"이라 못박은 두 줄
  if position('not_owner' in v_def) = 0 then
    v_bad := v_bad || '★owner_insert_knowhow(소유 검사 사라짐 — 남의 매장에 쓰는 구멍) ';
  end if;
  if position('owner_id' in v_def) = 0 then
    v_bad := v_bad || '★owner_insert_knowhow(owner_id 검사 사라짐) ';
  end if;
  -- 대상 매장은 인자가 정한다 — 본문이 정하면 소유 검사를 통과한 뒤 우회로가 생긴다
  if position('''unit_id'', p_unit_id' in v_def) = 0 then
    v_bad := v_bad || '★owner_insert_knowhow(unit_id 를 인자로 덮지 않음) ';
  end if;
  -- 대기 등록도 인자 매장으로 — 본문의 unit_id 를 쓰면 남의 매장 임베딩 행이 생긴다
  if position('values (v_row.id, p_unit_id' in v_def) = 0 then
    v_bad := v_bad || '★owner_insert_knowhow(대기 등록이 p_unit_id 를 안 씀) ';
  end if;

  -- ③ 재시도 메타 3칸이 실제로 붙었는가(러너가 이 컬럼들로 백오프를 누적한다)
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='playbook_embeddings' and column_name='next_attempt_at') then
    v_bad := v_bad || 'playbook_embeddings.next_attempt_at 없음 ';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='playbook_embeddings' and column_name='attempts') then
    v_bad := v_bad || 'playbook_embeddings.attempts 없음 ';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='playbook_embeddings' and column_name='last_error') then
    v_bad := v_bad || 'playbook_embeddings.last_error 없음 ';
  end if;

  -- ④ 대기 조회가 전건 스캔이 되지 않게 — 부분 인덱스가 실제로 서 있는가
  if not exists (select 1 from pg_indexes
                  where schemaname='public' and indexname='idx_pb_emb_pending') then
    v_bad := v_bad || 'idx_pb_emb_pending 없음(대기 조회 전건 스캔) ';
  end if;

  -- ⑤ 매장 격리 — 러너의 조회·쓰기가 타는 정책이 살아있는가(0181 은 정책을 건드리지 않았지만,
  --    새 컬럼을 여는 마이그레이션에서 격리가 열렸는지 확인하는 것은 규율이다)
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.playbook_embeddings'::regclass
                    and position('auth_unit_id' in coalesce(pg_get_expr(polqual, polrelid), '')) > 0) then
    v_bad := v_bad || '★playbook_embeddings(매장 격리 정책 없음) ';
  end if;

  if v_bad <> '' then raise exception '0181 자가점검 실패: %', v_bad; end if;
end $$;
