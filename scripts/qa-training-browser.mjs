// qa-training-browser.mjs — 퀴즈 코스(0099 → 0108 v2) 실브라우저 E2E (실 백엔드 + expo web dev 서버).
//
// ★ 화면 문구는 "퀴즈", 코드·라우트·DB 는 training 그대로다(2026-08-03 개명). 기대값은 화면 문구를 쓴다.
// ★ v2 부터 코스는 하드코딩 2종이 아니라 사장이 프리셋에서 만드는 행이다 — 코스 만들기가 선행 단계다.
//
//   [사장 /owner/training]
//   T1  직원·급여 → "퀴즈" 카드 → 퀴즈 화면(프리셋 고르기) → '첫 출근' 만들기 → 추천 시트 → 미달 안내
//   T2  새 문답: 글자수 힌트(10자 미만 경고 → 충족 문구 전환) → "퀴즈에 추가" → 목록 1행
//   T3  기존 노하우로 추가: 시트 → 시드 노하우 탭 → 목록 2행
//   T4  3개째 추가 → 항목은 찼지만 문항 0개 → '준비됨'이 아니라 "문제부터 만들어 주세요"
//   T5  항목 액션 시트: 아래로 이동(순서 스왑) · 퀴즈에서 빼기(목록 2행 + 미달 안내 복귀) → 재추가
//   T6  종류 추가 → '정기 점검' 프리셋 → 주기 안내(1달마다) · 비운영 상태
//   T7  허브 현황 "퀴즈" 섹션 노출
//   [직원 업무 채팅]
//   T8  TrainingCard: 제목=코스 이름('첫 출근') · 진행 0/3 · 전체 펼침(상태칩 다음/대기)
//   T9  "혼자 할 수 있어요" → 이해 확인 시트 → 실 AI 문항 렌더
//   T10 콘솔 에러 0(치명 오류 무음 감지)
//
// 실행: node scripts/qa-training-browser.mjs   (.env+.env.seed, QA_ORIGIN 기본 localhost:8081)
// 자가정리: delete_my_account ×2 + OTP 시드 정리. 스크린샷 → ./qa-shots/training/
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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
const SHOTS = './qa-shots/training';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const projectRef = new URL(URL_).hostname.split('.')[0];
async function passwordSession(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

async function main() {
  // ── 셋업(노드): 사장+매장(multi 활성)+직원 합류, 발행 노하우 2건(픽커·퀴즈 소스) ──
  const owner = mk(), junior = mk();
  const phoneO = `0107${s.slice(0, 7)}`, phoneJ = `0108${s.slice(0, 7)}`;
  await seedVerifiedPhones(URL_, SRV, [phoneO, phoneJ]);
  const oEmail = `qa_trb_o_${s}@example.com`, jEmail = `qa_trb_j_${s}@example.com`;
  const oUp = await owner.auth.signUp({ email: oEmail, password: pw, options: { data: { name: 'QA훈련사장', role: 'owner', phone: phoneO, birth_date: '1980-01-15' } } });
  if (oUp.error) throw new Error('owner signUp: ' + oUp.error.message);
  const ownerId = oUp.data.user?.id;
  const jUp = await junior.auth.signUp({ email: jEmail, password: pw, options: { data: { name: 'QA훈련직원', role: 'junior', phone: phoneJ, birth_date: '2000-05-05' } } });
  if (jUp.error) throw new Error('junior signUp: ' + jUp.error.message);
  const juniorId = jUp.data.user?.id;

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA훈련카페', p_industry: '카페·디저트', p_biz_no: null });
  const storeRow = Array.isArray(c1) ? c1[0] : c1;
  if (e1 || !storeRow?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = storeRow.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  await junior.rpc('join_by_invite', { p_code: storeRow.invite_code });
  const { error: apErr } = await owner.rpc('approve_member', { p_uid: juniorId });
  if (apErr) throw new Error('approve_member: ' + apErr.message);
  await junior.rpc('switch_active_unit', { p_unit_id: UNIT });

  const now = new Date().toISOString();
  const mkEntry = (id, title, situation) => ({
    id, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA훈련사장',
    category: 'Know-how', subcategory: '일반', title, tags: [], search_keywords: [title],
    square: { situation, action: { steps: [], scripts: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.6,
    created_at: now, updated_at: now, is_template: false, pack_id: null,
    needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  {
    const { error } = await owner.from('playbook_entries').insert([
      mkEntry(`pb_trb1_${s}`, '원두 채우기', '그라인더 호퍼가 3분의 1 밑으로 내려가면 새 원두를 채워요. 봉투에 개봉일을 적고 오래된 원두부터 써요.'),
      mkEntry(`pb_trb2_${s}`, '가스 밸브 잠그기', '마감 때 주방 가스 밸브를 잠그고 손으로 한 번 더 확인해요. 냄새가 나면 환기부터 하고 바로 전화 주세요.'),
    ]);
    if (error) throw new Error('노하우 시드: ' + error.message);
  }

  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (email) => {
    const session = await passwordSession(email);
    const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
    page.setDefaultTimeout(25000);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
    await page.addInitScript(([key, val]) => localStorage.setItem(key, val), [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);
    return page;
  };
  const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
  const see = (page, t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
  const wait = (page, t, timeout = 20000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const tap = async (page, t) => { await page.getByText(t, { exact: false }).first().dispatchEvent('click'); };
  // 스택 내비로 이전 화면 텍스트가 DOM에 남는다 — 시트 닫기·프리셋 카드처럼 텍스트가 겹치는
  // 대상은 부분일치가 위험하므로 accessibilityLabel(aria-label)로 집는다.
  const tapLabel = async (page, l) => { await page.getByLabel(l, { exact: true }).last().dispatchEvent('click'); };

  try {
    // ════ 사장 ════
    const po = await newPage(oEmail);
    console.log('\n[사장] 진입점 → 퀴즈 화면 → 코스 만들기');
    await po.goto(`${ORIGIN}/owner/staff`, { waitUntil: 'domcontentloaded' });
    const hasEntryCard = await wait(po, '첫 출근(신입 첫날)과 정기 점검', 30000);
    check('T1a 직원·급여에 퀴즈 카드', hasEntryCard);
    await tap(po, '첫 출근(신입 첫날)과 정기 점검');
    const onTraining = await wait(po, '어떤 퀴즈부터 만들까요');
    check('T1b 퀴즈 화면 진입(코스 0개 → 프리셋 고르기)', onTraining);
    await shot(po, '01-preset-onboarding');
    // 프리셋 '첫 출근' 만들기 → 코스 행만 생기고 담을 업무는 추천 시트에서 사장이 고른다(계약 §3).
    await tapLabel(po, '첫 출근 만들기');
    check('T1c 만들기 토스트', await wait(po, '첫 출근을(를) 만들었어요'));
    check('T1d 추천 업무 담기 시트', await wait(po, '담을 업무 고르기'));
    await shot(po, '01b-recommend');
    await tapLabel(po, '닫기'); // 추천은 건너뛰고 아래 T2·T3 경로로 담는다
    check('T1e 미달 안내(3개부터 공개)', await wait(po, '비어 있음 · 3개부터 공개'));
    await shot(po, '01c-training-empty');

    console.log('\n[사장] 새 문답 추가 + 글자수 힌트');
    await tap(po, '새로 만들기');
    await wait(po, '맡길 업무는 무엇인가요');
    // 스택 내비 특성상 이전 화면(직원·급여 시급 input 등)이 DOM에 남는다 → placeholder 로만 집는다.
    const nameInput = po.getByPlaceholder('예) 오픈 청소');
    await nameInput.click();
    await nameInput.pressSequentially('오픈 청소', { delay: 5 });
    const howInput = po.getByPlaceholder('예) 문 열고 포스 켜기', { exact: false });
    await howInput.click();
    await howInput.pressSequentially('문 열고', { delay: 5 });
    check('T2a 짧은 입력 → 글자수 경고', await see(po, '자 이상 적어 주세요'));
    await howInput.pressSequentially(' 포스 켜고 시재 5만원 확인, 머신 예열 순서로 해요. 시재가 안 맞으면 바로 알려 주세요.', { delay: 3 });
    check('T2b 충족 → 안내 문구 전환', await wait(po, '자세할수록 이해 확인 문제가'));
    await shot(po, '02-form-filled');
    await tap(po, '퀴즈에 추가');
    check('T2c 추가 토스트', await wait(po, '첫 출근에 추가했어요'));
    check('T2d 목록 1행(오픈 청소)', await wait(po, '오픈 청소'));

    console.log('\n[사장] 기존 노하우로 추가');
    await tap(po, '기존 노하우로 추가');
    // placeholder 는 getByText 로 안 잡힌다 — 검색 input 자체의 노출로 판정.
    const pickerUp = await po.getByPlaceholder('예) 마감, 발주').waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    check('T3a 선택 시트 열림', pickerUp);
    const pickRow = await wait(po, '원두 채우기');
    check('T3b 시드 노하우 노출', pickRow);
    await shot(po, '03-picker');
    await tap(po, '원두 채우기');
    check('T3c 추가 토스트', await wait(po, '첫 출근에 추가했어요'));
    check('T3d 문항 0개 안내(2개)', await wait(po, '문제 없는 업무 2개 · 문제부터 만들어 주세요'));

    console.log('\n[사장] 3개째 → 항목은 찼지만 문항 0개');
    await tap(po, '기존 노하우로 추가');
    await wait(po, '가스 밸브 잠그기');
    await tap(po, '가스 밸브 잠그기');
    await wait(po, '첫 출근에 추가했어요');
    // ★ 항목 수만 보던 옛 판정은 문항이 0개인데도 '준비됨'을 띄웠다. 지금은 문항까지 봐야 초록이다.
    check('T4 문항 0개면 준비됨 아님', await wait(po, '문제 없는 업무 3개 · 문제부터 만들어 주세요'));
    await shot(po, '04-ready');

    console.log('\n[사장] 항목 액션: 이동·빼기');
    await tap(po, '오픈 청소'); // 1번 항목 → 액션 시트
    const sheetUp = await wait(po, '아래로 이동');
    check('T5a 액션 시트(이동·빼기)', sheetUp && (await see(po, '퀴즈에서 빼기')) && (await see(po, '노하우 수정')));
    await shot(po, '05-action-sheet');
    await tap(po, '아래로 이동');
    await po.waitForTimeout(1500);
    await shot(po, '05b-after-move');
    // 순서 검증은 DB(진실)로 — DOM 전수 텍스트 스캔은 중첩 div 때문에 순서 판정이 부정확했다.
    const { data: posRows } = await owner.from('training_items').select('template_id, position').eq('course', 'first_day').order('position');
    const { data: tmplRows } = await owner.from('work_templates').select('id, text');
    const textOf = new Map((tmplRows ?? []).map((r) => [r.id, r.text]));
    const orderTexts = (posRows ?? []).map((r) => textOf.get(r.template_id));
    check('T5b 아래로 이동 → 순서 스왑(DB)', orderTexts[0] === '원두 채우기' && orderTexts[1] === '오픈 청소', JSON.stringify(orderTexts));
    await tap(po, '오픈 청소'); // 이제 2번
    await wait(po, '퀴즈에서 빼기');
    await tap(po, '퀴즈에서 빼기');
    check('T5c 빼기 토스트(업무·노하우 보존 안내)', await wait(po, '업무와 노하우는 남아요'));
    check('T5d 미달 안내 복귀(2개)', await wait(po, '문제 없는 업무 2개 · 문제부터 만들어 주세요'));
    // 직원 카드 검증을 위해 3개로 복구 — 픽커에서 방금 뺀 항목의 노하우(오픈 청소)를 재선택.
    await tap(po, '기존 노하우로 추가');
    await wait(po, '오픈 청소');
    await tap(po, '오픈 청소');
    await wait(po, '첫 출근에 추가했어요');
    await wait(po, '문제 없는 업무 3개 · 문제부터 만들어 주세요');

    console.log('\n[사장] 종류 추가 → 정기 점검');
    // v2 부터 '정기 점검'은 기본 제공이 아니라 사장이 프리셋에서 만든다.
    await tapLabel(po, '퀴즈 종류 추가');
    await wait(po, '어떤 퀴즈부터 만들까요');
    await tapLabel(po, '정기 점검 만들기');
    check('T6a 정기 점검 만들기', await wait(po, '정기 점검을(를) 만들었어요'));
    await wait(po, '담을 업무 고르기');
    await tapLabel(po, '닫기');
    check('T6b 주기 안내(1달마다)', await wait(po, '1달마다'));
    check('T6c 비운영 상태', await see(po, '아직 없어요'));
    await shot(po, '06-regular-empty');

    console.log('\n[사장] 허브 현황 진입점');
    await po.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
    const hubTraining = await wait(po, '첫 출근(신입 첫날)과 정기 점검(주기 재확인)', 30000);
    check('T7 허브 현황 "퀴즈" 섹션', hubTraining);
    await shot(po, '07-hub');
    await po.close();

    // ════ 직원 ════
    console.log('\n[직원] 업무 채팅 퀴즈 카드');
    const pj = await newPage(jEmail);
    await pj.goto(`${ORIGIN}/junior/work`, { waitUntil: 'domcontentloaded' });
    const cardUp = await wait(pj, '다음 퀴즈', 30000);
    check('T8a TrainingCard 노출(제목=코스 이름·다음 퀴즈)', cardUp && (await see(pj, '첫 출근')));
    check('T8b 진행 0/3', await see(pj, '0/3'));
    await shot(pj, '08-junior-card');
    await tap(pj, '전체 3개 보기');
    const chips = (await see(pj, '다음')) && (await see(pj, '대기'));
    check('T8c 전체 펼침 + 상태칩(다음·대기)', chips);
    await shot(pj, '09-junior-expanded');

    console.log('\n[직원] 이해 확인 시트(실 AI)');
    await tap(pj, '혼자 할 수 있어요');
    const quizHead = await wait(pj, '이해 확인 ·', 15000);
    check('T9a 이해 확인 시트', quizHead);
    // 실 AI 문항 생성 대기 — 문항 라디오(1.)가 뜨는지.
    const q1 = await wait(pj, '1.', 40000);
    check('T9b 문항 렌더(실 AI)', q1);
    await shot(pj, '10-junior-quiz');
    await pj.close();

    const fatal = errors.filter((e) => !/favicon|manifest|source map|net::ERR_ABORTED/i.test(e));
    check('T10 콘솔 에러 0', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    try { await junior.rpc('delete_my_account'); } catch { /* noop */ }
    try { await owner.rpc('delete_my_account'); } catch { /* noop */ }
    await cleanupSeededPhones(URL_, SRV, [phoneO, phoneJ]).catch(() => {});
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 퀴즈 브라우저 QA · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
