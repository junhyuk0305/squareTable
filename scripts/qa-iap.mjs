#!/usr/bin/env node
// qa-iap.mjs — 인앱결제(IAP) 채널 검증. 설계 = `출시서류_안드로이드/15_인앱결제_티어사다리_설계_2026-09-06.md`
//
// A. 정적(항상 돈다) — 상품 표 SSOT 쌍이 갈라지지 않았나
//    `src/lib/config/iap.ts`(앱) ↔ `supabase/functions/iap-webhook/index.ts`(웹훅).
//    Deno 라 웹훅이 앱 파일을 import 할 수 없어 표가 두 벌이다. 갈라지면 **결제는 되는데 매장이 안 열린다**
//    — 사용자 입장에서 최악의 조합이라 이 검사가 제일 앞에 있다.
//
// B. 라이브(0187 적용 후에만) — sync_iap_slots 의 의미
//    ① 최초구매 = 슬롯 적립 + 배정
//    ② ★갱신은 **대입**이다(누적 아님) — 스토어 자동갱신은 만료 전에 오므로,
//       가산이면 갱신마다 기간이 앞서 나가 공짜 기간이 쌓인다(0187 초안이 이랬다)
//    ③ ★웹훅 재전송에 안전(같은 이벤트 두 번 = 결과 같음)
//    ④ 업그레이드(매장 더 추가) / ⑤ 다운그레이드(초과분은 연장 안 함)
//    ⑥ ★single 은 배정 루프를 안 탄다(다점포 누수 차단) — 단 **소비된** 흔적 슬롯 1개는 남긴다
//    ⑦ 이중 청구 차단 — 활성 IAP 가 있으면 계좌이체 신고 거부
//    ⑧ ★판매 스위치 fail-closed — 롤백 경로가 실제로 닫는가
//    ⑨ ★★single → multi 업그레이드가 실제로 매장을 늘리는가 (2026-09-13 신설)
// C. 0196(2026-09-13) — apply_iap_event 경로(웹훅 판정 SSOT)
//    ⑩ 줄이기 예고는 매장을 안 건드린다 · ⑪ RENEWAL 이 고른 매장을 빼고 연장 · ⑫ 예고 후 원래 상품이면 예고 삭제
//    ⑬ 유예(BILLING_ISSUE) 연장 · ⑭ 이전 매장(잠김·목록·다시 열기 = 슬롯 소비)
//       초안은 single 이 흔적을 안 남겨 업그레이드가 **돈만 받고 아무것도 안 여는** 상태였다.
//
// 0187 미적용이면 A 만 돌고 B 는 SKIP(실패가 아니다).
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
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const info = (n, extra = '') => console.log('  ····', n, extra);
const skipped = (n, why) => { skip++; console.log('  SKIP', n, why); };

// ══ A. 정적 — 상품 표 두 벌이 같은가 ════════════════════════════════════════
function staticChecks() {
  console.log('\n■ A. 상품 표 SSOT 쌍 (앱 ↔ 웹훅)');
  const appSrc = readFileSync(join(root, 'src/lib/config/iap.ts'), 'utf8');
  const hookSrc = readFileSync(join(root, 'supabase/functions/iap-webhook/index.ts'), 'utf8');

  // 앱: { storeCount: 3, planId: 'multi', productId: 'multi_3_monthly' }
  const app = new Map();
  for (const m of appSrc.matchAll(/storeCount:\s*(\d+),\s*planId:\s*'(single|multi)',\s*productId:\s*'([a-z0-9_]+)'/g)) {
    app.set(m[3], { plan: m[2], count: Number(m[1]) });
  }
  // 웹훅: multi_3_monthly: { plan: 'multi', count: 3 },
  const hook = new Map();
  for (const m of hookSrc.matchAll(/([a-z0-9_]+):\s*\{\s*plan:\s*'(single|multi)',\s*count:\s*(\d+)\s*\}/g)) {
    hook.set(m[1], { plan: m[2], count: Number(m[3]) });
  }

  check('앱 상품 표를 읽었다', app.size > 0, `${app.size}개`);
  check('웹훅 상품 표를 읽었다', hook.size > 0, `${hook.size}개`);
  check('★두 표의 상품 개수가 같다', app.size === hook.size, `앱 ${app.size} / 웹훅 ${hook.size}`);
  for (const [id, a] of app) {
    const h = hook.get(id);
    check(`★${id} 가 웹훅에도 같은 의미로 있다`, !!h && h.plan === a.plan && h.count === a.count,
      h ? `앱 ${a.plan}/${a.count} · 웹훅 ${h.plan}/${h.count}` : '웹훅에 없음');
  }
  for (const id of hook.keys()) check(`${id} 가 앱 표에도 있다`, app.has(id), app.has(id) ? '' : '앱에 없음');
  // single 은 1매장이어야 한다(sync_iap_slots 가 single_is_one_store 로 거부한다).
  const single = app.get('single_1_monthly');
  check('single_1_monthly = 1매장', single?.count === 1 && single?.plan === 'single', JSON.stringify(single ?? null));
}

// ══ B. 라이브 ══════════════════════════════════════════════════════════════
const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcRpc(fn, body) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: Array.isArray(j) ? j[0] : j, raw: j };
}
async function svcSel(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: SH });
  return await res.json().catch(() => []);
}
async function svcPatch(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...SH, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} 실패: ${res.status}`);
  return await res.json();
}
async function svcPost(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'POST', headers: { ...SH, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: Array.isArray(j) ? j[0] : j };
}

const s = String(Date.now()).slice(-9); // 이번 실행의 거래 id 꼬리(qa_${s}) — 그 행은 다음 실행의 초기화가 지운다
const seededPhones = [];

// ★고정 계정 4개를 재사용한다(2026-09-14 사용자 결정). 예전엔 매 실행 새로 가입하고 끝에 탈퇴시켜
//   가입 레이트리밋에 걸리고 탈퇴 계정이 쌓였다. 시나리오마다 **다른 사장**이 깨끗한 상태로 시작해야 하므로
//   (⑦ 이 P 의 활성 매장을 본다 등) 한 계정으로 겸하지 않는다.
//   처음 한 번만 가입 → 이후엔 로그인하고 그 계정의 매장·슬롯·구독 행을 비운 뒤 시작한다. 끝나도 계정은 지우지 않는다.
const FIXED_PW = 'QaIap1234!';
const FIXED_OWNER = /^qa\.iap\.[1-4]@example\.com$/; // 초기화(삭제)가 이 네 계정 밖으로 새지 않게 막는다
let seq = 0;
async function fixedOwner(name) {
  seq += 1;
  const email = `qa.iap.${seq}@example.com`;
  const phone = `0109999010${seq}`;
  if (!FIXED_OWNER.test(email)) throw new Error(`고정 계정 범위 밖: ${email}`);
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const c = mk();
  let { data } = await c.auth.signInWithPassword({ email, password: FIXED_PW });
  // 최초 1회만 가입한다. 레이트리밋이면 기다렸다가 다시.
  for (let a = 0; a < 6 && !data?.user; a++) {
    const r = await c.auth.signUp({ email, password: FIXED_PW, options: { data: { name, role: 'owner', phone, birth_date: '1990-01-15' } } });
    if (!r.error && r.data.session) { data = r.data; break; }
    if (!/rate limit/i.test(r.error?.message ?? '')) throw new Error(`signUp ${email}: ${r.error?.message}`);
    info(`레이트리밋 — ${20 * (a + 1)}s 대기`);
    await new Promise((res) => setTimeout(res, 20000 * (a + 1)));
  }
  if (!data?.user) throw new Error(`고정 계정 준비 실패: ${email}`);
  await resetOwner(data.user.id);
  return { c, uid: data.user.id, email };
}
// ★0235: 같은 고정 계정을 다시 쓴다(fixedOwner 는 5번째에서 멈춘다 — 범위 밖 계정을 만들지 않게).
//   처음 가입은 fixedOwner 가 이미 했다. 여기서는 로그인하고 resetOwner 로 비운 뒤 넘긴다.
async function reuseOwner(n) {
  const email = `qa.iap.${n}@example.com`;
  if (!FIXED_OWNER.test(email)) throw new Error(`고정 계정 범위 밖: ${email}`);
  const phone = `0109999010${n}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const c = mk();
  const { data, error } = await c.auth.signInWithPassword({ email, password: FIXED_PW });
  if (error || !data?.user) throw new Error(`고정 계정 로그인 실패 ${email}: ${error?.message}`);
  await resetOwner(data.user.id);
  return { c, uid: data.user.id, email };
}
// 그 사장의 IAP 흔적과 매장을 비운다(매장의 자식 데이터는 units cascade). 계정·프로필 행은 남긴다.
// ★0235: payment_claims 는 매장을 지워도 남는다(unit_id set null) → 사장 기준으로 먼저 지운다.
async function resetOwner(uid) {
  for (const path of [`iap_release_choice?owner_id=eq.${uid}`, `payment_claims?claimed_by=eq.${uid}`, `store_slots?owner_id=eq.${uid}`, `iap_subscriptions?owner_id=eq.${uid}`, `units?owner_id=eq.${uid}`]) {
    const res = await fetch(`${URL}/rest/v1/${path}`, { method: 'DELETE', headers: SH });
    if (!res.ok) throw new Error(`초기화 실패 ${path}: ${res.status} ${await res.text()}`);
  }
  await svcPatch(`profiles?id=eq.${uid}`, { unit_id: null, active_unit_id: null, pending_unit_id: null });
}

