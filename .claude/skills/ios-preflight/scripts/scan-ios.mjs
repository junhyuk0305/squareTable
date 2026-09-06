#!/usr/bin/env node
// ios-preflight 자동 스캔 — iOS(아이폰)에서만 조용히 틀리는 지점을 코드에서 검출한다.
// 규칙 근거: .claude/skills/ios-preflight/SKILL.md §핵심 6가지
//
// 사용: node .claude/skills/ios-preflight/scripts/scan-ios.mjs   (SquareTable 루트에서)
// 오탐 억제: 해당 줄(또는 바로 윗줄)에  // ios-preflight: ok <이유>
//
// ⛔native-audit/scripts/scan.mjs 와 규칙이 겹치지 않는다. 웹↔네이티브 일반 갈림길은 그쪽 담당.
// 판정 등급: 🔴 iOS에서 깨짐 확실 · 🟡 결함 가능(사람이 판정) · ℹ️ 확인 권장
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
if (!existsSync(SRC)) {
  console.error('❌ src/ 가 없다. SquareTable 루트에서 실행하라.');
  process.exit(2);
}

const files = [];
for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
  if (!e.isFile() || !/\.(ts|tsx)$/.test(e.name)) continue;
  // .web.* 는 웹 전용이라 대상 아님. .android.* 도 iOS 로 안 나간다.
  if (/\.(web|android)\.(ts|tsx)$/.test(e.name) || e.name === '+html.tsx') continue;
  files.push(path.join(e.parentPath ?? e.path, e.name));
}

const findings = [];
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');
const add = (level, file, line, rule, msg) =>
  findings.push({ level, loc: `${rel(file)}:${line}`, rule, msg });

