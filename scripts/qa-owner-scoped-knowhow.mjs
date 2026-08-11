// 계정 스코프 노하우 QA(0121) — definer 읽기·쓰기 RPC 의 **소유 경계**를 실 백엔드로 실증한다.
//
// ★이 스크립트의 존재 이유는 하나다: `owner_insert_knowhow` 의 소유 검사 한 줄이 살아 있는가.
//   그 줄이 빠지면 **남의 매장에 쓰는 구멍**이 된다(RLS 를 우회하는 definer 쓰기 경로다).
//   그래서 "되는 것"보다 **"안 되는 것"**을 먼저·더 많이 센다.
//
// 커버:
//   ① 읽기: 소유 매장 전체가 매장별로 온다(활성 매장 하나가 아니다) · 남의 매장은 0행
//   ② 쓰기: 내 비활성 매장에 쓰기 성공 + **활성 매장이 안 바뀐다**(이게 §4-1 의 요구다)
//   ③ 크로스테넌트: 남의 매장 unit_id 로 쓰기 → not_owner 거부
//   ④ 본문이 대상을 못 정한다: p_entry.unit_id 로 남의 매장을 적어도 p_unit_id 가 이긴다
//   ⑤ 저자 위조 불가: p_entry.creator_id 를 남으로 적어도 auth.uid() 로 덮인다
//   ⑥ 직원(사장 아님)은 자기 매장에도 이 RPC 로 못 쓴다(소유 검사는 멤버십이 아니다)
//   ⑦ not null 컬럼 기본값: 최소 필드만 보내도 저장된다(defaults 병합이 살아 있나)
//
// 실 백엔드 대상·자가정리(@example.com → cleanup-orphan-stores.mjs 수거).
// 사용: node scripts/qa-owner-scoped-knowhow.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const PW = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const qaPhones = [`0111${s.slice(0, 7)}`, `0112${s.slice(0, 7)}`, `0113${s.slice(0, 7)}`];

