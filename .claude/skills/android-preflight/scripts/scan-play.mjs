#!/usr/bin/env node
// android-preflight 출고 게이트 — Play 업로드·트랙 승격 전에 "이 aab 를 올려도 되는가"를 답한다.
// 규칙 근거: .claude/skills/android-preflight/references/play-gates.md · SKILL.md §핵심 7·8
//
// 사용: node .claude/skills/android-preflight/scripts/scan-play.mjs [--introspect]   (SquareTable 루트에서)
//   --introspect  `expo config --type introspect` 로 최종 매니페스트를 뽑아 권한·방향·뒤로가기를 대조한다(1~2분).
//                 ⛔빼면 §핵심 7(권한 대조)을 못 한다 — 업로드 전에는 반드시 켠다.
//
// ★introspect 가 주는 권한은 **앱 모듈 매니페스트**(Expo 베어 템플릿 + config 플러그인)다.
//   라이브러리 권한(POST_NOTIFICATIONS 등)은 병합 전이라 안 보인다 — 없는 게 아니라 안 보이는 것이다.
//   최종 정본은 **Play 콘솔 → 앱 번들 탐색기 → 권한**. 맨 아래 🔑 목록으로 안내한다.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const INTROSPECT = process.argv.includes('--introspect');
const findings = [];
const add = (level, rule, loc, msg) => findings.push({ level, rule, loc, msg });
const keys = []; // 🔑 코드로는 못 보는 것

