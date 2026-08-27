// qa-quiz-gen.mjs — AI가 만든 문항이 **풀 수 있고 채점이 맞고 근거가 있는지** 잰다.
//
// ■ 왜 있나
//   qa-quiz-grading.mjs 는 **사람이 쓴 고정물**로 채점을 잰다. 그건 "채점 함수가 맞나"만 답한다.
//   진짜 물음은 "**AI가 만든 물건**이 성립하나"다 — 형태가 구현돼 있어도 모델이 그 형태로
//   못 만들면 사장 화면에는 이유 없이 "문제를 못 만들었어요"만 남는다(2026-08-25 t3·t5 실측).
//
// ■ 무엇을 재나 — 형태 18종, 형태당 엣지 1회
//   (a) 만들어 내는가        items.length > 0 · rejected 사유
//   (b) 풀 수 있는가         레지스트리 validate 통과 + 형태별 성립 조건(아래 solvable)
//   (c) 채점이 맞는가        만든 문항을 **DB에 넣고 서버로 정답·오답을 왕복**시킨다
//   (d) 지어내지 않았는가    정답 근거가 재료 노하우 본문에 실제로 있는지 대조
//
// ■ 규율
//   · 생성 로직을 복제하지 않는다. generateQuizItems 를 그대로 부른다(엣지·정규화·검증 전부 실경로).
//   · **LLM 실호출 = 비용.** 형태당 1회, 총 18회. 사용자 승인 후에만 돈다.
//   · (d) 는 기계가 완전히 못 푼다 — 겹침 비율을 내고 **본문을 전부 출력**해 사람이 읽게 한다.
//   · 쓰레기 행을 남기지 않는다(id 접두어 하나로 전량 삭제).
//
// 사용: node scripts/qa-quiz-gen.mjs        (★엣지 18회 호출 — 캡 18 차감)
//       node scripts/qa-quiz-gen.mjs --cases=2  (형태당 2케이스 — 총 36회)
//       node scripts/qa-quiz-gen.mjs --dry      (호출 없이 재료 선정만 확인)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry');
// 형태당 케이스 수. ★케이스 1회당 엣지 1회 = 캡 1 차감. 기본 1, --cases N 으로 올린다.
const CASES = Math.max(1, Number((process.argv.find((a) => a.startsWith('--cases=')) ?? '').split('=')[1]) || 1);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function pe(f) {
  const o = {};
  try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch { /* 없으면 빈 객체 */ }
  return o;
}
const env = { ...pe(join(root, '.env')), ...pe(join(root, '.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const UNIT = 'store_001';
const QA_EMAIL = 'owner@pilot.squaretable.app';   // 고정 QA 계정(AGENTS)
const QA_PW = 'pilot1234';

const SH = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' };
const srvRpc = async (name, body) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: SH, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* JSON 이 아닐 수 있다 */ }
  return { ok: r.ok, body: j, raw: t };
};
const srvRest = async (method, path, body) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { ...SH, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return { ok: r.ok, status: r.status, raw: t };
};

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); return ok; };

// ── 클라 SSOT 를 노드로 ────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'qa-quiz-gen-'));
try {
  execFileSync(process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.qa-quiz-gen.json'), '--outDir', out],
    { cwd: root, stdio: 'pipe' });
} catch (e) {
  const msg = String(e?.stdout ?? e?.message ?? e);
  if (!msg.includes('error TS')) { console.error('트랜스파일 실패:', msg.slice(0, 400)); process.exit(2); }
}

// 로그인 먼저 — 스텁이 **진짜 세션**을 물고 있어야 엣지가 열린다.
const login = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: QA_EMAIL, password: QA_PW }),
})).json();
if (!login.access_token) { console.error('FAIL: 고정 QA 계정 로그인 실패 —', JSON.stringify(login).slice(0, 200)); process.exit(2); }

