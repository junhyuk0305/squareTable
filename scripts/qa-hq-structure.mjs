// qa-hq-structure.mjs — 본사 대시보드 구조 회귀(2026-10-01 R1~R5 · 상태별 매장 수 · 로딩/실패 3분기 · 등장 애니메이션
//   · 2026-10-02 하위 메뉴 개편: 2단 메뉴 · 전체 매장 전체 폭 · 매장 상세 페이지 + 탭 · 초대 대기·배포 상태·설정 분리
//   · 2026-10-02 대시보드 개선(기획/본사대시보드/03 1차): 확인 필요 → 처리할 곳 · 최근 배포 상태 · 숙지율 분모 · 만료 초대).
// K 묶음은 page.mockRpc 로 응답 모양만 바꾼다(요청 매장 1곳·여러 곳, 만료 초대) — 파일럿에 그런 상태가 없어도 잰다. DB 는 안 바꾼다.
//
//   npm run qa:hq-structure            (개발 서버 http://localhost:8081 이 떠 있어야 한다 · QA_ORIGIN 으로 바꾼다)
//
// playwright 없이 설치된 Chrome 을 CDP 로 움직인다(scripts/lib/cdp.mjs). 대상 = 원격 DB · 고정 계정만:
//   본사 hq@pilot.squaretable.app · 점주 owner@pilot.squaretable.app (계정 신설·qa:seed 없음).
// H(상태별 매장 수)만 데이터를 만든다 — 작업실 원본 노하우 1건(qa_hqs_ 접두사)을 store_001 에 배포하고 끝나면 지운다
//   (qa-brand-deploy 와 같은 방식 · service_role 필요 · .env.seed). 연결·공개 수준은 건드리지 않는다.
//
// ★건너뛴 것을 통과로 세지 않는다(AGENTS) — 준비가 안 서서 못 돈 묶음은 fail 로 센다.
// ★쪽 나누기 화면(50곳 넘는 매장)은 원격 파일럿이 2곳이라 화면으로 못 본다. 대신 A 묶음이 서버 정렬을
//   한 줄짜리 쪽으로 받아 이어 붙여 "쪽을 넘겨도 전체 기준"을 잰다. 63곳 화면 실측은 10-01 로컬 리허설에서 했다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { launch, sleep, storageKeyFor } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const f of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없으면 skip */ }
}
const SB = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = env.QA_ORIGIN ?? 'http://localhost:8081';
if (!SB || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 필요(.env)'); process.exit(2); }
try { await fetch(ORIGIN); } catch { console.error(`FAIL: 개발 서버(${ORIGIN})가 안 떠 있어요 — npm run web`); process.exit(2); }

const HQ = 'hq@pilot.squaretable.app';
const OWNER = 'owner@pilot.squaretable.app';
const PW = 'pilot1234';
const UNIT = 'store_001';
const STORAGE_KEY = storageKeyFor(SB);

let pass = 0;
let fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra); }
};
const section = (t) => console.log(`\n── ${t}`);

