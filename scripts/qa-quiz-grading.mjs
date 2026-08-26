// qa-quiz-grading.mjs — 형태 18종을 **실제로 풀어 보고** 채점이 맞는지 잰다(양방향).
//
// ■ 왜 있나 — 이 도메인은 "개수를 세는 검사"에 5개월을 속았다
//   0158(14종)·0161(16종)·0168(18종)의 자가점검은 전부 "화이트리스트에 몇 개 있나"만 셌다.
//   0170 이 한 걸음 나아갔지만 여전히 **함수 본문에 형태 이름 리터럴이 있는지**를 볼 뿐이다
//   (0170 주석: "실제 행을 만들어 호출하는 검사는 일부러 안 한다").
//   그래서 "분기는 있는데 판정이 틀린" 경우는 아무도 못 잡는다.
//
//   qa-training.mjs 는 채점을 **mc4·mine_tap 둘만** 양방향으로 잰다(⑦-8~⑦-12).
//   나머지 16종은 저장·정답유출만 보고 채점은 한 번도 부르지 않았다.
//
// ■ 무엇을 재나 — 형태마다
//   (1) 고정물이 합법 문항인가          validate() === null
//   (2) 클라 grade() 가 양방향으로 맞나  정답→true · 오답 전부→false
//   (3) **서버 quiz_grade_item 이 양방향으로 맞나**  ← 이 파일의 존재 이유
//   (4) 응시 payload 에 정답이 남지 않나  quiz_strip_payload 실호출
//   (5) 화이트리스트에 있나              quiz_known_formats()
//
//   ★ (2)와 (3)을 **따로** 잰 뒤 어긋나면 그 자체를 실패로 본다. 사장 미리보기(클라 grade)와
//     응시 채점(서버)이 서로 다른 판정을 하면 사장이 "풀어보기"에서 본 것과 직원이 받는 결과가 다르다.
//
// ■ 규율
//   · 오답은 "값 하나 틀린 것"만 넣지 않는다. 순서형은 **뒤집은 답**, 집합형은 **부분·전체 선택**을
//     반드시 넣는다 — distinct/정렬로 비교하는 버그는 그것으로만 잡힌다.
//   · 판정 로직을 여기 복제하지 않는다. 클라는 tsc 로 옮겨 부르고, 서버는 실호출한다.
//   · 쓰레기 행을 남기지 않는다(id 접두어 하나로 전량 삭제).
//
// 사용: node scripts/qa-quiz-grading.mjs   (LLM 호출 0건 — 비용 없음)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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

const H = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' };
const rpc = async (name, body) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* 에러 본문이 JSON 이 아닐 수 있다 */ }
  return { ok: r.ok, status: r.status, body: j, raw: t };
};
const rest = async (method, path, body) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, raw: t };
};

let pass = 0, fail = 0;
const rows = [];   // 형태별 판정표
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); return ok; };

// ── 클라 SSOT 를 노드로 옮긴다(복제 금지) ──────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'qa-quiz-grading-'));
try {
  execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.qa-quiz-grading.json'), '--outDir', out],
    { cwd: root, stdio: 'pipe' },
  );
} catch (e) {
  const msg = String(e?.stdout ?? e?.message ?? e);
  if (!msg.includes('error TS')) { console.error('트랜스파일 실패:', msg.slice(0, 400)); process.exit(2); }
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...restArgs) {
  if (request.startsWith('@/')) return origResolve.call(this, join(out, request.slice(2)), ...restArgs);
  return origResolve.call(this, request, ...restArgs);
};
const require_ = createRequire(import.meta.url);
const { FORMATS, FORMAT_KEYS } = require_(join(out, 'lib', 'quiz', 'formats', 'index.js'));

// ── 고정물 ────────────────────────────────────────────────────────────────
// correct: 정답 응답 · wrongs: 반드시 오답이어야 하는 응답들 · alsoCorrect: 같이 정답이어야 하는 변형
// shuffled: true 면 정답을 서버가 섞은 응시용 payload 에서 계산한다(flip_match·link_match).
const choice = (extra = {}) => ({
  ask: '오픈 때 가장 먼저 할 일은?', choices: ['바닥 청소', '포스 켜기', '퇴근'], answer_index: 1, explain: '포스부터 켜요', ...extra,
});
const choicePair = { correct: 1, wrongs: [0, 2, '1', null, [1], { a: 1 }, 3, -1] };

