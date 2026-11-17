// qa-starter-steps.mjs — 사장 "시작하기" 네 단계 판정(starterProgress.ts) 케이스 표 · 순수 검사 (2026-11-17 화면 조립표 2차 0번 · 백엔드 없음 · AI 호출 0회)
//
// 왜 있나: 사장 매장 홈과 사장 허브가 이 판정 하나를 같이 쓴다. 순서·끝 조건·옛 서버(칸 없음) 처리를 여기서 잰다.
//   서버 칸(0840 task_added_ever · quiz_sent_ever)의 뜻은 qa-coldstart 가 로컬 DB 로 잰다.
// 방법: starterProgress.ts 를 typescript 로 바꿔 vm 에서 돌린다(qa-feed-patch 와 같은 방식).
// 사용: node scripts/qa-starter-steps.mjs
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
  vm.runInNewContext(js, { module, exports: module.exports, require: (id) => { throw new Error(`stub 없음: ${id}`); } });
  return module.exports;
}
const SP = load('src/lib/utils/starterProgress.ts');

console.log('— 단계 순서와 이름 —');
{
  const steps = SP.starterSteps({ knowhow: 0, staff: 0, task_added_ever: false, quiz_sent_ever: false });
  check('S1 네 단계 · 노하우 담기 → 직원 초대 → 첫 할일 등록 → 첫 퀴즈 보내기',
    steps.map((s) => s.title).join(',') === '노하우 담기,직원 초대,첫 할일 등록,첫 퀴즈 보내기', steps.map((s) => s.title).join(','));
  check('S2 "AI에 첫 질문"·"첫 할일 완료" 단계 없음', !steps.some((s) => s.id === 'ask' || /완료|질문/.test(s.title)));
}

console.log('— 케이스 표(지금 할 단계 · 졸업) —');
// [이름, 행, 기대 끝난 수, 기대 지금 할 단계, 기대 졸업]
const T = (knowhow, staff, task, quiz) => ({ knowhow, staff, task_added_ever: task, quiz_sent_ever: quiz });
const cases = [
  ['C1 첫날 0/4', T(0, 0, false, false), 0, 'knowhow', false],
  ['C2 노하우만', T(3, 0, false, false), 1, 'invite', false],
  ['C3 노하우·직원', T(3, 2, false, false), 2, 'task', false],
  ['C4 퀴즈만 남음', T(3, 2, true, false), 3, 'quiz', false],
  ['C5 다 끝남 = 졸업', T(3, 2, true, true), 4, null, true],
  ['C6 순서를 건너뛰어도 위에서 처음 안 끝난 단계', T(0, 1, true, true), 3, 'knowhow', false],
  ['C7 직원만 0명', T(5, 0, true, true), 3, 'invite', false],
  ['C8 rpc 가 bigint 를 문자열로 줘도 센다', { knowhow: '2', staff: '1', task_added_ever: true, quiz_sent_ever: true }, 4, null, true],
  // 옛 서버(0840 미적용) = 칸이 없다 → false(!!). 카드가 사라지지 않고 할일 단계가 지금 할 단계다.
  ['C9 옛 서버(새 칸 없음) = 미완료', { knowhow: 3, staff: 2 }, 2, 'task', false],
  ['C10 null 칸 = 미완료', { knowhow: 3, staff: 2, task_added_ever: null, quiz_sent_ever: null }, 2, 'task', false],
];
for (const [name, row, nDone, next, grad] of cases) {
  const steps = SP.starterSteps(row);
  const gotDone = steps.filter((s) => s.done).length;
  const gotNext = SP.starterNextId(row);
  const gotGrad = SP.starterGraduated(row);
  check(name, gotDone === nDone && gotNext === next && gotGrad === grad, `끝남 ${gotDone} · 지금 ${gotNext} · 졸업 ${gotGrad}`);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
