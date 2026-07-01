// scripts/reconcile-embeddings.mjs — 색인 자동 정합(P0, 조용한 recall 하락 종결).
//
// 무엇을 하나:
//   status='published' 인데 playbook_embeddings 에 임베딩이 없는(또는 stale) 노하우를
//   매장(unit_id)별로 탐지·리포트하고, --fix 플래그를 주면 누락분만 재색인한다(멱등).
//   backfill-embeddings.mjs 가 "0012 적용 후 1회"용 수동 백필이라면, 이 스크립트는
//   상시(cron·수동) 돌릴 수 있는 "정합 점검"이다. 같은 embed()/buildEmbedText() 패턴을 재사용한다.
//
// 왜 필요한가:
//   embedEntry() 는 fire-and-forget(실패해도 발행은 성공·렉시컬 폴백). 네트워크 순단·Edge
//   콜드스타트로 색인이 조용히 빠지면 의미검색 recall 이 떨어지는데 아무도 모른다. 이 스크립트가
//   그 누락을 "보이게" 만들고(리포트) "맞출 수" 있게(--fix) 한다.
//
// 모드:
//   기본(=--dry-run)  탐지·리포트만. Gemini 호출/DB 쓰기 절대 없음. 매장별 누락 건수 출력.
//   --fix             누락분만 재색인(이미 임베딩 있는 건 건너뜀 → 멱등). Gemini·DB 쓰기 발생.
//   --stale           내용 drift(노하우 수정 후 미재색인)까지 대상에 포함. playbook_embeddings 에
//                     content_hash 컬럼이 있을 때만 동작 — 없으면(현 스키마) 경고 후 무시.
//   --json            리포트를 JSON 으로 stdout 출력(cron/대시보드 수집용). 사람용 표는 stderr 로.
//   --limit=N         스캔 상한(기본 5000). 안전장치.
//
// 실행:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   GEMINI_API_KEY=AIza... \                 # --fix 일 때만 필요(dry-run 은 불요)
//   node scripts/reconcile-embeddings.mjs                 # 탐지·리포트(안전, 기본)
//   node scripts/reconcile-embeddings.mjs --fix           # 누락분 재색인(멱등)
//   node scripts/reconcile-embeddings.mjs --json          # 머신리더블 리포트
//
// 안전:
//   service_role 키로 RLS 우회 → 절대 깃/클라 노출 금지(backfill 과 동일 주의).
//   --fix 없이는 어떤 쓰기/외부호출도 하지 않는다(읽기 전용 점검이 기본).

import { createClient } from '@supabase/supabase-js';

// ── 인자 파싱 ────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const FIX = ARGS.includes('--fix');
const STALE = ARGS.includes('--stale');
const JSON_OUT = ARGS.includes('--json');
// --dry-run 은 기본이므로 명시적 플래그는 가독성용일 뿐(없어도 dry-run). --fix 가 있어야만 쓴다.
const DRY_RUN = !FIX;
const LIMIT = (() => {
  const a = ARGS.find((x) => x.startsWith('--limit='));
  const n = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50000) : 5000;
})();

