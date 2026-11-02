/**
 * qa:offline-gates — **읽기 실패가 화면에서 "없어요"로 위장되지 않는가**를 실브라우저로 잰다.
 *
 * 2026-08-25 조용한 오류 감사의 Phase A 인수조건이 이 파일이다:
 *   오프라인 상태에서 6개 화면(허브 현황·업무·채팅·노하우 목록·근무표·출퇴근)이
 *   **"불러오지 못했어요 · 다시 시도"** 를 보여야 하고, **절대 "없어요" 류를 말하면 안 된다.**
 *
 * ★왜 진짜 offline 토글이 아니라 **요청 차단(route.abort)** 인가:
 *   dev 번들은 Chromium 이 100초 넘게 파싱한다(2026-08-26 실측). 부팅부터 오프라인이면
 *   번들·폰트까지 막혀 앱이 아예 안 뜨고, 그러면 **스플래시를 재고 "통과"라고 말하게 된다**
 *   (2026-08-26 에 실제로 그랬다). 그래서 앱을 정상으로 띄운 뒤 **Supabase 호스트만** 끊는다.
 *   제품 입장에서는 백엔드 장애와 구분이 안 되므로 재현 조건으로 충분하다.
 *
 * ★"없어요"가 안 보이는 것만으로는 통과가 아니다 — 재시도 문구가 **실제로 보여야** 통과다.
 *   (빈 화면은 만점이 나온다 — 2026-08-26 교훈.)
 */
import './lib/require-local-target-files.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function env(k) {
  try {
    const t = readFileSync(join(ROOT, '.env'), 'utf8');
    const m = t.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim() : process.env[k];
  } catch { return process.env[k]; }
}
const URL_ = env('EXPO_PUBLIC_SUPABASE_URL');
const ANON = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const EMAIL = process.env.QA_EMAIL ?? 'owner@pilot.squaretable.app';
// 직원 화면(/junior/*)은 직원 고정 계정으로 연다. 사장 세션으로 열면 직원 화면을 재지 못한다.
const JUNIOR_EMAIL = process.env.QA_JUNIOR_EMAIL ?? 'staff2@pilot.squaretable.app';
const PW = process.env.QA_PASSWORD ?? 'pilot1234';
const SHOTS = './qa-shots/offline-gates';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON) { console.error('FAIL: .env 의 SUPABASE URL/ANON 필요'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const projectRef = new URL(URL_).hostname.split('.')[0];
async function session(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`로그인 실패(${email}):${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

/** 이 문구가 보이면 실패다 — 장애를 "데이터 없음"으로 말하고 있다는 뜻. */
const LIE_PHRASES = [
  '없어요', '없습니다', '아직 등록된', '아직 출근 전', '지금 확인할 일이',
];
/** 이 문구가 보여야 통과. */
const TRUTH = '불러오지 못했어요';
const RETRY = '다시 시도';

// 화면마다 그 화면의 주인 세션으로 연다. 세션마다 브라우저 컨텍스트를 따로 둔다(저장소가 섞이지 않게).
const ROLES = [
  { who: '사장', email: EMAIL, boot: '/owner/dashboard', screens: [
    { name: '허브 현황', path: '/hub' },
    { name: '노하우 목록', path: '/owner/knowledge' },
    { name: '근무표', path: '/owner/schedule' },
  ] },
  { who: '직원', email: JUNIOR_EMAIL, boot: '/junior/home', screens: [
    { name: '업무', path: '/junior/work' },
    { name: '채팅(물어보기)', path: '/junior/chat' },
    { name: '출퇴근', path: '/junior/attendance' },
  ] },
];

async function main() {
  const browser = await chromium.launch();
  for (const role of ROLES) await runRole(browser, role);
  await browser.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  console.log(`스크린샷: ${SHOTS}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function runRole(browser, { who, email, boot, screens }) {
  console.log(`\n═══ ${who} 세션(${email}) ═══`);
  const sess = await session(email);
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
  page.setDefaultTimeout(180000);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(sess)]);

  const wait = (t, ms = 240000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const see = (t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
  const tag = who === '사장' ? 'owner' : 'junior';
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${tag}-${n}.png`, fullPage: true }).catch(() => {});

  // ── 1단계: 온라인으로 앱을 완전히 띄운다(번들 파싱 100초+) ──────────────
  console.log('— ① 앱 부팅(온라인) —');
  await page.goto(`${ORIGIN}${boot}`, { waitUntil: 'commit' });
  const booted = await wait('매장', 300000);
  check(`${who} 앱이 떴다(스플래시 통과)`, booted, booted ? '' : '부팅 실패 — 이 세션의 화면 측정은 전부 무효');
  if (!booted) {
    await shot('00-boot-fail');
    // 못 잰 화면을 분모에서 빼지 않는다 — 화면마다 실패로 센다.
    for (const s of screens) check(`${s.name} — 측정 못 함(부팅 실패)`, false);
    await page.close(); return;
  }
  await page.waitForTimeout(1500);
  await shot('01-booted');

  // ── 2단계: Supabase 호스트만 끊는다 = 백엔드 장애 ─────────────────────
  console.log('— ② 백엔드 차단(Supabase 호스트) —');
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes(projectRef) || u.includes('supabase')) return route.abort();
    return route.continue();
  });
  check('차단 규칙 적용', true);

  // ── 3단계: 화면별로 들어가서 무엇을 말하는지 잰다 ──────────────────────
  // 앱 **안에서** 이동한다(주소 직접 입력은 번들을 다시 파싱해 100초를 또 쓴다).
  for (const s of screens) {
    // pushState 로 라우팅 — expo-router 가 클라 라우팅으로 받아 번들 재파싱이 없다.
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, s.path);
    // ★hydrate 정지 방지 타임아웃(HYDRATE_TIMEOUT_MS=15s)보다 **길게** 기다린다.
    //   짧게 기다리면 아직 정상적으로 시도 중인 화면을 "실패했다"고 잘못 잰다 —
    //   하니스가 제품이 아니라 자기 조급함을 재는 것이 된다.
    await page.waitForTimeout(18000);
    const file = `scr-${s.path.replace(/\//g, '_')}`;
    await shot(file);

    const truth = await see(TRUTH);
    const retry = await see(RETRY);
    let lie = null;
    for (const p of LIE_PHRASES) { if (await see(p)) { lie = p; break; } }

    // 통과 조건: 재시도 문구가 **보이고**, 거짓 문구가 **안 보인다**.
    check(`${s.name} — "불러오지 못했어요" 표시`, truth, truth ? '' : `안 보임(스크린샷 ${tag}-${file}.png)`);
    check(`${s.name} — '다시 시도' 버튼`, retry, retry ? '' : '재시도 경로 없음');
    check(`${s.name} — "없어요" 류로 위장하지 않음`, !lie, lie ? `거짓 문구 노출: "${lie}"` : '');
  }
  await page.close();
}

main().catch((e) => { console.error('\n✗ 중단:', e.message); process.exitCode = 1; });
