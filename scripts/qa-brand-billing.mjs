// qa-brand-billing.mjs — 본사(브랜드) 축 P6 정산 하니스: 청구 대상·전환 날짜·대입·크레딧·정지 (2026-09-23)
//
// 고정 계정만 쓴다(메모리 feedback_qa_use_fixed_accounts): 사장 owner@pilot… · 직원 staff2@pilot… · 본사 hq@pilot…
// 전제: 0221~0222 push + `node scripts/seed-brand-demo.mjs`. 끝나면 건드린 것(연결·구독·브랜드·청구서)을 시드 상태로 되돌린다.
//
// 재는 것(지시서 P6 §5 완료 기준 표 2행 = 정본 §4-D 정산·환불 규칙 표):
//   A 청구 대상·금액 — payer=brand · active · 시작일이 그 달 1일 이전인 매장만 × 계약가
//   B 매장→본사 전환 — 남은 유료 기간이 **끝난 다음 날**부터 · 그 달 청구에는 안 들어간다
//   C 본사→매장 전환 — 당월 말까지 본사 부담 유지 · 다음 청구에서 빠짐 · 점주에게 요금제 선택 알림 1행
//   D 승인 — `unit_subscriptions` 를 **대입**(더하지 않는다) · plan multi · 브랜드 paid_until 갱신
//   E 크레딧 — 미개시 월분을 크레딧으로 돌리면 다음 청구서에서 자동 차감
//   F 미납 정지 — 브랜드 status='suspended' 면 보기·배포 RPC 가 전부 닫힌다(사본 잔존은 qa:brand-deploy I1)
//   G 경계 — 청구 원장 직접 조회 0행 · 내부 함수 실행 거부 · 점주·직원에게 안 열린다 · 다른 브랜드 안 보임
//   H IAP — 살아 있으면 매장→본사 전환을 제안·수락 **둘 다** 거부한다
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const e = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !e[m[1]]) e[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return e;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const PW = 'pilot1234';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';
const HQ = 'hq@pilot.squaretable.app';
const BRAND = 'brand_pilot';
const UNIT = 'store_001';        // 사장 owner@pilot 의 매장 = payer 전환을 실험할 매장
const OTHER = 'store_002_demo';  // brand_other 소속 = 경계용

let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const skipped = (n, why) => { skip++; console.log('  SKIP', n, '—', why); };
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(email) {
  const c = mk();
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return c;
}
const errCode = (e) => (e?.message ?? '').split(/[\s:]/)[0];

// ── KST 날짜 셈 — 서버(0221·0222)가 전부 Asia/Seoul 기준이므로 하니스도 같게 센다 ──
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd, n) => {
  const t = new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400 * 1000;
  return new Date(t).toISOString().slice(0, 10);
};
const periodOf = (ymd) => ymd.slice(0, 7);
const addMonths = (period, n) => {
  const [y, m] = period.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthEnd = (period) => addDays(`${addMonths(period, 1)}-01`, -1);
// p_until(date) → 서버가 박는 timestamptz = 그 다음 날 0시 KST.
const untilTs = (ymd) => new Date(`${addDays(ymd, 1)}T00:00:00+09:00`).toISOString();
// timestamptz 는 서버가 `+00:00` 으로 돌려준다 — 문자열이 아니라 시각으로 비교한다.
const sameTs = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

const TODAY = kstDate();
const THIS = periodOf(TODAY);
const NEXT = addMonths(THIS, 1);
const AFTER = addMonths(THIS, 2);

// ── 되돌리기 ───────────────────────────────────────────────────────────────
// 이 하니스는 고정 계정의 **기존 행**(연결·구독·브랜드)을 바꾼다. 시작·끝 양쪽에서 시드 상태로 되돌린다.
// ★승인(D)은 그 브랜드의 **본사 부담 매장 전부**의 구독을 덮는다 — store_001 만 되돌리면
//   store_eval 이 multi 로 켜진 채 남아 다른 하니스의 전제를 바꾼다.
let touched = [UNIT];     // 구독을 되돌려야 할 매장
let snapSubs = new Map(); // unit_id → unit_subscriptions 원래 행(없으면 null)
let snapPaidUntil = null; // brands.paid_until 원래 값

async function snapshot() {
  const { data: bus } = await svc.from('brand_units').select('unit_id')
    .eq('brand_id', BRAND).eq('status', 'active').eq('payer', 'brand');
  touched = [...new Set([UNIT, ...(bus ?? []).map((r) => r.unit_id)])];
  const { data: subs } = await svc.from('unit_subscriptions').select('*').in('unit_id', touched);
  snapSubs = new Map(touched.map((u) => [u, (subs ?? []).find((s) => s.unit_id === u) ?? null]));
  const { data: b } = await svc.from('brands').select('paid_until').eq('id', BRAND).maybeSingle();
  snapPaidUntil = b?.paid_until ?? null;
}

async function restore() {
  // 순서가 중요하다: 브랜드 paid_until 을 먼저 비워야 brand_units 복구가 활성화 트리거를 깨우지 않는다.
  await svc.from('brands').update({ status: 'active', paid_until: snapPaidUntil }).eq('id', BRAND);
  await svc.from('brand_invoices').delete().eq('brand_id', BRAND);
  await svc.from('brand_events').delete().eq('brand_id', BRAND)
    .in('kind', ['invoice_issued', 'invoice_settled', 'brand_activated']);
  await svc.from('owner_alerts').delete().eq('unit_id', UNIT).eq('kind', 'brand_plan_choice');
  await svc.from('iap_subscriptions').delete().like('original_transaction_id', 'qa_billing_%');

  // 연결을 시드 상태(active · summary · payer=brand)로. payer 를 되돌린 **뒤에** 시작일을 원래대로 박는다
  // (payer 가 store→brand 로 바뀌는 그 update 에서는 트리거가 시작일을 오늘로 다시 계산한다).
  const { data: u } = await svc.from('units').select('owner_id').eq('id', UNIT).maybeSingle();
  const { data: cur } = await svc.from('brand_units').select('id, brand_id, accepted_at, created_at').eq('unit_id', UNIT).eq('status', 'active').maybeSingle();
  let rowId = cur?.id ?? null;
  let since = cur?.accepted_at ?? cur?.created_at ?? null;
  if (cur && cur.brand_id === BRAND) {
    await svc.from('brand_units').update({ payer: 'brand', visibility: 'summary', visibility_requested: null, payer_proposed: null, payer_proposed_by: null }).eq('id', cur.id);
  } else {
    if (cur) await svc.from('brand_units').update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'qa_restore' }).eq('id', cur.id);
    const ins = await svc.from('brand_units').insert({ brand_id: BRAND, unit_id: UNIT, payer: 'brand', visibility: 'summary', accepted_by: u?.owner_id ?? null }).select('id, accepted_at, created_at').maybeSingle();
    rowId = ins.data?.id ?? null;
    since = ins.data?.accepted_at ?? ins.data?.created_at ?? null;
  }
  if (rowId) {
    await svc.from('brand_units')
      .update({ payer_effective_from: (since ?? new Date().toISOString()).slice(0, 10), brand_paid_through: null })
      .eq('id', rowId);
  }
  // 이 매장 밖의 해제 기록(C 에서 만든 것)은 없다 — 해제는 하지 않는다(다른 하니스의 전제를 깨지 않으려고).

  // 구독은 마지막에 되돌린다(위 update 들이 활성화 트리거를 태울 수 있다).
  for (const u of touched) {
    const s = snapSubs.get(u);
    if (s) await svc.from('unit_subscriptions').upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' });
    else await svc.from('unit_subscriptions').delete().eq('unit_id', u);
  }
}

