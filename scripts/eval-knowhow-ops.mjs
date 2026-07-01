// scripts/eval-knowhow-ops.mjs — 노하우 운영 평가 하니스 (출시 게이트, P0)
// ─────────────────────────────────────────────────────────────────────────────
// 목적: 회귀 게이트(scripts/benchmark-quality.mjs, "변경 전후 품질 유지")와 별개로,
//       "현재 서빙 품질의 절대 수준"을 측정한다:
//         ⓐ SERVE 정밀도  = SERVE된 질의 중 top1==정답 비율            (목표 ≥ 95%)
//         ⓑ 거짓 SERVE율  = (틀렸는데/음성인데 SERVE) / 전체 질의       (목표 < 2%, 신뢰 마지노선)
//         ⓒ Recall@k(1/3/5), MRR                                       (Recall@3≥0.90, MRR≥0.80)
//         ⓓ 임계값 스윕   = 0.50~0.85(0.05 간격, 8포인트)로 정밀도↔커버리지 곡선
//         ⓔ 음성 케이스(정답 없음) SERVE = 0                            (환각 서빙 0)
//
// 안전(기본 모드): DB 비변경·읽기 전용. 로그인 → playbook_entries SELECT(RLS=자기 매장만)
//                  + Edge 'search'/'intent' 호출만. chat_queries에 어떤 행도 쓰지 않는다
//                  (submit()을 호출하지 않고 hybridSearch 라우팅만 재현). 합성 distractor
//                  규모 시뮬은 별도 테스트 매장+service_role이 필요 → 가드로 막아둠(--synthetic 거부).
//
// ⚠️ 읽기전용 = DB 무변경이지만 Edge/Gemini 비용·쿼터는 발생한다. 'search'는 매 콜 임베딩을
//    생성하고(캐시 없음), verbose 케이스는 'intent'(+2차 search)까지 → 케이스당 최대 3콜.
//    운영 파일럿 매장 대신 전용 테스트 매장(동일 12엔트리 시드) 사용을 1순위로 권장.
//
// 실행:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=...  (또는 .env)
//   OPS_EMAIL=owner@pilot.squaretable.app OPS_PW=... node scripts/eval-knowhow-ops.mjs
//   (자격증명 호환: OPS_EMAIL/OPS_PW 우선, 없으면 BENCH_EMAIL/BENCH_PW 폴백)
//   라벨셋: 기본 scripts/eval-labelset.json, 없으면 scripts/eval-labelset.sample.json.
//           --labelset <path> 로 명시 지정 가능.
//   --json  : 게이트/지표/스윕/케이스를 JSON으로 stdout(CI 파이프·추세 저장용).
//
// 종료코드: 게이트 통과=0, 미달(특히 거짓SERVE율 초과)=1. CI 출시 게이트로 사용.
//
// SERVE 결정 충실 재현(핵심): Edge 'search'는 topSimilarity(벡터 cosine)만 준다. 그러나 라이브
//   클라(useChatStore.submit)의 실제 SERVE 판정은 hybridSearch의 confidence=max(렉시컬정규화,
//   topSimilarity)이고, 1차 매칭 실패+장황질의면 extractIntent로 재작성해 2차 hybridSearch를 돈다.
//   따라서 하니스는 Edge 벡터만 보지 않고 hybridSearch 전체 + verbose 재검색을 Node에서 동등 재현한다.
// SSOT: 렉시컬 알고리즘은 src/lib/rag.ts, 밴드/임계는 src/lib/ai/config.ts, 라우팅은
//   src/lib/store/useChatStore.ts(verbose 18/6, CANDIDATE_FLOOR 0.3, MAX_CANDIDATES 3),
//   융합은 src/lib/ai/searchClient.ts(RRF_K 60, TOPK 8). 아래 상수/알고리즘은 그 SSOT와 동기.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI 플래그 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (argv.includes('--synthetic')) {
  // 합성 distractor 규모 시뮬은 service_role 쓰기 + 전용 테스트 매장이 필요해 기본 모드에서 막는다.
  console.error('✗ --synthetic 은 이 하니스에서 막혀 있습니다(읽기전용 원칙). 합성 시뮬은 별도 테스트 매장+정리 스크립트로 옵트인 절차를 따르세요(노하우_운영평가_기준 참조).');
  process.exit(2);
}

