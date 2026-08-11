#!/usr/bin/env node
// qa-payment-claims.mjs — 입금 신고 → 승인/반려 → 활성화(0083) 라이브 증명.
//
// 닫으려는 구멍: "사장이 입금했는데 앱이 안 열린다". 신고가 DB 행으로 남고, 승인이 활성화까지 한
// 트랜잭션으로 가고, 그 결과가 사장에게 **읽히는지**를 실 백엔드에서 전후로 찍는다.
//   ① 사장 신고 → pending 행 1개(서버가 금액 계산)
//   ② 중복 신고가 새 행을 만들지 않는다(같은 id 갱신)
//   ③ 크로스테넌트: 다른 매장 사장에게 그 행이 안 보인다
//   ④ ★RPC 우회 차단(0079 교훈): 직접 insert(남의 매장·approved 위조·금액 위조) / update / delete 전부 RLS 차단
//   ⑤ 승인 → unit_subscriptions 실제 active + 사장이 결과를 읽는다(= 알림 도달)
//   ⑥ 반려 → 사유가 사장에게 읽힌다 · 사유 없는 반려는 거부 · 재검토는 거부
//   ⑦ 직원(junior)은 신고 불가 · authenticated 는 review 호출 불가
//
// 실행: node scripts/qa-payment-claims.mjs
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
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: URL/ANON/SERVICE_ROLE env 필요(.env + .env.seed)'); process.exit(2); }

// 요금 SSOT 3중 확인 대상: src/lib/config/tiers.ts · 0106 payment_claim_amount · 여기.
// ★청구액은 부가세 포함(0106) — 공급가액 19,000/29,000 에 10% 를 더한 값이다.
const SINGLE_KRW = 20900;
const MULTI_KRW = 31900;
// 주문 시점 동의(0116) — 없으면 서버가 consent_required 로 거부한다. SSOT = business.ts TERMS_VERSION.
const TERMS = '2026-08-07';

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

// ── service_role 헬퍼(REST — RLS 우회) ──────────────────────────────────────
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcRpc(fn, body) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body) });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}
async function svcSelect(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: SH });
  return res.ok ? await res.json() : null;
}

