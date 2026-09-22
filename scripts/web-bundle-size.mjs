// web-bundle-size.mjs — 웹 번들 크기 기준선. 본사 대시보드 작업(P1~P6)이 웹을 얼마나 무겁게 하는지 잰다.
//
//   npx expo export --platform web        먼저 빌드하고(= npm run web:size 가 같이 한다)
//   node scripts/web-bundle-size.mjs      dist 를 재고 기준선 대비 증감을 찍는다
//   node scripts/web-bundle-size.mjs --save --note="…"   측정값을 기준선 파일에 기록(커밋한다)
//
// 빌드는 여기서 부르지 않는다 — 재기만 한다. 두 일을 한 프로세스에 묶으면 빌드가 조용히 실패해도
// **예전 dist 를 재서 '변화 없음'이라고 말한다**(2026-09-22 실제로 그렇게 나왔다).
//
// 왜 필요한가: 웹은 main 머지 즉시 배포이고 Expo 56 은 단일 번들이라(코드분할 없음) 화면을 더하면
// 첫 로딩이 그만큼 길어진다. 커지면 본사 라우트 지연 로딩(experiments.asyncRoutes, 웹만)을 검토한다.
//
// ★프로덕션 번들 누수 검사도 여기서 한다 — 본사 셸 QA 미리보기 플래그('st-hq-preview')는
//   `__DEV__` 안에만 있으므로 프로덕션 산출물에 문자열이 남으면 그 접힘이 깨진 것이다.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASELINE = join(ROOT, 'scripts', 'web-bundle-baseline.json');
const args = process.argv.slice(2);
const save = args.includes('--save');
/** dist 가 이보다 오래됐으면 빌드를 안 하고 잰 것이다 — 조용히 옛 숫자를 보고하지 않는다. */
const STALE_MINUTES = 30;

/** 미리보기 플래그가 프로덕션 번들에 남으면 안 된다(src/lib/config/hqPreview.ts). */
const DEV_ONLY_MARKER = 'st-hq-preview';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('FAIL: dist 가 없다. 먼저 `npx expo export --platform web` 을 돌린다.');
  process.exit(2);
}
const ageMin = (Date.now() - statSync(DIST).mtimeMs) / 60000;
if (ageMin > STALE_MINUTES) {
  console.error(`FAIL: dist 가 ${Math.round(ageMin)}분 전 것이다 — 지금 코드가 아닐 수 있다.`);
  console.error('      `npx expo export --platform web` 을 다시 돌리고 재라.');
  process.exit(2);
}

const files = walk(DIST);
const js = files.filter((f) => f.endsWith('.js'));
const sized = js
  .map((f) => ({ name: relative(DIST, f).split(sep).join('/'), bytes: statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);

const totalJs = sized.reduce((n, f) => n + f.bytes, 0);
const totalAll = files.reduce((n, f) => n + statSync(f).size, 0);
const leaked = sized.filter((f) => readFileSync(join(DIST, f.name), 'utf8').includes(DEV_ONLY_MARKER));

const now = {
  measuredAt: new Date().toISOString().slice(0, 10),
  jsFiles: sized.length,
  totalJsBytes: totalJs,
  totalDistBytes: totalAll,
  largestChunk: sized[0] ?? null,
};

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log(`\n웹 번들 — JS ${sized.length}개 · 합계 ${kb(totalJs)} · dist 전체 ${kb(totalAll)}`);
if (sized[0]) console.log(`최대 청크 ${sized[0].name} ${kb(sized[0].bytes)}`);

let fail = 0;
if (leaked.length) {
  fail = 1;
  console.log(`\n✗ 개발 전용 플래그 '${DEV_ONLY_MARKER}' 가 프로덕션 번들에 남았다: ${leaked.map((f) => f.name).join(', ')}`);
} else {
  console.log(`✓ 개발 전용 플래그 '${DEV_ONLY_MARKER}' 프로덕션 번들에 0건`);
}

if (existsSync(BASELINE)) {
  const prev = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const d = totalJs - prev.totalJsBytes;
  const pct = prev.totalJsBytes ? ((d / prev.totalJsBytes) * 100).toFixed(2) : '0';
  console.log(`\n기준선(${prev.measuredAt}${prev.note ? ` · ${prev.note}` : ''}) 대비 JS ${d >= 0 ? '+' : ''}${kb(d)} (${d >= 0 ? '+' : ''}${pct}%)`);
} else {
  console.log('\n기준선 파일 없음 — --save 로 처음 기록한다.');
}

if (save) {
  const note = args.find((a) => a.startsWith('--note='))?.slice('--note='.length);
  writeFileSync(BASELINE, `${JSON.stringify({ ...now, note: note ?? null }, null, 2)}\n`, 'utf8');
  console.log(`\n→ 기준선 기록: ${relative(ROOT, BASELINE)}`);
}

process.exit(fail);
