// qa-quiz-pick.mjs — 자동 출제가 **실제로 어떤 형태를 고르는지** 분포를 잰다.
//
// ■ 왜 있나
//   형태가 구현돼 있어도 pickFormats 가 고르지 않으면 화면에 영원히 안 나온다.
//   2026-08-25 의 t3·t5 0문항 사고는 "뽑히는데 못 만드는" 쪽이었지만, 그 반대(만들 수 있는데
//   안 뽑히는) 는 아무도 잰 적이 없다. 개수가 아니라 **분포**를 봐야 보인다.
//
// ■ 무엇을 재나 — 실제 노하우(store_001 시드)를 재료로
//   ① 노하우 한 건씩 max:1 로 부를 때(quiz-new 호출부와 같은 모양) 나오는 형태 분포
//   ② 노하우 여러 건을 묶어 부를 때의 분포(묶음형이 실제로 서는지)
//   ③ 18종 중 **한 번도 안 나온 형태** — 그것이 이 검사의 산출물이다
//   ④ 안전판(일반형)이 도달 가능한 자리인지 — pickFormats 1차 선택에서 뽑히는가
//
// ■ 규율
//   판정을 복제하지 않는다. pickFormats 를 tsc 로 옮겨 그대로 부른다.
//   백엔드는 **읽기만** 한다(노하우 조회). LLM 호출 0건.
//
// 사용: node scripts/qa-quiz-pick.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function pe(f) {
  const o = {};
  try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch { /* 없으면 빈 객체 */ }
  return o;
}
const env = { ...pe(join(root, '.env')), ...pe(join(root, '.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SRV) { console.error('FAIL: URL/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); return ok; };

// ── 클라 SSOT 를 노드로 ────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'qa-quiz-pick-'));
try {
  execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.qa-quiz-pick.json'), '--outDir', out],
    { cwd: root, stdio: 'pipe' },
  );
} catch (e) {
  const msg = String(e?.stdout ?? e?.message ?? e);
  if (!msg.includes('error TS')) { console.error('트랜스파일 실패:', msg.slice(0, 400)); process.exit(2); }
}

// generate.ts 상단은 supabase·expo 를 import 한다 — pickFormats 는 그 어느 것도 안 쓰지만
// require 시점에 죽는다. 그래서 **그 모듈들만** 껍데기로 바꿔치기한다(판정 코드는 손대지 않는다).
const stub = (rel, body) => { const p = join(out, rel); writeFileSync(p, body, 'utf8'); return p; };
const STUBS = {
  'lib/supabase.js': 'exports.supabase = { auth: { getSession: async () => ({ data: {} }) } };',
  'lib/ai/config.js': "exports.AI_ENDPOINT = ''; exports.ANON = ''; exports.USE_MOCK = false;",
  'lib/analytics/track.js': 'exports.reportError = () => {}; exports.track = () => {};',
  'lib/utils/id.js': "exports.genId = (p) => `${p}_stub`;",
};
for (const [rel, body] of Object.entries(STUBS)) stub(rel, body);

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...restArgs) {
  if (request.startsWith('@/')) return origResolve.call(this, join(out, request.slice(2)), ...restArgs);
  return origResolve.call(this, request, ...restArgs);
};
const require_ = createRequire(import.meta.url);
const { pickFormats } = require_(join(out, 'lib', 'quiz', 'generate.js'));
const { FORMATS, FORMAT_KEYS, formatsForKind, safetyNetFor } = require_(join(out, 'lib', 'quiz', 'formats', 'index.js'));

// ── 실행 ──────────────────────────────────────────────────────────────────
const H = { apikey: SRV, Authorization: `Bearer ${SRV}` };
const UNIT = 'store_001';

