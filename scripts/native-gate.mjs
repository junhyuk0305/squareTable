#!/usr/bin/env node
// 네이티브(Android·iOS) 출고 게이트 — 규칙 SSOT: 00_핵심/플랫폼_배포현황_LIVE.md
//
// 답하는 질문은 두 개뿐이다:
//   Q1. 이번 변경을 앱에 내보내려면 **재빌드가 필요한가, JS만 갈아끼우면 되는가**(OTA).
//       → 네이티브 모듈·app.json 을 건드린 채로 JS만 밀면 앱이 부팅 즉시 죽고,
//         죽었으니 다음 JS 도 못 받는다(사용자 폰에서 영구 사망). 사람 기억에 맡길 판정이 아니다.
//   Q2. 지금 이 커밋을 그대로 내보내도 되는가(타입·린트·iOS 심사 표면).
//
// 왜 "커밋 기준"인가: 2026-08-15, 작업트리에만 있던 파일 덕에 typecheck 가 green 이었고
// origin/main 은 정의 없는 import 로 죽어 있었다. 그래서 이 게이트는 **작업트리가 더러우면
// 먼저 멈춘다** — 더러운 트리에서의 typecheck 결과는 커밋 내용을 전혀 보증하지 않는다.
//
// 사용법:
//   npm run native:gate                  기본(양 플랫폼 공통 + iOS 표면 검사)
//   npm run native:gate -- --platform android
//   npm run native:gate -- --skip-lint   빠른 판정만(타입·린트 생략)
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const PLATFORM = argOf('--platform'); // null = 양쪽
const SKIP_LINT = argv.includes('--skip-lint');

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
function run(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}
function jsonAt(ref, file) {
  const raw = sh(`git show ${ref}:${file}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const problems = []; // 출고 차단
const warns = []; // 사람이 판단할 것

console.log('══ 네이티브 출고 게이트 (SSOT: 00_핵심/플랫폼_배포현황_LIVE.md) ══');

// ── 1. 작업트리 청결 ──────────────────────────────────────────────
// 더러운 트리 = 아래 모든 검사가 "커밋되지 않은 파일 덕에 통과"할 수 있는 상태.
const dirty = sh('git status --porcelain');
if (dirty) {
  const lines = dirty.split('\n').filter(Boolean);
  console.log(`\n■ 작업트리: ❌ 미커밋 ${lines.length}건`);
  console.log(lines.slice(0, 10).map((l) => `    ${l}`).join('\n'));
  if (lines.length > 10) console.log(`    … 외 ${lines.length - 10}건`);
  problems.push(
    '미커밋 변경이 있다. 이 상태의 typecheck·lint 는 커밋 내용을 보증하지 않는다(2026-08-15 사고). 커밋 후 다시 실행하라.',
  );
} else {
  console.log('\n■ 작업트리: ✅ 깨끗함 — 검사 결과 = 커밋 내용');
}

// ── 2. 재빌드 판정 ────────────────────────────────────────────────
// 기준점 = 그 플랫폼의 마지막 프로덕션 빌드 태그. 태그가 곧 배포 포인터다(태그 없으면 첫 빌드).
function latestTag(prefix) {
  const out = sh(`git tag -l "${prefix}-v*" --sort=-v:refname`);
  return out ? out.split('\n')[0].trim() : null;
}

// app.json 중 네이티브 바이너리에 구워지는 키. web·extra 는 재빌드와 무관하다.
const NATIVE_APP_KEYS = ['ios', 'android', 'plugins', 'scheme', 'name', 'icon', 'splash', 'orientation', 'userInterfaceStyle'];

function rebuildReasons(base) {
  const reasons = [];

  // (a) 의존성 — scripts 만 바뀐 package.json 을 재빌드로 오판하지 않도록 deps 만 비교한다.
  const prev = jsonAt(base, 'package.json');
  const now = jsonAt('HEAD', 'package.json');
  if (prev && now) {
    const keys = new Set([...Object.keys(prev.dependencies ?? {}), ...Object.keys(now.dependencies ?? {})]);
    for (const k of keys) {
      const a = prev.dependencies?.[k];
      const b = now.dependencies?.[k];
      if (a === b) continue;
      if (!a) reasons.push(`의존성 추가: ${k}@${b}`);
      else if (!b) reasons.push(`의존성 제거: ${k}`);
      else reasons.push(`의존성 변경: ${k} ${a} → ${b}`);
    }
  }

  // (b) app.json 의 네이티브 축
  const prevApp = jsonAt(base, 'app.json')?.expo;
  const nowApp = jsonAt('HEAD', 'app.json')?.expo;
  if (prevApp && nowApp) {
    for (const k of NATIVE_APP_KEYS) {
      if (JSON.stringify(prevApp[k]) !== JSON.stringify(nowApp[k])) reasons.push(`app.json 변경: expo.${k}`);
    }
  }

  // (c) 앱 아이콘·스플래시 등 빌드 시점에 구워지는 에셋
  const files = (sh(`git diff --name-only ${base}..HEAD`) ?? '').split('\n').filter(Boolean);
  if (files.some((f) => f.startsWith('assets/'))) reasons.push('assets/ 변경 (아이콘·스플래시는 빌드에 구워진다)');

  return { reasons, files };
}

function reportPlatform(label, prefix) {
  const base = latestTag(prefix);
  if (!base) {
    console.log(`\n■ ${label}: ⚪ 미출시 — 기준 태그 없음. 판정 대상 아님(첫 프로덕션 빌드가 필요하다).`);
    return;
  }
  const { reasons, files } = rebuildReasons(base);
  const jsChanged = files.some((f) => f.startsWith('src/'));
  const behind = sh(`git rev-list --count ${base}..HEAD`) ?? '?';

  if (reasons.length > 0) {
    console.log(`\n■ ${label}: 🔴 재빌드 필요 — ${base} 이후 ${behind}커밋`);
    console.log(reasons.map((r) => `    · ${r}`).join('\n'));
    console.log('    → OTA(eas update)로 내보내면 앱이 부팅 즉시 죽는다. eas build 로 가라.');
  } else if (jsChanged) {
    console.log(`\n■ ${label}: 🟢 OTA 가능 — ${base} 이후 ${behind}커밋, JS/TS 변경만`);
    console.log('    → eas update 로 몇 분 만에 나간다. 스토어 심사 불필요.');
  } else {
    console.log(`\n■ ${label}: ✅ 내보낼 변경 없음 — ${base} 이후 앱에 영향 있는 변경이 없다`);
  }
}

if (!PLATFORM || PLATFORM === 'android') reportPlatform('Android', 'android');
if (!PLATFORM || PLATFORM === 'ios') reportPlatform('iOS', 'ios');

// ── 3. iOS 심사 표면 — 결제 CTA 누수 ──────────────────────────────
// 근거·판정 SSOT: src/lib/config/store-policy.ts (App Review 3.1.3(f)).
// iOS 빌드에 결제·요금제 CTA 가 한 군데라도 남아 있으면 앱이 깨지는 게 아니라 **심사에서 거부**된다.
// 정적 검사라 호출처까지는 못 본다 — 그래서 '차단'이 아니라 '사람이 확인할 목록'으로 낸다.
const PAY_TOKENS = ['요금제', '업그레이드', '결제하', '입금', '계좌', 'formatKrw', 'planMonthlyPrice'];
// 면제: 판정 SSOT 자신 · 순수 데이터/계산 · 법률 고지 텍스트(구매 유도가 아니다) · 웹 전용 파일.
const PAY_EXEMPT = [
  'src/lib/config/',
  'src/app/legal/',
  'src/app/terms.tsx',
  'src/app/privacy.tsx',
  'src/app/business-info.tsx',
  '.web.ts',
  '.web.tsx',
];

// 주석·import 를 지운 뒤에만 본다. 이걸 안 하면 "왜 이렇게 막았는지" 설명한 주석까지 위반으로 잡혀
// 경고가 20건씩 나오고, 그 순간 이 검사는 아무도 안 보는 검사가 된다.
function uiText(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    // PlanUpgradeNotice 는 iOS 에서 제목·설명을 자기가 갈아끼운다 — 넘기는 문구는 렌더되지 않는다.
    .filter((l) => !/^\s*(import|export\s+\{)/.test(l) && !l.includes('PlanUpgradeNotice'))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

if (!PLATFORM || PLATFORM === 'ios') {
  // 화면(.tsx)만 본다 — db.ts·store·types 는 렌더되지 않으므로 심사 표면이 아니다.
  const tracked = (sh('git ls-files "src/app/**/*.tsx" "src/components/**/*.tsx"') ?? '')
    .split('\n')
    .filter(Boolean);
  const leaks = [];
  for (const f of tracked) {
    if (PAY_EXEMPT.some((e) => f.includes(e))) continue;
    const body = sh(`git show HEAD:${f}`);
    if (!body) continue;
    if (body.includes('store-policy')) continue; // 게이트를 물고 있다
    const hit = PAY_TOKENS.filter((t) => uiText(body).includes(t));
    if (hit.length > 0) leaks.push(`${f} — ${hit.join(', ')}`);
  }
  console.log('\n■ iOS 결제 표면(3.1.3f):');
  if (leaks.length === 0) {
    console.log('    ✅ store-policy 게이트를 안 거치는 결제·요금제 표면 없음');
  } else {
    console.log(leaks.map((l) => `    ⚠ ${l}`).join('\n'));
    console.log('    → 각각 확인: iOS에서 실제로 렌더되나? 렌더되면 showPaymentSurface 로 막아라.');
    console.log('      (호출처가 이미 막고 있다면 그대로 두되, 호출처가 늘면 조용히 샌다)');
    warns.push(`iOS 결제 표면 확인 대상 ${leaks.length}건`);
  }
}

// ── 4. 타입·린트 ──────────────────────────────────────────────────
if (SKIP_LINT) {
  console.log('\n■ 타입·린트: ⏭ 생략(--skip-lint)');
} else if (dirty) {
  console.log('\n■ 타입·린트: ⏭ 생략 — 작업트리가 더러워 결과가 커밋을 보증하지 못한다');
} else {
  console.log('\n■ 타입체크(tsc --noEmit):');
  if (!run('npm run -s typecheck')) problems.push('typecheck 실패');
  console.log('\n■ 린트(expo lint):');
  if (!run('npm run -s lint')) problems.push('lint 실패');
}

// ── 5. 요약 ───────────────────────────────────────────────────────
console.log('\n══ 판정 ══');
if (problems.length === 0) {
  console.log('✅ 출고 가능');
  if (warns.length > 0) console.log(warns.map((w) => `   (확인 권장) ${w}`).join('\n'));
  console.log('\n다음: 위 플랫폼별 판정에 따라 eas update(OTA) 또는 eas build.');
  console.log('★ 프로덕션 빌드를 돌렸다면 그 커밋에 태그를 박아라 — 태그가 곧 배포 포인터다.');
  console.log('  git tag -a android-v1.0.0 -m "..." <커밋> && git push origin android-v1.0.0');
} else {
  console.log('❌ 출고 불가');
  console.log(problems.map((p) => `   · ${p}`).join('\n'));
  process.exitCode = 1;
}
