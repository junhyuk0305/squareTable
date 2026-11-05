// qa-feed-patch.mjs — 피드 제자리 패치·스냅샷 역전 방어 순수 검사 (2026-11-05 · M4 2차 · 백엔드 없음 · AI 호출 0회)
//
// 왜 있나: 채팅 1건을 realtime payload 로 제자리 반영하면(재조회 0) "재조회가 돌던 사이 도착한 메시지를 응답 스냅샷이 지우는" 역전이 생긴다.
//   브라우저 여정(qa-journey-task K8-①②)은 REST 예산과 표시만 재고 역전은 시점을 못 만든다. 여기서 규칙 함수(chatRules.ts)를 직접 돈다.
// 방법: chatRules.ts 를 typescript 로 바꿔 vm 에서 돌린다(qa-hydrate-telemetry 와 같은 방식).
// 사용: node scripts/qa-feed-patch.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ` · ${extra}` : ''}`); };

function load(path) {
  const js = ts.transpileModule(readFileSync(join(ROOT, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (id) => { throw new Error(`stub 없음: ${id}`); }, Date, Map, Set });
  return module.exports;
}
const CR = load('src/lib/work/chatRules.ts');
const item = (id, text, createdAt = '2026-11-05T00:00:00.000Z') => ({ id, date: '2026-11-05', kind: 'message', text, authorId: 'u1', authorName: '직원', authorRole: 'junior', createdAt });
const ids = (feed) => feed.map((f) => f.id).join(',');

console.log('— upsertFeedItem(제자리 반영) —');
{
  const base = [item('a', 'A'), item('b', 'B')];
  const ins = CR.upsertFeedItem(base, item('c', 'C'), 'INSERT');
  check('P1 INSERT 로 온 새 행은 뒤에 붙는다', ids(ins) === 'a,b,c' && base.length === 2, ids(ins));
  const upd = CR.upsertFeedItem(base, item('b', 'B2'), 'UPDATE');
  check('P2 같은 id 는 서버 행으로 바뀐다(자리 유지)', ids(upd) === 'a,b' && upd[1].text === 'B2' && base[1].text === 'B');
  const unknown = CR.upsertFeedItem(base, item('z', 'Z'), 'UPDATE');
  check('P3 UPDATE 로 온 모르는 행(목록 창 밖 옛 행)은 끌어오지 않는다', unknown === base, ids(unknown));
  const sending = CR.upsertFeedItem([{ ...item('m', 'M'), sendState: 'failed' }], item('m', 'M'), 'INSERT');
  check('P4 내 낙관 항목과 같은 id 의 서버 행이 오면 이 기기 표시(sendState)가 걷힌다', sending.length === 1 && sending[0].sendState === undefined);
}

console.log('— replayLatePatches(스냅샷 역전 방어) —');
{
  // 시나리오: 재조회가 t0 에 시작 → 그 사이 t0+5 에 채팅 c 가 도착(제자리 반영) → 응답 스냅샷에는 c 가 없다(서버가 t0 시점을 읊었다).
  const t0 = 1_000_000;
  const log = new Map();
  log.set('c', { item: item('c', 'C'), event: 'INSERT', arrivedAt: t0 + 5 });
  // 조회 시작 전(t0-5)에 온 b2 는 서버 스냅샷이 이미 담았다 → 다시 얹지 않고 로그에서 뺀다.
  log.set('b', { item: item('b', 'B-old-patch'), event: 'UPDATE', arrivedAt: t0 - 5 });
  const snapshot = [item('a', 'A'), item('b', 'B-server')];
  const out = CR.replayLatePatches(snapshot, log, t0);
  check('R1 조회 시작 뒤 도착한 패치는 스냅샷 위에 남는다(set 이 지우지 않는다)', ids(out) === 'a,b,c', ids(out));
  check('R2 조회 시작 전 도착한 패치는 다시 얹지 않는다(서버 값 유지)', out[1].text === 'B-server');
  check('R3 그 패치는 로그에서 빠지고 늦은 패치만 남는다', !log.has('b') && log.has('c'), [...log.keys()].join(','));
  // 다음 재조회(t1 > c 도착)가 끝나면 c 도 빠진다 — 로그가 영영 자라지 않는다.
  const out2 = CR.replayLatePatches([item('a', 'A'), item('b', 'B'), item('c', 'C')], log, t0 + 100);
  check('R4 다음 재조회(시작이 더 늦음) 뒤엔 로그가 빈다', log.size === 0 && ids(out2) === 'a,b,c');
  // 스냅샷에 이미 들어 있는 늦은 패치를 다시 얹어도 두 번 들어가지 않는다(id 교체).
  const log3 = new Map([['c', { item: item('c', 'C'), event: 'INSERT', arrivedAt: t0 + 5 }]]);
  const out3 = CR.replayLatePatches([item('a', 'A'), item('c', 'C')], log3, t0);
  check('R5 스냅샷에 이미 있는 늦은 패치는 중복되지 않는다', ids(out3) === 'a,c');
}

console.log(`\nRESULT: pass ${pass} fail ${fail} · 백엔드 0 · AI 호출 0회`);
process.exit(fail ? 1 : 0);
