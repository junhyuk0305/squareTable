#!/usr/bin/env node
// check-design-literals.mjs — 화면 파일이 디자인 값을 직접 적는 것이 "새로" 늘지 않게 막는 래칫 (2026-11-02)
//
// 목표: 디자인 값은 src/lib/theme/** 토큰 한 곳에서 바꾼다. 지금 있는 리터럴은 기준선으로 묶고,
//       파일별·종류별 개수가 기준선보다 늘면 실패한다. 줄어든 것은 통과(기준선 갱신 안내만).
//
// 세는 것(파일별):
//   hex      문자열 안의 색 hex(#RGB·#RGBA·#RRGGBB·#RRGGBBAA)와 rgb(·rgba(
//   fontSize fontSize: <숫자> · fontSize={<숫자>}
//   spacing  padding*·margin*·gap·rowGap·columnGap 에 숫자 리터럴(0 제외 · 0 은 "없음"이라 토큰 대상이 아니다)
// 주석(// · /* */) 안은 세지 않는다. 문자열 안의 // 는 주석으로 보지 않는다.
//
// 대상: src/app·src/components·src/styles 의 .ts/.tsx. src/lib/theme/** 는 토큰이 사는 곳이라 제외.
//
// 사용법:
//   npm run check:design-literals                       검사(늘어난 파일이 있으면 종료 코드 1)
//   npm run check:design-literals -- --update-baseline  지금 개수로 기준선을 다시 쓴다
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'check-design-literals-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const DIRS = ['src/app', 'src/components', 'src/styles'];
const KINDS = ['hex', 'fontSize', 'spacing'];

// 코드와 문자열을 나눈다. 주석은 버린다. code 에서 문자열 자리는 공백으로 둔다.
function split(src) {
  let code = '';
  const strings = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      code += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { s += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (c !== '`' && src[j] === '\n') break;
        s += src[j++];
      }
      strings.push(s);
      code += c + ' '.repeat(Math.max(0, j - i - 1)) + c;
      i = j + 1;
    } else {
      code += c;
      i++;
    }
  }
  return { code, strings };
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const RGB = /\brgba?\(/g;
const FONT = /\bfontSize\s*(?::|=\s*\{)\s*-?\d/g;
const SPACE = /\b(?:(?:padding|margin)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|gap|rowGap|columnGap)\s*:\s*(-?(?:\d+\.?\d*|\.\d+))(?![\w.])/g;

function count(src) {
  const { code, strings } = split(src);
  let hex = 0;
  for (const s of strings) hex += (s.match(HEX) || []).length + (s.match(RGB) || []).length;
  const fontSize = (code.match(FONT) || []).length;
  let spacing = 0;
  for (const m of code.matchAll(SPACE)) if (Number(m[1]) !== 0) spacing++;
  return { hex, fontSize, spacing };
}

function scan() {
  const files = {};
  let scanned = 0;
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.tsx?$/.test(e.name)) continue;
      const full = path.join(e.parentPath ?? e.path, e.name);
      const rel = path.relative(ROOT, full).replaceAll('\\', '/');
      if (rel.startsWith('src/lib/theme/')) continue;
      scanned++;
      const c = count(readFileSync(full, 'utf8'));
      const kept = Object.fromEntries(KINDS.filter((k) => c[k] > 0).map((k) => [k, c[k]]));
      if (Object.keys(kept).length) files[rel] = kept;
    }
  }
  return { scanned, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
}

const totals = (files) => {
  const t = { hex: 0, fontSize: 0, spacing: 0 };
  for (const v of Object.values(files)) for (const k of KINDS) t[k] += v[k] ?? 0;
  return t;
};
const summary = (scanned, grown, t) =>
  `검사 파일 ${scanned}개 · 늘어난 파일 ${grown}개 · hex ${t.hex} · fontSize ${t.fontSize} · 간격 ${t.spacing}`;

const { scanned, files } = scan();
const now = totals(files);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ totals: now, files }, null, 2) + '\n');
  console.log(`기준선 갱신 → ${path.relative(ROOT, BASELINE_PATH).replaceAll('\\', '/')}`);
  console.log(summary(scanned, 0, now));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).files;
} catch {
  console.log('중단: 기준선 없음 — `npm run check:design-literals -- --update-baseline` 으로 만든다');
  process.exit(2);
}

const grown = [];
let shrunk = 0;
for (const f of new Set([...Object.keys(files), ...Object.keys(baseline)])) {
  const cur = files[f] ?? {};
  const prev = baseline[f] ?? {};
  const up = KINDS.filter((k) => (cur[k] ?? 0) > (prev[k] ?? 0)).map((k) => `${k} ${prev[k] ?? 0}→${cur[k]}`);
  if (up.length) grown.push(`  · ${f}  ${up.join(', ')}${f in baseline ? '' : ' (새 파일)'}`);
  else if (KINDS.some((k) => (cur[k] ?? 0) < (prev[k] ?? 0))) shrunk++;
}

if (grown.length) {
  console.log('FAIL 디자인 리터럴이 늘었다 — 토큰(src/lib/theme/**)을 쓴다. 꼭 필요하면 이유를 적고 --update-baseline');
  for (const g of grown) console.log(g);
} else {
  console.log('PASS 새 디자인 리터럴 없음');
}
if (shrunk) console.log(`줄어든 파일 ${shrunk}개 — \`npm run check:design-literals -- --update-baseline\` 으로 기준선을 줄인다`);
console.log(summary(scanned, grown.length, now));
process.exit(grown.length ? 1 : 0);
