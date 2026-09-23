// qa-brand-relation.mjs — 본사(브랜드) 축 P9 하니스: 직영·가맹 권한 모델 (2026-09-23)
//
// 정본 = 기획/본사대시보드/02_직영가맹_권한모델_2026-09-23.md §4 항목표 · §5 하한 · §8 전환 · §9 혼합 배포.
// 지시서 = 루트 메가프롬프트_본사대시보드_P9_직영가맹_2026-09-23.md §3-4.
//
// ★이 하니스가 재는 것은 **"화면이 실수해도 막히나"** 다. 그래서 대부분의 케이스가
//   service_role 직접 UPDATE(=화면·RPC 를 통째로 건너뛴 경로)로 CHECK 제약을 때린다(정본 §2 ③).
//
// ★개인 축은 관계와 무관하게 0행이어야 한다(정본 §3) — 직영이어도 예외 없음. §H 가 그것만 잰다.
//
// 전제: seed-brand-demo.mjs 상태(store_001 ↔ brand_pilot · 가맹 · 요약 공개).
//   ⛔계정을 새로 만들지 않는다(고정 QA 계정 2축). 상태는 바꾸지만 **끝에 반드시 되돌린다**(restore).
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
const HQ = 'hq@pilot.squaretable.app';
const OWNER = 'owner@pilot.squaretable.app';
const JUNIOR = 'staff2@pilot.squaretable.app';
const BRAND = 'brand_pilot';
const UNIT = 'store_001';
/** 이 하니스가 만들고 지우는 사본 픽스처 — 시드에 없던 행이라 restore 가 아니라 직접 지운다. */
const COPY_FIXTURE = 'qa_rel_copy';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
/** raise exception 이름으로 거부됐나. 메시지 앞머리로 판정한다(0213~0225 규약). */
const refused = (r, code) => !!r.error && String(r.error.message).includes(code);
/** CHECK 제약(23514)으로 막혔나 — 화면·RPC 를 건너뛴 경로가 DB 에서 죽는 것을 잰다. */
const checkViolation = (r, name) => !!r.error && (r.error.code === '23514' || String(r.error.message).includes(name));

async function login(email) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return c;
}
const svc = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const row = async () =>
  (await svc.from('brand_units').select('*').eq('unit_id', UNIT).eq('status', 'active').maybeSingle()).data;

/** 시드 상태로 되돌린다 — 가맹 · 요약 · 직영 전용 값 전부 기본 · 동의 대기 없음. */
async function restore() {
  // ★순서가 있다: relation 을 franchise 로 되돌리려면 직영 전용 값이 먼저 기본값이어야 한다
  //   (CHECK ① 이 같은 UPDATE 안에서 평가되므로 한 문장에 다 넣는다).
  await svc.from('brand_units').update({
    relation: 'franchise', visibility: 'summary', visibility_floor: 'summary',
    owner_can_end: true, content_required: false, consent_kind: 'consent', consent_pending: false,
  }).eq('unit_id', UNIT).eq('status', 'active');
  await svc.from('owner_alerts').delete().eq('unit_id', UNIT)
    .in('kind', ['brand_relation_changed', 'brand_floor_changed']);
  await svc.from('playbook_entries').delete().eq('id', COPY_FIXTURE);
}

