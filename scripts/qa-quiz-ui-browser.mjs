// qa-quiz-ui-browser.mjs — 퀴즈 화면 **레이아웃 실측**(2026-08-26).
//
// 기능 검증(qa:training·qa:quiz-*)이 아니라 "UI가 깨졌는가"만 본다. 사장이 지적한 증상이 그것이다:
// 좌우 여백이 들쭉날쭉하고, 무언가가 프레임 밖으로 나가고, 시트 안이 텅 비거나 겹친다.
//
//   L1 가로 넘침      — 문서·요소가 460px 프레임 밖으로 나가는가(scrollWidth > clientWidth).
//                       ★스크롤 조상이 프레임 안에서 잘라 주는 것은 세지 않는다 — 가로 스크롤은 정상 형태다.
//   L2 좌우 여백      — 같은 화면 안의 최상위 블록들이 **같은 x**에서 시작·끝나는가
//   L3 터치 타깃      — 누를 수 있는 것이 48dp 미만인가(사장 주 액션은 56)
//   L4 겹침           — 형제 요소끼리 실제로 겹치는가(isVisible 은 겹침을 못 본다 — 08-05 함정)
//   L5 잘림           — 글자가 상자 밖으로 넘치는가(scrollWidth/Height > client)
//   L6 콘솔 에러 0
//
// 계정: **고정 QA 계정**을 쓴다(가입 레이트리밋 회피 — 새로 만들지 않는다).
//       없으면 `node scripts/qa-local-accounts.mjs` 를 먼저 돌린다.
// 실행: node scripts/qa-quiz-ui-browser.mjs   (.env, QA_ORIGIN 기본 localhost:8081)
// 스크린샷 → ./qa-shots/quiz-ui/
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
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const EMAIL = process.env.QA_EMAIL ?? 'qa.owner@example.com';
const PW = process.env.QA_PASSWORD ?? 'QaTest1234!';
const SHOTS = './qa-shots/quiz-ui';
const FRAME = 460;
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON) { console.error('FAIL: .env 의 SUPABASE URL/ANON 필요'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const projectRef = new URL(URL_).hostname.split('.')[0];
async function session() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`로그인 실패(${EMAIL}) — qa-local-accounts.mjs 먼저: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

/** 화면 안에서 레이아웃을 재는 브라우저측 함수. 결과는 순수 데이터로만 돌려준다. */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, docOverflow: 0, wide: [], smallTaps: [], clipped: [], overlaps: [], gutters: [] };

  // L1 — 문서 자체가 옆으로 흐르는가
  out.docOverflow = Math.max(0, document.documentElement.scrollWidth - vw);

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 40) || el.tagName.toLowerCase();
  };

  const all = [...document.querySelectorAll('body *')].filter(vis);

  /**
   * 이 요소를 **실제로 잘라 주는** 조상이 프레임 안에 있는가.
   * ★가로 스크롤은 이 앱의 정상 형태다(ui.md 배치규칙④ "가로 스크롤은 옆 카드를 잘라서 노출").
   *   스크롤 줄의 내용은 당연히 컨테이너보다 넓고, 컨테이너가 프레임 안에서 잘라 준다 —
   *   그걸 "프레임 밖으로 나갔다"고 세면 **고칠 수 없는 실패**가 매번 남는다(2026-08-26:
   *   카테고리 칩 줄이 right 670 으로 잡혔는데 스크린샷에서는 프레임 안에서 잘려 있었다).
   *   진짜 프레임 파손은 docOverflow(문서 자체가 옆으로 흐름)가 따로 잡는다.
   */
  const clipper = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
        if (p.getBoundingClientRect().right <= vw + 1) return true;
      }
    }
    return false;
  };

  for (const el of all) {
    const r = el.getBoundingClientRect();
    // L1 — 프레임 밖으로 삐져나간 요소(1px 반올림 여유). 잘려 있는 것은 나간 것이 아니다.
    if ((r.right > vw + 1 || r.left < -1) && !clipper(el)) {
      out.wide.push({ t: label(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
    // L5 — 글자가 상자 밖으로(가로만 본다; 세로는 스크롤 컨테이너가 많아 오탐)
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') {
      out.clipped.push({ t: label(el), need: el.scrollWidth, has: el.clientWidth });
    }
  }

  // L3 — **누를 수 있는** 것의 최소 높이. RNW 는 role=button 이 대부분이다.
  // ★못 누르는 것은 타깃이 아니다 — 달력의 범위 밖 날짜처럼 일부러 막아 둔 칸을 세면
  //   "고칠 수 없는 실패"가 매번 남는다(2026-08-26: 못 고르는 날 36dp 가 그렇게 잡혔다).
  for (const el of document.querySelectorAll('[role="button"],[role="checkbox"],[role="radio"],button')) {
    if (!vis(el)) continue;
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 44) out.smallTaps.push({ t: label(el), h: Math.round(r.height) });
  }

  // L2 — 스크롤 본문의 **최상위 자식**들이 같은 좌우에서 서는가(여백 들쭉날쭉의 정체)
  const scroller = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 20 && d.clientWidth > vw * 0.8);
  if (scroller) {
    const rows = [...scroller.children].filter(vis).map((c) => {
      const r = c.getBoundingClientRect();
      return { t: label(c), left: Math.round(r.left), right: Math.round(r.right) };
    });
    // 폭이 프레임의 절반도 안 되는 것(가운데 문구·칩)은 여백 판정 대상이 아니다.
    out.gutters = rows.filter((r) => r.right - r.left > vw * 0.5);
  }

  // L4 — 형제끼리 실제로 겹치는가. 세로로 쌓이는 목록에서 위아래가 물리면 화면이 깨진 것이다.
  // ★오탐을 세 가지 걷어낸다(2026-08-26 1차 측정에서 전부 나왔다):
  //   ① 띄워 놓은 것(absolute·fixed) — 헤더·시트는 원래 겹쳐서 뜬다
  //   ② 담고 있는 것(한쪽이 다른 쪽을 통째로 포함) — 컨테이너와 내용은 겹친 게 아니다
  //   ③ 가로로 놓인 형제(flex-direction: row)
  const parents = new Set(all.map((e) => e.parentElement).filter(Boolean));
  for (const p of parents) {
    const ps = getComputedStyle(p);
    if (ps.display.includes('flex') && ps.flexDirection.startsWith('row')) continue;
    const cs = [...p.children].filter(vis)
      .filter((c) => !['absolute', 'fixed', 'sticky'].includes(getComputedStyle(c).position))
      .map((c) => ({ el: c, r: c.getBoundingClientRect() }));
    if (cs.length < 2) continue;
    for (let i = 1; i < cs.length; i++) {
      const a = cs[i - 1].r, b = cs[i].r;
      if (a.top <= b.top && a.bottom >= b.bottom) continue;   // ② 포함
      if (b.top <= a.top && b.bottom >= a.bottom) continue;
      const dy = a.bottom - b.top;
      if (dy > 2 && b.top >= a.top) out.overlaps.push({ t: label(cs[i].el), by: Math.round(dy) });
    }
  }
  return out;
};

const report = (name, m) => {
  check(`${name} · L1 가로 넘침 없음`, m.docOverflow === 0 && m.wide.length === 0,
    m.docOverflow ? `문서 +${m.docOverflow}px` : JSON.stringify(m.wide.slice(0, 3)));
  const lefts = [...new Set(m.gutters.map((g) => g.left))];
  const rights = [...new Set(m.gutters.map((g) => g.right))];
  check(`${name} · L2 좌우 여백 일정`, lefts.length <= 1 && rights.length <= 1,
    `left=${JSON.stringify(lefts)} right=${JSON.stringify(rights)} ${JSON.stringify(m.gutters.slice(0, 4))}`);
  check(`${name} · L3 터치 타깃 44dp+`, m.smallTaps.length === 0, JSON.stringify(m.smallTaps.slice(0, 4)));
  check(`${name} · L4 겹침 없음`, m.overlaps.length === 0, JSON.stringify(m.overlaps.slice(0, 3)));
  check(`${name} · L5 글자 잘림 없음`, m.clipped.length === 0, JSON.stringify(m.clipped.slice(0, 3)));
};

/**
 * 실측용 퀴즈 한 건을 심는다 — 상세·붙이기 시트·링크 시트는 **퀴즈가 있어야** 열린다.
 * ★format 은 서버의 `quiz_known_formats()` 에 있는 이름이어야 한다('choices' 는 없다 — fail-closed
 *   로 손님에게 한 건도 안 나간다). 끝나면 지운다.
 *
 * ★★2026-08-26: 노하우를 **여러 분류로 여러 건** 심는다. 그 전에는 짧은 제목 하나뿐이라
 *   만들기 2단계의 카테고리 칩이 두 개밖에 안 서고 제목도 안 넘쳐서, 실제로 났던 실패
 *   (칩 줄이 프레임 밖 657px · 긴 제목 잘림)를 **하니스가 만들어 내지 못했다**. 조건을 못 만드는
 *   하니스는 초록이어도 아무것도 보증하지 않는다 — 최악을 심고 재는 것이 이 파일의 일이다.
 */
const SEED_KNOWHOW = [
  { section: '오픈 준비', title: '오픈 청소 순서' },
  { section: '마감 정리', title: '마감 시재 정산' },
  { section: '손님 응대', title: '사장 부재 시 결정 권한 — 직원이 결정 가능한 것/아닌 것' },
  { section: '재료 관리', title: '냉장고 온도 점검' },
  { section: '위생 점검', title: '주방 바닥 배수구 청소' },
  { section: '기계 다루기', title: '에스프레소 머신 청소' },
];
async function seedQuiz(accessToken) {
  const db = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: u } = await db.auth.getUser(accessToken);
  const uid = u?.user?.id;
  const { data: prof } = await db.from('profiles').select('unit_id').eq('id', uid).maybeSingle();
  const UNIT = prof?.unit_id;
  if (!UNIT) return null;
  const sfx = String(Date.now()).slice(-8);
  const courseId = `tc_ui${sfx}`, itemId = `qz_ui${sfx}`;
  const now = new Date().toISOString();
  const entryIds = SEED_KNOWHOW.map((_, i) => `pb_ui${sfx}_${i}`);
  const entryId = entryIds[0];   // 퀴즈에 담는 것은 첫 건 하나면 된다
  for (let i = 0; i < SEED_KNOWHOW.length; i++) {
    await db.from('playbook_entries').insert({
      id: entryIds[i], unit_id: UNIT, creator_id: uid, creator_name: 'QA사장',
      category: 'Know-how', subcategory: '일반', title: SEED_KNOWHOW[i].title, tags: [], search_keywords: ['UI실측'],
      square: { situation: '마감 때 가스 밸브를 잠가요.', action: { steps: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
      execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
      stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
      photos: [], version: 1, status: 'published', quality_score: 0.6,
      created_at: now, updated_at: now, is_template: false, pack_id: null,
      needs_review: false, correction_points: [], section: SEED_KNOWHOW[i].section, order_index: i,
    });
  }
  await db.from('training_courses').insert({
    id: courseId, unit_id: UNIT, key: `q_${courseId}`, name: 'UI 실측 퀴즈',
    description: null, preset: null, min_items: 1, max_items: 10,
    due_days: null, start_at: null, answer_days: null, position: 0, active: true,
  });
  await db.from('course_entries').insert({ course_id: courseId, entry_id: entryId, unit_id: UNIT });
  await db.from('quiz_items').insert({
    id: itemId, unit_id: UNIT, entry_ids: [entryId], kind: 't3', format: 'mc4',
    payload: { ask: '마감 때 무엇을 잠그나요?', choices: ['가스 밸브', '창문', '냉장고', '에어컨'], answer_index: 0, explain: '가스 밸브를 잠가요.' },
    status: 'active', source: 'owner', created_by: uid, created_at: now, source_updated_at: now,
  });
  // 보관함(2026-08-26) — 보관한 퀴즈가 0건이면 상단바 진입로 자체가 안 선다. 한 건 심어 실제로 연다.
  const archivedId = `tc_ar${sfx}`;
  await db.from('training_courses').insert({
    id: archivedId, unit_id: UNIT, key: `q_${archivedId}`, name: 'UI 실측 보관 퀴즈',
    description: null, preset: null, min_items: 1, max_items: 10,
    due_days: null, start_at: null, answer_days: null, position: 1, active: false,
  });

  return {
    courseId,
    cleanup: async () => {
      await db.from('quiz_items').delete().eq('id', itemId);
      await db.from('course_entries').delete().eq('course_id', courseId);
      await db.from('training_courses').delete().eq('id', courseId);
      await db.from('training_courses').delete().eq('id', archivedId);
      for (const id of entryIds) await db.from('playbook_entries').delete().eq('id', id);
    },
  };
}

async function main() {
  const sess = await session();
  const seeded = await seedQuiz(sess.access_token).catch((e) => { console.log('  (시드 실패:', String(e).slice(0, 100), ')'); return null; });
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: FRAME, height: 900 } });
  // ★개발 서버 번들은 Chromium 이 **100초 넘게** 파싱한다(2026-08-26 실측). 프로덕션 얘기가 아니라
  //   dev 번들의 특성이다 — 여기서 타임아웃을 짧게 잡으면 제품이 아니라 하니스가 죽는다.
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(sess)]);

  const see = (t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
  const wait = (t, ms = 180000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const tapLabel = (l) => page.getByLabel(l, { exact: true }).last().dispatchEvent('click').catch(() => {});
  const tapText = (t) => page.getByText(t, { exact: false }).first().dispatchEvent('click').catch(() => {});
  const settle = () => page.waitForTimeout(900);      // Appear(280ms)+Collapse(200ms) 가 끝난 뒤에 잰다
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});

  const scan = async (name, file) => {
    await settle();
    await shot(file);
    report(name, await page.evaluate(MEASURE));
  };

  /**
   * 주소로 직접 들어가는 것은 **한 번만** 한다.
   * ★개발 서버는 이동할 때마다 번들을 처음부터 다시 파싱한다(~100초). 그 사이 화면은 스플래시인데,
   *   기다림이 모자라면 하니스가 **스플래시를 재고 "통과"라고 말한다**(2026-08-26에 실제로 그랬다:
   *   1단계 스크린샷이 전부 로고 화면이었는데 측정은 전부 초록이었다). 그래서
   *   ① 앱이 떴다는 표식을 확인하기 전에는 재지 않고 ② 나머지는 **앱 안에서** 이동한다.
   */
  const boot = async (path, marker) => {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'commit' });
    const ok = await wait(marker, 240000);
    check(`진입 ${path}`, ok, ok ? '' : '앱이 안 떴다(스플래시에서 멈춤)');
    return ok;
  };
  /** 화면이 데이터를 다 받을 때까지 — 로딩 문구가 사라지면 도착이다. */
  const settled = () =>
    page.waitForFunction(() => !document.body.innerText.includes('불러오는 중'), null, { timeout: 120000 }).catch(() => {});

  try {
    // ── 1. 퀴즈 홈(대시보드) ────────────────────────────────────────────
    console.log('\n[1] 퀴즈 홈 /owner/training');
    if (await boot('/owner/training', '퀴즈')) {
      await settled();
      await scan('퀴즈 홈', '01-training');

      if (await see('만들다 만 퀴즈')) {
        await tapText('만들다 만 퀴즈');
        await scan('퀴즈 홈(만들다 만 것 펼침)', '02-training-drafts');
      }
      // 보관함 — 보관한 퀴즈가 있을 때만 상단바에 선다(0건이면 진입로 자체가 없다).
      if (await see('보관함')) {
        await tapText('보관함');
        if (await wait('보관한 퀴즈는', 15000)) await scan('보관함 시트', '02b-archive-sheet');
        await tapLabel('닫기');
        await settle();
      }
    }

    // ── 2. 퀴즈 만들기 — **앱 안에서** 이동한다(다시 번들을 파싱하지 않게) ──
    //     ★만들기는 헤더가 아니라 히어로 아래 Primary 다(2026-08-26 B안). 두 문구 중 하나가 선다.
    console.log('\n[2] 퀴즈 만들기 /owner/quiz-new');
    if (await see('아직 안 물어본 노하우로 만들기')) await tapLabel('아직 안 물어본 노하우로 만들기');
    else await tapLabel('퀴즈 만들기');
    const onNew = await wait('누가 풀 건가요', 60000);
    check('만들기 진입', onNew);
    if (onNew) {
      await scan('만들기 1단계(기본 설정)', '03-new-step1');

      await tapLabel('외부 사람');
      await scan('만들기 1단계(외부)', '04-new-step1-guest');

      // 파트 추가 시트(칩 줄 안 입력칸을 대체한 자리)
      await tapLabel('+ 직접 추가');
      if (await wait('파트 추가', 15000)) {
        await scan('파트 추가 시트', '04b-part-sheet');
        await tapLabel('닫기');            // ★Escape 로는 안 닫힌다 — 시트의 닫기 버튼을 실제로 누른다
        await settle();
      }
      check('파트 시트가 닫힘', !(await see('파트 추가')));

      // 2단계 — 노하우 고르기(찾기 바가 노하우 화면과 같은 형태인지)
      await tapLabel('노하우 고르기');
      // ★placeholder 는 텍스트 노드가 아니라 getByText 로 안 잡힌다(2026-08-26에 이걸로 헛짚었다).
      //   화면에 **글자로 있는** 것을 기다린다.
      const onStep2 = await wait('고른 노하우에서 문제를 만들어요', 60000);
      check('2단계 진입', onStep2);
      if (onStep2) await scan('만들기 2단계(노하우 고르기)', '04c-new-step2');
    }

    // ── 3. 퀴즈 상세 ────────────────────────────────────────────────────
    console.log('\n[3] 퀴즈 상세 /owner/quiz/[id]');
    if (seeded && (await boot(`/owner/quiz/${seeded.courseId}`, 'UI 실측 퀴즈'))) {
      await settled();
      await scan('퀴즈 상세', '05-detail');

      await tapText('문항');
      await scan('퀴즈 상세(문항)', '06-detail-items');

      // ⋯ → 이 업무에 붙이기 (사장이 지목한 깨진 시트)
      await tapLabel('더보기');
      const onMore = await wait('이 업무에 붙이기', 15000);
      check('더보기 시트 열림', onMore);
      if (onMore) {
        await tapText('이 업무에 붙이기');
        if (await wait('붙이면 그 업무를', 15000)) await scan('붙이기 시트', '07-attach-sheet');
        await tapLabel('닫기');
        await settle();
      }
      // ⋯ → 링크 만들기 (달력으로 바뀐 자리)
      await tapLabel('더보기');
      if (await wait('링크 만들기', 15000)) {
        await tapText('링크 만들기');
        const onLink = await wait('언제까지 열어 둘까요', 15000);
        check('링크 시트 열림', onLink);
        if (onLink) await scan('링크 시트', '08-link-sheet');
      }
    } else if (!seeded) {
      check('퀴즈 상세 진입', false, '시드에 실패해 상세를 못 열었다');
    }

    check('L6 콘솔 에러 0', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (seeded) await seeded.cleanup().catch(() => {});
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  통과 ${pass} · 실패 ${fail}   (스크린샷: ${SHOTS})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