async function passwordSession(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패`);
  return j;
}
const rpc = async (token, name, body = {}) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};

const hqSession = await passwordSession(HQ);
const ownerSession = await passwordSession(OWNER);

/** 새 브라우저 한 장 — 끝나면 반드시 닫는다(남은 Chrome 이 다음 실행을 붙잡는다). */
async function withPage({ width = 1600, height = 1000, session = hqSession } = {}, fn) {
  const { page, close } = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width, height });
  try {
    await page.seedSession(session);
    return await fn(page);
  } finally {
    await close();
  }
}
const ROWS = (table) => `[...document.querySelectorAll('[data-testid="${table}"] [data-testid^="hq-row-"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.dataset.testid.slice(7))`;
const waitRows = (page, table) => page.waitFor(`${ROWS(table)}.length > 0`, 40000);
const navActive = (page, key) =>
  page.eval(`(()=>{const bg=k=>getComputedStyle(document.querySelector('[data-testid="nav-'+k+'"]')).backgroundColor;return bg(${JSON.stringify(key)})!=='rgba(0, 0, 0, 0)' && bg('/hq/knowhow')==='rgba(0, 0, 0, 0)';})()`);
const detailTitle = (page) =>
  page.eval(`(()=>{const d=document.querySelector('[data-testid="hq-store-detail"]');if(!d||!d.getBoundingClientRect().width)return null;return d.innerText.split('\\n').filter(Boolean).slice(0,2).join(' | ');})()`);
const SEARCH = 'input[aria-label="매장 이름으로 찾기"]';

// ── A. 서버 — 0228 brand_overview_page 경계 ─────────────────────────────────
section('A. 서버 입구(0228) — 경계 · 전체 기준 정렬');
{
  const all = (await rpc(hqSession.access_token, 'brand_overview')).data;
  const page = (await rpc(hqSession.access_token, 'brand_overview_page', { p_limit: 200, p_offset: 0 })).data;
  const strip = (r) => { const { total_count: _a, total_all: _b, ...x } = r; return JSON.stringify(x); };
  check('A1 담당자: 쪽 결과 = brand_overview(행·열·공개 수준별 null 동일)',
    JSON.stringify(page.map(strip).sort()) === JSON.stringify(all.map((r) => JSON.stringify(r)).sort()), `${page.length}/${all.length}`);
  check('A2 total_count = total_all = 연결 매장 수', page.length > 0 && page.every((r) => r.total_count === all.length && r.total_all === all.length));
  const o = await rpc(ownerSession.access_token, 'brand_overview_page', { p_limit: 200, p_offset: 0, p_units: [UNIT] });
  check('A3 담당자 아닌 점주: 자기 매장 id 를 넘겨도 0행(안쪽 p_units 우회 차단)', o.status === 200 && o.data.length === 0, `${o.status}`);
  const a = await rpc(null, 'brand_overview_page', {});
  check('A4 비로그인: 실행 거부', a.status >= 400, String(a.status));
  const m = await rpc(ownerSession.access_token, 'my_brand_mirror');
  check('A5 점주 거울(my_brand_mirror) 그대로', m.status === 200 && Array.isArray(m.data));
  // 한 줄짜리 쪽을 이어 붙이면 전체 정렬과 같아야 한다 — 쪽 안 정렬이면 깨진다.
  const pages = [];
  for (let i = 0; i < all.length; i++) {
    pages.push(...(await rpc(hqSession.access_token, 'brand_overview_page', { p_limit: 1, p_offset: i, p_sort: 'staff', p_desc: true })).data.map((r) => r.unit_id));
  }
  const want = [...all].sort((x, y) => y.staff - x.staff || (x.store_name < y.store_name ? -1 : x.store_name > y.store_name ? 1 : x.unit_id < y.unit_id ? -1 : 1)).map((r) => r.unit_id);
  check('A6 한 줄씩 쪽을 넘겨도 전체 기준 직원 많은 순 · 겹침 0', JSON.stringify(pages) === JSON.stringify(want), `${pages} vs ${want}`);
}

// ── B. 데이터 축(R1) — 화면이 쓰는 것만 받는다 ─────────────────────────────
section('B. 데이터 축 — 셸이 전 매장 요약을 끌고 오지 않는다');
for (const [path, wait] of [['/hq/knowhow/new', '[data-testid="hq-main"]'], ['/hq/stores', '[data-testid="hq-stores-table"]'], [`/hq/stores/${UNIT}`, '[data-testid="hq-store-tabs"]']]) {
  await withPage({}, async (page) => {
    await page.goto(path);
    await page.waitFor(`!!document.querySelector('${wait}')`, 40000);
    await sleep(4000);
    const n = page.requests.filter((r) => r === 'brand_overview').length;
    check(`B ${path}: brand_overview(전 매장) 0회`, n === 0, `${n}회`);
  });
}

// ── C. 라우팅 — 하위 메뉴 · 전체 매장 · 매장 상세 페이지(2026-10-02 개편) ─────────────
section('C. 하위 메뉴 + 전체 매장 + 매장 상세 페이지');
const subActive = (page, key) =>
  page.eval(`(()=>{const e=document.querySelector('[data-testid="subnav-${key}"]');return !!e && e.getAttribute('aria-selected')==='true';})()`);
await withPage({}, async (page) => {
  await page.goto('/hq/stores');
  await waitRows(page, 'hq-stores-table');
  await sleep(1500);
  const ids = await page.eval(ROWS('hq-stores-table'));
  check('C1 전체 매장: 표 보임 · 상세 없음', (await page.visible('[data-testid="hq-stores"]')) && !(await page.visible('[data-testid="hq-store-detail"]')));
  check('C2 아이콘 줄 매장 활성 · 하위 메뉴 전체 매장 활성', (await navActive(page, '/hq/stores')) && (await subActive(page, 'stores-all')));
  check('C3 하위 메뉴 매장 트리 = 표의 매장', await page.waitFor(`!!document.querySelector('[data-testid="hq-tree-${ids[0]}"]')`, 20000));
  const needle = (await page.eval(`document.querySelector('[data-testid="hq-row-${ids[0]}"]').innerText.split('\\n')[0]`)).slice(0, 2);
  await page.type(SEARCH, needle);
  await sleep(1500);
  await waitRows(page, 'hq-stores-table');
  const filtered = await page.eval(ROWS('hq-stores-table'));
  const h0 = await page.eval('history.length');
  await page.click(`[data-testid="hq-row-${filtered[0]}"]`);
  await page.waitFor(`location.pathname === '/hq/stores/${filtered[0]}'`);
  await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]')`, 40000);
  await sleep(800);
  check('C4 행 → /hq/stores/<id> 페이지(목록은 안 보임)', (await page.visible('[data-testid="hq-store-detail"]')) && !(await page.visible('[data-testid="hq-stores"]')));
  check('C5 상세에서 트리의 그 매장 활성', await page.eval(`document.querySelector('[data-testid="hq-tree-${filtered[0]}"]')?.getAttribute('aria-selected')==='true'`));
  check('C6 행 → 상세 = push(history +1)', (await page.eval('history.length')) === h0 + 1);
  if (ids.length > 1) {
    const other = ids.find((x) => x !== filtered[0]);
    const t0 = await detailTitle(page);
    const h1 = await page.eval('history.length');
    await page.click(`[data-testid="hq-tree-${other}"]`);
    await page.waitFor(`location.pathname === '/hq/stores/${other}'`);
    await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]')`, 40000);
    await sleep(800);
    check('C7 트리로 다른 매장 = 내용 바뀜 · replace(history 그대로)', t0 !== (await detailTitle(page)) && (await page.eval('history.length')) === h1);
  } else {
    check('C7 매장이 2곳 이상 필요(고정 계정 상태 확인)', false, `${ids.length}곳`);
  }
  await page.click('[data-testid="hq-store-back"]');
  await sleep(1200);
  check('C8 ← → /hq/stores · 검색어 유지', (await page.path()) === '/hq/stores' && (await page.eval(`document.querySelector('${SEARCH}')?.value`)) === needle, await page.path());
  // 탭은 주소가 SSOT — 바꾸면 ?tab= 이 붙고, 새로고침해도 같은 탭이다.
  await page.goto(`/hq/stores/${UNIT}`);
  await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]')`, 40000);
  await sleep(800);
  await page.click('[data-testid="hq-store-tabs-rules"]');
  await sleep(800);
  check('C9 탭 → ?tab=rules', (await page.eval('location.search')).includes('tab=rules'));
  await page.reload();
  await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]')`, 40000);
  await sleep(1200);
  check('C10 새로고침 → 같은 탭(연결과 규칙)', await page.eval(`document.querySelector('[data-testid="hq-store-tabs-rules"]')?.getAttribute('aria-selected')==='true'`));
  await page.click('[data-testid="hq-store-back"]');
  await sleep(1000);
  check('C11 주소로 바로 들어온 상세의 ← = 전체 매장', (await page.path()) === '/hq/stores', await page.path());
  await page.goto('/hq/stores/no_such_unit');
  check('C12 없는 id → 안내 문구', await page.waitFor(`document.body.innerText.includes('이 매장은 지금 연결된 매장 목록에 없어요.')`, 40000));
  // 초대 대기 = 자기 화면. 하위 메뉴 + = 초대 대기 화면 + 매장 추가 창.
  await page.goto('/hq/stores');
  await waitRows(page, 'hq-stores-table');
  await page.click('[data-testid="subnav-stores-invites"]');
  await page.waitFor(`location.pathname === '/hq/stores/invites'`);
  await page.waitFor(`!!document.querySelector('[data-testid="hq-invites-table"]')`, 40000);
  check('C13 하위 메뉴 초대 대기 → /hq/stores/invites · 표 · 활성', await subActive(page, 'stores-invites'));
  await page.click('[data-testid="subnav-add"]');
  check('C14 하위 메뉴 + → 매장 추가 창', await page.waitFor(`!!document.querySelector('[data-testid="hq-invite-phone"]')`, 20000));
  console.log('   콘솔 에러', page.errors.length);
});

