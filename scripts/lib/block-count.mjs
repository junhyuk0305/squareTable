// block-count.mjs — 화면의 "블록 수 상한(ceiling)"을 TS AST로 잰다.
//
// 왜 상한인가: 블록 예산은 상한 규칙(A ≤5 · C ≤3)이다. 상한은 최악 상태에서 재야 하는데
// 브라우저 실측은 "시드된 데이터 상태 딱 하나"만 잰다(qa-blocks-browser.mjs의 B7-5가
// 단일 매장 시드에서만 통과하는 것이 그 예). 정적 분석은 조건부 가지를 전부 세고
// 상호배타만 접으므로 자연스럽게 상한이 나온다.
//
// 반환: { min, max, flags, chain, groups }
//   · max = 판정에 쓰는 값(상한). 과대 추정 방향으로만 틀리도록 설계했다.
//   · min = 참고값. **판정에 쓰지 않는다**(로딩 게이트 아래 화면이 0으로 나온다).
//   · flags: '?' 위임 미해소 · '▽' 조건부(상한은 과대 추정) · '~' 카드 스타일 휴리스틱 사용
//
// 못 재는 것(원리적으로): 두 블록의 형태가 같은지(배치규칙 ① 연속 3회 금지) · 시각 순서 ·
// 런타임에 실제로 그려졌는지(AlertRow는 0건이면 스스로 null) · 본문 15sp · 색 대비 · 가려짐.
// 그건 `npm run qa:blocks`(8화면 브라우저)가 본다.
import ts from 'typescript';
import { readFileSync } from 'node:fs';

// ── 사전 ─────────────────────────────────────────────────────────────
// ★ BLOCK_LEAF 앞 5종(blocks/)의 SSOT는 `.claude/rules/ui.md`(블록 어휘 §)다.
//   블록을 추가·삭제하면 **여기도 같이 고친다** — ui.md가 "쓰이지 않으면 삭제"를 규정하므로
//   드리프트가 실제로 생긴다(H1·H2·I2·L4가 08-06에 삭제된 선례).
const BLOCK_LEAF = new Set([
  // src/components/blocks/ 5종 — ui.md와 정확히 같아야 한다
  'ProgressRing', 'StepProgress', 'ActionRow', 'MiniStats', 'AlertRow',
  // 이미 있어서 재구현 금지인 표시 블록들(ui.md "이미 있는 것도 재구현 금지")
  'InboxHeroCard', 'StarterChecklist', 'PlanUpgradeNotice', 'EmptyState',
  'KnowhowCarousel', 'FeatureCarousel', 'BrowseList', 'NotificationList',
  'NudgeCard', 'SegmentTabs', 'PricingTable', 'NotificationEnableCard',
  'FreeUntilNotice', 'DeflectCard', 'TimesheetView',
  // ★ 설계안 A-1 목록에 없던 추가 1건 — SettingsKit 의 `SettingsSection` 은
  //   `{title && <SectionLabel/>} + <View style={card}>{children}</View>` 로 **정확히 '제목+내용 한 덩어리'**다.
  //   빼면 설정 3화면(/account-settings·/owner/settings·/junior/settings)이 실제 5~6 섹션인데 1~2로 나온다.
  'SettingsSection',
]);
const TITLE = new Set(['SectionLabel']);
// 화면 크롬 — 블록이 아니다(스크롤 컨테이너·헤더 액션·전역 오버레이)
const CHROME = new Set([
  'SafeAreaView', 'ScrollView', 'FlatList', 'KeyboardAvoidingView', 'Stack', 'Stack.Screen',
  'Redirect', 'ActivityIndicator', 'RoleTabBar', 'HubTabBar', 'HubTopBar', 'StoreToggle',
  'NotificationBell', 'OwnerNotificationBell', 'HeaderBackButton', 'HeaderLogoutButton',
  'StoreHeaderTitle', 'Toast', 'SyncBanner', 'CoachmarkTour', 'DialogHost', 'ErrorBoundary',
  'ResponsiveShell', 'InfoDot',
  // Appear 는 래퍼다 — starts() 로 잡지 않고 A-3의 전용 규칙으로 처리한다.
  'Appear',
]);
const SHEET_RE = /(?:Sheet|Modal|Overlay|Tour|Host)$/;          // 시트·모달은 화면 블록이 아니다
const GATE_RE = /^!{0,2}[\w.]*(?:[Ll]oaded|[Ll]oading|[Rr]eady|[Hh]ydrated)$/; // 로딩 게이트 = 상수