const easJson = JSON.parse(readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
const pkgJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const prodAndroid = easJson.build?.production?.android ?? {};

// ══════════════════════════════════════════════════════════════════
// 1. play-signing — 업로드 키 (★메모리: project_squaretable_android_upload_key_2026-09-03)
// ══════════════════════════════════════════════════════════════════
// Play 는 **최초 업로드에 쓴 키**로만 이후 업데이트를 받는다. EAS 가 새로 만든 키로 서명하면
// 빌드는 성공하고 **업로드에서 거부**된다. credentialsSource:"local" 이 그 장치다.
if (prodAndroid.credentialsSource !== 'local') {
  add(2, 'play-signing', 'eas.json',
    'production.android.credentialsSource 가 "local" 이 아니다 — EAS 가 제 키로 서명해 Play 가 ' +
    '업로드를 거부한다(업로드 키는 바꿀 수 없다). 반드시 로컬 키스토어로 서명한다');
}
const credPath = path.join(ROOT, 'credentials.json');
if (!existsSync(credPath)) {
  add(2, 'play-signing', 'credentials.json',
    'credentials.json 이 없다 — credentialsSource:"local" 인데 키스토어 위치를 모르면 빌드가 서명 단계에서 멈춘다');
} else {
  const cred = JSON.parse(readFileSync(credPath, 'utf8'));
  const ks = cred.android?.keystore?.keystorePath;
  if (!ks) {
    add(2, 'play-signing', 'credentials.json', 'android.keystore.keystorePath 가 없다');
  } else if (!existsSync(path.resolve(ROOT, ks))) {
    add(2, 'play-signing', 'credentials.json',
      `키스토어 파일이 실제로 없다(${ks}) — 이 경로는 저장소 밖이라 다른 PC·클론에는 따라오지 않는다. ` +
      '백업본에서 복구한다(⛔새 키를 만들면 영영 업로드 못 한다)');
  }
  // 비밀번호가 평문으로 들어 있는 파일이다 — 저장소에 들어가면 서명 키가 통째로 새는 것과 같다.
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', 'credentials.json'], { cwd: ROOT });
    ignored = true;
  } catch { /* 종료코드 1 = 무시 대상 아님 */ }
  if (!ignored) {
    add(2, 'play-signing', '.gitignore',
      'credentials.json 이 gitignore 대상이 아니다 — 키스토어 비밀번호가 평문으로 들어 있어 ' +
      '커밋되는 순간 서명 키가 공개된다');
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. play-version — versionCode 는 한 번 쓰면 재사용할 수 없다
// ══════════════════════════════════════════════════════════════════
if (easJson.cli?.appVersionSource !== 'remote') {
  add(1, 'play-version', 'eas.json',
    'cli.appVersionSource 가 "remote" 가 아니다 — versionCode 를 사람이 올려야 하고, ' +
    '한 번 올린 번호는 재사용할 수 없어 업로드가 거부된다');
} else if (easJson.build?.production?.autoIncrement !== true) {
  add(1, 'play-version', 'eas.json',
    'production.autoIncrement 가 켜져 있지 않다 — 같은 versionCode 로 두 번 빌드하면 두 번째가 업로드에서 막힌다');
}

// ══════════════════════════════════════════════════════════════════
// 3. play-16kb — 16KB 페이지 크기 (2025-11-01 이후 Play 필수)
// ══════════════════════════════════════════════════════════════════
// RN 엔진은 0.77+ 에서 충족한다. 변수는 **네이티브 코드를 가진 서드파티 모듈**이다 —
// 옛 NDK(r27 이하)로 빌드된 .so 가 하나라도 있으면 Play 가 업로드를 거부한다.
const rnVer = (pkgJson.dependencies?.['react-native'] ?? '').replace(/[^\d.]/g, '');
const [rnMajor, rnMinor] = rnVer.split('.').map(Number);
if (rnVer && rnMajor === 0 && rnMinor < 77) {
  add(2, 'play-16kb', 'package.json',
    `react-native ${rnVer} 은 16KB 페이지 크기를 지원하지 않는다(0.77+ 필요) — Play 가 업로드를 거부한다`);
}
// 네이티브 코드를 가진 서드파티 = android/ 디렉터리를 들고 오는 패키지.
const nativeMods = Object.keys(pkgJson.dependencies ?? {}).filter(
  (d) => !d.startsWith('expo') && !d.startsWith('@expo/') && d !== 'react-native' &&
    existsSync(path.join(ROOT, 'node_modules', d, 'android')),
);
if (nativeMods.length) {
  add(0, 'play-16kb', 'node_modules',
    `네이티브 코드를 가진 서드파티 ${nativeMods.length}개 — 16KB 정렬은 각 모듈이 책임진다. ` +
    `업로드가 16KB 로 거부되면 여기부터 의심한다: ${nativeMods.join(', ')}`);
}

// ══════════════════════════════════════════════════════════════════
// 4~7. 최종 매니페스트 대조 (--introspect 필요)
// ══════════════════════════════════════════════════════════════════
if (!INTROSPECT) {
  add(1, 'play-introspect', '(생략)',
    '--introspect 없이 실행됐다 — 최종 매니페스트를 안 뽑았으므로 권한·방향·뒤로가기 대조를 ' +
    '하지 못했다. Play 업로드 전에는 --introspect 로 다시 돌린다');
} else {
  process.stderr.write('최종 매니페스트를 뽑는 중(1~2분)…\n');
  let config;
  try {
    config = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }));
  } catch (e) {
    add(2, 'play-introspect', 'expo config',
      `introspect 실패 — 최종 매니페스트를 못 읽었다: ${String(e.message).split('\n')[0]}`);
  }
  const manifest = config?._internal?.modResults?.android?.manifest?.manifest;
  if (config && !manifest) {
    add(2, 'play-introspect', 'expo config', 'introspect 결과에 안드로이드 매니페스트가 없다(구조 변경 의심)');
  }
  if (manifest) {
    const perms = (manifest['uses-permission'] ?? []).map((p) => p.$['android:name']);
    const removed = new Set((manifest['uses-permission'] ?? [])
      .filter((p) => p.$['tools:node'] === 'remove').map((p) => p.$['android:name']));

    // ★여기 남아 있는 권한은 **우리 앱이 직접 선언하는 것**이고, 릴리스 aab 에 그대로 들어간다.
    // ⛔"디버그 전용이라 안 들어갈 것"이라는 추측으로 거르지 않는다 — 2026-09-18 에 그렇게 걸렀다가
    //   진짜 올라가는 권한(SYSTEM_ALERT_WINDOW)을 가릴 뻔했다. 같은 이름이 RN 의 디버그 소스셋에도
    //   있었을 뿐이고, 이 목록의 실제 출처는 Expo 베어 템플릿(src/main)이었다.
    //   **가리는 쪽보다 시끄러운 쪽이 안전하다.**
    const live = perms.filter((p) => !removed.has(p));

    // ── 4. play-permission — 선언한 권한표와 실제가 맞는가 ──────────
    // 권한 SSOT: 출시서류_안드로이드/12_Play_추가선언_권한문구_*.md §2 (Play 콘솔에 우리가 답한 내용)
    const docsDir = path.join(ROOT, '..', '출시서류_안드로이드');
    const docFile = existsSync(docsDir)
      ? readdirSync(docsDir).find((f) => /Play_추가선언_권한문구/.test(f))
      : null;
    if (!docFile) {
      add(1, 'play-permission', '출시서류_안드로이드/',
        '권한 신고 문서(12_Play_추가선언_권한문구_*.md)를 못 찾았다 — 실제 권한과 신고 내용을 대조할 수 없다');
    } else {
      const doc = readFileSync(path.join(docsDir, docFile), 'utf8');
      const declared = new Set([...doc.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)].map((m) => m[1]));
      const undeclared = live.map((p) => p.replace(/^android\.permission\./, ''))
        .filter((p) => !declared.has(p));
      if (undeclared.length) {
        add(1, 'play-permission', docFile,
          `앱이 직접 선언하는데 권한 신고 문서에 없는 권한: ${undeclared.join(', ')} — ` +
          'Play 콘솔 답안과 실제가 다르면 심사 질의·정책 위반이 된다. ' +
          '쓰지 않는 권한이면 app.json 의 android.blockedPermissions 로 제거한다');
      }
    }

    // ── 5. play-orientation — 세로 고정이 큰 화면에서 무시된다 (SKILL.md §핵심 1-b) ──
    const activity = (manifest.application?.[0]?.activity ?? [])
      .find((a) => /MainActivity/.test(a.$?.['android:name'] ?? ''));
    if (activity?.$?.['android:screenOrientation']) {
      add(1, 'play-orientation', 'AndroidManifest(최종)',
        `screenOrientation="${activity.$['android:screenOrientation']}" — API 36 부터 최소 너비 600dp ` +
        '이상 화면(폴더블 펼침·태블릿·데스크톱 모드)에서는 이 값이 무시된다(선언을 지울 필요는 없다 — ' +
        '600dp 미만 기기에선 여전히 유효하다). 폭이 늘어나는 것 자체는 ResponsiveShell 의 460px 캡이 ' +
        '막지만, 가로에서 헤더·탭바가 어색하지 않은지는 **눈으로만** 확인된다 — 폴더블을 펴 보고 올린다');
    }

    // ── 6. play-back-callback — 뒤로가기 방벽이 최종 산출물에도 남아 있는가 (SKILL.md §핵심 1-c) ──
    const back = manifest.application?.[0]?.$?.['android:enableOnBackInvokedCallback'];
    if (back !== 'false') {
      add(2, 'play-back-callback', 'AndroidManifest(최종)',
        `enableOnBackInvokedCallback=${back ?? '(없음)'} — predictive back 이 켜진 상태로 나간다. ` +
        'react-native-screens 가 아직 미지원이라 뒤로가기가 화면 스택을 못 타고 앱이 그냥 종료된다');
    }

    // ── 7. play-backup — 세션이 구글 백업으로 나가는가 ──
    const backup = manifest.application?.[0]?.$?.['android:allowBackup'];
    if (backup !== 'false') {
      add(1, 'play-backup', 'AndroidManifest(최종)',
        `allowBackup=${backup ?? '(없음 — 기본 true)'} — AsyncStorage(세션 토큰 포함)가 구글 Auto Backup ` +
        '으로 나간다. 기기를 바꾸면 만료된 세션이 되살아난다. app.json 에 "allowBackup": false');
    }

    const short = (p) => p.replace(/^android\.permission\./, '');
    console.log(`\n■ 앱이 직접 선언하는 권한 ${live.length}개: ${live.map(short).join(', ')}`);
    if (removed.size) console.log(`  (제거됨: ${[...removed].map(short).join(', ')})`);
    console.log('  ※ 라이브러리가 병합하는 권한(POST_NOTIFICATIONS 등)은 여기 안 보인다 — 정본은 앱 번들 탐색기.');
  }
}

