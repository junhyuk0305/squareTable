-- 0182_embedding_content_hash.sql — 색인이 "무엇으로 만들어졌는지"를 남긴다.
--
-- ── 배경 (2026-08-27 실측) ──────────────────────────────────────────────────
-- 지금까지 playbook_embeddings 는 **벡터가 있다**는 것만 알고 **무엇을 임베딩한 벡터인지**는
-- 몰랐다. 그래서 두 가지를 구별할 수 없었다:
--   (a) 노하우를 고쳤고 재색인도 됐다              → 정상
--   (b) 노하우를 고쳤는데 재색인이 실패해 옛 벡터  → **검색이 옛 답을 자신 있게 준다**
-- (b)는 "못 찾는 것"보다 나쁘다. 사장은 고쳤다고 믿는데 직원은 옛 답을 받는다. 이 한 칸이
-- 그 상태를 감지할 유일한 근거다(reconcile-embeddings.mjs --stale 이 이 값으로 판정한다).
--
-- ── 왜 지금까지 못 넣었나 ───────────────────────────────────────────────────
-- 색인 텍스트를 만드는 규칙이 **네 곳에 복제**돼 있었고 서로 달랐다(앱만 섹션을 프리펜드했다).
-- 그 상태로 지문을 도입하면 경로마다 다른 지문이 나와 **전건이 영원히 "내용 바뀜"으로 잡히고**
-- 재색인이 계속 돌아 Gemini 비용이 샌다. 그래서 같은 작업에서 조립 규칙을 먼저 하나로 합쳤다:
--   정본 = src/lib/ai/embedText.ts (alias/RN 의존 없음 → .mjs 스크립트도 node 로 그대로 부른다)
--   부르는 곳 = searchClient.ts · reconcile-embeddings.mjs · backfill-embeddings.mjs · seed-eval.mjs
-- ★스크립트들은 조립 함수뿐 아니라 **section 컬럼 자체를 select 하지 않고 있었다** — 함수만
--   합쳤다면 섹션은 그대로 빠졌을 것이다. select 도 함께 고쳤고, reconcile 에 필드 누락 검사를 뒀다.
--
-- ── 기존 행은 NULL 로 둔다 ──────────────────────────────────────────────────
-- 지문은 TS 쪽 조립 규칙으로만 계산할 수 있어 SQL 로 채울 수 없다. 대신 일회성 복구 스크립트
-- (scripts/repair-embed-text-drift.mjs)가 ① 텍스트가 안 바뀌는 행에는 현재 지문을 써 넣고
-- ② 바뀌는 행(실측 25건, 전부 섹션 프리펜드 누락)은 **대기로 표시**해 0181 의 재시도 러너가
-- 올바른 텍스트로 다시 색인하게 한다. NULL 인 채로 두면 --stale 이 그 행을 재색인 대상으로 본다.

alter table public.playbook_embeddings
  add column if not exists content_hash text;

comment on column public.playbook_embeddings.content_hash is
  '이 벡터를 만든 색인 텍스트의 지문(djb2 hex). 정본 계산기 = src/lib/ai/embedText.ts embedTextHash, '
  '쓰는 곳 = 엣지 ai/handleEmbed(임베딩한 그 텍스트로 계산). NULL = 무엇으로 만들었는지 모름(재색인 대상). '
  '노하우를 고쳤는데 색인이 옛것인 상태(stale)를 감지하는 유일한 근거다.';

-- ── 자가점검 ────────────────────────────────────────────────────────────────
-- 이 저장소 관례대로 마이그레이션 안에서 결과를 실제로 확인한다(0177·0179·0181과 동일).
-- 개수가 아니라 **정의 자체**를 본다.
do $$
declare
  v_exists  boolean;
  v_nullable text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'playbook_embeddings' and column_name = 'content_hash'
  ) into v_exists;
  if not v_exists then
    raise exception '0182 자가점검 실패: playbook_embeddings.content_hash 가 없습니다.';
  end if;

  -- ★반드시 nullable 이어야 한다. not null 이면 기존 136행이 값을 못 채워 마이그레이션이 죽고,
  --   엣지 구버전이 지문 없이 upsert 하던 경로도 함께 깨진다(배포 순서 의존이 생긴다).
  select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'playbook_embeddings' and column_name = 'content_hash'
   into v_nullable;
  if v_nullable <> 'YES' then
    raise exception '0182 자가점검 실패: content_hash 는 nullable 이어야 합니다(현재 %).', v_nullable;
  end if;

  -- 0181 의 대기 인덱스가 살아 있어야 복구 경로(대기 표시 → 러너 소진)가 성립한다.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'playbook_embeddings' and indexname = 'idx_pb_emb_pending'
  ) then
    raise exception '0182 자가점검 실패: 0181 의 idx_pb_emb_pending 이 없습니다(대기 소진 경로가 깨진 상태).';
  end if;

  raise notice '0182 자가점검 통과: content_hash(nullable) 추가 · 0181 대기 인덱스 정상.';
end $$;