const iso = (d) => new Date(d).toISOString();
const days = (n) => Date.now() + n * 86400000;
async function paidUntilOf(unit) {
  const rows = await svcSel(`unit_subscriptions?unit_id=eq.${unit}&select=paid_until,plan,status`);
  return rows[0] ?? null;
}
// 두 시각이 사실상 같은가(초 단위 오차 허용). "대입이냐 가산이냐"를 가리는 데는 분 단위면 충분하다.
const sameTime = (a, b) => Math.abs(new Date(a) - new Date(b)) < 60000;

let originalTrialDays = null;
async function setSignupTrialDays(v) {
  const rows = await svcPatch('app_config?key=eq.signup_trial_days', { value: String(v), updated_at: iso(Date.now()) });
  return rows[0]?.value;
}
let originalIapEnabled = null;

async function liveChecks() {
  console.log('\n■ B. sync_iap_slots 라이브 검증');
  const probe = await svcRpc('sync_iap_slots', { p_owner: null, p_plan: 'multi', p_count: 1, p_period_end: iso(days(30)) });
  // 함수가 없으면 PGRST202(스키마 캐시에 없음). owner_required 예외가 오면 함수는 있는 것이다.
  const missing = probe.status === 404 || /PGRST202|Could not find the function/i.test(JSON.stringify(probe.raw ?? {}));
  if (missing) {
    skipped('B 전체', '0187 미적용 — sync_iap_slots 없음. 마이그레이션 적용 후 다시 돌려라.');
    return;
  }
  check('셋업: 인자 검증이 산다(owner 없이 부르면 거부)', !probe.ok, `status=${probe.status}`);

  const { data: fm } = await svcRpc('billing_free_mode');
  if (fm === true) { console.log('  ⚠ 전면 무료 모드가 켜져 있어 슬롯 게이트가 우회된다 — 검증 불가'); fail++; return; }

  // 가입 체험이 켜져 있으면 매장이 무료가 아니라 배정 대상 판정이 달라진다 → 끄고 돈다(qa-store-slots 와 같은 이유).
  const cur = await svcSel('app_config?key=eq.signup_trial_days&select=value');
  originalTrialDays = cur[0]?.value ?? '0';
  await setSignupTrialDays(0);
  info(`signup_trial_days=${originalTrialDays} → 0 (끝나면 원복)`);

  // ── ⑧ 판매 스위치 ────────────────────────────────────────────────────────
  const rows = await svcSel('app_config?key=eq.iap_enabled&select=value');
  originalIapEnabled = rows[0]?.value ?? null;
  // ★2026-09-13: 라이브는 🟢 판매 중이라 "기본값 꺼짐"을 현재값으로 검사하면 영구 RED 다.
  //   fail-closed 의 의미는 "행이 false 면 안 판다"이므로 그 방향을 실제로 눕혀서 재고 원복한다.
  await svcPatch('app_config?key=eq.iap_enabled', { value: 'false', updated_at: iso(Date.now()) });
  const offNow = await svcRpc('iap_enabled');
  check('★⑧ 행을 false 로 눕히면 iap_enabled() 가 false = 앱이 안 판다(fail-closed)', offNow.data === false, `${offNow.data}`);
  await svcPatch('app_config?key=eq.iap_enabled', { value: 'true', updated_at: iso(Date.now()) });
  check('★⑧ 행 하나로 판매를 켤 수 있다(롤백 경로가 실제로 산다)', (await svcRpc('iap_enabled')).data === true, '');
  await svcPatch('app_config?key=eq.iap_enabled', { value: originalIapEnabled ?? 'false', updated_at: iso(Date.now()) });

  // ── 셋업: 사장 1명 + 1호점(무료) ─────────────────────────────────────────
  const O = await fixedOwner('QA인앱사장');
  const { data: c1 } = await O.c.rpc('create_store', { p_store_name: 'QA인앱 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id;
  check('셋업 1호점 생성', !!S1, S1);

  // ── ① 최초구매(2매장) ────────────────────────────────────────────────────
  const end1 = iso(days(30));
  const r1 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 2, p_period_end: end1 });
  check('★① 최초구매 — 슬롯 2개 적립', r1.data?.granted === 2, JSON.stringify(r1.data));
  check('★① 이미 있던 무료 1호점에 1개 배정', r1.data?.assigned === 1, JSON.stringify(r1.data));
  const p1 = await paidUntilOf(S1);
  check('★① 1호점이 multi 로 열린다', p1?.plan === 'multi' && p1?.status === 'active', JSON.stringify(p1));
  check('★① 만료일 = 스토어 갱신일(가산이 아니라 그 날짜 자체)', sameTime(p1?.paid_until, end1), `${p1?.paid_until} vs ${end1}`);

  // 남은 슬롯으로 2호점 생성(사장이 실제로 하는 일). create_store 가 슬롯을 먹으면서 source='iap' 가 유지된다.
  const { data: c2, error: e2 } = await O.c.rpc('create_store', { p_store_name: 'QA인앱 2호점', p_industry: '카페·디저트', p_biz_no: null });
  const S2 = c2?.[0]?.unit_id;
  check('★① 남은 슬롯으로 2호점 생성', !!S2, e2?.message ?? S2);

  // ── ② 갱신은 대입이다(누적 금지) ─────────────────────────────────────────
  const end2 = iso(days(60));
  const r2 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 2, p_period_end: end2 });
  check('★② 갱신 — 새 슬롯을 적립하지 않는다', r2.data?.granted === 0, JSON.stringify(r2.data));
  check('★② 갱신 — 이미 연 매장 2곳을 연장한다', r2.data?.extended === 2, JSON.stringify(r2.data));
  const a2 = await paidUntilOf(S1), b2 = await paidUntilOf(S2);
  check('★★② 1호점 만료일 = 새 갱신일 (30+60=90일이 되면 버그)', sameTime(a2?.paid_until, end2), `${a2?.paid_until} vs ${end2}`);
  check('★★② 2호점 만료일 = 새 갱신일', sameTime(b2?.paid_until, end2), `${b2?.paid_until} vs ${end2}`);

  // ── ③ 웹훅 재전송 안전 ───────────────────────────────────────────────────
  const r3 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 2, p_period_end: end2 });
  const a3 = await paidUntilOf(S1);
  check('★③ 같은 이벤트 재전송 — 슬롯이 또 쌓이지 않는다', r3.data?.granted === 0, JSON.stringify(r3.data));
  check('★③ 같은 이벤트 재전송 — 만료일이 밀리지 않는다', sameTime(a3?.paid_until, end2), `${a3?.paid_until}`);

  // ── ④ 업그레이드(매장 더 추가) ───────────────────────────────────────────
  const r4 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 3, p_period_end: end2 });
  check('★④ 3매장으로 올리면 부족분 1개만 적립', r4.data?.granted === 1 && r4.data?.extended === 2, JSON.stringify(r4.data));
  const slots = await svcSel(`store_slots?owner_id=eq.${O.uid}&consumed_at=is.null&select=id,source`);
  check('★④ 남는 슬롯 1개(3호점을 만들 수 있다)', slots.length === 1 && slots[0]?.source === 'iap', `open=${slots.length}`);

  // ── ⑮ ★미소비 슬롯은 누적되지 않는다 (2026-09-21) ────────────────────────
  //   ④ 의 결과로 미소비 슬롯 1개가 떠 있다(3호점을 아직 안 만들었다). 이 상태에서 같은 갱신이
  //   한 번 더 오면 v_need 가 미소비 슬롯을 세지 않아 **또 1개가 적립된다** — 한 결제 주기 동안
  //   구독보다 많은 매장을 열 수 있다. 웹훅은 PRODUCT_CHANGE + INITIAL_PURCHASE 로 두 번 부른다.
  const r4b = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 3, p_period_end: end2 });
  const slots4b = await svcSel(`store_slots?owner_id=eq.${O.uid}&consumed_at=is.null&select=id,source,paid_until`);
  check('★⑮ 같은 갱신이 또 와도 슬롯을 새로 적립하지 않는다', r4b.data?.granted === 0, JSON.stringify(r4b.data));
  check('★⑮ 미소비 슬롯은 여전히 1개다(누적 금지)', slots4b.length === 1, `open=${slots4b.length}`);

  // ── ⑤ 다운그레이드 — 초과분은 연장하지 않는다 ────────────────────────────
  const end3 = iso(days(90));
  const r5 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 1, p_period_end: end3 });
  const a5 = await paidUntilOf(S1), b5 = await paidUntilOf(S2);
  check('★⑤ 1매장으로 내리면 1곳만 연장된다', r5.data?.extended === 1 && r5.data?.granted === 0, JSON.stringify(r5.data));
  check('★⑤ 오래된 매장(1호점)이 남는다', sameTime(a5?.paid_until, end3), `${a5?.paid_until}`);
  check('★⑤ 초과분(2호점)은 그대로 — 다음 갱신일에 자연 만료', sameTime(b5?.paid_until, end2), `${b5?.paid_until}`);

  // ── ⑥ single 은 슬롯 경로를 안 탄다(다점포 누수) ─────────────────────────
  const P = await fixedOwner('QA인앱단일');
  const { data: p1c } = await P.c.rpc('create_store', { p_store_name: 'QA단일 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const T1 = p1c?.[0]?.unit_id;
  const r6 = await svcRpc('sync_iap_slots', { p_owner: P.uid, p_plan: 'single', p_count: 1, p_period_end: end1 });
  const t1 = await paidUntilOf(T1);
  check('★⑥ single 구매 — 슬롯을 적립하지 않는다', r6.data?.granted === 0 && r6.data?.assigned === 0, JSON.stringify(r6.data));
  check('★★⑥ 플랜이 single 이다 (multi 면 다점포 기능이 새어 나간다)', t1?.plan === 'single', `plan=${t1?.plan}`);
  // ★2026-09-13: single 도 **소비된** 슬롯 흔적 1개를 남긴다(⑨ 업그레이드가 이걸 찾는다).
  //   중요한 것은 "미소비 슬롯이 0개"다 — 하나라도 미소비면 공짜 2호점이 생긴다.
  const pslots = await svcSel(`store_slots?owner_id=eq.${P.uid}&select=id,source,consumed_at,consumed_unit_id`);
  check('★⑥ single 은 흔적 슬롯 1개를 남긴다(정산 대사·업그레이드용)', pslots.length === 1 && pslots[0]?.source === 'iap', `slots=${pslots.length}`);
  check('★★⑥ 그 슬롯은 처음부터 소비됨 — 공짜 2호점이 생기지 않는다',
    pslots.length === 1 && !!pslots[0]?.consumed_at && pslots[0]?.consumed_unit_id === T1, JSON.stringify(pslots[0] ?? null));
  const { error: eFree2 } = await P.c.rpc('create_store', { p_store_name: 'QA단일 2호점', p_industry: '카페·디저트', p_biz_no: null });
  check('★★⑥ single 구독자는 2호점을 못 만든다', !!eFree2, eFree2?.message ?? '만들어져버림');
  // 갱신을 한 번 더 돌려도 흔적이 두 개로 늘지 않는다(멱등).
  await svcRpc('sync_iap_slots', { p_owner: P.uid, p_plan: 'single', p_count: 1, p_period_end: iso(days(60)) });
  const pslots2 = await svcSel(`store_slots?owner_id=eq.${P.uid}&select=id`);
  check('★⑥ single 갱신 — 흔적 슬롯이 또 쌓이지 않는다', pslots2.length === 1, `slots=${pslots2.length}`);
  const r6b = await svcRpc('sync_iap_slots', { p_owner: P.uid, p_plan: 'single', p_count: 2, p_period_end: end1 });
  check('★⑥ single + 2매장 조합은 거부된다', !r6b.ok, `status=${r6b.status}`);

  // ── ⑨ ★single → multi 업그레이드 (2026-09-13 신설) ───────────────────────
  //   초안은 single 이 슬롯 흔적을 안 남겨서, 여기서 ①이 연장 대상을 못 찾고 → 슬롯만 쌓이고
  //   → assign_open_slots 는 **유료 single 매장을 대상에서 제외**해 배정 0 →
  //   **돈은 냈는데 매장이 하나도 안 늘어나는** 상태로 끝났다. 그 회귀를 여기서 증명한다.
  //   ★별도 계정으로 돈다 — ⑦(이중청구)이 P 의 활성 매장을 보기 때문에 여기서 매장을 늘리면 그쪽이 흔들린다.
  const U = await fixedOwner('QA인앱승급');
  const { data: u1c } = await U.c.rpc('create_store', { p_store_name: 'QA승급 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const V1 = u1c?.[0]?.unit_id;
  await svcRpc('sync_iap_slots', { p_owner: U.uid, p_plan: 'single', p_count: 1, p_period_end: end1 });
  const end9 = iso(days(90));
  const r9 = await svcRpc('sync_iap_slots', { p_owner: U.uid, p_plan: 'multi', p_count: 3, p_period_end: end9 });
  check('★★⑨ single→multi — 쓰던 1호점을 연장 대상으로 잡는다(extended=1)', r9.data?.extended === 1, JSON.stringify(r9.data));
  check('★★⑨ 부족분 2개만 적립한다(3개를 새로 쌓으면 버그)', r9.data?.granted === 2, JSON.stringify(r9.data));
  const t9 = await paidUntilOf(V1);
  check('★★⑨ 1호점이 multi 로 승격 — 다점포 기능이 열린다', t9?.plan === 'multi', `plan=${t9?.plan}`);
  check('★⑨ 1호점 만료일 = 새 갱신일', sameTime(t9?.paid_until, end9), `${t9?.paid_until} vs ${end9}`);
  const open9 = await svcSel(`store_slots?owner_id=eq.${U.uid}&consumed_at=is.null&select=id`);
  check('★★⑨ 미소비 슬롯 2개 — 2·3호점을 실제로 만들 수 있다', open9.length === 2, `open=${open9.length}`);
  const { data: c9, error: e9 } = await U.c.rpc('create_store', { p_store_name: 'QA승급 2호점', p_industry: '카페·디저트', p_biz_no: null });
  check('★★⑨ 실제로 2호점이 만들어진다', !!c9?.[0]?.unit_id, e9?.message ?? c9?.[0]?.unit_id);

  // ── ⑦ 이중 청구 차단 ─────────────────────────────────────────────────────
  const ins = await svcPost('iap_subscriptions', {
    owner_id: P.uid, platform: 'appstore', product_id: 'single_1_monthly', store_count: 1,
    original_transaction_id: `qa_${s}`, status: 'active', current_period_end: end1,
  });
  check('셋업: 구독 행 생성', ins.ok, `status=${ins.status}`);
  const { error: eClaim } = await P.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
    p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 1,
  });
  check('★⑦ 앱 구독 중이면 계좌이체 신고가 거부된다(두 번 안 낸다)',
    eClaim?.message?.includes('iap_subscription_active'), eClaim?.message ?? '통과돼버림');

  // 구독을 만료로 눕히면 다시 계좌이체가 열린다(가드가 영구 차단이 아니라 기간 기반인지).
  await svcPatch(`iap_subscriptions?original_transaction_id=eq.qa_${s}`, { status: 'expired' });
  const { error: eClaim2 } = await P.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
    p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 1,
  });
  check('★⑦ 구독이 끝나면 계좌이체가 다시 열린다', !eClaim2, eClaim2?.message ?? '');
  // ★0197: 유예(grace) 중에도 막는다 — 애플이 재시도 중이라 성공하면 두 번 낸다. canceled 는 통과(채널 전환 D).
  await svcPatch(`iap_subscriptions?original_transaction_id=eq.qa_${s}`, { status: 'grace' });
  const { error: eClaim3 } = await P.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
    p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 1,
  });
  check('★⑦ 유예(grace) 중에도 계좌이체 신고가 거부된다', eClaim3?.message?.includes('iap_subscription_active'), eClaim3?.message ?? '통과돼버림');
  await svcPatch(`iap_subscriptions?original_transaction_id=eq.qa_${s}`, { status: 'canceled' });
  const { error: eClaim4 } = await P.c.rpc('submit_payment_claim', {
    p_plan: 'single', p_amount: 1, p_depositor: 'QA입금자', p_months: 1, p_memo: null,
    p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: 1,
  });
  check('★⑦ 해지 예약(canceled)은 통과 — 기간 끝에 이어 붙인다', !eClaim4, eClaim4?.message ?? '');

  // ══ 0196 — 예고/확정 분리 · 닫을 매장 선택 · 유예 · 이전 매장 (2026-09-13 신설) ════════════════
  //   웹훅 판정은 DB 함수 apply_iap_event 가 SSOT 다(엣지는 인증·파싱만). 여기서 같은 경로를 직접 친다.
  console.log('\n■ C. apply_iap_event — 예고·확정·유예·이전 매장');
  const probe2 = await svcRpc('apply_iap_event', { p_owner: null, p_platform: 'appstore', p_txn: 'x', p_type: 'RENEWAL', p_product_id: 'multi_2_monthly', p_plan: 'multi', p_count: 2, p_period_end: iso(days(30)) });
  const missing2 = probe2.status === 404 || /PGRST202|Could not find the function/i.test(JSON.stringify(probe2.raw ?? {}));
  if (missing2) {
    // 0196 미적용 = 아래 전부 실패다(건너뛴 것을 통과로 세지 않는다 — AGENTS).
    check('★0196 적용됨(apply_iap_event 존재)', false, 'PGRST202 — 0196 를 적용해라');
    return;
  }
  const W = await fixedOwner('QA인앱예고');
  const txn = `qa_ev_${s}`;
  const ev = (type, productId, plan, count, end, extra = {}) => svcRpc('apply_iap_event', {
    p_owner: W.uid, p_platform: 'appstore', p_txn: txn, p_type: type, p_product_id: productId,
    p_plan: plan, p_count: count, p_period_end: end, ...extra,
  });
  const subRow = async () => (await svcSel(`iap_subscriptions?original_transaction_id=eq.${txn}&select=status,store_count,product_id,current_period_end,pending_product_id,pending_store_count,pending_at`))[0] ?? null;
  const { data: w1c } = await W.c.rpc('create_store', { p_store_name: 'QA예고 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const X1 = w1c?.[0]?.unit_id;
  const endA = iso(days(30));
  const r0 = await ev('INITIAL_PURCHASE', 'multi_3_monthly', 'multi', 3, endA);
  check('셋업: 최초구매 3매장 반영', r0.ok && r0.data?.synced === true, JSON.stringify(r0.data ?? r0.raw));
  const { data: w2c } = await W.c.rpc('create_store', { p_store_name: 'QA예고 2호점', p_industry: '카페·디저트', p_biz_no: null });
  const { data: w3c } = await W.c.rpc('create_store', { p_store_name: 'QA예고 3호점', p_industry: '카페·디저트', p_biz_no: null });
  const X2 = w2c?.[0]?.unit_id, X3 = w3c?.[0]?.unit_id;
  check('셋업: 2·3호점 생성', !!X2 && !!X3, `${X2} ${X3}`);

  // ── ⑩ 줄이기 예고(PRODUCT_CHANGE 3→2)는 매장을 안 건드린다 ─────────────────
  const r10 = await ev('PRODUCT_CHANGE', 'multi_2_monthly', 'multi', 2, endA);
  let row = await subRow();
  check('★⑩ 하향 PRODUCT_CHANGE 는 예고만 기록한다', r10.data?.pending === true && r10.data?.synced === false, JSON.stringify(r10.data ?? r10.raw));
  check('★⑩ store_count 는 아직 3(확정 전)', row?.store_count === 3 && row?.product_id === 'multi_3_monthly', JSON.stringify(row));
  check('★⑩ pending = 2매장 · 적용일 = 현재 결제일', row?.pending_store_count === 2 && row?.pending_product_id === 'multi_2_monthly' && sameTime(row?.pending_at, endA), JSON.stringify(row));
  const [a10, b10, c10] = await Promise.all([paidUntilOf(X1), paidUntilOf(X2), paidUntilOf(X3)]);
  check('★★⑩ 세 매장 모두 그대로 열려 있다(만료일 불변)', [a10, b10, c10].every((x) => x?.status === 'active' && sameTime(x?.paid_until, endA)), JSON.stringify([a10, b10, c10].map((x) => x?.paid_until)));

  // ── ⑪ 사장이 닫을 매장을 고른 뒤 RENEWAL(2매장) → 고른 매장만 빠진다 ─────────
  const { error: eCh } = await W.c.rpc('choose_iap_release', { p_units: [X2] });
  check('⑪ 닫을 매장 선택(2호점)', !eCh, eCh?.message ?? '');
  const { error: eChBad } = await W.c.rpc('choose_iap_release', { p_units: [S1] });
  check('⑪ 남의 매장은 고를 수 없다', /not_owner/.test(eChBad?.message ?? ''), eChBad?.message ?? '통과돼버림');
  const endB = iso(days(60));
  await ev('RENEWAL', 'multi_2_monthly', 'multi', 2, endB);
  row = await subRow();
  const [a11, b11, c11] = await Promise.all([paidUntilOf(X1), paidUntilOf(X2), paidUntilOf(X3)]);
  check('★⑪ RENEWAL 이 확정한다(store_count=2 · pending 비움)', row?.store_count === 2 && row?.pending_store_count === null && row?.pending_at === null, JSON.stringify(row));
  check('★★⑪ 고르지 않은 1·3호점이 새 결제일까지 연장', sameTime(a11?.paid_until, endB) && sameTime(c11?.paid_until, endB), `${a11?.paid_until} / ${c11?.paid_until}`);
  check('★★⑪ 고른 2호점은 연장되지 않는다(옛 결제일에 닫힘)', sameTime(b11?.paid_until, endA), `${b11?.paid_until}`);
  const chLeft = await svcSel(`iap_release_choice?owner_id=eq.${W.uid}&select=unit_id`);
  check('⑪ 명단은 쓰이면 비워진다', chLeft.length === 0, `rows=${chLeft.length}`);

  // ── ⑫ 예고 후 원래 상품으로 RENEWAL → 예고가 지워진다(줄이기 취소) ────────────
  await ev('PRODUCT_CHANGE', 'single_1_monthly', 'single', 1, endB);
  row = await subRow();
  check('⑫ 2→1 예고 기록', row?.pending_store_count === 1, JSON.stringify(row));
  await ev('PRODUCT_CHANGE', 'multi_2_monthly', 'multi', 2, endB);
  row = await subRow();
  check('★⑫ 원래 상품 다시 고름(동일 PRODUCT_CHANGE) → 예고 삭제', row?.pending_store_count === null && row?.pending_product_id === null, JSON.stringify(row));
  await ev('PRODUCT_CHANGE', 'single_1_monthly', 'single', 1, endB);
  const endC = iso(days(90));
  await ev('RENEWAL', 'multi_2_monthly', 'multi', 2, endC);
  row = await subRow();
  check('★⑫ 예고 후 원래 상품 RENEWAL → 예고 삭제 · 2매장 유지', row?.pending_store_count === null && row?.store_count === 2 && sameTime(row?.current_period_end, endC), JSON.stringify(row));

  // ── ⑬ 유예 기간(BILLING_ISSUE) — 애플이 열어 두는 동안 우리도 연다 ─────────────
  const grace = iso(days(90 + 16));
  await ev('BILLING_ISSUE', 'multi_2_monthly', 'multi', 2, endC, { p_grace_end: grace });
  row = await subRow();
  const [a13, c13] = await Promise.all([paidUntilOf(X1), paidUntilOf(X3)]);
  check('★⑬ status=grace · 기간 = 유예 종료일', row?.status === 'grace' && sameTime(row?.current_period_end, grace), JSON.stringify(row));
  check('★★⑬ 열린 매장이 유예 종료일까지 연장된다', sameTime(a13?.paid_until, grace) && sameTime(c13?.paid_until, grace), `${a13?.paid_until} / ${c13?.paid_until}`);
  const r13b = await ev('CANCELLATION', 'multi_2_monthly', 'multi', 2, endC, { p_reason: 'BILLING_ERROR' });
  row = await subRow();
  check('⑬ 같이 오는 CANCELLATION(BILLING_ERROR) 은 status 만', row?.status === 'canceled' && r13b.data?.synced === false, JSON.stringify(row));
  const endD = iso(days(120));
  await ev('RENEWAL', 'multi_2_monthly', 'multi', 2, endD);
  row = await subRow();
  check('⑬ 유예 안 결제 성공 = RENEWAL → active', row?.status === 'active' && sameTime(row?.current_period_end, endD), JSON.stringify(row));

  // ── ⑭ 이전 매장 — 닫힌 2호점은 잠기고 목록에 나오며, 슬롯이 있어야 다시 열린다 ──
  await svcPatch(`unit_subscriptions?unit_id=eq.${X2}`, { paid_until: iso(Date.now() - 60000) });
  const { data: locked } = await W.c.rpc('my_locked_units');
  const lockedIds = (locked ?? []).map((r) => (typeof r === 'string' ? r : r.my_locked_units));
  check('★⑭ 유료 매장이 있는 사장의 무료 매장은 잠긴다(0142 ③ 예외 폐기)', lockedIds.includes(X2) && !lockedIds.includes(X1), JSON.stringify(lockedIds));
  const { data: prev } = await W.c.rpc('my_previous_units');
  check('★⑭ 이전 매장 목록에 2호점만', (prev ?? []).length === 1 && prev[0].unit_id === X2 && !!prev[0].closed_at, JSON.stringify(prev));
  const { data: ndc } = await W.c.rpc('needs_downgrade_choice');
  check('⑭ 남길 매장을 묻지 않는다(고를 것이 없다)', (Array.isArray(ndc) ? ndc[0] : ndc)?.need_store === false, JSON.stringify(ndc));
  const { error: eRe0 } = await W.c.rpc('reopen_store', { p_unit: X2 });
  check('★⑭ 슬롯이 없으면 다시 열 수 없다', /no_store_slot/.test(eRe0?.message ?? ''), eRe0?.message ?? '열려버림');
  const { error: eRe1 } = await W.c.rpc('reopen_store', { p_unit: X1 });
  check('⑭ 열려 있는 매장은 대상이 아니다', /not_locked/.test(eRe1?.message ?? ''), eRe1?.message ?? '통과');
  // 3매장으로 올리면 슬롯 1개가 새로 적립되고, 잠긴 2호점에는 **자동 배정되지 않는다**(사장이 직접 고른다).
  await ev('RENEWAL', 'multi_3_monthly', 'multi', 3, endD);
  const open14 = await svcSel(`store_slots?owner_id=eq.${W.uid}&consumed_at=is.null&select=id`);
  check('★★⑭ 늘려도 이전 매장은 자동으로 되살아나지 않는다(미소비 슬롯 1개)', open14.length === 1, `open=${open14.length}`);
  const codeBefore = (await svcSel(`units?id=eq.${X2}&select=invite_code`))[0]?.invite_code;
  const { data: re, error: eRe2 } = await W.c.rpc('reopen_store', { p_unit: X2 });
  check('★★⑭ 다시 열기 성공(슬롯 소비)', !eRe2 && re?.[0]?.unit_id === X2, eRe2?.message ?? JSON.stringify(re));
  const b14 = await paidUntilOf(X2);
  check('★⑭ 2호점이 유료로 열린다(만료일 = 슬롯 만료일)', b14?.status === 'active' && sameTime(b14?.paid_until, endD), JSON.stringify(b14));
  check('⑭ 초대 코드 재발급', re?.[0]?.invite_code && re[0].invite_code !== codeBefore, `${codeBefore} → ${re?.[0]?.invite_code}`);
  const open14b = await svcSel(`store_slots?owner_id=eq.${W.uid}&consumed_at=is.null&select=id`);
  check('⑭ 미소비 슬롯 0개', open14b.length === 0, `open=${open14b.length}`);

  await slotRuleChecks();
}

// ══ D. 0235(2026-10-04) — 이용권이 엉뚱한 매장을 열지 않는다 · 미리 낸 돈 · 매장 삭제 반환 ═══════════
//   Q5 1매장 이용권은 그 구매로 연 매장만 연다 · Q6 다점포 계좌이체를 미리 내면 쓰는 매장을 연장한다 ·
//   H7 선불 매장을 흡수한 구독을 환불해도 선불 기간은 남는다 · J8 유료 매장을 지우면 남은 몫을 돌려준다.
//   고정 계정 4개를 reuseOwner 로 다시 쓴다(시나리오마다 resetOwner 로 비운다). liveChecks 가 체험 일수 0 인 상태에서 부른다.
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL ?? '');
const kstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
async function slotRuleChecks() {
  console.log('\n■ D. 0235 — 1매장 이용권(Q5) · 계좌이체 연장(Q6) · 선불 흡수(H7) · 매장 삭제 반환(J8)');
  const evt = (o, txn, type, productId, plan, count, end, extra = {}) => svcRpc('apply_iap_event', {
    p_owner: o.uid, p_platform: 'appstore', p_txn: txn, p_type: type, p_product_id: productId,
    p_plan: plan, p_count: count, p_period_end: end, ...extra,
  });
  const mkStore = async (o, name) => {
    const { data, error } = await o.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    if (error) throw new Error(`create_store(${name}): ${error.message}`);
    return data?.[0]?.unit_id;
  };
  const tryStore = async (o, name) => {
    const { data, error } = await o.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    return { unit: data?.[0]?.unit_id ?? null, err: error?.message ?? '' };
  };
  const grantSlot = async (uid, d = 30) => {
    const r = await svcPost('store_slots', { owner_id: uid, paid_until: iso(days(d)), source: 'grant' });
    if (!r.ok) throw new Error(`grant 슬롯 셋업 실패: ${r.status}`);
  };
  // 무료로 되돌린다(가입 체험도 아님 — trial_ends_at = 지금).
  const makeFree = (unit) => svcPatch(`unit_subscriptions?unit_id=eq.${unit}`, { status: 'trialing', plan: 'free', paid_until: null, trial_ends_at: iso(Date.now()) });
  const isLocked = async (unit) => (await svcRpc('unit_access_locked', { p_unit: unit })).data === true;
  const openSlots = async (uid) => {
    const rows = await svcSel(`store_slots?owner_id=eq.${uid}&consumed_at=is.null&select=id,source,paid_until`);
    return Array.isArray(rows) ? rows : [];
  };
  const claim = async (o, plan, count, months = 1) => {
    const { data, error } = await o.c.rpc('submit_payment_claim', {
      p_plan: plan, p_amount: null, p_depositor: 'QA입금자', p_months: months, p_memo: null,
      p_terms_version: '2026-08-07', p_biz_no: null, p_biz_email: null, p_store_count: count,
    });
    if (error) throw new Error(`submit_payment_claim(${plan}/${count}): ${error.message}`);
    return Array.isArray(data) ? data[0] : data;
  };
  const approve = async (id) => {
    const r = await svcRpc('review_payment_claim', { p_id: id, p_approve: true, p_reason: null, p_reviewer: 'qa' });
    if (!r.ok) throw new Error(`review_payment_claim 승인 실패: ${JSON.stringify(r.raw)}`);
  };
  const plus = (t, d) => new Date(new Date(t).getTime() + d * 86400000).toISOString();

  // ── ⑯ Q5 — 1매장 이용권은 그 구매로 연 매장만 연다 ─────────────────────────
  {
    const R = await reuseOwner(1);
    const A = await mkStore(R, 'QA⑯ 1호점');
    await grantSlot(R.uid);
    const B = await mkStore(R, 'QA⑯ 2호점');
    await svcPatch(`unit_subscriptions?unit_id=eq.${B}`, { paid_until: iso(Date.now() - 60000) });
    const { error: ek } = await R.c.rpc('choose_kept_store', { p_unit: B });
    check('셋업 ⑯-a 둘 다 무료 → B 를 남길 매장으로 고름 · A 잠김', !ek && (await isLocked(A)) && !(await isLocked(B)), ek?.message ?? '');
    const txn = `qa_q5_${s}`;
    const endA = iso(days(30));
    const ra = await evt(R, txn, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, endA);
    let [a, b] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★★⑯-a 1매장 이용권이 쓰던 B 를 연다(single · 새 만료일)', ra.ok && b?.plan === 'single' && sameTime(b?.paid_until, endA), JSON.stringify({ a, b }));
    check('★★⑯-a 잠긴 옛 매장 A 는 열리지 않는다', a?.plan !== 'single' && (await isLocked(A)), JSON.stringify(a));

    const endB = iso(days(60));
    await evt(R, txn, 'RENEWAL', 'single_1_monthly', 'single', 1, endB);
    [a, b] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★★⑯-b 같은 거래의 갱신은 B 만 연장한다', b?.plan === 'single' && sameTime(b?.paid_until, endB), JSON.stringify(b));
    check('★⑯-b 갱신이 A 로 옮겨 가지 않는다', a?.plan !== 'single' && (await isLocked(A)), JSON.stringify(a));

    // ⑯-c 갭 갱신: B 의 구독 기간이 1시간 전에 끝났고, 그 사이 C 를 선불(계좌이체 single)로 열어 B 가 잠겼다.
    await grantSlot(R.uid);
    const C = await mkStore(R, 'QA⑯ 3호점');
    const hourAgo = iso(Date.now() - 3600000);
    await svcPatch(`unit_subscriptions?unit_id=eq.${B}`, { paid_until: hourAgo });
    await svcPatch(`store_slots?owner_id=eq.${R.uid}&source=eq.iap&consumed_unit_id=eq.${B}`, { paid_until: hourAgo });
    await svcRpc('admin_activate_store', { p_unit_id: C, p_days: 30, p_plan: 'single' });
    const cBefore = await paidUntilOf(C);
    check('셋업 ⑯-c B 잠김(선불 C 가 유료)', await isLocked(B), '');
    const endC = iso(days(90));
    await evt(R, txn, 'RENEWAL', 'single_1_monthly', 'single', 1, endC);
    let c;
    [a, b, c] = await Promise.all([paidUntilOf(A), paidUntilOf(B), paidUntilOf(C)]);
    check('★★⑯-c 늦게 온 갱신이 B 를 다시 연다', b?.plan === 'single' && sameTime(b?.paid_until, endC), JSON.stringify(b));
    check('★⑯-c 선불 C 의 만료일은 그대로다', sameTime(c?.paid_until, cBefore?.paid_until), `${cBefore?.paid_until} → ${c?.paid_until}`);
    check('★⑯-c A 는 여전히 열리지 않는다', a?.plan !== 'single', JSON.stringify(a));
  }

  // ⑯-d 끝난 다점포 흔적 매장 A·B 는 새 구매로 되살아나지 않는다 — 쓰던 C 가 열린다.
  {
    const R = await reuseOwner(2);
    const A = await mkStore(R, 'QA⑯d 1호점');
    const t1 = `qa_q5m1_${s}`;
    await evt(R, t1, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const B = await mkStore(R, 'QA⑯d 2호점');
    const past = iso(Date.now() - 30 * 86400000);
    await svcPatch(`iap_subscriptions?original_transaction_id=eq.${t1}`, { status: 'expired', current_period_end: past });
    await svcPatch(`store_slots?owner_id=eq.${R.uid}&source=eq.iap`, { paid_until: past });
    for (const u of [A, B]) await svcPatch(`unit_subscriptions?unit_id=eq.${u}`, { status: 'expired', paid_until: past });
    await grantSlot(R.uid);
    const C = await mkStore(R, 'QA⑯d 3호점');
    await makeFree(C);
    const { error: ek } = await R.c.rpc('choose_kept_store', { p_unit: C });
    check('셋업 ⑯-d A·B 잠김 · C 열림(무료)', !ek && (await isLocked(A)) && (await isLocked(B)) && !(await isLocked(C)), ek?.message ?? '');
    const end = iso(days(30));
    await evt(R, `qa_q5m2_${s}`, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, end);
    const [a, b, c] = await Promise.all([paidUntilOf(A), paidUntilOf(B), paidUntilOf(C)]);
    check('★★⑯-d 새 다점포 이용권이 쓰던 C 를 연다', c?.plan === 'multi' && sameTime(c?.paid_until, end), JSON.stringify(c));
    check('★★⑯-d 끝난 흔적 매장 A·B 는 되살아나지 않는다', !sameTime(a?.paid_until, end) && !sameTime(b?.paid_until, end) && (await isLocked(A)) && (await isLocked(B)), JSON.stringify({ a, b }));
    const open = await openSlots(R.uid);
    check('★⑯-d 남는 슬롯 1개(새 매장·다시 열기용)', open.length === 1 && open[0]?.source === 'iap', `open=${open.length}`);
  }

  // ⑯-e 본사 부담 매장은 고르지 않는다 — brands·brand_units 행을 만들어야 해서 로컬에서만.
  if (!LOCAL) {
    skipped('⑯-e 본사 부담 제외', '로컬 전용(brands 행 생성)');
  } else {
    const R = await reuseOwner(3);
    const brandId = `qa_brand_iap_${s}`;
    try {
      const A = await mkStore(R, 'QA⑯e 1호점');
      await grantSlot(R.uid);
      const B = await mkStore(R, 'QA⑯e 2호점');
      await makeFree(A);
      const br = await svcPost('brands', { id: brandId, name: 'QA본사(iap)', paid_until: kstDate(days(30)) });
      const bu = await svcPost('brand_units', { brand_id: brandId, unit_id: A, status: 'active', payer: 'brand' });
      await makeFree(B);
      const aBrand = await paidUntilOf(A);
      check('셋업 ⑯-e A = 본사 부담으로 열림 · B 잠김', br.ok && bu.ok && aBrand?.status === 'active' && (await isLocked(B)), JSON.stringify({ br: br.status, bu: bu.status, aBrand }));
      const end = iso(days(30));
      await evt(R, `qa_q5b_${s}`, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, end);
      const [a, b] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
      check('★★⑯-e 본사 부담 매장 A 는 고르지 않는다 — B 가 열린다', b?.plan === 'single' && sameTime(b?.paid_until, end), JSON.stringify({ a, b }));
      check('★⑯-e A 는 본사 기간 그대로', a?.plan !== 'single' && sameTime(a?.paid_until, aBrand?.paid_until), JSON.stringify(a));
    } finally {
      await fetch(`${URL}/rest/v1/brand_units?brand_id=eq.${brandId}`, { method: 'DELETE', headers: SH }).catch(() => {});
      await fetch(`${URL}/rest/v1/brands?id=eq.${brandId}`, { method: 'DELETE', headers: SH }).catch(() => {});
    }
  }

  // ── ⑰ Q6 — 다점포 계좌이체를 미리 내면 쓰는 매장을 각자 연장한다 ─────────────
  {
    const Q = await reuseOwner(4);
    const A = await mkStore(Q, 'QA⑰ 1호점');
    await approve((await claim(Q, 'multi', 2)).id);
    const B = await mkStore(Q, 'QA⑰ 2호점');
    const [a0, b0] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('셋업 ⑰ A·B 가 계좌이체 다점포로 열림', a0?.plan === 'multi' && b0?.plan === 'multi', JSON.stringify({ a0, b0 }));
    await approve((await claim(Q, 'multi', 2)).id);
    const [a1, b1] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★★⑰ 미리 낸 다점포 계좌이체가 A·B 를 각자 30일 연장', sameTime(a1?.paid_until, plus(a0?.paid_until, 30)) && sameTime(b1?.paid_until, plus(b0?.paid_until, 30)), `${a0?.paid_until}→${a1?.paid_until} / ${b0?.paid_until}→${b1?.paid_until}`);
    check('★⑰ 연장에 다 쓰여 남는 슬롯 0', (await openSlots(Q.uid)).length === 0, `open=${(await openSlots(Q.uid)).length}`);
    await approve((await claim(Q, 'multi', 4)).id);
    const [a2, b2] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    const open = await openSlots(Q.uid);
    check('★⑰-b 4곳분을 내면 쓰는 2곳을 연장한다', sameTime(a2?.paid_until, plus(a1?.paid_until, 30)) && sameTime(b2?.paid_until, plus(b1?.paid_until, 30)), `${a2?.paid_until} / ${b2?.paid_until}`);
    check('★⑰-b 나머지 2개는 새 매장용 슬롯으로 남는다', open.length === 2 && open.every((x) => x.source === 'claim'), `open=${open.length}`);
  }

  // ⑰-c 해지 예약한 앱 구독 뒤에 계좌이체로 이어 붙인 매장을, 옛 구독 환불이 닫지 않는다.
  {
    const R = await reuseOwner(1);
    const A = await mkStore(R, 'QA⑰c 1호점');
    const t = `qa_q6c_${s}`;
    const endI = iso(days(30));
    await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, endI);
    const B = await mkStore(R, 'QA⑰c 2호점');
    await evt(R, t, 'CANCELLATION', 'multi_2_monthly', 'multi', 2, endI, { p_reason: 'UNSUBSCRIBE' });
    await approve((await claim(R, 'multi', 2)).id);
    const [a0, b0] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★⑰-c 해지 예약 뒤 계좌이체가 A·B 를 구독 끝에서 이어 붙인다(+30일)', sameTime(a0?.paid_until, plus(endI, 30)) && sameTime(b0?.paid_until, plus(endI, 30)), `${a0?.paid_until} / ${b0?.paid_until}`);
    await evt(R, t, 'CANCELLATION', 'multi_2_monthly', 'multi', 2, endI, { p_reason: 'CUSTOMER_SUPPORT' });
    const [a1, b1] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★★⑰-c 앱 구독 환불이 계좌이체로 이어 붙인 A·B 를 닫지 않는다',
      a1?.status === 'active' && b1?.status === 'active' && new Date(a1?.paid_until) > new Date() && new Date(b1?.paid_until) > new Date(), JSON.stringify({ a1, b1 }));
  }

  // ⑰-d (H7) 선불(계좌이체 single 40일) 매장을 다점포 앱 구독이 흡수한 뒤 환불 → 선불 만료일로 돌아간다.
  {
    const R = await reuseOwner(2);
    const A = await mkStore(R, 'QA⑰d 1호점');
    await svcRpc('admin_activate_store', { p_unit_id: A, p_days: 40, p_plan: 'single' });
    const aPre = await paidUntilOf(A);
    const t = `qa_h7_${s}`;
    await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const a1 = await paidUntilOf(A);
    // 2026-10-05: 구독은 선불이 끝난 다음부터 센다(㉑) — 남은 40일 + 구독 30일.
    check('★★⑰-d 다점포 구독이 선불 A 를 덮는다(multi · 남은 40일 뒤에 30일)', a1?.plan === 'multi' && sameTime(a1?.paid_until, plus(aPre?.paid_until, 30)), JSON.stringify({ aPre, a1 }));
    check('★⑰-d 남는 슬롯 1개(2호점용)', (await openSlots(R.uid)).length === 1, `open=${(await openSlots(R.uid)).length}`);
    await evt(R, t, 'CANCELLATION', 'multi_2_monthly', 'multi', 2, iso(days(30)), { p_reason: 'CUSTOMER_SUPPORT' });
    const a2 = await paidUntilOf(A);
    check('★★⑰-d 환불해도 A 는 선불 만료일까지 열려 있다(H7)', a2?.status === 'active' && sameTime(a2?.paid_until, aPre?.paid_until), JSON.stringify(a2));
  }

  // ── ⑱ J8 — 유료 매장을 지우면 남은 몫을 새 매장용으로 돌려준다 ──────────────
  {
    const Q = await reuseOwner(3);
    const A = await mkStore(Q, 'QA⑱ 1호점');
    await approve((await claim(Q, 'multi', 2)).id);
    const B = await mkStore(Q, 'QA⑱ 2호점');   // 활성 = B
    const bPaid = await paidUntilOf(B);
    const pend = await claim(Q, 'multi', 2);   // B 에 걸린 대기 신고
    const pv = await Q.c.rpc('delete_store_preview', { p_unit: B });
    check('★⑱-a 삭제 미리보기 = 몫을 돌려받는다', !pv.error && pv.data?.returns_slot === true, pv.error?.message ?? JSON.stringify(pv.data));
    const del = await Q.c.rpc('delete_store', { p_unit_id: B });
    check('★⑱-a 삭제 결과가 돌려받은 몫을 알린다', !del.error && del.data?.returned_slot === true && sameTime(del.data?.paid_until, bPaid?.paid_until), del.error?.message ?? JSON.stringify(del.data));
    const open = await openSlots(Q.uid);
    check('★★⑱-a B 의 남은 기간이 미소비 슬롯 1개로 돌아온다', open.length === 1 && open[0]?.source === 'claim' && sameTime(open[0]?.paid_until, bPaid?.paid_until), JSON.stringify(open));
    const C = await tryStore(Q, 'QA⑱ 3호점');
    check('★★⑱-a 돌려받은 몫으로 새 매장 C 를 연다', !!C.unit, C.err || C.unit);
    const pc = await svcSel(`payment_claims?id=eq.${pend?.id}&select=status,reject_reason,unit_id`);
    check('★⑱-e 지운 매장의 대기 신고는 store_deleted 로 닫힌다', pc[0]?.status === 'rejected' && pc[0]?.reject_reason === 'store_deleted', JSON.stringify(pc));
    const { data: mine } = await Q.c.from('payment_claims').select('id').eq('id', pend?.id);
    check('★⑱-e 사장은 지운 매장의 신고 기록을 계속 본다', (mine ?? []).length === 1, `rows=${(mine ?? []).length}`);
  }
  {
    const Q = await reuseOwner(4);
    const A = await mkStore(Q, 'QA⑱b 1호점');
    const t = `qa_j8_${s}`;
    await evt(Q, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const B = await mkStore(Q, 'QA⑱b 2호점');
    const del = await Q.c.rpc('delete_store', { p_unit_id: B });
    const open = await openSlots(Q.uid);
    check('★⑱-b 앱 구독으로 연 B 를 지우면 그 슬롯이 미소비로 돌아온다', !del.error && open.length === 1 && open[0]?.source === 'iap', del.error?.message ?? JSON.stringify(open));
    await evt(Q, t, 'RENEWAL', 'multi_2_monthly', 'multi', 2, iso(days(60)));
    const all = await svcSel(`store_slots?owner_id=eq.${Q.uid}&source=eq.iap&select=id,consumed_at`);
    check('★★⑱-b 다음 갱신은 돌려받은 슬롯을 다시 쓴다(새로 쌓지 않음 · 흔적 1 + 미소비 1)', Array.isArray(all) && all.length === 2, `iap=${all.length}`);
  }
  {
    const Q = await reuseOwner(1);
    const A = await mkStore(Q, 'QA⑱c 1호점');
    const cs = await claim(Q, 'single', 1);
    await approve(cs.id);
    await grantSlot(Q.uid);
    const B = await mkStore(Q, 'QA⑱c 2호점');
    await makeFree(B);
    const aPaid = await paidUntilOf(A);
    check('셋업 ⑱-c A = 계좌이체 single · B 잠김', aPaid?.plan === 'single' && (await isLocked(B)), JSON.stringify(aPaid));
    const del = await Q.c.rpc('delete_store', { p_unit_id: A });
    const rows = await svcSel(`store_slots?owner_id=eq.${Q.uid}&consumed_at=is.null&select=id,source,paid_until,plan`);
    const open = Array.isArray(rows) ? rows : [];
    check('★★⑱-c 계좌이체 single 매장을 지우면 single 슬롯이 돌아온다', !del.error && open.length === 1 && open[0]?.plan === 'single' && open[0]?.source === 'claim' && sameTime(open[0]?.paid_until, aPaid?.paid_until), del.error?.message ?? JSON.stringify(rows));
    const C = await tryStore(Q, 'QA⑱c 3호점');
    const c = C.unit ? await paidUntilOf(C.unit) : null;
    check('★★⑱-c 그 몫으로 연 C 는 single 이다(다점포로 새지 않는다)', c?.plan === 'single', C.err || JSON.stringify(c));
    const pc = await svcSel(`payment_claims?id=eq.${cs.id}&select=id,unit_id,status`);
    check('★⑱-d 승인된 결제 기록은 매장을 지워도 남는다(unit_id 비움)', pc.length === 1 && pc[0]?.unit_id === null && pc[0]?.status === 'approved', JSON.stringify(pc));
  }
  {
    // ⑱-f 코드(admin_activate_store)만으로 연 매장은 돌려주지 않는다 — 코드를 돌려 쓰는 길을 막는다.
    const Q = await reuseOwner(2);
    const A = await mkStore(Q, 'QA⑱f 1호점');
    await svcRpc('admin_activate_store', { p_unit_id: A, p_days: 30, p_plan: 'single' });
    await grantSlot(Q.uid);
    await mkStore(Q, 'QA⑱f 2호점');
    const del = await Q.c.rpc('delete_store', { p_unit_id: A });
    check('★⑱-f 코드로만 연 매장은 몫을 돌려주지 않는다', !del.error && del.data?.returned_slot === false && (await openSlots(Q.uid)).length === 0, del.error?.message ?? JSON.stringify(del.data));
  }

  // ══ ⑲ 0235 독립 리뷰(2026-10-05)에서 확정된 결함 ══════════════════════════
  const evtP = (o, txn, type, productId, plan, count, end, extra = {}) => svcRpc('apply_iap_event', {
    p_owner: o.uid, p_platform: 'play', p_txn: txn, p_type: type, p_product_id: productId,
    p_plan: plan, p_count: count, p_period_end: end, ...extra,
  });
  const shiftBack = (t, d) => new Date(new Date(t).getTime() - d * 86400000).toISOString();

  // ⑲-a 다점포 흔적 슬롯 날짜가 갱신되지 않아, 3번째 주기에 늦게 온 갱신이 결제한 매장을 못 연다.
  {
    const R = await reuseOwner(1);
    const A = await mkStore(R, 'QA⑲a 1호점');
    const t = `qa_r1_${s}`;
    await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const B = await mkStore(R, 'QA⑲a 2호점');
    const end2 = iso(days(60));
    await evt(R, t, 'RENEWAL', 'multi_2_monthly', 'multi', 2, end2);   // 2번째 주기
    // 시간을 61일 앞으로 보낸 것처럼 모든 날짜를 61일 당긴다(매장·흔적·구독). 2번째 주기는 하루 전에 끝났다.
    for (const u of [A, B]) {
      const cur = await paidUntilOf(u);
      await svcPatch(`unit_subscriptions?unit_id=eq.${u}`, { paid_until: shiftBack(cur.paid_until, 61) });
    }
    for (const sl of await svcSel(`store_slots?owner_id=eq.${R.uid}&source=eq.iap&select=id,paid_until`)) {
      await svcPatch(`store_slots?id=eq.${sl.id}`, { paid_until: shiftBack(sl.paid_until, 61) });
    }
    await svcPatch(`iap_subscriptions?original_transaction_id=eq.${t}`, { current_period_end: shiftBack(end2, 61) });
    await grantSlot(R.uid);
    await mkStore(R, 'QA⑲a 선불점');   // 선불 매장이 유료라 A·B 가 잠긴다
    check('셋업 ⑲-a A·B 잠김(2번째 주기 끝 + 선불 매장)', (await isLocked(A)) && (await isLocked(B)), '');
    const end3 = iso(days(29));
    await evt(R, t, 'RENEWAL', 'multi_2_monthly', 'multi', 2, end3);   // 3번째 주기, 하루 늦게 도착
    const [a, b] = await Promise.all([paidUntilOf(A), paidUntilOf(B)]);
    check('★★⑲-a 3번째 주기 늦은 갱신이 A·B 를 다시 연다', sameTime(a?.paid_until, end3) && sameTime(b?.paid_until, end3), JSON.stringify({ a, b }));
    check('★⑲-a 결제한 몫이 미소비 슬롯으로 새지 않는다', (await openSlots(R.uid)).length === 0, `open=${(await openSlots(R.uid)).length}`);
  }

  // ⑲-b 계좌이체 슬롯으로 연 매장을 새 구독이 흡수한 뒤 환불 → 계좌이체 만료일로 돌아간다(환불된 날을 공짜로 남기지 않는다).
  {
    const R = await reuseOwner(2);
    const A = await mkStore(R, 'QA⑲b 1호점');
    await approve((await claim(R, 'multi', 1)).id);   // A = 계좌이체 슬롯으로 열림
    const d10 = iso(days(10));
    await svcPatch(`unit_subscriptions?unit_id=eq.${A}`, { paid_until: d10 });
    await svcPatch(`store_slots?owner_id=eq.${R.uid}&source=eq.claim`, { paid_until: d10 });
    const t = `qa_r2_${s}`;
    await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const a1 = await paidUntilOf(A);
    check('셋업 ⑲-b 새 구독이 계좌이체 매장 A 를 덮음(남은 10일 뒤에 30일 · ㉑)', sameTime(a1?.paid_until, plus(d10, 30)), JSON.stringify(a1));
    await evt(R, t, 'CANCELLATION', 'multi_2_monthly', 'multi', 2, iso(days(30)), { p_reason: 'CUSTOMER_SUPPORT' });
    const a2 = await paidUntilOf(A);
    check('★★⑲-b 환불 → A 는 계좌이체 만료일(10일)로 돌아간다', a2?.status === 'active' && sameTime(a2?.paid_until, d10), JSON.stringify(a2));
  }

  // ⑲-c 본사 부담이 된 매장은 옛 구독 환불로 닫히지 않는다(로컬 전용 — brands 행).
  if (!LOCAL) {
    skipped('⑲-c 본사 부담 환불', '로컬 전용(brands 행 생성)');
  } else {
    const R = await reuseOwner(3);
    const brandId = `qa_brand_r3_${s}`;
    try {
      await mkStore(R, 'QA⑲c 1호점');
      const t = `qa_r3_${s}`;
      await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
      const B = await mkStore(R, 'QA⑲c 2호점');
      await svcPost('brands', { id: brandId, name: 'QA본사(r3)', paid_until: kstDate(days(40)) });
      await svcPost('brand_units', { brand_id: brandId, unit_id: B, status: 'active', payer: 'brand' });
      await svcPatch(`brand_units?brand_id=eq.${brandId}`, { payer_effective_from: kstDate(Date.now()) });
      const b0 = await paidUntilOf(B);
      await evt(R, t, 'CANCELLATION', 'multi_2_monthly', 'multi', 2, iso(days(30)), { p_reason: 'CUSTOMER_SUPPORT' });
      const b1 = await paidUntilOf(B);
      check('★★⑲-c 본사 부담 매장 B 는 구독 환불로 닫히지 않는다', b1?.status === 'active' && sameTime(b1?.paid_until, b0?.paid_until), JSON.stringify({ b0, b1 }));
    } finally {
      await fetch(`${URL}/rest/v1/brand_units?brand_id=eq.${brandId}`, { method: 'DELETE', headers: SH }).catch(() => {});
      await fetch(`${URL}/rest/v1/brands?id=eq.${brandId}`, { method: 'DELETE', headers: SH }).catch(() => {});
    }
  }

  // ⑲-d 구독 매장을 지워 돌려받은 슬롯은 그 구독을 환불하면 같이 끝난다.
  {
    const R = await reuseOwner(4);
    const A = await mkStore(R, 'QA⑲d 1호점');
    const t = `qa_r4_${s}`;
    await evt(R, t, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, iso(days(30)));
    await grantSlot(R.uid);
    const B = await mkStore(R, 'QA⑲d 2호점');
    await makeFree(B);
    await R.c.rpc('delete_store', { p_unit_id: A });
    check('셋업 ⑲-d A 삭제 → 구독 슬롯 반환', (await openSlots(R.uid)).length === 1, '');
    await evt(R, t, 'CANCELLATION', 'single_1_monthly', 'single', 1, iso(days(30)), { p_reason: 'CUSTOMER_SUPPORT' });
    const live = (await openSlots(R.uid)).filter((x) => new Date(x.paid_until).getTime() > Date.now());
    check('★★⑲-d 환불 뒤 돌려받은 슬롯이 쓸 수 없게 끝난다', live.length === 0, JSON.stringify(live));
    const C = await tryStore(R, 'QA⑲d 3호점');
    check('★⑲-d 환불된 몫으로 새 매장을 열 수 없다', !C.unit && /no_store_slot/.test(C.err), C.err || `열려버림 ${C.unit}`);
  }

  // ⑲-e 같은 매장을 동시에 여러 번 지워도 몫은 하나만 돌아온다.
  {
    const R = await reuseOwner(1);
    const A = await mkStore(R, 'QA⑲e 1호점');
    await approve((await claim(R, 'single', 1)).id);
    await grantSlot(R.uid);
    await mkStore(R, 'QA⑲e 2호점');
    await Promise.all(Array.from({ length: 6 }, () => R.c.rpc('delete_store', { p_unit_id: A })));
    const open = await openSlots(R.uid);
    check('★★⑲-e 동시 삭제 6번 → 돌려받은 슬롯 1개', open.length === 1, `open=${open.length}`);
  }

  // ⑲-f 오래전에 끝난 슬롯 + 코드로 연 기간은 돌려주지 않는다(코드를 슬롯으로 바꿔 돌려 쓰는 길).
  {
    const R = await reuseOwner(2);
    await mkStore(R, 'QA⑲f 1호점');
    await grantSlot(R.uid);
    const B = await mkStore(R, 'QA⑲f 2호점');
    const past = iso(Date.now() - 40 * 86400000);
    await svcPatch(`store_slots?owner_id=eq.${R.uid}&source=eq.grant`, { paid_until: past });
    await svcPatch(`unit_subscriptions?unit_id=eq.${B}`, { paid_until: past, status: 'expired' });
    await svcRpc('admin_activate_store', { p_unit_id: B, p_days: 30, p_plan: 'multi' });   // 코드
    const del = await R.c.rpc('delete_store', { p_unit_id: B });
    check('★★⑲-f 끝난 옛 슬롯 + 코드 기간은 돌려주지 않는다', !del.error && del.data?.returned_slot === false && (await openSlots(R.uid)).length === 0, del.error?.message ?? JSON.stringify(del.data));
  }

  // ⑲-g 계좌이체 single 을 만료 전에 이어 낸 기간은 전부 돌려준다(L6 상한이 이어 붙인 기간을 깎지 않는다).
  {
    const R = await reuseOwner(3);
    const A = await mkStore(R, 'QA⑲g 1호점');
    await approve((await claim(R, 'single', 1)).id);
    await grantSlot(R.uid);
    const B = await mkStore(R, 'QA⑲g 2호점');
    await makeFree(B);
    await R.c.rpc('switch_active_unit', { p_unit_id: A });
    await approve((await claim(R, 'single', 1)).id);   // 만료 전에 한 달 더(이어 붙임)
    const aPaid = await paidUntilOf(A);
    await R.c.rpc('delete_store', { p_unit_id: A });
    const open = await openSlots(R.uid);
    check('★★⑲-g 이어 낸 두 달이 모두 돌아온다', open.length === 1 && sameTime(open[0]?.paid_until, aPaid?.paid_until), JSON.stringify({ aPaid, open }));
  }

  // ⑲-h Play 늘리기(새 거래 INITIAL_PURCHASE)도 이어지는 결제다 — 늘린 몫이 선불 매장에 먹히지 않는다.
  {
    const R = await reuseOwner(4);
    await mkStore(R, 'QA⑲h 1호점');
    const p1 = `qa_r8a_${s}`, p2 = `qa_r8b_${s}`;
    const end = iso(days(30));
    await evtP(R, p1, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, end);
    await mkStore(R, 'QA⑲h 2호점');
    await grantSlot(R.uid);
    const C = await mkStore(R, 'QA⑲h 선불점');
    await evtP(R, p1, 'PRODUCT_CHANGE', 'multi_3_monthly', 'multi', 3, end);
    await evtP(R, p2, 'INITIAL_PURCHASE', 'multi_3_monthly', 'multi', 3, end);
    const cTrace = await svcSel(`store_slots?owner_id=eq.${R.uid}&source=eq.iap&consumed_unit_id=eq.${C}&select=id`);
    check('★★⑲-h Play 늘리기 몫이 선불 매장 C 에 먹히지 않는다', Array.isArray(cTrace) && cTrace.length === 0, JSON.stringify(cTrace));
    check('★⑲-h 늘린 몫 1개가 새 매장용으로 남는다', (await openSlots(R.uid)).filter((x) => x.source === 'iap').length === 1, JSON.stringify(await openSlots(R.uid)));
  }

  // ══ ⑳ 선불 기간이 남아 있으면 앱 결제를 잠근다(2026-10-05 결정) — 앱이 읽는 owner_prepaid_until() ══════
  {
    const R = await reuseOwner(1);
    const pv = async (o) => o.c.rpc('owner_prepaid_until');
    const r0 = await pv(R);
    check('★⑳-a owner_prepaid_until 이 있다(로그인 사장이 부른다)', !r0.error, r0.error?.message ?? '');
    const A = await mkStore(R, 'QA⑳ 1호점');
    await makeFree(A);
    const r1 = await pv(R);
    check('⑳-b 무료 매장만 있으면 null', !r1.error && r1.data === null, r1.error?.message ?? JSON.stringify(r1.data));
    await approve((await claim(R, 'single', 1)).id);   // A = 계좌이체 선불
    const aPaid = await paidUntilOf(A);
    const r2 = await pv(R);
    check('★⑳-c 계좌이체 선불 매장의 만료일을 준다', !r2.error && sameTime(r2.data, aPaid?.paid_until), r2.error?.message ?? JSON.stringify({ got: r2.data, aPaid }));
    const X = await reuseOwner(2);
    const rx = await pv(X);
    check('★⑳-d 남의 선불 기간은 보이지 않는다(본인 매장만)', !rx.error && rx.data === null, rx.error?.message ?? JSON.stringify(rx.data));
    const an = await mk().rpc('owner_prepaid_until');
    check('⑳-e anon 은 부르지 못한다', !!an.error, JSON.stringify(an.data));
    const Q = await reuseOwner(3);
    const B = await mkStore(Q, 'QA⑳ 구독점');
    await evt(Q, `qa_pp_${s}`, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, iso(days(30)));
    const rq = await pv(Q);
    check('★⑳-f 앱 구독으로 연 매장은 선불이 아니다(null)', !rq.error && rq.data === null && !!(await paidUntilOf(B))?.paid_until, rq.error?.message ?? JSON.stringify(rq.data));
  }

  // ══ ㉑ 선불 끝나기 3일 안에 산 구독은 선불이 끝난 다음부터 센다(2026-10-05 결정) ══════════════════
  //   예) 선불 10/31 끝 · 10/29 구독 결제(스토어 기간 11/29) → 매장은 12/1 까지(겹친 2일 손해 없음).
  //   갱신이 와도 그 2일이 사라지지 않는다(스토어 기간 12/29 → 매장 12/31).
  const prepaidLeft = async (o, unit, d) => {
    const pre = iso(days(d));
    await svcPatch(`unit_subscriptions?unit_id=eq.${unit}`, { paid_until: pre });
    await svcPatch(`store_slots?owner_id=eq.${o.uid}&source=eq.claim&consumed_unit_id=eq.${unit}`, { paid_until: pre });
    return pre;
  };
  {
    const R = await reuseOwner(1);
    const A = await mkStore(R, 'QA㉑ 1호점');
    await makeFree(A);
    await approve((await claim(R, 'single', 1)).id);
    const pre = await prepaidLeft(R, A, 2);
    const t = `qa_carry1_${s}`;
    const end1 = iso(days(30));
    await evt(R, t, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, end1);
    const a1 = await paidUntilOf(A);
    check('★★㉑-a 1매장: 선불 끝(2일 뒤) + 구독 30일 = 32일 뒤까지', a1?.plan === 'single' && sameTime(a1?.paid_until, plus(pre, 30)), JSON.stringify({ pre, a1 }));
    const end2 = iso(days(60));
    await evt(R, t, 'RENEWAL', 'single_1_monthly', 'single', 1, end2);
    const a2 = await paidUntilOf(A);
    check('★★㉑-b 1매장: 갱신 뒤에도 겹친 2일이 남는다(62일 뒤)', sameTime(a2?.paid_until, plus(end2, 2)), JSON.stringify(a2));
  }
  {
    const R = await reuseOwner(2);
    const A = await mkStore(R, 'QA㉑m 1호점');
    await makeFree(A);
    await approve((await claim(R, 'single', 1)).id);
    const pre = await prepaidLeft(R, A, 2);
    const t = `qa_carry2_${s}`;
    await evt(R, t, 'INITIAL_PURCHASE', 'multi_2_monthly', 'multi', 2, iso(days(30)));
    const a1 = await paidUntilOf(A);
    check('★★㉑-c 다점포: 선불 매장도 선불 끝 + 30일', a1?.plan === 'multi' && sameTime(a1?.paid_until, plus(pre, 30)), JSON.stringify({ pre, a1 }));
    const end2 = iso(days(60));
    await evt(R, t, 'RENEWAL', 'multi_2_monthly', 'multi', 2, end2);
    const a2 = await paidUntilOf(A);
    check('★★㉑-d 다점포: 갱신 뒤에도 겹친 2일이 남는다', sameTime(a2?.paid_until, plus(end2, 2)), JSON.stringify(a2));
  }
  {
    // 겹침이 없으면(무료 매장) 지금처럼 스토어 기간 그대로.
    const R = await reuseOwner(3);
    const A = await mkStore(R, 'QA㉑f 1호점');
    await makeFree(A);
    const end = iso(days(30));
    await evt(R, `qa_carry3_${s}`, 'INITIAL_PURCHASE', 'single_1_monthly', 'single', 1, end);
    check('㉑-e 선불이 없으면 스토어 기간 그대로', sameTime((await paidUntilOf(A))?.paid_until, end), '');
  }
}

async function main() {
  staticChecks();
  if (!URL || !ANON || !SERVICE) {
    skipped('B 전체', 'env 없음(EXPO_PUBLIC_SUPABASE_URL / ANON / SUPABASE_SERVICE_ROLE_KEY)');
    return;
  }
  await liveChecks();
}

main()
  .catch((e) => { console.error('\n✗ 중단:', e.message); fail++; })
  .finally(async () => {
    try { await cleanupSeededPhones(URL, SERVICE, seededPhones); } catch { /* */ }
    if (originalTrialDays !== null) {
      try { await setSignupTrialDays(originalTrialDays); }
      catch { console.error('  !! 원복 실패 — app_config.signup_trial_days 수동 확인'); fail++; }
    }
    if (originalIapEnabled !== null) {
      try { await svcPatch('app_config?key=eq.iap_enabled', { value: originalIapEnabled, updated_at: iso(Date.now()) }); }
      catch { console.error('  !! 원복 실패 — app_config.iap_enabled 수동 확인'); fail++; }
    }
    console.log(`\nFINAL: ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
