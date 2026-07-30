#!/usr/bin/env node
// qa-promo-codes.mjs — 무료 이용 코드 발급 → 사용 → 활성화(0092) 라이브 증명.
//
// 닫으려는 구멍: 코드가 "우리 마음대로 조절되는가"(기간·수량·만료·중단)와 "클라가 우회 못 하는가".
//   ① 무료 매장 사장 리딤 → unit_subscriptions 실제 active + paid_until ≈ +N일
//   ② 유료 이용 중 매장 거부(already_paid) · 만료 후 같은 코드 재사용 거부(already_redeemed)
//   ③ 선착순 캡(max_redemptions) — 소진 코드 거부(code_exhausted)
//   ④ 중단 코드(code_inactive) · 기한 지난 코드(code_expired) · 없는 코드(code_not_found)
//   ⑤ 직원(junior) 리딤 차단(not_owner)
//   ⑥ 입력 정규화(소문자·공백 → 대문자 매칭)
//   ⑦ ★클라 직접 접근 전면 차단: promo_codes/promo_redemptions select·insert 전부 deny
//
// 실행: node scripts/qa-promo-codes.mjs
//   env: .env(EXPO_PUBLIC_SUPABASE_URL/ANON) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 자동 로드.
// 자가정리: 코드 행 delete(cascade 로 리딤 기록 제거) + delete_my_account + 시드 전화번호 정리.
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

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

// 이 실행 전용 코드 이름(promo_codes 는 영구 테이블 — 충돌·잔존 방지용 유니크 접미사)
const C_OK  = `QA${s}OK`;   // 7일 · 무제한
const C_CAP = `QA${s}CAP`;  // 7일 · 선착순 1
const C_OFF = `QA${s}OFF`;  // 중단됨
const C_EXP = `QA${s}EXP`;  // 코드 자체가 기한 지남