// 게이트로 쓸 땐 사람이 읽는 로그가 stderr로 가야 --json stdout이 깨끗하다.
const log = (...a) => { if (JSON_OUT) console.error(...a); else console.log(...a); };

// ── env / 자격증명 ───────────────────────────────────────────────────────────
function envFromFile() {
  try {
    const t = readFileSync(join(__dir, '..', '.env'), 'utf8');
    const g = (k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
    return { URL: g('EXPO_PUBLIC_SUPABASE_URL'), ANON: g('EXPO_PUBLIC_SUPABASE_ANON_KEY') };
  } catch { return {}; }
}
const fileEnv = envFromFile();
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || fileEnv.URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || fileEnv.ANON;
const EMAIL = process.env.OPS_EMAIL || process.env.BENCH_EMAIL;
const PW = process.env.OPS_PW || process.env.BENCH_PW;
if (!URL || !ANON) { console.error('✗ SUPABASE URL/ANON 필요(.env 또는 EXPO_PUBLIC_*).'); process.exit(2); }
if (!EMAIL || !PW) { console.error('✗ OPS_EMAIL/OPS_PW(또는 BENCH_EMAIL/BENCH_PW) 환경변수 필요(파일럿/테스트 계정).'); process.exit(2); }

// ── 상수(SSOT 동기) ──────────────────────────────────────────────────────────
const SERVE = 0.7;          // config.ts SERVE_THRESHOLD
const GENERATE = 0.45;      // config.ts GENERATE_THRESHOLD (재현 라우팅용)
const RRF_K = 60;           // searchClient.ts RRF_K
const TOPK = 8;             // searchClient.ts TOPK
// SERVE 그라운딩 게이트(config.ts SERVE_* 미러 — 반드시 동기). 근거0/동점 애매는 SERVE 대신 GENERATE로.
const GATE_ON = true;
const SERVE_LEX_MIN = 0.05;
const SERVE_LEX_MARGIN = 0.02;
const SERVE_VEC_OVERRIDE = 0.2;
const CANDIDATE_FLOOR = 0.3; // useChatStore CANDIDATE_FLOOR
const MAX_CANDIDATES = 3;   // useChatStore MAX_CANDIDATES
const VERBOSE_LEN = 18;     // useChatStore: text.trim().length >= 18
const VERBOSE_WORDS = 6;    // useChatStore: wordCount >= 6
// 레이트리밋: Edge user 캡 분당 10(RATE_PER_MIN_USER), unit 분당 20. user 캡이 더 빡빡.
// verbose 케이스는 케이스당 최대 3콜(search + intent + 2차 search). 안전하게 콜당 ~6.5s 페이스.
const PER_CALL_MS = 6500;

// 게이트 목표치(노하우_운영평가_기준_v1.md 표와 동기).
const GATE = {
  servePrecision: 0.95,
  falseServeRate: 0.02,   // < 0.02 (신뢰 마지노선)
  recallAt3: 0.90,
  mrr: 0.80,
};

// ── 라벨셋 로드 + unit 동적 바인딩 전제 ───────────────────────────────────────
function loadLabelset() {
  const explicit = flagVal('--labelset');
  const candidates = explicit
    ? [isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)]
    : [join(__dir, 'eval-labelset.json'), join(__dir, 'eval-labelset.sample.json')];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      const cases = (raw.cases || []).filter((c) => c && c.query);
      if (!cases.length) continue;
      // should_serve 정규화: 명시값 우선, 없으면 expected 유무로 추론.
      const norm = cases.map((c) => {
        const expIds = c.expected_entry_ids
          ? [...new Set([...(c.expected_entry_ids || []), ...(c.expected_entry_id ? [c.expected_entry_id] : [])])]
          : (c.expected_entry_id != null ? [c.expected_entry_id] : []);
        const shouldServe = typeof c.should_serve === 'boolean' ? c.should_serve : expIds.length > 0;
        return { id: c.id, query: c.query, expectedIds: expIds, expectedKeywords: c.expected_keywords || [], shouldServe, note: c.note || '' };
      });
      return { path: p, version: raw.version ?? null, notes: raw.notes ?? '', cases: norm };
    } catch { /* 다음 후보 */ }
  }
  console.error('✗ 라벨셋을 찾을 수 없습니다. scripts/eval-labelset.json 또는 --labelset <path>.');
  process.exit(2);
}
const labelset = loadLabelset();

