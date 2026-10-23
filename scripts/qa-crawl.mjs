// qa-crawl.mjs — 범용 오라클 크롤러(2026-10-17 메가프롬프트_오류탐지_범용오라클 §2).
//
//   npm run qa:crawl                       (개발 서버 http://localhost:8081 · QA_ORIGIN 으로 바꾼다)
//   npm run qa:crawl -- --update-baseline  (이번 FAIL 목록을 scripts/qa-crawl-baseline.json 에 저장 · 래칫)
//   npm run qa:crawl -- --routes=/owner/dashboard,/junior/home --role=owner   (부분 재실행)
//   ★Git Bash 에서는 `MSYS_NO_PATHCONV=1` 을 앞에 붙인다 — "/owner/…" 가 C:/Program Files/Git/owner/… 로 바뀐다.
//
// 무엇을 하나: 사장·직원 고정 계정 두 세션으로 src/app 의 라우트를 **전부** 열고, 화면마다 같은 규칙 R1~R11
// (scripts/lib/qa-oracles.mjs)만 검사한다. 케이스별 기대값은 적지 않는다 — 그건 여정 하니스(qa-journey-*) 몫.
//   · 라우트 목록은 scripts/ia-snapshot.mjs 와 같은 방식으로 src/app 을 걸어 뽑는다(그 파일은 import 하면 바로 실행되므로 같은 코드를 쓴다).
//   · 역할: /owner/* = 사장 · /junior/* = 직원 · 나머지 = 공용(두 세션 다). 다른 역할의 전용 화면은 R10(역할 경계)만 잰다.
//   · 동적 [id] 는 그 계정이 가진 실제 id(사장 권한 읽기)로 채운다. 없으면 "표본 없음" 으로 적고 건너뛴다(센다).
//   · 쓰기 유발 버튼은 누르지 않는다. 누르는 것은 헤더 '뒤로' 하나(R7). 브라우저 로컬 저장소 플래그만 심는다.
//   · 기준선: 지난 FAIL 은 "알려진" 으로 세고 **새로 생긴 FAIL 만** 앞에 낸다. 새 FAIL 이 있으면 exit 1.
//
// 포트 9373(사장)·9374(직원) — 다른 하니스와 겹치지 않게(join 9333~ · task 9343~ · quiz 9353~ · ai 9363~).
// 뷰포트 460×900(여정 하니스와 같음 · R11 의 460px 프레임).
import './lib/require-local-target.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';
import { FIXED, PW, UNIT, login, ensureActive, restoreActive, rolePrecondition } from './lib/qa-fixed-accounts.mjs';
import { RULES, RULE_TITLES, PROBE, FRAME_PROBE, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11 } from './lib/qa-oracles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없으면 skip */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';
if (!SB || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 필요(.env)'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const UPDATE = !!args['update-baseline'];
const ONLY_ROUTES = typeof args.routes === 'string' ? new Set(args.routes.split(',')) : null;
const ONLY_ROLE = typeof args.role === 'string' ? args.role : null;
const BASELINE = join(ROOT, 'scripts', 'qa-crawl-baseline.json');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });
const STORAGE_KEY = storageKeyFor(SB);
const PORT = { owner: 9373, junior: 9374 };
const VIEW = { width: 460, height: 900 };
const MAX_SHOTS = 20;

// ── 라우트 발견 — ia-snapshot.mjs 의 walk·filter 와 같다 ─────────────────────
const walk = (dir, base = '') => {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') out.push(...walk(p, `${base}/${e}`)); continue; }
    if (e.endsWith('.tsx')) out.push(`${base}/${e}`);
  }
  return out;
};
const ROUTES = walk(join(ROOT, 'src', 'app'))
  .filter((rel) => !/\/(_layout|\+html)\.tsx$/.test(rel))
  .map((rel) => rel.replace(/\.tsx$/, '').replace(/\/index$/, '') || '/')
  .sort();
const roleOf = (route) => (route.startsWith('/owner') ? 'owner' : route.startsWith('/junior') ? 'junior' : 'common');

// ── 세션(고정 계정 · 계정 신설 없음) ─────────────────────────────────────────
async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}
const clients = { owner: await login(SB, ANON, FIXED.owner), junior: await login(SB, ANON, FIXED.junior) };
const pre = await rolePrecondition(clients);
if (pre) { console.error(`FAIL: 전제 불일치 — ${pre}`); process.exit(2); }
const prevActive = { owner: await ensureActive(clients.owner), junior: await ensureActive(clients.junior) };
const sessions = { owner: await passwordSession(FIXED.owner), junior: await passwordSession(FIXED.junior) };

