// scripts/repair-embed-text-drift.mjs — 색인 텍스트 통합(2026-08-27)의 **일회성** 뒷정리.
//
// 무엇을 하나:
//   조립 규칙이 네 곳에 복제돼 있던 동안, 스크립트 경로로 색인된 노하우는 섹션 프리펜드가 빠진
//   텍스트로 색인됐다(앱 경로는 붙었다). 규칙을 하나로 합친 지금, 각 노하우의 **현재 정본 텍스트**를
//   계산해 두 갈래로 정리한다:
//     ① 통합 전후 텍스트가 같은 행  → 저장된 벡터가 그 텍스트로 만들어진 게 맞다 → content_hash 를 채운다.
//     ② 달라지는 행                → 저장된 벡터가 옛 텍스트로 만들어졌다 → **대기로 표시**한다.
//                                     (0181 의 재시도 러너가 앱 진입 때 올바른 텍스트로 다시 색인한다)
//
// 왜 대기 표시인가 — 여기서 직접 재색인하지 않는 이유:
//   재색인은 Gemini 실호출(비용)이고, 이 저장소는 색인 주체를 **앱**으로 정해 뒀다(0181). 새 경로를
//   만들지 않고 이미 있는 대기 큐에 얹는 게 구조상 맞다. ★벡터는 지우지 않는다 — 낡은 벡터라도
//   있는 편이 재색인 끝날 때까지 의미검색에서 사라지는 것보다 낫다(0181 헤더의 그 이유 그대로).
//
// 모드:
//   기본(=--dry-run)  무엇을 할지 세어 보여주기만. DB 쓰기 없음.
//   --apply           실제로 쓴다(content_hash 채우기 + 대기 표시).
//
// 전제: 0182 적용(content_hash 컬럼). 없으면 안내하고 멈춘다.
//
// 실행:
//   node --env-file=.env.seed scripts/repair-embed-text-drift.mjs            # 점검
//   node --env-file=.env.seed scripts/repair-embed-text-drift.mjs --apply    # 반영

import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APPLY = process.argv.includes('--apply');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다(.env.seed).');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const { buildEmbedText, embedTextHash } = await import(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'ai', 'embedText.ts')).href
);

// 통합 **전** 스크립트가 쓰던 조립 규칙. 저장된 벡터가 무엇으로 만들어졌는지 되짚는 유일한 방법이다.
// (앱 경로로 색인된 행은 이미 정본과 같은 텍스트라 아래 비교에서 '동일'로 떨어진다.)
const LEGACY_CAT = { Routine: '루틴', Event: '돌발', Context: '원칙', 'Know-how': '꿀팁' };
const legacyText = (e) => {
  const sq = e.square ?? {};
  return [
    e.title,
    LEGACY_CAT[e.category] ?? e.category,
    sq.situation,
    (sq.action?.steps ?? []).join(' '),
    sq.extract?.dont,
    (e.search_keywords ?? []).join(' '),
  ].filter(Boolean).join('\n').slice(0, 4000);
};

const page = async (table, cols, tune) => {
  const out = [];
  let from = 0;
  for (;;) {
    let q = db.from(table).select(cols);
    if (tune) q = tune(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
};

// 0182 적용 여부 — 컬럼이 없으면 아무것도 하지 않는다.
{
  const { error } = await db.from('playbook_embeddings').select('content_hash').limit(1);
  if (error) {
    console.error('✗ playbook_embeddings.content_hash 가 없습니다 — 0182 를 먼저 적용하세요.');
    console.error(`  (${error.message})`);
    process.exit(1);
  }
}

const entries = await page(
  'playbook_entries',
  'id, unit_id, category, section, title, square, search_keywords',
  (q) => q.eq('status', 'published'),
);
const embs = await page('playbook_embeddings', 'entry_id, content_hash, next_attempt_at, embedding');
const embByEntry = new Map(embs.map((r) => [r.entry_id, r]));

// 매장별 커스텀 카테고리(0096) — 앱이 들고 있는 값과 같아야 라벨이 일치한다.
const cfg = await page('schedule_config', 'unit_id, knowhow_categories');
const customsByUnit = new Map(cfg.map((c) => [c.unit_id, Array.isArray(c.knowhow_categories) ? c.knowhow_categories : []]));

const toHash = [];   // ① 텍스트 동일 → 지문만 채운다
const toRequeue = []; // ② 텍스트 변경 → 대기 표시
let skippedNoVector = 0;

for (const e of entries) {
  const emb = embByEntry.get(e.id);
  if (!emb || emb.embedding == null) { skippedNoVector++; continue; } // 애초에 색인이 없다 → 기존 대기 경로의 몫
  const canonical = buildEmbedText(e, customsByUnit.get(e.unit_id) ?? []);
  if (canonical === legacyText(e)) {
    if (emb.content_hash !== embedTextHash(canonical)) toHash.push({ id: e.id, hash: embedTextHash(canonical) });
  } else {
    toRequeue.push({ id: e.id, unit: e.unit_id, section: e.section });
  }
}

console.log(`발행 노하우 ${entries.length}건 · 벡터 보유 ${entries.length - skippedNoVector}건 (미색인 ${skippedNoVector}건은 대상 아님)`);
console.log(`① 지문만 채울 행        : ${toHash.length}건 (저장된 벡터가 현재 정본 텍스트로 만들어진 것)`);
console.log(`② 대기로 표시할 행      : ${toRequeue.length}건 (옛 텍스트로 색인됨 — 앱 진입 때 자동 재색인)`);
if (toRequeue.length) {
  const byUnit = {};
  for (const r of toRequeue) byUnit[r.unit] = (byUnit[r.unit] || 0) + 1;
  console.log('   매장별:', JSON.stringify(byUnit));
  console.log('   사유  : 섹션 프리펜드 누락', toRequeue.filter((r) => r.section).length, '건 / 그 외', toRequeue.filter((r) => !r.section).length, '건');
}

if (!APPLY) {
  console.log('\n(점검 모드 — DB 에 아무것도 쓰지 않았습니다. 반영하려면 --apply)');
  process.exit(0);
}

let okHash = 0, okQueue = 0, failed = 0;
for (const r of toHash) {
  const { error } = await db.from('playbook_embeddings').update({ content_hash: r.hash }).eq('entry_id', r.id);
  if (error) { failed++; console.warn(`  ✗ ${r.id}: ${error.message}`); } else okHash++;
}
for (const r of toRequeue) {
  // ★attempts 는 건드리지 않는다(백오프 누적 유지) · embedding 도 그대로 둔다(낡은 벡터라도 유지).
  //   content_hash 는 NULL 로 남겨 둔다 — 재색인 성공 시 엣지가 올바른 값을 써 넣는다.
  const { error } = await db.from('playbook_embeddings')
    .update({ next_attempt_at: new Date().toISOString() })
    .eq('entry_id', r.id);
  if (error) { failed++; console.warn(`  ✗ ${r.id}: ${error.message}`); } else okQueue++;
}
console.log(`\n반영 완료 — 지문 ${okHash}건 · 대기 표시 ${okQueue}건 · 실패 ${failed}건`);
process.exit(failed ? 1 : 0);
