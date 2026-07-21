#!/usr/bin/env node
// 플랫폼 배포 상태 리포트 — 규칙·예외표 SSOT: 00_핵심/플랫폼_배포현황_LIVE.md
//
// 무엇을 답하나:
//   1) 각 플랫폼(웹=main / Android=android-v* 태그 / iOS=ios-v* 태그)이 어느 커밋까지 반영했고
//      그 뒤로 몇 커밋이 밀려 있는지
//   2) 플랫폼 분기 코드(Platform.OS·확장자 분기)가 baseline 대비 새로 생겼는지
//      → 새 분기 = 예외표 등록 대상 후보 경고
//
// 사용법:
//   npm run platform:status                       리포트
//   npm run platform:status -- --update-baseline  예외표 등록·판단 후 baseline 갱신
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'platform-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// ── 1. 배포 포인터 ────────────────────────────────────────────────
function latestTag(prefix) {
  const out = sh(`git tag -l "${prefix}-v*" --sort=-v:refname`);
  return out ? out.split('\n')[0].trim() : null;
}

function reportPlatform(label, pointer, webRef) {
  if (!pointer) {
    console.log(`\n■ ${label}: ❌ 미출시 — 기준 태그 없음`);
    console.log(`  첫 프로덕션 빌드 시: git tag -a ${label.toLowerCase()}-v1.0.0 -m "첫 제출" <빌드커밋>`);
    return;
  }
  const count = sh(`git rev-list --count ${pointer}..${webRef}`);
  const when = sh(`git log -1 --format=%cd --date=format:%Y-%m-%d ${pointer}`);
  if (count === '0') {
    console.log(`\n■ ${label}: ✅ 최신 — ${pointer} (${when}) = ${webRef}`);
    return;
  }
  console.log(`\n■ ${label}: ${pointer} (${when}) 기준, ${webRef}보다 ${count}커밋 뒤`);
  const log = sh(`git log ${pointer}..${webRef} --oneline -15`);
  if (log) console.log(log.split('\n').map((l) => `    ${l}`).join('\n'));
  if (Number(count) > 15) console.log(`    … 외 ${Number(count) - 15}건`);
}

console.log('══ 플랫폼 배포 상태 (SSOT: 00_핵심/플랫폼_배포현황_LIVE.md) ══');

const webRef = sh('git rev-parse --verify -q origin/main') ? 'origin/main' : 'main';
const webHead = sh(`git log -1 --format="%h %cd %s" --date=format:%Y-%m-%d ${webRef}`);
console.log(`\n■ 웹(Vercel): ${webRef} = 배포본`);
console.log(`    ${webHead}`);
if (webRef === 'origin/main') console.log('    (정확도를 높이려면 git fetch 후 실행)');

const branch = sh('git branch --show-current');
if (branch && branch !== 'main') {
  const ahead = sh(`git rev-list --count ${webRef}..HEAD`);
  if (ahead && ahead !== '0') {
    console.log(`\n⚠ 현재 브랜치 ${branch}: main 미머지 ${ahead}커밋 — 이 작업분은 웹에도 아직 안 나갔다.`);
  }
}

reportPlatform('Android', latestTag('android'), webRef);
reportPlatform('iOS', latestTag('ios'), webRef);

// ── 2. 플랫폼 분기 드리프트 ──────────────────────────────────────
function scanDivergence() {
  const platformOS = {};
  const extensionSplit = [];
  const srcDir = path.join(ROOT, 'src');
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const abs = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    if (/\.(web|native|ios|android)\.(ts|tsx|js|jsx)$/.test(entry.name)) extensionSplit.push(rel);
    const hits = (readFileSync(abs, 'utf8').match(/Platform\.(OS|select)/g) || []).length;
    if (hits > 0) platformOS[rel] = hits;
  }
  extensionSplit.sort();
  return { platformOS, extensionSplit };
}

const current = scanDivergence();

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`\n══ 분기 baseline 갱신 완료 → ${path.relative(ROOT, BASELINE_PATH)} ══`);
  process.exit(0);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.log('\n⚠ 분기 baseline 없음 — `npm run platform:status -- --update-baseline` 으로 생성하라.');
  process.exit(0);
}

const warnings = [];
for (const [file, n] of Object.entries(current.platformOS)) {
  const prev = baseline.platformOS[file] ?? 0;
  if (prev === 0) warnings.push(`새 Platform 분기 파일: ${file} (${n}건)`);
  else if (n > prev) warnings.push(`Platform 분기 증가: ${file} (${prev}→${n}건)`);
}
for (const file of current.extensionSplit) {
  if (!baseline.extensionSplit.includes(file)) warnings.push(`새 확장자 분기 파일: ${file}`);
}
const removed = Object.keys(baseline.platformOS).filter((f) => !(f in current.platformOS));

console.log('\n══ 플랫폼 분기 드리프트 ══');
if (warnings.length === 0) {
  console.log('✅ 새 분기 없음 (baseline 일치)');
} else {
  console.log('⚠ 새 분기 감지 — "기능 차이"면 플랫폼_배포현황_LIVE.md §2 예외표에 등록하고,');
  console.log('  등록(또는 미세분기 판단) 후 --update-baseline 으로 확정하라.');
  for (const w of warnings) console.log(`  · ${w}`);
}
if (removed.length > 0) {
  console.log(`ℹ 분기 제거됨(예외표 정리 검토): ${removed.join(', ')}`);
}
