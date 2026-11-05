#!/usr/bin/env node
// check-select-bounds.mjs — 서버 상한(PostgREST max_rows=1000)에 조용히 잘릴 수 있는 "무경계 읽기"가 새로 늘지 않게 막는 래칫 (2026-11-05 · M1)
//
// 세는 것(파일별): `supabase.from(` 또는 `supabase.rpc(` 로 시작하는 체인 1개 = 1건. 단, 체인 안에
//   .limit( · .range( · .single( · .maybeSingle( · head: true · 쓰기(.insert( .update( .upsert( .delete()
//   중 하나라도 있으면 세지 않는다. `readAllPages(` 콜백 안의 체인도 세지 않는다(페이징이 바깥에서 끝을 보장).
// 체인의 끝 = 문자열·주석을 지운 코드에서 괄호 깊이 0 의 `;` `,` 또는 깊이가 음수가 되는 닫는 괄호, 또는
//   다음 줄이 `.` 로 이어지지 않는 줄바꿈. 줄 단위 휴리스틱이다(check-design-literals 수준) — ESLint 룰이 아니다.
// 제외: Array.from · Buffer.from · supabase.storage.from(스토리지 · 행 상한 무관).
// ★rpc 는 결과 행 수를 정적으로 알 수 없어 전부 센다(스칼라 RPC 도 1건). 기준선이 그 소음을 묶는다 — 늘지만 않으면 된다.
//
// 대상: src/**/*.ts(x). 기준선 = scripts/check-select-bounds-baseline.json (파일별 건수). 파일 건수가 기준선보다 늘면 종료 1.
//
// 사용법:
//   npm run check:select-bounds                        검사(늘어난 파일이 있으면 종료 코드 1)
//   npm run check:select-bounds -- --update-baseline   지금 건수로 기준선을 다시 쓴다
//   node scripts/check-select-bounds.mjs --root <dir>  다른 스냅샷(<dir>/src)을 센다 · 기준선 비교는 그대로
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPO, 'scripts', 'check-select-bounds-baseline.json');
const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx >= 0 && argv[rootIdx + 1] ? path.resolve(argv[rootIdx + 1]) : REPO;

// 주석을 지우고 문자열 내용을 공백으로 바꾼다(따옴표는 남긴다 · 길이·줄 수 보존).
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

const OPEN = '([{';
const CLOSE = ')]}';
// 체인 시작 위치(`.from(`/`.rpc(` 의 `.`)에서 체인 끝(배타)까지.
function chainEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) { if (--depth < 0) return i; }
    else if (depth === 0) {
      if (c === ';' || c === ',') return i;
      if (c === '\n') {
        const next = code.slice(i + 1).match(/^\s*(\S)/);
        if (!next || next[1] !== '.') return i;
      }
    }
  }
  return code.length;
}
// `readAllPages(` 호출의 괄호 범위 [열림, 닫힘].
function pagedRanges(code) {
  const out = [];
  const re = /\breadAllPages\s*(?:<[^()]*?>)?\s*\(/g;
  for (const m of code.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const close = chainEnd(code, open + 1);
    out.push([open, close]);
  }
  return out;
}

const START = /\.(from|rpc)\(/g;
const BOUND = /\.(limit|range|single|maybeSingle|insert|update|upsert|delete)\(|\bhead\s*:\s*true\b/;
const SKIP_RECEIVER = new Set(['Array', 'Buffer', 'Object', 'Promise', 'storage']);

function scanFile(src) {
  const code = strip(src);
  const paged = pagedRanges(code);
  const hits = [];
  for (const m of code.matchAll(START)) {
    const at = m.index;
    const recv = code.slice(Math.max(0, at - 80), at).match(/([\w$]+)\s*$/)?.[1] ?? '';
    if (SKIP_RECEIVER.has(recv)) continue;
    if (paged.some(([o, c]) => at > o && at < c)) continue;
    const end = chainEnd(code, at);
    if (BOUND.test(code.slice(at, end))) continue;
    hits.push(code.slice(0, at).split('\n').length);
  }
  return hits;
}

function scan() {
  const files = {};
  const lines = [];
  let scanned = 0;
  const abs = path.join(ROOT, 'src');
  if (!existsSync(abs)) { console.log(`중단: ${abs} 없음`); process.exit(2); }
  for (const e of readdirSync(abs, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !/\.tsx?$/.test(e.name)) continue;
    const full = path.join(e.parentPath ?? e.path, e.name);
    const rel = path.relative(ROOT, full).replaceAll('\\', '/');
    scanned++;
    const hits = scanFile(readFileSync(full, 'utf8'));
    if (hits.length) {
      files[rel] = hits.length;
      for (const l of hits) lines.push(`${rel}:${l}`);
    }
  }
  return { scanned, lines, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
}

const total = (files) => Object.values(files).reduce((s, n) => s + n, 0);

const { scanned, lines, files } = scan();
for (const l of lines) console.log('  ' + l);
const now = total(files);
console.log(`무경계 읽기 ${now}건 · 검사 파일 ${scanned}개${ROOT !== REPO ? ` · root=${ROOT}` : ''}`);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ total: now, files }, null, 2) + '\n');
  console.log(`기준선 갱신 → ${path.relative(REPO, BASELINE_PATH).replaceAll('\\', '/')}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).files;
} catch {
  console.log('중단: 기준선 없음 — `npm run check:select-bounds -- --update-baseline` 으로 만든다');
  process.exit(2);
}

const grown = [];
let shrunk = 0;
for (const f of new Set([...Object.keys(files), ...Object.keys(baseline)])) {
  const cur = files[f] ?? 0;
  const prev = baseline[f] ?? 0;
  if (cur > prev) grown.push(`  · ${f}  ${prev}→${cur}${f in baseline ? '' : ' (새 파일)'}`);
  else if (cur < prev) shrunk++;
}

if (grown.length) {
  console.log('FAIL 무경계 읽기가 늘었다 — 윈도(gte/lte)+limit, readAllPages 페이징, single/maybeSingle 중 하나를 쓴다. 꼭 필요하면 이유를 적고 --update-baseline');
  for (const g of grown) console.log(g);
} else {
  console.log('PASS 새 무경계 읽기 없음');
}
if (shrunk) console.log(`줄어든 파일 ${shrunk}개 — \`npm run check:select-bounds -- --update-baseline\` 으로 기준선을 줄인다`);
console.log(`기준선 ${total(baseline)}건 → 지금 ${now}건`);
process.exit(grown.length ? 1 : 0);
