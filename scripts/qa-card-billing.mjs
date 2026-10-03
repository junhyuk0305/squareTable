#!/usr/bin/env node
// qa-card-billing.mjs — 웹 카드 정기결제(토스 빌링, 0208) 검증.
//
// A. DB 의미(토스 호출 없이 service_role 로 RPC 를 직접 부른다)
//    ① 첫 결제 반영 = 매장 열림 · 기간 = 승인 + 1개월 · ★재반영은 아무것도 안 바꾼다(멱등)
//    ② 가드 — 고객키 불일치 · 동의 없음 · 진행 중 주문 · 이미 구독 중 · 앱 구독 중 · 계좌이체 확인 대기
//    ③ ★카드 구독 중엔 계좌이체 신고 거부(0208 이 submit_payment_claim 에 더한 가드)
//    ④ 늘리기 = 차액 결제 후 multi 로 열림 + 2호점 생성 가능 · 줄이기 = 예고만 · 같은 선택 = 예고 취소
//    ⑤ ★갱신 = 기존 기간 끝에 1개월 **대입**(가산 누적 아님) · 선점은 한 번만 · 예고가 금액에 반영
//    ⑥ 갱신 실패 3회 → past_due → expired
//    ⑦ 해지 → 해지 취소 · ⑧ 환불 = 즉시 회수 · ⑨ 빌링키 정리 · ⑩ RLS(빌링키 비공개·남의 구독 안 보임)
//    ⑪ 결제 알림 — 실패 알림(갱신·소진·늘리기 거절)·결제 3일 전·해지 예약 끝 3일 전이 **1회씩만** · 문구에 카드·웹 없음
//    ⑫ 앱 구독이 살아 있으면 카드 쪽이 물러난다 — 청구 안 함·자동결제 멈춤·해지 취소/변경 거부·예고 알림 없음
//    ⑬ 줄이기 닫을 매장 — 필수·개수·소속 검증 · 예고 취소/늘리기/해지 시 명단 정리 · 갱신에서 고른 매장만 닫힘 ·
//       잠긴(이전) 매장은 후보가 아니고 갱신 때 되살아나지 않는다
//    ⑭ 구독 상태 알림(0232, 채널 무관) — 카드·앱 구독 각각 늘었어요·끝나요·끝났어요 1행씩 · 스윕 재실행에도 1행 ·
//       첫 결제엔 없음 · 계좌이체로 더 길게 열린 매장·본사 부담 매장(로컬만)엔 끝나요·끝났어요 없음 · 문구에 채널·금액 없음
// B. 엣지(card-billing 이 떠 있을 때만) — precheck 허용 목록 · 토스 연결(가짜 authKey 는 토스가 거절) · renew 인증
//
// ⛔ 라이브 DB 에 쓰는 하니스다. 대상은 QA_SUPABASE_URL / QA_SUPABASE_ANON_KEY / QA_SUPABASE_SERVICE_ROLE_KEY 로
//    명시할 때만 그 값을, 아니면 .env/.env.seed(라이브)를 쓴다. iOS 심사 중엔 로컬(supabase start)에서만 돌린다.
// 계정 = 고정 qa.card.1~5@example.com(없으면 가입). 시작할 때 그 계정의 카드·매장 행만 비운다.
//
// 실행(로컬): QA_SUPABASE_URL=http://127.0.0.1:58321 QA_SUPABASE_ANON_KEY=... QA_SUPABASE_SERVICE_ROLE_KEY=... \
//            QA_CARD_FN_URL=http://127.0.0.1:58321/functions/v1/card-billing node scripts/qa-card-billing.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
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
const URL = env.QA_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.QA_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.QA_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const FN = env.QA_CARD_FN_URL || `${URL}/functions/v1/card-billing`;

let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const info = (n, extra = '') => console.log('  ····', n, extra);
const skipped = (n, why) => { skip++; console.log('  SKIP', n, why); };

