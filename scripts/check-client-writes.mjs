#!/usr/bin/env node
// check-client-writes.mjs — 클라 쪽 레이스 모양 세 가지가 새로 늘지 않게 막는 래칫 (2026-11-12 · 결함 전수 점검 S6)
//
// 세는 것(src/**/*.ts(x) · 파일별 건수):
//   upsert    `.upsert(` 호출의 인자에 `ignoreDuplicates` 가 없다. 행 전체를 덮어 늦은 쪽이 남의 값을 지운다(지도 M2 · M14).
//             남이 만든 행은 update 로만 고친다(AGENTS ④).
//   setData   `set({ … })` 한 번이 읽은 값(data · x.data · xRes.*)과 오류(error · x.error)를 같이 적고 오류로 가르지 않는다.
//             읽기가 실패해도 빈 값으로 목록을 덮는다(지도 M11). 실패면 이전 값을 둔다(`error ? 이전 : 새` · 먼저 return).
//   multi     함수 블록 하나가 db.ts 쓰기 함수를 2번 이상 부른다. 한 동작을 요청 둘로 나누면 가운데서 끊긴다(지도 10절 모양 2).
//             산출물/결함전수점검_2026-11-12/도구/client/multi.mjs 와 같은 규칙이다.
// 기준선 = scripts/check-client-writes-baseline.json(종류별 · 파일별 건수). 어느 파일이든 어느 종류든 늘면 종료 1.
//
// ⚠️한계(숫자가 줄어도 안전하다는 뜻이 아니다 · 늘어나는 것만 막는다):
//   - 줄 · 괄호 단위 휴리스틱이다. ESLint 룰이 아니다. 같은 모양을 다른 이름으로 쓰면 못 본다.
//   - multi 는 쓰기 함수 이름을 db.ts 머리 이름(fetch · load · get … 아님)과 본문(insert · update · rpc …)으로 고른다.
//     서버 함수 하나로 묶었어도 클라가 그 함수를 두 번 부르면 센다. 기준선이 그 소음을 묶는다.
//   - setData 는 `if (error) return` 으로 먼저 끊은 곳도 같은 set 에 error 를 적으면 센다.
//
// 사용법:
//   npm run check:client-writes                        검사
//   npm run check:client-writes -- --update-baseline   지금 건수로 기준선을 다시 쓴다
//   npm run check:client-writes -- --list              걸린 곳을 파일:줄로 찍는다
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPO, 'scripts', 'check-client-writes-baseline.json');
const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const LIST = argv.includes('--list');
const KINDS = ['upsert', 'setData', 'multi'];

// 주석을 지우고 문자열 내용을 공백으로 바꾼다(길이 · 줄 수 보존 · check-select-bounds 와 같다).
function strip(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      out += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
// 여는 괄호 위치 → 짝 닫는 괄호 위치
function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if ('([{'.includes(code[i])) depth++;
    else if (')]}'.includes(code[i]) && --depth === 0) return i;
  }
  return code.length;
}
const lineAt = (code, at) => code.slice(0, at).split('\n').length;

