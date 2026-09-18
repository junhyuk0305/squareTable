#!/usr/bin/env node
// android-preflight 자동 스캔 — 안드로이드 OS 계약·기기 다양성·FCM 배달 축에서
// "안 깨지고 다르게 되는" 지점을 코드·설정에서 사전 검출한다.
// 규칙 근거: .claude/skills/android-preflight/SKILL.md §핵심 1~7
//
// 사용: node .claude/skills/android-preflight/scripts/scan-android.mjs   (SquareTable 루트에서)
// 오탐 억제: 해당 줄(또는 바로 윗줄)에  // android-preflight: ok <이유>
//
// 판정 등급: 🔴 기기에서 깨짐 확실 · 🟡 결함 가능(사람이 판정) · ℹ️ 확인 권장
//
// ⛔여기서 보지 않는 것(중복 금지): 웹↔네이티브 일반·HWUI 층 → native-audit
//   iOS 축 → ios-preflight · 출고/Play → scan-play.mjs · 번들·재빌드 → npm run native:*
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// ── 파일 수집 (.web.* 와 .ios.* 와 +html.tsx 는 안드로이드 경로가 아니다) ──
const files = [];
for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
  if (!e.isFile() || !/\.(ts|tsx)$/.test(e.name)) continue;
  if (/\.(web|ios)\.(ts|tsx)$/.test(e.name) || e.name === '+html.tsx') continue;
  files.push(path.join(e.parentPath ?? e.path, e.name));
}

const findings = []; // { level, loc, rule, msg }
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');

/** 주석을 공백으로 치환한 사본 — 주석 속 설명 문구를 코드로 오인하지 않기 위해.
 *  줄 수가 변하지 않게 개행은 보존한다. (native-audit/scan.mjs 와 같은 규약) */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 억제: 그 줄 또는 바로 윗줄(원문 기준)에 `android-preflight: ok` — 판정 근거를 코드에 남기게 한다. */
function makeSuppressed(rawLines) {
  return (lineNo) =>
    [rawLines[lineNo - 1] ?? '', rawLines[lineNo - 2] ?? ''].some((l) =>
      l.includes('android-preflight: ok'),
    );
}

/** `이름: { ... }` 꼴 스타일 객체를 [시작줄, 이름, 본문]으로 돌려준다.
 *  중괄호 깊이를 세어 중첩 객체에서 안 끊기게 한다. 스타일 시트 밖의 객체도 잡히지만,
 *  두 규칙 모두 style 전용 키(height+fontSize / elevation)를 함께 요구하므로 오탐이 낮다. */
function objectLiterals(src) {
  const out = [];
  const re = /([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1, depth = 0, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      name: m[1],
      body: src.slice(re.lastIndex, i),
    });
  }
  return out;
}

/** JSX 의 style={...} 표현식들. 어떤 styles.X 를 참조하는지, 그 자리에서 backgroundColor 를
 *  인라인으로 덧붙이는지를 같이 본다 — 스타일시트만 보면 `[styles.knob, {backgroundColor}]` 같은
 *  합성을 놓쳐 오탐이 난다. */
function styleAttrs(src) {
  const out = [];
  const re = /\bstyle=\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1, depth = 0, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(re.lastIndex, i);
    out.push({
      at: m.index,
      line: src.slice(0, m.index).split('\n').length,
      body,
      names: [...body.matchAll(/styles\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]),
      hasBg: /backgroundColor/.test(body),
    });
  }
  return out;
}

/** style= 가 붙은 JSX 요소의 서브트리 텍스트. 같은 태그의 중첩을 세어 닫는 지점을 찾는다.
 *  self-closing 이면 빈 문자열(자식이 없다). 판정 못 하면 null. */
function subtreeOf(src, at) {
  const head = src.lastIndexOf('<', at);
  if (head < 0) return null;
  const nm = /^<([A-Za-z][\w.]*)/.exec(src.slice(head, at));
  if (!nm) return null;
  const tag = nm[1];
  let i = head, depth = 0, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') inStr = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) break;
  }
  if (src[i - 1] === '/') return ''; // self-closing — 자식 없음
  // 같은 이름의 중첩만 센다. ★self-closing(<View ... />)은 닫는 태그가 없으므로 세면 안 된다 —
  // 이걸 빼먹으면 서브트리가 실제보다 넓게 잡혀, 자식에 없는 <Text> 를 있다고 오판한다.
  const esc = tag.replace('.', '\\.');
  const open = new RegExp(`<${esc}(?=[\\s/>])[^>]*?(/?)>`, 'g');
  const close = new RegExp(`</${esc}>`, 'g');
  let level = 1, cursor = i + 1;
  while (level > 0) {
    close.lastIndex = cursor; const c = close.exec(src);
    if (!c) return null;
    open.lastIndex = cursor; let o, nested = 0;
    while ((o = open.exec(src)) && o.index < c.index) if (o[1] !== '/') nested++;
    level += nested - 1;
    cursor = c.index + c[0].length;
    if (level === 0) return src.slice(i + 1, c.index);
  }
  return null;
}