const sub = async () => (await svc.from('unit_subscriptions').select('*').eq('unit_id', UNIT).maybeSingle()).data;
const bu = async () => (await svc.from('brand_units').select('*').eq('unit_id', UNIT).eq('status', 'active').maybeSingle()).data;
const setSub = (patch) => svc.from('unit_subscriptions').upsert({ unit_id: UNIT, status: 'active', ...patch, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' });

try {
  const H = await login(HQ);
  const O = await login(OWNER);
  const J = await login(JUNIOR);
  await snapshot();
  await restore();

  const { data: brandRow } = await svc.from('brands').select('price_per_store_krw').eq('id', BRAND).maybeSingle();
  const PRICE = brandRow?.price_per_store_krw ?? 0;
  if (!PRICE) throw new Error('brand_pilot 계약가가 0 이다 — seed-brand-demo.mjs 를 먼저 돌려라');

  // ── A 청구 대상·금액 ─────────────────────────────────────────────────────
  console.log('\nA 청구 대상·금액');
  const prevSvc = await svc.rpc('brand_billing_preview', { p_brand: BRAND, p_period: THIS });
  const prevHq = await H.rpc('brand_billing_preview_mine', { p_period: THIS });
  check('A1 내부 콘솔과 본사 화면이 **같은 함수**를 보고 같은 줄을 받는다',
    !prevSvc.error && !prevHq.error && JSON.stringify((prevSvc.data ?? []).map((r) => r.unit_id).sort()) === JSON.stringify((prevHq.data ?? []).map((r) => r.unit_id).sort()),
    `${prevSvc.error?.message ?? ''} / ${prevHq.error?.message ?? ''}`);
  const { data: expectRows } = await svc.from('brand_units').select('unit_id, payer_effective_from')
    .eq('brand_id', BRAND).eq('status', 'active').eq('payer', 'brand');
  const expectIds = (expectRows ?? []).filter((r) => r.payer_effective_from && r.payer_effective_from <= `${THIS}-01`).map((r) => r.unit_id).sort();
  check('A2 대상 = payer=본사 · active · 시작일이 그 달 1일 이전인 매장',
    JSON.stringify((prevSvc.data ?? []).map((r) => r.unit_id).sort()) === JSON.stringify(expectIds),
    `${JSON.stringify((prevSvc.data ?? []).map((r) => r.unit_id))} ≠ ${JSON.stringify(expectIds)}`);
  check('A3 금액 = 매장 수 × 계약가',
    (prevSvc.data ?? []).every((r) => r.price_krw === PRICE) && (prevSvc.data ?? []).length === expectIds.length,
    JSON.stringify(prevSvc.data));
  check('A4 매장 부담(payer=store) 매장은 청구에 없다',
    !(prevSvc.data ?? []).some((r) => r.unit_id === 'store_appreview'));
  const badPeriod = await svc.rpc('brand_billing_preview', { p_brand: BRAND, p_period: '2026/09' });
  check('A5 기간 형식이 틀리면 조용히 넘기지 않고 거부한다', errCode(badPeriod.error) === 'bad_period', badPeriod.error?.message);

  // ── D 승인 = 대입 ────────────────────────────────────────────────────────
  console.log('\nD 승인 — unit_subscriptions 대입(더하지 않는다)');
  const keepUntil = addDays(TODAY, 10);
  await setSub({ plan: 'single', paid_until: untilTs(keepUntil) });
  const issue = await svc.rpc('brand_invoice_issue', { p_brand: BRAND, p_period: THIS, p_memo: 'qa' });
  check('D1 청구서 발행 — 미리보기와 같은 대상·금액', !issue.error
    && issue.data?.amount_krw === expectIds.length * PRICE
    && JSON.stringify((issue.data?.unit_ids ?? []).slice().sort()) === JSON.stringify(expectIds), issue.error?.message ?? JSON.stringify(issue.data));
  const dup = await svc.rpc('brand_invoice_issue', { p_brand: BRAND, p_period: THIS });
  check('D2 같은 달을 두 번 발행하지 못한다(월 1장)', !!dup.error, JSON.stringify(dup.data));
  const brandUntil = monthEnd(THIS);
  const appr = await svc.rpc('brand_invoice_approve', { p_id: issue.data?.id, p_paid_until: brandUntil, p_by: 'qa' });
  check('D3 승인 → 대상 매장 수만큼 켠다', !appr.error && appr.data === expectIds.length, appr.error?.message ?? String(appr.data));
  const s1 = await sub();
  check('D4 ★대입이다 — 기존 남은 기간에 **더하지 않는다**', sameTs(s1?.paid_until, untilTs(brandUntil)),
    `${s1?.paid_until} ≠ ${untilTs(brandUntil)} (기존 ${untilTs(keepUntil)})`);
  check('D5 plan 은 multi · 상태는 active', s1?.plan === 'multi' && s1?.status === 'active', JSON.stringify(s1));
  const { data: bAfter } = await svc.from('brands').select('paid_until').eq('id', BRAND).maybeSingle();
  check('D6 브랜드 이용 기간이 갱신된다', bAfter?.paid_until === brandUntil, JSON.stringify(bAfter));
  const appr2 = await svc.rpc('brand_invoice_approve', { p_id: issue.data?.id, p_paid_until: brandUntil });
  check('D7 이미 승인한 청구서를 다시 승인하지 못한다', errCode(appr2.error) === 'not_issued', appr2.error?.message);
  const list = await H.rpc('brand_invoices_list');
  check('D8 본사 설정>결제가 청구서를 본다(기간·매장 수·금액·상태)',
    !list.error && (list.data ?? []).some((r) => r.period === THIS && r.status === 'paid' && r.unit_count === expectIds.length),
    list.error?.message ?? JSON.stringify(list.data));

  // ── E 크레딧 ─────────────────────────────────────────────────────────────
  console.log('\nE 미개시 월분 크레딧 → 다음 청구에서 차감');
  const invNext = await svc.rpc('brand_invoice_issue', { p_brand: BRAND, p_period: NEXT });
  const nextAmount = invNext.data?.amount_krw ?? 0;
  check('E1 다음 달 청구서 발행', !invNext.error && nextAmount > 0, invNext.error?.message);
  const credited = await svc.rpc('brand_invoice_settle', { p_id: invNext.data?.id, p_status: 'credited', p_memo: 'qa 미개시' });
  check('E2 미개시 월분을 크레딧으로 돌린다', !credited.error, credited.error?.message);
  const invAfter = await svc.rpc('brand_invoice_issue', { p_brand: BRAND, p_period: AFTER });
  check('E3 ★다음 청구서에서 자동 차감된다', !invAfter.error && invAfter.data?.credit_krw === Math.min(invAfter.data?.amount_krw ?? 0, nextAmount),
    `credit ${invAfter.data?.credit_krw} / 기대 ${Math.min(invAfter.data?.amount_krw ?? 0, nextAmount)}`);
  const refunded = await svc.rpc('brand_invoice_settle', { p_id: invAfter.data?.id, p_status: 'refunded', p_memo: 'qa 환불' });
  check('E4 환불은 기록만 남는다(송금은 사람이 한다)', !refunded.error, refunded.error?.message);
  const badSettle = await svc.rpc('brand_invoice_settle', { p_id: invAfter.data?.id, p_status: 'paid' });
  check('E5 정산 상태는 크레딧·환불 둘뿐', errCode(badSettle.error) === 'bad_status', badSettle.error?.message);
  await svc.from('brand_invoices').delete().eq('brand_id', BRAND).in('period', [NEXT, AFTER]);

  // ── C 본사→매장 전환 ─────────────────────────────────────────────────────
  console.log('\nC 본사→매장 — 당월 말 유지 · 다음 청구에서 제외 · 요금제 선택 알림');
  await svc.from('owner_alerts').delete().eq('unit_id', UNIT).eq('kind', 'brand_plan_choice');
  const prop1 = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  check('C1 본사가 매장 부담으로 바꾸자고 제안', !prop1.error, prop1.error?.message);
  const acc1 = await O.rpc('accept_payer', { p_unit_id: UNIT, p_accept: true });
  check('C2 점주가 수락', !acc1.error, acc1.error?.message);
  const row1 = await bu();
  check('C3 ★본사 부담이 당월 말까지 기록된다', row1?.brand_paid_through === monthEnd(THIS) && row1?.payer === 'store',
    JSON.stringify({ through: row1?.brand_paid_through, payer: row1?.payer, expect: monthEnd(THIS) }));
  const prevNext = await svc.rpc('brand_billing_preview', { p_brand: BRAND, p_period: NEXT });
  check('C4 다음 청구에서 빠진다', !(prevNext.data ?? []).some((r) => r.unit_id === UNIT), JSON.stringify(prevNext.data));
  const { data: alerts } = await svc.from('owner_alerts').select('kind, title, body').eq('unit_id', UNIT).eq('kind', 'brand_plan_choice');
  check('C5 점주에게 "다음 달 요금제를 골라 주세요" 알림 한 행', (alerts ?? []).length === 1 && (alerts[0].body ?? '').includes(monthEnd(THIS)),
    JSON.stringify(alerts));
  const view = await O.rpc('my_brand_view');
  check('C6 점주 설정>본사 연결이 "본사 부담 종료일"을 받는다',
    !view.error && (view.data ?? []).some((r) => r.unit_id === UNIT && r.brand_paid_through === monthEnd(THIS)),
    view.error?.message ?? JSON.stringify(view.data));

  // ── H IAP ────────────────────────────────────────────────────────────────
  console.log('\nH IAP 가 살아 있으면 매장→본사 전환 거부');
  const { data: unitRow } = await svc.from('units').select('owner_id').eq('id', UNIT).maybeSingle();
  const iapRow = {
    owner_id: unitRow?.owner_id, platform: 'play', product_id: 'multi_2_monthly', store_count: 2,
    original_transaction_id: 'qa_billing_iap', status: 'active',
    current_period_end: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  };
  const iapIns = await svc.from('iap_subscriptions').insert(iapRow);
  if (iapIns.error) {
    skipped('H1~H3 IAP 케이스', `iap_subscriptions insert 실패 — ${iapIns.error.message}`);
  } else {
    const pIap = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'brand' });
    check('H1 제안 단계에서 거부(iap_active)', errCode(pIap.error) === 'iap_active', pIap.error?.message);
    await svc.from('iap_subscriptions').delete().eq('original_transaction_id', 'qa_billing_iap');
    const pOk = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'brand' });
    check('H2 IAP 가 없으면 제안은 된다', !pOk.error, pOk.error?.message);
    await svc.from('iap_subscriptions').insert(iapRow);
    const aIap = await O.rpc('accept_payer', { p_unit_id: UNIT, p_accept: true });
    check('H3 ★제안 뒤에 구독을 시작해도 **수락 시점에** 거부한다(겹쳐 내는 달이 안 생긴다)',
      errCode(aIap.error) === 'iap_active', aIap.error?.message);
    await svc.from('iap_subscriptions').delete().eq('original_transaction_id', 'qa_billing_iap');
  }

  // ── B 매장→본사 전환 ─────────────────────────────────────────────────────
  console.log('\nB 매장→본사 — 남은 유료 기간이 끝난 다음 날부터');
  const remainUntil = addDays(TODAY, 20);
  await setSub({ plan: 'single', paid_until: untilTs(remainUntil) });
  const cur2 = await bu();
  if (!cur2?.payer_proposed) {
    const p2 = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'brand' });
    check('B1 본사 부담으로 제안', !p2.error, p2.error?.message);
  } else {
    check('B1 본사 부담으로 제안(H2 의 제안이 살아 있다)', cur2.payer_proposed === 'brand');
  }
  const acc2 = await O.rpc('accept_payer', { p_unit_id: UNIT, p_accept: true });
  check('B2 점주가 수락', !acc2.error, acc2.error?.message);
  const row2 = await bu();
  const expectFrom = addDays(remainUntil, 1);
  check('B3 ★시작일 = 매장이 낸 기간이 끝난 **다음 날**(겹침·환불 없음)',
    row2?.payer_effective_from === expectFrom, `${row2?.payer_effective_from} ≠ ${expectFrom}`);
  check('B4 전환하면 지난 "본사 부담 종료일" 기록이 지워진다', row2?.brand_paid_through === null, String(row2?.brand_paid_through));
  for (const p of [periodOf(expectFrom), addMonths(periodOf(expectFrom), 1)]) {
    const pv = await svc.rpc('brand_billing_preview', { p_brand: BRAND, p_period: p });
    const want = expectFrom <= `${p}-01`;
    check(`B5 ${p} 청구 ${want ? '포함' : '제외'}(시작일 ${expectFrom} 기준)`,
      ((pv.data ?? []).some((r) => r.unit_id === UNIT)) === want, JSON.stringify((pv.data ?? []).map((r) => r.unit_id)));
  }

  // ── F 미납 정지 ──────────────────────────────────────────────────────────
  console.log('\nF 미납 정지 — 보기·배포가 닫힌다');
  await svc.from('brands').update({ status: 'suspended' }).eq('id', BRAND);
  const ovSus = await H.rpc('brand_overview');
  const myBrandSus = await H.rpc('my_brand');
  const depSus = await H.rpc('brand_deploy_entries', { p_entry_ids: ['nope'], p_unit_ids: [UNIT] });
  check('F1 정지하면 본사 대시보드가 0행', !ovSus.error && (ovSus.data ?? []).length === 0 && (myBrandSus.data ?? []).length === 0,
    `${(ovSus.data ?? []).length} / ${(myBrandSus.data ?? []).length}`);
  check('F2 정지하면 배포 RPC 가 거부된다', errCode(depSus.error) === 'not_brand_member', depSus.error?.message);
  await svc.from('brands').update({ status: 'active' }).eq('id', BRAND);
  const ovBack = await H.rpc('brand_overview');
  check('F3 재개하면 그대로 돌아온다', !ovBack.error && (ovBack.data ?? []).length > 0, String((ovBack.data ?? []).length));

  // ── G 경계 ───────────────────────────────────────────────────────────────
  console.log('\nG 경계 — 청구 원장은 정의자 RPC 로만 나간다');
  const hqDirect = await H.from('brand_invoices').select('id');
  const ownDirect = await O.from('brand_invoices').select('id');
  check('G1 본사 담당자·점주가 brand_invoices 를 직접 읽으면 0행(RLS 정책 0개)',
    !hqDirect.error && (hqDirect.data ?? []).length === 0 && !ownDirect.error && (ownDirect.data ?? []).length === 0);
  const ownList = await O.rpc('brand_invoices_list');
  const junList = await J.rpc('brand_invoices_list');
  check('G2 점주·직원의 청구서 목록은 0행(점주에게 본사 요금을 보여 주지 않는다)',
    !ownList.error && (ownList.data ?? []).length === 0 && !junList.error && (junList.data ?? []).length === 0,
    `${ownList.error?.message ?? ''} ${junList.error?.message ?? ''}`);
  const ownPrev = await O.rpc('brand_billing_preview_mine', { p_period: THIS });
  check('G3 점주의 미리보기는 0행', !ownPrev.error && (ownPrev.data ?? []).length === 0, ownPrev.error?.message);
  const crossPrev = await H.rpc('brand_billing_preview', { p_brand: 'brand_other', p_period: THIS });
  check('G4 남의 브랜드 청구는 못 본다(not_brand_member)', errCode(crossPrev.error) === 'not_brand_member', crossPrev.error?.message);
  for (const [fn, args] of [
    ['admin_activate_brand', { p_brand: BRAND, p_paid_until: TODAY }],
    ['brand_invoice_issue', { p_brand: BRAND, p_period: THIS }],
    ['brand_apply_paid_until', { p_unit: UNIT, p_until: TODAY }],
    ['brand_billable_units', { p_brand: BRAND, p_on: TODAY }],
    ['unit_iap_live', { p_unit: UNIT }],
    ['brand_payer_start', { p_unit: UNIT }],
  ]) {
    const r = await H.rpc(fn, args);
    check(`G5 ${fn} 은 클라이언트에서 실행 불가`, !!r.error, JSON.stringify(r.data));
  }
  const otherPrev = await svc.rpc('brand_billing_preview', { p_brand: 'brand_other', p_period: THIS });
  check('G6 브랜드가 섞이지 않는다(brand_other 의 청구에 내 매장이 없다)',
    !otherPrev.error && !(otherPrev.data ?? []).some((r) => r.unit_id === UNIT),
    otherPrev.error?.message ?? JSON.stringify(otherPrev.data));

  await O.auth.signOut(); await H.auth.signOut(); await J.auth.signOut();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 400));
}
await restore();
// ★건너뛴 것을 통과로 세지 않는다(AGENTS 게이트 거짓말 3종).
console.log(`\n── 결과 ── pass ${pass} / fail ${fail}${skip ? ` / skip ${skip}` : ''}`);
process.exit(fail ? 1 : 0);
