#!/usr/bin/env node
// check-today-calls.mjs — 화면·훅에서 todayStr() 를 바로 부르는 자리가 다시 생기지 않게 막는 래칫 (2026-11-19 · 세션 C · C4)
//
// 왜: React Compiler 는 인자 없는 todayStr() 를 의존성 없는 값으로 보고 첫 렌더 값을 캐시에 묶는다.
//   그러면 앱을 켠 채 자정을 넘기면 어제를 오늘로 센다. 화면·훅은 useToday() 를 쓴다(src/lib/hooks/useToday.ts 머리말).
// 보는 곳: src/app · src/components · src/lib/hooks 의 .ts·.tsx (useToday.ts 자신은 뺀다).
//   스토어·유틸은 컴파일러가 컴포넌트로 다루지 않아 보지 않는다.
// 세는 것: 주석이 아닌 줄의 `todayStr(` 호출. 이벤트 콜백·effect·useState 초깃값처럼 누를 때·마운트 때 한 번 재는 게 맞는 자리는
//   같은 줄이나 바로 윗줄에 `today-ok` 주석을 단다. 주석 없는 호출 기준선 = 0. 하나라도 있으면 종료 1.
//
// 사용법: npm run check:today-calls
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src/app', 'src/components', 'src/lib/hooks'].map((r) => path.join(REPO, r));
const SKIP = new Set([path.join(REPO, 'src/lib/hooks/useToday.ts')]);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !SKIP.has(p)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of ROOTS.flatMap((r) => walk(r, []))) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (!/\btodayStr\(/.test(line)) return;
    if (line.includes('today-ok') || (lines[i - 1] ?? '').includes('today-ok')) return;
    hits.push(`${path.relative(REPO, file).replace(/\\/g, '/')}:${i + 1}: ${code}`);
  });
}

if (hits.length > 0) {
  console.error(`check:today-calls RED — 화면·훅의 todayStr() ${hits.length}곳 (기준선 0). useToday() 로 바꾸거나, 콜백·초깃값이면 today-ok 주석을 단다.`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('check:today-calls GREEN — 화면·훅의 todayStr() 0곳');