// generate.ts 상단의 supabase·expo 의존만 껍데기로 바꾼다. **판정·생성 코드는 손대지 않는다.**
const STUBS = {
  'lib/supabase.js': `exports.supabase = { auth: { getSession: async () => ({ data: { session: { access_token: ${JSON.stringify(login.access_token)} } } }) } };`,
  'lib/ai/config.js': `exports.AI_ENDPOINT = ${JSON.stringify(`${URL_}/functions/v1/ai`)}; exports.ANON = ${JSON.stringify(ANON)}; exports.USE_MOCK = false;`,
  'lib/analytics/track.js': 'exports.reportError = () => {}; exports.track = () => {};',
  'lib/utils/id.js': "let n = 0; exports.genId = (p) => `${p}_gen${++n}`;",
};
for (const [rel, body] of Object.entries(STUBS)) writeFileSync(join(out, rel), body, 'utf8');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...restArgs) {
  if (request.startsWith('@/')) return origResolve.call(this, join(out, request.slice(2)), ...restArgs);
  return origResolve.call(this, request, ...restArgs);
};
const require_ = createRequire(import.meta.url);
const { generateQuizItems } = require_(join(out, 'lib', 'quiz', 'generate.js'));
const { FORMATS, FORMAT_KEYS } = require_(join(out, 'lib', 'quiz', 'formats', 'index.js'));
const { detectKinds, numericValues, storeTerms } = require_(join(out, 'lib', 'quiz', 'detect.js'));
const { findConfusionPair } = require_(join(out, 'lib', 'quiz', 'confusion.js'));
const { pairPlanFor } = require_(join(out, 'lib', 'quiz', 'pairing.js'));
const { MAX_TARGET: FILL_MAX } = require_(join(out, 'lib', 'quiz', 'formats', 'fillCount.js'));

/**
 * 형태마다 **그 형태가 요구하는 재료**를 앞에 세운다.
 *
 * ★ 재료를 안 갈라 주면 RED 가 "이 형태가 깨졌다"가 아니라 "이 6건에 재료가 없었다"가 되어
 *   측정이 무의미해진다. 반대로 되는 재료만 골라 주면 결과를 부풀린다 — 그래서 조건은
 *   **제품이 쓰는 함수 그대로**(numericValues·storeTerms·findConfusionPair) 판정하고,
 *   조건에 맞는 노하우가 없으면 그 사실을 그대로 적는다.
 */
function materialFor(key, pool, offset = 0) {
  const kind = FORMATS[key].kind;
  const byKind = pool.filter((e) => detectKinds(e).includes(kind));
  let want = byKind;
  let why = `유형 ${kind}`;
  if (key === 'numeric_entry') {
    want = pool.filter((e) => numericValues(e).some((n) => n.value > FILL_MAX));
    why = `${FILL_MAX} 초과 수치 보유`;
  } else if (key === 'fill_count') {
    want = pool.filter((e) => numericValues(e).some((n) => n.value >= 1 && n.value <= FILL_MAX));
    why = `1~${FILL_MAX} 수치 보유`;
  } else if (key === 'chosung' || key === 'name_pick') {
    want = pool.filter((e) => storeTerms(e).length > 0);
    why = '매장 고유 용어 보유';
  } else if (key === 'scale_pick') {
    const pair = findConfusionPair(pool, pool);
    want = pair ? [...pair] : [];
    why = '혼동쌍';
  } else if (kind === 't4') {
    // ★t4 는 detectKinds 가 못 잡는다 — 짝은 노하우 **여러 건**이 있어야 성립하기 때문이다
    //   (formats/index.ts 주석 · generate.pickFormats 의 pairPlan). 그래서 제품과 같은 판정으로 찾는다.
    want = [];
    for (let i = 0; i < pool.length && want.length === 0; i++) {
      const win = pool.slice(i, i + 6);
      if (win.length >= 3 && pairPlanFor(key, win, pool)) want = win;
    }
    why = '짝 세트 성립';
  }
  // ★케이스 2회차는 **다른 노하우**로 물어야 한다. 같은 재료로 두 번 부르면 "이 노하우에서만
  //   실패하는가"와 "이 형태가 늘 실패하는가"를 가를 수 없다 — 그게 2회씩 도는 이유다.
  const rot = want.length > 1 ? [...want.slice(offset % want.length), ...want.slice(0, offset % want.length)] : want;
  const rest = pool.filter((e) => !rot.includes(e));
  return { list: [...rot, ...rest].slice(0, 6), fitCount: want.length, why };
}

