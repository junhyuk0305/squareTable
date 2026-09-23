// qa-brand.mjs — 본사(브랜드) 축 P2 조직 하니스: 초대 → 수락 → 보기 → 수준 변경 → payer → 해제 (2026-09-22)
//
// 고정 계정만 쓴다(메모리 feedback_qa_use_fixed_accounts): 사장 owner@pilot… · 직원 staff2@pilot… · 본사 hq@pilot…
// 전제: 0209~0212 push + `node scripts/seed-brand-demo.mjs`. 끝나면 시드 상태(store_001 ↔ brand_pilot, summary)로 되돌린다.
//
// 재는 것:
//   A 수락 전 brand_overview 에 그 매장 0행 · 초대 목록에 대기 표시
//   B 점주 my_brand_invites 에 카드 · 수락(요약) → active · 이미 연결된 매장 재수락 거부
//   C 요약 수준: 요약 컬럼 채워짐 · 운영 컬럼 null · 노하우 본문 0행
//   D 운영 공개로 올리면 즉시 본문·질문 열림 · 요약으로 내리면 즉시 닫힘(캐시 없음)
//   E 본사 상향 요청 → 점주 화면에 표시 / payer 제안 → 상대 수락 → 반영
//   F 해제 → brand_overview 0행 · 이력 행은 ended 로 남음
//   G 미연결·다른 브랜드 매장은 어디에도 없음 · 담당자 my_units 0(작업실 안 섞임)
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
// ★대상 DB = .env 의 EXPO_PUBLIC_SUPABASE_URL(라이브). QA_* 를 보지 않는다 — 고정 계정이 거기 있다.
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const PW = 'pilot1234';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';
const HQ = 'hq@pilot.squaretable.app';
const BRAND = 'brand_pilot';
const UNIT = 'store_001';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(email) {
  const c = mk();
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return c;
}
const errCode = (e) => (e?.message ?? '').split(/[\s:]/)[0];

// 시드 상태로 되돌리기(service_role) — store_001 ↔ brand_pilot active·summary·payer=brand, 대기 초대 0.
async function restore(ownerId) {
  await svc.from('brand_invites').delete().eq('brand_id', BRAND).eq('kind', 'store').eq('status', 'pending');
  // 0213 알림 행(brand_*)은 하니스가 만든 것만 지운다 — 좌석·AI 알림은 건드리지 않는다.
  await svc.from('owner_alerts').delete().eq('unit_id', UNIT).like('kind', 'brand_%');
  const { data: cur } = await svc.from('brand_units').select('id, brand_id').eq('unit_id', UNIT).eq('status', 'active').maybeSingle();
  if (cur && cur.brand_id === BRAND) {
    await svc.from('brand_units').update({ payer: 'brand', visibility: 'summary', payer_proposed: null, payer_proposed_by: null, visibility_requested: null }).eq('id', cur.id);
    return;
  }
  if (cur) await svc.from('brand_units').update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'qa_restore' }).eq('id', cur.id);
  await svc.from('brand_units').insert({ brand_id: BRAND, unit_id: UNIT, payer: 'brand', visibility: 'summary', accepted_by: ownerId });
}

