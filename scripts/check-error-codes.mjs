// check-error-codes.mjs — 서버가 내는 오류 코드마다 앱에 사람이 읽을 문구가 있는가(AGENTS.md ⑨ · 결함 점검 S5 · 2026-11-12).
//
// 왜: 서버가 새 raise 코드를 냈는데 클라 문구 표에 없으면 화면은 일반 문구("잠시 뒤 다시 시도")로 떨어진다.
//     0227 franchise_can_end 가 이렇게 빠졌고, 게이트는 전부 green 이었다.
//
// 서버 쪽: supabase/migrations 에서 함수마다 **최고 번호 정의**만 본다(drop 뒤 다시 만들지 않으면 뺀다).
//   본문(주석 제외)의 raise exception '<코드>' 에서 첫 낱말(소문자 snake)을 코드로 쓴다. 'unit_not_found: %' → unit_not_found.
//   앱이 닿는 함수만 센다: anon·authenticated 에 실행 권한이 남은 함수 + 트리거 함수.
//   권한은 create(기본 = 둘 다 부여 · 0084 머리말) → revoke … from <역할> → grant … to <역할> 를 파일 순서대로 따라간다.
//   자가점검 DO 블록·한글 문구 raise 는 함수 본문이 아니거나 코드 모양이 아니라 빠진다.
// 클라 쪽: 문구 표 = src/lib/**/errors.ts(iap 제외 · 스토어 오류용) · src/lib/utils/userError.ts · src/lib/decision.ts.
//   표에 낱말로 있으면 '표', 표에는 없지만 src 다른 곳에 따옴표·정규식으로 있으면 '인라인', 둘 다 아니면 '없음'.
//   '없음' 은 화면이 일반 문구로 떨어지는 코드다. 래칫은 '없음' 만 센다.
//
// 기준선 = scripts/check-error-codes-baseline.json (없음 코드 목록). 목록 밖의 새 '없음' 코드가 생기면 종료 1.
// 사용법:
//   npm run check:error-codes                      검사
//   npm run check:error-codes -- --list            코드별 상태를 전부 찍는다
//   npm run check:error-codes -- --update-baseline 지금 '없음' 목록으로 기준선을 다시 쓴다
// 백엔드를 쓰지 않는다.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPO, 'scripts', 'check-error-codes-baseline.json');
const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const LIST = argv.includes('--list');
const MIG = path.join(REPO, 'supabase', 'migrations');

const stripComments = (s) => s.replace(/--[^\n]*/g, '');

