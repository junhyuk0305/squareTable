// tmp-qa-hub-empty-browser.mjs — 매장 0곳일 때의 역할 분리 + 허브 탭 개방 실브라우저 검증.
//
// 규칙(2026-08-12 사용자 확정): 사장 계정은 매장을 만들고, 직원 계정은 합류만 한다.
//   판정은 profiles.role 이 아니라 **가입 때 고른 역할**(user_metadata.role → session.signupRole).
//   role 은 create_store 성공 후에야 owner 가 되므로(handle_new_user 가 무조건 junior),
//   role 로 가르면 매장 생성 전의 사장이 직원으로 취급된다.
//
// O) 사장으로 가입한 계정 — 매장 만들기가 보이고, create-store 에 닿는다(결제화면으로 새지 않음)
// J) 직원으로 가입한 계정 — 매장 합류만 보이고, create-store URL 직접 진입은 튕긴다
// H) 매장이 없어도 허브 '오늘'·'성장' 탭이 열린다(예전엔 /stores 로 되돌렸다)
//
// 일회용 계정만 쓴다(자가정리). 사용자의 test.owner.0812 계정은 건드리지 않는다.
// 실행: (개발 서버가 떠 있는 상태에서) node scripts/tmp-qa-hub-empty-browser.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const SHOTS = './qa-shots/hub-empty';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const { chromium } = await import('playwright');
const projectRef = new URL(URL_).hostname.split('.')[0];
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const s = String(Date.now()).slice(-7);
const PW = 'QaTest1234!';
const O = { email: `roleown.${s}@example.com`, phone: `0105${s}`, meta: 'owner' };
const J = { email: `rolejun.${s}@example.com`, phone: `0106${s}`, meta: 'junior' };

let pass = 0, fail = 0;
const ok = (n, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); } };

async function makeAccount({ email, phone, meta }) {
  const c = mk();
  const { data, error } = await c.auth.signUp({
    email, password: PW,
    options: { data: { name: meta === 'owner' ? 'QA사장가입' : 'QA직원가입', role: meta, phone, birth_date: '1988-04-04' } },
  });
  if (error || !data.session) throw new Error(`가입 실패 ${email}: ${error?.message ?? 'no session'}`);
  return { uid: data.user.id, session: data.session };
}