// 카드 스타일 키에서 제외할 이름 — 작은 UI 원자(입력·칩·배지)가 카드로 잡혀 상한이 부푼다.
// (/owner/training 에서 input·reqChip·dayChip·searchWrap 이 카드로 잡혔던 실측 사례)
// 접두(소문자 시작) 또는 camelCase 접미 양쪽을 본다 — 접두만 보면 reqChip·dayChip 이 샌다.
const NON_CARD_KEY =
  /^(?:input|chip|btn|button|badge|dot|icon|wrap|search|pill|tag|avatar|thumb|toggle)|(?:Input|Chip|Btn|Button|Badge|Dot|Icon|Wrap|Search|Pill|Tag|Avatar|Thumb|Toggle)$/;

// ── 파싱 유틸 ─────────────────────────────────────────────────────────
const parse = (abs) =>
  ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
const strip = (e) => (e && ts.isParenthesizedExpression(e) ? strip(e.expression) : e);

const tagName = (node) => {
  const t = ts.isJsxElement(node) ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node) ? node.tagName : null;
  return t ? t.getText() : null;
};
const kids = (node) =>
  ts.isJsxElement(node) ? node.children : ts.isJsxFragment(node) ? node.children : [];

/** style={styles.X} / style={[styles.a, s.b]} 에서 X 목록 */
const styleKeys = (node) => {
  const el = ts.isJsxElement(node) ? node.openingElement : node;
  const out = [];
  for (const a of el.attributes?.properties ?? []) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'style' || !a.initializer) continue;
    for (const m of a.initializer.getText().matchAll(/\b(?:styles|s)\.([A-Za-z0-9_]+)/g)) out.push(m[1]);
  }
  return out;
};

/** 이 파일의 StyleSheet.create 안에서 '카드처럼 생긴' 키 집합 (A-2) */
function cardStyleKeys(sf) {
  const set = new Set();
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer)) {
      const key = n.name.getText().replace(/['"]/g, '');
      const body = n.initializer.getText();
      const isCard = /backgroundColor/.test(body) && /borderRadius/.test(body)
        && /borderWidth|Elevation\.|shadow/.test(body);
      const fixedBox = /\bwidth\s*:\s*\d/.test(body) || /\bheight\s*:\s*\d/.test(body);
      if (isCard && !fixedBox && !NON_CARD_KEY.test(key)) set.add(key);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return set;
}

const isUpper = (n) => /^[A-Z]/.test(n);

/** 파일 안에 정의된 컴포넌트 이름 → 함수 노드 */
function componentsOf(sf) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && isUpper(n.name.getText()) && n.body) {
      map.set(n.name.getText(), n);
    } else if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const init = strip(n.initializer);
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && isUpper(n.name.getText())) {
        map.set(n.name.getText(), init);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

/** default export 컴포넌트 이름 (없으면 null) */
function defaultExportName(sf) {
  let name = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name
      && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) name ??= n.name.getText();
    if (ts.isExportAssignment(n) && !n.isExportEquals && ts.isIdentifier(n.expression)) name ??= n.expression.getText();
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return name;
}

/** 함수 노드의 return JSX 전부. 주 렌더 = 그중 가장 큰 것. */
function allReturns(fn) {
  if (!fn.body) return [];
  if (isJsx(strip(fn.body))) return [strip(fn.body)];    // 화살표 축약형: () => (<X/>)
  const out = [];
  const grab = (m) => {
    // 중첩 함수(콜백·내부 컴포넌트)의 return 은 이 함수의 것이 아니다
    if (m !== fn && (ts.isFunctionDeclaration(m) || ts.isFunctionExpression(m) || ts.isArrowFunction(m))) return;
    if (ts.isReturnStatement(m) && m.expression) {
      const e = strip(m.expression);
      if (e && isJsx(e)) out.push(e);
    }
    ts.forEachChild(m, grab);
  };
  grab(fn.body);
  return out;
}