// ── D. 뒤로가기 · 메뉴 이동 ──────────────────────────────────────────────
section('D. 대시보드에서 들어온 상세 · 메뉴 이동');
await withPage({}, async (page) => {
  // 요청 매장 1곳 = UNIT 만 — '공개 수준 요청 중'을 누르면 그 매장 연결과 규칙 탭으로 바로 간다.
  await page.mockRpc({ brand_overview: (rows) => rows.map((r) => ({ ...r, visibility_requested: r.unit_id === UNIT ? 'ops' : null })) });
  await page.goto('/hq');
  await page.waitFor(`!!document.querySelector('[aria-label="공개 수준 요청 중 1건"]')`, 40000);
  await page.click('[aria-label="공개 수준 요청 중 1건"]');
  await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]') && location.pathname==='/hq/stores/${UNIT}'`, 40000);
  await sleep(800);
  check('D/K1 요청 1곳 → 그 매장 상세 · 연결과 규칙 탭', await page.eval(`document.querySelector('[data-testid="hq-store-tabs-rules"]')?.getAttribute('aria-selected')==='true'`));
  await page.click('[data-testid="hq-store-back"]');
  await sleep(1000);
  check('D 대시보드 → 상세 → ← = 대시보드(들어온 곳)', (await page.path()) === '/hq', await page.path());
  await page.mockRpc({});
  await page.goto(`/hq/stores/${UNIT}`);
  await page.waitFor(`!!document.querySelector('[data-testid="hq-store-tabs"]')`, 40000);
  await sleep(600);
  await page.click('[data-testid="nav-/hq/knowhow"]');
  await page.waitFor(`location.pathname==='/hq/knowhow'`);
  await sleep(800);
  check('D 아이콘 줄 노하우 → 하위 메뉴 노하우(전체 노하우 활성)', await subActive(page, 'knowhow-all'));
  await page.click('[data-testid="subnav-knowhow-status"]');
  await page.waitFor(`location.pathname==='/hq/knowhow/status'`);
  await sleep(800);
  check('D 하위 메뉴 배포 상태 → /hq/knowhow/status · 활성', await subActive(page, 'knowhow-status'));
  await page.click('[data-testid="nav-/hq"]');
  await page.waitFor(`location.pathname==='/hq'`);
  await sleep(800);
  check('D 대시보드에는 하위 메뉴가 없다', !(await page.visible('[data-testid="hq-subnav"]')));
});