const FIXTURES = {
  mc4: { payload: choice(), ...choicePair },
  order_pick: { payload: choice(), ...choicePair },
  value_pick: { payload: choice({ unit: '펌프' }), ...choicePair },
  trap_pick: { payload: choice(), ...choicePair },
  case_pick: { payload: choice({ situation: '포장 손님이 음료 3잔을 시켰어요' }), ...choicePair },
  name_pick: { payload: choice(), ...choicePair },
  // 정답은 choice() 의 answer_index 1 = '포스 켜기'(공백 빼고 4글자) → 초성도 4개여야 한다.
  chosung: {
    payload: choice({ chosung: 'ㅍ ㅅ ㅋ ㄱ' }),
    ...choicePair,
    // ★2026-08-27 실측 회귀: 모델이 6글자 정답에 초성을 7개 붙여 **풀 수 없는 문항**이 나갔다.
    //   validate 가 개수를 안 봐서 저장도 출제도 안 막혔다. 이 두 줄이 그 자리를 지킨다.
    invalid: [
      { why: '초성이 정답보다 많다', payload: choice({ chosung: 'ㅍ ㅅ ㅋ ㄱ ㄱ' }) },
      { why: '초성이 정답보다 적다', payload: choice({ chosung: 'ㅍ ㅅ' }) },
    ],
  },
  scale_pick: {
    payload: { ask: '시럽이 더 많이 들어가는 쪽은?', choices: ['레귤러', '라지'], answer_index: 1, unit: '펌프', explain: '라지가 한 펌프 더' },
    correct: 1, wrongs: [0, '1', null, [1], 2, -1],
  },
  wrong_spot: {
    payload: { ask: '잘못 놓인 자리는?', sequence: ['포스 켜기', '바닥 청소', '머신 예열'], wrong_index: 1, explain: '청소가 마지막' },
    correct: 1, wrongs: [0, 2, '1', null, [1], 3],
  },
  fill_count: {
    payload: { ask: '아이스 라떼에 시럽 몇 펌프?', target: 3, unit: '펌프', explain: '세 펌프예요' },
    correct: 3, wrongs: [2, 4, 0, '3', null, [3]],
  },
  numeric_entry: {
    payload: { ask: '우유 스팀, 몇 도까지 올리나요?', answer_value: 62, unit: '도', explain: '62도예요' },
    correct: 62, wrongs: [61, 63, 6, '62', null, [62]],
  },
  order_build: {
    // ★ 순서형이다. 뒤집은 답·자리 바꾼 답이 반드시 오답이어야 한다(집합 비교 버그를 잡는 유일한 오답).
    payload: { ask: '순서대로 눌러 주세요', items: ['바닥 청소', '포스 정산', '호퍼 비우기'], answer_seq: [1, 2, 0], explain: '정산부터' },
    correct: [1, 2, 0],
    wrongs: [[0, 2, 1], [2, 1, 0], [0, 1, 2], [1, 2], [1, 2, 0, 0], '120', null, [1, '2', 0]],
  },
  branch_path: {
    payload: {
      ask: '포장 주문으로 음료 3잔이 나왔어요',
      steps: [
        { ask: '뜨거운 음료인가요?', yes: 's1', no: 'r1' },
        { ask: '세 잔 이상인가요?', yes: 'r0', no: 'r1' },
      ],
      results: ['캐리어에 담아 드려요', '컵홀더만 끼워 드려요'],
      answer_path: [0, 0],
      explain: '뜨겁고 세 잔이면 캐리어',
    },
    correct: [0, 0],
    wrongs: [[0, 1], [1, 0], [1], [0], [0, 0, 0], null, '00'],
  },
  mine_tap: {
    payload: {
      ask: '하면 안 되는 것을 모두 누르세요', explain: '시재는 만지지 않아요',
      cards: [{ text: '시재 임의 사용', is_mine: true }, { text: '머신 예열', is_mine: false },
        { text: '금고 열어두기', is_mine: true }, { text: '문 열기', is_mine: false }],
    },
    correct: [0, 2],
    alsoCorrect: [[2, 0], [0, 2, 0]],   // 집합이라 순서·중복은 정답이어야 한다
    wrongs: [[0], [2], [], [0, 1, 2, 3], [0, 1], [1, 3], 0, null],
  },
  quick_judge: {
    payload: {
      ask: '쓸지 버릴지 고르세요', labels: ['쓴다', '버린다'], seconds: 3, explain: '유통기한이 기준',
      cards: [{ text: '오늘 뽑은 원두', answer: 0 }, { text: '어제 남은 우유', answer: 1 },
        { text: '개봉 안 한 시럽', answer: 0 }, { text: '색이 변한 과일', answer: 1 }],
    },
    correct: [0, 1, 0, 1],
    wrongs: [[1, 0, 1, 0], [0, 1, 0, 0], [0, 1, 0], [0, 1, 0, 1, 0], [], null, '0101'],
  },
  flip_match: {
    payload: {
      ask: '물건과 두는 자리를 맞춰 주세요', explain: '자리마다 정해져 있어요',
      pairs: [{ left: '시럽', right: '하부장' }, { left: '원두', right: '호퍼' }, { left: '컵', right: '상부장' }],
    },
    shuffled: 'flip',
    wrongs: [[0, 1, 2, 3, 4], [], null, 0, [0, 0, 1, 1, 2, 2]],
  },
  link_match: {
    payload: {
      ask: '물건과 두는 자리를 이어 주세요', explain: '자리마다 정해져 있어요',
      pairs: [{ left: '시럽', right: '하부장' }, { left: '원두', right: '호퍼' }, { left: '컵', right: '상부장' }],
    },
    shuffled: 'link',
    wrongs: [{ 0: 0, 1: 1 }, {}, null, [0, 1, 2], { 0: 9, 1: 9, 2: 9 }],
  },
};

