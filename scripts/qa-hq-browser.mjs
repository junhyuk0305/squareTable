// qa-hq-browser.mjs — 웹 셸 세 갈래 실브라우저 실측 (본사 웹 대시보드 P1).
//
// 로그인한 사람의 종류에 따라 **껍데기만** 갈리는지 숫자로 확인한다.
//   A 사장  — 왼쪽 사이드바 + 본문 720 캡 · 하단 탭바 없음 · 사이드바 항목 = 허브3 + 매장5 + 하단3
//   B 직원  — 지금 폰 프레임(460) 그대로 · 사이드바 없음 · 하단 탭바 있음
//   C 본사  — 사이드바 5메뉴 · 본문 폭 캡 없음 · 탭바 없음 (브랜드 축 P2 전이라 개발 전용 플래그로 연다)
//   D 모달  — 사장 셸에서 확인 모달이 460 폭으로, 사이드바 **오른쪽 가운데**에 뜬다
//   E 시트  — 사장 셸에서 바텀시트가 460 프레임 안에 잘림 없이 뜬다
//   F 콘솔 에러 0 · 가려짐(elementFromPoint) 0 — 세 세션 모두
//
// 실행: `npm run web` 을 띄운 뒤 `node scripts/qa-hq-browser.mjs` (QA_ORIGIN 기본 localhost:8081)
// 계정: 축 A 고정 계정(사장 owner@pilot… · 직원 staff2@pilot…) — ⛔계정을 새로 만들지 않는다.
// 스크린샷 → ./qa-shots/hq/
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const e = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !e[m[1]]) e[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return e;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const SHOTS = './qa-shots/hq';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON) {
  console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 필요(.env)');
  process.exit(2);
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

// 축 A 고정 계정(메모리 feedback_qa_use_fixed_accounts).
const PW = 'pilot1234';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';

const projectRef = new URL(URL_).hostname.split('.')[0];
const STORAGE_KEY = `sb-${projectRef}-auth-token`;

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, extra); }
};

