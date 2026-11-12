#!/usr/bin/env node
// check-race-markers.mjs — "읽고 판정한 뒤 쓰는데 막는 표식이 없는" DB 함수가 새로 늘지 않게 막는 래칫 (2026-11-12 · 결함 전수 점검 S6)
//
// 입력: supabase/migrations/*.sql 의 함수별 최신 정의(번호가 가장 큰 파일 · 그 뒤에 drop 되면 뺀다). DB 를 읽지 않는다(CI 에서 돈다).
// 세는 것(함수 1개 = 1건): 본문이 쓰고(insert · update … set · delete from) 판정하는데(plpgsql select … into · if [not] exists( · count(*))
//   아래 표식이 하나도 없는 함수.
//     for update · for share · skip locked · pg_advisory* · on conflict · unique_violation · lock table · 본문 안 `-- race: <이유>` 주석
//   잠금이 필요 없는 확인 뒤 쓰기는 본문에 `-- race: <이유>` 한 줄을 단다(race 규칙 문안 9).
// 기준선 = scripts/check-race-markers-baseline.json(함수 이름 목록). 기준선에 없는 함수가 걸리면 종료 1.
//   (숫자만 보면 하나 고치고 하나 새로 만들 때 못 잡는다. 그래서 이름으로 본다.)
//
// ⚠️한계(숫자가 줄어도 안전하다는 뜻이 아니다 · 늘어나는 것만 막는다):
//   - 정규식 분류다. 11-12 지도 작성 때 후보 67개 중 실제 문제는 10~15개였다.
//   - 표식이 "있기만" 하면 통과한다. 표식이 엉뚱한 행을 잠가도 모른다. `create_store` 는 다른 표식이 있어 통과했지만 결함이었다.
//   - 이름이 같은 오버로드는 최신 정의 하나만 본다. 동적 SQL(execute format) 안의 쓰기는 거의 못 본다.
//
// 사용법:
//   npm run check:race-markers                        검사
//   npm run check:race-markers -- --update-baseline   지금 목록으로 기준선을 다시 쓴다
//   npm run check:race-markers -- --list              걸린 함수를 파일:줄과 함께 찍는다
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIG = path.join(REPO, 'supabase', 'migrations');
const BASELINE_PATH = path.join(REPO, 'scripts', 'check-race-markers-baseline.json');
const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const LIST = argv.includes('--list');

// ── 함수별 최신 정의 ──
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const latest = new Map(); // name -> {file, line, body, lang, order}
const reDef = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi;
const reDrop = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi;
let order = 0;
for (const f of files) {
  const txt = readFileSync(path.join(MIG, f), 'utf8');
  const events = [];
  for (const m of txt.matchAll(reDef)) events.push({ at: m.index, kind: 'def', name: m[1].toLowerCase() });
  for (const m of txt.matchAll(reDrop)) events.push({ at: m.index, kind: 'drop', name: m[1].toLowerCase() });
  events.sort((a, b) => a.at - b.at);
  for (const ev of events) {
    order++;
    if (ev.kind === 'drop') { latest.delete(ev.name); continue; }
    const after = txt.slice(ev.at);
    const tag = /\$([a-z_0-9]*)\$/i.exec(after);
    if (!tag) continue;
    const bStart = tag.index + tag[0].length;
    const bEnd = after.indexOf(tag[0], bStart);
    const body = bEnd > 0 ? after.slice(bStart, bEnd) : after.slice(bStart);
    const head = (after.slice(0, tag.index) + ' ' + (bEnd > 0 ? after.slice(bEnd + tag[0].length, bEnd + tag[0].length + 200).split(';')[0] : '')).toLowerCase();
    latest.set(ev.name, { file: f, line: txt.slice(0, ev.at).split('\n').length, body, lang: /language\s+'?sql\b/.test(head) ? 'sql' : 'plpgsql' });
  }
}

// ── 분류(산출물/결함전수점검_2026-11-12/도구/classify.mjs 와 같은 규칙 · 입력만 파일로 바꿨다) ──
const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
function flagged(fn) {
  if (/--\s*race:\s*\S/i.test(fn.body)) return false;
  const s = strip(fn.body).toLowerCase();
  const writes = /insert\s+into\s+/.test(s) || /\bupdate\s+(?:only\s+)?(?:public\.)?"?[a-z_0-9.]+"?\s+(?:as\s+)?(?:[a-z_0-9]+\s+)?set\b/.test(s) || /delete\s+from\s+/.test(s);
  if (!writes) return false;
  const check = (fn.lang === 'plpgsql' && /\bselect\b[\s\S]{0,400}?\binto\b/.test(s)) || /\bif\s+(not\s+)?exists\s*\(/.test(s) || /count\s*\(\s*\*\s*\)/.test(s);
  if (!check) return false;
  const guard = /for\s+(no\s+key\s+)?update|for\s+share|skip\s+locked/.test(s) || /pg_advisory|pg_try_advisory/.test(s) || /on\s+conflict/.test(s)
    || /unique_violation/.test(s) || /\block\s+table\b/.test(s);
  return !guard;
}

const hits = [...latest].filter(([, fn]) => flagged(fn)).map(([name, fn]) => ({ name, at: `supabase/migrations/${fn.file}:${fn.line}` }))
  .sort((a, b) => a.name.localeCompare(b.name));
if (LIST) for (const h of hits) console.log(`  ${h.name}  ${h.at}`);
console.log(`표식 없는 확인 뒤 쓰기 함수 ${hits.length}개 · 최신 정의 ${latest.size}개`);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ total: hits.length, functions: hits.map((h) => h.name) }, null, 2) + '\n');
  console.log(`기준선 갱신 → ${path.relative(REPO, BASELINE_PATH).replaceAll('\\', '/')}`);
  process.exit(0);
}

let baseline;
try { baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).functions); } catch {
  console.log('중단: 기준선 없음 — `npm run check:race-markers -- --update-baseline` 으로 만든다');
  process.exit(2);
}
const added = hits.filter((h) => !baseline.has(h.name));
const gone = [...baseline].filter((n) => !hits.some((h) => h.name === n));
if (added.length) {
  console.log('FAIL 표식 없는 확인 뒤 쓰기 함수가 늘었다 — 판정 전에 잠그거나(for update · advisory) unique + on conflict/unique_violation 으로 막는다.');
  console.log('     잠금이 필요 없으면 본문에 `-- race: <이유>` 한 줄을 단다.');
  for (const h of added) console.log(`  · ${h.name}  ${h.at}`);
} else console.log('PASS 새로 걸린 함수 없음');
if (gone.length) console.log(`빠진 함수 ${gone.length}개 — \`npm run check:race-markers -- --update-baseline\` 으로 기준선을 줄인다`);
console.log(`기준선 ${baseline.size}개 → 지금 ${hits.length}개`);
process.exit(added.length ? 1 : 0);
