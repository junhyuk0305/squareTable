/**
 * UX 검수 스캐너 — `기획/ux/AI티_제거_규칙_2026-08-04.md`의 **셀 수 있는 항목만** 센다.
 *
 * 세는 것: R1(결핍 표현·0 전시) · R2(인과 설명·자리 밖 권유·긴 문장) · R3(연속 카드는 못 셈 → 카드 스타일 수)
 * 못 세는 것: R3 유형 배정 · R4 면적/위계 — 눈으로 봐야 한다. 이 스크립트는 그 목록을 좁혀줄 뿐이다.
 *
 * 실행: node scripts/ux-audit.mjs            (요약)
 *       node scripts/ux-audit.mjs --detail   (문자열까지)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 한글 경로가 %XX로 새는 걸 막는다 — new URL().pathname 을 그대로 쓰면 안 된다.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DETAIL = process.argv.includes('--detail');

/**
 * 사용자에게 보이지 않는 것은 세지 않는다:
 * - `data/` · `.json` — 노하우 콘텐츠·시드·예시 질문. 사장이 쓴 글이지 우리 카피가 아니다.
 * - `legal/` — ~합니다체 예외 화면(워딩 기준 §2.1).
 * - `lib/quiz/formats/` · `lib/ai/` — **LLM 프롬프트 문자열**. 화면에 안 나가는데 1차 검수에서
 *   40자 초과로 잡혀 오탐이 15건 넘게 났다(2026-08-04).
 */
const SKIP = /[\\/](data)[\\/]|\.json$|[\\/]legal[\\/]|[\\/]lib[\\/](quiz[\\/]formats|ai)[\\/]/;

const RULES = [
  { id: 'R1-2', label: '결핍 표현',      re: /아직 없|없어요|없습니다|하나도 없/g },
  { id: 'R1-1', label: '0 전시',         re: /0명|0개|0건|0%/g },
  { id: 'R2-3', label: '인과 설명',      re: /없어서|때문에|있지만|어야 하는데/g },
  { id: 'R2-4', label: '권유·격려',      re: /보세요|좋아져요|쌓여요|괜찮아요|해드/g },
  { id: 'R2-5', label: '부사',           re: /정말|바로바로|손쉽게|간편하게|아주 /g },
];

/** R4-7 — 반짝이(sparkle) 아이콘 전면 금지. 문자열이 아니라 소스 전체에서 센다. */
const SPARKLE = /sparkles?(-outline|-sharp)?|✨|auto-awesome|star-four/gi;

/** 한글 UI 문자열만 뽑는다 — 따옴표 안에 한글이 2자 이상 있는 것. */
const STR = /(['"`])((?:[^'"`\\\n]|\\.)*[가-힣][^'"`\\\n]*)\1/g;

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && !SKIP.test(p)) files.push(p);
  }
})(SRC);

const rows = [];
let totals = Object.fromEntries(RULES.map((r) => [r.id, 0]));
let longSentences = 0;
let sparkleTotal = 0;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const hits = Object.fromEntries(RULES.map((r) => [r.id, []]));
  const long = [];
  for (const m of src.matchAll(STR)) {
    const s = m[2];
    if (s.length < 3) continue;
    for (const r of RULES) {
      r.re.lastIndex = 0;
      if (r.re.test(s)) hits[r.id].push(s);
    }
    // R2-5 길이 — **툴팁·안내 블록의 과장문만** 잡는다(120자).
    // 40자 상한은 1차 검수(2026-08-04)에서 폐기했다: 에러(§5.2)·모달(§5.4)·빈 화면(§5.1)·
    // 랜딩·AI 발화(§7)는 40자를 넘는 게 정상이고, 워딩 기준이 그렇게 쓰라고 지시한다.
    // 103건 중 실제 위반은 10건 미만이었다. 자리 판정은 기계가 못 하므로 길이만 극단값으로 본다.
    if (s.length > 120 && /(요|다|죠)\.?$/.test(s.trim())) long.push(s);
  }
  SPARKLE.lastIndex = 0;
  const sparks = (src.match(SPARKLE) ?? []).length;

  const n = RULES.reduce((a, r) => a + hits[r.id].length, 0) + long.length + sparks;
  if (!n) continue;
  for (const r of RULES) totals[r.id] += hits[r.id].length;
  longSentences += long.length;
  sparkleTotal += sparks;
  rows.push({ file: relative(SRC, f), n, hits, long, sparks });
}

rows.sort((a, b) => b.n - a.n);

console.log('\n=== UX 검수 (AI티 제거 규칙 · 셀 수 있는 항목만) ===\n');
console.log(`대상 파일 ${files.length}개 · 위반이 있는 파일 ${rows.length}개\n`);
for (const r of RULES) console.log(`  ${r.id} ${r.label.padEnd(8)} ${String(totals[r.id]).padStart(4)}건`);
console.log(`  R2-5 120자 초과    ${String(longSentences).padStart(4)}건`);
console.log(`  R4-7 반짝이 아이콘 ${String(sparkleTotal).padStart(4)}건  ← 전면 금지`);
console.log(`  ──────────────────────────`);
console.log(`  합계               ${String(Object.values(totals).reduce((a, b) => a + b, 0) + longSentences + sparkleTotal).padStart(4)}건\n`);

console.log(DETAIL ? '전체 파일:\n' : '상위 15개 파일:\n');
for (const row of rows.slice(0, DETAIL ? rows.length : 15)) {
  const brk = RULES.filter((r) => row.hits[r.id].length).map((r) => `${r.id}×${row.hits[r.id].length}`);
  if (row.long.length) brk.push(`R2-5×${row.long.length}`);
  if (row.sparks) brk.push(`R4-7×${row.sparks}`);
  console.log(`  ${String(row.n).padStart(3)}  ${row.file}`);
  console.log(`       ${brk.join(' · ')}`);
  if (DETAIL) {
    for (const r of RULES) for (const s of row.hits[r.id]) console.log(`         [${r.id}] ${s}`);
    for (const s of row.long) console.log(`         [R2-5] (${s.length}자) ${s.slice(0, 60)}…`);
  }
}
console.log('');