// ── 동적 세그먼트 표본 — 사장 권한 읽기(RLS)로 store_001 의 실제 id 하나 ─────────
async function pick(q) {
  const { data, error } = await q;
  if (error) { console.log(`  · 표본 조회 실패(${error.message.slice(0, 60)})`); return null; }
  return data?.[0] ?? null;
}
const O = clients.owner;
const legalKeys = [...readFileSync(join(ROOT, 'src/app/legal/[doc].tsx'), 'utf8').matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
const nowIso = new Date().toISOString();
const SAMPLE = {
  '/owner/edit/[id]': { id: (await pick(O.from('playbook_entries').select('id').eq('unit_id', UNIT).limit(1)))?.id },
  '/owner/quiz/[id]': { id: (await pick(O.from('training_courses').select('id').eq('unit_id', UNIT).limit(1)))?.id },
  '/owner/timesheet/[staffId]': { staffId: (await pick(O.from('unit_members').select('user_id').eq('unit_id', UNIT).eq('role', 'junior').limit(1)))?.user_id },
  '/owner/quiz/guest/[sub]': { sub: (await pick(O.from('quiz_attempts').select('submission_id').eq('unit_id', UNIT).not('guest_name', 'is', null).not('submission_id', 'is', null).limit(1)))?.submission_id },
  '/legal/[doc]': { doc: legalKeys[0] },
  '/q/[token]': { token: (await pick(O.from('quiz_links').select('token').eq('unit_id', UNIT).is('revoked_at', null).gt('expires_at', nowIso).limit(1)))?.token },
  // /hq/*/[id] — 고정 계정 둘 다 본사 담당자가 아니다 → 표본 없음(본사 화면은 qa:hq-structure 가 잰다).
  '/+not-found': { path: '/qa-crawl-missing-route' },
};
function resolvePath(route) {
  if (route === '/+not-found') return SAMPLE[route].path;
  if (!/\[/.test(route)) return route;
  const s = SAMPLE[route];
  let ok = true;
  const p = route.replace(/\[(\w+)\]/g, (_, k) => { if (!s?.[k]) ok = false; return encodeURIComponent(s?.[k] ?? ''); });
  return ok ? p : null;
}

// ── 브라우저 ─────────────────────────────────────────────────────────────────
// fetch 를 감싸 ≥400 응답을 모은다(여정 하니스와 같은 방식 — cdp.mjs 는 응답 상태를 노출하지 않는다).
// 첫 사용 안내(직원 환영 코치 `sqt.juniorCoachSeen` · 화면 가이드 팝업 `sqt.tour.v1`)는 로컬 플래그라 미리 심는다 —
// seedSession 이 문서마다 localStorage 를 비워 매 화면 다시 뜨고, 덮개가 버튼을 가리면 R2 가 전부 '가려짐' 이 된다(10-17 1차 실측).
// 가이드 id 는 src/lib/guides/guideContent.ts 에서 읽는다(손으로 베끼지 않음).
const GUIDE_IDS = [...new Set([...readFileSync(join(ROOT, 'src/lib/guides/guideContent.ts'), 'utf8').matchAll(/'([a-z]+_[a-z_]+_v\d+)'/g)].map((m) => m[1]))];
const TOUR_SEEN = JSON.stringify(Object.fromEntries(GUIDE_IDS.map((id) => [id, true])));
const INJECT = `(()=>{try{localStorage.setItem('sqt.juniorCoachSeen','1');localStorage.setItem('sqt.tour.v1',${JSON.stringify(TOUR_SEEN)});
window.__qaPop=0;window.addEventListener('popstate',()=>{window.__qaPop++;});
const of=window.fetch;window.__qaBad=[];window.fetch=async(...a)=>{const r=await of(...a);try{if(r.status>=400)window.__qaBad.push(r.status+' '+String(a[0]&&a[0].url||a[0]).replace(/\\?.*/,'').slice(-70));}catch(e){}return r;};}catch(e){}})()`;
async function open(role) {
  const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, ...VIEW, port: PORT[role] });
  await w.page.seedSession(sessions[role]);
  await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  w.page.errSeen = 0;
  return w;
}
// 안정 = 글자가 있고 · ScreenLoading(progressbar) 없음 · 진입 스플래시(SplashAnimation: '매장의 정석'+'우리 매장 운영의 기준' 덮개) 걷힘.
const SETTLED = `(()=>{const b=document.body;if(!b)return false;const t=(b.innerText||'').trim();if(!t.length)return false;if(document.querySelector('[role="progressbar"]'))return false;if(/우리 매장 운영의 기준/.test(t)||t.replace(/\\s+/g,'')==='매장의정석')return false;return true;})()`;
const frame = (page) => page.eval(FRAME_PROBE).catch(() => null);
async function drain(page) {
  const errs = page.errors.slice(page.errSeen);
  page.errSeen = page.errors.length;
  let bad = [];
  try { bad = (await page.eval('(window.__qaBad||[]).splice(0)')) ?? []; } catch { /* 이동 중 */ }
  // 개발 서버 소스맵·HMR 잡음은 제품 오류가 아니다.
  return { errs: errs.filter((e) => !/sourcemap|HMR|\[Fast Refresh\]/i.test(e)), bad };
}

