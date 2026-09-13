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

const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let seq = 0;
const seededPhones = [];
const cleanup = [];
async function signUp(name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 31) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_iap_${s}_${seq}@example.com`;
  for (let a = 0; a < 6; a++) {
    const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role: 'owner', phone, birth_date: '1990-01-15' } } });
    if (!error && data.session) return { c, uid: data.user.id, email };
    if (!/rate limit/i.test(error?.message ?? '')) throw new Error(`signUp: ${error?.message}`);
    info(`레이트리밋 — ${20 * (a + 1)}s 대기`);
    await new Promise((r) => setTimeout(r, 20000 * (a + 1)));
  }
  throw new Error('signUp 레이트리밋 소진');
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
  const O = await signUp('QA인앱사장');
  cleanup.push(O.c);
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

  // ── ⑤ 다운그레이드 — 초과분은 연장하지 않는다 ────────────────────────────
  const end3 = iso(days(90));
  const r5 = await svcRpc('sync_iap_slots', { p_owner: O.uid, p_plan: 'multi', p_count: 1, p_period_end: end3 });
  const a5 = await paidUntilOf(S1), b5 = await paidUntilOf(S2);
  check('★⑤ 1매장으로 내리면 1곳만 연장된다', r5.data?.extended === 1 && r5.data?.granted === 0, JSON.stringify(r5.data));
  check('★⑤ 오래된 매장(1호점)이 남는다', sameTime(a5?.paid_until, end3), `${a5?.paid_until}`);
  check('★⑤ 초과분(2호점)은 그대로 — 다음 갱신일에 자연 만료', sameTime(b5?.paid_until, end2), `${b5?.paid_until}`);

  // ── ⑥ single 은 슬롯 경로를 안 탄다(다점포 누수) ─────────────────────────
  const P = await signUp('QA인앱단일');
  cleanup.push(P.c);
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
  const U = await signUp('QA인앱승급');
  cleanup.push(U.c);
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
  const W = await signUp('QA인앱예고');
  cleanup.push(W.c);
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
    for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* */ } }
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