// ── 정답 좌표 — "정답이 무엇인가"의 정의다(채점 로직의 복제가 아니다) ───────
function answerOf(format, payload, view) {
  const p = payload;
  switch (format) {
    case 'mc4': case 'order_pick': case 'value_pick': case 'trap_pick':
    case 'case_pick': case 'name_pick': case 'chosung': case 'scale_pick':
      return p.answer_index;
    case 'wrong_spot': return p.wrong_index;
    case 'fill_count': return p.target;
    case 'numeric_entry': return p.answer_value;
    case 'order_build': return p.answer_seq;
    case 'branch_path': return p.answer_path;
    case 'mine_tap': return (p.cards ?? []).map((c, i) => (c.is_mine === true ? i : -1)).filter((i) => i >= 0);
    case 'quick_judge': return (p.cards ?? []).map((c) => c.answer);
    case 'flip_match': {
      const cards = view?.cards ?? [];
      return cards.map((c, i) => ({ g: Number(c.group), i })).sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.i);
    }
    case 'link_match': {
      const rights = view?.rights ?? [];
      const m = {};
      (p.pairs ?? []).forEach((pr, i) => { m[String(i)] = rights.indexOf(pr.right); });
      return m;
    }
    default: return null;
  }
}

/** 정답을 확실히 빗나가는 응답 하나. 오답이 오답으로 채점되는지 보려는 것뿐이다. */
function aWrongOf(format, payload, correct) {
  const p = payload;
  switch (format) {
    case 'mc4': case 'order_pick': case 'value_pick': case 'trap_pick':
    case 'case_pick': case 'name_pick': case 'chosung': case 'scale_pick':
      return (p.answer_index + 1) % (p.choices?.length ?? 2);
    case 'wrong_spot': return (p.wrong_index + 1) % (p.sequence?.length ?? 2);
    case 'fill_count': return p.target === 1 ? 2 : p.target - 1;
    case 'numeric_entry': return p.answer_value === 1 ? 2 : p.answer_value - 1;
    case 'order_build': return [...correct].reverse().join() === correct.join() ? correct.slice(1) : [...correct].reverse();
    case 'branch_path': return correct.map((v) => (v === 0 ? 1 : 0));
    case 'mine_tap': return correct.length > 1 ? correct.slice(1) : [];
    case 'quick_judge': return correct.map((v) => (v === 0 ? 1 : 0));
    // ★뒤집기는 **뒤집어도 정답이다** — [a0,a1,a2,a3] 를 뒤집으면 짝 (a3,a2)(a1,a0) 이 그대로 산다.
    //   판을 깨려면 짝의 경계를 넘어 자리를 바꿔야 한다(1번과 2번을 맞바꾼다).
    case 'flip_match': {
      const w = [...correct];
      if (w.length >= 4) { const t = w[1]; w[1] = w[2]; w[2] = t; }
      return w;
    }
    case 'link_match': { const m = {}; const ks = Object.keys(correct); ks.forEach((k, i) => { m[k] = correct[ks[(i + 1) % ks.length]]; }); return m; }
    default: return null;
  }
}

