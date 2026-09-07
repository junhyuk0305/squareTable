#!/usr/bin/env node
// 네이티브 사전 검증(preflight) — 빌드·실기기 전에 로컬에서 "앱에서도 웹처럼 돌 것인가"를 답한다.
// 절차 정본: 00_핵심/실기기_테스트_런북_2026-08-31.md
//
// 답하는 질문 세 개:
//   Q1. 웹 전용 API(window·document·localStorage…)가 네이티브 경로에 **새로** 새지 않았나. (래칫)
//       → 기존 사용처는 baseline에 있고, 새 위반만 RED. 가드했거나 의도한 것이면 --update-baseline.
//   Q2. `.web.ts(x)` 분기마다 네이티브 짝 파일이 있나. (짝 없으면 웹은 되고 앱은 import에서 죽는다)
//   Q3. Android·iOS JS 번들이 실제로 만들어지는가. (`expo export -p android` / `-p ios` — 모듈 해석·
//       웹 전용 import 누출·문법 오류를 기기 없이 잡는 가장 강한 로컬 검사. 수 분 걸림, --skip-bundle로 생략 가능)
//
// 이 게이트가 **못** 잡는 것(런북의 수동 체크리스트로): 런타임 크래시, 터치/키보드 체감,
// 푸시·사진·음성 등 네이티브 모듈의 실동작. "preflight green"은 "번들이 뜬다"까지만 보증한다.
//
// 사용법:
//   npm run native:preflight                     전체(번들 포함)
//   npm run native:preflight -- --skip-bundle    빠른 판정(Q1·Q2만)
//   npm run native:preflight -- --update-baseline  새 위반을 판단 후 baseline에 등록
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'native-preflight-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const SKIP_BUNDLE = process.argv.includes('--skip-bundle');

const problems = [];
const warns = [];

