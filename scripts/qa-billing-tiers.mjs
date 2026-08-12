#!/usr/bin/env node
// qa-billing-tiers.mjs — 3티어 과금층(0062) 라이브 증명.
//
// 서버 스위치(app_config.billing_free_mode)를 false 로 잠깐 뒤집고 캡 3종을 실증한 뒤
// 반드시 true 로 원복한다(finally — 파일럿 Phase 0 유지가 최우선 불변식).
//   ① 좌석 캡: 무료 매장 직원 3명 승인 OK → 4번째 승인 staff_limit
//   ② AI 캡(0082 플랜별): free 150 / 유료 매장당 1500. 캡 직전 200 → 캡 도달 402 로 경계를 양쪽에서 찍는다.
//      ★ 유료 "무제한"은 폐기됐다(행사장형 무한호출 구멍). 유료도 1500 에서 402 가 나는지 회귀 가드한다.
//   ③ 매장 캡(★0130 슬롯 선구매로 규칙이 바뀜): 2번째 매장부터는 **매장 슬롯**이 있어야 한다.
//      플랜만으로는 못 늘린다 — multi 라도 슬롯 0개면 no_store_slot. 슬롯을 적립하면 그때 열리고,
//      그 매장은 바로 multi·active 로 시작한다(결제 뒤 추가분이 무료로 열리던 구멍을 닫은 것).
//   + 업그레이드 해제: single 활성화로 좌석 무제한·AI 캡 상향
//   + 원복 후: 새 무료 사장이 2매장 생성 가능(파일럿 우회 복원 실증)
//
// 실행: node scripts/qa-billing-tiers.mjs
//   env: .env(EXPO_PUBLIC_SUPABASE_URL/ANON) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 자동 로드.
// 자가정리: delete_my_account(소프트삭제, purge cron 이 파기).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 파일 없음 — 무시 */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// 월 AI답변 캡(확정 정책 2026-07-22). 정본 = 0082 consume_ai_quota/ai_quota_status.
// 클라 표시는 src/lib/config/tiers.ts PLANS.*.aiMonthly — 세 곳이 같은 값이어야 한다.
const FREE_CAP = 150;
const PAID_CAP = 1500;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: URL/ANON/SERVICE_ROLE env 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

// KST 'YYYY-MM' — consume_ai_quota 의 월 경계와 동일 기준.
const kstMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
  .format(new Date()).slice(0, 7);