const files = readdirSync(path.join(REPO, 'src'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
  .map((e) => path.join(e.parentPath ?? e.path, e.name));
const rel = (f) => path.relative(REPO, f).replaceAll('\\', '/');

// ── multi 용: db.ts 쓰기 함수 이름 ──
const dbLines = readFileSync(path.join(REPO, 'src/lib/db.ts'), 'utf8').split(/\r?\n/);
const starts = [];
dbLines.forEach((l, i) => { const m = l.match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/) || l.match(/^export\s+const\s+([A-Za-z0-9_]+)\s*=/); if (m) starts.push({ n: m[1], i }); });
const WRITE_FNS = new Set();
for (let k = 0; k < starts.length; k++) {
  const b = dbLines.slice(starts[k].i, k + 1 < starts.length ? starts[k + 1].i : dbLines.length).join('\n');
  if (/\.(insert|update|upsert)\(|\.from\([^)]*\)\s*\.delete\(|\.delete\(\)\.|\.rpc\(|rpcDecision\(|rpcBool\(|\.upload\(|\.remove\(/.test(b)
    && !/^(fetch|load|get|list|subscribe|count|has|is|read|search|peek|my|check)/.test(starts[k].n)) WRITE_FNS.add(starts[k].n);
}

const hits = Object.fromEntries(KINDS.map((k) => [k, []]));
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const code = strip(src);
  const r = rel(f);

  // upsert
  for (const m of code.matchAll(/\.upsert\(/g)) {
    const open = m.index + m[0].length - 1;
    if (!/\bignoreDuplicates\b/.test(code.slice(open, closeOf(code, open)))) hits.upsert.push(`${r}:${lineAt(code, m.index)}`);
  }

  // setData
  for (const m of code.matchAll(/(?<![\w.$])set\(\s*\{/g)) {
    const open = m.index + m[0].indexOf('(');
    const arg = code.slice(open, closeOf(code, open));
    const hasData = /:\s*(?:[\w$]+\.)?data\b/.test(arg) || /:\s*[\w$]+Res\.(?!error\b)[\w$]+/.test(arg);
    const hasErr = /:\s*[^,}]*\b(?:[\w$]+\.)?error\b/.test(arg);
    const branched = /\berror\s*\?|!\s*(?:[\w$]+\.)?error\b|\berror\s*&&/.test(arg);
    if (hasData && hasErr && !branched) hits.setData.push(`${r}:${lineAt(code, m.index)}`);
  }

  // multi (원본 줄 기준 · 도구/client/multi.mjs 규칙)
  if (r === 'src/lib/db.ts') continue;
  const alias = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/db['"]/g)) {
    for (const part of m[1].split(',')) {
      const mm = part.trim().match(/^(?:type\s+)?([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/);
      if (mm && WRITE_FNS.has(mm[1])) alias.set(mm[2] || mm[1], mm[1]);
    }
  }
  const star = src.match(/import\s*\*\s*as\s+(\w+)\s+from\s*['"]@\/lib\/db['"]/);
  if (!alias.size && !star) continue;
  const lines = src.split(/\r?\n/);
  const aliasRe = [...alias.keys()].map((a) => new RegExp('(?<![A-Za-z0-9_.])' + a + '[(]'));
  const starRe = star ? new RegExp(star[1] + '[.]([A-Za-z0-9_]+)[(]', 'g') : null;
  let cur = null;
  const blocks = [];
  lines.forEach((l, i) => {
    const ind = l.match(/^\s*/)[0].length;
    const m = ind <= 4 && (l.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/) || l.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:useCallback\()?(?:async\s*)?\(/)
      || l.match(/^\s{2,4}(\w+):\s*(?:async\s*)?\(/) || l.match(/^\s{2,4}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{$/));
    if (m && !/^(if|for|while|switch|return|catch)$/.test(m[1])) { cur = { line: i + 1, calls: 0 }; blocks.push(cur); }
    if (!cur || /^\s*(\/\/|\*)/.test(l)) return;
    for (const re of aliasRe) if (re.test(l)) cur.calls++;
    if (starRe) for (const m2 of l.matchAll(starRe)) if (WRITE_FNS.has(m2[1])) cur.calls++;
  });
  for (const b of blocks) if (b.calls >= 2) hits.multi.push(`${r}:${b.line}`);
}

const byFile = (arr) => {
  const o = {};
  for (const h of arr) { const f = h.slice(0, h.lastIndexOf(':')); o[f] = (o[f] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
};
const now = Object.fromEntries(KINDS.map((k) => [k, byFile(hits[k])]));
if (LIST) for (const k of KINDS) for (const h of hits[k]) console.log(`  ${k}  ${h}`);
console.log(`upsert ${hits.upsert.length} · setData ${hits.setData.length} · multi ${hits.multi.length} · db.ts 쓰기 함수 ${WRITE_FNS.size}개`);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ total: Object.fromEntries(KINDS.map((k) => [k, hits[k].length])), ...now }, null, 2) + '\n');
  console.log(`기준선 갱신 → ${path.relative(REPO, BASELINE_PATH).replaceAll('\\', '/')}`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch {
  console.log('중단: 기준선 없음 — `npm run check:client-writes -- --update-baseline` 으로 만든다');
  process.exit(2);
}
const HOW = {
  upsert: '남의 행은 update 로 고치고, "있으면 무시"면 ignoreDuplicates: true 를 단다',
  setData: '읽기가 실패하면 이전 값을 둔다(error ? 이전 : 새 · 또는 먼저 return)',
  multi: '한 동작이면 서버 함수 하나로 묶는다',
};
const grown = [];
let shrunk = 0;
for (const k of KINDS) {
  const prev = baseline[k] ?? {};
  for (const f of new Set([...Object.keys(now[k]), ...Object.keys(prev)])) {
    const c = now[k][f] ?? 0, p = prev[f] ?? 0;
    if (c > p) grown.push(`  · ${k}  ${f}  ${p}→${c}${f in prev ? '' : ' (새 파일)'} — ${HOW[k]}`);
    else if (c < p) shrunk++;
  }
}
if (grown.length) { console.log('FAIL 클라 쓰기 레이스 모양이 늘었다(--list 로 줄을 본다). 꼭 필요하면 이유를 적고 --update-baseline'); for (const g of grown) console.log(g); }
else console.log('PASS 새로 늘어난 곳 없음');
if (shrunk) console.log(`줄어든 칸 ${shrunk}개 — \`npm run check:client-writes -- --update-baseline\` 으로 기준선을 줄인다`);
console.log(`기준선 ${KINDS.map((k) => `${k} ${baseline.total?.[k] ?? '?'}`).join(' · ')}`);
process.exit(grown.length ? 1 : 0);