// ── 블록 세기 (A-3 / A-4) ────────────────────────────────────────────
function countIn(root, cards) {
  const conds = [];               // { atoms:Set, n:number }
  let always = 0;
  let usedCard = false;

  const starts = (node) => {
    const t = tagName(node);
    if (!t) return false;
    if (CHROME.has(t) || SHEET_RE.test(t)) return false;
    if (BLOCK_LEAF.has(t) || TITLE.has(t)) return true;
    if (styleKeys(node).some((k) => cards.has(k))) { usedCard = true; return true; }
    return false;
  };
  const hasSignalInside = (node) => {
    let found = false;
    const go = (n) => {
      if (found) return;
      if (isJsx(n) && n !== node && starts(n)) { found = true; return; }
      ts.forEachChild(n, go);
    };
    ts.forEachChild(node, go);
    return found;
  };
  const isMapCall = (n) =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.getText() === 'map';

  // 조건식 → 원자 집합. 로딩 게이트는 '조건부 블록'이 아니라 '아직 안 그림'이므로 버린다.
  const norm = (p) => p.replace(/\s+/g, '');
  const atomsOf = (txt) => new Set(
    txt.split('&&').map((p) => norm(p).replace(/^\(|\)$/g, ''))
      .filter((p) => p && !GATE_RE.test(p)),
  );
  const flip = (a) => (a.startsWith('!') ? a.slice(1) : `!${a}`);
  // 삼항 else 가지 — **여기에도 같은 게이트 필터를 태운다**(안 태우면 min 이 0으로 샌다).
  const elseAtomsOf = (txt) => {
    const a = atomsOf(txt);
    if (a.size === 0) return new Set();                 // 게이트뿐 → 분기가 아니다
    if (a.size === 1) return new Set([flip([...a][0])]);
    return new Set([`!(${norm(txt)})`]);                // 복합 조건 → 짝을 못 짓는다(= 과대 추정, 안전)
  };

  // x==='chat' vs x==='notice' — 세그먼트/탭 전환은 상호배타
  const sameVarDiffLiteral = (a, b) => {
    const ma = a.match(/^(.+?)===(.+)$/), mb = b.match(/^(.+?)===(.+)$/);
    return !!ma && !!mb && ma[1] === mb[1] && ma[2] !== mb[2];
  };
  const negates = (a, b) =>
    // ★ a !== b 선행 검사 필수 — 없으면 'x>0'.replace('===0','>0') 가 원본을 돌려줘
    //   자기 자신과 배타가 되고, 조건부가 전부 한 묶음이 되어 상한이 과소 측정된다.
    a !== b && (
      a === `!${b}` || b === `!${a}`
      || a.replace('===0', '>0') === b || b.replace('===0', '>0') === a
      || a.replace('.length===0', '.length>0') === b || b.replace('.length===0', '.length>0') === a
      || a.replace('===', '!==') === b || b.replace('===', '!==') === a
      || sameVarDiffLiteral(a, b)
    );
  const exclusive = (A, B) => [...A].some((a) => [...B].some((b) => negates(a, b)));
  const union = (a, b) => new Set([...a, ...b]);
  const add = (ctx, n) => { if (ctx.atoms.size === 0) always += n; else conds.push({ atoms: ctx.atoms, n }); };

  const walk = (node, ctx) => {
    // SectionLabel = 덩어리의 시작. 같은 부모 안에서 **다음 SectionLabel 이 나올 때까지** 형제를 흡수한다
    // (블록 = 제목+내용 한 덩어리). 형제 1개만 흡수하면 `<View style={styles.block}>` 안에
    // [SectionLabel, MiniStats, {조건 && 카드}] 가 든 /owner/inbox 가 섹션 하나를 2로 센다.
    let absorbing = false;
    for (const c of kids(node)) {
      if (ts.isJsxText(c) && !c.getText().trim()) continue;
      if (tagName(c) === 'SectionLabel') { add(ctx, 1); absorbing = true; continue; }
      if (absorbing) continue;                               // 제목의 내용부 = 흡수
      if (ts.isJsxExpression(c)) { collectExpr(strip(c.expression), ctx); continue; }
      collect(c, ctx);
    }
  };

  const collectExpr = (e, ctx) => {
    if (!e) return;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      collectExpr(strip(e.right), { atoms: union(ctx.atoms, atomsOf(e.left.getText())), map: ctx.map });
      return;
    }
    if (ts.isConditionalExpression(e)) {
      const cond = e.condition.getText();
      collectExpr(strip(e.whenTrue), { atoms: union(ctx.atoms, atomsOf(cond)), map: ctx.map });
      collectExpr(strip(e.whenFalse), { atoms: union(ctx.atoms, elseAtomsOf(cond)), map: ctx.map });
      return;
    }
    collect(e, ctx);
  };

  const collect = (node, ctx) => {
    if (!node) return;
    if (isMapCall(node)) { if (hasJsx(node)) add(ctx, 1); return; }   // 반복 = 1
    if (!isJsx(node)) {                       // JSX 아닌 표현식 → 안쪽 JSX 로 내려간다
      const inner = [];
      const go = (n) => { if (isJsx(n)) { inner.push(n); return; } ts.forEachChild(n, go); };
      ts.forEachChild(node, go);
      if (ctx.map) { if (inner.length) add(ctx, 1); return; }
      for (const i of inner) collect(i, ctx);
      return;
    }
    if (ts.isJsxFragment(node)) { walk(node, ctx); return; }
    const t = tagName(node);
    if (t && SHEET_RE.test(t)) return;                                  // 시트·모달 통째로 skip
    if (ctx.map) { add(ctx, 1); return; }
    if (starts(node)) { add(ctx, 1); return; }                          // 블록 시작 → 자손 안 셈
    if (t === 'Appear' && !hasSignalInside(node)) { add(ctx, 1); return; } // 이름 없는 섹션
    walk(node, ctx);
  };
  const hasJsx = (n) => { let f = false; const go = (x) => { if (f) return; if (isJsx(x)) { f = true; return; } ts.forEachChild(x, go); }; ts.forEachChild(n, go); return f; };

  walk(root, { atoms: new Set(), map: false });

  // ① 같은 가지(원자 집합이 동일)는 합산한다 — 한 가지 안의 블록 2개는 "동시에" 뜬다.
  const branches = [];
  for (const c of conds) {
    const same = branches.find((b) => b.key === [...c.atoms].sort().join('&'));
    if (same) same.n += c.n;
    else branches.push({ key: [...c.atoms].sort().join('&'), atoms: c.atoms, n: c.n });
  }
  // ② 상호배타 묶기 — 기존 묶음의 **모든** 원소와 배타일 때만 합류
  const groups = [];
  for (const c of branches) {
    const g = groups.find((G) => G.every((x) => exclusive(x.atoms, c.atoms)));
    if (g) g.push(c); else groups.push([c]);
  }
  return {
    min: always,
    max: always + groups.reduce((s, g) => s + Math.max(...g.map((x) => x.n)), 0),
    usedCard,
    groups: groups.map((g) => g.map((x) => `${[...x.atoms].join('&') || '·'}:${x.n}`)),
  };
}