// ── 파일 수집 ─────────────────────────────────────────────────────
const srcFiles = [];
for (const entry of readdirSync(path.join(ROOT, 'src'), { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
  const abs = path.join(entry.parentPath ?? entry.path, entry.name);
  srcFiles.push(path.relative(ROOT, abs).replaceAll('\\', '/'));
}

// ── Q2. 확장자 분기 짝 검사 ──────────────────────────────────────
// 규칙(platform.md): 기본 파일 = 다수판, 확장자(.web/.ios/.android/.native) = 예외판. 기본 파일이 없으면
// 그 확장자에 해당하지 않는 플랫폼은 import 에서 죽는다.
const PLATFORM_EXT = /\.(web|ios|android|native)\.(ts|tsx)$/;
const splits = srcFiles.filter((f) => PLATFORM_EXT.test(f));
for (const f of splits) {
  const base = f.replace(PLATFORM_EXT, '');
  if (!existsSync(path.join(ROOT, `${base}.ts`)) && !existsSync(path.join(ROOT, `${base}.tsx`))) {
    problems.push(`${f} — 기본 파일(${base}.ts/.tsx) 없음. 이 확장자 밖의 플랫폼은 import에서 죽는다.`);
  }
}
console.log(`■ 확장자 분기 짝 검사: ${splits.length}개 (.web/.ios/.android/.native)`);

// ── Q1. 웹 전용 API 래칫 ─────────────────────────────────────────
// .web.* 와 +html.tsx(웹 전용 셸)는 대상 아님. 같은 줄에 가드가 있으면 통과.
const WEB_API = [
  /(^|[^.\w'"`])window\./,
  /(^|[^.\w'"`])document\./,
  /(^|[^.\w'"`])localStorage\b/,
  /(^|[^.\w'"`])sessionStorage\b/,
  /(^|[^.\w'"`])navigator\./,
  /(^|[^.\w'"`])confirm\(/,
  /(^|[^.\w'"`])prompt\(/,
  /URL\.createObjectURL/,
];
const DOM_JSX = /<(div|span|p|img|input|button|a|ul|ol|li|table|form|label|select)\b/;
const GUARD = /Platform\.OS|typeof (window|document|navigator|localStorage)|@ts-expect-error|eslint-disable/;

const findings = [];
for (const f of srcFiles) {
  if (/\.web\.(ts|tsx)$/.test(f) || f.endsWith('+html.tsx')) continue; // .ios/.android/.native 는 대상(네이티브 경로)
  const lines = readFileSync(path.join(ROOT, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || GUARD.test(line)) return;
    const hit = WEB_API.some((re) => re.test(line)) || (f.endsWith('.tsx') && DOM_JSX.test(line));
    if (hit) findings.push({ key: `${f}::${t}`, loc: `${f}:${i + 1}`, text: t.slice(0, 100) });
  });
}

let baseline = new Set();
if (existsSync(BASELINE_PATH)) {
  baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries);
}
const fresh = findings.filter((x) => !baseline.has(x.key));
const stale = [...baseline].filter((k) => !findings.some((x) => x.key === k));

if (UPDATE) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ updated: new Date().toISOString().slice(0, 10), entries: findings.map((x) => x.key).sort() }, null, 2) + '\n'
  );
  console.log(`■ baseline 갱신: ${findings.length}건 기록 (신규 ${fresh.length} 편입, 소멸 ${stale.length} 제거)`);
} else {
  console.log(`■ 웹 전용 API 래칫: 기존 ${baseline.size}건 / 현재 ${findings.length}건`);
  if (!existsSync(BASELINE_PATH)) {
    problems.push('baseline 없음 — 첫 실행이면 현재 상태를 사람이 훑은 뒤 --update-baseline 으로 기록하라.');
  }
  for (const x of fresh) {
    problems.push(`새 웹 전용 API 사용: ${x.loc} — ${x.text}\n    → 네이티브에서 undefined/크래시. Platform 가드·.web 분기로 고치거나, 의도한 것이면 --update-baseline.`);
  }
  if (stale.length) warns.push(`baseline에 있으나 사라진 항목 ${stale.length}건 — --update-baseline 으로 청소 권장.`);
}

// ── Q3. Android·iOS 번들 실증 ───────────────────────────────────
if (SKIP_BUNDLE) {
  warns.push('번들 검사 생략(--skip-bundle) — "앱 JS가 뜬다"는 보증 없음. 빌드 전엔 전체 실행 필수.');
} else if (problems.length) {
  console.log('■ Android·iOS 번들: 앞 단계 RED로 생략');
} else {
  for (const platform of ['android', 'ios']) {
    const out = mkdtempSync(path.join(os.tmpdir(), 'st-preflight-'));
    console.log(`■ ${platform} 번들 실증(expo export -p ${platform}, 수 분 소요)…`);
    try {
      execSync(`npx expo export --platform ${platform} --output-dir "${out}"`, { cwd: ROOT, stdio: 'inherit' });
      console.log('  ✅ 번들 생성 성공');
    } catch {
      problems.push(`${platform} 번들 생성 실패 — 위 Metro 로그의 첫 오류가 원인이다. 이 상태로 빌드하면 앱도 같은 지점에서 죽는다.`);
      break;
    } finally {
      // ★Windows Node24 rmSync({recursive}) = 네이티브 크래시(0xC0000409) → 비동기 rm 사용
      await rm(out, { recursive: true, force: true });
    }
  }
}

// ── 판정 ─────────────────────────────────────────────────────────
console.log('\n══ 판정 ══');
for (const w of warns) console.log(`⚠ ${w}`);
if (problems.length) {
  for (const p of problems) console.log(`🔴 ${p}`);
  console.log(`\n❌ preflight RED (${problems.length}건)`);
  process.exit(1);
}
console.log('✅ preflight GREEN — 번들 수준에선 앱과 웹이 같은 코드로 뜬다. 실동작은 실기기에서.');
