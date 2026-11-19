// qa-sheet-web-back.mjs — 웹에서 바텀시트가 열린 채 브라우저 "뒤로"를 누르면 시트만 닫힌다(2026-11-19 B7-5).
//
// 증명하는 것(공용 BottomSheet · pushWebSheetLayer = useWebLeaveGuard 한 곳):
//   ① 시트를 열고 뒤로 → 주소는 그대로(/junior/chat) · 시트는 닫힘. 수정 전에는 앞 화면(/junior/home)으로 넘어갔다.
//   ② 다시 열고 닫기 버튼 → 시트 닫힘 · 주소 그대로 · 기록이 한 칸 넘게 쌓이지 않음(열 때 쌓은 칸을 닫을 때 걷는다).
//   ③ 그다음 뒤로 → 앞 화면(/junior/home)으로 간다. 걷지 못한 칸이 남으면 뒤로를 두 번 눌러야 한다.
//   ④ 빈 화면 아님 · 콘솔 에러 0.
// 수정 전(b297b08 이전) 재현 = ① 두 항목 RED. 수정 후 전부 GREEN.
//
// 시트 = 직원 대화(/junior/chat)의 노하우 출처 "… 원문 보기"(EntryDetailModal → BottomSheet).
//   ★전제: 고정 계정 staff2(store_001) 대화에 출처 달린 답이 하나 이상 있어야 한다(seed-demo). 없으면 FAIL 로 센다.
//
// 실행: node scripts/qa-sheet-web-back.mjs   (개발 서버 QA_ORIGIN 기본 http://localhost:8081 · 로컬 도커 전용)
//   개발 서버는 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 로 띄운다(번들이 로컬 DB 를 보는지 먼저 확인한다).
// ★로컬 전용: 키는 `supabase status` 에서만 읽고 주소가 127.0.0.1 이 아니면 멈춘다. --allow-remote 길은 없다.
// ★AI 호출 0회 · 엣지 안 씀 · 쓰기 0건(읽기·화면 조작만) · 고정 계정 브라우저라 여정 하니스(qa:core·qa:crawl)와 동시에 돌리지 않는다.
// 마지막 줄: GREEN|RED — pass n · fail n
import { localEnv, assertLocalUrl, assertAppTargetsLocal } from './qa-local-target.mjs';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW } from './lib/qa-fixed-accounts.mjs';

if (process.argv.includes('--allow-remote')) { console.error('중단: 이 하니스는 로컬 도커 전용이다(--allow-remote 없음).'); process.exit(2); }
const env = localEnv();
const SB = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
assertLocalUrl(SB);
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요`); process.exit(2); }
await assertAppTargetsLocal(ORIGIN, SB);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { if (ok) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); } };

const SHEET_BTN = '[aria-label$="원문 보기"]';
const sheetOpen = `!!document.querySelector('[aria-modal="true"]') && /닫기/.test([...document.querySelectorAll('[aria-modal="true"] [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' '))`;

const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: FIXED.junior, password: PW }),
});
const sess = await res.json();
if (!res.ok || !sess.access_token) { console.error(`FAIL: ${FIXED.junior} 로그인 실패 — seed-demo 먼저`); process.exit(2); }

const { page, close } = await launch({ origin: ORIGIN, storageKey: storageKeyFor(SB), width: 460, height: 900, port: 9342 });
const openSheet = async () => { await page.click(SHEET_BTN); return page.waitFor(sheetOpen, 8000); };
try {
  await page.seedSession(sess);
  await page.goto('/junior/home');
  // ★dev 번들 첫 파싱이 길다 — 홈이 그려지기 전에는 아무것도 재지 않는다.
  await page.waitFor(`document.body.innerText.length>80 && !/불러오/.test(document.body.innerText)`, 240000);
  await sleep(3000);
  // 첫 사용 안내가 떠 있으면 닫는다(시트 판정에 섞이지 않게).
  for (let i = 0; i < 8; i++) {
    const has = await page.eval(`(()=>{const d=[...document.querySelectorAll('div')].reverse().find(d=>['알겠어요, 시작할게요','건너뛰기','닫기','확인'].includes(d.innerText.trim()));if(d){d.setAttribute('data-qa','guide-ok');return true}return false})()`);
    if (!has) break;
    await page.click('[data-qa="guide-ok"]').catch(() => {});
    await sleep(1200);
  }
  await page.goto('/junior/chat'); // 앞 기록 = /junior/home
  await page.waitFor(`location.pathname==='/junior/chat'`, 15000);
  const hasBtn = await page.waitFor(`!!document.querySelector('${SHEET_BTN}')`, 30000);
  check('전제: 대화에 "원문 보기" 출처가 있다', hasBtn, hasBtn ? '' : 'staff2 대화에 출처 달린 답이 없다(seed-demo)');
  if (hasBtn) {
    await sleep(1500);
    const len0 = await page.eval('history.length');

    console.log('\n── ① 시트 열고 뒤로');
    check('①-0 시트 열림', await openSheet());
    await page.back();
    await sleep(2500);
    const p1 = await page.eval('location.pathname').catch(() => '?');
    check('①-1 뒤로 → 주소 그대로(/junior/chat)', p1 === '/junior/chat', p1);
    check('①-2 뒤로 → 시트 닫힘', !(await page.eval(sheetOpen)));

    if (p1 === '/junior/chat') {
      console.log('\n── ② 다시 열고 닫기 버튼');
      check('②-0 다시 열림', await openSheet());
      await page.click('[aria-modal="true"] [aria-label="닫기"]').catch(() => {});
      await page.waitFor(`!(${sheetOpen})`, 5000);
      await sleep(1200);
      check('②-1 닫기 → 시트 닫힘 · 주소 그대로', !(await page.eval(sheetOpen)) && (await page.path()) === '/junior/chat');
      const len1 = await page.eval('history.length');
      check('②-2 닫기 → 남은 기록 없음', len1 <= len0 + 1, `처음 ${len0} · 지금 ${len1}`);

      console.log('\n── ③ 그다음 뒤로');
      await page.back();
      await sleep(2500);
      await page.waitFor(`document.body.innerText.length>40`, 120000).catch(() => {});
      const p2 = await page.eval('location.pathname').catch(() => '?');
      check('③ 그다음 뒤로 → 앞 화면(/junior/home)', p2 === '/junior/home', p2);
    } else {
      check('②·③ 못 돎(① 에서 화면을 떠남)', false);
    }
  }
  const txt = (await page.text()).length;
  check('④-1 빈 화면 아님', txt > 40, `글자 ${txt}`);
  const errs = page.errors.splice(0);
  check('④-2 콘솔 에러 0', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) {
  fail++;
  console.log('  ✗ 중단:', e.message);
} finally {
  await close();
}
console.log(`\nqa-sheet-web-back: ${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
