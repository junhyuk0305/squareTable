#!/usr/bin/env node
// native-audit 자동 스캔 — 웹(RN-web)에선 안 보이고 안드로이드/iOS에서만 드러나는 갈림길을
// 코드에서 사전 검출한다. 규칙 근거: .claude/skills/native-audit/references/checklist.md
//
// 사용: node .claude/skills/native-audit/scripts/scan.mjs   (SquareTable 루트에서)
// 오탐 억제: 해당 줄(또는 바로 윗줄)에  // native-audit: ok <이유>
//
// 판정 등급: 🔴 기기에서 깨짐 확실 · 🟡 결함 가능(사람이 판정) · ℹ️ 확인 권장
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// ── 파일 수집 (.web.* 와 +html.tsx 는 웹 전용이라 대상 아님) ──
const files = [];
for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
  if (!e.isFile() || !/\.(ts|tsx)$/.test(e.name)) continue;
  if (/\.web\.(ts|tsx)$/.test(e.name) || e.name === '+html.tsx') continue;
  files.push(path.join(e.parentPath ?? e.path, e.name));
}

const findings = []; // { level, loc, rule, msg }
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');

/** 주석을 공백으로 치환한 사본 — 주석 속 "<Modal>" 같은 설명 문구를 태그로 오인하지 않기 위해.
 *  줄 수가 변하지 않게 개행은 보존한다. (문자열 안 "//" 는 드물고 오탐 방향이 안전해 무시) */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 소스에서 <Component ...> 여는 태그들을 찾아 [시작줄, 태그 전문]으로 돌려준다.
 *  중괄호 깊이를 세어 props 안 화살표함수의 '>' 에서 끊기지 않게 한다.
 *  직전 문자가 식별자면 제네릭(useRef<ScrollView>)이지 JSX가 아니므로 건너뛴다. */
function openingTags(src, name) {
  const out = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  let m;
  while ((m = re.exec(src))) {
    if (m.index > 0 && /[A-Za-z0-9_$]/.test(src[m.index - 1])) continue;
    let i = m.index, depth = 0, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, tag: src.slice(m.index, i + 1) });
  }
  return out;
}

