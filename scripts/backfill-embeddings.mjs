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
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// ── 임베딩 입력 텍스트 — 앱과 **같은 파일**을 부른다(SSOT, 2026-08-27) ──
// 자기 복사본을 갖고 있던 탓에 섹션 프리펜드가 빠져 앱과 다른 텍스트로 색인해 왔다.
// src/lib/ai/embedText.ts 는 alias/RN 의존이 없어 node 가 그대로 읽는다.
const { buildEmbedText: buildEmbedTextSSOT } = await import(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'ai', 'embedText.ts')).href
);

// 매장별 커스텀 카테고리(0096) — 앱이 들고 있는 값과 같아야 라벨이 일치한다.
const customsByUnit = new Map();
async function customsFor(unitId) {
  if (customsByUnit.has(unitId)) return customsByUnit.get(unitId);
  const { data } = await db.from('schedule_config').select('knowhow_categories').eq('unit_id', unitId).maybeSingle();
  const list = Array.isArray(data?.knowhow_categories) ? data.knowhow_categories : [];
  customsByUnit.set(unitId, list);
  return list;
}
const buildEmbedText = async (e) => buildEmbedTextSSOT(e, await customsFor(e.unit_id));

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
    // ★section 필수 — 색인 텍스트 맨 앞 프리펜드에 쓰인다(2026-08-27 이전엔 안 읽어서 빠졌다).
    .select('id, unit_id, category, section, title, square, search_keywords')
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
      const embedding = await embed(await buildEmbedText(e));
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