// ── service_role 헬퍼(REST — RLS 우회) ──────────────────────────────────────
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function setFreeMode(on) {
  const res = await fetch(`${URL}/rest/v1/app_config?key=eq.billing_free_mode`, {
    method: 'PATCH', headers: { ...SH, Prefer: 'return=representation' },
    body: JSON.stringify({ value: on ? 'true' : 'false', updated_at: new Date().toISOString() }),
  });
  const rows = res.ok ? await res.json() : [];
  if (!res.ok || rows.length !== 1) throw new Error(`setFreeMode(${on}) 실패: ${res.status}`);
  return rows[0].value;
}
// ★0134: 가입 프로모션(가입하면 N일 single)을 이 하니스 동안 꺼 둔다.
//   캡 3종은 **진짜 무료 매장**이 있어야 검증된다. 프로모션이 켜진 채로 돌리면 신규 매장이
//   전부 single 이라 좌석·AI 캡이 애초에 적용되지 않고, 게이트가 조용히 무의미해진다.
//   (프로모션이 실제로 부여되는지는 아래 6)에서 따로 켜서 검증한다.)
// 원복 기준 — **설정 원시값**을 읽는다(RPC 는 창구 마감을 반영해 0을 돌려주므로 원복에 쓰면 안 된다).
async function getSignupTrialDaysRaw() {
  const res = await fetch(`${URL}/rest/v1/app_config?key=eq.signup_trial_days&select=value`, { headers: SH });
  const rows = res.ok ? await res.json() : [];
  return rows[0]?.value ?? '0';
}
async function setSignupTrialDays(days) {
  const res = await fetch(`${URL}/rest/v1/app_config?key=eq.signup_trial_days`, {
    method: 'PATCH', headers: { ...SH, Prefer: 'return=representation' },
    body: JSON.stringify({ value: String(days), updated_at: new Date().toISOString() }),
  });
  const rows = res.ok ? await res.json() : [];
  if (!res.ok || rows.length !== 1) throw new Error(`setSignupTrialDays(${days}) 실패: ${res.status}`);
  return rows[0].value;
}
async function seedAiUsage(unitId, used) {
  const res = await fetch(`${URL}/rest/v1/ai_usage_monthly?on_conflict=unit_id,month`, {
    method: 'POST', headers: { ...SH, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ unit_id: unitId, month: kstMonth, used }),
  });
  if (!res.ok) throw new Error(`seedAiUsage 실패: ${res.status} ${(await res.text()).slice(0, 120)}`);
}
async function adminActivate(unitId, days, plan) {
  const res = await fetch(`${URL}/rest/v1/rpc/admin_activate_store`, {
    method: 'POST', headers: SH,
    body: JSON.stringify({ p_unit_id: unitId, p_days: days, p_plan: plan }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`admin_activate_store 실패: ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  return Array.isArray(body) ? body[0] : body;
}

// ── 계정 헬퍼 ────────────────────────────────────────────────────────────────
let seq = 0;
const seededPhones = []; // 0088 게이트 라이브 — 번호를 '인증됨'으로 선등록해야 create_store/join이 통과
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 13) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_bt_${s}_${seq}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: '1990-01-15' } } });
  if (error || !data.session) throw new Error(`signUp(${name}) 실패: ${error?.message}`);
  return { c, uid: data.user.id, email };
}
async function edgeAnswer(client, query) {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${URL}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task: 'answer', payload: { query, sops: [] } }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const cleanup = [];
async function cleanupAll() {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

// ★스위치 복구는 "테스트 시작 시점의 원래 값"으로 — 유료화 전환(2026-07-10) 후 프로덕션 기본값은
//   false 다. true 하드코딩 복구는 실서비스 페이월을 꺼버리는 사고가 된다.
let originalFreeMode = null;
let originalTrialDays = null; // ★0134 — 가입 프로모션 일수(원복 기준)

async function main() {
  // ── 0) 현재 서버 스위치 값 기록(원복 기준) ─────────────────────────────────
  const probe = await signUp('owner', 'QA과금프로브');
  cleanup.push(probe.c);
  const { data: fm0 } = await probe.c.rpc('billing_free_mode');
  originalFreeMode = fm0 === true;
  console.log(`  … 시작 시 billing_free_mode=${fm0} (테스트 후 이 값으로 원복)`);

  // ★0134: 캡 검증에는 진짜 무료 매장이 필요하다 → **첫 create_store 전에** 프로모션을 끈다.
  //   ★원복 기준은 RPC 결과가 아니라 **app_config 원시 행**이다. signup_trial_days() 는
  //   창구가 닫혔으면 설정이 30이어도 0을 돌려주므로, 그 값으로 원복하면 설정이 영구히 0이 된다.
  originalTrialDays = await getSignupTrialDaysRaw();
  await setSignupTrialDays(0);
  console.log(`  … 시작 시 signup_trial_days(설정값)=${originalTrialDays} → 0으로 내림(테스트 후 원복)`);

  // ── 1) 무료 사장 F + 1호점 (스위치 켜기 전 준비) ──────────────────────────
  const F = await signUp('owner', 'QA과금사장');
  cleanup.push(F.c);
  const { data: c1, error: e1 } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const store1 = c1?.[0]?.unit_id;
  const invite1 = c1?.[0]?.invite_code;
  check('1호점 생성(free plan 기본값)', !e1 && !!store1, store1 ?? e1?.message);
  const { data: sub1 } = await F.c.from('unit_subscriptions').select('plan, status').eq('unit_id', store1).maybeSingle();
  check('신규 매장 plan=free', sub1?.plan === 'free', `plan=${sub1?.plan}`);

  // 직원 4명 준비(가입 + 합류 신청). 승인은 스위치 내린 뒤 단계별로.
  const staff = [];
  for (let i = 1; i <= 4; i++) {
    const j = await signUp('junior', `QA과금알바${i}`);
    cleanup.push(j.c);
    const { error: je } = await j.c.rpc('join_by_invite', { p_code: invite1 });
    if (je) throw new Error(`join_by_invite(${i}) 실패: ${je.message}`);
    staff.push(j);
  }

  // ── 2) 서버 스위치 OFF → 캡 활성 ──────────────────────────────────────────
  console.log('  … 서버 스위치 false 전환(캡 활성, 잠시 후 원복)');
  await setFreeMode(false);
  try {
    const { data: fm1 } = await F.c.rpc('billing_free_mode');
    check('스위치 false 반영', fm1 === false, `got=${fm1}`);

    // ② 좌석 캡: 1~3번째 승인 OK, 4번째 staff_limit
    for (let i = 0; i < 3; i++) {
      const { error } = await F.c.rpc('approve_member', { p_uid: staff[i].uid });
      check(`직원 ${i + 1}명째 승인 OK(≤3)`, !error, error?.message ?? '');
    }
    const { error: e4 } = await F.c.rpc('approve_member', { p_uid: staff[3].uid });
    check('4번째 승인 차단(staff_limit)', /staff_limit/.test(e4?.message ?? ''), e4?.message ?? '승인돼버림');

    // ③ AI 캡(0082 플랜별): free=150. 한도 내 200 → 경계 아래(149)에서도 200 → 캡 도달(150)에서 402.
    //    경계를 149/150 양쪽으로 찍는 이유: 상수만 바꾸고 부등호를 안 고치면 off-by-one 이 조용히 남는다.
    const a1 = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check('AI answer 한도 내 200', a1.status === 200, `status=${a1.status}`);
    await seedAiUsage(store1, FREE_CAP - 1);
    const a1b = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check(`free: 캡 직전(used=${FREE_CAP - 1})은 200`, a1b.status === 200, `status=${a1b.status}`);
    await seedAiUsage(store1, FREE_CAP);
    const a2 = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check(
      `free: 캡 도달(used=${FREE_CAP}) 402 ai_quota_exceeded`,
      a2.status === 402 && a2.body?.error === 'ai_quota_exceeded',
      `status=${a2.status} used=${a2.body?.used}`,
    );
    check(`free: 402 응답이 캡 ${FREE_CAP} 을 실어보냄`, a2.body?.cap === FREE_CAP, `cap=${a2.body?.cap}`);

    // ④ 매장 캡: free 2호점 차단
    const { error: e2 } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
    // ★0130: 매장 캡 판정이 '플랜'에서 **매장 슬롯**으로 바뀌었다 → 거절 사유도 no_store_slot 이다.
    check('free: 2호점 차단(no_store_slot)', /no_store_slot/.test(e2?.message ?? ''), e2?.message ?? '생성돼버림');

    // ⑤ single 활성화 → 좌석·AI 해제, 매장은 여전히 차단
    const act1 = await adminActivate(store1, 30, 'single');
    check('admin_activate_store(single)', act1?.plan === 'single' && act1?.status === 'active', `plan=${act1?.plan}`);
    const { error: e4b } = await F.c.rpc('approve_member', { p_uid: staff[3].uid });
    check('single: 4번째 직원 승인 해제', !e4b, e4b?.message ?? '');
    // 0082 부터 유료도 무제한이 아니다 — 매장당 1500. free 캡을 넘긴 상태에서 200 이 나와야 하고
    // (플랜 상향으로 해제), 유료 캡까지 채우면 다시 402 여야 한다("무제한" 폐기 회귀 가드).
    const a3 = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check(`single: free 캡 초과분 해제(used>${FREE_CAP} 에도 200)`, a3.status === 200, `status=${a3.status}`);
    await seedAiUsage(store1, PAID_CAP - 1);
    const a3b = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check(`single: 유료 캡 직전(used=${PAID_CAP - 1})은 200`, a3b.status === 200, `status=${a3b.status}`);
    await seedAiUsage(store1, PAID_CAP);
    const a3c = await edgeAnswer(F.c, '마감은 몇 시에 하나요');
    check(
      `single: 유료 캡 도달(used=${PAID_CAP}) 402 — '무제한' 폐기 확인`,
      a3c.status === 402 && a3c.body?.error === 'ai_quota_exceeded',
      `status=${a3c.status} cap=${a3c.body?.cap}`,
    );
    check(`single: 402 응답이 캡 ${PAID_CAP} 을 실어보냄`, a3c.body?.cap === PAID_CAP, `cap=${a3c.body?.cap}`);
    await seedAiUsage(store1, 0); // 뒤 검사(multi 2호점 등)가 캡에 걸리지 않게 원복
    const { error: e2b } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
    check('single: 2호점 여전히 차단(no_store_slot)', /no_store_slot/.test(e2b?.message ?? ''), e2b?.message ?? '생성돼버림');

    // ⑥ ★0130: multi 플랜만으로는 매장을 못 늘린다 — **매장 슬롯**을 사야 한다.
    //    (옛 규칙은 "소유 매장이 전부 유효 multi 면 추가 허용"이라 결제 뒤 추가분이 무료로 열렸다.)
    const act2 = await adminActivate(store1, 30, 'multi');
    check('admin_activate_store(multi)', act2?.plan === 'multi', `plan=${act2?.plan}`);
    const { error: e2c } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
    check('★multi 라도 슬롯 없으면 2호점 차단(무료 추가 봉쇄)', /no_store_slot/.test(e2c?.message ?? ''), e2c?.message ?? '생성돼버림');

    // 슬롯 1개 적립(운영자 승인이 하는 일과 동일 — review_payment_claim 이 이 행을 만든다)
    const slotRes = await fetch(`${URL}/rest/v1/store_slots`, {
      method: 'POST', headers: { ...SH, Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: F.uid, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() }),
    });
    check('슬롯 1개 적립(service_role)', slotRes.ok, `status=${slotRes.status}`);
    const { data: c2, error: e2d } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
    const store2 = c2?.[0]?.unit_id;
    check('★슬롯 적립 후 2호점 생성 OK', !e2d && !!store2, store2 ?? e2d?.message);
    const { data: ep2 } = await F.c.rpc('effective_plan', { p_unit: store2 });
    check('★슬롯으로 연 매장은 바로 multi(무료 아님)', ep2 === 'multi', `ep=${ep2}`);
    const { data: sl } = await F.c.rpc('my_store_slots');
    check('★슬롯 소진 → 남은 0개', (Array.isArray(sl) ? sl[0] : sl)?.open_count === 0, JSON.stringify(sl));
  } finally {
    // ── 3) 스위치 원복(무조건) — 테스트 시작 시점 값으로 ─────────────────────
    const restored = await setFreeMode(originalFreeMode === true);
    console.log(`  … 서버 스위치 원복: billing_free_mode=${restored}`);
  }

  // ── 5) ★0134 가입 프로모션이 실제로 부여되는가 ─────────────────────────────
  // 위 캡 검증은 프로모션을 꺼 놓고 돌았다. 그래서 "켜면 진짜 붙는지"를 여기서 따로 켜서 본다
  // (끈 상태만 검증하면 프로모션이 통째로 죽어도 게이트가 green 이다).
  await setSignupTrialDays(30);
  try {
    const T = await signUp('owner', 'QA체험사장');
    cleanup.push(T.c);
    const { data: t1, error: te1 } = await T.c.rpc('create_store', { p_store_name: 'QA 체험 1호점', p_industry: '카페·디저트', p_biz_no: null });
    const tUnit = t1?.[0]?.unit_id;
    check('가입 프로모션 켠 뒤 매장 생성 OK', !te1 && !!tUnit, tUnit ?? te1?.message);
    const { data: tsub } = await T.c.from('unit_subscriptions').select('plan, status, trial_ends_at').eq('unit_id', tUnit).maybeSingle();
    // ★0141(2026-08-12): single → **multi**. 광고("14일 동안 다점포까지 전면 무료")와 서버가
    //   갈라져 있던 것을 맞춘 것이다 — single 은 매장 1개라 말과 실제가 달랐다.
    check('★가입 매장 = multi/trialing', tsub?.plan === 'multi' && tsub?.status === 'trialing', `plan=${tsub?.plan} status=${tsub?.status}`);
    const days = tsub?.trial_ends_at ? Math.round((Date.parse(tsub.trial_ends_at) - Date.now()) / 86400000) : -1;
    check('★체험 기간 = 30일', days === 30, `${days}일`);
    const { data: tep } = await T.c.rpc('effective_plan', { p_unit: tUnit });
    check('★서버 유효 플랜도 multi (좌석·AI 캡·다점포가 실제로 풀린다)', tep === 'multi', `ep=${tep}`);
    // 프로모션 코드가 이 매장에서 막히지 않는가 — 0133 판정이 그대로였다면 여기서 already_paid 가 난다.
    const { data: tuntil } = await T.c.rpc('effective_until', { p_unit: tUnit });
    check('effective_until 이 체험 만료일을 돌려준다', !!tuntil && Date.parse(tuntil) > Date.now(), String(tuntil));
  } finally {
    const back = await setSignupTrialDays(originalTrialDays);
    console.log(`  … 가입 프로모션 원복: signup_trial_days=${back}`);
  }

  // ── 4) 원복 실증 — 원래 무료 모드였을 때만(유료화 후엔 2매장 생성이 정상 차단) ──
  if (originalFreeMode === true) {
    const G = await signUp('owner', 'QA과금사장2');
    cleanup.push(G.c);
    const { data: g1, error: ge1 } = await G.c.rpc('create_store', { p_store_name: 'QA 원복 1호점', p_industry: '카페·디저트', p_biz_no: null });
    const { data: g2, error: ge2 } = await G.c.rpc('create_store', { p_store_name: 'QA 원복 2호점', p_industry: '카페·디저트', p_biz_no: null });
    check('원복 후: 무료 사장 2매장 생성 OK(파일럿 우회 복원)', !ge1 && !ge2 && !!g1?.[0]?.unit_id && !!g2?.[0]?.unit_id, ge1?.message ?? ge2?.message ?? '');
  } else {
    const { error: ge } = await probe.c.rpc('create_store', { p_store_name: 'QA 원복확인점', p_industry: '카페·디저트', p_biz_no: null });
    check('원복 후: 캡 유지 확인(프로브 사장 1호점 생성 OK)', !ge, ge?.message ?? '');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  // process.exit는 .finally 콜백을 기다리지 않는다 — 정리는 exit 전에 직접 수행.
  await cleanupAll();
  await cleanupSeededPhones(URL, SERVICE, seededPhones);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error('FATAL:', e?.message ?? e);
    // 어떤 실패에서도 스위치는 "시작 시점 값"으로 원복 시도(이중 안전망). 기록 전 실패면 건드리지 않음.
    try {
      if (originalFreeMode !== null) {
        await setFreeMode(originalFreeMode === true);
        console.error(`  … 서버 스위치 원복(${originalFreeMode}) 완료`);
      }
      if (originalTrialDays !== null) {
        await setSignupTrialDays(originalTrialDays);
        console.error(`  … 가입 프로모션 원복(${originalTrialDays}) 완료`);
      }
    } catch { console.error('  !! 스위치 원복 실패 — 수동 확인 필요'); }
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupAll();
    await cleanupSeededPhones(URL, SERVICE, seededPhones);
  });