const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcRpc(fn, body) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: j, err: res.ok ? '' : JSON.stringify(j) };
}
async function svcSel(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: SH });
  return await res.json().catch(() => []);
}
async function svcWrite(method, path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { ...SH, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} 실패: ${res.status} ${await res.text()}`);
  return await res.json().catch(() => null);
}

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const PW = 'QaCard1234!';
const seededPhones = [];
async function account(n) {
  const email = `qa.card.${n}@example.com`;
  const c = mk();
  let r = await c.auth.signInWithPassword({ email, password: PW });
  if (r.error) {
    const phone = `0107${String(7700000 + n)}`;
    await seedVerifiedPhones(URL, SERVICE, [phone]);
    seededPhones.push(phone);
    r = await c.auth.signUp({ email, password: PW, options: { data: { name: `QA카드${n}`, role: 'owner', phone, birth_date: '1990-01-15' } } });
    if (r.error || !r.data.session) throw new Error(`계정 준비 실패 ${email}: ${r.error?.message}`);
  }
  const uid = r.data.user.id;
  const token = r.data.session.access_token;
  // 이 계정의 흔적만 비운다(계정은 남긴다).
  await svcWrite('DELETE', `card_payments?owner_id=eq.${uid}`);
  await svcWrite('DELETE', `card_subscriptions?owner_id=eq.${uid}`);
  await svcWrite('DELETE', `card_billing_keys?owner_id=eq.${uid}`);
  await svcWrite('DELETE', `iap_subscriptions?owner_id=eq.${uid}`);
  await svcWrite('DELETE', `payment_claims?claimed_by=eq.${uid}`);
  await svcWrite('DELETE', `store_slots?owner_id=eq.${uid}`);
  // delete_store 는 마지막 매장을 못 지운다(last_store) → 가장 오래된 1곳을 1호점으로 재사용하고 구독만 무료로 되돌린다.
  const owned = await svcSel(`units?owner_id=eq.${uid}&deleted_at=is.null&select=id&order=created_at.asc`);
  for (const o of owned.slice(1)) {
    const { error } = await c.rpc('delete_store', { p_unit_id: o.id });
    if (error) throw new Error(`이전 매장 정리 실패 ${email}: ${error.message}`);
  }
  if (owned[0]) {
    // 지난 실행의 카드 결제 알림(⑪)이 남으면 "1행" 검사가 흔들린다 — 이 계정 매장의 카드 알림만 지운다.
    await svcWrite('DELETE', `owner_alerts?unit_id=eq.${owned[0].id}&kind=in.(card_fail,card_renew,card_end)`);
    // 구독 상태 알림(⑭, 0232)은 period = 사장id:기간끝 이다. 붙은 매장과 무관하게 이 사장 것만 지운다.
    await svcWrite('DELETE', `owner_alerts?kind=in.(sub_renewed,sub_ending,sub_ended)&period=like.${encodeURIComponent(`${uid}:*`)}`);
    // 2호점 생성 검증이 전화 인증 게이트(0088)를 다시 통과해야 한다 — 재사용 계정도 시드한다.
    await seedVerifiedPhones(URL, SERVICE, [`0107${String(7700000 + n)}`]);
    seededPhones.push(`0107${String(7700000 + n)}`);
    await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${owned[0].id}`, {
      status: 'trialing', plan: 'free', paid_until: null, trial_ends_at: new Date().toISOString(),
    });
    return { c, uid, email, token, unit: owned[0].id };
  }
  const phone = `0107${String(7700000 + n)}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const { data: st, error: se } = await c.rpc('create_store', { p_store_name: `QA카드${n} 1호점`, p_industry: '카페·디저트', p_biz_no: null });
  if (se) throw new Error(`매장 생성 실패 ${email}: ${se.message}`);
  return { c, uid, email, token, unit: st?.[0]?.unit_id };
}

const sub = async (uid) => (await svcSel(`card_subscriptions?owner_id=eq.${uid}&select=*`))[0] ?? null;
const unitSub = async (unit) => (await svcSel(`unit_subscriptions?unit_id=eq.${unit}&select=status,plan,paid_until`))[0] ?? null;
const near = (a, b, ms = 120000) => Math.abs(new Date(a) - new Date(b)) < ms;
const plusMonth = (iso) => { const d = new Date(iso); d.setMonth(d.getMonth() + 1); return d.toISOString(); };
const TERMS = '2026-09-22';

async function begin(o, plan, count, extra = {}) {
  const ck = (await o.c.rpc('card_customer_key')).data;
  return svcRpc('card_begin_subscribe', {
    p_owner: o.uid, p_customer_key: extra.ck ?? ck, p_plan: plan, p_count: count,
    p_terms_version: extra.terms ?? TERMS, p_livemode: false,
  });
}
const orderOf = (r) => (Array.isArray(r.data) ? r.data[0] : r.data);
const alertsOf = (unit, kind) =>
  svcSel(`owner_alerts?unit_id=eq.${unit}&kind=eq.${kind}&select=id,unit_id,period,step,title,body&order=id`);
// 실패 알림은 주문번호가 period 다 — 매장이 아니라 주문으로 찾는다(붙는 매장 = 그 시점의 활성 매장).
const alertsByPeriod = (period) =>
  svcSel(`owner_alerts?kind=eq.card_fail&period=eq.${period}&select=id,unit_id,period,step,title,body&order=id`);
const activeUnitOf = async (uid) => (await svcSel(`profiles?id=eq.${uid}&select=active_unit_id`))[0]?.active_unit_id ?? null;
const choicesOf = async (uid) => (await svcSel(`iap_release_choice?owner_id=eq.${uid}&select=unit_id`)).map((r) => r.unit_id).sort();
// iOS 앱에도 같은 행이 나간다 — 결제 채널을 말하면 안 된다(사용자 결정 09-15).
const noChannelWords = (a) => !/카드|웹/.test(`${a?.title ?? ''} ${a?.body ?? ''}`);
const sweepNow = () => svcRpc('sweep_owner_alerts', { p_now: new Date().toISOString() });
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function dbChecks() {
  console.log('\n■ A. DB 의미');
  const cur = await svcSel('app_config?key=eq.signup_trial_days&select=value');
  const trial = cur[0]?.value ?? null;
  if (trial !== null) await svcWrite('PATCH', 'app_config?key=eq.signup_trial_days', { value: '0' });
  // 전면 무료 모드면 create_store 가 슬롯을 안 보고 매장을 만든다(로컬 기본값이 true) → 슬롯 검증이 무의미해진다.
  const fm = (await svcSel('app_config?key=eq.billing_free_mode&select=value'))[0]?.value ?? null;
  if (fm !== null) await svcWrite('PATCH', 'app_config?key=eq.billing_free_mode', { value: 'false' });

  try {
    const O = await account(1);
    check('셋업 사장·1호점', !!O.unit, O.unit);

    // ── 고객키 ──
    const k1 = (await O.c.rpc('card_customer_key')).data;
    const k2 = (await O.c.rpc('card_customer_key')).data;
    check('고객키는 사장당 하나로 고정', !!k1 && k1 === k2 && /^cus_[0-9a-f]{32}$/.test(k1), k1);

    // ── ② 가드 ──
    check('② 고객키 불일치 거부', /customer_key_mismatch/.test((await begin(O, 'single', 1, { ck: 'cus_fake' })).err));
    check('② 동의 기록 없으면 거부', /consent_required/.test((await begin(O, 'single', 1, { terms: '' })).err));

    // ── ① 첫 결제 ──
    const b1 = await begin(O, 'single', 1);
    const o1 = orderOf(b1);
    check('① 첫 결제 주문 생성 · 금액 = 서버 계산 25,000', b1.ok && o1?.amount_krw === 25000 && /^FP\d{8}_/.test(o1?.order_id), JSON.stringify(b1.data));
    check('② 진행 중 주문이 있으면 두 번째 주문 거부', /payment_in_progress/.test((await begin(O, 'single', 1)).err));

    await svcRpc('card_save_billing_key', { p_owner: O.uid, p_customer_key: k1, p_billing_key: 'bk_qa_1', p_card_company: '현대', p_card_number: '43301234****123*' });
    const approved = new Date().toISOString();
    const rec1 = await svcRpc('card_record_charge', { p_order_id: o1.order_id, p_ok: true, p_payment_key: 'pk_qa_1', p_approved_at: approved, p_receipt_url: 'https://example.com/r' });
    const s1 = await sub(O.uid);
    const u1 = await unitSub(O.unit);
    check('① 반영 → 카드 구독 active · single · 25,000', rec1.ok && s1?.status === 'active' && s1?.plan === 'single' && s1?.amount_krw === 25000, rec1.err || JSON.stringify(s1));
    check('① 기간 = 승인 + 1개월 · 다음 청구 = 끝 하루 전', near(s1?.current_period_end, plusMonth(approved)) && near(s1?.next_charge_at, new Date(new Date(s1?.current_period_end) - 86400000)), `${s1?.current_period_end}`);
    check('① 매장이 single 로 열리고 만료일 = 기간 끝', u1?.status === 'active' && u1?.plan === 'single' && near(u1?.paid_until, s1?.current_period_end, 5000), JSON.stringify(u1));
    check('① 카드 정보가 구독에 복사(마스킹 번호)', s1?.card_number === '43301234****123*', s1?.card_number);
    const rec1b = await svcRpc('card_record_charge', { p_order_id: o1.order_id, p_ok: true, p_approved_at: new Date(Date.now() + 86400000 * 3).toISOString() });
    const s1b = await sub(O.uid);
    check('★① 같은 주문 재반영 = replayed · 기간 불변(멱등)', rec1b.data?.replayed === true && s1b?.current_period_end === s1?.current_period_end, JSON.stringify(rec1b.data));

    // ── ②③ 구독 중 가드 ──
    check('② 이미 구독 중이면 새 구독 거부', /card_subscription_exists/.test((await begin(O, 'single', 1)).err));
    const claim = await O.c.rpc('submit_payment_claim', { p_plan: 'single', p_depositor: 'QA', p_terms_version: TERMS, p_store_count: 1 });
    check('★③ 카드 구독 중 계좌이체 신고 거부', /card_subscription_active/.test(claim.error?.message ?? ''), claim.error?.message ?? 'no error');

    // ── ④ 늘리기 ──
    const ch1 = await svcRpc('card_begin_change', { p_owner: O.uid, p_plan: 'multi', p_count: 2 });
    const expectDiff = 58000 - 25000;
    check('④ 늘리기 = 즉시 차액 결제 주문(기간 초반이라 차액 ≈ 33,000)', ch1.data?.mode === 'charge' && Math.abs(ch1.data.amount_krw - expectDiff) <= 200 && ch1.data.billing_key === 'bk_qa_1', JSON.stringify(ch1.data));
    await svcRpc('card_record_charge', { p_order_id: ch1.data.order_id, p_ok: true, p_payment_key: 'pk_qa_up' });
    const s2 = await sub(O.uid);
    check('④ 반영 → multi 2 · 다음 결제 58,000 · 기간 그대로', s2?.plan === 'multi' && s2?.store_count === 2 && s2?.amount_krw === 58000 && s2?.current_period_end === s1?.current_period_end, JSON.stringify({ plan: s2?.plan, n: s2?.store_count, amt: s2?.amount_krw }));
    check('④ 1호점이 multi 로 바뀜', (await unitSub(O.unit))?.plan === 'multi');
    const st2 = await O.c.rpc('create_store', { p_store_name: 'QA카드1 2호점', p_industry: '카페·디저트', p_biz_no: null });
    const unit2 = st2.data?.[0]?.unit_id;
    const u2 = unit2 ? await unitSub(unit2) : null;
    check('★④ 늘린 슬롯으로 2호점 생성 → multi 로 열림', !!unit2 && u2?.plan === 'multi' && u2?.status === 'active', st2.error?.message ?? JSON.stringify(u2));

    // ── ⑪ 늘리기 거절 알림 ──
    const chx = await svcRpc('card_begin_change', { p_owner: O.uid, p_plan: 'multi', p_count: 3 });
    await svcRpc('card_record_charge', { p_order_id: chx.data?.order_id, p_ok: false, p_fail_code: 'REJECT_CARD_COMPANY', p_fail_message: '잔액 부족' });
    await svcRpc('card_record_charge', { p_order_id: chx.data?.order_id, p_ok: false, p_fail_message: '재반영' });
    const upAl = await alertsByPeriod(chx.data?.order_id);
    const oActive = await activeUnitOf(O.uid);
    check('★⑪ 늘리기 거절 → 실패 알림 1행(재반영해도 1행) · 활성 매장에 붙음 · 요금제 그대로', upAl.length === 1 && upAl[0].step === 0 && upAl[0].unit_id === oActive && /잔액 부족/.test(upAl[0].body) && (await sub(O.uid))?.store_count === 2, JSON.stringify({ upAl, oActive }));
    check('⑪ 늘리기 거절 알림에 카드·웹 문구 없음', noChannelWords(upAl[0]), `${upAl[0]?.title} / ${upAl[0]?.body}`);

    // ── ④ 줄이기 · 예고 취소 ──
    // 열린 매장 2곳 → single = 1곳을 닫아야 한다(⑬). 2호점을 닫는다.
    const ch2 = await svcRpc('card_begin_change', { p_owner: O.uid, p_plan: 'single', p_count: 1, p_release: [unit2] });
    const s3 = await sub(O.uid);
    check('④ 줄이기 = 예고만(매장·금액 그대로)', ch2.data?.mode === 'scheduled' && s3?.pending_plan === 'single' && s3?.amount_krw === 58000 && (await unitSub(O.unit))?.plan === 'multi', JSON.stringify(ch2.data));
    const ch3 = await svcRpc('card_begin_change', { p_owner: O.uid, p_plan: 'multi', p_count: 2 });
    check('④ 지금과 같은 선택 = 예고 취소', ch3.data?.mode === 'none' && (await sub(O.uid))?.pending_plan === null, JSON.stringify(ch3.data));

    // ── ⑤ 갱신 ──
    const oldEnd = s2.current_period_end;
    // 늘리기 결제가 진행 중이면 갱신 크론은 그 사장을 건너뛴다(같은 순간 두 건이 나가지 않게).
    const upOrder = `UPqa${Date.now()}`;
    await svcWrite('POST', 'card_payments', { order_id: upOrder, owner_id: O.uid, kind: 'upgrade', plan: 'multi', store_count: 3, amount_krw: 100, livemode: false, order_name: 'qa' });
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${O.uid}`, { next_charge_at: new Date(Date.now() - 60000).toISOString() });
    const dueBlocked = await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid });
    check('★⑤ 늘리기 결제가 진행 중이면 갱신 크론이 건너뛴다', Array.isArray(dueBlocked.data) && dueBlocked.data.length === 0, JSON.stringify(dueBlocked.data));
    await svcWrite('DELETE', `card_payments?order_id=eq.${upOrder}`);
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${O.uid}`, { next_charge_at: new Date(Date.now() - 60000).toISOString() });
    const due = await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid });
    const d0 = Array.isArray(due.data) ? due.data[0] : null;
    check('⑤ 청구 대상 선점 · 금액 58,000 · 빌링키·이메일 동봉', d0?.amount_krw === 58000 && d0?.billing_key === 'bk_qa_1' && d0?.customer_email === O.email && /^RN/.test(d0?.order_id), due.err || JSON.stringify(d0));
    const due2 = await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid });
    check('★⑤ 선점 직후 다시 불러도 0건(이중 청구 방지)', Array.isArray(due2.data) && due2.data.length === 0, JSON.stringify(due2.data));
    // 토스 응답 유실 → 대사도 못 닫은 채 15분이 지나 재선점 조건이 풀린 상황(09-15 독립 검증 CONFIRMED 재현).
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${O.uid}`, { charging_at: new Date(Date.now() - 20 * 60000).toISOString() });
    const dueStale = await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid });
    check('★⑤ 결과 모르는 갱신 주문이 남아 있으면 15분이 지나도 새 갱신 주문을 만들지 않는다', Array.isArray(dueStale.data) && dueStale.data.length === 0, JSON.stringify(dueStale.data));
    const dueLive = await svcRpc('card_claim_due', { p_livemode: true, p_owner: O.uid });
    check('⑤ 라이브 키 크론은 테스트 구독을 청구하지 않는다', Array.isArray(dueLive.data) && dueLive.data.length === 0);
    await svcRpc('card_record_charge', { p_order_id: d0.order_id, p_ok: true, p_payment_key: 'pk_qa_rn', p_approved_at: new Date().toISOString() });
    const s4 = await sub(O.uid);
    check('★⑤ 갱신 = 기존 끝 + 1개월(대입) · charging_at 해제', near(s4?.current_period_end, plusMonth(oldEnd), 5000) && s4?.charging_at === null && s4?.current_period_start === oldEnd, `${oldEnd} → ${s4?.current_period_end}`);
    const u1r = await unitSub(O.unit);
    check('★⑤ 매장 만료일이 새 기간 끝과 같다(누적 아님)', near(u1r?.paid_until, s4?.current_period_end, 5000), `${u1r?.paid_until}`);

    // 예고가 갱신 금액에 반영되는가
    await svcRpc('card_begin_change', { p_owner: O.uid, p_plan: 'single', p_count: 1, p_release: [unit2] });
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${O.uid}`, { next_charge_at: new Date(Date.now() - 60000).toISOString() });
    const due3 = await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid });
    const d3 = due3.data?.[0];
    check('⑤ 줄이기 예고 → 다음 갱신 금액 25,000', d3?.amount_krw === 25000, JSON.stringify(d3));

    // ── ⑥ 갱신 실패 ──
    await svcRpc('card_record_charge', { p_order_id: d3.order_id, p_ok: false, p_fail_code: 'REJECT_CARD_COMPANY', p_fail_message: '한도 초과' });
    const f1 = await sub(O.uid);
    check('⑥ 1회 실패 → past_due · fail 1 · 하루 뒤 재시도', f1?.status === 'past_due' && f1?.fail_count === 1 && near(f1?.next_charge_at, Date.now() + 86400000, 300000) && f1?.last_fail_message === '한도 초과', JSON.stringify({ s: f1?.status, n: f1?.fail_count }));
    await svcRpc('card_record_charge', { p_order_id: d3.order_id, p_ok: false, p_fail_message: '재반영' });
    const rnAl1 = await alertsByPeriod(d3.order_id);
    check('★⑪ 갱신 실패 → 실패 알림 1행(활성 매장 · 1회차 · 사유·재시도일) · 재반영해도 1행', rnAl1.length === 1 && rnAl1[0].unit_id === (await activeUnitOf(O.uid)) && rnAl1[0].step === 1 && /한도 초과/.test(rnAl1[0].body) && /남은 시도 2번/.test(rnAl1[0].body), JSON.stringify(rnAl1));
    check('⑪ 갱신 실패 알림에 카드·웹 문구 없음', noChannelWords(rnAl1[0]), `${rnAl1[0]?.title} / ${rnAl1[0]?.body}`);
    for (let i = 0; i < 2; i++) {
      await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${O.uid}`, { next_charge_at: new Date(Date.now() - 60000).toISOString() });
      const d = (await svcRpc('card_claim_due', { p_livemode: false, p_owner: O.uid })).data?.[0];
      if (d) await svcRpc('card_record_charge', { p_order_id: d.order_id, p_ok: false, p_fail_code: 'X', p_fail_message: '실패' });
    }
    const f3 = await sub(O.uid);
    check('⑥ 3회 실패 → expired · 더 청구하지 않음', f3?.status === 'expired' && f3?.next_charge_at === null && f3?.fail_count === 3, JSON.stringify({ s: f3?.status, n: f3?.fail_count }));
    const rnAll = (await svcSel(`owner_alerts?kind=eq.card_fail&period=like.RN*&step=gt.0&unit_id=eq.${await activeUnitOf(O.uid)}&select=step,title,period&order=id`))
      .filter((a) => a.period.startsWith('RN'));
    check('★⑪ 실패 3회 = 알림 3행(1·2·3회차) · 마지막은 "멈췄어요"', rnAll.map((a) => a.step).join() === '1,2,3' && /멈췄어요/.test(rnAll[2]?.title ?? ''), JSON.stringify(rnAll.map((a) => [a.step, a.title])));

    // ── ⑨ 빌링키 정리 ──
    const hk = await svcRpc('card_housekeeping', { p_livemode: false });
    const mine = (hk.data ?? []).find((r) => r.owner_id === O.uid);
    check('⑨ 끝난 구독의 빌링키가 삭제 대상으로 나온다', mine?.billing_key === 'bk_qa_1', JSON.stringify(hk.data));
    await svcRpc('card_forget_billing_key', { p_owner: O.uid, p_billing_key: 'bk_qa_1' });
    check('⑨ 삭제 후 빌링키 비워짐', (await svcSel(`card_billing_keys?owner_id=eq.${O.uid}&select=billing_key`))[0]?.billing_key === null);

    // ── ⑦ 해지 · 해지 취소 ──
    const P = await account(2);
    const bp = orderOf(await begin(P, 'single', 1));
    const kp = (await P.c.rpc('card_customer_key')).data;
    await svcRpc('card_save_billing_key', { p_owner: P.uid, p_customer_key: kp, p_billing_key: 'bk_qa_2', p_card_company: '신한', p_card_number: '5555****' });
    await svcRpc('card_record_charge', { p_order_id: bp.order_id, p_ok: true, p_payment_key: 'pk_qa_2' });
    const cancel = await P.c.rpc('card_cancel_subscription');
    check('⑦ 해지 → canceled · 다음 청구 없음 · 매장은 계속 열림', cancel.data?.status === 'canceled' && cancel.data?.next_charge_at === null && (await unitSub(P.unit))?.status === 'active', cancel.error?.message ?? '');
    const claimP = await P.c.rpc('submit_payment_claim', { p_plan: 'single', p_depositor: 'QA', p_terms_version: TERMS, p_store_count: 1 });
    check('⑦ 해지 예약 중엔 계좌이체로 이어 붙이기 허용', !claimP.error, claimP.error?.message ?? '');
    if (claimP.data?.id) await svcWrite('DELETE', `payment_claims?id=eq.${claimP.data.id}`);
    const resume = await P.c.rpc('card_resume_subscription');
    check('⑦ 해지 취소 → active · 다음 청구 = 기간 끝 하루 전', resume.data?.status === 'active' && near(resume.data?.next_charge_at, new Date(new Date(resume.data?.current_period_end) - 86400000)), resume.error?.message ?? '');

    // ── ⑪ 결제 3일 전 예고 · 해지 예약 끝 3일 전 예고 ──
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${P.uid}`, { next_charge_at: days(5), current_period_end: days(6) });
    await sweepNow();
    check('⑪ 결제 5일 전엔 예고 없음', (await alertsOf(P.unit, 'card_renew')).length === 0);
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${P.uid}`, { next_charge_at: days(2), current_period_end: days(3) });
    await sweepNow();
    await sweepNow();
    const rnw = await alertsOf(P.unit, 'card_renew');
    check('★⑪ 결제 3일 안 → 예고 1행(스윕 두 번에도 1행) · 금액 25,000원', rnw.length === 1 && /25,000원이 결제돼요/.test(rnw[0].title) && /해지/.test(rnw[0].body), JSON.stringify(rnw));
    check('⑪ 결제 예고에 카드·웹 문구 없음', noChannelWords(rnw[0]), `${rnw[0]?.title} / ${rnw[0]?.body}`);
    await P.c.rpc('card_cancel_subscription');
    await sweepNow();
    check('⑪ 기간 끝 3일 안에 방금 해지한 사장에겐 끝 예고를 보내지 않는다', (await alertsOf(P.unit, 'card_end')).length === 0);
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${P.uid}`, { canceled_at: days(-10) });
    await sweepNow();
    await sweepNow();
    const endAl = await alertsOf(P.unit, 'card_end');
    check('★⑪ 해지 예약 끝 3일 안 → 끝 예고 1행(스윕 두 번에도 1행)', endAl.length === 1 && /이용 기간이 끝나요/.test(endAl[0].title) && /해지를 취소/.test(endAl[0].body), JSON.stringify(endAl));
    check('⑪ 끝 예고에 카드·웹 문구 없음', noChannelWords(endAl[0]), `${endAl[0]?.title} / ${endAl[0]?.body}`);
    const resume2 = await P.c.rpc('card_resume_subscription');
    check('셋업 다시 해지 취소', !resume2.error, resume2.error?.message ?? '');

    // ── ⑩ RLS ──
    const mySub = await P.c.from('card_subscriptions').select('owner_id,status');
    check('⑩ 사장은 자기 구독만 본다', (mySub.data ?? []).length === 1 && mySub.data[0].owner_id === P.uid, JSON.stringify(mySub.error ?? mySub.data));
    const keys = await P.c.from('card_billing_keys').select('billing_key');
    check('★⑩ 빌링키 테이블은 본인도 못 읽는다', !!keys.error || (keys.data ?? []).length === 0, JSON.stringify(keys.error?.code ?? keys.data));
    const other = await O.c.from('card_payments').select('order_id').eq('owner_id', P.uid);
    check('⑩ 남의 결제 원장은 0행', (other.data ?? []).length === 0);
    const direct = await P.c.rpc('card_record_charge', { p_order_id: bp.order_id, p_ok: true });
    check('★⑩ 사장이 결과 반영 RPC 를 직접 못 부른다', !!direct.error, direct.error?.code ?? 'no error');

    // ── ⑧ 환불 ──
    const rf = await svcRpc('card_record_refund', { p_order_id: bp.order_id, p_cancel_amount: 25000, p_revoke: true });
    const sp = await sub(P.uid);
    check('⑧ 전액 환불 → refunded · 매장 즉시 회수', rf.ok && sp?.status === 'refunded' && (await unitSub(P.unit))?.status === 'expired', rf.err || JSON.stringify(rf.data));
    const payP = (await svcSel(`card_payments?order_id=eq.${bp.order_id}&select=status,canceled_amount_krw`))[0];
    check('⑧ 원장 = canceled · 취소액 기록', payP?.status === 'canceled' && payP?.canceled_amount_krw === 25000, JSON.stringify(payP));

    // ── ⑬-b 옛 구독 흔적이 남은 사장의 다점포 재결제 — 산 매장 수만큼 다 열린다(09-15 독립 검증 CONFIRMED, sync_iap_slots 공용) ──
    //   P: 1호점 = 방금 환불로 닫힌 옛 흔적 매장. 무료 매장 2곳을 더 만든 뒤 다점포 3을 새로 결제한다.
    for (let i = 0; i < 2; i++) await svcWrite('POST', 'store_slots', { owner_id: P.uid, paid_until: days(30), claim_id: null, source: 'grant' });
    const pB = (await P.c.rpc('create_store', { p_store_name: 'QA카드2 재결제 B', p_industry: '카페·디저트', p_biz_no: null })).data?.[0]?.unit_id;
    const pC = (await P.c.rpc('create_store', { p_store_name: 'QA카드2 재결제 C', p_industry: '카페·디저트', p_biz_no: null })).data?.[0]?.unit_id;
    for (const u of [pB, pC]) {
      await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${u}`, { status: 'trialing', plan: 'free', paid_until: null, trial_ends_at: days(-1) });
    }
    const pTrace = await svcSel(`store_slots?owner_id=eq.${P.uid}&source=eq.iap&consumed_unit_id=eq.${P.unit}&select=id`);
    check('셋업 ⑬-b 1호점에 옛 구독 흔적 · B·C 무료', pTrace.length > 0 && (await unitSub(pB))?.plan === 'free' && (await unitSub(pC))?.plan === 'free', `trace=${pTrace.length}`);
    const reOrder = `FPqa${Date.now()}`;
    await svcWrite('POST', 'card_payments', { order_id: reOrder, owner_id: P.uid, kind: 'first', plan: 'multi', store_count: 3, amount_krw: 87000, livemode: false, order_name: 'qa 재결제', terms_version: TERMS });
    const reRec = await svcRpc('card_record_charge', { p_order_id: reOrder, p_ok: true, p_payment_key: 'pk_qa_re' });
    const pEnd = (await sub(P.uid))?.current_period_end;
    const [r1, r2, r3] = [await unitSub(P.unit), await unitSub(pB), await unitSub(pC)];
    check('★⑬-b 옛 흔적 매장 + 무료 2곳 → 다점포 3 결제 = 3곳 모두 열림(허공에 뜬 슬롯 없음)',
      reRec.ok && [r1, r2, r3].every((x) => x?.status === 'active' && x?.plan === 'multi' && near(x?.paid_until, pEnd, 5000)),
      reRec.err || JSON.stringify({ r1, r2, r3, pEnd }));
    const pOpenSlots = await svcSel(`store_slots?owner_id=eq.${P.uid}&source=eq.iap&consumed_at=is.null&select=id`);
    check('⑬-b 미소비 구독 슬롯 0개', pOpenSlots.length === 0, `open=${pOpenSlots.length}`);

    // ── ② 앱 구독·계좌이체 대기 가드 ──
    const Q = await account(3);
    await svcWrite('POST', 'iap_subscriptions', { owner_id: Q.uid, platform: 'appstore', product_id: 'single_1_monthly', store_count: 1, original_transaction_id: `qa_card_${Date.now()}`, status: 'active', current_period_end: new Date(Date.now() + 20 * 86400000).toISOString() });
    check('② 앱 스토어 구독 중이면 카드 구독 거부', /iap_subscription_active/.test((await begin(Q, 'single', 1)).err));

    // ── ⑫ 앱 구독이 살아 있으면 카드 쪽이 물러난다(웹 카드 → 기간 끝난 재시도 중 → 앱에서 구매한 경우) ──
    const kq = (await Q.c.rpc('card_customer_key')).data;
    await svcRpc('card_save_billing_key', { p_owner: Q.uid, p_customer_key: kq, p_billing_key: 'bk_qa_q', p_card_company: 'X', p_card_number: 'X' });
    const qSub = { owner_id: Q.uid, plan: 'single', store_count: 1, amount_krw: 25000, livemode: false, terms_version: TERMS, agreed_at: new Date().toISOString() };
    await svcWrite('POST', 'card_subscriptions', { ...qSub, status: 'past_due', fail_count: 1, current_period_start: days(-31), current_period_end: days(-1), next_charge_at: days(-0.01) });
    await svcWrite('POST', 'iap_release_choice', { owner_id: Q.uid, unit_id: Q.unit });
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${Q.uid}`, { pending_plan: 'single', pending_store_count: 1 });
    const dq = await svcRpc('card_claim_due', { p_livemode: false, p_owner: Q.uid });
    const sq = await sub(Q.uid);
    check('★⑫ 재시도 중(past_due) 사장이 앱 구독을 사면 카드 청구 0건 · expired · 다음 청구 없음', Array.isArray(dq.data) && dq.data.length === 0 && sq?.status === 'expired' && sq?.next_charge_at === null, JSON.stringify({ due: dq.data, s: sq?.status }));
    check('⑫ 멈춘 카드 구독의 줄이기 예고·닫을 매장 명단도 버린다', sq?.pending_plan === null && (await choicesOf(Q.uid)).length === 0);
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${Q.uid}`, { status: 'active', current_period_end: days(10), next_charge_at: days(-0.01), canceled_at: null });
    const dq2 = await svcRpc('card_claim_due', { p_livemode: false, p_owner: Q.uid });
    const sq2 = await sub(Q.uid);
    check('★⑫ 자동결제 중(active)이어도 앱 구독이 살아 있으면 청구 0건 · canceled(낸 기간은 유지)', (dq2.data ?? []).length === 0 && sq2?.status === 'canceled' && sq2?.current_period_end && new Date(sq2.current_period_end) > new Date(), JSON.stringify({ due: dq2.data, s: sq2?.status }));
    const rq = await Q.c.rpc('card_resume_subscription');
    check('⑫ 앱 구독 중엔 카드 해지 취소 거부', /iap_subscription_active/.test(rq.error?.message ?? ''), rq.error?.message ?? 'no error');
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${Q.uid}`, { status: 'active', next_charge_at: days(2), current_period_end: days(3), canceled_at: null });
    check('⑫ 앱 구독 중엔 카드 요금 변경 거부', /iap_subscription_active/.test((await svcRpc('card_begin_change', { p_owner: Q.uid, p_plan: 'multi', p_count: 2 })).err));
    await sweepNow();
    check('⑫ 앱 구독 중엔 결제 예고 알림 없음', (await alertsOf(Q.unit, 'card_renew')).length === 0);
    await svcWrite('DELETE', `card_subscriptions?owner_id=eq.${Q.uid}`);
    const R = await account(4);
    const cr = await R.c.rpc('submit_payment_claim', { p_plan: 'single', p_depositor: 'QA', p_terms_version: TERMS, p_store_count: 1 });
    check('셋업 계좌이체 신고', !cr.error, cr.error?.message ?? '');
    check('② 계좌이체 확인 대기 중이면 카드 구독 거부', /payment_claim_pending/.test((await begin(R, 'single', 1)).err));

    // ── ⑨ 첫 결제가 거절돼 구독이 안 생긴 빌링키도 정리 대상(발급 1일 경과) ──
    const kr = (await R.c.rpc('card_customer_key')).data;
    await svcRpc('card_save_billing_key', { p_owner: R.uid, p_customer_key: kr, p_billing_key: 'bk_qa_orphan', p_card_company: 'X', p_card_number: 'X' });
    const hk1 = await svcRpc('card_housekeeping', { p_livemode: false });
    check('⑨ 방금 발급된 고아 키는 아직 안 지운다', !(hk1.data ?? []).some((r) => r.owner_id === R.uid));
    await svcWrite('PATCH', `card_billing_keys?owner_id=eq.${R.uid}`, { issued_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    const hk2 = await svcRpc('card_housekeeping', { p_livemode: false });
    check('★⑨ 구독 없이 하루 지난 빌링키는 삭제 대상', (hk2.data ?? []).some((r) => r.owner_id === R.uid && r.billing_key === 'bk_qa_orphan'), JSON.stringify(hk2.data));

    await releaseChecks();
    await subAlertChecks();
  } finally {
    if (trial !== null) await svcWrite('PATCH', 'app_config?key=eq.signup_trial_days', { value: trial });
    if (fm !== null) await svcWrite('PATCH', 'app_config?key=eq.billing_free_mode', { value: fm });
  }
}

// ⑬ 줄이기 — 닫을 매장. dbChecks 안에서 부른다(app_config 를 끈 상태가 필요하다).
async function releaseChecks() {
  const S = await account(5);
  const ks = (await S.c.rpc('card_customer_key')).data;
  const bs = orderOf(await begin(S, 'multi', 3));
  await svcRpc('card_save_billing_key', { p_owner: S.uid, p_customer_key: ks, p_billing_key: 'bk_qa_5', p_card_company: 'X', p_card_number: 'X' });
  await svcRpc('card_record_charge', { p_order_id: bs.order_id, p_ok: true, p_payment_key: 'pk_qa_5' });
  const u1 = S.unit;
  const u2 = (await S.c.rpc('create_store', { p_store_name: 'QA카드5 2호점', p_industry: '카페·디저트', p_biz_no: null })).data?.[0]?.unit_id;
  const u3 = (await S.c.rpc('create_store', { p_store_name: 'QA카드5 3호점', p_industry: '카페·디저트', p_biz_no: null })).data?.[0]?.unit_id;
  check('셋업 ⑬ 다점포 3 · 매장 3곳 열림', !!u2 && !!u3 && (await sub(S.uid))?.store_count === 3 && (await unitSub(u3))?.status === 'active', `${u2} ${u3}`);
  // 구독 밖에서 연 매장(무료지급 슬롯 — 계좌이체와 같은 "흔적 없음") · 가장 오래된 매장으로 만든다(single 분기가 오래된 순이라서).
  await svcWrite('POST', 'store_slots', { owner_id: S.uid, paid_until: days(60), claim_id: null, source: 'grant' });
  const u4 = (await S.c.rpc('create_store', { p_store_name: 'QA카드5 따로 연 점', p_industry: '카페·디저트', p_biz_no: null })).data?.[0]?.unit_id;
  await svcWrite('PATCH', `units?id=eq.${u4}`, { created_at: days(-400) });
  const u4Start = await unitSub(u4);
  check('셋업 ⑬ 구독 밖 매장 열림(가장 오래된 매장)', u4Start?.status === 'active', JSON.stringify(u4Start));
  const cand = ((await S.c.rpc('my_card_release_candidates')).data ?? []).map((r) => r.unit_id).sort();
  check('★⑬ 닫을 매장 후보 = 구독으로 연 3곳(구독 밖 매장 제외)', JSON.stringify(cand) === JSON.stringify([u1, u2, u3].sort()), JSON.stringify(cand));
  const change = (plan, count, release) => svcRpc('card_begin_change', { p_owner: S.uid, p_plan: plan, p_count: count, p_release: release ?? null });

  check('⑬ 줄이기인데 닫을 매장이 없으면 거부', /release_required/.test((await change('multi', 2)).err));
  check('⑬ 개수가 틀리면 거부(2곳)', /release_mismatch/.test((await change('multi', 2, [u2, u3])).err));
  const O = await svcSel(`units?owner_id=neq.${S.uid}&select=id&limit=1`);
  check('⑬ 남의 매장이면 거부', /release_mismatch/.test((await change('multi', 2, [O[0]?.id ?? 'x'])).err));
  check('★⑬ 구독 밖 매장은 닫을 매장으로 못 고른다(골라도 안 닫힌다)', /release_mismatch/.test((await change('multi', 2, [u4])).err));
  const sc = await change('multi', 2, [u2]);
  check('⑬ 1곳 고르면 예고 + 명단 = 그 매장', sc.data?.mode === 'scheduled' && JSON.stringify(await choicesOf(S.uid)) === JSON.stringify([u2]), sc.err || JSON.stringify(sc.data));
  const none = await change('multi', 3);
  check('★⑬ 예고 취소(지금과 같은 선택) → 명단 비움', none.data?.mode === 'none' && (await choicesOf(S.uid)).length === 0 && (await sub(S.uid))?.pending_plan === null, JSON.stringify(none.data));

  await change('multi', 2, [u2]);
  const up = await change('multi', 4);
  await svcRpc('card_record_charge', { p_order_id: up.data?.order_id, p_ok: true, p_payment_key: 'pk_qa_5up' });
  const sUp = await sub(S.uid);
  check('★⑬ 늘리기로 되돌리면 예고·명단 비움 · 매장 3곳 계속 열림', sUp?.store_count === 4 && sUp?.pending_plan === null && (await choicesOf(S.uid)).length === 0 && (await unitSub(u2))?.status === 'active', JSON.stringify({ n: sUp?.store_count, p: sUp?.pending_plan }));

  await change('multi', 2, [u1]);
  await S.c.rpc('card_cancel_subscription');
  check('★⑬ 해지하면 명단 비움', (await choicesOf(S.uid)).length === 0);
  await S.c.rpc('card_resume_subscription');

  // 1호점(가장 오래된 매장)을 닫고 2·3호점을 남긴다 — 서버가 "오래된 순"으로 대신 고르면 틀린다.
  const sch = await change('multi', 2, [u1]);
  check('⑬ 1호점 닫기 예고', sch.data?.mode === 'scheduled', sch.err);
  const before = await sub(S.uid);
  const u1Before = (await unitSub(u1))?.paid_until;
  await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${S.uid}`, { next_charge_at: days(-0.01) });
  const dr = (await svcRpc('card_claim_due', { p_livemode: false, p_owner: S.uid })).data?.[0];
  check('⑬ 갱신 금액 = 줄인 요금 58,000', dr?.amount_krw === 58000, JSON.stringify(dr));
  await svcRpc('card_record_charge', { p_order_id: dr?.order_id, p_ok: true, p_payment_key: 'pk_qa_5rn', p_approved_at: new Date().toISOString() });
  const after = await sub(S.uid);
  const [a1, a2, a3] = [await unitSub(u1), await unitSub(u2), await unitSub(u3)];
  check('★⑬ 갱신 → 고른 1호점만 연장 안 됨 · 2·3호점은 새 기간 끝까지', a1?.paid_until === u1Before && near(a2?.paid_until, after?.current_period_end, 5000) && near(a3?.paid_until, after?.current_period_end, 5000), JSON.stringify({ a1: a1?.paid_until, a2: a2?.paid_until, end: after?.current_period_end, was: before?.current_period_end }));
  check('⑬ 갱신 후 명단·예고 비움 · 다점포 2', (await choicesOf(S.uid)).length === 0 && after?.pending_plan === null && after?.store_count === 2);
  const trace = await svcSel(`store_slots?owner_id=eq.${S.uid}&source=eq.iap&consumed_unit_id=eq.${u1}&select=id`);
  check('⑬ 닫은 1호점의 구독 흔적이 떨어졌다(다음 갱신에 되살아나지 않게)', trace.length === 0, JSON.stringify(trace));

  // 1호점 기간이 끝나 잠긴 이전 매장이 된다 → 후보가 아니다. 2호점을 닫고 3호점만 남기는 single 줄이기.
  await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${u1}`, { paid_until: days(-0.01) });
  const { data: locked1 } = await S.c.rpc('unit_access_locked', { p_unit: u1 });
  check('셋업 ⑬ 1호점 = 잠긴 이전 매장', locked1 === true, String(locked1));
  check('★⑬ 잠긴 이전 매장은 닫을 매장 후보가 아니다', /release_mismatch/.test((await change('single', 1, [u1])).err));
  const ss = await change('single', 1, [u2]);
  check('⑬ 2호점 닫기 → single 예고', ss.data?.mode === 'scheduled', ss.err);
  const u2Before = (await unitSub(u2))?.paid_until;
  await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${S.uid}`, { next_charge_at: days(-0.01) });
  const ds = (await svcRpc('card_claim_due', { p_livemode: false, p_owner: S.uid })).data?.[0];
  await svcRpc('card_record_charge', { p_order_id: ds?.order_id, p_ok: true, p_payment_key: 'pk_qa_5rn2', p_approved_at: new Date().toISOString() });
  const fin = await sub(S.uid);
  const [b1, b2, b3] = [await unitSub(u1), await unitSub(u2), await unitSub(u3)];
  check('★⑬ single 갱신 → 남긴 3호점이 열린다(더 오래된 이전 1호점이 되살아나지 않는다)', near(b3?.paid_until, fin?.current_period_end, 5000) && b3?.plan === 'single' && new Date(b1?.paid_until) < new Date() && b2?.paid_until === u2Before, JSON.stringify({ b1: b1?.paid_until, b2: b2?.paid_until, b3: [b3?.plan, b3?.paid_until], end: fin?.current_period_end }));
  const b4 = await unitSub(u4);
  check('★⑬ single 갱신이 가장 오래된 구독 밖 매장을 카드 돈으로 연장하지 않는다', b4?.paid_until === u4Start?.paid_until && b4?.plan === u4Start?.plan, JSON.stringify({ before: u4Start, after: b4 }));
}

