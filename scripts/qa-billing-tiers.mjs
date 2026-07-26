#!/usr/bin/env node
// qa-billing-tiers.mjs — 3티어 과금층(0062) 라이브 증명.
//
// 서버 스위치(app_config.billing_free_mode)를 false 로 잠깐 뒤집고 캡 3종을 실증한 뒤
// 반드시 true 로 원복한다(finally — 파일럿 Phase 0 유지가 최우선 불변식).
//   ① 좌석 캡: 무료 매장 직원 3명 승인 OK → 4번째 승인 staff_limit
//   ② AI 캡(0082 플랜별): free 150 / 유료 매장당 1500. 캡 직전 200 → 캡 도달 402 로 경계를 양쪽에서 찍는다.
//      ★ 유료 "무제한"은 폐기됐다(행사장형 무한호출 구멍). 유료도 1500 에서 402 가 나는지 회귀 가드한다.
//   ③ 매장 캡: 무료·단일 2번째 매장 plan_limit_store → multi 활성화 후 생성 OK
//   + 업그레이드 해제: single 활성화로 좌석 무제한·AI 캡 상향, multi 로 매장 추가 허용
//   + 원복 후: 새 무료 사장이 2매장 생성 가능(파일럿 우회 복원 실증)
//
// 실행: node scripts/qa-billing-tiers.mjs
//   env: .env(EXPO_PUBLIC_SUPABASE_URL/ANON) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 자동 로드.
// 자가정리: delete_my_account(소프트삭제, purge cron 이 파기).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 13) % 10000000).padStart(7, '0')}`;
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

async function main() {
  // ── 0) 현재 서버 스위치 값 기록(원복 기준) ─────────────────────────────────
  const probe = await signUp('owner', 'QA과금프로브');
  cleanup.push(probe.c);
  const { data: fm0 } = await probe.c.rpc('billing_free_mode');
  originalFreeMode = fm0 === true;
  console.log(`  … 시작 시 billing_free_mode=${fm0} (테스트 후 이 값으로 원복)`);

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
    check('free: 2호점 차단(plan_limit_store)', /plan_limit_store/.test(e2?.message ?? ''), e2?.message ?? '생성돼버림');

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
    check('single: 2호점 여전히 차단', /plan_limit_store/.test(e2b?.message ?? ''), e2b?.message ?? '생성돼버림');

    // ⑥ multi 활성화 → 2호점 생성 OK
    const act2 = await adminActivate(store1, 30, 'multi');
    check('admin_activate_store(multi)', act2?.plan === 'multi', `plan=${act2?.plan}`);
    const { data: c2, error: e2c } = await F.c.rpc('create_store', { p_store_name: 'QA 과금 2호점', p_industry: '헬스·피트니스', p_biz_no: null });
    check('multi: 2호점 생성 OK', !e2c && !!c2?.[0]?.unit_id, c2?.[0]?.unit_id ?? e2c?.message);
  } finally {
    // ── 3) 스위치 원복(무조건) — 테스트 시작 시점 값으로 ─────────────────────
    const restored = await setFreeMode(originalFreeMode === true);
    console.log(`  … 서버 스위치 원복: billing_free_mode=${restored}`);
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
    } catch { console.error('  !! 스위치 원복 실패 — 수동 확인 필요'); }
    process.exitCode = 1;
  })
  .finally(cleanupAll);
