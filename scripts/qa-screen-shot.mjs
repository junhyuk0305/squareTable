// qa-screen-shot.mjs — **아무 화면이나** 고정 QA 계정으로 열어 스크린샷 + 레이아웃 실측 + 콘솔 오류를 남긴다.
//
// 왜 있나: 게이트(typecheck·lint·래칫)는 화면이 실제로 어떻게 보이는지 아무 말도 하지 않는다 —
//   빈 화면도 만점을 받는다(2026-08-26). qa-junior-blocks-shot.mjs(직원 4화면 전용)를 일반화한 것.
//
// 실행:
//   node scripts/qa-screen-shot.mjs --as owner --url /owner/work --name work
//   node scripts/qa-screen-shot.mjs --as junior --url /junior/chat --name myspace --click "내 공간"
//   node scripts/qa-screen-shot.mjs --as owner --url /owner/categories?seg=todo --name todo --out qa-shots/sweep
// 옵션: --as owner|manager|junior (김영자 / 박지원 / 이수민 · 비번 공통 pilot1234)
//       --click "정확한 글자"  (RN-web Pressable 은 role 이 없어 텍스트 노드로 잡는다. 여러 번 가능)
//       --must "글자"          (이 글자가 뜰 때까지 기다린다)
//       --out 디렉터리          (기본 qa-shots/sweep)
//       --scroll               (풀페이지 대신 스크롤 위치 3곳을 따로 찍는다 — 긴 화면)
// dev 서버가 8081 에 떠 있어야 한다(QA_ORIGIN 으로 바꿀 수 있다).
// ★Git Bash 는 `--url /owner/work` 를 Windows 경로로 바꿔 넘긴다(MSYS) — 아래에서 되돌리므로 PS·Bash 둘 다 그대로 실행하면 된다.
// ★스플래시·커버가 걷힌 뒤에 찍는다 — "뷰포트를 덮는 상자 + 커버 문구"가 사라질 때까지 기다린다.
// ★뷰포트 높이를 3000 으로 키우면 앱이 flex 로 높이를 채우는 구조라 빈 화면이 찍힌다 — 900 고정.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const __dir = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const clicks = args.flatMap((a, i) => (a === '--click' ? [args[i + 1]] : []));