const KIND = Object.fromEntries(FORMAT_KEYS.map((k) => [k, FORMATS[k].kind]));
const PREFIX = `qi_gq_${String(Date.now()).slice(-9)}`;
const UNIT = 'store_001';   // 고정 QA 매장(seed-demo.mjs). 문항은 접두어로 전량 회수한다.
const made = [];

// ── 실행 ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n━━ 퀴즈 채점 전수 — 형태 18종 × 양방향 ━━');
  console.log(`   매장 ${UNIT} · 접두어 ${PREFIX} · LLM 호출 0건\n`);

  // ⓪ 화이트리스트 ↔ 클라 레지스트리
  const known = (await rpc('quiz_known_formats', {})).body ?? [];
  const missingOnServer = FORMAT_KEYS.filter((k) => !known.includes(k));
  const extraOnServer = known.filter((k) => !FORMAT_KEYS.includes(k));
  check('⓪-1 클라 형태가 서버 화이트리스트에 전부 있다', missingOnServer.length === 0, missingOnServer.join(',') || `클라 ${FORMAT_KEYS.length}종`);
  check('⓪-2 서버에만 있는 형태 없음', extraOnServer.length === 0, extraOnServer.join(','));
  const noFixture = FORMAT_KEYS.filter((k) => !FIXTURES[k]);
  check('⓪-3 형태마다 고정물이 있다(빠지면 그 형태는 안 재진다)', noFixture.length === 0, noFixture.join(','));

  const { ok: unitOk } = await rest('GET', `units?select=id&id=eq.${UNIT}`);
  if (!unitOk) { console.error(`FAIL: ${UNIT} 조회 실패 — npm run qa:seed 먼저`); process.exit(2); }

  for (const key of FORMAT_KEYS) {
    const spec = FORMATS[key];
    const fx = FIXTURES[key];
    const row = { key, label: spec.label, validate: '—', client: '—', server: '—', strip: '—', agree: '—' };
    rows.push(row);
    console.log(`\n── ${key} (${spec.label} · ${spec.kind})`);
    if (!fx) { console.log('  ✗ 고정물 없음 — 건너뛰지 않고 실패로 센다'); fail++; row.validate = '고정물없음'; continue; }

    // (1) 합법 문항인가 — 그리고 **못 푸는 문항은 막는가**
    //   ★통과만 재면 반쪽이다. validate 가 아무것도 안 막아도 초록이 나온다 —
    //     chosung 이 정확히 그 상태였다(초성 개수를 안 봐서 풀 수 없는 문항이 그대로 저장·출제됐다).
    const vErr = spec.validate(fx.payload);
    let vOk = check(`(1) ${key} 고정물이 validate 통과`, vErr === null, vErr ?? '');
    for (const bad of fx.invalid ?? []) {
      const got = spec.validate(bad.payload);
      if (!check(`(1-x) ${key} 막아야 할 문항을 막는다 — ${bad.why}`, typeof got === 'string' && got.length > 0,
        got === null ? '통과시켰다(사장이 못 푸는 문항을 저장할 수 있다)' : '')) vOk = false;
    }
    row.validate = vOk ? 'OK' : 'RED';

    // 문항 저장 — 서버 채점은 저장된 행에만 걸 수 있다
    const id = `${PREFIX}_${key}`;
    const ins = await rest('POST', 'quiz_items', [{
      id, unit_id: UNIT, entry_ids: ['qa_grading_fixture'], kind: KIND[key], format: key,
      payload: fx.payload, source: 'owner', status: 'active',
    }]);
    if (!ins.ok) { check(`(–) ${key} 문항 저장`, false, ins.raw.slice(0, 200)); row.server = '저장실패'; continue; }
    made.push(id);

    // (4) 응시 payload 에 정답이 남는가 — 서버 strip 실호출
    const st = await rpc('quiz_strip_payload', { p_seed: 'qa_seed', p_format: key, p_payload: fx.payload });
    const stripped = st.body ?? {};
    const leftKeys = (spec.stripKeys ?? []).filter((k) => k in stripped);
    const nested = [];
    for (const arrKey of ['cards', 'parts']) {
      for (const el of stripped[arrKey] ?? []) {
        for (const bad of ['is_mine', 'is_wrong', 'answer']) if (bad in el && !nested.includes(bad)) nested.push(bad);
      }
    }
    row.strip = check(`(4) ${key} 응시 payload 에 정답 0개`, leftKeys.length === 0 && nested.length === 0,
      [...leftKeys, ...nested].join(',') || `남은 칸 ${Object.keys(stripped).join(',')}`) ? 'OK' : 'RED';

    // 섞이는 형태는 응시자가 실제로 보는 좌표계에서 정답을 만든다
    let correct = fx.correct;
    let clientCorrect = fx.correct;
    if (fx.shuffled) {
      // 시드는 문항 id + created_at 이다 → 저장된 행에서 읽어 서버와 똑같이 만든다.
      const got = await rest('GET', `quiz_items?select=created_at&id=eq.${id}`);
      const createdAt = JSON.parse(got.raw)[0]?.created_at;
      const sd = (await rpc('quiz_shuffle_seed', { p_id: id, p_created_at: createdAt })).body;
      const view = (await rpc('quiz_strip_payload', { p_seed: sd, p_format: key, p_payload: fx.payload })).body ?? {};
      if (fx.shuffled === 'flip') {
        // 같은 group 인 카드끼리 이어 붙인 순서 = 정답(서버 좌표계)
        const cards = view.cards ?? [];
        const order = cards.map((c, i) => ({ g: Number(c.group), i })).sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.i);
        correct = order;
        // 클라 grade 는 **원본 짝 좌표계**(floor(i/2))를 쓴다 — 일부러 그 좌표계로 만든다.
        clientCorrect = fx.payload.pairs.flatMap((_, p) => [p * 2, p * 2 + 1]);
      } else {
        // link: 왼쪽 원본 i → 그 오른쪽이 놓인 섞인 자리
        const rights = view.rights ?? [];
        const m = {};
        fx.payload.pairs.forEach((p, i) => { m[String(i)] = rights.indexOf(p.right); });
        correct = m;
        clientCorrect = Object.fromEntries(fx.payload.pairs.map((_, i) => [String(i), i]));
      }
      console.log(`     섞인 좌표 정답: ${JSON.stringify(correct)} · 클라 좌표 정답: ${JSON.stringify(clientCorrect)}`);
    }

    // (2) 클라 grade — 양방향
    let cOk = true, cWhy = '';
    if (spec.grade(fx.payload, clientCorrect) !== true) { cOk = false; cWhy += '정답을 오답이라 함; '; }
    for (const w of fx.wrongs) {
      if (spec.grade(fx.payload, w) !== false) { cOk = false; cWhy += `오답 ${JSON.stringify(w)} 을 정답이라 함; `; }
    }
    for (const a of fx.alsoCorrect ?? []) {
      if (spec.grade(fx.payload, a) !== true) { cOk = false; cWhy += `정답 변형 ${JSON.stringify(a)} 을 오답이라 함; `; }
    }
    row.client = check(`(2) ${key} 클라 grade 양방향`, cOk, cWhy) ? 'OK' : 'RED';

    // (3) 서버 quiz_grade_item — 양방향. ★이 파일의 존재 이유
    const grade = async (res) => {
      const r = await rpc('quiz_grade_item', { p_item_id: id, p_unit_id: UNIT, p_response: res });
      if (!r.ok) return { err: (r.body?.message ?? r.raw).slice(0, 160) };
      const rowd = Array.isArray(r.body) ? r.body[0] : r.body;
      return { correct: rowd?.correct, answer: rowd?.answer, explain: rowd?.explain };
    };
    let sOk = true, sWhy = '';
    const g1 = await grade(correct);
    if (g1.err) { sOk = false; sWhy += `정답 채점이 예외: ${g1.err}; `; }
    else {
      if (g1.correct !== true) { sOk = false; sWhy += `정답을 오답이라 함(${JSON.stringify(correct)}); `; }
      if (g1.correct === true && g1.answer !== null) { sOk = false; sWhy += '맞았는데 정답을 알려줌(유출); '; }
    }
    for (const w of fx.wrongs) {
      const g = await grade(w);
      if (g.err) continue;   // 예외는 오답 처리가 아니다 — 아래에서 따로 본다
      if (g.correct !== false) { sOk = false; sWhy += `오답 ${JSON.stringify(w)} 을 정답이라 함; `; }
    }
    for (const a of fx.alsoCorrect ?? []) {
      const g = await grade(a);
      if (g.err) { sOk = false; sWhy += `정답 변형 채점이 예외: ${g.err}; `; continue; }
      if (g.correct !== true) { sOk = false; sWhy += `정답 변형 ${JSON.stringify(a)} 을 오답이라 함; `; }
    }
    row.server = check(`(3) ${key} 서버 quiz_grade_item 양방향`, sOk, sWhy) ? 'OK' : 'RED';

    // (2)↔(3) 합치 — 섞이는 형태는 좌표계가 달라 비교 대상이 아니다
    if (fx.shuffled) { row.agree = 'n/a'; } else {
      let agree = true;
      for (const res of [correct, ...fx.wrongs, ...(fx.alsoCorrect ?? [])]) {
        const g = await grade(res);
        if (g.err) continue;
        if (spec.grade(fx.payload, res) !== g.correct) { agree = false; sWhy += `클라↔서버 불일치 ${JSON.stringify(res)}; `; }
      }
      row.agree = check(`(5) ${key} 클라 grade ↔ 서버 판정 일치`, agree, agree ? '' : '사장 미리보기와 직원 채점이 갈린다') ? 'OK' : 'RED';
    }
  }

  // ── 정리 ────────────────────────────────────────────────────────────────
  if (made.length) {
    const del = await rest('DELETE', `quiz_items?id=like.${PREFIX}*`);
    check('정리: 고정물 문항 회수', del.ok, del.ok ? `${made.length}건` : del.raw.slice(0, 200));
  }

  // ── 표 ──────────────────────────────────────────────────────────────────
  console.log('\n━━ 형태별 판정표 ━━');
  console.log('형태'.padEnd(16), '이름'.padEnd(14), '(1)합법', '(2)클라', '(3)서버', '(4)유출', '(5)합치');
  for (const r of rows) {
    console.log(r.key.padEnd(16), String(r.label).padEnd(14), r.validate.padEnd(7), r.client.padEnd(7), r.server.padEnd(7), r.strip.padEnd(7), r.agree);
  }
  console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('하니스 자체가 죽었다:', e);
  await rest('DELETE', `quiz_items?id=like.${PREFIX}*`);
  process.exit(2);
});