// ── service_role 헬퍼(REST — RLS 우회) ──────────────────────────────────────
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcInsert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}`, { method: 'POST', headers: { ...SH, Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`svcInsert(${table}) ${res.status}: ${await res.text()}`);
}
async function svcPatch(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { method: 'PATCH', headers: SH, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`svcPatch(${path}) ${res.status}: ${await res.text()}`);
}
async function svcSelect(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: SH });
  return res.ok ? await res.json() : null;
}
async function svcDelete(path) {
  await fetch(`${URL}/rest/v1/${path}`, { method: 'DELETE', headers: SH });
}

// ── 계정 헬퍼 ────────────────────────────────────────────────────────────────
let seq = 0;
const seededPhones = []; // 0088 게이트 라이브 — 번호를 '인증됨'으로 선등록해야 create_store/join이 통과
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0108${String((Number(s) + seq * 31) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_promo_${s}_${seq}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: '1990-01-15' } } });
  if (error || !data.session) throw new Error(`signUp(${name}) 실패: ${error?.message}`);
  return { c, uid: data.user.id, email };
}
async function makeStore(owner, storeName) {
  const { data, error } = await owner.c.rpc('create_store', { p_store_name: storeName, p_industry: '카페·디저트', p_biz_no: null });
  if (error || !data?.[0]?.unit_id) throw new Error(`create_store(${storeName}) 실패: ${error?.message}`);
  return data[0];
}
const cleanup = [];
async function cleanupAll() {
  // 코드 삭제(cascade 로 promo_redemptions 도 제거) — 영구 테이블에 QA 쓰레기를 남기지 않는다.
  for (const code of [C_OK, C_CAP, C_OFF, C_EXP]) {
    try { await svcDelete(`promo_codes?code=eq.${code}`); } catch { /* best-effort */ }
  }
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

const errOf = (e) => e?.message ?? '';

async function main() {
  // ── 0) 사장 A·B·C(각 무료 1매장) · A매장 직원 J · 코드 4종 발급(service) ────
  const A = await signUp('owner', 'QA코드사장A'); cleanup.push(A.c);
  const storeA = await makeStore(A, 'QA 코드 A점');
  const B = await signUp('owner', 'QA코드사장B'); cleanup.push(B.c);
  const storeB = await makeStore(B, 'QA 코드 B점');
  const C = await signUp('owner', 'QA코드사장C'); cleanup.push(C.c);
  await makeStore(C, 'QA 코드 C점');

  const J = await signUp('junior', 'QA코드직원'); cleanup.push(J.c);
  const { error: ej } = await J.c.rpc('join_by_invite', { p_code: storeA.invite_code });
  if (ej) throw new Error(`join_by_invite 실패: ${ej.message}`);
  const { error: eap } = await A.c.rpc('approve_member', { p_uid: J.uid });
  if (eap) throw new Error(`approve_member 실패: ${eap.message}`);

  // PostgREST 일괄 insert 는 모든 행의 키가 같아야 한다(PGRST102) — 기본값도 명시.
  const base = { plan: 'single', days: 7, max_redemptions: null, expires_at: null, active: true, created_by: 'qa' };
  await svcInsert('promo_codes', [
    { ...base, code: C_OK, note: 'QA 무제한' },
    { ...base, code: C_CAP, max_redemptions: 1, note: 'QA 선착순1' },
    { ...base, code: C_OFF, active: false, note: 'QA 중단' },
    { ...base, code: C_EXP, expires_at: new Date(Date.now() - 86400000).toISOString(), note: 'QA 기한지남' },
  ]);
  check('0 코드 4종 발급(service)', true);

  // ── 1) 무료 매장 리딤 → 실제 활성화 ────────────────────────────────────────
  const { data: r1, error: e1 } = await A.c.rpc('redeem_promo_code', { p_code: C_OK });
  const row1 = r1?.[0];
  check('① 리딤 성공(단일 매장 · 7일)', !e1 && row1?.plan === 'single' && row1?.days === 7, errOf(e1) || JSON.stringify(row1 ?? {}).slice(0, 80));
  const sub1 = await svcSelect(`unit_subscriptions?unit_id=eq.${storeA.unit_id}&select=status,plan,paid_until`);
  const paid1 = sub1?.[0]?.paid_until ? new Date(sub1[0].paid_until).getTime() : 0;
  check('① unit_subscriptions 실제 active·single', sub1?.[0]?.status === 'active' && sub1?.[0]?.plan === 'single', JSON.stringify(sub1?.[0] ?? {}));
  check('① paid_until ≈ +7일', paid1 > Date.now() + 5 * 86400000 && paid1 < Date.now() + 9 * 86400000, sub1?.[0]?.paid_until ?? '');

  // ── 2) 유료 이용 중 매장 거부 → 만료 후 같은 코드 재사용도 거부 ────────────
  const { error: e2 } = await A.c.rpc('redeem_promo_code', { p_code: C_OK });
  check('② 유료 이용 중 리딤 거부(already_paid)', /already_paid/.test(errOf(e2)), errOf(e2).slice(0, 60) || '통과돼버림');

  // 유료 기간 만료를 시뮬레이션(paid_until 을 과거로) — 같은 코드 재사용은 매장당 1회 제한에 걸려야 한다.
  await svcPatch(`unit_subscriptions?unit_id=eq.${storeA.unit_id}`, { paid_until: new Date(Date.now() - 86400000).toISOString() });
  const { error: e2b } = await A.c.rpc('redeem_promo_code', { p_code: C_OK });
  check('② 만료 후 같은 코드 재사용 거부(already_redeemed)', /already_redeemed/.test(errOf(e2b)), errOf(e2b).slice(0, 60) || '통과돼버림');

  // ── 3) 선착순 캡 ───────────────────────────────────────────────────────────
  const { error: e3 } = await B.c.rpc('redeem_promo_code', { p_code: C_CAP });
  check('③ 선착순 1호(B) 리딤 성공', !e3, errOf(e3));
  const { error: e3b } = await C.c.rpc('redeem_promo_code', { p_code: C_CAP });
  check('③ 선착순 소진 후 거부(code_exhausted)', /code_exhausted/.test(errOf(e3b)), errOf(e3b).slice(0, 60) || '통과돼버림');
  const capRow = await svcSelect(`promo_codes?code=eq.${C_CAP}&select=redeemed_count`);
  check('③ redeemed_count = 1(캡 초과 미집계)', capRow?.[0]?.redeemed_count === 1, `count=${capRow?.[0]?.redeemed_count}`);

  // ── 4) 중단·기한 지남·없는 코드 ────────────────────────────────────────────
  const { error: e4 } = await C.c.rpc('redeem_promo_code', { p_code: C_OFF });
  check('④ 중단 코드 거부(code_inactive)', /code_inactive/.test(errOf(e4)), errOf(e4).slice(0, 60) || '통과돼버림');
  const { error: e4b } = await C.c.rpc('redeem_promo_code', { p_code: C_EXP });
  check('④ 기한 지난 코드 거부(code_expired)', /code_expired/.test(errOf(e4b)), errOf(e4b).slice(0, 60) || '통과돼버림');
  const { error: e4c } = await C.c.rpc('redeem_promo_code', { p_code: `QA${s}NOPE` });
  check('④ 없는 코드 거부(code_not_found)', /code_not_found/.test(errOf(e4c)), errOf(e4c).slice(0, 60) || '통과돼버림');

  // ── 5) 직원 리딤 차단 ──────────────────────────────────────────────────────
  const { error: e5 } = await J.c.rpc('redeem_promo_code', { p_code: C_OK });
  check('⑤ 직원(junior) 리딤 차단(not_owner)', /not_owner/.test(errOf(e5)), errOf(e5).slice(0, 60) || '리딤돼버림');

  // ── 6) 입력 정규화(소문자·공백) — C 가 무제한 코드를 소문자로 사용 ─────────
  const { data: r6, error: e6 } = await C.c.rpc('redeem_promo_code', { p_code: `  ${C_OK.toLowerCase()}  ` });
  check('⑥ 소문자·공백 입력 정규화 후 리딤 성공', !e6 && r6?.[0]?.days === 7, errOf(e6) || JSON.stringify(r6?.[0] ?? {}).slice(0, 60));
  const okRow = await svcSelect(`promo_codes?code=eq.${C_OK}&select=redeemed_count`);
  check('⑥ redeemed_count 집계(A+C = 2)', okRow?.[0]?.redeemed_count === 2, `count=${okRow?.[0]?.redeemed_count}`);

  // ── 7) ★클라 직접 접근 전면 차단 ───────────────────────────────────────────
  const { data: selCodes, error: selErr } = await A.c.from('promo_codes').select('code');
  check('⑦ promo_codes 클라 select 차단', !!selErr || (selCodes ?? []).length === 0, selErr?.message?.slice(0, 60) ?? `rows=${(selCodes ?? []).length}`);
  const { data: selRed, error: selRedErr } = await A.c.from('promo_redemptions').select('code');
  check('⑦ promo_redemptions 클라 select 차단', !!selRedErr || (selRed ?? []).length === 0, selRedErr?.message?.slice(0, 60) ?? `rows=${(selRed ?? []).length}`);
  const { error: insCode } = await A.c.from('promo_codes').insert({ code: `QA${s}HACK`, plan: 'single', days: 365 });
  check('⑦ promo_codes 클라 insert(코드 위조) 차단', !!insCode, insCode?.message?.slice(0, 60) ?? '통과돼버림');
  const { error: insRed } = await A.c.from('promo_redemptions').insert({ code: C_OK, unit_id: storeB.unit_id, redeemed_by: A.uid });
  check('⑦ promo_redemptions 클라 insert 차단', !!insRed, insRed?.message?.slice(0, 60) ?? '통과돼버림');
  const { data: updCode, error: updErr } = await A.c.from('promo_codes').update({ days: 365 }).eq('code', C_OK).select('code');
  check('⑦ promo_codes 클라 update(기간 위조) 차단', !!updErr || (updCode ?? []).length === 0, updErr?.message?.slice(0, 60) ?? `rows=${(updCode ?? []).length}`);

  // ★main 이 process.exit 로 끝나 .finally(cleanupAll)는 도달하지 않는다 — 정리는 여기서.
  await cleanupAll();
  await cleanupSeededPhones(URL, SERVICE, seededPhones);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('FATAL:', e?.message ?? e);
  await cleanupAll();
  await cleanupSeededPhones(URL, SERVICE, seededPhones).catch(() => {});
  process.exit(1);
});
