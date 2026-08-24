// qa-pairing.mjs — t4(짝) 재료 게이트 회귀 검사. **백엔드를 안 쓴다**(순수 함수라 계정도 필요 없다).
//
// 왜 있나: ⑨뒤집기·⑩짝짓기의 유일한 실패 모드는 "조건이 안 맞는데도 문항이 나가는 것"이다.
//   짝은 **대상 ↔ 그 대상에만 해당하는 값**이라, 아래 다섯 조건이 하나라도 깨지면 문항이 성립하지 않는다:
//     ① 같은 카테고리   ② 같은 단위   ③ 값이 서로 전부 다름
//     ④ 왼쪽 이름이 서로 구별됨(비슷하면 그건 혼동쌍 재료지 짝짓기 재료가 아니다)   ⑤ 3건 이상
//   판정은 src/lib/quiz/pairing.ts 한 곳이고, 여기서는 **조건마다 하나씩 깨뜨려 null 이 나오는지**만 본다.
//
// ★ pairing.ts 는 TypeScript 라 노드가 바로 못 읽는다 → tsc 로 임시 폴더에 CommonJS 로 옮긴 뒤 부른다.
//   로직을 여기 **복제하지 않는다**(복제하면 두 곳이 어긋나서 게이트가 거짓말을 한다).
//   `@/lib/rag` 별칭만 런타임에 이어 준다.
//
// 사용: node scripts/qa-pairing.mjs   (실행마다 트랜스파일 — 몇 초)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = mkdtempSync(join(tmpdir(), 'qa-pairing-'));

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

try {
  // npx 를 거치지 않는다 — 윈도우에서 .cmd 를 spawn 하면 EINVAL 이 난다. tsc 진입점을 노드로 직접 돈다.
  execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
     '-p', join(here, 'tsconfig.qa-pairing.json'), '--outDir', out],
    { cwd: root, stdio: 'pipe' },
  );
} catch (e) {
  // 타입 에러가 있어도 emit 은 된다(noEmitOnError:false). 진짜로 파일이 없을 때만 죽는다.
  const msg = String(e?.stdout ?? e?.message ?? e);
  if (!msg.includes('error TS')) { console.error('트랜스파일 실패:', msg.slice(0, 400)); process.exit(2); }
}

// `@/lib/rag` → 트랜스파일 결과물로. 이 한 줄이 없으면 pairing.js 가 require 에서 죽는다.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) return origResolve.call(this, join(out, request.slice(2)), ...rest);
  return origResolve.call(this, request, ...rest);
};

const require_ = createRequire(import.meta.url);
const { findPairSet } = require_(join(out, 'lib', 'quiz', 'pairing.js'));

// ── 픽스처 ────────────────────────────────────────────────────────────────
// square.standard(kind:'count') 가 numericValues 의 1순위 경로다 — 본문 정규식에 의존하지 않는다.
const entry = (id, title, value, unit = '샷', section = '음료 제조') => ({
  id, title, section,
  square: { standard: { kind: 'count', value, unit } },
});

/** 조건을 전부 만족하는 기준 세트. 나머지 검사는 여기서 하나씩만 깨뜨린다. */
const OK = [
  entry('a', '아메리카노', 2),
  entry('b', '카페라떼', 1),
  entry('c', '플랫화이트', 3),
];

console.log('\n━━ t4 짝 재료 게이트(pairing.ts) ━━');

{ const set = findPairSet(OK, OK);
  check('①~⑤ 다 만족하면 짝 세트가 선다', !!set && set.members.length === 3 && set.unit === '샷',
    set ? `${set.unit} · ${set.members.map((m) => m.left).join(',')}` : 'null'); }

{ // ③ 값이 겹치면 정답이 둘이 되어 채점이 틀린다.
  const pool = [entry('a', '아메리카노', 2), entry('b', '카페라떼', 2), entry('c', '플랫화이트', 2)];
  check('③ 값이 서로 같으면 안 낸다', findPairSet(pool, pool) === null, JSON.stringify(findPairSet(pool, pool))); }

{ // ② 단위가 다르면 단위만 보고 맞힐 수 있어 문제가 성립하지 않는다.
  const pool = [entry('a', '아메리카노', 2, '샷'), entry('b', '우유 스팀', 62, '도'), entry('c', '마감 청소', 30, '분')];
  check('② 단위가 제각각이면 안 낸다', findPairSet(pool, pool) === null, JSON.stringify(findPairSet(pool, pool))); }

{ // ① 카테고리가 섞이면 한 판이 한 주제로 안 읽힌다.
  const pool = [
    entry('a', '아메리카노', 2, '샷', '음료 제조'),
    entry('b', '카페라떼', 1, '샷', '마감'),
    entry('c', '플랫화이트', 3, '샷', '오픈'),
  ];
  check('① 카테고리가 섞이면 안 낸다', findPairSet(pool, pool) === null, JSON.stringify(findPairSet(pool, pool))); }

{ // ④ 이름이 비슷하면 그건 혼동쌍(scale_pick) 재료다 — 짝짓기로 내면 찍기가 된다.
  const pool = [entry('a', '레귤러 시럽', 2), entry('b', '라지 시럽', 3), entry('c', '엑스라지 시럽', 4)];
  check('④ 이름이 서로 비슷하면 안 낸다(혼동쌍의 몫)', findPairSet(pool, pool) === null,
    JSON.stringify(findPairSet(pool, pool))); }

{ // ⑤ 2건이면 찍어서 50% 다.
  const pool = OK.slice(0, 2);
  check('⑤ 3건 미만이면 안 낸다', findPairSet(pool, pool) === null, JSON.stringify(findPairSet(pool, pool))); }

{ // 재료가 아예 없는 경우(값이 없는 노하우) — 조용히 null 이어야 한다(예외 금지).
  const pool = [{ id: 'x', title: '인사말', section: '고객 응대', square: {} }];
  let threw = null;
  try { findPairSet(pool, pool); } catch (e) { threw = String(e?.message ?? e); }
  check('값이 없는 노하우에도 예외를 던지지 않는다', threw === null, threw ?? ''); }

{ // 결정성 — 같은 재료면 같은 결과여야 한다(사장이 다시 만들었을 때 형태가 바뀌면 안 된다).
  const a = findPairSet(OK, OK), b = findPairSet(OK, OK);
  check('같은 재료면 같은 짝 세트가 나온다(Math.random 금지)',
    JSON.stringify(a) === JSON.stringify(b), ''); }

rmSync(out, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — t4 짝 재료 게이트 · 통과 ${pass} / 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