// ── 인증 + Edge 호출(benchmark-quality.mjs 패턴 그대로) ───────────────────────
const H = { apikey: ANON, 'Content-Type': 'application/json' };
const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: H, body: JSON.stringify({ email: EMAIL, password: PW }),
})).json();
if (!auth.access_token) { console.error('✗ 로그인 실패', auth.error_description || ''); process.exit(2); }
const AH = { ...H, Authorization: `Bearer ${auth.access_token}` };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Edge 호출 + 429 백오프 재시도(benchmark-quality.mjs의 wait 정신을 강화).
async function ai(task, payload, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(`${URL}/functions/v1/ai`, { method: 'POST', headers: AH, body: JSON.stringify({ task, payload }) });
    if (res.status === 429) {
      const backoff = 8000 * attempt; // 분당 캡 회복 대기
      log(`  · 429 레이트리밋 — ${backoff / 1000}s 백오프 후 재시도(${attempt}/${tries})`);
      await wait(backoff);
      continue;
    }
    return res.json().catch(() => ({}));
  }
  return { error: 'rate_limited_giveup' };
}

// ── 렉시컬 검색: src/lib/rag.ts 를 SSOT로 동적 import 시도, 실패 시 인라인 복제 폴백 ──
// rag.ts는 런타임 의존이 import type 뿐이라(순수 TS) tsx로 직접 import할 수 있으면 SSOT 단일화.
// .mjs 단독 node 실행에선 .ts 해석/@ alias가 안 되는 게 보통이므로, import 실패 시 알고리즘을
// 인라인 복제한다(아래 블록은 rag.ts와 1:1 동기 — rag.ts 변경 시 반드시 함께 갱신).
let searchPlaybookImported = null;
try {
  const mod = await import(pathToFileURL(join(__dir, '..', 'src', 'lib', 'rag.ts')).href);
  if (typeof mod.searchPlaybook === 'function') searchPlaybookImported = mod.searchPlaybook;
} catch { /* tsx 미설치/.ts 미해석 → 인라인 복제 사용 */ }