// ── K. 대시보드 개선(03 1차) — 확인 필요 → 처리할 곳 · 만료 초대 · 숙지율 분모 · 매장 주어 목록 0 ────────
section('K. 확인 필요 칸 · 만료 초대 · 숙지율 분모 · 매장 이름 상시 나열 0');
const UNITS = (await rpc(hqSession.access_token, 'brand_overview')).data;
// K2 — 요청 매장이 여러 곳이면 이름순 목록 → 누르면 그 매장 연결과 규칙 탭.
if (UNITS.length < 2) {
  check('K2 준비 — 연결 매장 2곳 이상 필요', false, `${UNITS.length}곳 · 건너뛰지 않고 실패로 센다`);
} else {
  await withPage({}, async (page) => {
    await page.mockRpc({ brand_overview: (rows) => rows.map((r) => ({ ...r, payer_proposed: 'owner', payer_proposed_by_brand: false })) });
    await page.goto('/hq');
    const label = `답할 요금 부담 제안 ${UNITS.length}건`;
    await page.waitFor(`!!document.querySelector('[aria-label="${label}"]')`, 40000);
    await page.click(`[aria-label="${label}"]`);
    await page.waitFor(`!!document.querySelector('[data-testid="hq-attention-stores"]')`, 8000);
    const names = await page.eval(`[...document.querySelectorAll('[data-testid="hq-attention-stores"] [aria-label$=" 매장 열기"]')].map(e=>e.getAttribute('aria-label').replace(/ 매장 열기$/,''))`);
    const want = UNITS.map((u) => u.store_name);
    check('K2 여러 곳 → 이름순 목록(서버 순서 = 이름순)', JSON.stringify(names) === JSON.stringify(want), JSON.stringify(names));
    await page.click(`[aria-label="${want[1]} 매장 열기"]`);
    const ok = await page.waitFor(`location.pathname==='/hq/stores/${UNITS[1].unit_id}' && document.querySelector('[data-testid="hq-store-tabs-rules"]')?.getAttribute('aria-selected')==='true'`, 40000);
    check('K2 목록의 매장 → 그 매장 연결과 규칙 탭', ok, await page.path());
  });
}
// K3 — 만료 초대: 다시 보낸 번호는 세지 않고, 누르면 초대 화면에 만료 줄이 보인다(취소 버튼 없음).
await withPage({}, async (page) => {
  const base = { kind: 'store', token: null, payer: 'brand', used_at: null, unit_id: null };
  const fake = [
    { ...base, id: 'qa_inv_expA', phone: '01000000001', status: 'expired', created_at: '2026-09-01T00:00:00Z', expires_at: '2026-09-15T00:00:00Z' },
    { ...base, id: 'qa_inv_expB', phone: '01000000002', status: 'expired', created_at: '2026-09-01T00:00:00Z', expires_at: '2026-09-15T00:00:00Z' },
    { ...base, id: 'qa_inv_penB', phone: '01000000002', status: 'pending', created_at: '2026-09-20T00:00:00Z', expires_at: '2099-10-04T00:00:00Z' },
  ];
  await page.mockRpc({ brand_invites_list: () => fake });
  await page.goto('/hq');
  const lit = await page.waitFor(`!!document.querySelector('[aria-label="만료된 초대 1건"]') && !!document.querySelector('[aria-label="연결 동의 대기 1건"]')`, 40000);
  check('K3 만료 칸 = 다시 보내지 않은 만료만(1건)', lit);
  await page.click('[aria-label="만료된 초대 1건"]');
  await page.waitFor(`location.pathname==='/hq/stores/invites'`, 10000);
  await waitRows(page, 'hq-invites-table');
  await sleep(600);
  const rows = await page.eval(ROWS('hq-invites-table'));
  const t = await page.eval(`document.querySelector('[data-testid="hq-invites-table"]').innerText`);
  check('K3 초대 화면: 대기 1 + 만료 1 · 다시 보낸 만료는 없음', JSON.stringify(rows) === JSON.stringify(['qa_inv_penB', 'qa_inv_expA']) && t.includes('만료'), JSON.stringify(rows));
  check('K3 만료 줄에는 취소 버튼이 없다 · 안내가 보인다', !(await page.visible('[data-testid="hq-invite-revoke-qa_inv_expA"]')) && (await page.text()).includes('같은 번호에 다시 보낼 수 있어요'));
});
// K4 — 숙지율 칸에 분모. K5 — 대시보드에 매장 이름이 상시로 나열되지 않는다 · 진단 말 0(03 §1 Q1 판정).
await withPage({}, async (page) => {
  await page.mockRpc({ brand_overview: (rows) => rows.map((r) => ({ ...r, mastery: r.unit_id === UNIT ? 0.5 : null })) });
  await page.goto('/hq');
  await page.waitFor(`!!document.querySelector('[data-testid="hq-kpi"]')`, 40000);
  await sleep(800);
  const kpi = await page.eval(`document.querySelector('[data-testid="hq-kpi"]').innerText`);
  check('K4 숙지율 = 50% · "연결 매장 n곳 중 1곳 평균"', kpi.includes('50%') && kpi.includes(`연결 매장 ${UNITS.length}곳 중 1곳 평균`), kpi.replace(/\n/g, ' | '));
  const text = await page.text();
  const shown = UNITS.map((u) => u.store_name).filter((n) => text.includes(n));
  check('K5 대시보드 첫 화면에 매장 이름 0 · "문제/위험/부진" 0', shown.length === 0 && !/문제|위험|부진/.test(text), `names=${shown} `);
  check('K6 최근 배포 상태 칸이 선다(표 또는 빈 안내)', (await page.visible('[data-testid="hq-dashboard-deploy"]')) || (await page.visible('[data-testid="hq-dashboard-deploy-empty"]')));
  console.log('   콘솔 에러', page.errors.length);
});

