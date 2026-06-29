-- 0012_pgvector_search.sql — 하이브리드 검색용 임베딩(벡터) 인프라
-- 설계: 노하우검색_고도화_v1.md
--
-- 핵심 결정:
--  - 임베딩은 playbook_entries 가 아니라 별도 테이블(playbook_embeddings)에 둔다.
--    이유: db.ts fetchEntries 가 select('*') 라, 본문 테이블에 vector(768)을 넣으면
--    매 hydrate마다 수 KB 벡터가 클라로 끌려온다. 분리하면 본문 조회는 무영향.
--  - 검색은 Edge Function 이 match_playbook RPC 로 cosine 상위 K 를 받는다(렉시컬은 클라에서 융합).
--  - 멀티테넌시: 기존 public.auth_unit_id() 정책 패턴을 그대로 따른다.

-- pgvector 확장 (Supabase 내장). extensions 스키마에 설치.
create extension if not exists vector with schema extensions;

-- ── 임베딩 저장 테이블 ──────────────────────────────────────
-- entry 1:1. 본문 삭제 시 함께 삭제(FK cascade). unit_id 는 RPC 필터·RLS용 비정규화.
create table if not exists public.playbook_embeddings (
  entry_id     text primary key references public.playbook_entries(id) on delete cascade,
  unit_id      text not null references public.units(id) on delete cascade,
  embedding    extensions.vector(768),
  embedded_at  timestamptz not null default now()
);
create index if not exists idx_pb_emb_unit on public.playbook_embeddings(unit_id);

-- cosine 근사 인덱스(HNSW). 파일럿 규모는 exact scan도 즉답이나, 커져도 안전하게 미리.
create index if not exists idx_pb_emb_hnsw
  on public.playbook_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- ── RLS: 내 매장 것만 ───────────────────────────────────────
alter table public.playbook_embeddings enable row level security;
drop policy if exists playbook_embeddings_rw on public.playbook_embeddings;
create policy playbook_embeddings_rw on public.playbook_embeddings
  for all
  using (unit_id = public.auth_unit_id())
  with check (unit_id = public.auth_unit_id());

-- ── 검색 RPC ────────────────────────────────────────────────
-- cosine 유사도 상위 match_count. security invoker(기본) + RLS + 명시적 unit 필터로 테넌트 격리.
-- set search_path 로 <=> 연산자/vector 타입 해석을 보장.
create or replace function public.match_playbook(
  query_embedding extensions.vector(768),
  p_unit_id       text,
  match_count     int default 8
)
returns table (id text, similarity float)
language sql
stable
set search_path = extensions, public
as $$
  select pe.id, 1 - (emb.embedding <=> query_embedding) as similarity
  from public.playbook_embeddings emb
  join public.playbook_entries pe on pe.id = emb.entry_id
  where emb.unit_id = p_unit_id
    and pe.status = 'published'
    and emb.embedding is not null
  order by emb.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.match_playbook(extensions.vector, text, int) to authenticated;