// ⑭ 구독 상태 알림(0232) — 결제 채널과 무관한 sub_renewed·sub_ending·sub_ended. dbChecks 안에서 부른다(무료 모드 꺼짐 필요).
//   기간 끝은 기다리지 않고 구독 행·매장 만료일을 과거로 옮겨 시뮬레이션한다(0191 하니스와 같은 방식).
//   본사 부담 검사는 brands·brand_units 행을 만들어야 해서 로컬(127.0.0.1·localhost)에서만 돈다.
async function subAlertChecks() {
  console.log('\n■ ⑭ 구독 상태 알림(0232)');
  const subAlerts = (uid, kind) =>
    svcSel(`owner_alerts?kind=eq.${kind}&period=like.${encodeURIComponent(`${uid}:*`)}&select=unit_id,period,step,title,body&order=id`);
  // 앱 알림함·잠금화면에도 나간다 — 채널·결제·금액을 말하면 안 된다(0232 설계 ①). '원'은 금액 꼴만 본다.
  const neutral = (a) => !!a && !/카드|웹|애플|구글|스토어|결제|\d[\d,]*원/.test(`${a.title} ${a.body}`);
  const kstDay = (iso) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.month}월 ${p.day}일`;
  };
  const sweep2 = async () => { await sweepNow(); await sweepNow(); };   // 두 번 돌려도 1행이어야 한다
  const cardFirst = async (o, bk) => {
    const b = orderOf(await begin(o, 'single', 1));
    const ck = (await o.c.rpc('card_customer_key')).data;
    await svcRpc('card_save_billing_key', { p_owner: o.uid, p_customer_key: ck, p_billing_key: bk, p_card_company: '신한', p_card_number: '5555****' });
    await svcRpc('card_record_charge', { p_order_id: b.order_id, p_ok: true, p_payment_key: `pk_${bk}` });
  };
  // 기간 끝 시뮬레이션. keepUnit = 매장 만료일은 두고 구독만 끝낸다(계좌이체·본사로 더 열린 매장).
  const endCard = async (o, keepUnit = false) => {
    await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${o.uid}`, { current_period_end: days(-0.01) });
    if (!keepUnit) await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${o.unit}`, { paid_until: days(-0.01) });
    await svcRpc('card_housekeeping', { p_livemode: false });
  };

  // ── 카드: 첫 결제 → 갱신 → 해지 → 기간 끝 ──
  const P = await account(2);
  await cardFirst(P, 'bk_qa_sub_p');
  await sweep2();
  check('⑭ 카드 첫 결제엔 늘었어요 없음', (await subAlerts(P.uid, 'sub_renewed')).length === 0);
  await svcWrite('PATCH', `card_subscriptions?owner_id=eq.${P.uid}`, { next_charge_at: days(-0.01) });
  const dp = (await svcRpc('card_claim_due', { p_livemode: false, p_owner: P.uid })).data?.[0];
  await svcRpc('card_record_charge', { p_order_id: dp?.order_id, p_ok: true, p_payment_key: 'pk_qa_sub_rn', p_approved_at: new Date().toISOString() });
  await sweep2();
  const pEnd = (await sub(P.uid))?.current_period_end;
  const pr = await subAlerts(P.uid, 'sub_renewed');
  check('★⑭ 카드 갱신 → 늘었어요 1행 · 날짜 = 새 기간 끝 · 활성 매장', pr.length === 1 && pr[0].title === `이용 기간이 ${kstDay(pEnd)}까지 늘었어요` && pr[0].unit_id === (await activeUnitOf(P.uid)), JSON.stringify(pr));
  check('⑭ 늘었어요 문구에 채널·금액 없음', neutral(pr[0]), `${pr[0]?.title} / ${pr[0]?.body}`);
  const pc = await P.c.rpc('card_cancel_subscription');
  await sweep2();
  const pe = await subAlerts(P.uid, 'sub_ending');
  check('★⑭ 카드 해지 → 끝나요 1행 · 날짜 = 기간 끝 · "무료 요금제로 바뀌어요"', !pc.error && pe.length === 1 && pe[0].title === `${kstDay(pEnd)}에 이용 기간이 끝나요` && /무료 요금제로 바뀌어요/.test(pe[0].body), JSON.stringify(pe));
  check('⑭ 끝나요 문구에 채널·금액 없음', neutral(pe[0]), `${pe[0]?.title} / ${pe[0]?.body}`);
  check('⑭ 기간이 남은 해지 예약엔 끝났어요 없음', (await subAlerts(P.uid, 'sub_ended')).length === 0);
  await endCard(P);
  await sweep2();
  const pd = await subAlerts(P.uid, 'sub_ended');
  check('★⑭ 카드 기간 끝 → 끝났어요 1행', pd.length === 1 && pd[0].title === '이용 기간이 끝났어요' && (await sub(P.uid))?.status === 'expired', JSON.stringify(pd));
  check('⑭ 끝났어요 문구에 채널·금액 없음', neutral(pd[0]), `${pd[0]?.title} / ${pd[0]?.body}`);

  // ── 앱 구독: 첫 구매 → RENEWAL → CANCELLATION → EXPIRATION (웹훅과 같은 apply_iap_event 경로) ──
  const Q = await account(3);
  const txn = `qa_sub_${Date.now()}`;
  const iapEv = (type, end, reason = null) => svcRpc('apply_iap_event', {
    p_owner: Q.uid, p_platform: 'appstore', p_txn: txn, p_type: type, p_product_id: 'single_1_monthly',
    p_plan: 'single', p_count: 1, p_period_end: end, p_reason: reason, p_raw: { event: { type } },
  });
  const q0 = await iapEv('INITIAL_PURCHASE', days(30));
  await sweep2();
  check('⑭ 앱 첫 구매엔 늘었어요 없음', q0.ok && (await subAlerts(Q.uid, 'sub_renewed')).length === 0, q0.err);
  const qEnd = days(60);
  await iapEv('RENEWAL', qEnd);
  await sweep2();
  const qr = await subAlerts(Q.uid, 'sub_renewed');
  check('★⑭ 앱 RENEWAL → 늘었어요 1행 · 날짜 = 새 기간 끝', qr.length === 1 && qr[0].title === `이용 기간이 ${kstDay(qEnd)}까지 늘었어요` && qr[0].unit_id === Q.unit, JSON.stringify(qr));
  await iapEv('CANCELLATION', qEnd, 'UNSUBSCRIBE');
  await sweep2();
  const qe = await subAlerts(Q.uid, 'sub_ending');
  check('★⑭ 앱 해지(CANCELLATION·UNSUBSCRIBE) → 끝나요 1행', qe.length === 1 && qe[0].title === `${kstDay(qEnd)}에 이용 기간이 끝나요`, JSON.stringify(qe));
  await iapEv('EXPIRATION', days(-0.01), 'UNSUBSCRIBE');
  await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${Q.unit}`, { paid_until: days(-0.01) });
  await sweep2();
  const qd = await subAlerts(Q.uid, 'sub_ended');
  check('★⑭ 앱 EXPIRATION → 끝났어요 1행', qd.length === 1 && qd[0].title === '이용 기간이 끝났어요', JSON.stringify(qd));
  const qAll = [...qr, ...qe, ...qd];
  check('⑭ 앱 구독 알림 3행 모두 채널·금액 없음', qAll.length === 3 && qAll.every(neutral), JSON.stringify(qAll.map((a) => a.title)));
  check('⑭ 스윕을 더 돌려도 3종 각 1행', (await subAlerts(Q.uid, 'sub_renewed')).length === 1 && (await subAlerts(Q.uid, 'sub_ending')).length === 1 && (await subAlerts(Q.uid, 'sub_ended')).length === 1);

  // ── 계좌이체로 더 길게 열린 매장 — 구독이 끝나도 매장은 유료다 ──
  const R = await account(4);
  await cardFirst(R, 'bk_qa_sub_r');
  await svcWrite('PATCH', `unit_subscriptions?unit_id=eq.${R.unit}`, { paid_until: days(40) });
  await R.c.rpc('card_cancel_subscription');
  await sweep2();
  check('★⑭ 계좌이체로 더 열린 매장엔 끝나요 없음', (await subAlerts(R.uid, 'sub_ending')).length === 0);
  await endCard(R, true);
  await sweep2();
  check('★⑭ 계좌이체 유료 기간이 남은 매장엔 끝났어요 없음', (await subAlerts(R.uid, 'sub_ended')).length === 0 && (await unitSub(R.unit))?.status === 'active');

  // ── 본사 부담 매장 — 로컬만(라이브에 본사 행을 만들지 않는다) ──
  if (!/127\.0\.0\.1|localhost/.test(URL)) { skipped('⑭ 본사 부담 매장', '라이브 대상 — 본사 행을 만들지 않는다'); return; }
  const S = await account(5);
  const brandId = `qa_sub_brand_${Date.now()}`;
  try {
    await cardFirst(S, 'bk_qa_sub_s');
    await svcWrite('POST', 'brands', { id: brandId, name: 'QA구독알림본사' });
    await svcWrite('POST', 'brand_units', { brand_id: brandId, unit_id: S.unit, payer: 'brand', visibility: 'summary', accepted_by: S.uid });
    await S.c.rpc('card_cancel_subscription');
    await sweep2();
    check('★⑭ 본사 부담 매장엔 끝나요 없음', (await subAlerts(S.uid, 'sub_ending')).length === 0);
    await endCard(S);
    await sweep2();
    check('★⑭ 본사 부담 매장엔 끝났어요 없음(본사 입금 전이라 무료여도)', (await subAlerts(S.uid, 'sub_ended')).length === 0);
  } finally {
    await svcWrite('DELETE', `brand_units?brand_id=eq.${brandId}`).catch(() => {});
    await svcWrite('DELETE', `brands?id=eq.${brandId}`).catch(() => {});
  }
}