/** 억제: 그 줄 또는 바로 윗줄(원문 기준)에 `native-audit: ok` — 판정 근거를 코드에 남기게 한다. */
function makeSuppressed(rawLines) {
  return (lineNo) =>
    [rawLines[lineNo - 1] ?? '', rawLines[lineNo - 2] ?? ''].some((l) => l.includes('native-audit: ok'));
}

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);
  // 억제 주석(native-audit: ok)은 원문에서 찾는다 — stripComments 가 지워버리기 때문.
  const rawLines = raw.split('\n');
  const lines = src.split('\n');
  const sup = makeSuppressed(rawLines);
  const loc = (n) => `${rel(f)}:${n}`;

  // ── 🔴 Modal에 onRequestClose 없음 — Android 뒤로가기(버튼·제스처)가 모달을 못 닫는다 ──
  for (const t of openingTags(src, 'Modal')) {
    if (!t.tag.includes('onRequestClose') && !sup(t.line)) {
      findings.push({ level: 2, loc: loc(t.line), rule: 'modal-back',
        msg: 'Modal에 onRequestClose 없음 — Android 뒤로가기로 모달이 안 닫히고 화면이 갇힌다' });
    }
  }

  // ── 🔴 KAV behavior 미지정/'height' — edge-to-edge에서 입력창이 키보드에 덮인다 ──
  // ── 🔴 KAV 직접 사용 — 공용 KeyboardShift 로만 (2026-09-03): RN KAV 는 상자를 부모 기준으로 재고 키보드는 창 기준이라
  //      네이티브 헤더 아래에선 헤더 높이만큼 덜 올라간다. KeyboardShift 가 창 기준 오프셋을 재서 보정한다. ──
  const isKeyboardShift = /[\\/]components[\\/]KeyboardShift\.tsx$/.test(f);
  for (const t of openingTags(src, 'KeyboardAvoidingView')) {
    if (sup(t.line)) continue;
    if (!isKeyboardShift) {
      findings.push({ level: 2, loc: loc(t.line), rule: 'kav-shared',
        msg: 'KeyboardAvoidingView 직접 사용 — 헤더 아래 화면에서 헤더 높이만큼 입력창이 키보드에 가려진다 → 공용 <KeyboardShift>' });
      continue;
    }
    if (!t.tag.includes('behavior')) {
      findings.push({ level: 2, loc: loc(t.line), rule: 'kav-behavior',
        msg: 'KAV behavior 미지정 — Android에서 입력창이 키보드에 덮인다 → behavior="padding"' });
    } else if (/behavior=(\{[^}]*)?["']height["']/.test(t.tag) || /['"]height['"]/.test(t.tag)) {
      findings.push({ level: 2, loc: loc(t.line), rule: 'kav-behavior',
        msg: "KAV behavior 'height' — edge-to-edge에서 복원이 어긋난다 → behavior=\"padding\"" });
    }
  }

  // ── 줄 단위 규칙 ──
  const hasTabBar = /<(RoleTabBar|HubTabBar)\b/.test(src);
  const hasModal = /<Modal\b/.test(src);
  const hasTextInput = /<TextInput\b/.test(src);
  lines.forEach((line, i0) => {
    const n = i0 + 1;
    const t = line.trim();
    if (!t || sup(n)) return;

    // 🔴 position:'fixed' — 네이티브에 없는 값
    if (/position:\s*['"]fixed['"]/.test(line))
      findings.push({ level: 2, loc: loc(n), rule: 'fixed',
        msg: "position:'fixed'는 네이티브에 없다 — absolute + inset으로" });

    // 🔴 브라우저 alert( — 네이티브에서 크래시/무동작 (Alert.alert는 통과)
    if (/(^|[^.\w])alert\(/.test(line))
      findings.push({ level: 2, loc: loc(n), rule: 'web-alert',
        msg: '브라우저 alert() — 네이티브 미존재. Alert.alert 또는 공용 다이얼로그로' });

    // 🟡 탭바 있는 화면의 SafeAreaView bottom edge — 이중 inset (탭바가 이미 갖는다)
    if (hasTabBar && /edges=\{[^}]*['"]bottom['"]/.test(line))
      findings.push({ level: 1, loc: loc(n), rule: 'double-inset',
        msg: "탭바 화면에서 SafeAreaView 'bottom' — 탭바 insets.bottom과 이중 → 탭바 높이가 화면마다 달라진다" });

    // 🟡 마우스 전용 이벤트 — 앱에서 무동작
    if (/onWheel|onMouseEnter|onMouseLeave/.test(line))
      findings.push({ level: 1, loc: loc(n), rule: 'mouse-only',
        msg: '마우스 전용 이벤트 — 앱에선 무동작. 같은 기능의 터치 경로가 있는지 확인' });

    // ℹ️ Modal 안 autoFocus — Android에서 키보드가 안 올라오는 기종 있음
    if (hasModal && /autoFocus/.test(line))
      findings.push({ level: 0, loc: loc(n), rule: 'modal-autofocus',
        msg: 'Modal 안 autoFocus — Android 일부 기종에서 키보드 안 뜸. 기기에서 확인' });

    // ℹ️ overflow visible — Android View는 자식을 클리핑한다
    if (/overflow:\s*['"]visible['"]/.test(line))
      findings.push({ level: 0, loc: loc(n), rule: 'overflow',
        msg: "Android는 overflow:'visible'이 안 먹는다 — 밖으로 그린 배지/툴팁이 잘리는지 확인" });
  });

  // 🟡 호버 전용 정보 — 같은 태그에 터치 대체(onLongPress) 없음
  for (const t of openingTags(src, '(?:Pressable|[A-Z]\\w+)')) {
    if (t.tag.includes('onHoverIn') && !t.tag.includes('onLongPress') && !sup(t.line))
      findings.push({ level: 1, loc: loc(t.line), rule: 'hover-only',
        msg: 'onHoverIn만 있음 — 앱에선 이 정보에 닿을 길이 없다. onLongPress 병행' });
  }

  // 🟡 TextInput 있는 화면의 세로 ScrollView에 keyboardShouldPersistTaps 없음
  if (hasTextInput) {
    for (const t of openingTags(src, 'ScrollView')) {
      if (t.tag.includes('horizontal') || t.tag.includes('keyboardShouldPersistTaps') || sup(t.line)) continue;
      findings.push({ level: 1, loc: loc(t.line), rule: 'persist-taps',
        msg: '입력 화면의 ScrollView에 keyboardShouldPersistTaps 없음 — 키보드 연 채 버튼이 첫 탭에 안 눌린다' });
    }
  }

  // ── 🟡 Appear/Collapse 밖에서 opacity를 Animated 값으로 움직임 (2026-09-03 실기기) ──
  //    Android는 요소마다 알파를 따로 곱해 자식의 elevation 그림자가 알파를 안 따라간다 → 페이드 중 검은 사각 테두리.
  //    공용 Appear 는 needsOffscreenAlphaCompositing + 상자 넓히기로 처리돼 있다. 자체 페이드는 그 처리가 없다.
  //    같은 파일이 Elevation/elevation 을 쓰면 🟡, 아니면(자식이 props 로 올 수 있으니) ℹ️.
  if (!/[\\/]components[\\/](Appear|Collapse)\.tsx$/.test(f) && /Animated\.(Value|timing|spring)/.test(src)
      && !src.includes('needsOffscreenAlphaCompositing')) {
    const elevated = /\bElevation\.|\belevation:/.test(src);
    lines.forEach((line, i0) => {
      const n = i0 + 1;
      if (sup(n) || line.includes('?')) return; // 삼항(pressed ? .6 : 1)은 정적 값
      if (/\bopacity:\s*[A-Za-z_$][\w$.]*(\.interpolate\(|\s*[,}])/.test(line) && !/opacity:\s*(true|false|undefined|null)\b/.test(line))
        findings.push({ level: elevated ? 1 : 0, loc: loc(n), rule: 'fade-elevation',
          msg: (elevated ? '자체 opacity 페이드 + 같은 파일에 elevation' : '자체 opacity 페이드(자식에 elevation 카드가 오면)')
            + ' — Android에서 그림자가 알파를 안 따라가 검게 먼저 뜬다. 공용 Appear 로 바꾸거나 재생 중 needsOffscreenAlphaCompositing(+상자 넓히기)' });
    });
  }
}

// ── 🟡 replace/Redirect 로 도달하는 화면의 Stack.Screen 에 animation:'none' 없음 (2026-09-02·03 실기기) ──
//    웹은 Stack 전환 애니가 no-op 라 안 보이지만, 네이티브에선 replace 도 슬라이드를 탄다.
//    탭 전환·매장 진입처럼 "이동이 아니라 교체"인 곳은 전부 none 이어야 한다.
//    등급: 탭바 경로·Redirect(항상 '교체')=🟡 · 흐름 완료 후 replace(슬라이드가 자연스러울 수도)=ℹ️.
{
  const targets = new Map(); // target → { level, how }
  const add = (t, level, how) => { if (!targets.has(t) || targets.get(t).level < level) targets.set(t, { level, how }); };
  const all = files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]);
  for (const [f, src] of all) {
    for (const m of src.matchAll(/\breplace\(\s*['"](\/[\w\-/]+)['"]/g)) add(m[1], 0, 'replace');
    for (const m of src.matchAll(/<Redirect\s+href=['"](\/[\w\-/]+)['"]/g)) add(m[1], 1, 'Redirect');
    if (/(RoleTabBar|HubTabBar)\.tsx$/.test(f))
      for (const m of src.matchAll(/\bpath:\s*['"](\/[\w\-/]+)['"]/g)) add(m[1], 1, '탭바 경로');
  }
  const layoutOf = (dir) => all.find(([f]) => rel(f) === `src/app/${dir ? dir + '/' : ''}_layout.tsx`);
  const screenTag = (layoutSrc, name) => openingTags(layoutSrc, 'Stack\\.Screen').find((t) => new RegExp(`name=["']${name}["']`).test(t.tag));
  const seen = new Set();
  for (const [target, { level, how }] of targets) {
    if (target === '/') continue;
    const [first, second] = target.slice(1).split('/');
    // 루트 Stack 의 그 그룹/화면 + 그룹 안 Stack 의 그 화면, 둘 다 본다.
    const checks = [[layoutOf(''), first]];
    if (second && layoutOf(first)) checks.push([layoutOf(first), second]);
    for (const [layout, name] of checks) {
      if (!layout) continue;
      const [lf, lsrc] = layout;
      const tag = screenTag(lsrc, name);
      if (!tag) continue; // 동적 세그먼트·미등록은 판정 불가
      const key = `${rel(lf)}:${tag.line}`;
      if (seen.has(key) || /animation:\s*['"]none['"]/.test(tag.tag)) continue;
      const rawLines = readFileSync(lf, 'utf8').split('\n');
      if (makeSuppressed(rawLines)(tag.line)) continue;
      seen.add(key);
      findings.push({ level, loc: `${rel(lf)}:${tag.line}`, rule: 'replace-slide',
        msg: `'${name}' 은 ${how}(${target})로 도달하는데 animation:'none' 이 없다 — 네이티브에선 replace 도 옆으로 밀린다. 슬라이드가 맞는 자리면 ok 주석` });
    }
  }
}

// ── 출력 ──
const order = [2, 1, 0];
const label = { 2: '🔴 기기에서 깨짐', 1: '🟡 판정 필요', 0: 'ℹ️ 확인 권장' };
let total = 0;
for (const lv of order) {
  const hit = findings.filter((x) => x.level === lv);
  if (!hit.length) continue;
  console.log(`\n${label[lv]} — ${hit.length}건`);
  for (const x of hit) console.log(`  ${x.loc}  [${x.rule}] ${x.msg}`);
  total += hit.length;
}
console.log(`\n══ native-audit: 파일 ${files.length}개 스캔, ${total}건 검출 (🔴 ${findings.filter((x) => x.level === 2).length}) ══`);
console.log('오탐이면 그 줄에 `// native-audit: ok <이유>` — 다음 스캔부터 제외된다.');
process.exit(findings.some((x) => x.level === 2) ? 1 : 0);