/** 주석을 공백으로 치환한 사본(줄 수 보존) — 주석 속 설명 문구를 코드로 오인하지 않기 위해. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// ── 규칙 1·3·4는 파일 단위 사전 준비가 필요하다 ───────────────────────────────
// (3) 권한: app.json 에 선언된 목적 문구 ↔ 실제로 쓰는 API 대조.
const APP_JSON = path.join(ROOT, 'app.json');
const appJsonRaw = existsSync(APP_JSON) ? readFileSync(APP_JSON, 'utf8') : '';
/** 각 권한: [사람이 읽는 이름, 코드에서 이 권한을 쓰는 신호, app.json 에 문구가 있다는 신호] */
const PERMISSIONS = [
  ['마이크', /expo-audio|AudioModule|requestRecordingPermissions/, /microphonePermission|NSMicrophoneUsageDescription/],
  ['사진 보관함', /launchImageLibraryAsync|requestMediaLibraryPermissions/, /photosPermission|NSPhotoLibraryUsageDescription/],
  ['카메라', /launchCameraAsync|requestCameraPermissions/, /"cameraPermission":\s*"|NSCameraUsageDescription/],
  ['위치', /expo-location|getCurrentPositionAsync/, /locationWhenInUsePermission|NSLocationWhenInUseUsageDescription/],
  ['연락처', /expo-contacts/, /contactsPermission|NSContactsUsageDescription/],
];
const permUsedIn = new Map(); // 권한이름 → 처음 쓴 위치

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);
  const rawLines = raw.split('\n');
  const sup = (n) =>
    [rawLines[n - 1] ?? '', rawLines[n - 2] ?? ''].some((l) => l.includes('ios-preflight: ok'));
  const report = (level, line, rule, msg) => {
    if (!sup(line)) add(level, f, line, rule, msg);
  };
  const base = path.basename(f);

  // ── 규칙 1: ios-vc-frame 🔴 ────────────────────────────────────────────────
  // useSafeAreaFrame() 값을 창 기준으로 가정하고 키보드 좌표(screenY)와 직접 빼는 곳.
  // iOS 프레임은 화면 VC 뷰 기준이라 헤더 높이만큼 어긋난다(SKILL.md §핵심 1).
  // KeyboardShift 는 보정을 이미 갖고 있는 정본이라 제외.
  if (base !== 'KeyboardShift.tsx' && /useSafeAreaFrame/.test(src) && /endCoordinates|screenY/.test(src)) {
    const m = src.match(/useSafeAreaFrame/);
    report(
      '🔴',
      lineOf(src, m.index),
      'ios-vc-frame',
      'useSafeAreaFrame() 을 키보드 좌표와 직접 계산한다. iOS 프레임은 창이 아니라 화면 VC 뷰 기준이라 ' +
        '네이티브 헤더가 있는 화면에서 헤더 높이만큼 덜 밀린다 → 입력창이 키보드에 가린다. ' +
        '공용 KeyboardShift 를 쓰거나 HeaderHeightContext 만큼 보정하라.',
    );
  }

  // ── 규칙 2: ios-header-inset 🟡 ───────────────────────────────────────────
  // 네이티브 헤더를 끈 화면(headerShown:false)인데 SafeAreaView 가 top 인셋을 안 주고,
  // 고정 좌표로 떠 있는 요소(position:absolute + top:숫자)가 있다 → 상태바·노치 밑으로 파고든다.
  if (/headerShown:\s*false/.test(src)) {
    const floats = /position:\s*'absolute'[^}]*\btop:\s*\d/.test(src) || /\btop:\s*\d+[\s,}][^]*position:\s*'absolute'/.test(src);
    const edgesEmptyOrNoTop = [...src.matchAll(/edges=\{(\[[^\]]*\])\}/g)].filter(
      (m) => !/['"]top['"]/.test(m[1]),
    );
    if (floats && edgesEmptyOrNoTop.length > 0) {
      report(
        '🟡',
        lineOf(src, edgesEmptyOrNoTop[0].index),
        'ios-header-inset',
        '네이티브 헤더를 껐는데 SafeAreaView edges 에 top 이 없고, 고정 좌표로 떠 있는 요소가 있다. ' +
          'iOS 노치·다이나믹 아일랜드 밑으로 파고들어 상단 UI 가 시계와 겹친다. ' +
          "헤더를 끈 뷰에만 edges 에 'top' 을 넣어라(패널 뷰에 넣으면 이중).",
      );
    }
  }

  // ── 규칙 3: ios-shadow 🟡 ─────────────────────────────────────────────────
  // elevation 만 쓰고 shadow* 가 없는 스타일 → iOS 에서 그림자가 아예 없다(크래시 없음·조용히 평평).
  for (const m of src.matchAll(/\belevation:\s*\d/g)) {
    const line = lineOf(src, m.index);
    // 같은 스타일 객체 안(앞뒤 400자)에 iOS 그림자 속성이 있으면 정상.
    const around = src.slice(Math.max(0, m.index - 400), m.index + 400);
    if (/shadowColor|shadowOpacity|shadowRadius|boxShadow/.test(around)) continue;
    report(
      '🟡',
      line,
      'ios-shadow',
      'elevation 만 있고 iOS 그림자 속성(shadowColor/Offset/Opacity/Radius)이 없다. ' +
        'iOS 에서 이 요소는 그림자 없이 평평하게 보인다(경고도 크래시도 없다). ' +
        '공용 Elevation 토큰(src/lib/theme/elevation.ts)을 쓰면 양쪽이 같이 해결된다.',
    );
  }

  // ── 규칙 4: ios-kb-event 🟡 ───────────────────────────────────────────────
  // keyboardDidShow 만 쓰고 iOS 분기(keyboardWillShow)가 없다 → iOS 에서 한 박자 늦게 덜컥인다.
  if (/keyboardDidShow/.test(src) && !/keyboardWillShow/.test(src)) {
    const m = src.match(/keyboardDidShow/);
    report(
      '🟡',
      lineOf(src, m.index),
      'ios-kb-event',
      "keyboardDidShow 만 듣는다. iOS 는 keyboardWillShow(올라오기 전)로 들어야 키보드와 같이 움직인다 — " +
        'Did 만 쓰면 키보드가 다 올라온 뒤에 화면이 덜컥 따라온다. Platform 으로 갈라라.',
    );
  }

  // ── 규칙 5: ios-mixed-run 🟡 ──────────────────────────────────────────────
  // Text 자식 문자열이 {' '} 로 끝난다 = 한글 Text 안에 ASCII 공백을 섞었다.
  // iOS 는 한글(Apple SD Gothic Neo)과 공백(San Francisco)을 다른 폰트로 그려서 그 Text 만
  // 줄 상자가 커지고, 형제 Text 와 기준선이 어긋난다.
  for (const m of src.matchAll(/\{'\s+'\}\s*\n?\s*<\/(Text|Animated\.Text)>/g)) {
    report(
      '🟡',
      lineOf(src, m.index),
      'ios-mixed-run',
      "글자 Text 안에 띄어쓰기({' '})를 넣었다. iOS 는 한글과 공백을 다른 폰트로 그려서 이 Text 만 " +
        '줄 상자가 커지고, 옆 Text 와 기준선이 어긋나 한쪽이 떠 보인다. 간격은 marginRight 로 주고 ' +
        "행에 alignItems:'baseline' 을 걸어라.",
    );
  }

  // ── 규칙 6: ios-scroll-inset ℹ️ ──────────────────────────────────────────
  // iOS 는 네이티브 헤더 아래 ScrollView 에 contentInset 을 자동으로 더한다(기본 'automatic').
  // 우리가 paddingTop 을 또 주면 이중 여백이 된다. 웹·안드로이드에선 안 보인다.
  for (const m of src.matchAll(/contentContainerStyle=\{[^}]*paddingTop/g)) {
    if (/contentInsetAdjustmentBehavior/.test(src)) continue;
    report(
      'ℹ️',
      lineOf(src, m.index),
      'ios-scroll-inset',
      'ScrollView 에 paddingTop 을 직접 주면서 contentInsetAdjustmentBehavior 를 정하지 않았다. ' +
        "iOS 는 헤더 아래 스크롤뷰에 인셋을 자동으로 더하므로(기본 'automatic') 상단 여백이 이중이 될 수 있다. " +
        "직접 계산하는 화면이면 'never' 로 명시하라.",
    );
  }

  // 권한 사용처 수집(규칙 7에서 app.json 과 대조)
  for (const [name, useRe] of PERMISSIONS) {
    if (!permUsedIn.has(name) && useRe.test(src)) permUsedIn.set(name, `${rel(f)}:${lineOf(src, src.search(useRe))}`);
  }
}