/** 형태별 "이건 애초에 못 푼다" 조건. validate 가 안 보는 것만 본다. */
function solvable(format, p) {
  const bad = [];
  const txt = (v) => String(v ?? '').trim();
  if (['mc4', 'order_pick', 'value_pick', 'trap_pick', 'case_pick', 'name_pick', 'chosung', 'scale_pick'].includes(format)) {
    if (!Array.isArray(p.choices) || p.choices.length < 2) bad.push('선택지 2개 미만');
    if (!(p.answer_index >= 0 && p.answer_index < (p.choices?.length ?? 0))) bad.push('정답이 보기 밖');
  }
  if (format === 'chosung') {
    // 초성이 정답 용어와 글자 수가 안 맞으면 힌트가 아니라 방해다.
    const ans = txt(p.choices?.[p.answer_index]);
    const cho = txt(p.chosung).split(/\s+/).filter(Boolean);
    if (cho.length && ans.replace(/\s/g, '').length !== cho.length) bad.push(`초성 ${cho.length}자 ↔ 정답 ${ans.replace(/\s/g, '').length}자 불일치`);
  }
  if (format === 'value_pick' || format === 'scale_pick' || format === 'fill_count' || format === 'numeric_entry') {
    if (!txt(p.unit)) bad.push('단위 없음');
  }
  if (format === 'case_pick' && !txt(p.situation)) bad.push('상황 없음');
  if (format === 'quick_judge' && (!Array.isArray(p.labels) || p.labels.length !== 2)) bad.push('버튼 이름 2개 아님');
  if (format === 'branch_path') {
    if (!Array.isArray(p.results) || p.results.length < 2) bad.push('결과 2개 미만');
  }
  return bad;
}

/** (d) 근거 대조 — 정답 문구의 글자가 재료 노하우 본문에 얼마나 있나. 기계가 낼 수 있는 최선의 신호. */
function grounding(answerText, sourceText) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, '');
  const src = norm(sourceText);
  const a = norm(answerText);
  if (!a) return null;
  // 2글자 조각 기준 겹침 — 한국어에서 어미 변화를 넘겨 세기에 적당하다.
  const grams = [];
  for (let i = 0; i + 2 <= a.length; i++) grams.push(a.slice(i, i + 2));
  if (grams.length === 0) return null;
  const hit = grams.filter((g) => src.includes(g)).length;
  return Math.round((hit / grams.length) * 100);
}

/** 이 문항의 "정답 문구" — (d) 대조 대상. */
function answerTextOf(format, p) {
  switch (format) {
    case 'mc4': case 'order_pick': case 'value_pick': case 'trap_pick':
    case 'case_pick': case 'name_pick': case 'chosung': case 'scale_pick':
      return p.choices?.[p.answer_index];
    case 'wrong_spot': return p.sequence?.[p.wrong_index];
    case 'fill_count': return `${p.target}${p.unit ?? ''}`;
    case 'numeric_entry': return `${p.answer_value}${p.unit ?? ''}`;
    case 'order_build': return (p.answer_seq ?? []).map((i) => p.items?.[i]).join('');
    case 'branch_path': return (p.results ?? []).join('');
    case 'mine_tap': return (p.cards ?? []).filter((c) => c.is_mine === true).map((c) => c.text).join('');
    case 'quick_judge': return (p.cards ?? []).map((c) => c.text).join('');
    case 'flip_match': case 'link_match': return (p.pairs ?? []).map((x) => `${x.left}${x.right}`).join('');
    default: return '';
  }
}

let first = true;
const PREFIX = `qi_gen_${String(Date.now()).slice(-9)}`;
const rowsOut = [];