let ownerId = null;
try {
  const O = await login(OWNER);
  const H = await login(HQ);
  const J = await login(JUNIOR);
  ownerId = (await O.auth.getUser()).data.user.id;
  const { data: prof } = await svc.from('profiles').select('phone').eq('id', ownerId).maybeSingle();
  const ownerPhone = prof?.phone ?? '';
  check('setup: 사장 전화번호가 있다', !!ownerPhone, '없으면 초대를 못 보낸다');

  // ── A 수락 전 ───────────────────────────────────────────────────────────
  console.log('\nA 수락 전');
  // 연결을 끊어 "수락 전" 상태를 만든다(서비스 롤).
  await svc.from('brand_units').update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'qa_setup' }).eq('unit_id', UNIT).eq('status', 'active');
  await svc.from('brand_invites').delete().eq('brand_id', BRAND).eq('kind', 'store').eq('status', 'pending');
  let ov = await H.rpc('brand_overview');
  check('A1 수락 전 brand_overview 에 store_001 없음', !ov.error && !(ov.data ?? []).some((r) => r.unit_id === UNIT), ov.error?.message);
  const inv = await H.rpc('brand_invite_store', { p_phone: ownerPhone, p_payer: 'brand' });
  check('A2 본사가 전화번호로 초대', !inv.error && typeof inv.data === 'string', inv.error?.message);
  const dup = await H.rpc('brand_invite_store', { p_phone: ownerPhone, p_payer: 'brand' });
  check('A3 같은 번호 중복 초대 거부(invite_exists)', errCode(dup.error) === 'invite_exists', dup.error?.message);
  const list = await H.rpc('brand_invites_list');
  check('A4 초대 목록에 대기(pending) 표시', (list.data ?? []).some((r) => r.id === inv.data && r.status === 'pending'), list.error?.message);
  const jInv = await J.rpc('brand_invite_store', { p_phone: ownerPhone, p_payer: 'brand' });
  check('A5 담당자 아닌 계정의 초대 거부', errCode(jInv.error) === 'not_brand_member', jInv.error?.message);

  // ── B 점주 수락 ─────────────────────────────────────────────────────────
  console.log('\nB 점주 수락');
  const mine = await O.rpc('my_brand_invites');
  check('B1 점주에게 카드가 온다(my_brand_invites)', (mine.data ?? []).some((r) => r.invite_id === inv.data && r.brand_name), mine.error?.message);
  const jMine = await J.rpc('my_brand_invites');
  check('B2 직원(다른 번호)에겐 안 온다', !jMine.error && (jMine.data ?? []).length === 0);
  const jResp = await J.rpc('respond_brand_invite', { p_invite_id: inv.data, p_unit_ids: [UNIT], p_visibility: 'summary', p_accept: true });
  check('B3 초대받지 않은 사람의 수락 거부(not_invitee)', errCode(jResp.error) === 'not_invitee', jResp.error?.message);
  const acc = await O.rpc('respond_brand_invite', { p_invite_id: inv.data, p_unit_ids: [UNIT], p_visibility: 'summary', p_accept: true });
  check('B4 점주 수락(요약 공개)', !acc.error, acc.error?.message);
  const again = await H.rpc('brand_invite_store', { p_phone: ownerPhone, p_payer: 'brand' });
  const accAgain = again.data ? await O.rpc('respond_brand_invite', { p_invite_id: again.data, p_unit_ids: [UNIT], p_visibility: 'summary', p_accept: true }) : { error: { message: 'no_invite' } };
  check('B5 이미 연결된 매장 재수락 거부(already_connected)', errCode(accAgain.error) === 'already_connected', accAgain.error?.message);
  if (again.data) await svc.from('brand_invites').delete().eq('id', again.data);
  const view = await O.rpc('my_brand_view');
  const vrow = (view.data ?? []).find((r) => r.unit_id === UNIT);
  check('B6 점주 설정 화면 재료(my_brand_view) = active·summary·payer=brand', !!vrow && vrow.visibility === 'summary' && vrow.payer === 'brand', JSON.stringify(vrow));

  // ── C 요약 수준 ─────────────────────────────────────────────────────────
  console.log('\nC 요약 수준');
  ov = await H.rpc('brand_overview');
  const row = (ov.data ?? []).find((r) => r.unit_id === UNIT);
  check('C1 수락 후 brand_overview 에 store_001', !!row, ov.error?.message);
  check('C2 요약 컬럼 채워짐(staff·knowhow_own·pending_q·ai_used)', !!row && [row.staff, row.knowhow_own, row.pending_q, row.ai_used].every((v) => typeof v === 'number'), JSON.stringify(row));
  check('C3 운영 컬럼 null(tasks_done_30d·quiz_courses)', !!row && row.tasks_done_30d === null && row.quiz_courses === null, JSON.stringify(row));
  const ent0 = await H.rpc('brand_unit_entries', { p_unit_id: UNIT });
  check('C4 요약 수준에서 노하우 본문 0행', !ent0.error && (ent0.data ?? []).length === 0, ent0.error?.message);
  const q0 = await H.rpc('brand_unit_questions', { p_unit_id: UNIT });
  check('C5 요약 수준에서 질문 내용 0행', !q0.error && (q0.data ?? []).length === 0, q0.error?.message);

  // ── D 수준 상향·하향 즉시 반영 ──────────────────────────────────────────
  console.log('\nD 공개 수준 즉시 반영');
  const hqSet = await H.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  check('D1 본사는 공개 수준을 직접 못 바꾼다(not_owner)', errCode(hqSet.error) === 'not_owner', hqSet.error?.message);
  const up = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  check('D2 점주가 운영 공개로 올림', !up.error, up.error?.message);
  const ent1 = await H.rpc('brand_unit_entries', { p_unit_id: UNIT });
  check('D3 즉시 노하우 본문이 열린다(>0행, store_001 은 시드에 노하우 있음)', !ent1.error && (ent1.data ?? []).length > 0, ent1.error?.message ?? `${(ent1.data ?? []).length}행`);
  check('D4 본문 행에 작성자 이름·사진이 없다', !ent1.error && (ent1.data ?? []).every((r) => !('creator_name' in r) && !('photos' in r)));
  ov = await H.rpc('brand_overview');
  const row2 = (ov.data ?? []).find((r) => r.unit_id === UNIT);
  check('D5 운영 컬럼이 숫자로 채워진다', !!row2 && typeof row2.tasks_done_30d === 'number' && typeof row2.quiz_courses === 'number', JSON.stringify(row2));
  const q1 = await H.rpc('brand_unit_questions', { p_unit_id: UNIT });
  check('D6 질문 내용에 발화자 식별 컬럼이 없다', !q1.error && (q1.data ?? []).every((r) => !('junior_id' in r) && !('junior_name' in r)), q1.error?.message);
  const down = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'summary' });
  const ent2 = await H.rpc('brand_unit_entries', { p_unit_id: UNIT });
  check('D7 요약으로 내리면 즉시 0행(캐시 없음)', !down.error && !ent2.error && (ent2.data ?? []).length === 0, down.error?.message ?? ent2.error?.message);

  // ── E 상향 요청 · payer 제안 ─────────────────────────────────────────────
  console.log('\nE 상향 요청 · payer');
  const req = await H.rpc('request_visibility', { p_unit_id: UNIT, p_visibility: 'knowhow' });
  const view2 = await O.rpc('my_brand_view');
  check('E1 본사 상향 요청이 점주 화면 재료에 뜬다', !req.error && (view2.data ?? []).find((r) => r.unit_id === UNIT)?.visibility_requested === 'knowhow', req.error?.message);
  const okUp = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'knowhow' });
  const view3 = await O.rpc('my_brand_view');
  check('E2 요청대로 올리면 요청 표시가 지워진다', !okUp.error && (view3.data ?? []).find((r) => r.unit_id === UNIT)?.visibility_requested === null);
  const prop = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  const view4 = await O.rpc('my_brand_view');
  const v4 = (view4.data ?? []).find((r) => r.unit_id === UNIT);
  check('E3 본사가 payer=store 제안 → 점주에게 제안 표시(내 제안 아님)', !prop.error && v4?.payer_proposed === 'store' && v4?.payer_proposed_by_me === false, prop.error?.message);
  const selfAcc = await H.rpc('accept_payer', { p_unit_id: UNIT, p_accept: true });
  check('E4 제안한 쪽이 스스로 수락 못 함(not_allowed)', errCode(selfAcc.error) === 'not_allowed', selfAcc.error?.message);
  const accP = await O.rpc('accept_payer', { p_unit_id: UNIT, p_accept: true });
  ov = await H.rpc('brand_overview');
  check('E5 점주 수락 → payer=store 반영·제안 비움', !accP.error && (ov.data ?? []).find((r) => r.unit_id === UNIT)?.payer === 'store' && (ov.data ?? []).find((r) => r.unit_id === UNIT)?.payer_proposed === null, accP.error?.message);
  const same = await O.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  check('E6 같은 payer 제안 거부(same_payer)', errCode(same.error) === 'same_payer', same.error?.message);

  // ── F 해제 ──────────────────────────────────────────────────────────────
  console.log('\nF 해제');
  const jEnd = await J.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa' });
  check('F1 직원은 해제 못 함(not_allowed)', errCode(jEnd.error) === 'not_allowed', jEnd.error?.message);
  const end = await O.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa' });
  ov = await H.rpc('brand_overview');
  check('F2 점주 해제 → brand_overview 에서 즉시 사라짐', !end.error && !(ov.data ?? []).some((r) => r.unit_id === UNIT), end.error?.message);
  const entEnd = await H.rpc('brand_unit_entries', { p_unit_id: UNIT });
  check('F3 해제 후 본문 0행(수준이 knowhow 였어도)', !entEnd.error && (entEnd.data ?? []).length === 0);
  const { data: hist } = await svc.from('brand_units').select('status, end_reason').eq('unit_id', UNIT).eq('brand_id', BRAND).order('created_at', { ascending: false }).limit(1);
  check('F4 이력 행이 ended 로 남는다', hist?.[0]?.status === 'ended' && hist?.[0]?.end_reason === 'qa');
  const { data: ev } = await svc.from('brand_events').select('kind').eq('brand_id', BRAND).in('kind', ['store_invited', 'unit_connected', 'visibility_changed', 'payer_proposed', 'payer_changed', 'unit_ended']).gte('at', new Date(Date.now() - 5 * 60_000).toISOString());
  const kinds = new Set((ev ?? []).map((r) => r.kind));
  check('F5 감사 로그 6종이 남았다', ['store_invited', 'unit_connected', 'visibility_changed', 'payer_proposed', 'payer_changed', 'unit_ended'].every((k) => kinds.has(k)), [...kinds].join(','));

  // ── G 미연결·다른 브랜드·작업실 ─────────────────────────────────────────
  console.log('\nG 미연결 · 다른 브랜드 · 작업실');
  check('G1 다른 브랜드 매장(store_002_demo)이 안 보인다', !(ov.data ?? []).some((r) => r.unit_id === 'store_002_demo'));
  const mu = await H.rpc('my_units');
  check('G2 담당자 my_units 0(작업실이 매장으로 안 샘)', !mu.error && (mu.data ?? []).length === 0, mu.error?.message);
  const omu = await O.rpc('my_units');
  check('G3 사장 my_units 에 작업실(ws_*) 없음', !omu.error && !(omu.data ?? []).some((r) => String(r.unit_id).startsWith('ws_')));
  const jov = await J.rpc('brand_overview');
  check('G4 직원의 brand_overview 0행', !jov.error && (jov.data ?? []).length === 0, jov.error?.message);
  const own = await H.rpc('brand_connect_own_unit', { p_unit_id: UNIT, p_payer: 'brand' });
  check('G5 담당자가 남의 매장을 직영으로 못 붙인다(not_owner)', errCode(own.error) === 'not_owner', own.error?.message);

  // ── H 점주 알림 4종(0213 owner_alerts) + 상향 요청 '유지' 응답 ──────────────
  // 위 A2(초대)·E1(상향 요청)·E3(본사 payer 제안)이 남긴 행을 읽고, 본사 해제·유지 응답은 여기서 만든다.
  console.log('\nH 점주 알림(0213)');
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const alertsOf = async (kind) => (await svc.from('owner_alerts').select('id, kind, period, title').eq('unit_id', UNIT).eq('kind', kind).gte('created_at', since)).data ?? [];
  const hInv = await alertsOf('brand_invite');
  check('H1 초대 → 점주 매장에 brand_invite 알림(사건 = 초대 id)', hInv.some((a) => a.period === inv.data && a.title.includes('연결을 요청')), JSON.stringify(hInv));
  const hVis = await alertsOf('brand_visibility_request');
  check('H2 상향 요청 → brand_visibility_request 알림', hVis.length >= 1 && hVis[0].title.includes('공개 수준'), JSON.stringify(hVis));
  const hPay = await alertsOf('brand_payer_proposal');
  check('H3 본사 payer 제안 → brand_payer_proposal 알림', hPay.length >= 1 && hPay[0].title.includes('요금 부담'), JSON.stringify(hPay));
  const oAl = await O.from('owner_alerts').select('kind').eq('unit_id', UNIT).like('kind', 'brand_%');
  check('H4 점주(사장)는 자기 매장 알림을 읽는다(RLS)', !oAl.error && (oAl.data ?? []).length >= 3, oAl.error?.message ?? `${(oAl.data ?? []).length}행`);
  const jAl = await J.from('owner_alerts').select('kind').eq('unit_id', UNIT);
  check('H5 직원은 0행(RLS)', !jAl.error && (jAl.data ?? []).length === 0);
  // 연결을 되살려 '유지' 응답과 본사 해제를 잰다.
  await restore(ownerId);
  const req2 = await H.rpc('request_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  const keep = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'summary' });
  const viewK = await O.rpc('my_brand_view');
  const rowK = (viewK.data ?? []).find((r) => r.unit_id === UNIT);
  check('H6 점주가 지금 수준을 고르면(유지) 요청이 닫힌다', !req2.error && !keep.error && rowK?.visibility === 'summary' && rowK?.visibility_requested === null, req2.error?.message ?? keep.error?.message ?? JSON.stringify(rowK));
  const oProp = await O.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  const hPay2 = await alertsOf('brand_payer_proposal');
  // restore() 가 하니스 알림을 지운 뒤라 기준선은 0행 — 점주 제안 뒤에도 0행이어야 한다.
  check('H7 점주 자신의 payer 제안은 점주 알림을 만들지 않는다', !oProp.error && hPay2.length === 0, oProp.error?.message ?? `${hPay2.length}행`);
  const hqEnd = await H.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa_hq' });
  const hEnd = await alertsOf('brand_ended');
  check('H8 본사 해제 → brand_ended 알림', !hqEnd.error && hEnd.length === 1 && hEnd[0].title.includes('연결이 끝났'), hqEnd.error?.message ?? JSON.stringify(hEnd));
  const ovEnd = await H.rpc('brand_overview');
  check('H9 본사 해제 뒤 brand_overview 0행', !(ovEnd.data ?? []).some((r) => r.unit_id === UNIT));

  await O.auth.signOut(); await H.auth.signOut(); await J.auth.signOut();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 300));
}
if (ownerId) await restore(ownerId);
console.log(`\n── 결과 ── pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