async function edgeChecks() {
  console.log('\n■ B. 엣지 card-billing');
  const ping = await fetch(FN, { method: 'OPTIONS' }).catch(() => null);
  if (!ping) { skipped('B 전체', `${FN} 에 연결 불가 — 함수가 떠 있지 않다`); return; }
  const call = async (token, body, auth = true) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const A = await account(1);   // 허용 목록(로컬 card.env)
  const N = await account(5);   // 허용 목록 밖
  const p1 = await call(A.token, { action: 'precheck' });
  if (p1.body?.reason === 'not_configured') { skipped('B 토스', 'TOSS_SECRET_KEY 미설정'); return; }
  check('precheck: 테스트 키 + 허용 목록 계정 = 열림', p1.body?.open === true && p1.body?.livemode === false, JSON.stringify(p1.body));
  const p5 = await call(N.token, { action: 'precheck' });
  check('★precheck: 테스트 키 + 목록 밖 계정 = 닫힘(운영 중 공짜 개통 방지)', p5.body?.open === false && p5.body?.reason === 'card_billing_not_open', JSON.stringify(p5.body));
  const s5 = await call(N.token, { action: 'subscribe', authKey: 'x', customerKey: 'y', plan: 'single', storeCount: 1, termsVersion: TERMS });
  check('★목록 밖 계정의 subscribe 는 403', s5.status === 403, JSON.stringify(s5));

  const ck = (await A.c.rpc('card_customer_key')).data;
  const sub1 = await call(A.token, { action: 'subscribe', authKey: 'qa_fake_auth_key', customerKey: ck, plan: 'single', storeCount: 1, termsVersion: TERMS });
  info('토스 응답(가짜 authKey)', JSON.stringify(sub1.body));
  check('토스 연결·인증 헤더 정상 — 가짜 authKey 는 토스가 거절(키 오류가 아님)', sub1.status === 402 && sub1.body?.error === 'card_register_failed' && !/UNAUTHORIZED_KEY|INVALID_API_KEY/.test(sub1.body?.code ?? ''), JSON.stringify(sub1.body));
  const pays = await svcSel(`card_payments?owner_id=eq.${A.uid}&select=status,fail_code&order=created_at.desc&limit=1`);
  check('카드 등록 실패 주문은 failed 로 닫힌다(대기 주문이 남지 않는다)', pays[0]?.status === 'failed', JSON.stringify(pays[0]));
  const again = await call(A.token, { action: 'subscribe', authKey: 'qa_fake_auth_key2', customerKey: ck, plan: 'single', storeCount: 1, termsVersion: TERMS });
  check('실패 직후 다시 시도 가능(payment_in_progress 로 막히지 않음)', again.body?.error === 'card_register_failed', JSON.stringify(again.body));
  const bad = await call(A.token, { action: 'subscribe', authKey: 'k', customerKey: 'cus_other', plan: 'single', storeCount: 1, termsVersion: TERMS });
  check('남의 고객키로는 빌링키 발급 전에 거부', bad.status === 409 && bad.body?.error === 'customer_key_mismatch', JSON.stringify(bad.body));

  const r0 = await call(A.token, { action: 'renew' });
  check('★renew 는 사장 토큰으로 못 부른다', r0.status === 401, JSON.stringify(r0));
  const r1 = await call(SERVICE, { action: 'renew' });
  check('renew(service_role) 정상 응답', r1.status === 200 && r1.body?.ok === true, JSON.stringify(r1.body));
}

async function main() {
  if (!URL || !ANON || !SERVICE) { console.error('URL/ANON/SERVICE 키가 필요하다'); process.exit(2); }
  console.log('대상:', URL);
  try {
    await dbChecks();
    await edgeChecks();
  } catch (e) {
    fail++;
    console.log('  FAIL 예외', e?.message ?? e);
  } finally {
    try { await cleanupSeededPhones(URL, SERVICE, seededPhones); } catch { /* */ }
  }
  console.log(`\n결과: pass ${pass} / fail ${fail} / skip ${skip}`);
  process.exit(fail ? 1 : 0);
}
main();
