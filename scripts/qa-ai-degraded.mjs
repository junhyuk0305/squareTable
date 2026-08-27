// qa-ai-degraded.mjs — "AI가 죽었을 때 사용자가 그 사실을 아는가"를 정적으로 잰다(2026-08-27).
//
// 왜 필요한가: `lib/ai/client.ts` 의 일부 함수는 AI 호출이 실패하면 **조용히 mock(가짜) 결과로
// 폴백**하고 `degraded: true` 만 붙인다. 그 플래그를 호출부가 안 읽으면 사용자는 가짜 결과를
// 진짜로 받는다 — 모델 퇴역 404 를 이 폴백이 가려 한참 몰랐던 전력이 있다(무음 열화).
//
// 재는 것: 폴백하는 함수의 **모든 호출부**가 결과의 `degraded` 를 읽는가.
//   - 폴백 함수 목록은 client.ts 에서 **직접 뽑는다**(하드코딩 금지 — 새 함수가 생겨도 자동으로 걸린다).
//   - 호출 지점부터 그 try 블록이 끝날 때(`catch`)까지 안에서 `degraded` 가 나와야 한다.
//     ★뒤쪽 아무 데나 있는 `degraded` 를 세면 **다른 호출부의 고지를 자기 것으로 착각**한다
//       (2026-08-27: OwnerCoachChat 은 268행이 고지하고 392행은 안 하는데, 그냥 앞으로 훑으면 초록이 된다).
//   - 안 읽어도 되는 자리는 코드에 `qa:ai-degraded-exempt: <이유>` 를 적어 **눈에 보이게** 면제한다.
//
// LLM 0회 · 상시 게이트. 실행: node scripts/qa-ai-degraded.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CLIENT = join(SRC, 'lib', 'ai', 'client.ts');
// 정의·재수출만 있는 파일은 호출부가 아니다.
const SKIP = ['lib/ai/client.ts', 'lib/ai/mock.ts', 'lib/ai/types.ts', 'lib/ai/index.ts'];

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

/** client.ts 에서 **mock 으로 폴백하는** export 함수 이름을 뽑는다. 이게 이 게이트의 SSOT. */
function fallbackFns(src) {
  const out = [];
  const re = /export async function (\w+)\(/g;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    if (body.includes('degraded: true')) out.push(starts[i].name);
  }
  return out;
}

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(f)) acc.push(p);
  }
  return acc;
}

const fns = fallbackFns(readFileSync(CLIENT, 'utf8'));
console.log('\n[1] 폴백하는 AI 함수 (client.ts 에서 직접 추출)');
check('1개 이상 찾았다', fns.length > 0, `${fns.length}개`);
console.log('  ·', fns.join(', '));

console.log('\n[2] 호출부마다 degraded 를 읽는가');
const files = walk(SRC).filter((p) => !SKIP.includes(relative(SRC, p).replace(/\\/g, '/')));
let sites = 0;
for (const p of files) {
  const rel = relative(ROOT, p).replace(/\\/g, '/');
  const lines = readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 주석·import 는 호출이 아니다.
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import\b/.test(line)) continue;
    // ★"선언 줄이면 건너뛴다"를 **줄 전체가 const 로 시작하는가**로 판정하면 안 된다 —
    //   `const out = await structureSquare(...)` 같은 진짜 호출이 통째로 사라진다(첫 판에 그랬다).
    //   그 이름을 **선언하는** 줄인지만 본다.
    const name = fns.find((f) =>
      new RegExp(`[^\\w.]${f}\\s*\\(`).test(line) && !new RegExp(`\\b(const|let|var|function)\\s+${f}\\b`).test(line));
    if (!name) continue;
    // 같은 파일이 같은 이름의 **지역 함수**를 따로 두면 그건 AI 호출이 아니다
    // (HandoverImport 의 patchSquare 는 폼 입력을 고치는 로컬 헬퍼다).
    const declaresOwn = lines.some((l) => new RegExp(`\\b(const|let|var|function)\\s+${name}\\b`).test(l));
    if (declaresOwn) continue;
    sites++;
    const exempt = lines.slice(Math.max(0, i - 3), i + 2).join('\n').match(/qa:ai-degraded-exempt:\s*(.+)/);
    if (exempt) {
      check(`${rel}:${i + 1} ${name} — 면제`, true);
      console.log('    (사유:', exempt[1].trim(), ')');
      continue;
    }
    // 이 호출의 try 블록 안에서만 찾는다. catch 를 만나면 거기서 끊는다.
    let found = false;
    for (let j = i; j < Math.min(lines.length, i + 120); j++) {
      if (j > i && /\bcatch\s*[({]/.test(lines[j])) break;
      if (/\bdegraded\b/.test(lines[j])) { found = true; break; }
    }
    check(`${rel}:${i + 1} ${name}`, found, 'degraded 를 안 읽는다 — 실패해도 사용자가 모른다');
  }
}
check('호출부를 1개 이상 찾았다', sites > 0, `${sites}개`);

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