/** 최소 필드 노하우 — not null 컬럼의 기본값 병합이 살아 있는지도 이걸로 본다(⑦). */
const minEntry = (id, title) => ({
  id, category: 'Know-how', title,
  square: { situation: `${title} 하는 법이에요`, action: { steps: [] }, extract: { do: '', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
});

/** 활성 매장 읽기 — 쓰기가 활성 매장을 건드리지 않았는지 확인하는 데 쓴다. */
async function activeUnitOf(uid) {
  const { data } = await admin.from('profiles').select('active_unit_id').eq('id', uid).single();
  return data?.active_unit_id ?? null;
}

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);

  // ── 셋업: 사장 A(매장 2개) · 사장 B(매장 1개) · A매장 직원 ────────────────
  console.log('\n━━ 셋업 ━━');
  const A = mk();
  const aId = await signUpSession(A, `qa_osk_a_${s}@example.com`, { name: 'QA사장A', role: 'owner', phone: qaPhones[0], store_name: 'OSK', industry: '카페·디저트' });
  const { data: a1, error: e1 } = await A.rpc('create_store', { p_store_name: 'OSK 1호점', p_industry: '카페·디저트', p_biz_no: null });
  if (e1) throw new Error('create_store A1: ' + e1.message);
  const A1 = a1?.[0]?.unit_id;
  const A1CODE = a1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: A1, p_days: 1, p_plan: 'multi' });
  // ★0130: 2번째+ 매장은 **매장 슬롯**을 소비한다(없으면 no_store_slot).
  //   승인(review_payment_claim)이 적립하는 것과 같은 행을 셋업에서 직접 넣는다.
  {
    const { data: me } = await A.auth.getUser();
    const { error } = await admin.from('store_slots').insert({ owner_id: me?.user?.id, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() });
    if (error) throw new Error('store_slot 적립: ' + error.message);
  }
  const { data: a2, error: e2 } = await A.rpc('create_store', { p_store_name: 'OSK 2호점', p_industry: '카페·디저트', p_biz_no: null });
  if (e2) throw new Error('create_store A2: ' + e2.message);
  const A2 = a2?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: A2, p_days: 1, p_plan: 'multi' });
  // 활성 매장을 1호점으로 못박는다 — "비활성 매장에 쓴다"가 이 QA 의 핵심이다.
  await A.rpc('switch_active_unit', { p_unit_id: A1 });
  check('사장A 매장 2개', !!A1 && !!A2 && A1 !== A2, `A1=${A1} A2=${A2}`);
  check('활성 매장 = 1호점', (await activeUnitOf(aId)) === A1);

  const B = mk();
  await signUpSession(B, `qa_osk_b_${s}@example.com`, { name: 'QA사장B', role: 'owner', phone: qaPhones[1], store_name: 'OSK-B', industry: '카페·디저트' });
  const { data: b1, error: e3 } = await B.rpc('create_store', { p_store_name: 'OSK 남의매장', p_industry: '카페·디저트', p_biz_no: null });
  if (e3) throw new Error('create_store B1: ' + e3.message);
  const B1 = b1?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: B1, p_days: 1, p_plan: 'single' });
  await B.rpc('switch_active_unit', { p_unit_id: B1 });
  check('사장B 매장 1개(격리 상대)', !!B1, `B1=${B1}`);

  const J = mk();
  const jId = await signUpSession(J, `qa_osk_j_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: qaPhones[2] });
  await J.rpc('join_by_invite', { p_code: A1CODE });
  const { error: ape } = await A.rpc('approve_member', { p_uid: jId });
  check('A1 직원 합류 승인', !ape, ape?.message ?? '');
  await J.rpc('switch_active_unit', { p_unit_id: A1 });

  // ── ② 쓰기: 내 비활성 매장(2호점)에 쓰기 ─────────────────────────────────
  console.log('\n━━ ② 쓰기 — 내 비활성 매장 ━━');
  const idA2 = `pb_osk_a2_${s}`;
  const { data: wrote, error: we } = await A.rpc('owner_insert_knowhow', { p_unit_id: A2, p_entry: minEntry(idA2, '2호점 마감') });
  check('내 비활성 매장에 쓰기 성공', !we && wrote === idA2, we?.message ?? `id=${wrote}`);
  check('★활성 매장이 안 바뀐다(전환 없이 썼다)', (await activeUnitOf(aId)) === A1, `active=${await activeUnitOf(aId)}`);
  const { data: rowA2 } = await admin.from('playbook_entries').select('unit_id, status, creator_id, tags, version, needs_review, order_index').eq('id', idA2).single();
  check('⑦ not null 기본값 병합(최소 필드로 저장됨)',
    !!rowA2 && rowA2.unit_id === A2 && rowA2.status === 'published' && Array.isArray(rowA2.tags)
      && rowA2.version === 1 && rowA2.needs_review === false && rowA2.order_index === 0,
    JSON.stringify(rowA2));
  check('⑤ 저자 = 호출자(auth.uid())', rowA2?.creator_id === aId);

  // 활성 매장(1호점)에도 같은 RPC 가 통한다 — 다만 앱은 이 경로를 안 쓴다(RLS 경로가 정본).
  const idA1 = `pb_osk_a1_${s}`;
  const { error: we2 } = await A.rpc('owner_insert_knowhow', { p_unit_id: A1, p_entry: minEntry(idA1, '1호점 오픈') });
  check('내 활성 매장에도 쓰기 성공', !we2, we2?.message ?? '');

  // ── ③④ 크로스테넌트: 남의 매장에 못 쓴다 ────────────────────────────────
  console.log('\n━━ ③④ 크로스테넌트(쓰기 차단) ━━');
  const { error: xe } = await A.rpc('owner_insert_knowhow', { p_unit_id: B1, p_entry: minEntry(`pb_osk_x1_${s}`, '남의 매장 침투') });
  check('★남의 매장 unit_id 로 쓰기 차단', !!xe && /not_owner/.test(xe.message ?? ''), xe?.message ?? '거부 안 됨(구멍!)');
  const { count: xc } = await admin.from('playbook_entries').select('id', { count: 'exact', head: true }).eq('id', `pb_osk_x1_${s}`);
  check('  └ 실제로 행이 안 생겼다', (xc ?? 0) === 0, `n=${xc}`);

  // 본문이 대상을 정할 수 있으면 소유 검사를 통과한 뒤 다른 매장에 쓰는 우회로가 된다.
  const idBypass = `pb_osk_x2_${s}`;
  const { error: be } = await A.rpc('owner_insert_knowhow', {
    p_unit_id: A2,
    p_entry: { ...minEntry(idBypass, '본문으로 대상 바꾸기'), unit_id: B1 },
  });
  const { data: rowBypass } = await admin.from('playbook_entries').select('unit_id').eq('id', idBypass).single();
  check('★본문 unit_id 가 대상을 못 바꾼다(인자가 이긴다)', !be && rowBypass?.unit_id === A2, `${be?.message ?? ''} unit=${rowBypass?.unit_id}`);

  const idForge = `pb_osk_x3_${s}`;
  await A.rpc('owner_insert_knowhow', { p_unit_id: A2, p_entry: { ...minEntry(idForge, '저자 위조'), creator_id: jId } });
  const { data: rowForge } = await admin.from('playbook_entries').select('creator_id').eq('id', idForge).single();
  check('★본문 creator_id 위조 불가', rowForge?.creator_id === aId, `creator=${rowForge?.creator_id}`);

  // ── ⑥ 직원은 소유자가 아니다 ────────────────────────────────────────────
  console.log('\n━━ ⑥ 직원(멤버십은 있으나 소유 아님) ━━');
  const { error: je } = await J.rpc('owner_insert_knowhow', { p_unit_id: A1, p_entry: minEntry(`pb_osk_x4_${s}`, '직원이 쓰기') });
  check('★직원은 자기 매장에도 이 RPC 로 못 쓴다', !!je && /not_owner/.test(je.message ?? ''), je?.message ?? '거부 안 됨(구멍!)');

  // ── /cso M1·M2: 실패 모드가 우리 말로 나오는가(원시 Postgres 에러가 새지 않는가) ──
  console.log('\n━━ 실패 모드(/cso M1·M2) ━━');
  const { error: badE } = await A.rpc('owner_insert_knowhow', { p_unit_id: A2, p_entry: [] });
  check('M1 본문이 객체가 아니면 bad_entry', !!badE && /bad_entry/.test(badE.message ?? ''), badE?.message ?? '거부 안 됨');
  const { error: catE } = await A.rpc('owner_insert_knowhow', { p_unit_id: A2, p_entry: { id: `pb_osk_x5_${s}`, title: '분류 없음' } });
  check('M2 category 누락이면 missing_category', !!catE && /missing_category/.test(catE.message ?? ''), catE?.message ?? '거부 안 됨');
  const { error: idE } = await A.rpc('owner_insert_knowhow', { p_unit_id: A2, p_entry: { category: 'Know-how', title: 'id 없음' } });
  check('id 누락이면 missing_id', !!idE && /missing_id/.test(idE.message ?? ''), idE?.message ?? '거부 안 됨');

  const { data: jr } = await J.rpc('owner_knowhow_entries');
  check('★직원이 읽기 RPC 를 호출해도 0행', (jr ?? []).length === 0, `n=${(jr ?? []).length}`);

  // ── ① 읽기: 소유 매장 전체가 온다 ───────────────────────────────────────
  console.log('\n━━ ① 읽기 — 계정 스코프 ━━');
  const { data: ar, error: are } = await A.rpc('owner_knowhow_entries');
  const units = new Set((ar ?? []).map((r) => r.unit_id));
  check('사장A 읽기 성공', !are, are?.message ?? '');
  check('★활성 매장 하나가 아니라 소유 매장 전체가 온다', units.has(A1) && units.has(A2), `units=${[...units].join(',')}`);
  check('★남의 매장은 안 온다', !units.has(B1), `units=${[...units].join(',')}`);

  const { data: br } = await B.rpc('owner_knowhow_entries');
  const bUnits = new Set((br ?? []).map((r) => r.unit_id));
  check('★사장B 는 A 의 매장을 못 본다', !bUnits.has(A1) && !bUnits.has(A2), `units=${[...bUnits].join(',')}`);

  // 초안은 넘기지 않는다(허브는 훑어보는 층, 검수는 매장 앱 담당).
  const idDraft = `pb_osk_d_${s}`;
  await admin.from('playbook_entries').insert({ ...minEntry(idDraft, '초안'), unit_id: A2, creator_id: aId, status: 'draft' });
  const { data: ar2 } = await A.rpc('owner_knowhow_entries');
  check('초안(draft)은 허브 목록에 안 온다', !(ar2 ?? []).some((r) => r.id === idDraft));

  // ── 정리 ────────────────────────────────────────────────────────────────
  console.log('\n━━ 정리 ━━');
  for (const c of [A, B, J]) { const { error } = await c.rpc('delete_my_account'); if (error) console.log('  ! delete_my_account:', error.message); }
  await cleanupSeededPhones(URL_, SRV, qaPhones);
  console.log('  ✓ 계정·매장 정리 요청 완료');

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 계정 스코프 노하우(0121) QA · 통과 ${pass} / 실패 ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error('\n❌ 예외:', e.message); process.exitCode = 2; });