(async () => {
  console.log('\n━━ AI 생성 문항 실측 — 형태 18종 × 1케이스 ━━');
  console.log(`   매장 ${UNIT} · 계정 ${QA_EMAIL} · 엣지 호출 ${DRY ? '0회(--dry)' : `최대 ${FORMAT_KEYS.length * CASES}회`}\n`);

  const r = await fetch(`${URL_}/rest/v1/playbook_entries?select=*&unit_id=eq.${UNIT}&limit=500`, { headers: SH });
  const pool = await r.json();
  if (!Array.isArray(pool) || pool.length === 0) { console.error('노하우가 없다 — npm run qa:seed 먼저'); process.exit(2); }
  console.log(`재료 노하우 ${pool.length}건`);

  // ★캡은 **그 사용자 토큰으로** 물어야 한다 — service_role 로 부르면 매장이 안 잡혀
  //   used 0 / exceeded true 라는 엉뚱한 값이 나온다(엣지는 사용자 클라이언트로 부른다).
  const qr = await fetch(`${URL_}/rest/v1/rpc/ai_quota_status`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log(`AI 캡(사장 기준): ${(await qr.text()).slice(0, 120)}\n`);

  for (const key of FORMAT_KEYS) {
   const spec = FORMATS[key];
   for (let ci = 0; ci < CASES; ci++) {
    const row = { key, ci, label: spec.label, made: '—', solvable: '—', graded: '—', ground: '—', note: '' };
    rowsOut.push(row);
    console.log(`\n══ ${key} (${spec.label} · ${spec.kind}) — 케이스 ${ci + 1}/${CASES}`);

    // 재료: 이 형태가 요구하는 조건에 맞는 노하우를 앞에 세우고 6건까지 채운다(묶음형은 3건 이상 필요).
    // 케이스마다 재료를 돌려 쓴다 — 같은 노하우로 두 번 물으면 "형태 탓"과 "노하우 탓"을 못 가른다.
    const { list, fitCount, why } = materialFor(key, pool, ci * 3);
    row.note = fitCount === 0 ? `재료없음(${why})` : '';
    console.log(`   재료 ${list.length}건 · 조건 "${why}" 충족 ${fitCount}건: ${list.map((e) => e.title).join(' / ').slice(0, 160)}`);
    if (fitCount === 0) console.log(`   ⚠️ 이 매장에 이 형태의 재료가 없다 — RED 가 나와도 "형태가 깨졌다"는 뜻이 아니다`);
    if (DRY) { row.made = 'dry'; continue; }

    // ★엣지 레이트리밋이 사용자당 분당 10회다(index.ts RATE_PER_MIN_USER). 붙여 쏘면 429 가 나고
    //   클라는 4xx 를 재시도하지 않아 그 형태가 **측정 실패가 아니라 생성 실패로 잘못 기록된다.**
    if (!first) await new Promise((r) => setTimeout(r, 7000));
    first = false;

    // (a) 만들어 내는가 — 실경로 그대로
    let items = [];
    try {
      items = await generateQuizItems(list, [key], { unitId: UNIT, pool });
    } catch (e) {
      row.made = 'ERR'; row.note = String(e?.message ?? e).slice(0, 120);
      check(`(a) ${key} 생성`, false, row.note);
      continue;
    }
    row.made = check(`(a) ${key} 문항 생성 ${items.length}개`, items.length > 0, items.length ? '' : '빈 배열 — 낼 게 없다고 판단했거나 모델이 못 만들었다') ? 'OK' : 'RED';
    if (items.length === 0) continue;

    const it = items[0];
    console.log(`   payload: ${JSON.stringify(it.payload).slice(0, 500)}`);

    // (b) 풀 수 있는가
    const vErr = spec.validate(it.payload);
    const bad = solvable(key, it.payload);
    row.solvable = check(`(b) ${key} 풀 수 있는 문항`, vErr === null && bad.length === 0, [vErr, ...bad].filter(Boolean).join(' · ')) ? 'OK' : 'RED';

    // (c) 채점이 맞는가 — DB에 넣고 서버로 왕복
    const id = `${PREFIX}_${key}_${ci}`;
    const ins = await srvRest('POST', 'quiz_items', [{
      id, unit_id: UNIT, entry_ids: it.entry_ids, kind: it.kind, format: key,
      payload: it.payload, source: 'ai', status: 'active',
    }]);
    if (!ins.ok) { row.graded = '저장실패'; check(`(c) ${key} 저장`, false, ins.raw.slice(0, 160)); continue; }

    let view = null;
    if (key === 'flip_match' || key === 'link_match') {
      const got = await srvRest('GET', `quiz_items?select=created_at&id=eq.${id}`);
      const sd = (await srvRpc('quiz_shuffle_seed', { p_id: id, p_created_at: JSON.parse(got.raw)[0]?.created_at })).body;
      view = (await srvRpc('quiz_strip_payload', { p_seed: sd, p_format: key, p_payload: it.payload })).body;
    }
    const correct = answerOf(key, it.payload, view);
    const wrong = aWrongOf(key, it.payload, correct);
    const grade = async (res) => {
      const g = await srvRpc('quiz_grade_item', { p_item_id: id, p_unit_id: UNIT, p_response: res });
      if (!g.ok) return { err: (g.body?.message ?? g.raw).slice(0, 140) };
      const rr = Array.isArray(g.body) ? g.body[0] : g.body;
      return { correct: rr?.correct };
    };
    const gc = await grade(correct);
    const gw = await grade(wrong);
    const gOk = !gc.err && gc.correct === true && (gw.err ? false : gw.correct === false);
    row.graded = check(`(c) ${key} 정답→통과 · 오답→미통과`, gOk,
      gc.err ? `정답 채점 예외 ${gc.err}` : gc.correct !== true ? `정답을 오답이라 함 ${JSON.stringify(correct)}` : gw.err ? `오답 채점 예외 ${gw.err}` : gw.correct !== false ? `오답 ${JSON.stringify(wrong)} 을 정답이라 함` : '') ? 'OK' : 'RED';

    // (d) 근거가 재료 안에 있나
    const srcText = list.filter((e) => it.entry_ids.includes(e.id)).map((e) => JSON.stringify(e)).join(' ') || list.map((e) => JSON.stringify(e)).join(' ');
    const ansText = answerTextOf(key, it.payload);
    // ★정답이 사실상 숫자인 형태(채워 넣기·숫자 답하기)는 겹침이 의미가 없다 — "1번" 은 겹칠 글자가
    //   없어서 0% 가 나온다. 그 경우 근거가 되는 문장(explain)을 대신 대조한다.
    const numericAnswer = /^[0-9]+\D{0,3}$/.test(String(ansText ?? '').trim());
    const gAns = numericAnswer ? null : grounding(ansText, srcText);
    const gWhy = grounding(it.payload.explain, srcText);
    row.ground = gAns === null ? (gWhy === null ? 'n/a' : `설명 ${gWhy}%`) : `${gAns}%`;
    console.log(`  · (d) 근거 겹침 — 정답문구 ${gAns === null ? '(숫자라 생략)' : `${gAns}%`} · 설명문 ${gWhy === null ? 'n/a' : `${gWhy}%`}  ← 낮으면 사람이 본문을 읽어야 한다`);
   }
  }

  const del = await srvRest('DELETE', `quiz_items?id=like.${PREFIX}*`);
  check('정리: 생성 문항 회수', del.ok, del.ok ? '' : del.raw.slice(0, 160));

  console.log('\n━━ AI 생성 판정표 ━━');
  console.log('형태'.padEnd(16), '케이스', '(a)생성', '(b)풀림', '(c)채점', '(d)근거');
  for (const x of rowsOut) {
    console.log(x.key.padEnd(16), String(x.ci + 1).padEnd(6), String(x.made).padEnd(7), String(x.solvable).padEnd(7), String(x.graded).padEnd(7), x.ground, x.note ? `· ${x.note}` : '');
  }
  // ★형태별 요약 — 2회 중 몇 번 됐나. "한 번은 됐다"와 "늘 된다"는 다른 말이다.
  console.log('\n━━ 형태별 요약(생성 성공 / 시도) ━━');
  for (const key of FORMAT_KEYS) {
    const mine = rowsOut.filter((x) => x.key === key);
    const ok = mine.filter((x) => x.made === 'OK').length;
    const gradedRed = mine.filter((x) => x.graded === 'RED').length;
    const solvRed = mine.filter((x) => x.solvable === 'RED').length;
    const flagSpots = [];
    if (ok === 0) flagSpots.push('★생성 전멸');
    else if (ok < mine.length) flagSpots.push('생성 불안정');
    if (gradedRed) flagSpots.push('★채점 RED');
    if (solvRed) flagSpots.push('★못 푸는 문항');
    console.log(`  ${key.padEnd(16)} ${ok}/${mine.length}  ${flagSpots.join(' · ')}`);
  }
  console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('하니스 자체가 죽었다:', e);
  await srvRest('DELETE', `quiz_items?id=like.${PREFIX}*`);
  process.exit(2);
});