// ══════════════════════════════════════════════════════════════════
// 🔑 코드로는 볼 수 없는 것 — 사용자 터미널·Play 콘솔에서만
// ══════════════════════════════════════════════════════════════════
keys.push('`eas credentials -p android` → Push Notifications 에 **FCM V1 서비스 계정 키**가 있는가. ' +
  '없으면 토큰 발급·저장은 전부 성공하는데 알림만 한 건도 도착하지 않는다(코드로는 절대 안 보인다)');
keys.push('`eas credentials -p android` → Keystore 가 **로컬 업로드 키**인가(EAS 생성 키가 아닌가)');
keys.push('Play 콘솔 → 앱 번들 탐색기 → 권한 — **실제 aab 의 권한 정본**. ' +
  '위 "앱이 직접 선언하는 권한" + 라이브러리 병합분이 거기 다 보인다');
keys.push('Play 콘솔 → 데이터 안전 양식이 최신 권한·수집 항목과 맞는가 (출시서류_안드로이드/03·12번 문서)');
keys.push('Play 콘솔 → 대시보드에 target API 경고가 떠 있지 않은가');

// ── 출력 ──
const order = [2, 1, 0];
const label = { 2: '🔴 이대로 올리면 막힌다', 1: '🟡 판정 필요', 0: 'ℹ️ 확인 권장' };
let total = 0;
for (const lv of order) {
  const hit = findings.filter((x) => x.level === lv);
  if (!hit.length) continue;
  console.log(`\n${label[lv]} — ${hit.length}건`);
  for (const x of hit) console.log(`  ${x.loc}  [${x.rule}] ${x.msg}`);
  total += hit.length;
}
console.log(`\n🔑 코드로는 못 보는 것 — ${keys.length}건 (사용자 터미널·Play 콘솔)`);
for (const k of keys) console.log(`  · ${k}`);
console.log(`\n══ android-preflight 출고 게이트: ${total}건 검출 (🔴 ${findings.filter((x) => x.level === 2).length})${INTROSPECT ? '' : ' · ⚠️--introspect 생략됨'} ══`);
process.exit(findings.some((x) => x.level === 2) ? 1 : 0);