// ── 결과 모으기 ──────────────────────────────────────────────────────────────
const results = [];   // { route, role, path, landed, mode, rules: {R1:{status,detail}}, sample }
let shots = 0;
const mark = { pass: '✓', fail: '✗', warn: '△', skip: '–' };
function line(r) {
  const cells = RULES.map((k) => `${k}${mark[r.rules[k]?.status ?? 'skip']}`).join(' ');
  const details = RULES.filter((k) => r.rules[k]?.status === 'fail' || r.rules[k]?.status === 'warn')
    .map((k) => `${k}: ${r.rules[k].detail.slice(0, 3).join('; ')}${r.rules[k].detail.length > 3 ? ` (+${r.rules[k].detail.length - 3})` : ''}`);
  const landed = r.landed && r.landed !== r.path ? ` →${r.landed}` : '';
  console.log(`${r.route} · ${r.role}${landed} · ${cells}${details.length ? ` · ${details.join(' | ')}` : ''}${r.shot ? ` · ${r.shot}` : ''}`);
}

/** 한 화면 방문. mode 'full' = 11규칙 · 'boundary' = R1+R10 만(다른 역할의 전용 화면). */
async function visit(page, role, route, mode) {
  const path = resolvePath(route);
  const r = { route, role, path, mode, rules: {} };
  if (!path) { r.noSample = true; results.push(r); console.log(`${route} · ${role} · 표본 없음`); return; }
  await drain(page);
  await page.goto(path);
  // 진입 직후 프레임 샘플(약 100ms 간격 · 2.4초) — R9 스침 · R10 다른 역할 화면 노출.
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2400) { const f = await frame(page); if (f) frames.push(f); await sleep(60); }
  await page.waitFor(SETTLED, 20000);
  await sleep(3000);
  const { errs, bad } = await drain(page);
  r.rules.R1 = r1(errs, bad);
  const other = role === 'owner' ? '/junior' : '/owner';
  const snap = await page.eval(PROBE).catch((e) => ({ error: e.message }));
  r.landed = snap.path ?? (await page.path().catch(() => '?'));
  if (mode === 'boundary' || roleOf(route) !== 'common') r.rules.R10 = r10({ forbidden: other, frames, finalPath: r.landed });
  if (mode === 'full') {
    if (snap.error) {
      for (const k of ['R2', 'R3', 'R4', 'R5', 'R6', 'R8', 'R11']) r.rules[k] = { status: 'fail', detail: [`스냅샷 실패: ${snap.error.slice(0, 80)}`] };
    } else {
      r.rules.R2 = r2(snap); r.rules.R3 = r3(snap); r.rules.R4 = r4(snap); r.rules.R5 = r5(snap.text);
      r.rules.R6 = r6(snap); r.rules.R8 = r8(snap); r.rules.R11 = r11(snap);
      r.rules.R9 = r9(frames, snap.text);
    }
    // R7 — 헤더 '뒤로' 가 보이면 그것, 아니면 브라우저 뒤로. 직전 방문 화면이 history 의 바로 앞 항목이다.
    const before = r.landed;
    const hasBack = !snap.error && snap.clickables.some((c) => c.back && !c.zero && !c.off && !c.covered);
    let how = hasBack ? '헤더' : '브라우저';
    // 움직였다 = 경로가 바뀜 · 또는 문서가 새로 떴음(표식 사라짐) · 또는 popstate 가 옴.
    //   같은 경로로 돌아가는 뒤로(두 라우트가 같은 착지로 redirect 된 뒤)는 경로만 보면 '안 움직임' 으로 보인다(10-17 1차 /hq 오탐).
    await page.eval('window.__qaMark=1;window.__qaPop=0').catch(() => {});
    try {
      if (hasBack) await page.click('[aria-label="뒤로"]');
      else await page.back();
    } catch (e) {
      // 누르자마자 문서가 통째로 바뀌면 CDP 가 'Inspected target navigated' 로 던진다 — 그건 움직인 것이다. 그 밖의 실패만 브라우저 뒤로로 대신한다.
      if (!/navigated/i.test(e.message)) { how = `헤더(누르기 실패: ${e.message.slice(0, 40)})`; await page.back().catch(() => {}); }
    }
    const moved = await page.waitFor(`location.pathname !== ${JSON.stringify(before)} || !window.__qaMark || window.__qaPop > 0`, 3000);
    let after = before;
    let dead = false;
    if (moved) {
      await page.waitFor(SETTLED, 8000);
      const f = await frame(page);
      after = f?.path ?? '?';
      dead = !f || (f.buttons === 0 && f.textLen < 10);
    }
    r.rules.R7 = r7({ before, after, stuck: !moved, dead, how });
  }
  const failed = RULES.some((k) => r.rules[k]?.status === 'fail');
  if (failed && shots < MAX_SHOTS) {
    shots++;
    r.shot = `tmp/qa-crawl-${shots}.png`;
    // R7 뒤에는 이미 다른 화면이다 — 실패 화면을 다시 열어 찍는다.
    try { await page.goto(path); await page.waitFor(SETTLED, 15000); await sleep(1500); await page.shot(join(ROOT, r.shot)); } catch { r.shot += '(실패)'; }
  }
  results.push(r);
  line(r);
}

