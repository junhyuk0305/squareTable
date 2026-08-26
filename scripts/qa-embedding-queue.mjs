// scripts/qa-embedding-queue.mjs — 색인 자동화(0181) 자가점검.
//
// 무엇을 보나 — **개수가 아니라 본문**을 본다(AGENTS ⑧③).
//   ① playbook_embeddings 에 재시도 메타 3칸(attempts·last_error·next_attempt_at)이 실제로 있는가
//   ② 대기 조회(러너와 동일한 쿼리)가 실제로 도는가
//   ③ 실동작 왕복: 대기 등록 → 조회에 잡힘 → **기존 벡터가 살아있음** → 해제
//
// 여기서 안 보는 것 — owner_insert_knowhow 본문 검사(#16)와 RLS 격리·인덱스는
//   0181 마이그레이션의 자가점검 DO 블록이 pg_get_functiondef 문자열로 본다(적용이 곧 검사다).
//
// 실행: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/qa-embedding-queue.mjs
// ★수정 전 RED 확인용: 0181 적용 전에 돌리면 ①②③이 전부 실패해야 한다(실측: 통과 0 / 실패 5).

import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); };
const no = (n, d = '') => { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); };

// service_role 로 임의 SQL 을 돌릴 통로가 없으므로, 스키마 사실은 PostgREST 쿼리로 관찰한다.
async function main() {
  console.log('qa-embedding-queue — 색인 자동화(0181) 자가점검\n');

  // ① 재시도 메타 컬럼 — 실제로 select 가 되는지로 판정(정보 스키마 대신 실사용 경로).
  console.log('① 재시도 메타 컬럼');
  for (const col of ['attempts', 'last_error', 'next_attempt_at']) {
    const { error } = await db.from('playbook_embeddings').select(col).limit(1);
    if (error) no(`playbook_embeddings.${col}`, error.message);
    else ok(`playbook_embeddings.${col}`);
  }

  // ② owner_insert_knowhow 본문 검사(#16)는 여기서 하지 않는다.
  //    definer 함수는 auth.uid() 를 보므로 service_role 로는 호출조차 못 하고, PostgREST 로는
  //    pg_get_functiondef 를 읽을 통로가 없다. **여기에 억지 검사를 넣으면 항상 통과하는 가짜가 된다.**
  //    본문 검사는 0181 마이그레이션의 자가점검 DO 블록이 담당한다(적용 시 실패하면 push 가 멈춘다).

  // ③ 대기 인덱스 — 존재를 관찰할 통로가 PostgREST 에 없으므로 대기 조회가 실제로 도는지로 본다.
  console.log('\n② 대기 조회 경로');
  const { error: pendErr } = await db
    .from('playbook_embeddings')
    .select('entry_id, attempts')
    .not('next_attempt_at', 'is', null)
    .lte('next_attempt_at', new Date().toISOString())
    .limit(5);
  if (pendErr) no('대기 조회', pendErr.message); else ok('대기 조회(러너와 동일한 쿼리)');

  // ③ 실동작 왕복 — 발행 노하우 1건에 대기를 찍고 → 조회되고 → 해제한다.
  console.log('\n③ 대기 등록 → 조회 → 해제 왕복');
  const { data: entry } = await db
    .from('playbook_entries').select('id, unit_id').eq('status', 'published').limit(1).single();
  if (!entry) { no('발행 노하우가 없어 왕복 불가'); }
  else {
    const before = await db.from('playbook_embeddings').select('entry_id, embedding, next_attempt_at')
      .eq('entry_id', entry.id).maybeSingle();
    const hadEmbedding = before.data?.embedding != null;

    const { error: e1 } = await db.from('playbook_embeddings')
      .upsert({ entry_id: entry.id, unit_id: entry.unit_id, next_attempt_at: new Date().toISOString() },
              { onConflict: 'entry_id' });
    if (e1) no('대기 등록', e1.message);
    else {
      ok('대기 등록');
      const { data: seen } = await db.from('playbook_embeddings').select('entry_id, embedding')
        .eq('entry_id', entry.id).not('next_attempt_at', 'is', null).maybeSingle();
      if (seen) ok('대기 조회에 잡힘');
      else no('대기 조회에 안 잡힘');
      // ★수정 재색인이 벡터를 지우지 않는지 — 0181 의 핵심 설계 판단.
      if (hadEmbedding) {
        if (seen?.embedding != null) ok('대기를 찍어도 기존 벡터가 살아있다(검색이 끊기지 않는다)');
        else no('★대기 등록이 기존 벡터를 지웠다 — 재색인 동안 의미검색에서 사라진다');
      }
      // 원상 복구.
      const { error: e2 } = await db.from('playbook_embeddings')
        .update({ next_attempt_at: before.data?.next_attempt_at ?? null }).eq('entry_id', entry.id);
      if (e2) no('해제(원상복구)', e2.message); else ok('해제(원상복구)');
      if (!before.data) await db.from('playbook_embeddings').delete().eq('entry_id', entry.id);
    }
  }

  // ④ 지문(content_hash) — 0182. **엣지의 djb2 복사본이 정본과 같은 값을 내는지**를 실물로 본다.
  //    엣지(Deno)는 src/lib/ai/embedText.ts 를 못 부르므로 구현이 두 벌 존재한다. 두 벌이 어긋나면
  //    저장된 지문이 늘 불일치로 보여 **전건이 stale 로 잡히고 재색인이 끝없이 돈다**(Gemini 비용).
  //    개수가 아니라 값을 비교한다 — 컬럼이 있다는 사실만 확인하면 이 사고를 못 잡는다.
  console.log('\n④ 색인 지문(0182) — 엣지가 저장한 값 == 정본 계산값');
  const { error: hashColErr } = await db.from('playbook_embeddings').select('content_hash').limit(1);
  if (hashColErr) {
    no('content_hash 컬럼', `${hashColErr.message} (0182 미적용)`);
  } else {
    ok('content_hash 컬럼 존재');
    const { buildEmbedText, embedTextHash } = await import(
      pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'ai', 'embedText.ts')).href
    );
    // 지문이 실제로 채워진 행 하나를 골라, 그 노하우 본문으로 정본 지문을 다시 계산해 대조한다.
    const { data: rows } = await db.from('playbook_embeddings')
      .select('entry_id, content_hash').not('content_hash', 'is', null).limit(1);
    const row = rows?.[0];
    if (!row) {
      no('대조할 행 없음 — 지문이 채워진 색인이 아직 0건(엣지 배포·재색인 전이면 정상, 그 뒤라면 결함)');
    } else {
      const { data: ent } = await db.from('playbook_entries')
        .select('id, unit_id, category, section, title, square, search_keywords')
        .eq('id', row.entry_id).maybeSingle();
      const { data: cfg } = await db.from('schedule_config')
        .select('knowhow_categories').eq('unit_id', ent?.unit_id ?? '').maybeSingle();
      const customs = Array.isArray(cfg?.knowhow_categories) ? cfg.knowhow_categories : [];
      const mine = ent ? embedTextHash(buildEmbedText(ent, customs)) : null;
      if (mine === row.content_hash) ok('지문 일치', `${row.entry_id} = ${mine}`);
      else no('★지문 불일치 — 엣지 복사본과 정본이 갈라졌다(전건 재색인 위험)', `저장 ${row.content_hash} vs 정본 ${mine}`);
    }
  }

  console.log(`\n결과 — 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('✗ 실행 실패:', e.message ?? e); process.exit(1); });
