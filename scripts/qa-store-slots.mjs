#!/usr/bin/env node
// qa-store-slots.mjs — 0130 매장 슬롯 선구매 모델 라이브 검증.
//   ① 슬롯 없으면 2호점 생성 불가(no_store_slot) — "결제 후 추가가 무료로 열리는" 경로 봉쇄
//   ② N개 동시 결제 → 승인 → 슬롯 N개
//   ③ 무료·만료 매장에 자동 배정(신고 매장 우선)
//   ④ 남은 슬롯으로 새 매장 생성 → 매장별 독립 만료일
//   ⑤ 슬롯 소진 후 다시 no_store_slot
//   ⑥ 금액 = 산 개수 × 31,900 (소유 매장 수와 무관)
//   ⑦ 금액·개수 위조 직접 insert 차단(RLS 재장착 확인)
//   ⑧ 0137 무료 지급(관리 콘솔 버튼)
//   ⑨ ★0141 가입 체험 구간 — 슬롯 면제 + 종료 후 재차단 + 체험 매장도 슬롯을 먹는다(0136)
//
// ★★①~⑧ 은 **가입 프로모션을 끄고** 돈다(2026-08-12).
//   0141 이 "체험 중에는 슬롯을 면제한다"를 넣으면서, 프로모션이 켜진 채로 돌면 no_store_slot
//   단언 4개가 전부 red 가 된다 — 잘못된 게 아니라 **그 구간에선 슬롯을 요구하지 않는 것이 맞다.**
//   그래서 슬롯 강제 구간은 끄고 돌리고, 체험 구간은 ⑨ 에서 **켜서 따로** 검증한다.
//   ⚠️ 통째로 끄면 안 된다 — 0136 이 잡은 매출 구멍(슬롯 3개=매장 4개)은 프로모션이 켜져야
//      재현되므로 ⑨-b 가 그 자리를 대신 지킨다.
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
    } catch { /* */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: env 필요'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const info = (n, extra = '') => console.log('  ····', n, extra);

const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcRpc(fn, body) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: Array.isArray(j) ? j[0] : j };
}
async function svcSel(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: SH });
  return await res.json().catch(() => []);
}
async function svcPatch(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...SH, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const rows = res.ok ? await res.json() : [];
  if (!res.ok) throw new Error(`PATCH ${path} 실패: ${res.status}`);
  return rows;
}
// ★가입 프로모션 스위치 — ①~⑧ 은 끄고, ⑨ 는 켜서 돈다.
//   원복 기준은 RPC 가 아니라 **app_config 원시값**이다. signup_trial_days() 는 창구가 닫히면
//   설정이 14여도 0을 돌려주므로, 그 값으로 원복하면 라이브 프로모션이 영구히 꺼진다.
async function getSignupTrialDaysRaw() {
  const rows = await svcSel('app_config?key=eq.signup_trial_days&select=value');
  return rows[0]?.value ?? '0';
}
async function setSignupTrialDays(days) {
  const rows = await svcPatch('app_config?key=eq.signup_trial_days', { value: String(days), updated_at: new Date().toISOString() });
  if (rows.length !== 1) throw new Error(`setSignupTrialDays(${days}) 실패`);
  return rows[0].value;
}
let originalTrialDays = null;