(async () => {
  console.log('\n━━ 자동 출제 형태 분포 — pickFormats 실측 ━━');
  console.log(`   재료: ${UNIT} 의 실제 노하우 · LLM 호출 0건\n`);

  const r = await fetch(`${URL_}/rest/v1/playbook_entries?select=*&unit_id=eq.${UNIT}&limit=500`, { headers: H });
  if (!r.ok) { console.error('노하우 조회 실패:', (await r.text()).slice(0, 200)); process.exit(2); }
  const pool = await r.json();
  check('⓪ 재료 노하우 확보', pool.length >= 10, `${pool.length}건`);
  if (pool.length === 0) { console.error('노하우가 없다 — npm run qa:seed 먼저'); process.exit(2); }

  // ① 노하우 한 건씩 (quiz-new 호출부와 같은 모양: max 1)
  const single = {};
  let emptyPlans = 0;
  for (const e of pool) {
    const plans = pickFormats([e], 1, pool);
    if (plans.length === 0) { emptyPlans++; continue; }
    for (const p of plans) single[p.format] = (single[p.format] ?? 0) + 1;
  }
  console.log(`\n── ① 노하우 한 건씩 (max 1) — ${pool.length}건 중 계획 0건: ${emptyPlans}건`);
  for (const k of FORMAT_KEYS) if (single[k]) console.log(`     ${k.padEnd(16)} ${single[k]}`);

  // ② 노하우를 3~6건씩 묶어서 (묶음형이 서는 조건)
  const bundled = {};
  for (let i = 0; i < pool.length; i++) {
    for (const n of [3, 4, 6]) {
      const list = pool.slice(i, i + n);
      if (list.length < n) continue;
      for (const p of pickFormats(list, 3, pool)) bundled[p.format] = (bundled[p.format] ?? 0) + 1;
    }
  }
  console.log('\n── ② 노하우 묶음(3·4·6건, max 3)');
  for (const k of FORMAT_KEYS) if (bundled[k]) console.log(`     ${k.padEnd(16)} ${bundled[k]}`);

  // ③ 한 번도 안 나온 형태
  const seen = new Set([...Object.keys(single), ...Object.keys(bundled)]);
  const never = FORMAT_KEYS.filter((k) => !seen.has(k));
  console.log('\n── ③ 자동 출제에서 한 번도 안 나온 형태');
  if (never.length === 0) console.log('     (없음)');
  else for (const k of never) console.log(`     ${k.padEnd(16)} ${FORMATS[k].label} (${FORMATS[k].kind})`);

  // ④ 안전판(일반형)이 1차 선택에서 도달 가능한 자리인가
  //    pickFormats 는 `게임형 후보가 비면 일반형`이다. 유형에 **재료 게이트가 없는 게임형**이
  //    하나라도 있으면 후보가 영영 안 비고, 그 유형의 일반형은 1차 선택에서 도달 불가가 된다.
  console.log('\n── ④ 안전판(일반형) 도달 가능성 — 유형별');
  const KINDS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
  const unreachable = [];
  for (const kind of KINDS) {
    const specs = formatsForKind(kind);
    if (specs.length === 0) continue;
    const net = safetyNetFor(kind);
    const games = specs.slice(1);
    // 재료 게이트가 걸린 게임형: scale_pick · numeric_entry · bundled
    const ungated = games.filter((f) => f.key !== 'scale_pick' && f.key !== 'numeric_entry' && !f.bundled);
    const reachable = games.length === 0 || ungated.length === 0;
    console.log(`     ${kind}  안전판=${net?.key ?? '(없음)'}  게임형 ${games.length}종(무조건 뽑히는 것 ${ungated.length}종)  → 1차 선택 도달 ${reachable ? '가능' : '불가'}`);
    if (net && !reachable) unreachable.push(`${kind}:${net.key}`);
  }
  check('④ 안전판이 1차 선택에서 도달 가능', unreachable.length === 0,
    unreachable.length ? `도달 불가 ${unreachable.join(' ')} — 재시도 경로(generateQuizItems 안전판)에서만 산다` : '');

  console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`);
  console.log('※ ③·④ 는 실패가 아니라 **분포 보고**다. 0인 형태가 설계상 의도인지 사람이 판정한다.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('하니스 자체가 죽었다:', e); process.exit(2); });
