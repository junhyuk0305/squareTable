// qa-quiz-formats-browser.mjs — 0158 신규 문항 형태 3종의 **실브라우저 실측**.
//
// 서버 채점은 qa-training.mjs ⑦B 가 이미 본다. 여기서 보는 것은 그게 아니라 **손가락이 닿는 쪽**이다:
//   · 렌더러가 실제로 그려지는가(레지스트리에 등록만 하고 화면이 빈 채로 나가는 사고 방지)
//   · 탭이 실제로 먹고, 서버 채점 왕복 뒤 정답/오답 표시가 그려지는가
//   · 콘솔 에러 0
// 2026-08-05 메모리의 "브라우저 검증 0회로 배포" 전례를 반복하지 않기 위한 게이트다.
//
// 로그인 없이 도는 게스트 링크(/q/[token])를 태운다 — 세션 주입이 필요 없어 가장 짧은 실측 경로다.
//
// 실행: npm run web 을 띄운 뒤  node scripts/qa-quiz-formats-browser.mjs
//       (.env + .env.seed 필요, QA_ORIGIN 기본 localhost:8081)
// 자가정리: delete_my_account + OTP 시드 정리. 스크린샷 → ./qa-shots/quiz-formats/
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
const SHOTS = './qa-shots/quiz-formats';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });

const s = String(Date.now()).slice(-9);
const PW = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

// ── 문항 정의 — 브라우저에서 무엇을 눌러야 하는지까지 여기 한 곳에 둔다 ──────
const ASK_ORDER = '마감 순서대로 눌러 주세요';
const ASK_SCALE = '시럽이 더 많이 들어가는 쪽은?';
const ASK_BRANCH = '포장 주문으로 음료 3잔이 나왔어요';
// items 는 섞인 채로 저장된다 — 맞는 순서는 answer_seq 가 가리킨다(포스 정산 → 바닥 청소 → 가스 잠그기).
const ORDER_ITEMS = ['바닥 청소', '포스 정산', '가스 잠그기'];
const ORDER_RIGHT = ['포스 정산', '바닥 청소', '가스 잠그기'];
const ORDER_WRONG = ['바닥 청소', '포스 정산', '가스 잠그기'];

