// qa-layout-stress.mjs — 좁은 폭·큰 글씨에서 화면이 깨지는지 잰다(2026-10-26 · 웹 측정 · 쓰기 없음).
//
//   npm run qa:layout-stress -- --routes=/signup                         (로그인 없는 화면)
//   npm run qa:layout-stress -- --routes=/account-edit --role=owner      (고정 계정 세션 · owner|junior)
//   옵션: --widths=320,360,393,430 · --scales=1,1.3,1.5
//   ★Git Bash 에서는 `MSYS_NO_PATHCONV=1` 을 앞에 붙인다 — "/signup" 이 C:/Program Files/Git/signup 으로 바뀐다.
//   개발 서버(QA_ORIGIN, 기본 http://localhost:8081)가 떠 있어야 한다.
//
// 왜: 다른 웹 하니스는 460px·기본 글씨만 잰다. 실제 폰은 360~430 폭이고, 시스템 글씨 크기와 앱 '크게'(1.18)가 곱해진다.
//   칩이 여러 줄로 감길 때의 잘림·겹침·넘침은 이 조합에서만 드러난다.
// 글씨 확대 흉내: 네이티브는 OS 배율을 Text·TextInput 의 fontSize·lineHeight 에 곱하고, 아이콘(allowFontScaling false)은 안 곱한다.
//   여기서는 화면이 뜬 뒤 글자 요소마다 계산된 fontSize·lineHeight 에 배율을 곱해 박는다. 아이콘 글꼴(ionicons)은 뺀다.
//   ★한계 1: maxFontSizeMultiplier(배지 1.3 등)는 DOM 에 안 남아 무시된다 → 1.5 배의 배지 넘침은 오탐일 수 있다.
//   ★한계 2: 웹 글꼴 폭은 Android(Noto Sans CJK)·iOS(Apple SD 산돌고딕)와 몇 % 다르다 → 경계선 사례는 스크린샷을 눈으로 본다.
//   ★한계 3: 키보드는 웹에 없다. 키보드 가림은 native-audit 스캐너의 kb-no-shift·kav-* 규칙이 맡는다.
// 판정(어떤 화면이든 참이어야 하는 것만 · 케이스별 기대값 없음):
//   S1 가로 넘침 0(r11) · S2 글자가 부모 밖으로 잘리지 않는다 · S3 글자끼리 겹치지 않는다
//   S4 누를 것이 보이고 닿는다(r2) · S5 누를 것 44×44 이상(r3) · S6 16자 이하 글자가 접히지 않는다(r4) · S7 내부 값이 화면에 없다(r12)
//   등급: 폭 ≥360 이고 배율 ≤1.3 이면 실패, 그 밖(320 폭·1.5 배)은 경고. 실패가 있으면 exit 1.
// 스크린샷: tmp/layout-stress/<화면>/<폭>x<배율>.png — 숫자가 통과여도 감긴 칩 모양은 눈으로 한 번 본다.
//
// 포트 9383(다른 하니스와 겹치지 않게 · crawl 9373~4).
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW } from './lib/qa-fixed-accounts.mjs';
import { CLICKABLE_SEL, firstRunSeedJs, probeFor, SETTLED, r2, r3, r4, r11, r12 } from './lib/qa-oracles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
} catch { /* 없으면 셸 env */ }
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const list = (v, d) => (typeof v === 'string' ? v.split(',').filter(Boolean) : d);
const ROUTES = list(args.routes, []);
const WIDTHS = list(args.widths, ['320', '360', '393', '430']).map(Number);
const SCALES = list(args.scales, ['1', '1.3', '1.5']).map(Number);
const ROLE = typeof args.role === 'string' ? args.role : null;
const HEIGHT = 780;
if (!ROUTES.length) { console.error('FAIL: --routes=/경로,/경로 가 필요하다(바꾼 화면만 잰다)'); process.exit(2); }
if (ROLE && !FIXED[ROLE]) { console.error(`FAIL: --role 은 ${Object.keys(FIXED).join('|')}`); process.exit(2); }
if (ROLE && (!SB || !ANON)) { console.error('FAIL: 세션이 필요한데 EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 가 없다'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const tierOf = (w, k) => (w >= 360 && k <= 1.3 ? 'fail' : 'warn');
const ICON_FONT = /ionicons/i;

/** 글자 요소의 원래 fontSize·lineHeight 를 한 번만 적어 두고, 배율 k 로 다시 박는다(k=1 이면 원래대로). 여러 번 불러도 같다. */
const scaleJs = (k) => `(() => {
  const k = ${k};
  let n = 0;
  for (const e of document.querySelectorAll('[dir="auto"], input, textarea')) {
    if (e.dataset.qsFs === undefined) {
      const cs = getComputedStyle(e);
      e.dataset.qsSkip = ${ICON_FONT}.test(cs.fontFamily) ? '1' : '';
      e.dataset.qsFs = String(parseFloat(cs.fontSize));
      e.dataset.qsLh = cs.lineHeight === 'normal' ? '' : String(parseFloat(cs.lineHeight));
    }
    if (e.dataset.qsSkip) continue;
    e.style.setProperty('font-size', (Number(e.dataset.qsFs) * k) + 'px', 'important');
    if (e.dataset.qsLh) e.style.setProperty('line-height', (Number(e.dataset.qsLh) * k) + 'px', 'important');
    n++;
  }
  return n;
})()`;

// role 없는 Pressable(업종 칩 등)은 RN-web 에서 div[tabindex="0"] 로만 보인다 — 기본 선택자로는 터치 크기·가려짐을 못 잰다.
const SEL = `${CLICKABLE_SEL},[tabindex="0"]`;
const SNAP_PROBE = probeFor(SEL);

/** S2·S3 용 — 보이는 글자 잎(아이콘 제외)의 잘림과 겹침. */
const LAYOUT_PROBE = `(() => {
  const SEL = ${JSON.stringify(SEL)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const hidden = (el) => { for (let a = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || a.getAttribute('aria-hidden') === 'true' || cs.opacity === '0') return true; } return false; };
  const texts = [...document.querySelectorAll('[dir="auto"]')].filter((e) => {
    if (e.querySelector('[dir="auto"]') || !norm(e.innerText)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !${ICON_FONT}.test(getComputedStyle(e).fontFamily) && !hidden(e);
  });
  const clipped = [];
  const vis = new Map(); // 글자 → 스크롤·잘림 상자로 깎은 보이는 상자
  for (const e of texts) {
    const t = norm(e.innerText).slice(0, 30);
    const r = e.getBoundingClientRect();
    let v = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    const cs = getComputedStyle(e);
    if (cs.overflow !== 'visible' && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)) clipped.push({ t, why: '말줄임' });
    // 칩·버튼 높이를 고정하면 큰 글씨가 테두리 밖으로 삐져나온다(잘리지 않고 보이므로 아래 조상 검사로는 안 잡힌다).
    const btn = e.parentElement && e.parentElement.closest(SEL);
    if (btn) {
      const br = btn.getBoundingClientRect();
      if (r.left < br.left - 2 || r.right > br.right + 2 || r.top < br.top - 2 || r.bottom > br.bottom + 2)
        clipped.push({ t, why: '버튼 밖 ' + Math.round(r.width) + '×' + Math.round(r.height) + ' / ' + Math.round(br.width) + '×' + Math.round(br.height) });
    }
    // 위로 올라가며 overflow 가 visible 이 아닌 조상을 본다. 스크롤 상자를 지나면 그 축은 더 안 본다(내리면 보인다).
    let checkX = true, checkY = true, reported = false;
    for (let a = e.parentElement; a && a !== document.body && (checkX || checkY); a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const sx = /(auto|scroll)/.test(as.overflowX), sy = /(auto|scroll)/.test(as.overflowY);
      const outX = checkX && !sx && (r.left < ar.left - 1 || r.right > ar.right + 1);
      const outY = checkY && !sy && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1);
      if (!reported && (outX || outY)) { clipped.push({ t, why: '부모 밖 ' + (outX ? '가로' : '세로') + ' ' + Math.round(r.width) + '×' + Math.round(r.height) + ' / ' + Math.round(ar.width) + '×' + Math.round(ar.height) }); reported = true; }
      // 보이는 상자는 잘림 상자로만 깎는다. 스크롤 축은 깎지 않는다(스크롤하면 보이는 글자도 겹침 대상이다).
      if (!sx) v = { ...v, l: Math.max(v.l, ar.left), r: Math.min(v.r, ar.right) };
      if (!sy) v = { ...v, t: Math.max(v.t, ar.top), b: Math.min(v.b, ar.bottom) };
      if (sx) checkX = false;
      if (sy) checkY = false;
    }
    vis.set(e, v);
  }
  // 겹침 — 같은 배치 뿌리(가장 가까운 absolute·fixed·sticky 조상) 안의 글자끼리만. 떠 있는 배지·메뉴는 일부러 겹친다.
  const rootOf = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'absolute' || p === 'fixed' || p === 'sticky') return a; } return document.body; };
  // 입력칸도 넣는다 — 감긴 칩이 아래 입력칸을 덮는 경우. 상자는 화면 상자 그대로(입력칸이 잘린 상자 안에 들 일은 드물다).
  const inputs = [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !hidden(e); })
    .map((e) => { const r = e.getBoundingClientRect(); return { e, v: { l: r.left, t: r.top, r: r.right, b: r.bottom }, root: rootOf(e), t: '입력칸 ' + (e.placeholder || '').slice(0, 14) }; });
  const items = [...texts.map((e) => ({ e, v: vis.get(e), root: rootOf(e), t: norm(e.innerText).slice(0, 20) })), ...inputs].filter((x) => x.v.r - x.v.l > 1 && x.v.b - x.v.t > 1);
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.root !== b.root || a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.v.r, b.v.r) - Math.max(a.v.l, b.v.l), h = Math.min(a.v.b, b.v.b) - Math.max(a.v.t, b.v.t);
    if (w > 2 && h > 2) overlaps.push('"' + a.t + '" ↔ "' + b.t + '" ' + Math.round(w) + '×' + Math.round(h));
  }
  return { clipped, overlaps };
})()`;

const res = (status, detail = []) => ({ status, detail });
// 말줄임(numberOfLines)은 긴 이름을 일부러 줄인 것일 수 있어 경고로만 센다. 부모 밖·버튼 밖은 실패.
const s2 = (lp) => {
  const d = lp.clipped.map((c) => `"${c.t}" ${c.why}`);
  return res(lp.clipped.some((c) => c.why !== '말줄임') ? 'fail' : d.length ? 'warn' : 'pass', d);
};
const s3 = (lp) => res(lp.overlaps.length ? 'fail' : 'pass', lp.overlaps);
const CHECKS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
const TITLES = { S1: '가로 넘침', S2: '글자 잘림', S3: '글자 겹침', S4: '가려짐·닿지 않음', S5: '터치 44', S6: '짧은 글자 접힘', S7: '내부 값 노출' };

async function sessionFor(role) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: FIXED[role], password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${FIXED[role]} 로그인 실패 — 로컬이면 고정 계정 시드부터(AGENTS.md QA 하니스)`);
  return j;
}

/** 화면이 뜰 때까지 — SETTLED(글자 있음·로딩 없음·스플래시 걷힘)가 참이고, 글자 길이가 0.8초 동안 그대로. */
async function settle(page) {
  const t0 = Date.now();
  let last = -1, stableSince = 0;
  while (Date.now() - t0 < 20000) {
    const n = await page.eval(`(${SETTLED}) ? (document.body.innerText || '').trim().length : -1`).catch(() => -1);
    if (n > 0 && n === last) { if (!stableSince) stableSince = Date.now(); if (Date.now() - stableSince >= 800) return true; }
    else stableSince = 0;
    last = n;
    await sleep(150);
  }
  return false;
}

const { page, close } = await launch({ origin: ORIGIN, storageKey: SB ? storageKeyFor(SB) : 'none', width: WIDTHS[0], height: HEIGHT, port: 9383 });
let fails = 0, warns = 0;
try {
  if (ROLE) await page.seedSession(await sessionFor(ROLE));
  // seedSession 이 저장소를 비운 뒤에 돌도록 그 다음에 건다(같은 순서로 문서마다 실행된다).
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{try{${firstRunSeedJs(ROOT)}}catch(e){}})()` });
  for (const route of ROUTES) {
    const slug = route.replace(/^\//, '').replace(/[^\w-]+/g, '_') || 'root';
    const dir = join(ROOT, 'tmp', 'layout-stress', slug);
    mkdirSync(dir, { recursive: true });
    console.log(`\n■ ${route}${ROLE ? ` (${ROLE})` : ''}`);
    const rows = [];
    for (const w of WIDTHS) {
      await page.resize(w, HEIGHT);
      await page.goto(route);
      if (!(await settle(page))) { rows.push({ w, k: '-', cells: {}, note: '20초 안에 화면이 안 섰다' }); fails++; continue; }
      const landed = await page.path();
      if (landed !== route.split('?')[0]) { rows.push({ w, k: '-', cells: {}, note: `${landed} 로 넘어갔다(세션·권한 확인)` }); fails++; continue; }
      for (const k of SCALES) {
        await page.eval(scaleJs(k));
        await sleep(400);
        await page.eval(scaleJs(k)); // 확대로 새로 그려진 요소까지
        await sleep(300);
        const snap = await page.eval(SNAP_PROBE);
        const lp = await page.eval(LAYOUT_PROBE);
        // 창을 콘텐츠 길이만큼 늘린 스냅샷 — r3 는 화면 밖 요소를 건너뛰어 스크롤 아래 칩의 터치 크기를 못 잰다. 스크린샷도 이때 찍는다.
        const extra = await page.eval(`Math.max(0, ...[...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => e.scrollHeight - e.clientHeight))`);
        await page.resize(w, Math.min(HEIGHT + extra, 6000));
        await sleep(300);
        await page.eval(scaleJs(k));
        const full = await page.eval(SNAP_PROBE);
        await page.shot(join(dir, `${w}x${k}.png`));
        await page.resize(w, HEIGHT);
        await sleep(300);
        const cells = { S1: r11(snap), S2: s2(lp), S3: s3(lp), S4: r2(snap), S5: r3(full), S6: r4(snap), S7: r12(full) };
        const tier = tierOf(w, k);
        for (const c of CHECKS) {
          const st = cells[c].status;
          if (st === 'fail' && tier === 'fail') { cells[c].mark = '✗'; fails++; }
          else if (st === 'fail' || st === 'warn') { cells[c].mark = '!'; warns++; }
          else cells[c].mark = '·';
        }
        rows.push({ w, k, tier, cells });
      }
      await page.eval(scaleJs(1));
    }
    console.log(`  폭×배율   ${CHECKS.map((c) => c).join(' ')}   (✗ 실패 · ! 경고 · · 통과)`);
    for (const r of rows) {
      if (r.note) { console.log(`  ${String(r.w).padStart(3)}       ✗ ${r.note}`); continue; }
      console.log(`  ${String(r.w).padStart(3)}×${String(r.k).padEnd(4)}  ${CHECKS.map((c) => ` ${r.cells[c].mark}`).join(' ')}`);
    }
    for (const r of rows) {
      if (r.note) continue;
      for (const c of CHECKS) {
        if (r.cells[c].mark === '·') continue;
        const d = r.cells[c].detail;
        console.log(`    ${r.cells[c].mark} ${r.w}×${r.k} ${c} ${TITLES[c]}: ${d.slice(0, 3).join(' | ')}${d.length > 3 ? ` 외 ${d.length - 3}` : ''}`);
      }
    }
    console.log(`  스크린샷: tmp/layout-stress/${slug}/`);
  }
} finally {
  await close();
}
console.log(`\nRESULT: 실패 ${fails} · 경고 ${warns} (화면 ${ROUTES.length} × 폭 ${WIDTHS.length} × 배율 ${SCALES.length})`);
process.exit(fails ? 1 : 0);
