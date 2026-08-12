#!/usr/bin/env node
// qa-downgrade-choice.mjs — 체험 종료 → 다운그레이드 선택(0141+0142) 라이브 증명.
//
// 무엇을 지키는 게이트인가
//   0141 은 가입 체험을 **다점포까지 전면 무료**로 여는 문이다. 0142 가 닫는 문(체험이 끝나면
//   무료 1매장·3좌석)이다. 둘 중 하나만 살아 있으면 **결제 0원으로 매장 15개를 영구 보유**하는
//   경로가 열린다 — 이 하니스가 그 상태를 실증으로 막는다.
//
// 검사 항목(설계서 §9)
//   ① 체험 중 매장 3개 생성 OK(슬롯 면제) → 만료 강제 → need_store=true
//   ② choose_kept_store → 고른 매장만 열림, 나머지 잠김
//   ③ switch_active_unit(잠긴 매장) → unit_locked 거부
//   ④ 직원 5명 → choose_kept_seats 3명 → 고른 3명 열림·나머지 2명 잠김
//   ⑤ choose_kept_seats 4명 → too_many_seats
//   ⑥ 남의 매장 선택 → not_owner
//   ⑦ 결제 후 복구 → admin_activate_store → 전부 열림
//   ⑧ ★선택 전에는 아무것도 잠기지 않는다(fail-open)
//   ⑨ 요금제 경로(D6): /downgrade → /billing 에 요금제·매장수가 실려 착지한다
//   ⑩ 금액 SSOT: 화면이 금액 숫자를 따로 갖고 있지 않다(tiers.ts 계산만)
//
// 실행: node scripts/qa-downgrade-choice.mjs
//   env: .env(EXPO_PUBLIC_SUPABASE_URL/ANON) + .env.seed(SUPABASE_SERVICE_ROLE_KEY) 자동 로드.
// 자가정리: delete_my_account + app_config 원복(finally).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const file of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
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
const info = (n, extra = '') => console.log('  ····', n, extra);

const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function svcRpc(fn, body) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: Array.isArray(j) ? j[0] : j };
}
async function svcPatch(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...SH, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const rows = res.ok ? await res.json() : [];
  if (!res.ok) throw new Error(`PATCH ${path} 실패: ${res.status} ${JSON.stringify(rows).slice(0, 120)}`);
  return rows;
}
// ★원복 기준은 RPC 가 아니라 app_config 원시값 — signup_trial_days() 는 창구가 닫히면
//   설정이 14여도 0을 돌려준다. 그 값으로 원복하면 라이브 프로모션이 영구히 꺼진다.
async function getSignupTrialDaysRaw() {
  const res = await fetch(`${URL}/rest/v1/app_config?key=eq.signup_trial_days&select=value`, { headers: SH });
  const rows = res.ok ? await res.json() : [];
  return rows[0]?.value ?? '0';
}
async function setSignupTrialDays(days) {
  const rows = await svcPatch('app_config?key=eq.signup_trial_days', { value: String(days), updated_at: new Date().toISOString() });
  if (rows.length !== 1) throw new Error(`setSignupTrialDays(${days}) 실패`);
  return rows[0].value;
}

let seq = 0;
const seededPhones = [];
async function signUp(role, name) {
  const c = mk();
  seq += 1;
  const phone = `0107${String((Number(s) + seq * 31) % 10000000).padStart(7, '0')}`;
  await seedVerifiedPhones(URL, SERVICE, [phone]);
  seededPhones.push(phone);
  const email = `qa_dg_${s}_${seq}@example.com`;
  for (let a = 0; a < 6; a++) {
    const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: '1990-01-15' } } });
    if (!error && data.session) return { c, uid: data.user.id, email, name };
    if (!/rate limit/i.test(error?.message ?? '')) throw new Error(`signUp(${name}): ${error?.message}`);
    info(`레이트리밋 — ${20 * (a + 1)}s 대기`);
    await new Promise((r) => setTimeout(r, 20000 * (a + 1)));
  }
  throw new Error('signUp 레이트리밋 소진');
}

const cleanup = [];
let originalTrialDays = null;