async function runRole(role) {
  const { page, close } = await open(role);
  try {
    await page.goto(role === 'owner' ? '/owner/dashboard' : '/junior/home');
    await page.waitFor(SETTLED, 30000);
    await sleep(1500);
    for (const route of ROUTES) {
      if (ONLY_ROUTES && !ONLY_ROUTES.has(route)) continue;
      const rr = roleOf(route);
      const mode = rr === 'common' || rr === role ? 'full' : 'boundary';
      try { await visit(page, role, route, mode); }
      catch (e) { results.push({ route, role, path: resolvePath(route), mode, rules: { R1: { status: 'fail', detail: [`크롤러 예외: ${e.message.slice(0, 120)}`] } } }); console.log(`${route} · ${role} · 예외 ${e.message.slice(0, 120)}`); }
    }
  } finally {
    await close();
  }
}

console.log(`라우트 ${ROUTES.length}(사장 ${ROUTES.filter((r) => roleOf(r) === 'owner').length} · 직원 ${ROUTES.filter((r) => roleOf(r) === 'junior').length} · 공용 ${ROUTES.filter((r) => roleOf(r) === 'common').length}) · 뷰포트 ${VIEW.width}×${VIEW.height} · ${ORIGIN}`);
console.log(`표본: ${Object.entries(SAMPLE).map(([k, v]) => `${k}=${Object.values(v)[0] ? '있음' : '없음'}`).join(' · ')}\n`);
try {
  await Promise.all((ONLY_ROLE ? [ONLY_ROLE] : ['owner', 'junior']).map(runRole));
} finally {
  await restoreActive(clients.owner, prevActive.owner);
  await restoreActive(clients.junior, prevActive.junior);
}

// ── 집계 · 기준선 ───────────────────────────────────────────────────────────
const full = results.filter((r) => !r.noSample);
const noSample = results.filter((r) => r.noSample);
const fails = [];
for (const r of full) for (const k of RULES) if (r.rules[k]?.status === 'fail') fails.push({ key: `${r.role}|${r.route}|${k}`, role: r.role, route: r.route, rule: k, detail: r.rules[k].detail, shot: r.shot });
let known = new Set();
if (existsSync(BASELINE)) known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).fails.map((f) => f.key));
const fresh = fails.filter((f) => !known.has(f.key));

console.log(`\n── 새 FAIL(기준선에 없음) ${fresh.length}${existsSync(BASELINE) ? '' : ' · 기준선 파일 없음(첫 실행 — 전부 새것)'}`);
for (const f of fresh) console.log(`  ✗ ${f.route} · ${f.role} · ${f.rule}: ${f.detail.slice(0, 2).join('; ')}`);

console.log(`\n── 규칙별 FAIL 수 (순회 ${full.length}화면 · 표본 없음 ${noSample.length} · 알려진 ${fails.length - fresh.length} · 새것 ${fresh.length})`);
for (const k of RULES) {
  const n = fails.filter((f) => f.rule === k).length;
  const checked = full.filter((r) => r.rules[k] && r.rules[k].status !== 'skip').length;
  console.log(`  ${k.padEnd(4)} ${String(n).padStart(3)} / ${String(checked).padStart(3)}   ${RULE_TITLES[k]}`);
}
console.log(`\n── FAIL 상위 ${Math.min(MAX_SHOTS, fails.length)}건 캡처`);
for (const r of full.filter((x) => x.shot)) console.log(`  ${r.shot}  ${r.route} · ${r.role} · ${RULES.filter((k) => r.rules[k]?.status === 'fail').join(',')}`);
if (noSample.length) console.log(`\n── 표본 없음: ${noSample.map((r) => `${r.route}(${r.role})`).join(', ')}`);

writeFileSync(join(TMP, 'qa-crawl-last.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify({ updatedAt: new Date().toISOString(), fails: fails.map(({ key, detail }) => ({ key, detail: detail.slice(0, 3) })) }, null, 1));
  console.log(`\n기준선 저장: scripts/qa-crawl-baseline.json (${fails.length}건)`);
}
console.log(`\n전체 결과: tmp/qa-crawl-last.json`);
process.exit(fresh.length && !UPDATE ? 1 : 0);
