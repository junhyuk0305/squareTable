// qa-quiz-create-flow.mjs — 퀴즈 "만들기" 5단계를 **끝까지 한 번** 통과시킨다(2026-08-27).
//
// 왜 필요한가: 5단계 재배치(2026-08-26) 이후 완주 실측이 0회였다. 게이트는 전부 초록인데
// 아무도 이 흐름을 끝까지 밟은 적이 없다 — 개수만 세는 검사가 채점 누락을 5개월 통과시킨 것과 같은 자리다.
//
// 재는 것(개수가 아니라 실제로 일어난 일):
//   ① 각 단계에서 멈추는가            — 다음 단계 표식이 실제로 뜨는가
//   ② 생성이 몇 문항 나오는가          — 4단계 문구가 아니라 **DB 의 quiz_items 행**으로 센다
//   ③ 저장된 것이 DB 에 실제로 있는가  — 코스·course_entries·quiz_items·assignments
//   ④ 콘솔 에러 0
//   ⑤ 460px 안에서 가로 넘침이 없는가
//
// ★엣지 호출: quiz_item 은 **AI 캡 비차감**이다(ai/index.ts 라우팅 denylist). Gemini 실비만 든다.
// 계정: 고정 QA 계정만 쓴다(새로 만들지 않는다).
// 실행: node scripts/qa-quiz-create-flow.mjs [--keep]
//   --keep 을 주면 만든 것을 지우지 않는다(화면에서 눈으로 볼 때).
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
const EMAIL = process.env.QA_EMAIL ?? 'owner@pilot.squaretable.app';
const PW = process.env.QA_PASSWORD ?? 'pilot1234';
const KEEP = process.argv.includes('--keep');
const SHOTS = './qa-shots/quiz-create';
const FRAME = 460;
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON) { console.error('FAIL: .env 의 SUPABASE URL/ANON 필요'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };
const note = (n, v) => console.log('  ·', n, '=', v);

const projectRef = new URL(URL_).hostname.split('.')[0];
async function session() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`로그인 실패(${EMAIL}): ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

async function main() {
  const sess = await session();
  // 사용자 토큰으로 읽는다 — service_role 로 보면 RLS 밖의 것까지 보여 화면과 어긋난다.
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${sess.access_token}` } }, auth: { persistSession: false } });
  const uid = sess.user.id;
  const { data: prof } = await db.from('profiles').select('active_unit_id').eq('id', uid).single();
  const UNIT = prof?.active_unit_id;
  if (!UNIT) throw new Error('active_unit_id 없음');
  note('매장', UNIT);

  // 재료 — 화면이 2단계에서 보여 줄 것과 같은 조건(발행된 것). 첫 건을 고른다.
  const { data: pool } = await db.from('playbook_entries')
    .select('id,title,status').eq('unit_id', UNIT).neq('status', 'draft').order('created_at', { ascending: false });
  check('재료(발행 노하우) 1건 이상', (pool ?? []).length > 0, `${(pool ?? []).length}건`);
  if (!pool?.length) return;
  const target = pool[0];
  note('고를 노하우', `${target.title} (${target.id})`);

  const before = await db.from('training_courses').select('id').eq('unit_id', UNIT);
  const courseIdsBefore = new Set((before.data ?? []).map((r) => r.id));

  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: FRAME, height: 900 } });
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${projectRef}-auth-token`, JSON.stringify(sess)]);

  const wait = (t, ms = 180000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const tapLabel = (l) => page.getByLabel(l, { exact: true }).last().dispatchEvent('click').catch(() => {});
  const tapText = (t) => page.getByText(t, { exact: false }).first().dispatchEvent('click').catch(() => {});
  const settle = () => page.waitForTimeout(900);
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
  // L1 — 460px 밖으로 흐르는가. 문서 자체만 본다(스크롤 줄은 정상 형태라 세지 않는다).
  const overflow = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  const at = async (label, file) => {
    await settle(); await shot(file);
    const px = await overflow();
    check(`${label} · 460px 가로 넘침 없음`, px === 0, `+${px}px`);
  };

  // 하니스가 **새로 만든** 문항만 골라내기 위한 기준선. 원래 있던 문항은 건드리지 않는다.
  const itemsBefore = await db.from('quiz_items').select('id').eq('unit_id', UNIT).contains('entry_ids', [target.id]);
  const itemIdsBefore = new Set((itemsBefore.data ?? []).map((r) => r.id));

  const made = { courseId: null, itemIds: [] };
  try {
    console.log('\n[1] 1단계 기본 설정');
    await page.goto(`${ORIGIN}/owner/quiz-new`, { waitUntil: 'commit' });
    // ★dev 번들 파싱이 100초 넘는다 — 표식을 보기 전에는 아무것도 재지 않는다(스플래시를 재는 사고 방지).
    check('앱이 떴다(1단계 표식)', await wait('누가 풀 건가요?', 240000), '스플래시에서 멈춤');
    await at('1단계', '01-step1');

    const qname = `QA완주 ${String(Date.now()).slice(-6)}`;
    await page.getByLabel('퀴즈 이름', { exact: true }).first().fill(qname).catch(() => {});
    note('퀴즈 이름', qname);
    await tapText('노하우 고르기');

    console.log('\n[2] 2단계 노하우 고르기');
    check('2단계 진입', (await wait('노하우 검색', 60000)) || (await wait(target.title, 60000)), '목록이 안 떴다');
    await at('2단계', '02-step2');
    await tapLabel(target.title);
    await settle();
    const cta = await page.getByText('개로 문제 만들기', { exact: false }).first().innerText().catch(() => '');
    check('고른 것이 CTA 에 반영', /^1개로/.test(cta.trim()), `CTA="${cta.trim()}"`);
    await tapText('개로 문제 만들기');

    console.log('\n[3] 3단계 만드는 중');
    check('3단계 진입', await wait('20~30초 걸려요', 60000), '생성 화면이 안 떴다');
    await at('3단계', '03-step3');

    console.log('\n[4] 4단계 문항 검토');
    // 만들어졌든 못 만들었든 4단계 문구가 뜬다 — 둘 다 기다린다(하나만 기다리면 실패를 타임아웃으로 오해한다).
    const ok4 = await Promise.race([
      wait('개가 만들어졌어요', 240000),
      wait('아직 만들어진 문항이 없어요', 240000),
    ]);
    check('4단계 진입', ok4, '검토 화면이 안 떴다');
    await at('4단계', '04-step4');
    const lead = await page.getByText('만들어', { exact: false }).first().innerText().catch(() => '');
    note('4단계 문구', lead.trim());

    // ★화면 문구가 아니라 DB 로 센다. "N개 생성됨"은 통과 근거가 아니다.
    const { data: after } = await db.from('training_courses').select('id,name,active,start_at').eq('unit_id', UNIT);
    const fresh = (after ?? []).filter((r) => !courseIdsBefore.has(r.id));
    check('코스가 DB 에 생겼다', fresh.length === 1, `${fresh.length}건`);
    made.courseId = fresh[0]?.id ?? null;
    note('코스 id', made.courseId);
    const { data: ce } = await db.from('course_entries').select('entry_id').eq('course_id', made.courseId ?? '');
    check('고른 노하우가 코스에 붙었다', (ce ?? []).some((r) => r.entry_id === target.id), JSON.stringify(ce));
    const { data: items } = await db.from('quiz_items').select('id,format,kind,status,payload,created_at').eq('unit_id', UNIT).contains('entry_ids', [target.id]).order('created_at', { ascending: false });
    const activeItems = (items ?? []).filter((r) => r.status === 'active' && !itemIdsBefore.has(r.id));
    made.itemIds = activeItems.map((r) => r.id);
    check('문항이 DB 에 저장됐다', activeItems.length > 0, `${activeItems.length}개`);
    for (const it of activeItems.slice(0, 3)) {
      note('문항', `${it.format}/${it.kind} · ${JSON.stringify(it.payload).slice(0, 240)}`);
    }

    console.log('\n[5] 5단계 받는 사람');
    await tapText('받는 사람 고르기');
    check('5단계 진입', await wait('받는', 60000), '받는 사람 화면이 안 떴다');
    await at('5단계', '05-step5');
    // 받는 사람 = 이 매장 멤버. 화면 라벨은 이름이라 DB 에서 이름을 가져와 그대로 누른다.
    const { data: mem } = await db.from('unit_members').select('user_id,role').eq('unit_id', UNIT);
    const otherIds = (mem ?? []).filter((m) => m.user_id !== uid).map((m) => m.user_id);
    const { data: names } = await db.from('profiles').select('id,name').in('id', otherIds.length ? otherIds : ['-']);
    note('받는 사람 후보', (names ?? []).map((n) => n.name).join(', ') || '없음');
    for (const n of (names ?? []).slice(0, 1)) await tapLabel(n.name);
    await settle();
    const sendLabel = await page.getByText('에게 보내', { exact: false }).first().innerText().catch(() => '');
    check('보내기 버튼이 살아났다', /^[1-9]/.test(sendLabel.trim()), `버튼="${sendLabel.trim()}"`);
    await tapText('에게 보내');

    console.log('\n[6] 발행 결과');
    // 내부 발송은 코스 상세로 이동한다(router.replace). 그 화면이 뜨면 끝까지 간 것이다.
    const done = await wait('문항', 120000);
    check('발행 후 상세로 이동', done && page.url().includes('/owner/quiz/'), `url=${page.url()}`);
    await at('6단계(상세)', '06-detail');
    const { data: asg } = await db.from('quiz_assignments').select('id,user_id,scheduled_on').eq('course_id', made.courseId ?? '');
    check('발송원장이 DB 에 남았다', (asg ?? []).length > 0, `${(asg ?? []).length}건`);

    check('L6 콘솔 에러 0', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (made.courseId && !KEEP) {
      // 내가 만든 것만 지운다. 재료 노하우와 원래 있던 문항은 건드리지 않는다
      // (itemIdsBefore 로 걸러 이번에 생긴 것만 지운다 — 매장 자산을 하니스가 축내면 안 된다).
      await db.from('quiz_assignments').delete().eq('course_id', made.courseId);
      await db.from('course_entries').delete().eq('course_id', made.courseId);
      await db.from('training_courses').delete().eq('id', made.courseId);
      for (const id of made.itemIds) await db.from('quiz_items').delete().eq('id', id);
      console.log(`\n  (정리: 코스·course_entries·assignments·이번에 만든 문항 ${made.itemIds.length}개 삭제)`);
    }
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  통과 ${pass} · 실패 ${fail}   (스크린샷: ${SHOTS})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(2); });
