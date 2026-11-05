#!/usr/bin/env node
// qa-session-load.mjs — 세션 로딩 요청 수 게이트(M3 · 2026-11-05 · 계획_M3_세션로딩.md §4 ③).
//   고정 계정 사장(owner@) 실세션을 브라우저에 심고 CDP 로 /rest/v1/rpc/ POST 를 세어 "세션 로드가 몇 번 도는가"를 잰다.
//   ① 콜드 부팅(첫 화면 착지까지) rpc POST ≤3 · 그 안에 session_bootstrap 있음 · session_bootstrap 에 ≥400 응답 없음(배포 순서 보증 = §5-1 권장 B)
//   ② 유휴 3분(--quick 40초) 동안 session_bootstrap ≤2 (폴링 120초 → 1회 + 여유 1회)
//   ③ document.hidden → visible 1회에 session_bootstrap ≤1 (auth-js SIGNED_IN 재발화 + useForegroundRefresh 가 soft 로 합쳐져야 한다)
//
//   node scripts/qa-session-load.mjs [--quick]   (개발 서버 http://localhost:8081 · QA_ORIGIN 으로 바꾼다 · .env 필요 · 라이브는 --allow-remote)
//
// 포트 9346(다른 하니스: 9333~9335 join · 9343~9345 task). 쓰기 없음 · 끝에 심은 세션만 로그아웃.
// ★건너뛴 단언은 통과로 세지 않는다 — hidden 토글이 안 먹히면 ③ 은 skip 으로 따로 센다. 마지막 줄 GREEN/RED · pass n / fail n / skip n.
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW } from './lib/qa-fixed-accounts.mjs';

const QUICK = process.argv.includes('--quick');
const IDLE_MS = QUICK ? 40_000 : 180_000;
const IDLE_LABEL = QUICK ? '40초(--quick)' : '3분';
const HIDDEN_MS = 35_000; // useForegroundRefresh 가 "30초 넘게 뒤" 일 때만 도므로 그 경계를 넘긴다.
const PORT = 9346;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
} catch { /* 없으면 셸 env 만 */ }
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';
if (!SB || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY(.env) 필요'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

let pass = 0;
let fail = 0;
let skip = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n, extra ? `— ${extra}` : ''); } else { fail++; console.log('  ✗', n, extra); }
};
const skipCheck = (n, why) => { skip++; console.log('  ○', n, `— skip: ${why}`); };
const section = (t) => console.log(`\n── ${t}`);
const info = (t) => console.log('  ·', t);

async function sessionOf(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: PW }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}
async function logout(session) {
  await fetch(`${SB}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` } }).catch(() => {});
}

// fetch 를 감싸 ≥400 응답을 모은다(cdp.mjs 는 응답 상태를 노출하지 않는다). 전면 무료 공지 모달은 본 것으로 둔다(qa-journey-join 과 같다).
const INJECT = `(()=>{try{const of=window.fetch;window.__qaBad=[];window.fetch=async(...a)=>{const r=await of(...a);try{if(r.status>=400)window.__qaBad.push(r.status+' '+String(a[0]&&a[0].url||a[0]).replace(/\\?.*/,'').slice(-80));}catch(e){}return r;};localStorage.setItem('sqt.notice.free-until.v3','1');}catch(e){}})()`;

const bootstraps = (list) => list.filter((n) => n === 'session_bootstrap').length;
/** document.hidden/visibilityState 를 인스턴스 접근자로 덮고 visibilitychange 를 쏜다.
 *  auth-js(_onVisibilityChanged)·RN-web AppState 둘 다 document.visibilityState 를 읽으므로 이것으로 "탭을 뒤로 보냈다/돌아왔다"가 된다.
 *  Page.setWebLifecycleState('frozen') 은 JS 자체를 멈춰 '뒤에 있던 시간'이 0 으로 잡힐 수 있어 쓰지 않는다. */
const setHidden = (page, hidden) => page.eval(`(()=>{try{
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>${hidden}});
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>${hidden ? "'hidden'" : "'visible'"}});
  document.dispatchEvent(new Event('visibilitychange'));
  return document.visibilityState;
}catch(e){return 'error:'+e.message}})()`);