// ── 서버: 함수별 최고 번호 정의 · 권한 ─────────────────────────────────────
/** name → { file, codes:Set, trigger:boolean, roles:Set } */
const fns = new Map();
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const raw = readFileSync(path.join(MIG, file), 'utf8').replace(/\r\n/g, '\n');
  const events = [];
  // create function: 본문은 as $tag$ … $tag$
  for (const m of raw.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
    const head = raw.slice(m.index, m.index + 4000);
    const open = head.match(/\$(\w*)\$/);
    if (!open) continue;
    const bodyStart = m.index + open.index + open[0].length;
    const bodyEnd = raw.indexOf(open[0], bodyStart);
    if (bodyEnd < 0) continue;
    const sig = head.slice(0, open.index);
    const body = stripComments(raw.slice(bodyStart, bodyEnd));
    const codes = new Set();
    for (const r of body.matchAll(/raise\s+(?:exception\s+)?'([a-z][a-z0-9_]*)(?=[\s:'.%/])/g)) codes.add(r[1]);
    events.push({ at: m.index, kind: 'create', name: m[1].toLowerCase(), codes, trigger: /returns\s+trigger\b/i.test(sig) });
  }
  const text = stripComments(raw);
  // 위치는 주석 제거본 기준이라 create 와 섞어 정렬하면 조금 어긋난다 → 한 파일 안에서는 create 를 먼저, 권한을 뒤에 적용한다.
  // 실제 마이그레이션은 create 뒤에 revoke/grant 를 쓴다. drop 은 create 앞에 온다.
  const drops = [], perms = [];
  for (const m of text.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([^;]+);/gi)) {
    for (const n of m[1].matchAll(/(?:public\.)?"?(\w+)"?\s*\(/g)) drops.push(n[1].toLowerCase());
  }
  for (const m of text.matchAll(/\b(revoke|grant)\s[^;]*?\bon\s+function\s+([^;]+?)\s+(from|to)\s+([^;]+);/gi)) {
    const names = [...m[2].matchAll(/(?:public\.)?"?(\w+)"?\s*\(/g)].map((n) => n[1].toLowerCase());
    const roles = m[4].toLowerCase().split(/[\s,]+/).filter(Boolean);
    perms.push({ op: m[1].toLowerCase(), names, roles });
  }
  // 이 파일에서 다시 만든 함수: drop 이 있으면 권한을 기본으로 되돌린다.
  const created = new Map();
  for (const e of events) {
    const prev = created.get(e.name);
    if (prev) { for (const c of e.codes) prev.codes.add(c); prev.trigger ||= e.trigger; continue; }
    created.set(e.name, { codes: new Set(e.codes), trigger: e.trigger });
  }
  for (const d of drops) if (!created.has(d)) fns.delete(d);
  for (const [name, def] of created) {
    const old = fns.get(name);
    const reset = !old || drops.includes(name);
    fns.set(name, { file, codes: def.codes, trigger: def.trigger, roles: reset ? new Set(['anon', 'authenticated']) : old.roles });
  }
  for (const p of perms) {
    for (const n of p.names) {
      const f = fns.get(n);
      if (!f) continue;
      for (const r of p.roles) {
        if (r !== 'anon' && r !== 'authenticated') continue;
        if (p.op === 'revoke') f.roles.delete(r); else f.roles.add(r);
      }
    }
  }
}

/** code → [함수 이름 …] (앱이 닿는 함수만) */
const serverCodes = new Map();
for (const [name, f] of fns) {
  if (!f.trigger && f.roles.size === 0) continue;
  for (const c of f.codes) {
    if (!serverCodes.has(c)) serverCodes.set(c, []);
    serverCodes.get(c).push(`${name}@${f.file.slice(0, 4)}`);
  }
}

// ── 클라: 문구 표 · src 전체 ────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(REPO, p).replaceAll('\\', '/');
const srcFiles = walk(path.join(REPO, 'src'));
const isTable = (r) => (/^src\/lib\/.+\/errors\.ts$/.test(r) && !r.startsWith('src/lib/iap/'))
  || r === 'src/lib/utils/userError.ts' || r === 'src/lib/decision.ts';
let tableText = '', otherText = '';
const tableFiles = [];
for (const p of srcFiles) {
  const r = rel(p);
  const t = readFileSync(p, 'utf8');
  if (isTable(r)) { tableText += '\n' + t; tableFiles.push(r); } else otherText += '\n' + t;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const status = (code) => {
  if (new RegExp(`(?<![A-Za-z0-9_])${esc(code)}(?![A-Za-z0-9_])`).test(tableText)) return '표';
  // 인라인 = 따옴표 안이나 정규식 안에 코드가 낱말로 있다 · 또는 화면 안 표의 키(`code_expired: '…'`)
  const w = `(?<![A-Za-z0-9_])${esc(code)}(?![A-Za-z0-9_])`;
  if (new RegExp(`['"\`/^][^'"\`\\n]{0,40}${w}`).test(otherText) || new RegExp(`${w}\\s*:\\s*['"\`]`).test(otherText)) return '인라인';
  return '없음';
};

const rows = [...serverCodes.keys()].sort().map((c) => ({ code: c, st: status(c), fns: serverCodes.get(c) }));
const missing = rows.filter((r) => r.st === '없음').map((r) => r.code);
const count = (s) => rows.filter((r) => r.st === s).length;

console.log(`서버 코드 ${rows.length}개(앱이 닿는 함수 ${[...fns.values()].filter((f) => f.trigger || f.roles.size).length}개) · 표 ${count('표')} · 인라인 ${count('인라인')} · 없음 ${missing.length}`);
console.log(`문구 표 ${tableFiles.length}개: ${tableFiles.join(' · ')}`);
if (LIST) for (const r of rows) console.log(`  ${r.st.padEnd(3)} ${r.code}  ← ${r.fns.slice(0, 3).join(', ')}${r.fns.length > 3 ? ` 외 ${r.fns.length - 3}` : ''}`);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ total: missing.length, missing }, null, 2) + '\n');
  console.log(`기준선 갱신 → ${rel(BASELINE_PATH)} (없음 ${missing.length}개)`);
  process.exit(0);
}
if (!existsSync(BASELINE_PATH)) {
  console.log('중단: 기준선 없음 — `npm run check:error-codes -- --update-baseline` 으로 만든다');
  process.exit(2);
}
const base = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).missing);
const grown = missing.filter((c) => !base.has(c));
const fixed = [...base].filter((c) => !missing.includes(c));
if (grown.length) {
  console.log('FAIL 문구 없는 새 서버 코드 — 화면에 일반 문구가 뜬다. 같은 커밋에서 그 도메인 표(src/lib/<도메인>/errors.ts)에 문구를 넣는다');
  for (const c of grown) console.log(`  · ${c}  ← ${serverCodes.get(c).join(', ')}`);
}
if (fixed.length) console.log(`기준선에서 빠질 코드 ${fixed.length}개(문구가 생겼거나 서버에서 사라짐) — \`--update-baseline\` 으로 줄인다: ${fixed.join(', ')}`);
console.log(`기준선 ${base.size}개 → 지금 ${missing.length}개`);
process.exit(grown.length ? 1 : 0);