/** <Component ...> 여는 태그 (native-audit/scan.mjs 와 같은 구현) */
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
    out.push({ line: src.slice(0, m.index).split('\n').length, tag: src.slice(m.index, i + 1) });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// A. 설정 축 — 파일 하나가 전 앱을 좌우하는 것들 (SKILL.md §핵심 1·5·7)
// ══════════════════════════════════════════════════════════════════
const appJson = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo ?? {};
const androidCfg = appJson.android ?? {};
const pkgJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = { ...pkgJson.dependencies };
const cfg = (rule, level, msg) => findings.push({ level, loc: 'app.json', rule, msg });

// ── 🔴 and-back-gate — 뒤로가기를 지탱하는 한 줄 (SKILL.md §핵심 1-c) ──
// API 36 은 predictive back 을 기본으로 켠다. 켜지면 onBackPressed 가 안 불리고 KEYCODE_BACK 이
// 디스패치되지 않는다 → RN 의 BackHandler 와 Modal 의 onRequestClose 가 **조용히** 죽는다.
// 우리 코드엔 BackHandler 가 0건이라 하드웨어 뒤로가기는 전적으로 내비 + onRequestClose 가 받는다.
if (androidCfg.predictiveBackGestureEnabled !== false) {
  cfg('and-back-gate', 2,
    'android.predictiveBackGestureEnabled 가 false 가 아니다 — API 36 에서 predictive back 이 켜지면 ' +
    'Modal 의 onRequestClose 와 BackHandler 가 호출되지 않아, 뒤로가기로 모달이 안 닫히고 화면이 갇힌다. ' +
    '(native-audit 의 modal-back 규칙이 통과시킨 모든 Modal 이 동시에 무력화된다)');
}

// ── 🔴 and-fcm-package — FCM 은 패키지명으로 앱을 찾는다 (SKILL.md §핵심 5) ──
// 어긋나면 getExpoPushTokenAsync 는 성공하고 DB 에도 저장되는데 발송만 조용히 실패한다.
const gsPath = androidCfg.googleServicesFile
  ? path.join(ROOT, androidCfg.googleServicesFile)
  : path.join(ROOT, 'google-services.json');
if (deps['expo-notifications']) {
  if (!existsSync(gsPath)) {
    cfg('and-fcm-package', 2,
      `google-services.json 을 찾을 수 없다(${androidCfg.googleServicesFile ?? 'google-services.json'}) — ` +
      'FCM 등록이 안 돼 안드로이드 푸시가 한 건도 도착하지 않는다');
  } else {
    const gs = JSON.parse(readFileSync(gsPath, 'utf8'));
    const pkgs = (gs.client ?? []).map((c) => c.client_info?.android_client_info?.package_name);
    if (androidCfg.package && !pkgs.includes(androidCfg.package)) {
      cfg('and-fcm-package', 2,
        `google-services.json 의 패키지(${pkgs.join(', ') || '없음'})가 app.json 의 android.package` +
        `(${androidCfg.package})와 다르다 — 토큰 발급·저장은 성공하는데 발송만 조용히 실패한다`);
    }
  }
}

// ── 🔴 and-channel — 채널 없는 알림은 조용히 묻힌다 (SKILL.md §핵심 5) ──
// Android 8+ 는 채널이 없으면 낮은 우선순위로 처리해 소리도 헤드업도 없다. "왔는데 안 보임".
if (deps['expo-notifications']) {
  const hasChannel = files.some((f) =>
    /setNotificationChannelAsync/.test(stripComments(readFileSync(f, 'utf8'))));
  if (!hasChannel) {
    findings.push({ level: 2, loc: 'src/lib/push/', rule: 'and-channel',
      msg: 'expo-notifications 를 쓰는데 setNotificationChannelAsync 호출이 없다 — ' +
        'Android 8+ 에서 알림이 소리·헤드업 없이 조용히 묻힌다(사용자는 "알림이 안 온다"고 말한다)' });
  }
}