// ── 규칙 7: ios-permission 🔴 (파일 순회 후 1회) ─────────────────────────────
// iOS 는 목적 문구 없이 보호 리소스 API 를 부르면 **앱이 즉시 죽는다**(Android 는 안 그런다).
for (const [name, , declRe] of PERMISSIONS) {
  const where = permUsedIn.get(name);
  if (!where) continue;
  if (declRe.test(appJsonRaw)) continue;
  findings.push({
    level: '🔴',
    loc: where,
    rule: 'ios-permission',
    msg: `${name} 권한을 쓰는데 app.json 에 iOS 목적 문구가 없다. iOS 는 문구 없이 이 API 를 부르면 ` +
      `**앱이 그 자리에서 죽는다**(안드로이드는 거부로 끝나서 안 잡힌다). 심사 5.1.1 반려 사유이기도 하다.`,
  });
}

// ── 출력 ──────────────────────────────────────────────────────────────────────
const order = { '🔴': 0, '🟡': 1, 'ℹ️': 2 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.loc.localeCompare(b.loc));

console.log('══ iOS 사전 QA 스캔 (규칙 7종) ══\n');
if (findings.length === 0) {
  console.log('✅ 걸린 것 없음. 다음은 references/checklist-ios.md 와 사용자 터미널 확인(APNs).');
} else {
  let last = null;
  for (const x of findings) {
    if (x.level !== last) {
      console.log(`\n── ${x.level} ${x.level === '🔴' ? 'iOS에서 깨짐' : x.level === '🟡' ? '판정 필요' : '확인 권장'} ──`);
      last = x.level;
    }
    console.log(`  ${x.loc}  [${x.rule}]`);
    console.log(`    ${x.msg}`);
  }
  const n = (lv) => findings.filter((x) => x.level === lv).length;
  console.log(`\n── 합계 ── 🔴 ${n('🔴')} · 🟡 ${n('🟡')} · ℹ️ ${n('ℹ️')}`);
  console.log('오탐이면 그 줄이나 윗줄에  // ios-preflight: ok <이유>  를 달아라.');
}
console.log('\n⛔코드로는 절대 못 보는 것: APNs 키 등록 여부. 사용자 터미널에서 `eas credentials -p ios`.');
// 🔴이 있으면 실패 코드 — 게이트에 물릴 수 있게.
process.exit(findings.some((x) => x.level === '🔴') ? 1 : 0);
