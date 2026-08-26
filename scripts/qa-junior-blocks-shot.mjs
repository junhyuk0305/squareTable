// qa-junior-blocks-shot.mjs — 오밀조밀 확산 6-1~6-4(직원 축 4화면) **브라우저 실측 스크린샷**.
//
// 왜 있나: 이번 라운드까지 직원 화면 실측이 0회였다. 게이트(typecheck·lint·래칫)는 화면이 실제로
//   어떻게 보이는지에 대해 아무 말도 하지 않는다 — 빈 화면도 만점을 받는다(2026-08-26).
//
// 실행: node scripts/qa-junior-blocks-shot.mjs   (dev 서버가 8081 에 떠 있어야 한다)
// 계정: 고정 QA 직원 계정(박지원). 새로 만들지 않는다.
// ★dev 번들 파싱이 오래 걸린다 — 스플래시가 걷힌 뒤에 찍는다(아래 waitForBody).
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const __dir = dirname(fileURLToPath(import.meta.url));

const env = {};
for (const line of readFileSync(join(__dir, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const EMAIL = process.env.QA_EMAIL ?? 'staff@pilot.squaretable.app'; // 박지원(직원)
const PW = process.env.QA_PASSWORD ?? 'pilot1234';
const SHOTS = join(__dir, '..', 'qa-shots', 'junior-blocks-v2');
mkdirSync(SHOTS, { recursive: true });

const projectRef = new URL(URL_).hostname.split('.')[0];
const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
const sess = await res.json();
if (!res.ok || !sess.access_token) { console.error('로그인 실패', JSON.stringify(sess).slice(0, 200)); process.exit(2); }

const browser = await chromium.launch();
// ★뷰포트를 3000px 로 키우면 fullPage 스크린샷이 **빈 화면**으로 나온다(2026-08-27 실측) —
//   앱이 flex 로 높이를 채우는 구조라 화면이 뷰포트 밖으로 밀린다. 실제 기기 높이로 잡고
//   fullPage 로 이어 찍는다.
const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(sess)]);

/** 스플래시·로딩이 걷히고 본문이 설 때까지. 빈 화면을 찍지 않기 위한 유일한 방어선이다. */
async function settle(page, mustText) {
  for (let i = 0; i < 90; i += 1) {
    const txt = await page.evaluate(() => document.body.innerText || '');
    const loading = /불러오고 있어요|불러오는 중/.test(txt);
    // ★커버가 덮여 있으면 본문이 DOM 에 있어도 **찍히는 그림은 스플래시**다(2026-08-27 실측:
    //   /hub 가 정확히 이랬다 — 텍스트 검사는 통과하고 스크린샷만 빈 화면이었다).
    // 문구가 아니라 **덮고 있는가**로 본다 — 화면 한가운데 점을 실제로 차지한 요소가
    // 본문인지 커버인지. 커버 문구가 화면마다 달라서(‘매장의 정석’만 뜨는 경우가 있다)
    // 문구 검사로는 6-3 이 스플래시째로 찍혔다(2026-08-27 실측).
    const covered = await page.evaluate(() => {
      // 문서 전체에서 "뷰포트를 거의 다 덮는 상자 + 커버 문구"를 찾는다. 가운데 점의 조상만 훑으면
      // 커버가 다른 서브트리에 있을 때 놓친다(2026-08-27: 6-1 이 그렇게 스플래시째로 찍혔다).
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
    });
    if (!loading && !covered && txt.length > 40 && (!mustText || txt.includes(mustText))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

const shots = [
  { name: '6-1_hub-growth', url: '/hub-growth', must: '성장' },
  { name: '6-2_hub-today', url: '/hub', must: '오늘' },
  { name: '6-3_attendance', url: '/junior/attendance', must: '출근' },
  { name: '6-4_myspace', url: '/junior/chat', must: '물어보기', click: '내 공간' },
];

for (const s of shots) {
  await page.goto(`${ORIGIN}${s.url}`, { waitUntil: 'domcontentloaded' });
  const ok = await settle(page, s.must);
  if (s.click) {
    // RN-web 세그먼트는 Pressable(div) 라 getByRole 로 안 잡힌다 — 정확 일치 텍스트 노드의
    // 조상 중 클릭 핸들러가 걸린 상자를 찾아 dispatchEvent 한다(reference_rnw_browser_qa).
    const done = await page.evaluate((label) => {
      const nodes = [...document.querySelectorAll('div,span')]
        .filter((el) => (el.innerText || '').trim() === label);
      const el = nodes[nodes.length - 1];
      if (!el) return false;
      let t = el;
      for (let i = 0; i < 4 && t; i += 1) {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        t = t.parentElement;
      }
      return true;
    }, s.click);
    if (done) await page.waitForTimeout(3000);
  }
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.screenshot({ path: join(SHOTS, `${s.name}.png`), fullPage: true });
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 180));
  console.log(`${ok ? '✓' : '✗'} ${s.name}  h=${h}  ${txt}`);
}

console.log(errors.length ? `\n콘솔 오류 ${errors.length}건:\n` + [...new Set(errors)].slice(0, 8).join('\n') : '\n콘솔 오류 0건');
await browser.close();