// ── ⬇⬇ rag.ts 인라인 복제 (SSOT=src/lib/rag.ts, 알고리즘 변경 시 양쪽 동기) ⬇⬇ ──
const TAIL_PATTERNS = [
  '달래요', '해달래요', '라는데요', '라던데요',
  '었어요', '았어요', '였어요', '이에요', '예요',
  '거든요', '잖아요', '는데요', '는데', '는거', '는 거',
  '어요', '아요', '해요', '이요', '에요',
  '어서', '아서', '해서',
  '라고', '다고', '이라고',
  '이/가', '을/를', '은/는',
  '요', '다', '임',
].sort((a, b) => b.length - a.length);
function stem(s) {
  let cur = String(s).trim().toLowerCase();
  for (const t of TAIL_PATTERNS) {
    if (cur.endsWith(t) && cur.length - t.length >= 2) { cur = cur.slice(0, cur.length - t.length); break; }
  }
  return cur;
}
const PUNCT = /[?!.,~\-—_/()\[\]{}'"·…:;]/g;
function tokenize(s) { return String(s).replace(PUNCT, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 0); }
function ngrams(s, n) {
  const clean = String(s).replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i + n <= clean.length; i++) out.add(clean.slice(i, i + n));
  return out;
}
function scoreKeywords(query, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const qStem = stem(query);
  const qTokens = tokenize(query).map(stem);
  let hits = 0;
  for (const kwRaw of keywords) {
    const kw = stem(kwRaw);
    if (kw.length === 0) continue;
    if (qStem.includes(kw) || query.includes(kwRaw)) { hits += 1; continue; }
    let partial = 0;
    for (const qt of qTokens) {
      if (qt.length < 2) continue;
      if (kw.includes(qt) || qt.includes(kw)) partial = Math.max(partial, 0.7);
    }
    hits += partial;
  }
  return Math.log2(1 + hits);
}
function scoreTitle(query, title) {
  const cleanTitle = String(title || '').replace(PUNCT, ' ');
  const q2 = ngrams(query, 2), q3 = ngrams(query, 3);
  const t2 = ngrams(cleanTitle, 2), t3 = ngrams(cleanTitle, 3);
  if (t2.size === 0) return 0;
  let inter2 = 0; for (const g of q2) if (t2.has(g)) inter2++;
  let inter3 = 0; for (const g of q3) if (t3.has(g)) inter3++;
  return inter2 / t2.size + (inter3 > 0 ? 0.3 * (inter3 / Math.max(t3.size, 1)) : 0);
}
function scoreTags(query, tags) {
  if (!tags || tags.length === 0) return 0;
  const qStem = stem(query);
  let hits = 0;
  for (const tRaw of tags) {
    const t = String(tRaw).replace(/^#/, '').trim();
    if (t.length === 0) continue;
    if (qStem.includes(t) || query.includes(t)) hits++;
  }
  return Math.log2(1 + hits);
}
const W_KW = 1.0, W_TITLE = 0.6, W_TAGS = 0.4;
function combinedScore(query, e) {
  return W_KW * scoreKeywords(query, e.search_keywords || [])
    + W_TITLE * scoreTitle(query, e.title || '')
    + W_TAGS * scoreTags(query, e.tags || []);
}
function normalize(raw, k = 1.0) { return raw <= 0 ? 0 : raw / (raw + k); }
// rag.ts searchPlaybook 동형(topK·threshold 옵션). { matched, confidence, candidates, fallbackToUnknown }.
function searchPlaybookLocal(query, entries, options) {
  const threshold = options?.threshold ?? 0.6;
  const topK = options?.topK ?? 3;
  if (!query || query.trim().length === 0 || entries.length === 0) {
    return { matched: null, confidence: 0, candidates: [], fallbackToUnknown: true };
  }
  const scored = entries.map((entry) => ({ entry, rawScore: combinedScore(query, entry) }));
  scored.sort((a, b) => b.rawScore - a.rawScore);
  const top = scored.slice(0, topK).map((s) => ({ entry: s.entry, score: Number(normalize(s.rawScore).toFixed(3)) }));
  const bestRaw = scored[0]?.rawScore ?? 0;
  const confidence = Number(normalize(bestRaw).toFixed(3));
  const fallback = confidence < threshold;
  return { matched: fallback ? null : scored[0].entry, confidence, candidates: top, fallbackToUnknown: fallback };
}
// ── ⬆⬆ rag.ts 인라인 복제 끝 ⬆⬆ ──

const lexicalSearch = searchPlaybookImported || searchPlaybookLocal;

// ── 엔트리 로드(RLS=자기 매장만; 폭주 캡 명시) + 색인 커버리지 ────────────────
async function loadEntries() {
  const r = await fetch(
    `${URL}/rest/v1/playbook_entries?select=id,unit_id,title,category,tags,search_keywords&status=eq.published&limit=2000`,
    { headers: AH },
  );
  const ents = await r.json();
  if (!Array.isArray(ents)) { console.error('✗ playbook_entries fetch 실패', JSON.stringify(ents).slice(0, 200)); process.exit(2); }
  return ents;
}
// 색인(임베딩) 커버리지: recall 하락이 '색인 미완'인지 '알고리즘'인지 분리 진단용.
async function embeddingCoverage(entryIds) {
  try {
    const r = await fetch(`${URL}/rest/v1/playbook_embeddings?select=entry_id&limit=2000`, { headers: AH });
    if (!r.ok) return null; // 테이블 미노출/권한 → 진단 생략(치명 아님)
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    const indexed = new Set(rows.map((x) => x.entry_id));
    return { indexed, covered: entryIds.filter((id) => indexed.has(id)).length, total: entryIds.length };
  } catch { return null; }
}

// ── hybridSearch 1회 재현 (렉시컬 + Edge 벡터 → RRF 융합, confidence=max) ──────
// searchClient.hybridSearch + useChatStore 후보 게이트(CANDIDATE_FLOOR/MAX_CANDIDATES)를 동형 재현.
async function hybridReproduce(query, entries, byId) {
  const lex = lexicalSearch(query, entries, { topK: TOPK });
  const v = await ai('search', { query }); // { candidates:[{id,similarity}], topSimilarity } 또는 error
  let calls = 1;
  const lexRank = new Map();
  (lex.candidates || []).forEach((c, i) => lexRank.set(c.entry.id, i));
  const vecCands = (v && Array.isArray(v.candidates)) ? v.candidates : null;
  const vecRank = new Map();
  if (vecCands) vecCands.forEach((c, i) => vecRank.set(c.id, i));

  // 서버 실패 시 렉시컬 폴백(searchClient와 동일: vec 없으면 lexical 그대로).
  let ranked, confidence;
  if (!vecCands) {
    ranked = (lex.candidates || []).map((c) => c.entry.id).filter((id) => byId.has(id)).slice(0, TOPK);
    confidence = lex.confidence;
  } else {
    const ids = new Set([...lexRank.keys(), ...vecRank.keys()]);
    const fused = [...ids].map((id) => {
      let s = 0; const lr = lexRank.get(id), vr = vecRank.get(id);
      if (lr !== undefined) s += 1 / (RRF_K + lr);
      if (vr !== undefined) s += 1 / (RRF_K + vr);
      return { id, s };
    }).sort((a, b) => b.s - a.s);
    ranked = fused.map((f) => f.id).filter((id) => byId.has(id)).slice(0, TOPK);
    confidence = Number(Math.max(lex.confidence, v.topSimilarity ?? 0).toFixed(3));
  }
  // useChatStore의 사용자 노출 후보: CANDIDATE_FLOOR 미달이면 후보 비움, 아니면 상위 MAX_CANDIDATES.
  const shownCandidates = confidence >= CANDIDATE_FLOOR ? ranked.slice(0, MAX_CANDIDATES) : [];
  // 진단용: 렉시컬 근거 강도 + 벡터 1등/2등 유사도(마진).
  const vecTop1 = vecCands ? (vecCands[0]?.similarity ?? 0) : null;
  const vecTop2 = vecCands ? (vecCands[1]?.similarity ?? 0) : null;
  // ── SERVE 그라운딩 게이트 (searchClient.ts hybridSearch 와 동일 로직 — 반드시 동기) ──
  const topId = ranked[0];
  const lexTopId = lex.candidates[0]?.entry.id;
  const lexScoreOfTop = topId ? (lex.candidates.find((c) => c.entry.id === topId)?.score ?? 0) : 0;
  const lexMargin = (lex.candidates[0]?.score ?? 0) - (lex.candidates[1]?.score ?? 0);
  const vecMargin = (vecTop1 ?? 0) - (vecTop2 ?? 0);
  const grounded =
    !GATE_ON ||
    (topId != null && topId === lexTopId && lexScoreOfTop >= SERVE_LEX_MIN && lexMargin >= SERVE_LEX_MARGIN) ||
    vecMargin >= SERVE_VEC_OVERRIDE;
  const matched = confidence >= SERVE && grounded ? (ranked[0] ?? null) : null;
  return { ranked, confidence, matched, shownCandidates, vecMissing: !vecCands, calls, lexConf: lex.confidence, vecTop1, vecTop2 };
}

// ── 케이스 1건의 라이브 라우팅 동형 측정 (verbose 재검색 포함) ─────────────────
// useChatStore.submit 분기 순서 그대로:
//  1) hybridSearch → matched면 SERVE / 아니면 GENERATE 밴드 검사
//  2) verbose(len>=18 || words>=6)면 intent 재작성 → 2차 hybridSearch (matched/GENERATE)
//  3) 그 외 DEFLECT. 단 2차가 더 강하면 후보 채택(result 갱신).
async function measureCase(c, entries, byId) {
  const text = c.query.trim();
  let totalCalls = 0;

  // 1차
  const r1 = await hybridReproduce(text, entries, byId);
  totalCalls += r1.calls;
  let result = r1;
  let dgn = r1; // 진단(렉시컬/벡터마진)은 최종 결정을 낸 검색(1차 또는 재검색)에서 캡처.
  let route, served = false, top1 = null, usedRanked = r1.ranked, confidence = r1.confidence;

  if (r1.matched) {
    route = 'SERVE'; served = true; top1 = r1.matched; confidence = r1.confidence; usedRanked = r1.ranked;
  } else if (r1.confidence >= GENERATE && r1.shownCandidates.length > 0) {
    // tryGenerate: 라이브는 generateAnswer 그라운딩 성공 시 서빙. 추가 LLM 비용을 피하려 보수적으로
    // 'GENERATE 밴드 진입'까지만 모델링한다(SERVE 정밀도/거짓SERVE는 confidence>=0.7만 집계하므로 영향 없음).
    route = 'GENERATE'; top1 = r1.ranked[0] ?? null;
  } else {
    route = 'DEFLECT';
    // 2) verbose 재검색
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const verbose = text.length >= VERBOSE_LEN || wordCount >= VERBOSE_WORDS;
    if (verbose) {
      const intent = await ai('intent', { query: text }); // { rewritten, keywords } 또는 error
      totalCalls += 1;
      const q2 = (intent && intent.rewritten ? String(intent.rewritten) : '').trim();
      if (q2 && q2 !== text) {
        const r2 = await hybridReproduce(q2, entries, byId);
        totalCalls += r2.calls;
        dgn = r2;
        if (r2.matched) {
          route = 'SERVE'; served = true; top1 = r2.matched; confidence = r2.confidence; usedRanked = r2.ranked; result = r2;
        } else if (r2.confidence >= GENERATE && r2.shownCandidates.length > 0) {
          route = 'GENERATE'; top1 = r2.ranked[0] ?? null; confidence = r2.confidence; usedRanked = r2.ranked; result = r2;
        } else if (r2.confidence > r1.confidence) {
          result = r2; usedRanked = r2.ranked; confidence = r2.confidence; top1 = r2.ranked[0] ?? null;
        }
      }
    }
  }

  // 정답 매칭(entry_id SSOT). 음성 케이스(expectedIds=[]): top1이 무엇이든 '정답 없음'.
  const expSet = new Set(c.expectedIds);
  const isPositive = c.expectedIds.length > 0;
  const top1Correct = isPositive && top1 != null && expSet.has(top1);
  // rankOfExpected: usedRanked에서 정답 id 중 가장 앞 순위(0-based). 없으면 -1.
  let rankOfExpected = -1;
  if (isPositive) {
    for (let i = 0; i < usedRanked.length; i++) { if (expSet.has(usedRanked[i])) { rankOfExpected = i; break; } }
  }
  // 색인 미커버 진단: 정답이 벡터 후보에서 빠질 수 있음(searchClient: published+embedding non-null만).
  return {
    id: c.id, query: c.query, route, served, confidence,
    top1, top1Title: top1 ? (byId.get(top1)?.title ?? top1) : null,
    expectedIds: c.expectedIds, isPositive, shouldServe: c.shouldServe,
    top1Correct, rankOfExpected, ranked: usedRanked.slice(0, 5), calls: totalCalls,
    lexConf: dgn.lexConf, vecTop1: dgn.vecTop1, vecTop2: dgn.vecTop2,
    vecMargin: (dgn.vecTop1 != null && dgn.vecTop2 != null) ? Number((dgn.vecTop1 - dgn.vecTop2).toFixed(3)) : null,
    note: c.note,
  };
}

// ── 지표 계산 ─────────────────────────────────────────────────────────────────
function computeMetrics(results) {
  const total = results.length;
  // SERVE: 라이브에서 '저장답 그대로 서빙'(confidence>=SERVE & matched). measureCase의 served가 그것.
  const served = results.filter((r) => r.served);
  const servedCorrect = served.filter((r) => r.top1Correct);
  const servePrecision = served.length ? servedCorrect.length / served.length : 1;
  // 거짓 SERVE: 서빙됐는데 (틀렸거나 / 음성인데 서빙). 음성 케이스 SERVE는 항상 거짓.
  const falseServe = served.filter((r) => !r.top1Correct);
  const falseServeRate = total ? falseServe.length / total : 0;
  // 음성 케이스 SERVE 수(가장 위험한 환각 서빙).
  const negServed = results.filter((r) => !r.isPositive && r.served).length;

  const pos = results.filter((r) => r.isPositive);
  const recallAt = (k) => pos.length ? pos.filter((r) => r.rankOfExpected >= 0 && r.rankOfExpected < k).length / pos.length : 0;
  const mrr = pos.length ? pos.reduce((a, r) => a + (r.rankOfExpected >= 0 ? 1 / (r.rankOfExpected + 1) : 0), 0) / pos.length : 0;

  return {
    total, posCount: pos.length, negCount: total - pos.length,
    servedCount: served.length, servedCorrect: servedCorrect.length,
    servePrecision, falseServeCount: falseServe.length, falseServeRate,
    negServed,
    recallAt1: recallAt(1), recallAt3: recallAt(3), recallAt5: recallAt(5), mrr,
  };
}

// ── 임계값 스윕 (0.50~0.85, 0.05) — config 무변경, confidence 분포 재라우팅 시뮬 ──
function sweep(results) {
  const rows = [];
  const total = results.length || 1;
  for (let t = 0.50; t <= 0.851; t += 0.05) {
    const tt = Number(t.toFixed(2));
    const s = results.filter((r) => r.confidence >= tt);
    const sc = s.filter((r) => r.top1Correct);
    rows.push({
      threshold: tt,
      served: s.length,
      coverage: Number((s.length / total).toFixed(3)),
      precision: Number((s.length ? sc.length / s.length : 1).toFixed(3)),
      falseServeRate: Number((s.filter((r) => !r.top1Correct).length / total).toFixed(3)),
    });
  }
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// 실행
// ════════════════════════════════════════════════════════════════════════════
log('═══════ 노하우 운영 평가 하니스 (출시 게이트) ═══════');
log(`계정: ${EMAIL} · 라벨셋: ${labelset.path} (v${labelset.version}, ${labelset.cases.length}케이스)`);
log(`렉시컬: ${searchPlaybookImported ? 'rag.ts import(SSOT 단일)' : '인라인 복제(rag.ts 동기 주석)'}`);

const beforeEntries = await loadEntries();
const byId = new Map(beforeEntries.map((e) => [e.id, e]));
const unitIds = [...new Set(beforeEntries.map((e) => e.unit_id).filter(Boolean))];
const boundUnit = unitIds[0] ?? null; // 라벨셋 unit 동적 바인딩: 로그인 계정 매장(RLS로 자기 것만 옴).
log(`엔트리: ${beforeEntries.length}건 (매장 ${unitIds.length}개${boundUnit ? `, 바인딩=${boundUnit}` : ''})`);

// 시드 prelude 검증: 라벨셋의 positive expected id가 모두 fetch된 엔트리에 존재하는지.
// 실행 매장 ≠ 라벨셋 가정 시드면 전 positive가 자동 FAIL → 그 전에 명확히 막는다.
const expectedAll = [...new Set(labelset.cases.flatMap((c) => c.expectedIds))];
const missing = expectedAll.filter((id) => !byId.has(id));
if (missing.length) {
  console.error('✗ 라벨셋↔매장 불일치: 다음 expected_entry_id가 현재 로그인 매장 엔트리에 없습니다 →', missing.join(', '));
  console.error('  실행 매장이 라벨셋이 가정한 시드(예: store_001 12엔트리)와 다릅니다. 전용 테스트 매장에 동일 시드를 넣거나 라벨셋을 그 매장에 맞게 갱신하세요.');
  process.exit(2);
}

// 색인 커버리지(진단).
const cov = await embeddingCoverage(expectedAll);
if (cov) log(`색인 커버리지(정답 엔트리): ${cov.covered}/${cov.total} 임베딩 존재` + (cov.covered < cov.total ? ' ⚠️ 미커버 정답은 벡터 후보에서 빠져 recall 하락 가능' : ''));

// 케이스 측정
log('\n── 케이스 측정 (live 라우팅 동형: hybrid → verbose intent 재검색) ──');
const results = [];
for (const c of labelset.cases) {
  const r = await measureCase(c, beforeEntries, byId);
  results.push(r);
  const flag = r.isPositive ? (r.top1Correct ? '✓' : '✗') : (r.served ? '✗거짓SERVE' : '✓(미서빙)');
  log(`  [${r.route} ${r.confidence.toFixed(3)} ${r.calls}콜] ${r.id} "${r.query.slice(0, 24)}" → ${r.top1Title ?? '(없음)'} ${flag}`);
  // user 분당 10콜 캡: 케이스 콜수 × PER_CALL_MS 만큼 간격.
  await wait(r.calls * PER_CALL_MS);
}

const M = computeMetrics(results);
const SW = sweep(results);

// ── 출력: 지표 요약 + 스윕 ──
log('\n── 지표 요약 (현 컷 SERVE=0.7) ──');
log(`  SERVE 정밀도   : ${(M.servePrecision * 100).toFixed(1)}%  (${M.servedCorrect}/${M.servedCount} 서빙 중 정답)`);
log(`  거짓 SERVE율    : ${(M.falseServeRate * 100).toFixed(1)}%  (${M.falseServeCount}/${M.total})  [음성 SERVE ${M.negServed}건 포함]`);
log(`  Recall@1/3/5   : ${(M.recallAt1 * 100).toFixed(1)}% / ${(M.recallAt3 * 100).toFixed(1)}% / ${(M.recallAt5 * 100).toFixed(1)}%  (positive ${M.posCount}건)`);
log(`  MRR            : ${M.mrr.toFixed(3)}`);

log('\n── 임계값 스윕 (0.50~0.85) ──');
log('  thr   served  coverage  precision  falseServe');
for (const s of SW) {
  log(`  ${s.threshold.toFixed(2)}   ${String(s.served).padStart(4)}    ${s.coverage.toFixed(3)}     ${s.precision.toFixed(3)}      ${s.falseServeRate.toFixed(3)}`);
}

// ── 게이트 판정 ──
const checks = [
  [`SERVE 정밀도 ≥ ${(GATE.servePrecision * 100)}%`, M.servePrecision >= GATE.servePrecision],
  [`거짓 SERVE율 < ${(GATE.falseServeRate * 100)}%`, M.falseServeRate < GATE.falseServeRate],
  [`Recall@3 ≥ ${(GATE.recallAt3 * 100)}%`, M.recallAt3 >= GATE.recallAt3],
  [`MRR ≥ ${GATE.mrr}`, M.mrr >= GATE.mrr],
  ['음성 케이스 SERVE = 0', M.negServed === 0],
];
let pass = true;
log('\n═══════ 게이트 판정 ═══════');
for (const [name, ok] of checks) { log(`  ${ok ? 'PASS ✅' : 'FAIL ❌'}  ${name}`); if (!ok) pass = false; }
log(`\n총평: ${pass ? '✅ 출시 게이트 통과' : '❌ 미달 — 거짓SERVE/정밀도 점검 후 재측정(또는 임계값 재보정)'}`);

if (JSON_OUT) {
  // CI 파이프·추세 저장용: 깨끗한 JSON만 stdout.
  process.stdout.write(JSON.stringify({
    ok: pass,
    account: EMAIL,
    labelset: { path: labelset.path, version: labelset.version, count: labelset.cases.length },
    boundUnit,
    embeddingCoverage: cov ? { covered: cov.covered, total: cov.total } : null,
    gate: GATE,
    metrics: M,
    sweep: SW,
    checks: checks.map(([name, ok]) => ({ name, ok })),
    results: results.map((r) => ({
      id: r.id, query: r.query, route: r.route, served: r.served, confidence: r.confidence,
      top1: r.top1, top1Correct: r.top1Correct, rankOfExpected: r.rankOfExpected,
      expectedIds: r.expectedIds, isPositive: r.isPositive, ranked: r.ranked, calls: r.calls,
      lexConf: r.lexConf, vecTop1: r.vecTop1, vecTop2: r.vecTop2, vecMargin: r.vecMargin,
    })),
  }, null, 2) + '\n');
}

// 출시 게이트: 미달이면 비제로 종료(특히 거짓SERVE율 초과). CI에서 머지/배포 차단.
process.exit(pass ? 0 : 1);