let browser;
try {
  console.log(`\n■ 역할 분리 + 허브 개방 QA (origin ${ORIGIN})\n`);
  const accO = await makeAccount(O);
  const accJ = await makeAccount(J);
  O.uid = accO.uid; J.uid = accJ.uid;

  // 두 계정 모두 DB 상으로는 junior 다 — 그래서 role 로는 못 가른다는 것이 이 QA 의 전제다.
  const { data: pO } = await admin.from('profiles').select('role,unit_id').eq('id', O.uid).maybeSingle();
  const { data: pJ } = await admin.from('profiles').select('role,unit_id').eq('id', J.uid).maybeSingle();
  ok('전제: 사장가입·직원가입 계정이 DB 상 똑같이 junior/매장없음',
    pO?.role === 'junior' && !pO?.unit_id && pJ?.role === 'junior' && !pJ?.unit_id,
    `${JSON.stringify(pO)} / ${JSON.stringify(pJ)}`);

  browser = await chromium.launch();
  const errs = [];
  const newPage = async (session) => {
    const page = await browser.newPage({ viewport: { width: 460, height: 1200 } });
    page.setDefaultTimeout(25000);
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);
    return page;
  };
  const waitFor = (pg, t, timeout = 25000) =>
    pg.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const count = (pg, t) => pg.getByText(t, { exact: false }).count().catch(() => -1);
  // 시작 스플래시가 걷힐 때까지 — 안 기다리면 스크린샷이 커버만 찍히고 isVisible 은 겹침을 못 본다.
  const settle = (pg) => pg.getByText('우리 매장 운영의 기준', { exact: false }).first()
    .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  // 겹침까지 보는 가시성 — 중심점의 최상단 요소가 그 요소인지.
  const onTop = (pg, t) => pg.getByText(t, { exact: false }).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (el === top || el.contains(top) || top.contains(el));
  }).catch(() => false);

  // ── O. 사장으로 가입 ───────────────────────────────────────────────
  console.log('\nO) 사장으로 가입한 계정');
  const po = await newPage(accO.session);
  await po.goto(`${ORIGIN}/stores`, { waitUntil: 'domcontentloaded' });
  ok('O1-a 빈 상태 진입', await waitFor(po, '아직 매장이 없어요'));
  await settle(po);
  await po.screenshot({ path: `${SHOTS}/O1-owner-empty.png`, fullPage: true }).catch(() => {});
  ok('O1-b [매장 만들기] 보임 (role=junior 인데도)', await waitFor(po, '매장 만들기', 8000));
  ok('O1-c 덮이지 않음(겹침 검사)', await onTop(po, '매장 만들기'));
  ok('O1-d [매장 합류] 는 없음(경로 하나만)', (await count(po, '매장 합류')) === 0);

  await po.getByText('매장 만들기', { exact: false }).first().dispatchEvent('click');
  ok('O2-a create-store 도달', await waitFor(po, '아직 만들어진 매장이 없어요'), `url=${po.url()}`);
  ok('O2-b /billing 으로 새지 않음', !/\/billing/.test(po.url()), `url=${po.url()}`);

  await po.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
  ok('O3 허브 오늘 탭에서도 [매장 만들기] 안내', await waitFor(po, '매장 만들기', 15000), `url=${po.url()}`);

  // ── J. 직원으로 가입 ───────────────────────────────────────────────
  console.log('\nJ) 직원으로 가입한 계정');
  const pj = await newPage(accJ.session);
  await pj.goto(`${ORIGIN}/stores`, { waitUntil: 'domcontentloaded' });
  ok('J1-a 빈 상태 진입', await waitFor(pj, '아직 매장이 없어요'));
  await settle(pj);
  await pj.screenshot({ path: `${SHOTS}/J1-junior-empty.png`, fullPage: true }).catch(() => {});
  ok('J1-b [매장 합류] 보임', await waitFor(pj, '매장 합류', 8000));
  ok('J1-c ★[매장 만들기] 가 없다(직원은 매장을 못 만든다)', (await count(pj, '매장 만들기')) === 0);

  await pj.goto(`${ORIGIN}/owner/create-store`, { waitUntil: 'domcontentloaded' });
  await pj.waitForTimeout(2500);
  ok('J2 ★create-store URL 직접 진입이 튕긴다', !/create-store/.test(pj.url()), `url=${pj.url()}`);
  await pj.screenshot({ path: `${SHOTS}/J2-blocked.png`, fullPage: true }).catch(() => {});

  // ── H. 매장 없어도 허브 탭이 열리는가 ──────────────────────────────
  console.log('\nH) 매장 0곳에서 허브 탭 개방');
  await pj.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
  ok('H1-a 오늘 탭이 /stores 로 튕기지 않음 ★수정', /\/hub(\?|$)/.test(pj.url()), `url=${pj.url()}`);
  ok('H1-b 빈 상태 안내가 보임', await waitFor(pj, '초대코드로 합류하면', 15000));
  ok('H1-c 다음 행동 버튼이 있음', await waitFor(pj, '매장 합류', 8000));
  await settle(pj);
  await pj.screenshot({ path: `${SHOTS}/H1-hub-today.png`, fullPage: true }).catch(() => {});

  await pj.goto(`${ORIGIN}/hub-growth`, { waitUntil: 'domcontentloaded' });
  ok('H2-a 성장 탭이 튕기지 않음 ★수정', /hub-growth/.test(pj.url()), `url=${pj.url()}`);
  ok('H2-b 빈 상태 안내가 보임', await waitFor(pj, '아직 매장이 없어요', 15000));
  await settle(pj);
  await pj.screenshot({ path: `${SHOTS}/H2-hub-growth.png`, fullPage: true }).catch(() => {});

  ok('콘솔 에러 0', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.error('\n✗ 예외:', e.message);
} finally {
  try { if (browser) await browser.close(); } catch { /* noop */ }
  try {
    for (const email of [O.email, J.email]) {
      const c = mk();
      const r = await c.auth.signInWithPassword({ email, password: PW });
      if (!r.error) await c.rpc('delete_my_account');
    }
    console.log('\n  · 자가정리 완료(계정 2개 삭제)');
  } catch (e) { console.log('  (정리 일부 실패:', e.message, ')'); }
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 통과 ${pass} / 실패 ${fail}`);
  console.log(`   스크린샷: ${SHOTS}/`);
  process.exitCode = fail === 0 ? 0 : 1;
}