try {
  const H = await login(HQ);
  const O = await login(OWNER);
  const J = await login(JUNIOR);
  await restore();

  // ── A. 가맹에서는 직영 전용 값이 설 수 없다(정본 §6 CHECK ①) ─────────────
  // ★service_role 직접 UPDATE 다. 화면도 RPC 도 거치지 않는다 — 그래도 막혀야 법적 경계다.
  console.log('\nA 가맹 × 직영 전용 값 — DB 가 거부한다');
  for (const [col, val] of [['visibility_floor', 'ops'], ['owner_can_end', false], ['content_required', true]]) {
    const r = await svc.from('brand_units').update({ [col]: val }).eq('unit_id', UNIT).eq('status', 'active').select();
    check(`A1 가맹에 ${col} 설정 거부`, checkViolation(r, 'brand_units_franchise_limits'),
      r.error ? `${r.error.code} ${r.error.message}` : `통과됨(행 ${(r.data ?? []).length})`);
  }
  check('A2 세 값이 그대로 기본값이다', await (async () => {
    const b = await row();
    return b.visibility_floor === 'summary' && b.owner_can_end === true && b.content_required === false;
  })(), JSON.stringify(await row()));

  // ── B. 하한 — 실제 수준은 언제나 하한 이상(CHECK ②) ─────────────────────
  console.log('\nB 공개 수준 하한');
  await svc.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'direct', p_reason: 'qa:brand-relation' });
  check('B1 직영 전환 뒤에도 하한은 summary 다(자동으로 안 켠다 · §8)', (await row()).visibility_floor === 'summary');
  const floorUp = await H.rpc('set_visibility_floor', { p_unit_id: UNIT, p_floor: 'ops' });
  check('B2 본사가 직영의 하한을 올린다', !floorUp.error, floorUp.error?.message);
  check('B3 하한이 실제 수준을 끌어올린다(요약 → 운영 공개)', (await row()).visibility === 'ops', JSON.stringify(await row()));
  const down = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'summary' });
  check('B4 점장이 하한 아래로 내리면 below_floor', refused(down, 'below_floor'), down.error?.message ?? '통과됨');
  const same = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'ops' });
  check('B5 하한 이상은 통과한다', !same.error, same.error?.message);
  const raw = await svc.from('brand_units').update({ visibility: 'knowhow' }).eq('unit_id', UNIT).eq('status', 'active').select();
  check('B6 service_role 직접 UPDATE 도 하한 아래는 거부(CHECK ②)', checkViolation(raw, 'brand_units_visibility_floor'),
    raw.error ? `${raw.error.code}` : '통과됨');
  const franFloor = await H.rpc('set_visibility_floor', { p_unit_id: UNIT, p_floor: 'summary' });
  check('B7 하한 내리기는 통과(직영)', !franFloor.error, franFloor.error?.message);

  // ── C. 연결 해제 — 직영은 본사만(정본 §4-3) ──────────────────────────────
  console.log('\nC 연결 해제 권한');
  await svc.from('brand_units').update({ owner_can_end: false }).eq('unit_id', UNIT).eq('status', 'active');
  const ownerEnd = await O.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa' });
  check('C1 직영에서 점주 해제는 owner_cannot_end', refused(ownerEnd, 'owner_cannot_end'), ownerEnd.error?.message ?? '통과됨');
  check('C2 연결은 그대로 active 다', (await row()) !== null);
  // ★본사 해제는 통과해야 한다 — 막는 것은 점주 호출뿐이다. 실제로 끊으면 시드가 깨지므로 여기서는
  //   "본사 계정이 owner_cannot_end 로 막히지 않는다"만 확인하고 즉시 되돌린다.
  const brandEnd = await H.rpc('end_brand_unit', { p_unit_id: UNIT, p_reason: 'qa:brand-relation' });
  check('C3 직영이어도 본사 해제는 통과한다', !refused(brandEnd, 'owner_cannot_end'), brandEnd.error?.message ?? 'ok');
  // 되살리기 — 해제된 행을 다시 active 로(새 행을 만들지 않는다 · 계정·매장 신설 금지 규칙과 같은 정신).
  await svc.from('brand_units').update({
    status: 'active', ended_at: null, ended_by: null, end_reason: null,
    relation: 'direct', owner_can_end: false, visibility: 'ops', visibility_floor: 'summary',
  }).eq('unit_id', UNIT).eq('status', 'ended').eq('end_reason', 'qa:brand-relation');
  check('C4 하니스가 연결을 되살렸다', (await row()) !== null);

  // ── D. 필수 배포 — content_required 면 못 숨긴다(정본 §4-2) ──────────────
  console.log('\nD 필수 배포');
  await svc.from('brand_units').update({ content_required: true }).eq('unit_id', UNIT).eq('status', 'active');
  // ★사본 픽스처는 **이 하니스가 직접 만든다.** 기존 사본을 빌려 쓰면 qa:brand-deploy 를 먼저 돌렸는지에
  //   따라 결과가 갈리고(순서 의존), 남의 상태를 숨김으로 바꿔 놓을 위험도 있다.
  //   `hide_brand_copy` 가 요구하는 것은 "brand_entry_id 가 있는 이 매장 행" 하나뿐이라 이것으로 충분하다.
  //   끝에 반드시 지운다(restore 가 아니라 여기서 — 이 행은 시드에 없던 것이다).
  await svc.from('playbook_entries').delete().eq('id', COPY_FIXTURE);
  const made = await svc.from('playbook_entries').insert({
    id: COPY_FIXTURE, unit_id: UNIT, title: 'qa:brand-relation 픽스처',
    category: '기타', subcategory: '기타', status: 'published',
    brand_entry_id: 'qa_rel_src', brand_version: 1,
  }).select();
  if (made.error) {
    // ⛔건너뛴 것을 통과로 세지 않는다(AGENTS 게이트 거짓말 3종).
    check('D1 사본 픽스처를 만들지 못했다', false, made.error.message);
  } else {
    const hide = await O.rpc('hide_brand_copy', { p_entry_id: COPY_FIXTURE, p_hidden: true });
    check('D1 필수 매장에서 숨기기는 content_required', refused(hide, 'content_required'), hide.error?.message ?? '통과됨');
    await svc.from('brand_units').update({ content_required: false }).eq('unit_id', UNIT).eq('status', 'active');
    const ok = await O.rpc('hide_brand_copy', { p_entry_id: COPY_FIXTURE, p_hidden: true });
    check('D2 필수가 아니면 숨길 수 있다', !ok.error, ok.error?.message);
    await svc.from('brand_units').update({ content_required: true }).eq('unit_id', UNIT).eq('status', 'active');
    const unhide = await O.rpc('hide_brand_copy', { p_entry_id: COPY_FIXTURE, p_hidden: false });
    check('D2b 되살리기는 필수 매장에서도 통과한다(갇히지 않는다)', !refused(unhide, 'content_required'), unhide.error?.message ?? 'ok');
  }
  const offByOwner = await O.rpc('set_content_required', { p_unit_id: UNIT, p_required: false });
  check('D3 점주는 필수를 끌 수 없다(본사 전용 RPC)', !!offByOwner.error, '통과됨');
  const offByBrand = await H.rpc('set_content_required', { p_unit_id: UNIT, p_required: false });
  check('D4 본사는 필수를 끌 수 있다(끄는 유일한 길)', !offByBrand.error, offByBrand.error?.message);

  // ── E. 요금 부담 — 직영은 본사 부담 고정(정본 §4-3) ──────────────────────
  console.log('\nE 요금 부담');
  const pBrand = await H.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  check('E1 본사의 payer 제안이 direct_payer_fixed', refused(pBrand, 'direct_payer_fixed'), pBrand.error?.message ?? '통과됨');
  const pOwner = await O.rpc('propose_payer', { p_unit_id: UNIT, p_payer: 'store' });
  check('E2 점주의 payer 제안도 direct_payer_fixed', refused(pOwner, 'direct_payer_fixed'), pOwner.error?.message ?? '통과됨');

  // ── F. 가맹에는 직영 규칙을 걸 수 없다(정본 §4 금지선) ───────────────────
  console.log('\nF 가맹 금지선');
  await svc.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'franchise', p_reason: 'qa:brand-relation' });
  const fFloor = await H.rpc('set_visibility_floor', { p_unit_id: UNIT, p_floor: 'ops' });
  check('F1 가맹에 하한 지정은 franchise_floor_fixed', refused(fFloor, 'franchise_floor_fixed'), fFloor.error?.message ?? '통과됨');
  const fReq = await H.rpc('set_content_required', { p_unit_id: UNIT, p_required: true });
  check('F2 가맹에 필수 배포는 franchise_can_hide', refused(fReq, 'franchise_can_hide'), fReq.error?.message ?? '통과됨');
  const jRel = await J.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'direct', p_reason: 'x' });
  check('F3 직원은 관계를 못 바꾼다', !!jRel.error, '통과됨');
  const hRel = await H.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'direct', p_reason: 'x' });
  check('F4 ★본사 담당자도 관계를 못 바꾼다(우리만 · §12 R3)', !!hRel.error, '통과됨');

  // ── G. 관계 전환 §8 — 자동 재조정 · 동의 재요청 · 알림 ───────────────────
  console.log('\nG 관계 전환(§8)');
  await svc.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'direct', p_reason: 'qa:brand-relation G' });
  await svc.from('brand_units').update({ visibility_floor: 'ops', visibility: 'ops', owner_can_end: false, content_required: true })
    .eq('unit_id', UNIT).eq('status', 'active');
  const before = await row();
  check('G1 직영에서 전용 값 3개가 켜져 있다',
    before.visibility_floor === 'ops' && before.owner_can_end === false && before.content_required === true, JSON.stringify(before));
  await svc.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'franchise', p_reason: 'qa:brand-relation G' });
  const after = await row();
  check('G2 ★가맹 전환 시 직영 전용 값이 전부 되돌아간다',
    after.visibility_floor === 'summary' && after.owner_can_end === true && after.content_required === false, JSON.stringify(after));
  check('G3 visibility 는 유지된다(점주가 이제 내릴 수 있다)', after.visibility === 'ops', after.visibility);
  check('G4 동의를 다시 받는다(consent_pending)', after.consent_pending === true && after.consent_kind === 'consent', JSON.stringify(after));
  const alerts = (await svc.from('owner_alerts').select('kind').eq('unit_id', UNIT).eq('kind', 'brand_relation_changed')).data ?? [];
  check('G5 점주 알림 1건 이상(brand_relation_changed)', alerts.length >= 1, `${alerts.length}건`);
  const ev = (await svc.from('brand_events').select('kind, payload').eq('unit_id', UNIT).eq('kind', 'relation_changed')).data ?? [];
  check('G6 감사 로그에 사유가 남는다', ev.some((e) => String(e.payload?.reason ?? '').includes('qa:brand-relation')), JSON.stringify(ev.slice(0, 2)));
  const ack = await O.rpc('ack_brand_consent', { p_unit_id: UNIT, p_accept: true });
  check('G7 점주가 재동의하면 대기가 닫힌다', !ack.error && (await row()).consent_pending === false, ack.error?.message);
  const ack2 = await O.rpc('ack_brand_consent', { p_unit_id: UNIT, p_accept: true });
  check('G8 대기가 없으면 no_pending_consent', refused(ack2, 'no_pending_consent'), ack2.error?.message ?? '통과됨');
  // 가맹은 점주가 내릴 수 있다 — G3 의 '유지'가 실제로 점주 재량이 되었는지.
  const nowDown = await O.rpc('set_brand_visibility', { p_unit_id: UNIT, p_visibility: 'summary' });
  check('G9 가맹으로 돌아오면 점주가 수준을 내릴 수 있다', !nowDown.error, nowDown.error?.message);

  // ── H. ★개인 축은 관계와 무관하게 0행(정본 §3) ──────────────────────────
  console.log('\nH 개인 축 — 직영이어도 예외 없음');
  await svc.rpc('admin_set_brand_relation', { p_unit_id: UNIT, p_relation: 'direct', p_reason: 'qa:brand-relation H' });
  const blocked = ({ data, error }) => (error ? error.code === '42501' : (data ?? []).length === 0);
  for (const [t, col] of [['wages', 'staff_id'], ['attendance', 'id'], ['knowhow_understanding', 'entry_id'], ['work_rooms', 'id']]) {
    const r = await H.from(t).select(col).limit(5);
    check(`H1 직영 매장이어도 ${t} 직접 조회 0행`, blocked(r), r.error ? r.error.code : `${(r.data ?? []).length}행`);
  }
  const ov = (await H.rpc('brand_overview')).data ?? [];
  const cols = ov[0] ? Object.keys(ov[0]) : [];
  const banned = ['staff_names', 'phone', 'wage', 'hourly_wage', 'attendance', 'junior_name', 'junior_id', 'score', 'chat', 'staff_id'];
  check('H2 brand_overview 컬럼에 개인 축이 없다', !cols.some((c) => banned.includes(c)), cols.join(','));
  check('H3 미이수는 **인원 수**만 온다(0226)', cols.includes('staff_behind') && !cols.some((c) => c.includes('behind_name')), cols.join(','));

  await restore();
  await O.auth.signOut(); await H.auth.signOut(); await J.auth.signOut();
} catch (e) {
  fail++;
  console.log('\n✗ 하니스 중단:', String(e).slice(0, 400));
}
await restore();
// ★건너뛴 것을 통과로 세지 않는다(AGENTS 게이트 거짓말 3종).
console.log(`\n── 결과 ── pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