// ── E. 폭 — 머리글 한 줄 · 페이지 가로 스크롤 0 ──────────────────────────────
section('E. 전체 매장 표 머리글 한 줄 · 페이지 가로 넘침 0 (1280 · 1440 · 1600)');
await withPage({ width: 1440, height: 900 }, async (page) => {
  await page.goto('/hq/stores');
  await waitRows(page, 'hq-stores-table');
  await sleep(2000);
  const probe = `(()=>{const t=document.querySelector('[data-testid="hq-stores-table"]');if(!t)return null;
    const heads=['매장','관계','공개 수준','직원','자체 노하우','받은 노하우','숙지율','미해결 질문','요금 부담'];
    const tall=[...t.querySelectorAll('div[dir="auto"]')].filter(e=>heads.includes(e.innerText)).filter(e=>e.getBoundingClientRect().height>24).map(e=>e.innerText);
    return {tall, page: document.scrollingElement.scrollWidth <= window.innerWidth};})()`;
  for (const w of [1280, 1440, 1600]) {
    await page.resize(w, 900);
    await sleep(700);
    const r = await page.eval(probe);
    check(`E ${w}: 머리글 한 줄 · 페이지 가로 넘침 0`, !!r && r.tall.length === 0 && r.page, JSON.stringify(r));
  }
});