console.log(`세션 로딩 요청 수 · ${FIXED.owner} · ${ORIGIN} · 유휴 ${IDLE_LABEL}`);
const session = await sessionOf(FIXED.owner);
const { page, close } = await launch({ origin: ORIGIN, storageKey: storageKeyFor(SB), width: 460, height: 900, port: PORT });
let code = 0;
try {
  await page.seedSession(session);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  // ── ① 콜드 부팅 ──────────────────────────────────────────────────────────
  section('① 콜드 부팅 → 첫 화면 착지까지 rpc POST 수');
  const t0 = Date.now();
  await page.goto('/');
  const landed = await page.waitFor(`(location.pathname.startsWith('/owner/') || location.pathname === '/hub') && document.body.innerText.trim().length > 20`, 40_000);
  const landMs = Date.now() - t0;
  const atLanding = page.requests.slice();
  await sleep(3000); // 착지 뒤 늦게 오는 요청(레이아웃 hydrate)은 예산에 안 넣고 참고로만 남긴다.
  const afterSettle = page.requests.slice();
  let bad = [];
  try { bad = (await page.eval('(window.__qaBad||[]).slice()')) ?? []; } catch { /* 이동 중 */ }
  info(`착지 ${landed ? '' : '실패 · '}${await page.path()} · ${landMs}ms · 착지까지 rpc ${atLanding.length}건 [${atLanding.join(', ')}] · +3초 뒤 ${afterSettle.length}건`);
  if (bad.length) info(`≥400 응답 ${bad.length}건: ${bad.slice(0, 5).join(' | ')}`);
  check('①-a 첫 화면 착지(/owner/* 또는 /hub · ≤40초)', landed, `${landMs}ms`);
  // 예산은 **세션 로드 RPC** 만 센다 — 착지 뒤 레이아웃·대시보드가 부르는 화면 데이터 rpc(owner_overview 등)는 M3 범위 밖이라
  // 참고(info)로만 남긴다(2026-11-05 로컬 실측: 전체 10건 중 세션 1건). 옛 직렬 로드는 이 집합에서 8~9건이 나와 RED 가 된다.
  const SESSION_RPCS = new Set(['session_bootstrap', 'session_unit', 'my_units', 'my_seat_locked', 'my_unit_locked', 'my_brand', 'needs_downgrade_choice', 'billing_free_mode', 'iap_enabled']);
  const sessionAtLanding = atLanding.filter((n) => SESSION_RPCS.has(n));
  check('①-b 착지까지 세션 로드 rpc ≤3 [건]', sessionAtLanding.length <= 3, `${sessionAtLanding.length}건 [${sessionAtLanding.join(', ')}] · 전체 rpc ${atLanding.length}건`);
  check('①-c 그 안에 session_bootstrap 있음', atLanding.includes('session_bootstrap'), atLanding.includes('session_bootstrap') ? '' : '없음(옛 직렬 로드?)');
  check('①-d session_bootstrap ≥400 응답 0건(마이그레이션 미적용이면 404)', !bad.some((b) => b.includes('rpc/session_bootstrap')), bad.filter((b) => b.includes('rpc/session_bootstrap')).join(' | '));

  // ── ② 유휴 ──────────────────────────────────────────────────────────────
  section(`② 유휴 ${IDLE_LABEL} 동안 세션 로드 수`);
  const idleIdx = page.requests.length;
  const idleStart = Date.now();
  await sleep(IDLE_MS);
  const idleReqs = page.requests.slice(idleIdx);
  info(`유휴 ${Math.round((Date.now() - idleStart) / 1000)}초 · rpc ${idleReqs.length}건 [${idleReqs.join(', ') || '없음'}]`);
  check(`②   유휴 ${IDLE_LABEL} 동안 session_bootstrap ≤2 [건]`, bootstraps(idleReqs) <= 2, `${bootstraps(idleReqs)}건`);

  // ── ③ hidden → visible ───────────────────────────────────────────────────
  section(`③ 탭을 뒤로(${HIDDEN_MS / 1000}초) → 앞으로 1회에 세션 로드 수`);
  const hid = await setHidden(page, true);
  if (hid !== 'hidden') {
    skipCheck('③   hidden→visible 1회에 session_bootstrap ≤1', `visibilityState 를 hidden 으로 못 바꿈(${hid})`);
  } else {
    await sleep(HIDDEN_MS);
    const fgIdx = page.requests.length;
    const vis = await setHidden(page, false);
    await sleep(6000);
    const fgReqs = page.requests.slice(fgIdx);
    info(`복귀(${vis}) 뒤 6초 rpc ${fgReqs.length}건 [${fgReqs.join(', ') || '없음'}]`);
    check('③   hidden→visible 1회에 session_bootstrap ≤1 [건]', bootstraps(fgReqs) <= 1, `${bootstraps(fgReqs)}건`);
  }

  const errs = page.errors;
  info(`콘솔 에러 ${errs.length}건${errs.length ? ` · ${String(errs[0]).split('\n')[0].slice(0, 140)}` : ''}`);
} catch (e) {
  fail++;
  console.log('  ✗ 하니스 예외', e.message);
} finally {
  await close();
  await logout(session);
}

const red = fail > 0;
console.log(`\n${red ? 'RED' : 'GREEN'} pass ${pass} / fail ${fail} / skip ${skip}`);
code = red ? 1 : 0;
process.exit(code);