async function main() {
  const phones = [`0106${s.slice(0, 7)}`];
  await seedVerifiedPhones(URL_, SRV, phones);
  const owner = mk();

  // ── 셋업 ────────────────────────────────────────────────────────────────
  console.log('\n━━ 셋업 ━━');
  const { data: su, error: se } = await owner.auth.signUp({
    email: `qa_qf_o_${s}@example.com`, password: PW,
    options: { data: { birth_date: '1994-03-03', name: 'QA사장', role: 'owner', phone: phones[0], store_name: 'QF', industry: '카페·디저트' } },
  });
  if (se || !su.session) throw new Error(`signUp: ${se?.message ?? 'no session'}`);
  await owner.auth.setSession({ access_token: su.session.access_token, refresh_token: su.session.refresh_token });
  const ownerId = su.user.id;

  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'QF 형태매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  const UNIT = c1?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('매장 생성', !!UNIT, `unit=${UNIT}`);

  const now = new Date().toISOString();
  const E1 = `pb_qf1_${s}`;
  {
    const { error } = await owner.from('playbook_entries').insert([{
      id: E1, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장',
      category: 'Know-how', subcategory: '일반', title: '마감 순서', tags: [], search_keywords: ['마감'],
      square: {
        situation: '마감할 때', action: { steps: [] }, extract: { do: '', dont: '' },
        result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '',
      },
      execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
      stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 },
      photos: [], version: 1, status: 'published', quality_score: 0.6,
      created_at: now, updated_at: now, is_template: false, pack_id: null,
      needs_review: false, correction_points: [], section: null, order_index: 0,
    }]);
    check('노하우 1건 발행', !error, error?.message ?? '');
  }

  const CID = `tc_qf_${s}`;
  {
    const { error } = await owner.from('training_courses').insert({
      id: CID, unit_id: UNIT, key: 'first_day', name: '첫 출근', description: '형태 실측',
      preset: 'first_day', min_items: 1, max_items: 5, due_days: null, position: 0,
    });
    check('코스 1건', !error, error?.message ?? '');
  }
  {
    const { error } = await owner.from('course_entries').insert({ unit_id: UNIT, course_id: CID, entry_id: E1, position: 0 });
    check('코스에 노하우 담기', !error, error?.message ?? '');
  }

  const QOB = `qi_qfo_${s}`, QSP = `qi_qfs_${s}`, QBP = `qi_qfb_${s}`;
  {
    const { error } = await owner.from('quiz_items').insert([
      {
        id: QOB, unit_id: UNIT, entry_ids: [E1], kind: 't1', format: 'order_build',
        payload: { ask: ASK_ORDER, items: ORDER_ITEMS, answer_seq: [1, 0, 2], explain: '포스 정산부터예요' },
      },
      {
        id: QSP, unit_id: UNIT, entry_ids: [E1], kind: 't2', format: 'scale_pick',
        payload: { ask: ASK_SCALE, choices: ['레귤러', '라지'], unit: '펌프', answer_index: 1, explain: '라지가 한 펌프 더예요' },
      },
      {
        id: QBP, unit_id: UNIT, entry_ids: [E1], kind: 't5', format: 'branch_path',
        payload: {
          ask: ASK_BRANCH, explain: '3잔부터는 캐리어예요',
          steps: [{ ask: '포장인가요?', yes: 's1', no: 'r0' }, { ask: '3잔 이상인가요?', yes: 'r1', no: 'r0' }],
          results: ['그냥 드리면 돼요', '캐리어를 드려요'], answer_path: [0, 0],
        },
      },
    ]);
    check('신규 형태 문항 3건', !error, error?.message ?? '');
  }

  const TOKEN = `qa_qf_token_${s}_${s}`;   // 0113 quiz_links_token_len ≥ 20
  {
    const { error } = await owner.from('quiz_links').insert({
      id: `ql_qf_${s}`, unit_id: UNIT, course_id: CID, token: TOKEN,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    check('게스트 링크 발급', !error, error?.message ?? '');
  }

  // ── 브라우저 ────────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 460, height: 900 } });
  const page = await ctx.newPage();
  // ★개발 번들은 10MB 짜리 **동기** 스크립트라 domcontentloaded 가 그 다운로드+실행을 다 기다린다.
  //   새 브라우저마다 캐시가 비어 있어 이 머신에서 32초쯤 걸린다 — 기본 30초면 매번 아슬하게 터진다.
  //   느린 건 앱이 아니라 dev 서버라, 여기서 넉넉히 잡는다(실패를 늦게 말할 뿐 감추지 않는다).
  page.setDefaultNavigationTimeout(120000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));

  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
  const wait = (t, timeout = 25000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const see = (t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
  // RNW Pressable 은 dispatchEvent 로 눌러야 먹는다(reference_rnw_browser_qa).
  const tapLabel = async (label, exact = true) => {
    const el = page.getByLabel(label, { exact }).first();
    await el.waitFor({ state: 'visible', timeout: 12000 });
    await el.dispatchEvent('click');
  };
  /**
   * accessibilityLabel 이 없고 **글자로만** 식별되는 버튼용.
   * ★ getByLabel 은 aria-label 만 본다 — 자식 Text 에서 유도된 접근명은 안 잡힌다.
   *   /q/[token] 의 '다음 문제'·'결과 보기' CTA 가 그 경우다(라벨 없음).
   */
  const tapText = async (t) => {
    const el = page.getByText(t, { exact: false }).last();
    await el.waitFor({ state: 'visible', timeout: 12000 });
    await el.dispatchEvent('click');
  };

  /** 한 문항을 푼다. right=true 면 정답 경로로. 어떤 형태가 떠 있는지는 ask 로 알아본다. */
  const solve = async (right, tag) => {
    if (await see(ASK_ORDER)) {
      for (const t of right ? ORDER_RIGHT : ORDER_WRONG) await tapLabel(t);
      return 'order_build';
    }
    if (await see(ASK_SCALE)) {
      await tapLabel(right ? '라지' : '레귤러');
      return 'scale_pick';
    }
    if (await see(ASK_BRANCH)) {
      await tapLabel('예');                                    // 갈래 1: 포장인가요 → 예
      await page.waitForTimeout(250);
      await tapLabel(right ? '예' : '아니요');                  // 갈래 2: 3잔 이상인가요
      return 'branch_path';
    }
    await shot(`unknown-${tag}`);
    return null;
  };

  /** 한 판을 끝까지 돈다. 각 문항이 실제로 그려지고 채점 결과까지 나오는지 본다. */
  const runOnce = async (right, tag) => {
    await page.goto(`${ORIGIN}/q/${TOKEN}`, { waitUntil: 'domcontentloaded' });
    const opened = await wait('시작');
    check(`[${tag}] 게스트 링크가 열린다`, opened, opened ? '' : '시작 화면 안 뜸');
    await page.getByLabel('이름 입력', { exact: true }).first().pressSequentially('QA응시자', { delay: 20 });
    // 0160 — 전화번호가 식별키라 필수다. 안 채우면 시작 버튼이 안 열린다(인증은 선택이라 건너뛴다).
    await page.getByLabel('전화번호 입력', { exact: true }).first().pressSequentially('01044445555', { delay: 20 });
    await tapLabel('퀴즈 시작하기');
    const started = await wait('문제 남았어요');
    check(`[${tag}] 응시 시작`, started, started ? '' : '문항 화면 안 뜸');

    const seen = [];
    for (let i = 0; i < 3; i++) {
      const kind = await solve(right, `${tag}-${i}`);
      check(`[${tag}] ${i + 1}번째 형태가 그려지고 탭이 먹는다`, !!kind, kind ?? '어떤 형태도 못 찾음');
      if (!kind) break;
      seen.push(kind);
      const graded = (await wait('맞았어요', 15000)) || (await see('이건 이렇게 해요'));
      check(`[${tag}] ${kind} 채점 결과가 화면에 뜬다`, graded, graded ? '' : '채점 박스 없음');
      await shot(`${tag}-${i + 1}-${kind}`);
      // ★ 실패를 삼키지 않는다. 여기서 조용히 넘어가면 다음 문항이 안 떠도 "형태를 못 찾음"으로만 보여
      //   원인이 CTA 인지 렌더러인지 구분이 안 된다(첫 실행에서 실제로 그렇게 헤맸다).
      const last = i === 2;
      const moved = await tapText(last ? '결과 보기' : '다음 문제').then(() => true).catch(() => false);
      check(`[${tag}] ${kind} 다음으로 넘어가는 버튼이 눌린다`, moved, moved ? '' : 'CTA 못 찾음');
      await page.waitForTimeout(500);
    }
    check(`[${tag}] 세 형태가 모두 나왔다`, new Set(seen).size === 3, seen.join(' · '));

    // 0160 — 마지막 CTA 는 제출까지 태운다. 여기까지 와야 새 배선(이름·전화번호·응답 원문 →
    // 서버 재채점)이 **브라우저에서** 산 것이 증명된다. 서버 단독 검증은 qa:training ⑩ 이 한다.
    check(`[${tag}] 결과 화면까지 도달`, await wait('개 맞았어요', 25000), '');
    const sent = await see('결과는 사장님께 전달됐어요');
    check(`[${tag}] ★결과가 실제로 저장됐다(제출 RPC 성공)`, sent, sent ? '' : '"보내지 못했어요" 상태');
    check(`[${tag}] 직원 가입 CTA 가 뜬다`, await see('직원으로 가입하고 점수 보기'), '');
    await shot(`${tag}-done`);
  };

  console.log('\n━━ ① 정답 경로 ━━');
  await runOnce(true, 'right');
  console.log('\n━━ ② 오답 경로(정답 표시가 그려지는가) ━━');
  await runOnce(false, 'wrong');

  // 화면이 "전달됐어요"라고 말한 것과 **실제로 적힌 것**을 따로 본다 — 화면 문구만 믿으면
  // 저장 실패를 성공으로 읽는다(그 사고를 막으려고 done 화면이 두 문구로 갈리는 것이다).
  console.log('\n━━ ③ 저장된 결과(서버) ━━');
  {
    const { data } = await admin.from('quiz_attempts')
      .select('guest_name, guest_phone, guest_phone_verified, submission_id, total, correct').eq('unit_id', UNIT);
    const rows = data ?? [];
    check('응시 2회가 이름·전화번호로 남았다',
      rows.length === 2 && rows.every((r) => r.guest_name === 'QA응시자' && r.guest_phone === '01044445555'
        && r.guest_phone_verified === false && !!r.submission_id),
      JSON.stringify(rows));
    // 인증을 건너뛰었으니 verified=false 여야 한다(인증은 선택 — 안 해도 응시는 된다).
    check('★서버 재채점이 회차별로 갈린다(정답 3/3 · 오답 0/3)',
      rows.some((r) => r.total === 3 && r.correct === 3) && rows.some((r) => r.total === 3 && r.correct === 0),
      JSON.stringify(rows.map((r) => `${r.correct}/${r.total}`)));
  }
  { const { data } = await admin.from('quiz_attempt_items').select('format, correct, response').eq('unit_id', UNIT);
    const rows = data ?? [];
    check('문항별 상세 6건(2회차 × 3문항)', rows.length === 6, `n=${rows.length}`);
    check('세 형태의 상세가 다 남았다',
      new Set(rows.map((r) => r.format)).size === 3 && rows.filter((r) => r.correct).length === 3,
      JSON.stringify(rows.map((r) => `${r.format}:${r.correct}`))); }

  console.log('\n━━ ④ 콘솔 ━━');
  // Expo 웹 개발 서버가 늘 뱉는 소음은 제외하고, 렌더러가 터졌는지만 본다.
  const real = errors.filter((e) => !/favicon|Download the React DevTools|source-?map|websocket/i.test(e));
  check('콘솔 에러 0', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();

  // ── 정리 ────────────────────────────────────────────────────────────────
  // ★ supabase 쿼리 빌더는 thenable 이지 Promise 가 아니다 — .catch 가 없어서 여기서 터졌었다.
  try { await owner.rpc('delete_my_account'); } catch { /* 정리 실패가 판정을 뒤집지는 않는다 */ }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* 같음 */ }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 신규 문항 형태 3종 브라우저 실측 · 통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