// ── 진입점 (A-5 위임 추적: 자동 탐색이 아니라 선언 + 같은 파일 1단) ──────
const MAX_HOP = 2;

/**
 * @param {string} absPath  .tsx 절대 경로
 * @param {string} [componentName]  등록표의 component 필드. 없으면 default export.
 */
export function countBlocks(absPath, componentName) {
  const sf = parse(absPath);
  const cards = cardStyleKeys(sf);
  const comps = componentsOf(sf);

  let name = componentName ?? defaultExportName(sf);
  const chain = [];
  const seen = new Set();
  let flags = '';

  for (let hop = 0; hop < MAX_HOP; hop++) {
    const fn = name ? comps.get(name) : null;
    if (!fn || seen.has(name)) break;
    seen.add(name);
    chain.push(name);
    const rets = allReturns(fn);
    if (!rets.length) break;
    const root = rets.slice().sort((a, b) => b.getText().length - a.getText().length)[0];
    const r = countIn(root, cards);
    // 같은 파일 안 위임: 껍데기(신호 0)가 같은 파일의 다른 컴포넌트를 **딱 한 번** 그린다.
    //   예) billing.tsx — export default BillingScreen(:49)은 껍데기(return <Redirect/> | null | <BillingBody/>),
    //      본문은 같은 파일의 BillingBody(:58). 위임은 파일을 건너뛸 때만 생기는 게 아니다.
    //   "딱 한 번" 조건이 없으면 terms/privacy 의 반복 헬퍼 <Section> 으로 잘못 들어간다.
    if (r.max === 0) {
      const tags = rets.flatMap(collectTags);
      const cand = [...new Set(tags)]
        .filter((t) => comps.has(t) && !seen.has(t) && tags.filter((x) => x === t).length === 1);
      if (cand.length === 1) { name = cand[0]; continue; }
    }
    // max 0 = "단순함"이 아니라 "여기서 안 셈" → 물음표를 남긴다(정본 §0 태도 승계).
    return {
      min: r.min, max: r.max, groups: r.groups, chain,
      flags: flags + (r.groups.length ? '▽' : '') + (r.usedCard ? '~' : '') + (r.max === 0 ? '?' : ''),
    };
  }
  // 대상 함수 자체를 못 찾음
  return { min: 0, max: 0, groups: [], chain, flags: `${flags}?` };
}

function collectTags(root) {
  const out = [];
  const go = (n) => { const t = tagName(n); if (t) out.push(t); ts.forEachChild(n, go); };
  go(root);
  return out;
}