// ── F. 로딩 게이트(R3) ────────────────────────────────────────────────
section('F. 느린 회선에서 로딩 중 거짓 빈 상태 0');
const GATES = [
  { path: '/hq/stores', loading: '매장 목록을 불러오고 있어요', bad: ['아직 연결된 매장이 없어요'], done: '[data-testid="hq-stores-table"] [data-testid^="hq-row-"]' },
  { path: '/hq', loading: '본사 현황을 불러오고 있어요', bad: ['지금 확인할 일이 없어요', '초대 대기 없음', '노하우를 보내면 매장마다'], done: '[data-testid="hq-kpi"]' },
  { path: '/hq/knowhow', loading: '노하우를 불러오고 있어요', bad: ['아직 쓴 노하우가 없어요', '연결된 매장이 없어 아직 보낼 곳이 없어요'], done: '[data-testid="hq-knowhow-table"]' },
  { path: '/hq/quizzes', loading: '퀴즈를 불러오고 있어요', bad: ['아직 만든 퀴즈가 없어요'], done: '[data-testid="hq-quizzes-table"]' },
  { path: '/hq/settings/members', loading: '구성원을 불러오고 있어요', bad: ['구성원이 없어요'], done: '[data-testid="hq-members-table"] [data-testid^="hq-row-"]' },
  { path: '/hq/settings/billing', loading: '설정을 불러오고 있어요', bad: ['아직 결제 전'], done: '[data-testid="hq-billing-summary"]' },
  { path: `/hq/stores/${UNIT}`, loading: '매장 정보를 불러오고 있어요', bad: ['연결된 매장 목록에 없어요'], done: '[data-testid="hq-store-kpi"]' },
  { path: '/hq/stores/invites', loading: '초대 목록을 불러오고 있어요', bad: ['기다리는 초대가 없어요'], done: '[data-testid="hq-invites-table"]' },
  { path: '/hq/knowhow/status', loading: '노하우 배포 상태를 불러오고 있어요', bad: ['연결된 매장이 생기면'], done: '[data-testid="hq-knowhow-status-body"]' },
];
for (const g of GATES) {
  await withPage({}, async (page) => {
    const watch = [g.loading, ...g.bad, '불러오는 중'];
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__seen={};setInterval(()=>{const t=document.body?document.body.innerText:'';for(const w of ${JSON.stringify(watch)}){if(t.includes(w)&&!window.__seen[w])window.__seen[w]=performance.now();}},30);`,
    });
    await page.slowNetwork(1500);
    await page.goto(g.path);
    await page.waitFor(`!!document.querySelector(${JSON.stringify(g.done)})`, 60000);
    await sleep(1200);
    const seen = await page.eval('window.__seen');
    const early = g.bad.filter((b) => seen[b] && (!seen[g.loading] || seen[b] < seen[g.loading]));
    check(`F ${g.path}: 로딩 문구가 먼저 · 거짓 빈 상태 0 · '불러오는 중' 0`, !!seen[g.loading] && early.length === 0 && !seen['불러오는 중'], early.join(', '));
  });
}

// ── G. 실패 3분기 ─────────────────────────────────────────────────────
section('G. 실패하면 거짓 숫자 대신 오류 상자 + 다시 시도');
const FAILS = [
  { path: '/hq/knowhow', fail: ['brand_deploy_matrix'], err: '노하우를 불러오지 못했어요', lies: ['아직 쓴 노하우가 없어요'], ok: '[data-testid="hq-knowhow-table"]', box: 'hq-knowhow-error' },
  { path: '/hq/knowhow', fail: ['brand_overview'], err: '연결 매장을 불러오지 못했어요', lies: ['연결된 매장이 없어 아직 보낼 곳이 없어요', '연결된 매장이 생기면'], ok: '[data-testid="hq-knowhow-table"]', box: 'hq-knowhow-error' },
  { path: '/hq/quizzes', fail: ['brand_quiz_list'], err: '퀴즈를 불러오지 못했어요', lies: ['아직 만든 퀴즈가 없어요'], ok: '[data-testid="hq-quizzes-table"]', box: 'hq-quizzes-error' },
  { path: '/hq', fail: ['brand_quiz_list'], err: '본사 현황을 불러오지 못했어요', lies: ['배포한 퀴즈', '지금 확인할 일이 없어요'], ok: '[data-testid="hq-kpi"]', box: 'hq-dashboard-error' },
  { path: '/hq/settings/billing', fail: ['brand_billing_preview_mine'], err: '결제 정보를 불러오지 못했어요', lies: ['이번 달 청구 대상'], ok: '[data-testid="hq-billing-summary"]', box: 'hq-settings-error' },
  { path: '/hq/stores', fail: ['brand_overview_page'], err: '매장 목록을 불러오지 못했어요', lies: ['아직 연결된 매장이 없어요'], ok: '[data-testid="hq-stores-table"] [data-testid^="hq-row-"]', box: 'hq-stores-error' },
  { path: `/hq/stores/${UNIT}`, fail: ['brand_unit_rules'], err: '매장 정보를 불러오지 못했어요', lies: ['연결된 매장 목록에 없어요'], ok: '[data-testid="hq-store-kpi"]', box: 'hq-store-detail-error' },
];
for (const c of FAILS) {
  await withPage({}, async (page) => {
    await page.failRpc(c.fail);
    await page.goto(c.path);
    const shown = await page.waitFor(`document.body.innerText.includes(${JSON.stringify(c.err)})`, 40000);
    await sleep(800);
    const text = await page.text();
    const lies = c.lies.filter((l) => text.includes(l));
    await page.slowNetwork(1200);
    await page.failRpc([]);
    await page.click(`[data-testid="${c.box}-retry"]`);
    await sleep(250);
    const busy = await page.eval(`document.querySelector('[data-testid="${c.box}-retry"]')?.innerText.includes('불러오는 중') ?? false`);
    const recovered = await page.waitFor(`!!document.querySelector(${JSON.stringify(c.ok)})`, 30000);
    check(`G ${c.path} [${c.fail}]: 오류 상자 · 거짓 문구 0 · 다시 시도 중 잠김 · 풀리면 정상`, shown && lies.length === 0 && busy && recovered,
      `shown=${shown} lies=${lies} busy=${busy} recovered=${recovered}`);
  });
}

// ── H. 상태별 매장 수(픽스처 · 자가정리) ─────────────────────────────────
section('H. 상태별 매장 수 — 노하우 1건을 store_001 에만 보내고 센다');
const SRC = 'qa_hqs_src';
const svc = SRV ? createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
async function cleanupH(since) {
  if (!svc) return;
  const { data: copies } = await svc.from('playbook_entries').select('id').eq('brand_entry_id', SRC);
  await svc.from('brand_deployments').delete().eq('source_id', SRC);
  if (copies?.length) await svc.from('playbook_entries').delete().in('id', copies.map((c) => c.id));
  await svc.from('playbook_entries').delete().eq('id', SRC);
  if (since) await svc.from('owner_alerts').delete().eq('unit_id', UNIT).eq('kind', 'brand_deploy').gte('created_at', since);
}
if (!svc) {
  check('H 준비 — SUPABASE_SERVICE_ROLE_KEY(.env.seed) 필요', false, '건너뛰지 않고 실패로 센다');
} else {
  const since = new Date().toISOString();
  await cleanupH(null);
  try {
    const H = createClient(SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await H.auth.signInWithPassword({ email: HQ, password: PW });
    const hqId = (await H.auth.getUser()).data.user.id;
    const ws = (await H.rpc('brand_enter_workspace')).data;
    const ins = await svc.from('playbook_entries').insert({
      id: SRC, unit_id: ws, creator_id: hqId, creator_name: 'QA', creator_role: 'owner', category: 'Routine', subcategory: '일반',
      title: 'QA 구조 검사 노하우', tags: ['#QA'], execution: { timing: '', channel: '', tone: '' }, stats: {}, search_keywords: ['QA'],
      square: { situation: 'QA 상황', quagmire: '', uncover: '', action: { steps: ['QA 단계'] }, result: { before: '', after: '', metric: '' }, extract: { do: '', dont: '' } },
      version: 1, status: 'published', quality_score: 0, section: 'QA섹션', order_index: 999, photos: [],
    });
    const dep = await H.rpc('brand_deploy_entries', { p_entry_ids: [SRC], p_unit_ids: [UNIT], p_required: false });
    const units = (await rpc(hqSession.access_token, 'brand_overview')).data;
    if (ins.error || dep.error) {
      check('H 준비 — 원본 넣기·배포', false, ins.error?.message ?? dep.error?.message);
    } else {
      await withPage({}, async (page) => {
        await page.goto('/hq/knowhow/status');
        await page.waitFor(`!!document.querySelector('[data-testid="hq-knowhow-status-xtable-${SRC}-current"]')`, 40000);
        await sleep(800);
        const cell = (st) => page.eval(`document.querySelector('[data-testid="hq-knowhow-status-xtable-${SRC}-${st}"]')?.innerText ?? '—'`);
        const got = { current: await cell('current'), modified: await cell('modified'), pending: await cell('pending'), hidden: await cell('hidden'), none: await cell('none') };
        const none = units.length - 1;
        check('H1 최신 1곳 · 미배포 = 나머지 · 다른 상태 —', got.current === '1곳' && got.modified === '—' && got.pending === '—' && got.hidden === '—' && got.none === (none ? `${none}곳` : '—'), JSON.stringify(got));
        check('H2 바닥줄 = 연결 매장 수 기준', (await page.text()).includes(`연결 매장 ${units.length}곳 기준`));
        await page.click(`[data-testid="hq-knowhow-status-xtable-${SRC}-current"]`);
        await page.waitFor(`!!document.querySelector('[data-testid="hq-knowhow-status-xtable-stores"]')`, 8000);
        const listed = await page.eval(`document.querySelector('[data-testid="hq-knowhow-status-xtable-stores"]').innerText`);
        const name = units.find((u) => u.unit_id === UNIT).store_name;
        check('H3 숫자를 누르면 그 매장만', listed.includes(name) && units.filter((u) => u.unit_id !== UNIT).every((u) => !listed.includes(u.store_name)), listed.replace(/\n/g, ' | '));
        await page.click(`[aria-label="${name} 매장 열기"]`);
        check('H4 매장을 누르면 그 매장 상세', await page.waitFor(`location.pathname === '/hq/stores/${UNIT}'`, 10000));
        // 매장 상세(2026-10-02) — 개요의 본사 노하우 칸 · 노하우 탭이 같은 사본을 이 매장 기준으로 센다.
        await page.waitFor(`!!document.querySelector('[data-testid="hq-store-knowhow-status"]')`, 40000);
        await sleep(600);
        const ov = await page.eval(`document.querySelector('[data-testid="hq-store-knowhow-status"]').innerText`);
        check('H5 상세 개요: 본사 노하우 최신 1', /최신\s*\n?\s*1/.test(ov), ov.replace(/\n/g, ' | '));
        await page.click('[data-testid="hq-store-tabs-knowhow"]');
        await page.waitFor(`!!document.querySelector('[data-testid="hq-store-knowhow-table"] [data-testid="hq-row-${SRC}"]')`, 20000);
        const rowText = await page.eval(`document.querySelector('[data-testid="hq-store-knowhow-table"] [data-testid="hq-row-${SRC}"]').innerText`);
        check('H6 상세 노하우 탭: 그 노하우가 이 매장 최신', rowText.includes('최신'), rowText.replace(/\n/g, ' | '));
        await page.goto('/hq');
        const sel = `[data-testid="hq-dashboard-deploy-${SRC}-current"]`;
        const on = await page.waitFor(`!!document.querySelector('${sel}')`, 40000);
        const top = on && (await page.eval(`document.querySelector('[data-testid="hq-dashboard-deploy"] [data-testid^="hq-row-"]')?.dataset.testid`)) === `hq-row-${SRC}`;
        const n = on ? await page.eval(`document.querySelector('${sel}').innerText`) : '—';
        check('H7 대시보드 최근 배포 상태: 방금 보낸 노하우가 맨 위 · 최신 1곳', top && n === '1곳', `on=${on} top=${top} n=${n}`);
        await page.click(sel);
        const dashListed = await page.waitFor(`document.querySelector('[data-testid="hq-dashboard-deploy-stores"]')?.innerText.includes(${JSON.stringify(name)})`, 8000);
        check('H8 대시보드 숫자를 누르면 그 매장 목록', dashListed);
      });
    }
  } finally {
    await cleanupH(since);
    const { data: left } = await svc.from('playbook_entries').select('id').or(`id.eq.${SRC},brand_entry_id.eq.${SRC}`);
    check('H 정리 — 원본·사본 0', (left ?? []).length === 0, `${left?.length}`);
  }
}

// ── I. 등장 애니메이션(앱과 같이 · 설정류는 없음) ─────────────────────────
section('I. 등장 애니메이션');
const ANIMS = [
  { path: '/hq', sel: '[data-testid="hq-kpi"]', anim: true },
  { path: '/hq/stores', sel: '[data-testid="hq-stores-table"]', anim: true },
  { path: `/hq/stores/${UNIT}`, sel: '[data-testid="hq-store-kpi"]', anim: true },
  { path: '/hq/knowhow', sel: '[data-testid="hq-knowhow-table"]', anim: true },
  { path: '/hq/quizzes', sel: '[data-testid="hq-quizzes-table"]', anim: true },
  { path: '/hq/settings/members', sel: '[data-testid="hq-members-table"]', anim: false },
];
for (const a of ANIMS) {
  await withPage({}, async (page) => {
    // 처음 보인 순간부터 600ms 동안 조상 체인 투명도(곱)의 최솟값과 마지막 값.
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__op=null;const alpha=(e)=>{let a=1;for(let n=e;n&&n.nodeType===1;n=n.parentElement)a*=parseFloat(getComputedStyle(n).opacity);return a;};
        const tick=()=>{const e=document.querySelector(${JSON.stringify(a.sel)});if(e&&e.getBoundingClientRect().width){const r=window.__op||(window.__op={t0:performance.now(),min:1,last:1});
        if(performance.now()-r.t0<600)r.min=Math.min(r.min,alpha(e));r.last=alpha(e);}requestAnimationFrame(tick);};requestAnimationFrame(tick);`,
    });
    await page.goto(a.path);
    await page.waitFor('!!window.__op', 40000);
    await sleep(1200);
    const r = await page.eval('window.__op');
    if (a.anim) check(`I ${a.path}: 처음 투명 → 1(등장)`, r && r.min < 0.6 && r.last > 0.99, r ? `min ${r.min.toFixed(2)}` : 'none');
    else check(`I ${a.path}: 설정류는 애니메이션 없음`, r && r.min > 0.99, r ? `min ${r.min.toFixed(2)}` : 'none');
  });
}