async function passwordSession(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`${email} 로그인 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

/** 세션(+본사 미리보기 플래그)을 심은 새 페이지. 콘솔 에러는 모아 둔다. */
async function openPage(ctx, { session, hqPreview = false }) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(
    ([k, v, hq]) => {
      try {
        if (v) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
        if (hq) localStorage.setItem('st-hq-preview', '1');
        else localStorage.removeItem('st-hq-preview');
      } catch { /* 저장 불가 브라우저 */ }
    },
    [STORAGE_KEY, session ? JSON.stringify(session) : null, hqPreview],
  );
  page.qaErrors = errors;
  return page;
}

/** 스플래시(~1.9s)와 화면 로딩 게이트가 지나갈 때까지. */
const settle = (page) => page.waitForTimeout(5000);

const box = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }, sel);

/**
 * 사이드바 **밖**에 있는 하단 탭 버튼 수 — 사이드바 항목과 라벨이 같아 안쪽은 빼고 센다.
 * ★textContent 로 찾지 않는다 — 아이콘이 폰트 글리프라 텍스트에 섞여 정확 일치가 안 된다. aria-label 로 본다.
 */
const tabBarCount = (page, labels) =>
  page.evaluate((ls) => {
    const side = document.querySelector('[data-testid="side-nav"]');
    return [...document.querySelectorAll('[aria-label]')].filter((b) => {
      if (side && side.contains(b)) return false;
      return ls.includes((b.getAttribute('aria-label') ?? '').trim());
    }).length;
  }, labels);

/** 글자를 가진 리프 중 다른 것에 가려진 것 — 덮인 채로 재면 나머지 판정이 전부 거짓이 된다. */
const occluded = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div,span,p,button')) {
      const t = (el.textContent ?? '').trim();
      if (!t || t.length > 40 || el.children.length) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(t);
    }
    return out;
  });

/**
 * 화면에 떠 있는 **460 캡 컬럼**(`frameCapStyle`·`modalFrameStyle`)을 찾는다.
 *
 * ★사장 웹 셸의 본문은 720 이라 460 컬럼이 **평소엔 하나도 없다** — 즉 460 컬럼의 존재가 곧
 *   "모달이나 시트가 떠 있다"는 신호다. 글자로 찾으면 문구가 바뀔 때마다 검사가 깨진다.
 */
const capColumn = (page) =>
  page.evaluate(() => {
    let best = null;
    for (const el of document.querySelectorAll('div')) {
      if (getComputedStyle(el).maxWidth !== '460px') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 40) continue;
      if (!best || r.width * r.height > best.area) {
        best = { x: r.x, w: r.width, right: r.right, top: r.y, bottom: r.bottom, area: r.width * r.height };
      }
    }
    return best;
  });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // ── A 사장 웹 셸 ─────────────────────────────────────────────
  console.log('\nA 사장 — 넓은 웹 셸');
  const ownerSession = await passwordSession(OWNER);
  const po = await openPage(ctx, { session: ownerSession });
  await po.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
  await settle(po);
  await po.screenshot({ path: `${SHOTS}/A-owner-hub.png` });

  const side = await box(po, '[data-testid="side-nav"]');
  const content = await box(po, '[data-testid="owner-web-content"]');
  check('A1 사이드바가 있다', !!side);
  check('A2 본문 폭 ≤ 720', !!content && content.w <= 721, content ? `${content.w}px` : '본문 없음');
  check(
    'A3 본문이 사이드바 오른쪽에서 시작한다',
    !!side && !!content && content.x >= side.right - 1,
    side && content ? `side.right=${side.right} content.x=${content.x}` : '',
  );
  const navKeys = await po.$$eval('[data-testid^="nav-"]', (els) => els.map((e) => e.getAttribute('data-testid')));
  // 허브 3(현황·노하우·매장) + 매장 5(홈·노하우·퀴즈·업무 채팅·설정) + 하단 3(알림·계정 설정·로그아웃)
  check('A4 사이드바 항목 11개', navKeys.length === 11, navKeys.join(' '));
  for (const want of ['nav-/hub', 'nav-/hub-growth', 'nav-/stores', 'nav-/owner/dashboard', 'nav-/owner/settings', 'nav-/notifications', 'nav-logout']) {
    check(`A5 ${want}`, navKeys.includes(want));
  }
  check('A6 하단 탭바가 없다(이동 수단 이중 노출 0)', (await tabBarCount(po, ['현황', '노하우', '매장'])) === 0);
  check('A7 콘솔 에러 0', po.qaErrors.length === 0, po.qaErrors.slice(0, 3).join(' | '));
  const occA = await occluded(po);
  check('A8 가려진 글자 0', occA.length === 0, occA.slice(0, 4).join(' | '));

  // ── D 확인 모달 ──────────────────────────────────────────────
  console.log('\nD 확인 모달 — 460 폭, 사이드바 오른쪽');
  check('D0 모달 열기 전에는 460 캡 컬럼이 없다(본문은 720)', !(await capColumn(po)));
  await po.click('[data-testid="nav-logout"]');
  await po.waitForTimeout(1000);
  await po.screenshot({ path: `${SHOTS}/D-owner-dialog.png` });
  const dialog = await capColumn(po);
  const vw = await po.evaluate(() => innerWidth);
  check('D1 확인 모달이 떴다(460 캡 컬럼 등장)', !!dialog);
  check('D2 모달이 460 프레임 안이다', !!dialog && dialog.w <= 461, dialog ? `${dialog.w}px` : '');
  check('D3 모달이 잘리지 않는다', !!dialog && dialog.x >= 0 && dialog.right <= vw, dialog ? `x=${dialog.x} right=${dialog.right}` : '');
  check(
    'D4 모달이 사이드바에 가리지 않는다',
    !!dialog && !!side && dialog.x > side.right - 1,
    dialog && side ? `dialog.x=${dialog.x} side.right=${side.right}` : '',
  );
  // ⛔확인을 누르면 진짜 로그아웃된다 — 취소로 닫는다.
  await po.evaluate(() => {
    const b = [...document.querySelectorAll('div,span,button')].find((e) => !e.children.length && (e.textContent ?? '').trim() === '취소');
    (b?.closest('[role="button"]') ?? b)?.click();
  });
  await po.waitForTimeout(700);

  // ── E 바텀시트 ───────────────────────────────────────────────
  console.log('\nE 바텀시트 — 460 프레임 안, 잘림 0');
  // 현황 화면의 '답 기다리는 질문' 행 → OwnerStatusView 의 BottomSheet(종류가 2개 이상일 때).
  const opened = await po.evaluate(() => {
    const leaf = [...document.querySelectorAll('div,span')].find(
      (e) => !e.children.length && (e.textContent ?? '').trim() === '답 기다리는 질문',
    );
    const btn = leaf?.closest('[role="button"]') ?? leaf?.parentElement?.closest('[role="button"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) {
    check('E1 시트 트리거를 찾았다', false, "현황 화면에 '답 기다리는 질문' 행이 없다 — 시드 상태를 확인한다");
  } else {
    await po.waitForTimeout(1000);
    await po.screenshot({ path: `${SHOTS}/E-owner-sheet.png` });
    const sheet = await capColumn(po);
    check('E1 바텀시트가 떴다(460 캡 컬럼 등장)', !!sheet);
    check('E2 시트가 460 프레임 안이다', !!sheet && sheet.w <= 461, sheet ? `${sheet.w}px` : '');
    check('E3 시트가 잘리지 않는다', !!sheet && sheet.x >= 0 && sheet.right <= vw, sheet ? `x=${sheet.x} right=${sheet.right}` : '');
  }
  await po.close();

  // ── B 직원 웹 ────────────────────────────────────────────────
  console.log('\nB 직원 — 지금 폰 셸 그대로');
  const juniorSession = await passwordSession(JUNIOR);
  const pj = await openPage(ctx, { session: juniorSession });
  await pj.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
  await settle(pj);
  await pj.screenshot({ path: `${SHOTS}/B-junior-hub.png` });
  check('B1 사이드바가 없다', !(await box(pj, '[data-testid="side-nav"]')));
  const frame = await capColumn(pj); // 폰 셸에서는 이 460 컬럼이 곧 프레임이다
  check('B2 폰 프레임 460 유지', !!frame && Math.abs(frame.w - 460) < 1.5, frame ? `${frame.w}px` : '프레임 없음');
  check('B3 하단 탭바가 그대로 있다', (await tabBarCount(pj, ['오늘', '성장', '매장'])) >= 3);
  check('B4 콘솔 에러 0', pj.qaErrors.length === 0, pj.qaErrors.slice(0, 3).join(' | '));
  const occB = await occluded(pj);
  check('B5 가려진 글자 0', occB.length === 0, occB.slice(0, 4).join(' | '));
  await pj.close();

  // ── C 본사 셸 ────────────────────────────────────────────────
  console.log('\nC 본사 — 데스크톱 셸 5메뉴 (개발 전용 미리보기 플래그)');
  const ph = await openPage(ctx, { session: ownerSession, hqPreview: true });
  await ph.goto(`${ORIGIN}/hq`, { waitUntil: 'domcontentloaded' });
  await settle(ph);
  await ph.screenshot({ path: `${SHOTS}/C-hq-dashboard.png` });
  const hqSide = await box(ph, '[data-testid="side-nav"]');
  const hqMain = await box(ph, '[data-testid="hq-main"]');
  check('C1 본사 사이드바가 있다', !!hqSide);
  const hqKeys = await ph.$$eval('[data-testid^="nav-/hq"]', (els) => els.map((e) => e.getAttribute('data-testid')));
  check('C2 5메뉴가 다 있다', hqKeys.length === 5, hqKeys.join(' '));
  check('C3 본문에 폭 캡이 없다(넓은 웹 전용)', !!hqMain && hqMain.w > 720, hqMain ? `${hqMain.w}px` : '본문 없음');
  check('C4 폰 프레임(460)을 쓰지 않는다', !(await capColumn(ph)));
  check('C5 하단 탭바가 없다', (await tabBarCount(ph, ['현황', '오늘'])) === 0);
  check('C6 콘솔 에러 0', ph.qaErrors.length === 0, ph.qaErrors.slice(0, 3).join(' | '));
  const occC = await occluded(ph);
  check('C7 가려진 글자 0', occC.length === 0, occC.slice(0, 4).join(' | '));
  for (const [key, title] of [
    ['nav-/hq/stores', '매장'],
    ['nav-/hq/knowhow', '노하우'],
    ['nav-/hq/quizzes', '퀴즈'],
    ['nav-/hq/settings', '설정'],
  ]) {
    await ph.click(`[data-testid="${key}"]`).catch(() => {});
    await ph.waitForTimeout(700);
    const shown = await ph.evaluate(
      (t) => [...document.querySelectorAll('div,span')].some((d) => !d.children.length && (d.textContent ?? '').trim() === t),
      title,
    );
    check(`C8 '${title}' 화면이 열린다`, shown);
  }
  await ph.screenshot({ path: `${SHOTS}/C-hq-settings.png` });
  await ph.close();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 300));
} finally {
  await browser.close();
}

console.log(`\n── 결과 ── pass ${pass} / fail ${fail}   스크린샷: ${SHOTS}`);
process.exit(fail ? 1 : 0);