// 사람용 로그는 stderr 로(=--json 시 stdout 은 순수 JSON 만 남게). dry-run/일반 둘 다 동일.
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI = process.env.GEMINI_API_KEY;
if (!URL || !KEY) {
  log('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
if (FIX && !GEMINI) {
  log('✗ --fix 모드는 GEMINI_API_KEY 가 필요합니다(재색인에 임베딩 호출 발생).');
  process.exit(1);
}

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
// searchClient.getCategoryMeta(label) 과 backfill 의 CAT_LABEL 과 동일해야 해시·텍스트가 일치한다.
// (SSOT 주의: 이 라벨맵/필드순서/구분자/slice 길이가 searchClient.buildEmbedText 와 어긋나면
//  hash 가 영구 불일치 → --stale 가 전건을 재색인 대상으로 본다. 변경 시 세 곳을 함께 맞출 것.)
const CAT_LABEL = { Routine: '루틴', Event: '돌발', Context: '원칙', 'Know-how': '꿀팁' };

// --fix 재색인 시 외부 임베딩 API 호출 간 페이싱(ms). 매장 분당 캡·Gemini 레이트리밋 보호용 보수값.
const PACE_MS = 250;
const MAX_RETRY = 3;

const db = createClient(URL, KEY, { auth: { persistSession: false } });

// ── 임베딩 입력 텍스트 — searchClient.buildEmbedText / backfill 과 동일 구성 ──
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

// 임베딩 입력 텍스트의 안정 해시(djb2). content_hash 로 stale(수정 후 미재색인) 감지에 쓴다.
// 클라(searchClient.embedTextHash)·Edge·이 스크립트가 동일 알고리즘이어야 일관(SSOT 주의 동일).
function embedTextHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// ── Gemini 임베딩(백오프 재시도) — backfill.embed 과 동일, 재시도만 추가 ──
async function embed(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI}`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
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
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) await sleep(600 * attempt); // 0.6s → 1.2s 백오프
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── content_hash 컬럼 존재 여부 프로브(0034 미적용 환경 대비) ──
// 0034_embedding_health.sql 이 아직 push 되지 않은 현 스키마에는 content_hash 가 없다.
// 컬럼을 select 해보고 실패하면 "없음"으로 판단 → --stale 을 안전하게 무력화한다.
async function hasContentHashColumn() {
  const { error } = await db.from('playbook_embeddings').select('content_hash').limit(1);
  if (!error) return true;
  // PostgREST 는 미존재 컬럼에 42703(undefined_column) 또는 메시지에 컬럼명을 담아 돌려준다.
  const msg = (error.message || '').toLowerCase();
  if (error.code === '42703' || msg.includes('content_hash')) return false;
  // 다른 종류 에러(권한 등)면 보수적으로 "모름→없음" 처리하되 경고.
  log(`   (content_hash 프로브 경고: ${error.message})`);
  return false;
}

// ── 탐지 ─────────────────────────────────────────────────────
// 반환: { entries, embByEntry, hashAvailable, targets }
//   targets = 재색인 대상 entry 객체 배열(누락 = row 없음/embedding null, + --stale & hash 불일치)
async function detect() {
  log('1) 발행 노하우 + 임베딩 현황 조회 (service_role, 전 매장)');

  // published 본문 — 페이지네이션으로 LIMIT 까지.
  const entries = [];
  const PAGE = 1000;
  for (let from = 0; from < LIMIT; from += PAGE) {
    const to = Math.min(from + PAGE, LIMIT) - 1;
    const { data, error } = await db
      .from('playbook_entries')
      .select('id, unit_id, category, title, square, search_keywords, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    entries.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  log(`   발행 노하우 ${entries.length}건`);

  // 임베딩 현황 — content_hash 가 있으면 함께(stale 판정용).
  const hashAvailable = STALE ? await hasContentHashColumn() : false;
  if (STALE && !hashAvailable) {
    log('   ⚠ --stale 무시: playbook_embeddings.content_hash 컬럼이 없습니다(0034 미적용).');
    log('     stale(내용 drift) 감지는 content_hash 도입 후에만 가능. 누락(row 없음)만 점검합니다.');
  }
  const cols = hashAvailable ? 'entry_id, embedding, content_hash' : 'entry_id, embedding';
  const embByEntry = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('playbook_embeddings')
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) embByEntry.set(r.entry_id, r);
    if (!data || data.length < PAGE) break;
  }
  log(`   임베딩 row ${embByEntry.size}건`);

  // 재색인 대상 판정.
  const targets = [];
  for (const e of entries) {
    const emb = embByEntry.get(e.id);
    const missing = !emb || emb.embedding == null; // (a) row 없음 또는 (b) embedding NULL
    let stale = false;
    if (!missing && hashAvailable) {
      // (c) 내용 drift: 현재 텍스트 해시와 저장된 content_hash 불일치.
      const curHash = embedTextHash(buildEmbedText(e));
      stale = emb.content_hash == null || emb.content_hash !== curHash;
    }
    if (missing || stale) targets.push({ entry: e, reason: missing ? 'missing' : 'stale' });
  }

  return { entries, embByEntry, hashAvailable, targets };
}

// ── 매장별 집계 ──────────────────────────────────────────────
function summarize(entries, embByEntry, targets, hashAvailable) {
  // 매장별 발행 총수 / 임베딩 보유수 / 누락수 / stale수.
  const byUnit = new Map();
  const ensure = (u) =>
    byUnit.get(u) ?? byUnit.set(u, { unitId: u, publishedTotal: 0, embeddedTotal: 0, missing: 0, stale: 0 }).get(u);

  for (const e of entries) {
    const s = ensure(e.unit_id);
    s.publishedTotal++;
    const emb = embByEntry.get(e.id);
    if (emb && emb.embedding != null) s.embeddedTotal++;
  }
  for (const t of targets) {
    const s = ensure(t.entry.unit_id);
    if (t.reason === 'missing') s.missing++;
    else s.stale++;
  }

  const units = [...byUnit.values()]
    .map((s) => ({ ...s, needsReindex: s.missing + s.stale }))
    .sort((a, b) => b.needsReindex - a.needsReindex || b.publishedTotal - a.publishedTotal);

  const totals = units.reduce(
    (acc, u) => {
      acc.publishedTotal += u.publishedTotal;
      acc.embeddedTotal += u.embeddedTotal;
      acc.missing += u.missing;
      acc.stale += u.stale;
      return acc;
    },
    { publishedTotal: 0, embeddedTotal: 0, missing: 0, stale: 0 },
  );
  totals.needsReindex = totals.missing + totals.stale;
  totals.coverage =
    totals.publishedTotal > 0 ? Number((totals.embeddedTotal / totals.publishedTotal).toFixed(4)) : 1;

  return { units, totals, hashAvailable };
}

// ── 사람용 표 출력(stderr) ───────────────────────────────────
function printReport({ units, totals, hashAvailable }) {
  log('');
  log('── 매장별 색인 정합 ──────────────────────────────────────');
  log(
    [
      'unit_id'.padEnd(24),
      '발행'.padStart(6),
      '임베딩'.padStart(7),
      '누락'.padStart(6),
      hashAvailable ? 'stale'.padStart(6) : '',
      '커버리지'.padStart(9),
    ]
      .filter(Boolean)
      .join('  '),
  );
  for (const u of units) {
    const cov = u.publishedTotal > 0 ? ((u.embeddedTotal / u.publishedTotal) * 100).toFixed(0) + '%' : '—';
    const mark = u.needsReindex > 0 ? ' ⚠' : '';
    log(
      [
        String(u.unitId).slice(0, 24).padEnd(24),
        String(u.publishedTotal).padStart(6),
        String(u.embeddedTotal).padStart(7),
        String(u.missing).padStart(6),
        hashAvailable ? String(u.stale).padStart(6) : '',
        (cov + mark).padStart(9),
      ]
        .filter(Boolean)
        .join('  '),
    );
  }
  log('─────────────────────────────────────────────────────────');
  log(
    `합계  발행 ${totals.publishedTotal} · 임베딩 ${totals.embeddedTotal} · 누락 ${totals.missing}` +
      (hashAvailable ? ` · stale ${totals.stale}` : '') +
      ` · 커버리지 ${(totals.coverage * 100).toFixed(1)}%`,
  );
  if (totals.needsReindex === 0) log('✓ 모든 매장 색인 정합 — 재색인 대상 없음.');
  else log(`→ 재색인 대상 ${totals.needsReindex}건. --fix 로 맞출 수 있습니다.`);
  log('');
}

// ── --fix: 누락분만 재색인(멱등·페이싱) ──────────────────────
async function fix(targets) {
  log(`2) 재색인 시작 — 대상 ${targets.length}건 (페이싱 ${PACE_MS}ms · 재시도 ${MAX_RETRY})`);
  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    const e = t.entry;
    try {
      const text = buildEmbedText(e);
      const embedding = await embed(text);
      const row = {
        entry_id: e.id,
        unit_id: e.unit_id,
        embedding,
        embedded_at: new Date().toISOString(),
      };
      // content_hash 컬럼이 있는 환경에서만 채운다(없으면 PostgREST 가 거부 → 미포함).
      if (t.hashAvailable) row.content_hash = embedTextHash(text);
      const { error: upErr } = await db.from('playbook_embeddings').upsert(row);
      if (upErr) throw upErr;
      ok++;
      process.stderr.write('.');
    } catch (err) {
      fail++;
      log(`\n   ✗ ${e.id} (${e.unit_id}): ${err.message ?? err}`);
    }
    await sleep(PACE_MS); // 레이트리밋·매장 분당 캡 보호
  }
  log(`\n✓ 재색인 완료 — 성공 ${ok} / 실패 ${fail}`);
  return { ok, fail };
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  const mode = FIX ? 'FIX(재색인)' : 'DRY-RUN(점검 전용)';
  log(`reconcile-embeddings — ${mode}${STALE ? ' +stale' : ''}${JSON_OUT ? ' +json' : ''}`);

  const { entries, embByEntry, hashAvailable, targets } = await detect();
  // fix() 가 행별로 hashAvailable 을 보게 target 에 주입.
  for (const t of targets) t.hashAvailable = hashAvailable;

  const report = summarize(entries, embByEntry, targets, hashAvailable);

  let fixResult = null;
  if (FIX && targets.length > 0) {
    fixResult = await fix(targets);
  } else if (FIX) {
    log('재색인 대상이 없습니다 — 호출 없음.');
  }

  // 사람용 표는 항상 stderr.
  printReport(report);

  // --json 이면 stdout 으로 머신리더블 결과(cron/대시보드 수집).
  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify(
        {
          mode: FIX ? 'fix' : 'dry-run',
          stale: STALE,
          hashAvailable,
          scannedAt: new Date().toISOString(),
          totals: report.totals,
          units: report.units,
          fix: fixResult,
        },
        null,
        2,
      ) + '\n',
    );
  }

  // 종료코드: dry-run 에서 누락이 있으면 1(cron/CI 가 알람 걸 수 있게), 정합이면 0.
  if (DRY_RUN && report.totals.needsReindex > 0) process.exit(1);
}

main().catch((e) => {
  log('✗ reconcile 실패: ' + (e.message ?? e));
  process.exit(1);
});