// ── J. 짧은 글자 줄바꿈(ui.md "짧은 글자는 접히지 않는다") ──────────────────
section('J. 라벨·배지·버튼·제목(16자 이하)이 두 줄로 접히지 않는다');
{
  // 글자 잎(div/span[dir=auto])마다 높이가 줄높이 × 1.6 을 넘으면 접힌 것이다.
  const DETECT = `(()=>{const out=[];
    for(const e of document.querySelectorAll('div[dir="auto"],span[dir="auto"]')){
      if(e.querySelector('div[dir="auto"],span[dir="auto"]'))continue;
      const t=(e.innerText||'').trim(); if(!t||t.length>16||t.includes('\\n'))continue;
      const r=e.getBoundingClientRect(); if(!r.width||!r.height)continue;
      const cs=getComputedStyle(e); const fs=parseFloat(cs.fontSize); const lh=cs.lineHeight==='normal'?fs*1.35:parseFloat(cs.lineHeight);
      if(r.height>lh*1.6) out.push(t+'('+Math.round(r.width)+'×'+Math.round(r.height)+')');
    } return [...new Set(out)];})()`;
  const PAGES = ['/hq', '/hq/stores', '/hq/stores/invites', `/hq/stores/${UNIT}`, `/hq/stores/${UNIT}?tab=knowhow`, `/hq/stores/${UNIT}?tab=rules`,
    '/hq/knowhow', '/hq/knowhow/status', '/hq/quizzes', '/hq/quizzes/status', '/hq/settings', '/hq/settings/members', '/hq/settings/billing', '/hq/knowhow/new', '/hq/quizzes/new'];
  for (const width of [1280, 1371, 1600]) {
    await withPage({ width }, async (page) => {
      const found = [];
      for (const p of PAGES) {
        await page.goto(p);
        await page.waitFor(`!!document.querySelector('[data-testid="hq-main"]') && !document.body.innerText.includes('불러오고 있어요')`, 40000);
        await sleep(2000);
        for (const f of await page.eval(DETECT)) found.push(`${p} ${f}`);
        if (p === '/hq/stores') {
          await page.click('[data-testid="hq-add-store"]');
          await sleep(1000);
          for (const f of await page.eval(DETECT)) found.push(`[매장 추가] ${f}`);
        }
      }
      check(`J 창 ${width}: 접힌 짧은 글자 0`, found.length === 0, found.join(' · '));
    });
  }
  // 대시보드 최근 배포 상태가 **찬** 상태 — 파일럿은 배포 노하우가 0건이라 위 검사는 빈 안내만 본다(2026-10-02 실측:
  // 1280 에서 '새 버전 대기' 머리글이 접혔는데 위 검사는 통과했다). 응답 바꾸기로 5행을 채워 같은 검사를 돈다.
  {
    const fakeList = ['여름 신메뉴 수박주스 만드는 법', '마감 청소 순서', '배달 포장 실수 줄이기', '손님 응대 첫마디', '재고 발주 기준'].map((t, i) => ({
      id: `qa_k${i}`, title: t, section: null, category: 'Routine', subcategory: '일반', photos: 0, deployed_units: 1, version: 1, updated_at: `2026-10-02T0${9 - i}:00:00Z`,
    }));
    const st = ['current', 'modified', 'pending', 'hidden', 'current'];
    for (const width of [1280, 1371, 1440, 1600]) {
      await withPage({ width }, async (page) => {
        await page.mockRpc({
          brand_knowhow_list: () => fakeList,
          brand_deploy_matrix: () => fakeList.map((k, i) => ({ entry_id: k.id, unit_id: UNIT, status: st[i], brand_version: 1, pending_version: null })),
        });
        await page.goto('/hq');
        await page.waitFor(`!!document.querySelector('[data-testid="hq-dashboard-deploy"] [data-testid^="hq-row-"]')`, 40000);
        await sleep(2000);
        const found = await page.eval(DETECT);
        const wide = await page.eval('document.scrollingElement.scrollWidth <= window.innerWidth');
        check(`J 창 ${width}: 최근 배포 상태 5행 · 접힌 짧은 글자 0 · 가로 넘침 0`, found.length === 0 && wide, found.join(' · '));
      });
    }
  }
  // 한글 어절 줄바꿈 — 본사 셸 본문이 keep-all 이어야 "본사 부 / 담" 같은 단어 중간 끊김이 없다.
  await withPage({}, async (page) => {
    await page.goto('/hq');
    await page.waitFor(`!!document.querySelector('[data-testid="hq-main"]')`, 40000);
    check('J 본사 셸 본문 = 한글 어절 단위 줄바꿈(keep-all)', (await page.eval(`getComputedStyle(document.querySelector('[data-testid="hq-main"]')).wordBreak`)) === 'keep-all');
  });
}

console.log(`\n── 결과 ── pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