// ── 🟡 and-allow-backup — 세션 토큰이 구글 드라이브로 나간다 (SKILL.md §핵심 7) ──
// allowBackup 기본값은 true. AsyncStorage 가 Auto Backup 대상이라 기기 이전 시 세션이 복원된다.
if (androidCfg.allowBackup === undefined && deps['@react-native-async-storage/async-storage']) {
  cfg('and-allow-backup', 1,
    'android.allowBackup 이 선언돼 있지 않다(기본값 true) — AsyncStorage 가 구글 Auto Backup 으로 ' +
    '백업돼 기기 이전·복원 시 예전 세션이 되살아난다. 의도한 것이면 app.json 에 명시해 근거를 남기고, ' +
    '아니면 "allowBackup": false');
}

// ── ℹ️ and-navbar-color(설정 쪽) — edge-to-edge 아래에서 무시되는 선언 (SKILL.md §핵심 3) ──
for (const key of ['navigationBarColor', 'navigationBar', 'androidStatusBar']) {
  if (androidCfg[key] !== undefined || appJson[key] !== undefined) {
    cfg('and-navbar-color', 1,
      `${key} 선언 — Android 15+ edge-to-edge 아래에서 시스템바 색 지정은 무시된다. ` +
      '색이 필요하면 인셋 높이만큼 우리가 배경 View 를 그린다');
  }
}