// 계정 축 판정을 그 사장의 세션으로 읽는다(definer 라 auth.uid() 가 기준).
async function needs(client) {
  const { data, error } = await client.rpc('needs_downgrade_choice');
  if (error) throw new Error(`needs_downgrade_choice: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}
async function locked(client, unit) {
  const { data, error } = await client.rpc('unit_access_locked', { p_unit: unit });
  if (error) throw new Error(`unit_access_locked(${unit}): ${error.message}`);
  return data === true;
}

async function main() {
  const { data: fm } = await svcRpc('billing_free_mode');
  info(`billing_free_mode=${fm}`);
  if (fm === true) { console.log('  ⚠ 전면 무료 모드가 켜져 있어 잠금이 전부 우회된다 — 검증 불가'); fail++; return; }

  // 체험을 확정값으로 고정한다(라이브 설정에 결과가 흔들리지 않게). 끝나면 원복.
  originalTrialDays = await getSignupTrialDaysRaw();
  await setSignupTrialDays(14);
  info(`signup_trial_days(설정값)=${originalTrialDays} → 14 로 고정(테스트 후 원복)`);

  // ── 셋업: 사장 + 매장 3곳(체험 중이라 슬롯 없이 열린다 = 0141) ─────────────
  const O = await signUp('owner', 'QA강등사장');
  cleanup.push(O.c);
  const units = [];
  let invite1 = null;
  for (let i = 1; i <= 3; i++) {
    const { data, error } = await O.c.rpc('create_store', { p_store_name: `QA강등 ${i}호점`, p_industry: '카페·디저트', p_biz_no: null });
    const u = data?.[0]?.unit_id;
    check(`★① 체험 중 ${i}호점 생성(슬롯 면제 — 0141)`, !error && !!u, error?.message ?? u);
    units.push(u);
    if (i === 1) invite1 = data?.[0]?.invite_code;
  }
  const [S1, S2, S3] = units;

  const ep1 = await svcRpc('effective_plan', { p_unit: S1 });
  check('★① 체험 매장은 multi 로 열린다(광고가 약속한 전 요금제 무료)', ep1.data === 'multi', `ep=${ep1.data}`);

  // 직원 5명 — 체험 중(multi)이라 좌석 캡 3에 걸리지 않는다. 승인은 활성 매장 기준이라 1호점으로 전환.
  const { error: swErr } = await O.c.rpc('switch_active_unit', { p_unit_id: S1 });
  check('셋업 활성 매장을 1호점으로', !swErr, swErr?.message ?? S1);
  const staff = [];
  for (let i = 1; i <= 5; i++) {
    const j = await signUp('junior', `QA강등직원${i}`);
    cleanup.push(j.c);
    const { error: je } = await j.c.rpc('join_by_invite', { p_code: invite1 });
    if (je) throw new Error(`join_by_invite(${i}): ${je.message}`);
    const { error: ae } = await O.c.rpc('approve_member', { p_uid: j.uid });
    if (ae) throw new Error(`approve_member(${i}): ${ae.message}`);
    staff.push(j);
  }
  info('직원 5명 합류 완료(체험 중이라 좌석 캡이 안 걸린다)');

  // ── 체험 중에는 아무것도 묻지 않는다 ──────────────────────────────────────
  const nTrial = await needs(O.c);
  check('체험 중에는 선택을 묻지 않는다', nTrial?.need_store === false && nTrial?.need_seats === false, JSON.stringify(nTrial));

  // ── 만료 강제(체험 종료일을 과거로) ───────────────────────────────────────
  await svcPatch(`unit_subscriptions?unit_id=in.(${S1},${S2},${S3})`, { trial_ends_at: new Date(Date.now() - 86400000).toISOString() });
  const epAfter = await svcRpc('effective_plan', { p_unit: S1 });
  check('만료 후 유효 플랜은 free 로 강등(앱 잠금 아님 — 0115)', epAfter.data === 'free', `ep=${epAfter.data}`);

  const n1 = await needs(O.c);
  check('★① 만료 → 남길 매장을 물어본다(need_store)', n1?.need_store === true, JSON.stringify(n1));
  check('★① 무료 매장 수 3', n1?.free_units === 3, `free_units=${n1?.free_units}`);

  // ── ⑧ 선택 전에는 아무것도 잠기지 않는다(fail-open) ───────────────────────
  //    거꾸로 만들면(먼저 잠그고 나중에 고르게) 활성 매장이 잠긴 사장은 선택 화면조차 못 연다.
  const pre = [await locked(O.c, S1), await locked(O.c, S2), await locked(O.c, S3)];
  check('★⑧ 선택 전에는 세 매장 모두 열려 있다(fail-open)', pre.every((v) => v === false), JSON.stringify(pre));
  const { error: preSw } = await O.c.rpc('switch_active_unit', { p_unit_id: S3 });
  check('★⑧ 선택 전에는 매장 전환도 막히지 않는다', !preSw, preSw?.message ?? 'ok');
  await O.c.rpc('switch_active_unit', { p_unit_id: S1 });

  // ── 후보 목록(0144) — 화면이 "고를 수 있는 매장"을 서버에서 받는다 ────────
  const { data: freeList } = await O.c.rpc('my_free_units');
  const freeIds = (freeList ?? []).map((r) => (typeof r === 'string' ? r : r?.my_free_units ?? r));
  check('★후보 목록(my_free_units)이 무료 매장 3곳을 준다', freeIds.length === 3, JSON.stringify(freeIds));

  // ── ⑥ 남의 매장은 못 고른다 ───────────────────────────────────────────────
  const B = await signUp('owner', 'QA강등타인');
  cleanup.push(B.c);
  const { data: bStore } = await B.c.rpc('create_store', { p_store_name: 'QA강등 타인점', p_industry: '카페·디저트', p_biz_no: null });
  const BS = bStore?.[0]?.unit_id;
  const { error: eNotOwner } = await O.c.rpc('choose_kept_store', { p_unit: BS });
  check('★⑥ 남의 매장 선택 시도 → not_owner', /not_owner/.test(eNotOwner?.message ?? ''), eNotOwner?.message ?? '선택돼버림');

  // ── ② 매장 고르기 ─────────────────────────────────────────────────────────
  const { error: eChoose } = await O.c.rpc('choose_kept_store', { p_unit: S1 });
  check('★② 남길 매장 선택 성공', !eChoose, eChoose?.message ?? S1);
  const post = [await locked(O.c, S1), await locked(O.c, S2), await locked(O.c, S3)];
  check('★② 고른 매장만 열려 있다', post[0] === false, `S1 locked=${post[0]}`);
  check('★② 나머지 두 매장은 잠긴다(삭제가 아니라 잠금)', post[1] === true && post[2] === true, JSON.stringify(post));

  const { data: lockedList } = await O.c.rpc('my_locked_units');
  const lockedIds = (lockedList ?? []).map((r) => (typeof r === 'string' ? r : r?.my_locked_units ?? r));
  check('★② 화면용 목록(my_locked_units)이 잠긴 2곳을 그대로 준다',
    lockedIds.length === 2 && lockedIds.includes(S2) && lockedIds.includes(S3), JSON.stringify(lockedIds));

  const n2 = await needs(O.c);
  check('★② 고른 뒤에는 매장을 다시 묻지 않는다', n2?.need_store === false, JSON.stringify(n2));

  // ── ③ 잠긴 매장으로는 못 들어간다(서버 강제) ──────────────────────────────
  const { error: eSw } = await O.c.rpc('switch_active_unit', { p_unit_id: S2 });
  check('★③ 잠긴 매장 전환 거부(unit_locked)', /unit_locked/.test(eSw?.message ?? ''), eSw?.message ?? '전환돼버림');

  // ── ④⑤ 직원 고르기 ───────────────────────────────────────────────────────
  check('★④ 남긴 매장의 직원 초과를 물어본다(need_seats)', n2?.need_seats === true, JSON.stringify(n2));
  check('★④ 초과 인원 2명(5명 − 무료 3명)', n2?.over_seats === 2, `over_seats=${n2?.over_seats}`);

  const { error: eMany } = await O.c.rpc('choose_kept_seats', { p_uids: staff.slice(0, 4).map((j) => j.uid) });
  check('★⑤ 4명 선택 → too_many_seats', /too_many_seats/.test(eMany?.message ?? ''), eMany?.message ?? '통과돼버림');
  const { error: eZero } = await O.c.rpc('choose_kept_seats', { p_uids: [] });
  check('★⑤ 빈 명단 거부(no_seats_chosen)', /no_seats_chosen/.test(eZero?.message ?? ''), eZero?.message ?? '통과돼버림');
  const { error: eOut } = await O.c.rpc('choose_kept_seats', { p_uids: [B.uid] });
  check('★⑤ 우리 매장 직원이 아니면 거부(not_a_member)', /not_a_member/.test(eOut?.message ?? ''), eOut?.message ?? '통과돼버림');

  const keptUids = staff.slice(0, 3).map((j) => j.uid);
  const { error: eSeats } = await O.c.rpc('choose_kept_seats', { p_uids: keptUids });
  check('★④ 3명 선택 성공', !eSeats, eSeats?.message ?? 'ok');

  // 좌석 잠금은 **직원 자신의 세션**에서 판정된다(auth.uid() + 활성 매장).
  for (let i = 0; i < 5; i++) {
    const { data: sl, error: se } = await staff[i].c.rpc('my_seat_locked');
    const expect = i >= 3; // 0~2 = 고른 3명, 3~4 = 못 고른 2명
    check(`★④ 직원${i + 1} 좌석 ${expect ? '잠김' : '열림'}(합류 순서가 아니라 사장의 선택)`, sl === expect, `locked=${sl} (${se?.message ?? ''})`);
  }

  const n3 = await needs(O.c);
  check('★④ 고른 뒤에는 직원도 다시 묻지 않는다', n3?.need_seats === false && n3?.need_store === false, JSON.stringify(n3));

  // ── ⑦ 결제 후 복구 — 잠긴 것이 그대로 돌아온다 ──────────────────────────
  await svcRpc('admin_activate_store', { p_unit_id: S2, p_days: 30, p_plan: 'multi' });
  await svcRpc('admin_activate_store', { p_unit_id: S3, p_days: 30, p_plan: 'multi' });
  const after = [await locked(O.c, S1), await locked(O.c, S2), await locked(O.c, S3)];
  check('★⑦ 결제 후 세 매장 모두 열린다(아무것도 삭제되지 않았다)', after.every((v) => v === false), JSON.stringify(after));
  const { error: eSw2 } = await O.c.rpc('switch_active_unit', { p_unit_id: S2 });
  check('★⑦ 결제 후 전환도 다시 열린다', !eSw2, eSw2?.message ?? 'ok');

  // ★0144: 유료 매장은 '남길 매장' 후보가 아니다. 고르게 두면 선택이 무효로 판정돼
  //   고른 뒤에도 계속 다시 물어보는 상태가 된다.
  const { error: eNotFree } = await O.c.rpc('choose_kept_store', { p_unit: S2 });
  check('★유료 매장 선택 거부(unit_not_free)', /unit_not_free/.test(eNotFree?.message ?? ''), eNotFree?.message ?? '선택돼버림');
  const { data: freeList2 } = await O.c.rpc('my_free_units');
  check('★결제한 매장은 후보 목록에서 빠진다', (freeList2 ?? []).length === 1, JSON.stringify(freeList2));

  // 좌석도 함께 풀린다 — 유료 매장은 좌석 무제한(0117)이라 선택 명단이 있어도 잠기지 않는다.
  await svcRpc('admin_activate_store', { p_unit_id: S1, p_days: 30, p_plan: 'multi' });
  const { data: sl4 } = await staff[4].c.rpc('my_seat_locked');
  check('★⑦ 결제하면 못 고른 직원도 그대로 돌아온다', sl4 === false, `locked=${sl4}`);

  // ── ⑨⑩ 화면 축 — 요금제 경로와 금액 SSOT (소스 정적 검사) ────────────────
  //   서버로는 증명할 수 없는 두 가지다. 브라우저 검증의 사전 조건이라 여기서 먼저 고정한다.
  const src = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
  const dg = src('src/app/downgrade.tsx');
  const bl = src('src/app/billing.tsx');
  check('★⑨ /downgrade 화면이 존재한다', dg.length > 0, `${dg.length} bytes`);
  check('★⑨ 갈림길에서 요금제를 고르면 /billing 으로 요금제·매장수가 실려 간다',
    /\/billing\?plan=/.test(dg) && /stores=/.test(dg), '');
  check('★⑨ /billing 이 그 값을 받아 미리 선택된 상태로 착지한다',
    /useLocalSearchParams/.test(bl) && /plan/.test(bl) && /stores/.test(bl), '');
  // ⑩ 표시가는 **공급가액 + '부가세 별도'**(제품 전체 규칙)라 이 화면은 planMonthlyPrice 만 쓴다.
  //    실제 입금액(withVat)은 /billing 이 말한다 — 두 화면이 같은 숫자를 두 번 말하지 않게.
  check('★⑩ 화면이 금액을 tiers.ts 로 계산한다', /planMonthlyPrice/.test(dg), '');
  check('★⑩ 입금액(부가세 포함)은 /billing 이 tiers.ts 로 계산한다', /withVat/.test(bl), '');
  // ★빈 파일에서 "숫자가 없다"가 통과하면 안 된다 — 건너뛴 것을 통과로 세지 않는다(AGENTS).
  check('★⑩ 화면에 금액 숫자 사본이 없다', dg.length > 0 && !/\b(19000|29000|20900|31900|87000)\b/.test(dg), '');
  check('★⑩ 부가세 문구도 SSOT 에서 가져온다', /VAT_NOTE_SENTENCE/.test(dg), '');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error('\n✗ 중단:', e.message); fail++; })
  .finally(async () => {
    for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* */ } }
    try { await cleanupSeededPhones(URL, SERVICE, seededPhones); } catch { /* */ }
    if (originalTrialDays !== null) {
      try {
        const back = await setSignupTrialDays(originalTrialDays);
        console.log(`  … 가입 프로모션 원복: signup_trial_days=${back}`);
      } catch { console.error('  !! 원복 실패 — app_config.signup_trial_days 수동 확인 필요'); fail++; }
    }
    console.log('  … 정리 완료');
    console.log(`FINAL: ${pass} passed, ${fail} failed`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