// ── 계정 헬퍼 ────────────────────────────────────────────────────────────────
let seq = 0;
const seededPhones = []; // 0088 게이트 라이브 — 번호를 '인증됨'으로 선등록해야 create_store/join이 통과
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 17) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_pc_${s}_${seq}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: '1990-01-15' } } });
  if (error || !data.session) throw new Error(`signUp(${name}) 실패: ${error?.message}`);
  return { c, uid: data.user.id, email };
}
const cleanup = [];
async function cleanupAll() {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

async function main() {
  // ── 0) 사장 A(1매장) · 사장 B(1매장) · A매장 직원 J ────────────────────────
  const A = await signUp('owner', 'QA입금사장A');
  cleanup.push(A.c);
  const { data: ca, error: ea } = await A.c.rpc('create_store', { p_store_name: 'QA 입금 A점', p_industry: '카페·디저트', p_biz_no: null });
  const unitA = ca?.[0]?.unit_id;
  const inviteA = ca?.[0]?.invite_code;
  check('A 매장 생성', !ea && !!unitA, unitA ?? ea?.message);

  const B = await signUp('owner', 'QA입금사장B');
  cleanup.push(B.c);
  const { data: cb, error: eb } = await B.c.rpc('create_store', { p_store_name: 'QA 입금 B점', p_industry: '카페·디저트', p_biz_no: null });
  const unitB = cb?.[0]?.unit_id;
  check('B 매장 생성', !eb && !!unitB, unitB ?? eb?.message);

  const J = await signUp('junior', 'QA입금알바');
  cleanup.push(J.c);
  const { error: ej } = await J.c.rpc('join_by_invite', { p_code: inviteA });
  if (ej) throw new Error(`join_by_invite 실패: ${ej.message}`);
  const { error: eap } = await A.c.rpc('approve_member', { p_uid: J.uid });
  check('A 매장 직원 합류 승인', !eap, eap?.message ?? '');

  // ── 1) 신고 → pending 행. 금액은 서버가 계산한다 ───────────────────────────
  const { data: r1, error: e1 } = await A.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '장준혁', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1,
  });
  check('① 사장 신고 → pending 생성', !e1 && r1?.status === 'pending' && r1?.unit_id === unitA, e1?.message ?? `status=${r1?.status}`);
  check('① 금액을 서버가 계산(single)', r1?.amount_krw === SINGLE_KRW, `amount=${r1?.amount_krw}`);
  check('① 입금자명 저장', r1?.depositor_name === '장준혁', `depositor=${r1?.depositor_name}`);
  const claim1 = r1?.id;

  // 금액 위조 시도(클라가 1원이라고 우겨도 서버 값이 저장돼야 한다)
  const { data: r1b } = await A.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: 1, p_depositor: '장준혁', p_months: 1, p_memo: '금액위조시도', p_terms_version: TERMS, p_store_count: 1,
  });
  check('① 클라 금액 불신(p_amount=1 → 서버값 유지)', r1b?.amount_krw === SINGLE_KRW, `amount=${r1b?.amount_krw}`);

  // ── 2) 중복 신고가 새 행을 만들지 않는다 ───────────────────────────────────
  const { data: r2 } = await A.c.rpc('submit_payment_claim', {
    p_plan: 'multi', p_amount: MULTI_KRW, p_depositor: '장준혁2', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1,
  });
  const { data: listA } = await A.c.from('payment_claims').select('id, status, plan, depositor_name, amount_krw');
  check('② 중복 신고가 새 행을 만들지 않음(id 동일)', r2?.id === claim1, `${r2?.id} vs ${claim1}`);
  check('② 내 매장 신고 행은 여전히 1개', (listA ?? []).length === 1, `rows=${(listA ?? []).length}`);
  check('② 갱신 내용 반영(plan·입금자명)', r2?.plan === 'multi' && r2?.depositor_name === '장준혁2', `plan=${r2?.plan}`);
  check('② multi 금액 = 매장당 × 소유매장수(1)', r2?.amount_krw === MULTI_KRW * 1, `amount=${r2?.amount_krw}`);

  // single 로 되돌려 뒤 검사를 단순화
  await A.c.rpc('submit_payment_claim', { p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '장준혁', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1 });

  // ── 3) 크로스테넌트: 다른 매장 사장에게 안 보인다 ──────────────────────────
  const { data: seenByB } = await B.c.from('payment_claims').select('id').eq('id', claim1);
  check('③ 다른 매장 사장은 그 행을 못 봄', (seenByB ?? []).length === 0, `rows=${(seenByB ?? []).length}`);
  const { data: allByB } = await B.c.from('payment_claims').select('id');
  check('③ B 의 전체 조회에도 A 행 없음', (allByB ?? []).length === 0, `rows=${(allByB ?? []).length}`);
  // 직원(사장 아님)에게도 안 보인다 — select 정책이 role='owner' 를 요구.
  const { data: seenByJ } = await J.c.from('payment_claims').select('id');
  check('③ 같은 매장 직원에게도 안 보임(사장 전용)', (seenByJ ?? []).length === 0, `rows=${(seenByJ ?? []).length}`);

  // ── 4) ★RPC 우회 차단 — 직접 insert/update/delete ──────────────────────────
  // 4-a) 남의 매장에 신고 위조
  const { error: ins1 } = await B.c.from('payment_claims').insert({
    unit_id: unitA, claimed_by: B.uid, plan: 'single', amount_krw: SINGLE_KRW, depositor_name: '위조', months: 1,
  });
  check('④-a 남의 매장 직접 insert 차단(RLS)', !!ins1, ins1?.message?.slice(0, 60) ?? '통과돼버림');

  // 4-b) 자기 매장에 'approved' 위조 (= 승인 없이 활성화 유도)
  const { error: ins2 } = await B.c.from('payment_claims').insert({
    unit_id: unitB, claimed_by: B.uid, plan: 'single', amount_krw: SINGLE_KRW, depositor_name: '위조', months: 1, status: 'approved',
  });
  check('④-b status=approved 직접 insert 차단(RLS)', !!ins2, ins2?.message?.slice(0, 60) ?? '통과돼버림');

  // 4-c) 금액 위조 직접 insert
  const { error: ins3 } = await B.c.from('payment_claims').insert({
    unit_id: unitB, claimed_by: B.uid, plan: 'single', amount_krw: 100, depositor_name: '위조', months: 1,
  });
  check('④-c 금액 위조 직접 insert 차단(RLS)', !!ins3, ins3?.message?.slice(0, 60) ?? '통과돼버림');

  // 4-d) 자기 pending 행을 스스로 승인 (가장 치명적인 우회)
  const { data: upd, error: updErr } = await A.c
    .from('payment_claims').update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', claim1).select('id');
  check('④-d 자기 신고 직접 update(승인 위조) 차단', !!updErr || (upd ?? []).length === 0, updErr?.message?.slice(0, 60) ?? `rows=${(upd ?? []).length}`);
  const { data: stillPending } = await A.c.from('payment_claims').select('status').eq('id', claim1).maybeSingle();
  check('④-d 상태가 여전히 pending', stillPending?.status === 'pending', `status=${stillPending?.status}`);

  // 4-e) 삭제(운영자 눈에서 지우기)
  const { data: del, error: delErr } = await A.c.from('payment_claims').delete().eq('id', claim1).select('id');
  check('④-e 직접 delete 차단', !!delErr || (del ?? []).length === 0, delErr?.message?.slice(0, 60) ?? `rows=${(del ?? []).length}`);

  // 4-f) 로그인 사용자가 검토 RPC 직접 호출
  const { error: revErr } = await A.c.rpc('review_payment_claim', { p_id: claim1, p_approve: true, p_reason: null, p_reviewer: null });
  // ★에러가 났다는 것만 보면 안 된다 — p_id 가 undefined 라 PostgREST 가 '함수를 못 찾음(PGRST202)'을
  //   내도 통과해 버린다(2026-08-11 P8 에서 실제로 이 거짓양성이 잡혔다). **권한 거부인지**까지 본다.
  const revDenied = !!revErr && !/PGRST202|Could not find the function/i.test(revErr.message ?? '');
  check('④-f authenticated 의 review_payment_claim 호출 차단(권한 거부인지까지)', revDenied,
    revErr?.message?.slice(0, 70) ?? '호출돼버림');

  // 4-g) 직원은 신고 자체가 불가
  const { error: jErr } = await J.c.rpc('submit_payment_claim', { p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '알바', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1 });
  check('④-g 직원(junior) 신고 차단(not_owner)', /not_owner/.test(jErr?.message ?? ''), jErr?.message?.slice(0, 60) ?? '신고돼버림');

  // ── 5) 승인 → 실제 활성화 + 사장에게 결과 도달 ─────────────────────────────
  const subBefore = await svcSelect(`unit_subscriptions?unit_id=eq.${unitA}&select=status,plan,paid_until`);
  check('⑤ 승인 전 구독은 미활성(trialing)', subBefore?.[0]?.status !== 'active', `status=${subBefore?.[0]?.status}`);

  const approve = await svcRpc('review_payment_claim', { p_id: claim1, p_approve: true, p_reason: null, p_reviewer: 'qa@team-roundtable.com' });
  check('⑤ service_role 승인 성공', approve.ok && approve.body?.status === 'approved', `${approve.status} ${JSON.stringify(approve.body).slice(0, 80)}`);

  const subAfter = await svcSelect(`unit_subscriptions?unit_id=eq.${unitA}&select=status,plan,paid_until`);
  const paidUntil = subAfter?.[0]?.paid_until ? new Date(subAfter[0].paid_until).getTime() : 0;
  check('⑤ unit_subscriptions 실제 active', subAfter?.[0]?.status === 'active', `status=${subAfter?.[0]?.status}`);
  check('⑤ plan=single 반영', subAfter?.[0]?.plan === 'single', `plan=${subAfter?.[0]?.plan}`);
  check('⑤ paid_until 이 미래(30일)', paidUntil > Date.now() + 25 * 86400000, subAfter?.[0]?.paid_until ?? '');

  // 알림 도달 = 사장이 자기 행에서 검토 결과를 읽을 수 있는가(0083 알림은 이 행에서 파생된다).
  const { data: ownerSees } = await A.c.from('payment_claims').select('status, reviewed_at, reviewed_by, reject_reason').eq('id', claim1).maybeSingle();
  check('⑤ 사장에게 승인 결과 도달(status+reviewed_at)', ownerSees?.status === 'approved' && !!ownerSees?.reviewed_at, JSON.stringify(ownerSees ?? {}).slice(0, 80));
  check('⑤ 운영자 식별자 기록', ownerSees?.reviewed_by === 'qa@team-roundtable.com', `reviewed_by=${ownerSees?.reviewed_by}`);

  // 이미 검토된 건 재검토 불가(중복 활성화 방지)
  const redo = await svcRpc('review_payment_claim', { p_id: claim1, p_approve: true, p_reason: null, p_reviewer: 'qa' });
  check('⑤ 검토 완료 건 재검토 차단(claim_not_pending)', !redo.ok && /claim_not_pending/.test(JSON.stringify(redo.body)), JSON.stringify(redo.body).slice(0, 70));

  // ── 6) 반려 → 사유가 사장에게 도달 ─────────────────────────────────────────
  const { data: r3, error: e3 } = await A.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '장준혁', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1,
  });
  check('⑥ 검토 후 새 신고는 새 행으로 생성', !e3 && !!r3?.id && r3.id !== claim1, e3?.message ?? r3?.id);

  const badReject = await svcRpc('review_payment_claim', { p_id: r3?.id, p_approve: false, p_reason: '   ', p_reviewer: 'qa' });
  check('⑥ 사유 없는 반려 거부(reject_reason_required)', !badReject.ok && /reject_reason_required/.test(JSON.stringify(badReject.body)), JSON.stringify(badReject.body).slice(0, 70));

  const reject = await svcRpc('review_payment_claim', { p_id: r3?.id, p_approve: false, p_reason: '입금자명이 은행 내역과 달라요', p_reviewer: 'qa@team-roundtable.com' });
  check('⑥ 반려 성공', reject.ok && reject.body?.status === 'rejected', JSON.stringify(reject.body).slice(0, 70));

  const { data: ownerSees2 } = await A.c.from('payment_claims').select('status, reject_reason').eq('id', r3?.id).maybeSingle();
  check('⑥ 반려 사유가 사장에게 도달', ownerSees2?.status === 'rejected' && ownerSees2?.reject_reason === '입금자명이 은행 내역과 달라요', JSON.stringify(ownerSees2 ?? {}).slice(0, 90));

  // 반려 뒤에도 다시 신고할 수 있다(막다른 길 방지)
  const { data: r4, error: e4 } = await A.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '장준혁(정정)', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1,
  });
  check('⑥ 반려 후 재신고 가능', !e4 && r4?.status === 'pending' && r4?.id !== r3?.id, e4?.message ?? `id=${r4?.id}`);

  // ── 7) 입력 검증 ───────────────────────────────────────────────────────────
  const { error: eDep } = await B.c.rpc('submit_payment_claim', { p_plan: 'single', p_amount: SINGLE_KRW, p_depositor: '  ', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1 });
  check('⑦ 입금자명 없으면 거부(depositor_required)', /depositor_required/.test(eDep?.message ?? ''), eDep?.message?.slice(0, 60) ?? '통과돼버림');
  const { error: ePlan } = await B.c.rpc('submit_payment_claim', { p_plan: 'free', p_amount: 0, p_depositor: '무료', p_months: 1, p_memo: null, p_terms_version: TERMS, p_store_count: 1 });
  check('⑦ free 플랜 신고 거부(bad_plan)', /bad_plan/.test(ePlan?.message ?? ''), ePlan?.message?.slice(0, 60) ?? '통과돼버림');

  // ★main 이 process.exit 로 끝나 .finally(cleanupAll)는 도달하지 않는다 — 시드 정리는 여기서.
  await cleanupSeededPhones(URL, SERVICE, seededPhones);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error('FATAL:', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(cleanupAll);