// ══════════════════════════════════════════════════════════════════
// B. 코드 축 — 파일별 규칙 (SKILL.md §핵심 2·3·4·6)
// ══════════════════════════════════════════════════════════════════
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);
  const rawLines = raw.split('\n');
  const sup = makeSuppressed(rawLines);
  const loc = (n) => `${rel(f)}:${n}`;

  // 스타일 이름 → 본문. 아래 두 규칙은 "스타일시트에 무엇이 있나"가 아니라
  // "그 스타일이 **어디에 어떻게 쓰였나**"로 판정한다(합성·자식 구성을 봐야 오탐이 안 난다).
  const styleBody = new Map();
  for (const o of objectLiterals(src)) styleBody.set(o.name, { body: o.body, line: o.line });
  const attrs = styleAttrs(src);
  const usesOf = (name) => attrs.filter((a) => a.names.includes(name));

  for (const [name, o] of styleBody) {
    if (sup(o.line)) continue;
    const uses = usesOf(name);
    if (!uses.length) continue; // 안 쓰이는 스타일은 화면에 영향이 없다

    // ── 🟡 and-elevation-bg — 투명 배경엔 그림자가 안 그려진다 (SKILL.md §핵심 4) ──
    // 안드로이드 그림자는 뷰 아웃라인에서 나온다. 배경이 없으면 아웃라인이 없고 그림자도 없다.
    // iOS 는 shadow* 로 잘 나오므로 "아이폰은 되는데 안드로이드만 평평하다"로 나타난다.
    // ★쓰이는 자리마다 backgroundColor 를 인라인으로 덧붙이면 정상이다(애니메이션 색 등) — 그건 뺀다.
    if (/\belevation:\s*[1-9]/.test(o.body) && !/backgroundColor/.test(o.body)) {
      const bare = uses.filter((a) => !a.hasBg);
      if (bare.length) {
        findings.push({ level: 1, loc: loc(bare[0].line), rule: 'and-elevation-bg',
          msg: `'${name}' 에 elevation 은 있는데 이 자리에서 backgroundColor 가 없다 — 안드로이드는 ` +
            '배경이 투명하면 그림자를 아예 안 그린다(아이폰만 그림자가 보이는 상태). ' +
            '배경색을 주거나 Elevation 토큰을 쓴다' });
      }
    }

    // ── 🟡 and-fixed-height-text — 글씨는 커지는데 상자가 안 커진다 (SKILL.md §핵심 2) ──
    // 안드로이드 '글씨 크게'는 최대 2.0배(+'화면 크게'가 또 곱한다). 고정 height 상자 안의 글자는
    // 잘리거나 겹친다. 웹·아이폰(설정을 잘 안 바꾼다)에선 영원히 안 보인다. → height 대신 minHeight.
    // ★상자와 글자는 보통 **다른 스타일 객체**에 있다 — 그래서 스타일시트가 아니라 JSX 자식을 본다.
    const h = /\bheight:\s*(\d+)/.exec(o.body);
    if (!h) continue;
    if (/minHeight|maxHeight/.test(o.body)) continue;
    // 고정 치수가 **의도**인 것들은 뺀다 — 여기서 걸러내지 않으면 경고가 20건씩 나오고,
    // 그 순간 이 검사는 아무도 안 보는 검사가 된다(native-gate.mjs 의 같은 교훈).
    //   · 가로도 같이 고정 = 도형(아바타 원·체크박스·뱃지). 글자는 장식이고 늘어나면 모양이 깨진다.
    //   · 24 미만 = 게이지 트랙·구분선. 애초에 글자 한 줄이 못 들어간다.
    if (/\b(width|minWidth):\s*\d/.test(o.body)) continue;
    if (Number(h[1]) < 24) continue;
    for (const a of uses) {
      if (sup(a.line)) continue;
      const sub = subtreeOf(src, a.at);
      if (!sub) continue;                                   // 판정 불가는 조용히 넘긴다
      if (!/<(Animated\.)?[A-Za-z]*Text[\s/>]/.test(sub)) continue; // 글자가 없으면 대상 아님
      if (/allowFontScaling=\{false\}/.test(sub)) continue;  // 의도적으로 안 커지게 한 곳
      findings.push({ level: 1, loc: loc(a.line), rule: 'and-fixed-height-text',
        msg: `'${name}'(고정 height)이 글자를 담고 있다 — 시스템 '글씨 크게'(최대 2배)를 켠 폰에서 ` +
          '글자가 잘리거나 겹친다. 40~60대 사장님 사용자가 실제로 켜는 설정이다. ' +
          'height 대신 minHeight 로 (근거: feedback_fixed_height_text_overflow)' });
      break; // 같은 스타일은 한 번만 보고한다
    }
  }

  // ── 🟡 and-window-dim — 화면은 앱이 켜진 채로 접혔다 펴진다 (SKILL.md §핵심 6) ──
  // 모듈 최상위에서 잰 Dimensions 는 영원히 그 값이다. API 36 은 600dp+ 에서 방향 고정도 무시하므로
  // "세로 고정이니 안 바뀐다"는 가정이 안드로이드에선 성립하지 않는다. → useWindowDimensions()
  rawLines.forEach((line, i) => {
    if (!/^(const|let|var)\s.*Dimensions\.get\(/.test(line)) return; // 들여쓰기 0 = 모듈 최상위
    if (sup(i + 1)) return;
    findings.push({ level: 1, loc: loc(i + 1), rule: 'and-window-dim',
      msg: '모듈 최상위에서 Dimensions.get() 으로 화면 크기를 한 번만 잰다 — 폴더블을 펴거나 ' +
        '멀티윈도우·큰 화면에서 창 크기가 바뀌어도 이 값은 안 바뀐다(레이아웃이 옛 크기로 고정). ' +
        'useWindowDimensions() 로 받는다' });
  });

  // ── 🟡 and-statusbar-bg — 상태바 색 지정이 조용히 무시된다 (SKILL.md §핵심 3) ──
  for (const t of openingTags(src, 'StatusBar')) {
    if (/backgroundColor|translucent/.test(t.tag) && !sup(t.line)) {
      findings.push({ level: 1, loc: loc(t.line), rule: 'and-statusbar-bg',
        msg: 'StatusBar 에 backgroundColor/translucent 지정 — Android 15+ edge-to-edge 아래에서 ' +
          '무시된다(경고 없이). 의도한 색이 안 나오는데 코드엔 색이 적혀 있어 원인을 못 찾게 된다. ' +
          '상단 인셋 높이만큼 배경 View 를 우리가 그린다' });
    }
  }
  for (const m of src.matchAll(/StatusBar\.setBackgroundColor\w*\(/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    if (!sup(line)) {
      findings.push({ level: 1, loc: loc(line), rule: 'and-statusbar-bg',
        msg: 'StatusBar.setBackgroundColor* 호출 — Android 15+ edge-to-edge 에서 무효(폐기된 API)' });
    }
  }

  // ── 🟡 and-navbar-color — 내비바 속성도 같은 운명 (SKILL.md §핵심 3) ──
  for (const m of src.matchAll(/\b(navigationBarColor|navigationBarHidden)\b/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    if (!sup(line)) {
      findings.push({ level: 1, loc: loc(line), rule: 'and-navbar-color',
        msg: `${m[1]} — Android 15+ edge-to-edge 아래에서 무시된다(iOS 엔 개념 자체가 없다). ` +
          '하단 시스템바 영역의 색은 탭바가 인셋을 소유해 직접 그린다' });
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
console.log(`\n══ android-preflight: 파일 ${files.length}개 스캔, ${total}건 검출 (🔴 ${findings.filter((x) => x.level === 2).length}) ══`);
console.log('오탐이면 그 줄에 `// android-preflight: ok <이유>` — 다음 스캔부터 제외된다.');
console.log('Play 업로드 전에는 출고 게이트도: node .claude/skills/android-preflight/scripts/scan-play.mjs --introspect');
process.exit(findings.some((x) => x.level === 2) ? 1 : 0);