const AS = opt('as', 'owner');
// ★Git Bash(MSYS)는 `--url /owner/work` 를 `C:/Program Files/Git/owner/work` 로 바꿔 넘긴다(exit 127, 무출력).
//   드라이브 문자+Git 루트 접두를 벗겨 라우트 경로로 되돌린다(PowerShell 에선 원문 그대로 통과).
const URLPATH = opt('url', '/').replace(/\\/g, '/').replace(/^[A-Za-z]:\/(?:[^/]+\/)*?Git\//, '/');
const NAME = opt('name', URLPATH.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root');
const MUST = opt('must', '');
const OUT = join(__dir, '..', opt('out', 'qa-shots/sweep'));
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const ACCOUNTS = {
  owner: 'owner@pilot.squaretable.app',    // 김영자(사장)
  manager: 'staff@pilot.squaretable.app',  // 박지원(매니저 권한 직원)
  junior: 'staff2@pilot.squaretable.app',  // 이수민(직원)
};
const EMAIL = ACCOUNTS[AS];
if (!EMAIL) { console.error(`--as 는 owner|manager|junior 중 하나: ${AS}`); process.exit(2); }
const PW = process.env.QA_PASSWORD ?? 'pilot1234';
mkdirSync(OUT, { recursive: true });

const env = {};
for (const line of readFileSync(join(__dir, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const projectRef = new URL(URL_).hostname.split('.')[0];

const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
const sess = await res.json();
if (!res.ok || !sess.access_token) { console.error('로그인 실패', JSON.stringify(sess).slice(0, 200)); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(sess)]);

/** 커버(스플래시·매장 진입)가 실제로 화면을 덮고 있는가 — 문구가 아니라 "덮고 있는가"로 본다. */
const COVERED = () => {
  const visible = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (Number(cs.opacity) === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    return true;
  };
  return [...document.querySelectorAll('div')].some((d) => {
    const t = (d.innerText || '').trim();
    if (!/^매장의 정석/.test(t) || t.length >= 40) return false;
    const r = d.getBoundingClientRect();
    if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) return false;
    return visible(d);
  });
};

async function settle(mustText) {
  for (let i = 0; i < 100; i += 1) {
    const txt = await page.evaluate(() => document.body.innerText || '');
    const loading = /불러오고 있어요|불러오는 중/.test(txt);
    const covered = await page.evaluate(COVERED);
    // 스플래시 카피가 본문에 있으면 아직 걷히는 중이다(onDone 에서 언마운트되므로 확실한 신호). QA-A 실측: 이 조건으로 28장 전부 깨끗.
    const splash = txt.includes('우리 매장 운영의 기준');
    if (!loading && !covered && !splash && txt.length > 40 && (!mustText || txt.includes(mustText))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/** RN-web Pressable(div) 을 텍스트로 누른다 — 정확 일치 노드의 조상 4단까지 click 을 흘린다. */
async function clickText(label) {
  return page.evaluate((label) => {
    const nodes = [...document.querySelectorAll('div,span')].filter((el) => (el.innerText || '').trim() === label);
    // 아이콘 전용 버튼은 글자가 없다 — aria-label 로 한 번 더 찾는다.
    const el = nodes[nodes.length - 1] || document.querySelector(`[aria-label="${label}"]`);
    if (!el) return false;
    let t = el;
    for (let i = 0; i < 4 && t; i += 1) { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); t = t.parentElement; }
    return true;
  }, label);
}

/** 레이아웃 실측 — 사람이 스크린샷으로 놓치는 것(작은 글자·작은 터치·프레임 밖·잘림)을 숫자로 남긴다. */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, docOverflow: Math.max(0, document.documentElement.scrollWidth - vw), smallText: [], smallTaps: [], wide: [], clipped: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const label = (el) => ((el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) || el.tagName.toLowerCase());
  const all = [...document.querySelectorAll('body *')].filter(vis);
  const seen = new Set();
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 본문 15sp 하한 — 글자 노드를 직접 가진 요소만. 10~12px 꼬리표(칩·힌트)는 규칙상 허용이라 13px 미만만 잡는다.
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 12)) {
      const fs = parseFloat(cs.fontSize);
      if (fs < 13 && !seen.has(label(el))) { seen.add(label(el)); out.smallText.push({ t: label(el), px: fs }); }
    }
    // 터치 타깃 48dp
    const role = el.getAttribute('role');
    if ((role === 'button' || role === 'link' || el.tagName === 'BUTTON') && (r.width < 40 || r.height < 40)) {
      out.smallTaps.push({ t: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    if (r.right > vw + 1 || r.left < -1) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden') && p.getBoundingClientRect().right <= vw + 1) { clipped = true; break; }
      }
      if (!clipped) out.wide.push({ t: label(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis') {
      out.clipped.push({ t: label(el), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }
  out.smallTaps = out.smallTaps.slice(0, 12); out.wide = out.wide.slice(0, 8); out.clipped = out.clipped.slice(0, 8); out.smallText = out.smallText.slice(0, 12);
  return out;
};

await page.goto(`${ORIGIN}${URLPATH}`, { waitUntil: 'domcontentloaded' });
const ok = await settle(MUST);
for (const c of clicks) {
  const hit = await clickText(c);
  if (!hit) console.log(`  ✗ 누를 글자를 못 찾음: "${c}"`);
  await page.waitForTimeout(2500);
}
const measure = await page.evaluate(MEASURE);
const bodyText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const base = join(OUT, `${AS}-${NAME}`);
if (flag('scroll')) {
  const h = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
  for (const [i, y] of [0, 800, 1600].entries()) {
    await page.evaluate((y) => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== 'visible'); (s ?? window).scrollTo?.(0, y); if (s) s.scrollTop = y; }, y);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${base}-${i}.png` });
  }
  console.log(`  (scroll) 내용 높이 ${h}`);
} else {
  await page.screenshot({ path: `${base}.png`, fullPage: true });
}
writeFileSync(`${base}.json`, JSON.stringify({ as: AS, url: URLPATH, ok, clicks, errors: [...new Set(errors)], measure, text: bodyText.slice(0, 20000) }, null, 1), 'utf8');

console.log(`${ok ? '✓' : '✗ (본문이 안 섰다)'} ${AS} ${URLPATH} → ${base}.png`);
console.log(`  텍스트: ${bodyText.slice(0, 160)}`);
console.log(`  실측: 가로넘침 ${measure.docOverflow}px · 작은글자 ${measure.smallText.length} · 작은터치 ${measure.smallTaps.length} · 프레임밖 ${measure.wide.length} · 잘림 ${measure.clipped.length}`);
if (measure.smallText.length) console.log('  작은글자:', measure.smallText.map((s) => `${s.px}px "${s.t}"`).join(' | '));
if (measure.smallTaps.length) console.log('  작은터치:', measure.smallTaps.map((s) => `${s.w}×${s.h} "${s.t}"`).join(' | '));
if (measure.wide.length) console.log('  프레임밖:', measure.wide.map((s) => `"${s.t}" ${s.left}~${s.right}`).join(' | '));
console.log(errors.length ? `  콘솔 오류 ${errors.length}건:\n    ` + [...new Set(errors)].slice(0, 6).join('\n    ') : '  콘솔 오류 0건');
await browser.close();
