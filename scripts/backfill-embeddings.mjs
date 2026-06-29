// scripts/backfill-embeddings.mjs — 기존 발행 노하우를 일괄 임베딩해 playbook_embeddings 채우기.
// 0012 마이그레이션 적용 후 1회 실행. service_role 키로 RLS 우회(절대 깃/클라 노출 금지).
//
// 실행:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   GEMINI_API_KEY=AIza... \
//   node scripts/backfill-embeddings.mjs
//
// 멱등: 다시 돌려도 안전(entry_id PK upsert). --force 없으면 이미 임베딩된 건 건너뜀.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI = process.env.GEMINI_API_KEY;
if (!URL || !KEY || !GEMINI) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
const FORCE = process.argv.includes('--force');

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const CAT_LABEL = { Routine: '루틴', Event: '돌발', Context: '원칙', 'Know-how': '꿀팁' };

const db = createClient(URL, KEY, { auth: { persistSession: false } });

// searchClient.buildEmbedText 와 동일 구성(한국어 일관: 제목·카테고리·상황·단계·금지·키워드).
function buildEmbedText(e) {
  const sq = e.square ?? {};
  return [
    e.title,
    CAT_LABEL[e.category] ?? e.category,
    sq.situation,
    (sq.action?.steps ?? []).join(' '),
    sq.extract?.dont,
    (e.search_keywords ?? []).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

async function embed(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const values = data?.embedding?.values ?? [];
  if (!values.length) throw new Error('empty embedding');
  return `[${values.join(',')}]`;
}

async function main() {
  console.log('1) 발행 노하우 조회');
  const { data: entries, error } = await db
    .from('playbook_entries')
    .select('id, unit_id, category, title, square, search_keywords')
    .eq('status', 'published');
  if (error) throw error;
  console.log(`   ${entries.length}건`);

  let already = new Set();
  if (!FORCE) {
    const { data: done } = await db.from('playbook_embeddings').select('entry_id');
    already = new Set((done ?? []).map((r) => r.entry_id));
    console.log(`   기존 임베딩 ${already.size}건 건너뜀 (--force로 재색인)`);
  }

  let ok = 0;
  let fail = 0;
  for (const e of entries) {
    if (already.has(e.id)) continue;
    try {
      const embedding = await embed(buildEmbedText(e));
      const { error: upErr } = await db.from('playbook_embeddings').upsert({
        entry_id: e.id,
        unit_id: e.unit_id,
        embedding,
        embedded_at: new Date().toISOString(),
      });
      if (upErr) throw upErr;
      ok++;
      process.stdout.write('.');
    } catch (err) {
      fail++;
      console.warn(`\n   ✗ ${e.id}: ${err.message ?? err}`);
    }
  }
  console.log(`\n✓ 백필 완료 — 성공 ${ok} / 실패 ${fail} / 건너뜀 ${already.size}`);
}

main().catch((e) => {
  console.error('✗ 백필 실패:', e.message ?? e);
  process.exit(1);
});