let seq = 0;
const seededPhones = [];
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 23) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_slot_${s}_${seq}@example.com`;
  for (let a = 0; a < 6; a++) {
    const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: '1990-01-15' } } });
    if (!error && data.session) return { c, uid: data.user.id, email };
    if (!/rate limit/i.test(error?.message ?? '')) throw new Error(`signUp: ${error?.message}`);
    info(`레이트리밋 — ${20 * (a + 1)}s 대기`);
    await new Promise((r) => setTimeout(r, 20000 * (a + 1)));
  }
  throw new Error('signUp 레이트리밋 소진');
}
const cleanup = [];
const MULTI_VAT = 31900;

async function main() {
  const { data: fm } = await svcRpc('billing_free_mode');
  info(`billing_free_mode=${fm}`);
  if (fm === true) { console.log('  ⚠ 무료 모드가 켜져 있어 슬롯 게이트가 우회된다 — 검증 불가'); fail++; return; }

  // ★①~⑧ 은 슬롯 강제 구간이다 → **첫 create_store 전에** 가입 프로모션을 끈다(0141 면제 회피).
  originalTrialDays = await getSignupTrialDaysRaw();
  await setSignupTrialDays(0);
  info(`signup_trial_days(설정값)=${originalTrialDays} → 0으로 내림(⑨ 에서 켜고, 끝나면 원복)`);

  const O = await signUp('owner', 'QA슬롯사장');
  cleanup.push(O.c);

  const { data: c1 } = await O.c.rpc('create_store', { p_store_name: 'QA슬롯 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id;
  check('셋업 1호점 생성(첫 매장은 슬롯 불필요)', !!S1, S1);
  const ep0 = await svcRpc('effective_plan', { p_unit: S1 });
  check('프로모션을 껐으니 1호점은 진짜 무료로 열린다(슬롯 배정 대상)', ep0.data === 'free', `ep=${ep0.data}`);

  // ── ① 슬롯 없이 2호점 생성 불가 ───────────────────────────────────────────
  const { error: eNo } = await O.c.rpc('create_store', { p_store_name: 'QA슬롯 2호점(불가)', p_industry: '카페·디저트', p_biz_no: null });
  check('★① 슬롯 없으면 2호점 생성 불가(no_store_slot)', eNo?.message?.includes('no_store_slot'), eNo?.message ?? '생성돼버림');

  const slot0 = await O.c.rpc('my_store_slots');
  const sl0 = Array.isArray(slot0.data) ? slot0.data[0] : slot0.data;
  check('남은 슬롯 0개', sl0?.open_count === 0, `open=${sl0?.open_count}`);

  // ── ⑥ 금액 = 산 개수 × 31,900 (소유 매장 수와 무관) ───────────────────────
  const a1 = await svcRpc('payment_claim_amount', { p_plan: 'multi', p_months: 1, p_store_count: 1 });
  const a3 = await svcRpc('payment_claim_amount', { p_plan: 'multi', p_months: 1, p_store_count: 3 });
  check('★⑥ 1개분 = 31,900', a1.data === MULTI_VAT, `${a1.data}`);
  check('★⑥ 3개분 = 95,700 (소유 매장은 1개뿐인데도)', a3.data === MULTI_VAT * 3, `${a3.data}`);

  // ── ② N개 동시 결제 ───────────────────────────────────────────────────────
  const { data: claim, error: eC } = await O.c.rpc('submit_payment_claim', {
    p_plan: 'multi', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
    p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 3,
  });
  check('★② 3개분 신고 생성', !eC && claim?.status === 'pending', eC?.message ?? `status=${claim?.status}`);
  check('★② store_count 기록', claim?.store_count === 3, `store_count=${claim?.store_count}`);
  check('★② 금액을 서버가 3개분으로 재계산', claim?.amount_krw === MULTI_VAT * 3, `amount=${claim?.amount_krw} (보낸값 1)`);

  // ── ⑦ 위조 직접 insert 차단(RLS 재장착 확인) ──────────────────────────────
  const forge = await fetch(`${URL}/rest/v1/payment_claims`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${(await O.c.auth.getSession()).data.session?.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_id: S1, claimed_by: O.uid, plan: 'multi', amount_krw: MULTI_VAT, months: 1, store_count: 10, depositor_name: '위조', status: 'pending' }),
  });
  check('★⑦ 1개분 금액으로 10개분 신고 차단(RLS)', forge.status >= 400, `status=${forge.status} ${(await forge.text()).slice(0, 80)}`);

  // ── ③ 승인 → 슬롯 3개 적립 + 무료 매장 자동 배정 ──────────────────────────
  const rev = await svcRpc('review_payment_claim', { p_id: claim?.id, p_approve: true, p_reason: null, p_reviewer: 'qa-slots' });
  check('승인 RPC 성공', rev.ok, `status=${rev.status}`);

  const ep1 = await svcRpc('effective_plan', { p_unit: S1 });
  check('★③ 무료였던 1호점에 슬롯이 자동 배정돼 multi 가 됐다', ep1.data === 'multi', `ep=${ep1.data}`);

  const slot1 = await O.c.rpc('my_store_slots');
  const sl1 = Array.isArray(slot1.data) ? slot1.data[0] : slot1.data;
  check('★③ 3개 중 1개 소비 → 남은 슬롯 2개', sl1?.open_count === 2, `open=${sl1?.open_count}`);

  const allSlots = await svcSel(`store_slots?select=id,paid_until,consumed_at,consumed_unit_id&owner_id=eq.${O.uid}`);
  check('슬롯 총 3개 적립(감사 흔적 보존)', allSlots.length === 3, `n=${allSlots.length}`);
  check('소비된 슬롯에 매장이 기록됨', allSlots.filter((r) => r.consumed_unit_id === S1).length === 1, JSON.stringify(allSlots.map((r) => r.consumed_unit_id)));

  // ── ④ 남은 슬롯으로 매장 생성 ─────────────────────────────────────────────
  const { data: c2, error: e2 } = await O.c.rpc('create_store', { p_store_name: 'QA슬롯 2호점', p_industry: '카페·디저트', p_biz_no: null });
  const S2 = c2?.[0]?.unit_id;
  check('★④ 슬롯이 있으니 2호점 생성 OK', !e2 && !!S2, e2?.message ?? S2);
  const ep2 = await svcRpc('effective_plan', { p_unit: S2 });
  check('★④ 2호점이 바로 multi 로 열린다(무료 아님)', ep2.data === 'multi', `ep=${ep2.data}`);

  const { data: c3, error: e3 } = await O.c.rpc('create_store', { p_store_name: 'QA슬롯 3호점', p_industry: '카페·디저트', p_biz_no: null });
  const S3 = c3?.[0]?.unit_id;
  check('★④ 3호점도 생성 OK(마지막 슬롯)', !e3 && !!S3, e3?.message ?? S3);

  // ── ⑤ 슬롯 소진 후 다시 막힘 ──────────────────────────────────────────────
  const { error: e4 } = await O.c.rpc('create_store', { p_store_name: 'QA슬롯 4호점(불가)', p_industry: '카페·디저트', p_biz_no: null });
  check('★⑤ 슬롯 소진 → 4호점 차단(no_store_slot)', e4?.message?.includes('no_store_slot'), e4?.message ?? '생성돼버림');
  check('★★결제 후 추가 매장이 무료로 열리지 않는다', e4?.message?.includes('no_store_slot'), '슬롯 없이는 매장이 생기지 않는다');

  const slot2 = await O.c.rpc('my_store_slots');
  const sl2 = Array.isArray(slot2.data) ? slot2.data[0] : slot2.data;
  check('남은 슬롯 0개', sl2?.open_count === 0, `open=${sl2?.open_count}`);

  const subs = await svcSel(`unit_subscriptions?select=unit_id,plan,status,paid_until&unit_id=in.(${S1},${S2},${S3})`);
  info('매장별 구독', JSON.stringify(subs));
  check('세 매장 모두 multi·active', subs.length === 3 && subs.every((r) => r.plan === 'multi' && r.status === 'active'), `n=${subs.length}`);

  // ── 타 계정 슬롯 격리 ─────────────────────────────────────────────────────
  const B = await signUp('owner', 'QA슬롯타인');
  cleanup.push(B.c);
  const { data: bSlots } = await B.c.from('store_slots').select('id');
  check('★타 계정 슬롯 열람 0건(RLS)', (bSlots ?? []).length === 0, `rows=${(bSlots ?? []).length}`);

  // ── ⑧ ★0137 다점포 무료 지급(관리 콘솔 버튼) ──────────────────────────────
  // 결제 승인 말고 **돈 없이 여는 길**. 영업에서 "다점포 열어드릴게요"의 실체다.
  // 이 가드가 없으면 기능이 죽어도 아무도 모른다(관리 콘솔은 QA가 안 돈다).
  const G = await signUp('owner', 'QA무료다점포');
  cleanup.push(G.c);
  const { data: g1 } = await G.c.rpc('create_store', { p_store_name: 'QA무료 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const GS1 = g1?.[0]?.unit_id;
  const gep0 = await svcRpc('effective_plan', { p_unit: GS1 });
  check('⑧ 지급 전 1호점은 다점포가 아니다', gep0.data !== 'multi', `ep=${gep0.data}`);

  // extra=1 → "2호점까지". 1호점을 올리는 몫은 서버가 알아서 더 적립한다(화면이 개수를 안 센다).
  const grant = await svcRpc('grant_store_slots', { p_owner: G.uid, p_extra: 1, p_days: 30 });
  check('⑧ 무료 지급 호출 성공', grant.ok, `status=${grant.status} ${JSON.stringify(grant.data)}`);
  check('⑧ 기존 매장 1곳이 자동 배정됨', grant.data?.assigned === 1, `assigned=${grant.data?.assigned}`);

  const gep1 = await svcRpc('effective_plan', { p_unit: GS1 });
  check('⑧ ★1호점이 multi 로 올라간다(전환할 때마다 화면이 바뀌지 않게)', gep1.data === 'multi', `ep=${gep1.data}`);

  const { data: g2, error: ge2 } = await G.c.rpc('create_store', { p_store_name: 'QA무료 2호점', p_industry: '카페·디저트', p_biz_no: null });
  check('⑧ ★2호점 생성 OK(돈 없이 열렸다)', !ge2 && !!g2?.[0]?.unit_id, ge2?.message ?? g2?.[0]?.unit_id);
  const { error: ge3 } = await G.c.rpc('create_store', { p_store_name: 'QA무료 3호점', p_industry: '카페·디저트', p_biz_no: null });
  check('⑧ ★3호점은 차단(준 만큼만 열린다)', /no_store_slot/.test(ge3?.message ?? ''), ge3?.message ?? '생성돼버림');

  // 돈의 출처가 행에서 읽혀야 한다 — 무료 지급분은 claim_id 가 null 이다.
  const gSlots = await svcSel(`store_slots?select=claim_id&owner_id=eq.${G.uid}`);
  check('⑧ 무료 지급분은 claim_id=null (결제분과 구분)', gSlots.length > 0 && gSlots.every((r) => r.claim_id === null), JSON.stringify(gSlots));

  // ══════════════════════════════════════════════════════════════════════════
  // ⑨ ★가입 체험 구간(0141) — 여기서만 프로모션을 켠다
  // ══════════════════════════════════════════════════════════════════════════
  // 위 ①~⑧ 은 "슬롯이 없으면 못 연다"를 지킨다. 이 구간은 그 규칙의 **예외**가 약속대로
  // 열리고, 약속이 끝나면 **다시 닫히는지**를 지킨다. 둘 다 없으면 광고와 서버가 갈라진다.
  await setSignupTrialDays(14);
  try {
    // ── ⑨-a 면제 + 종료 후 재차단 ────────────────────────────────────────────
    const T = await signUp('owner', 'QA체험다점포');
    cleanup.push(T.c);
    const { data: t1 } = await T.c.rpc('create_store', { p_store_name: 'QA체험 1호점', p_industry: '카페·디저트', p_biz_no: null });
    const TS1 = t1?.[0]?.unit_id;
    const tep1 = await svcRpc('effective_plan', { p_unit: TS1 });
    check('⑨-a 체험 1호점은 multi 로 열린다(0141 — 광고가 약속한 전 요금제 무료)', tep1.data === 'multi', `ep=${tep1.data}`);

    const { data: t2, error: te2 } = await T.c.rpc('create_store', { p_store_name: 'QA체험 2호점', p_industry: '카페·디저트', p_biz_no: null });
    const TS2 = t2?.[0]?.unit_id;
    check('⑨-a ★체험 중에는 슬롯 없이 2호점이 열린다', !te2 && !!TS2, te2?.message ?? TS2);

    const tslot = await T.c.rpc('my_store_slots');
    const tsl = Array.isArray(tslot.data) ? tslot.data[0] : tslot.data;
    check('⑨-a 면제로 열린 매장은 슬롯을 소비하지 않는다(장부가 어긋나지 않는다)', tsl?.open_count === 0, `open=${tsl?.open_count}`);

    const tsubs = await svcSel(`unit_subscriptions?select=unit_id,plan,status,trial_ends_at&unit_id=in.(${TS1},${TS2})`);
    const ends = tsubs.map((r) => r.trial_ends_at);
    check('⑨-a ★2호점은 1호점 종료일을 승계한다(매장마다 새로 14일이면 체험이 무한 연장된다)',
      tsubs.length === 2 && ends[0] === ends[1], JSON.stringify(ends));

    // 체험 종료를 강제 → 면제가 사라지고 다시 슬롯을 요구해야 한다.
    await svcPatch(`unit_subscriptions?unit_id=in.(${TS1},${TS2})`, { trial_ends_at: new Date(Date.now() - 86400000).toISOString() });
    const { error: te3 } = await T.c.rpc('create_store', { p_store_name: 'QA체험 3호점(불가)', p_industry: '카페·디저트', p_biz_no: null });
    check('⑨-a ★★체험이 끝나면 다시 슬롯을 요구한다(no_store_slot)', /no_store_slot/.test(te3?.message ?? ''), te3?.message ?? '생성돼버림');

    // ── ⑨-b 0136 매출 구멍 회귀 — 체험 매장도 슬롯을 먹는다 ──────────────────
    // 프로모션이 켜져야만 재현되는 구멍이다: 체험 매장이 배정 대상에서 빠지면
    // **슬롯 3개를 사면 매장이 4개** 열린다(0130 이 닫은 구멍의 재개장).
    const P = await signUp('owner', 'QA체험결제');
    cleanup.push(P.c);
    const { data: p1 } = await P.c.rpc('create_store', { p_store_name: 'QA체험결제 1호점', p_industry: '카페·디저트', p_biz_no: null });
    const PS1 = p1?.[0]?.unit_id;
    check('⑨-b 셋업: 체험 1호점', !!PS1, PS1);
    check('⑨-b 이 매장은 가입 체험이다(무료가 아니다 — 그래서 빠뜨리기 쉽다)',
      (await svcRpc('is_signup_trial', { p_unit: PS1 })).data === true, '');

    const { data: pClaim } = await P.c.rpc('submit_payment_claim', {
      p_plan: 'multi', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
      p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 3,
    });
    await svcRpc('review_payment_claim', { p_id: pClaim?.id, p_approve: true, p_reason: null, p_reviewer: 'qa-slots' });

    const pep = await svcRpc('effective_plan', { p_unit: PS1 });
    check('⑨-b ★체험 중이던 1호점이 슬롯을 먹고 유료 multi 가 된다(0136)', pep.data === 'multi', `ep=${pep.data}`);
    const pslot = await P.c.rpc('my_store_slots');
    const psl = Array.isArray(pslot.data) ? pslot.data[0] : pslot.data;
    check('⑨-b ★★3개를 사면 남는 건 2개다(3개 사서 매장 4개가 열리지 않는다)', psl?.open_count === 2, `open=${psl?.open_count}`);
  } finally {
    const back = await setSignupTrialDays(originalTrialDays);
    console.log(`  … 가입 프로모션 원복: signup_trial_days=${back}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error('\n✗ 중단:', e.message); fail++; })
  .finally(async () => {
    for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* */ } }
    try { await cleanupSeededPhones(URL, SERVICE, seededPhones); } catch { /* */ }
    // 중단(throw)으로 ⑨ 의 finally 를 못 탔을 수 있다 — 프로모션 설정을 반드시 되돌린다.
    if (originalTrialDays !== null) {
      try { await setSignupTrialDays(originalTrialDays); }
      catch { console.error('  !! 원복 실패 — app_config.signup_trial_days 수동 확인 필요'); fail++; }
    }
    console.log('  … 정리 완료');
    console.log(`FINAL: ${pass} passed, ${fail} failed`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
