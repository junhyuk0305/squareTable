#!/usr/bin/env node
// qa-roles.mjs — 매니저 역할(0093) 권한 매트릭스 실증. 실 백엔드 대상·자가정리.
//
// ★고정 계정만 쓴다(2026-10-03 사용자 결정 "하니스를 수정해. 고정계정만 쓰도록" · scripts/lib/qa-fixed-accounts.mjs).
//   사장 owner@pilot · 매니저 staff@pilot · 직원 staff2@pilot (store_001) · 타 테넌트 owner-solo@pilot.
//   계정·매장을 만들지 않는다. service_role 없이 돈다(.env 만) — 정리는 사장 권한으로 한다.
//   만드는 행 = 접두사 `qaroles_` 가 붙은 제안·노하우·출퇴근뿐. 바꾸는 상태 = 직원의 역할(잠깐 매니저 → 직원).
//   시급·급여설정·매장 이름은 시작 때 값을 적어 두고, 끝에 다르면 그 값으로 되돌린다.
//   끝에 my_units(매장·역할·활성)가 시작 때와 같은지 단정한다.
//
// 실증(3역할 × 도메인):
//  · 직원(junior): 시급 쓰기·제안 승인·발행·임명·급여설정 전부 거부(회귀)
//  · 매니저: 출퇴근 보정·제안 승인·노하우 발행 허용 /
//            ★시급·급여설정·합류 승인은 **거부**(0201, 2026-09-14 — 앱 허용목록에 맞춰 서버를 좁힘) /
//            임명·매장이름·매장삭제 거부(사장 전용 잠금)
//  · 임명·해제: 사장이 직원을 매니저로 지정하면 즉시 관리 권한이 생기고, 해제하면 즉시 사라진다
//  · 역할 열람: 같은 매장 멤버는 unit_members 역할 열람 가능, 타 테넌트는 불가
//
// SKIP(고정 계정으로는 재지 않는다 — 매번 찍고 통과로 세지 않는다):
//  · 좌석캡 — store_001 을 체험 종료(admin_expire_store)로 내려야 잴 수 있다. 라이브 고정 매장의 구독을 건드린다.
//  · 매니저 내보내기(remove_staff)·나가기(leave_store) 후 멤버십 잔존 0 — 고정 직원의 근무표·교대요청을
//    지운다(0132). 되살릴 길이 qa:seed 뿐이다.
//  · 사장 합류 승인 성공 — 신청(pending) 계정이 새로 있어야 한다. 대신 '사장은 역할 관문을 통과한다'를 잰다.
// 실행: node scripts/qa-roles.mjs (.env 필요). 적용 전제 = 0093 + 0201 push.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIXED, UNIT, login, stateLine, rolePrecondition, ensureActive, restoreActive } from './lib/qa-fixed-accounts.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('FAIL: URL/ANON 필요(.env)'); process.exit(2); }

const s = String(Date.now()).slice(-9);
let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const skipped = (n, why) => { skip++; console.log('  SKIP', n, '—', why); };

const P = 'qaroles_';
const SUG = `sug_${P}`, PE = `pe_${P}`, ATT = `att_${P}`;

// 하니스가 만든 행만 지운다(사장 RLS: ps_delete·playbook_entries_write·attendance_delete). 남은 행 수를 돌려준다.
async function cleanupRows(O) {
  await O.from('playbook_suggestions').delete().eq('unit_id', UNIT).like('id', `${SUG}%`);
  await O.from('playbook_entries').delete().eq('unit_id', UNIT).like('id', `${PE}%`);
  await O.from('attendance').delete().eq('unit_id', UNIT).like('id', `${ATT}%`);
  let left = 0;
  for (const [t, pre] of [['playbook_suggestions', SUG], ['playbook_entries', PE], ['attendance', ATT]]) {
    const { data } = await O.from(t).select('id').eq('unit_id', UNIT).like('id', `${pre}%`);
    left += (data ?? []).length;
  }
  return left;
}

let O, M, J, X, before = null, snap = null, prevActive = {}, setupFailed = false;
try {
  // ── 셋업: 고정 계정 로그인 · 전제 확인 · 원복용 값 기록 ─────────────────────
  O = await login(URL, ANON, FIXED.owner);
  M = await login(URL, ANON, FIXED.manager);
  J = await login(URL, ANON, FIXED.junior);
  X = await login(URL, ANON, FIXED.other);
  const oId = O.uid, mId = M.uid, jId = J.uid, xId = X.uid;
  const why = await rolePrecondition({ owner: O, manager: M, junior: J });
  if (why) { setupFailed = true; throw new Error(`고정 계정 상태가 시드와 다르다 — ${why}`); }
  before = await stateLine({ owner: O, manager: M, junior: J });
  for (const [k, c] of Object.entries({ owner: O, manager: M, junior: J })) prevActive[k] = await ensureActive(c);
  {
    const w = await O.from('wages').select('staff_id, hourly_wage').eq('unit_id', UNIT).in('staff_id', [mId, jId]);
    const u = await O.from('units').select('store_name, payroll_settings').eq('id', UNIT).maybeSingle();
    if (w.error || u.error || !u.data) { setupFailed = true; throw new Error(`원복용 값 읽기 실패: ${w.error?.message ?? u.error?.message ?? 'units 0행'}`); }
    snap = { wages: w.data ?? [], storeName: u.data.store_name, payroll: u.data.payroll_settings };
  }
  await cleanupRows(O); // 지난 실행이 남긴 잔재
  console.log(`  · 시작 상태 ${before}`);

  // 제안 1건(J 작성) — 승인 권한 시험대.
  const sugId = `${SUG}${s}`;
  const { error: se } = await J.from('playbook_suggestions').insert({ id: sugId, unit_id: UNIT, kind: 'new', proposer_id: jId, proposer_name: 'QA직원', text: 'QA 제안' });
  check('setup: 직원 제안 등록', !se, se?.message ?? '');

  // ── ① 직원(junior) — 전부 거부여야 한다(회귀) ────────────────────────────
  const wDeny = await J.from('wages').upsert({ unit_id: UNIT, staff_id: mId, hourly_wage: 11000 }).select('staff_id');
  check('직원: 시급 쓰기 거부', !!wDeny.error || (wDeny.data?.length ?? 0) === 0, wDeny.error?.code ?? '');
  const sDeny = await J.from('playbook_suggestions').update({ status: 'approved' }).eq('id', sugId).select('id');
  check('직원: 제안 승인 거부(0행)', !sDeny.error && (sDeny.data?.length ?? 0) === 0, `rows=${sDeny.data?.length}`);
  const eDeny = await J.from('playbook_entries').insert({ id: `${PE}d_${s}`, unit_id: UNIT, category: 'Know-how', title: 'QA 거부' });
  check('직원: 노하우 발행 거부', !!eDeny.error, eDeny.error?.code ?? '(차단 안 됨!)');
  // 대상 = 이미 매니저인 M → 뚫려도 상태가 안 바뀐다.
  const rDeny = await J.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  check('직원: 임명 거부(not_owner)', /not_owner/.test(rDeny.error?.message ?? ''), rDeny.error?.message ?? '');
  const pDeny = await J.rpc('save_payroll_settings', { p_settings: { qa: true } });
  check('직원: 급여설정 거부(owner_only)', /owner_only/.test(pDeny.error?.message ?? ''), pDeny.error?.message ?? '');

  // ── ② 임명·해제(사장 전용) — 직원 J 를 잠깐 매니저로 ───────────────────────
  const selfDeny = await O.rpc('set_member_role', { p_uid: oId, p_role: 'manager' });
  check('사장: 본인 임명 거부(cannot_change_self)', /cannot_change_self/.test(selfDeny.error?.message ?? ''), selfDeny.error?.message ?? '');
  const { error: promo } = await O.rpc('set_member_role', { p_uid: jId, p_role: 'manager' });
  check('★사장: 직원 매니저 지정', !promo, promo?.message ?? '');
  const ju = ((await J.rpc('my_units')).data ?? []).find((r) => r.unit_id === UNIT);
  check('★지정된 직원 my_units.role=manager', ju?.role === 'manager', `role=${ju?.role}`);
  const attP = await J.from('attendance').insert({ id: `${ATT}jp_${s}`, unit_id: UNIT, staff_id: mId, date: '2026-07-30', work_minutes: 60 });
  check('★지정 즉시: 남의 출퇴근 보정 허용', !attP.error, attP.error?.message ?? '');
  const { error: demo } = await O.rpc('set_member_role', { p_uid: jId, p_role: 'junior' });
  check('사장: 매니저 해제', !demo, demo?.message ?? '');
  // 0201 뒤로 매니저도 시급을 못 써서 '해제 후 시급 거부'는 해제 전후를 못 가른다 → 출퇴근 보정으로 잰다.
  const attD = await J.from('attendance').insert({ id: `${ATT}jd_${s}`, unit_id: UNIT, staff_id: mId, date: '2026-07-30', work_minutes: 60 });
  check('★해제 후: 남의 출퇴근 보정 즉시 거부', !!attD.error, attD.error?.code ?? '(차단 안 됨!)');

  // ── ③ 매니저 허용 도메인 ─────────────────────────────────────────────────
  // ★2026-09-14(0201): 시급·급여 설정·합류 승인은 매니저에게서 **거뒀다**. 0093(07-30)이 열어 뒀지만
  //   그 일을 하는 화면(/owner/staff·/owner/payroll)이 앱 허용목록에 없어 매니저는 도착하지 못했다
  //   — 서버는 허용, 앱은 차단. 사장 판정: 앱이 기준 → 서버를 좁혔다. 아래 세 줄이 그 카운터파트다.
  const wMDeny = await M.from('wages').upsert({ unit_id: UNIT, staff_id: jId, hourly_wage: 12000 }).select('staff_id');
  check('★매니저: 시급 쓰기 거부(0201)', !!wMDeny.error, wMDeny.error?.code ?? '(차단 안 됨!)');
  const att = await M.from('attendance').insert({ id: `${ATT}m_${s}`, unit_id: UNIT, staff_id: jId, date: '2026-07-30', work_minutes: 60 });
  check('★매니저: 남의 출퇴근 보정 허용', !att.error, att.error?.message ?? '');
  const sOk = await M.from('playbook_suggestions').update({ status: 'approved', reviewed_by: mId }).eq('id', sugId).select('id');
  check('★매니저: 제안 승인 허용', !sOk.error && (sOk.data?.length ?? 0) === 1, sOk.error?.message ?? '');
  const eOk = await M.from('playbook_entries').insert({ id: `${PE}m_${s}`, unit_id: UNIT, category: 'Know-how', title: 'QA 매니저 발행', creator_id: mId, creator_name: 'QA매니저' });
  check('★매니저: 노하우 발행 허용(저자=매니저)', !eOk.error, eOk.error?.message ?? '');
  const pMDeny = await M.rpc('save_payroll_settings', { p_settings: { qa: true } });
  check('★매니저: 급여설정 거부(0201·owner_only)', /owner_only/.test(pMDeny.error?.message ?? ''), pMDeny.error?.message ?? '(차단 안 됨!)');
  // 사장은 지금 값을 그대로 다시 쓴다 — 설정이 바뀌지 않는다.
  const pOk = await O.rpc('save_payroll_settings', { p_settings: snap.payroll });
  check('회귀: 사장 급여설정 정상', !pOk.error, pOk.error?.message ?? '');

  // 합류 승인 — 매니저는 역할 관문에서 거부된다(0201). 대상은 신청자가 아닌 타 테넌트 점주라 뚫려도 not_pending 에서 멈춘다.
  const { error: kaM } = await M.rpc('approve_member', { p_uid: xId });
  check('★매니저: 합류 승인 거부(0201·not_owner)', /not_owner/.test(kaM?.message ?? ''), kaM?.message ?? '(차단 안 됨!)');
  // 사장은 역할 관문을 통과해 '신청 없음'(not_pending)에서 멈춘다 = 상태 변화 없이 사장 승인 경로가 열려 있음을 잰다.
  const { error: ka } = await O.rpc('approve_member', { p_uid: xId });
  check('회귀: 사장은 합류 승인 관문 통과(신청 없음=not_pending)', /not_pending/.test(ka?.message ?? ''), ka?.message ?? '(신청이 없는데 성공?)');
  skipped('★좌석캡: 매니저 포함 3좌석 초과 승인 거부(staff_limit)', '고정 매장 store_001 을 체험 종료로 내려야 잴 수 있다');
  skipped('회귀: 사장 합류 승인 성공', '신청(pending) 상태의 새 계정이 필요하다');

  // ── ④ 매니저 잠금 3영역(사장 전용) ───────────────────────────────────────
  const rn = await M.rpc('rename_store', { p_name: 'ROL 탈취' });
  check('매니저: 매장 이름 변경 거부(not_owner)', /not_owner/.test(rn.error?.message ?? ''), rn.error?.message ?? '');
  // 뚫려도 다음 관문(last_store: 호출자 소유 매장 ≤1)에서 멈춘다 — 매니저는 매장을 소유하지 않는다.
  const dl = await M.rpc('delete_store', { p_unit_id: UNIT });
  check('매니저: 매장 삭제 거부(not_owner)', /not_owner/.test(dl.error?.message ?? ''), dl.error?.message ?? '');
  const ap = await M.rpc('set_member_role', { p_uid: jId, p_role: 'manager' });
  check('매니저: 다른 매니저 임명 거부(not_owner)', /not_owner/.test(ap.error?.message ?? ''), ap.error?.message ?? '');

  // ── ⑤ 역할 열람(um_select_same_unit) ────────────────────────────────────
  const jSee = await J.from('unit_members').select('user_id, role').eq('unit_id', UNIT);
  check('직원: 같은 매장 역할 열람(매니저 배지 입력)', (jSee.data ?? []).some((r) => r.user_id === mId && r.role === 'manager'), `rows=${jSee.data?.length}`);
  const xSee = await X.from('unit_members').select('user_id').eq('unit_id', UNIT);
  check('★타 테넌트: store_001 멤버십 열람 불가', !xSee.error && (xSee.data?.length ?? 0) === 0, `rows=${xSee.data?.length}`);

  // ── ⑥ ★보안: 매니저 내보내기·나가기 후 멤버십 잔존 0 ────────────────────
  skipped('★매니저 내보내기(remove_staff) 후 멤버십·재전환 차단', '고정 직원의 근무표·교대요청을 지운다(0132). 되살릴 길이 qa:seed 뿐이다');
  skipped('★매니저 나가기(leave_store) 후 멤버십 잔존 0', '고정 직원의 store_001 멤버십을 지운다');

  // ── ⑦ 회귀: 사장 권한 무변 ───────────────────────────────────────────────
  // 지금 시급을 그대로 다시 쓴다(시드에 행이 없으면 새로 생긴 행은 정리에서 지운다).
  const jWage = snap.wages.find((w) => w.staff_id === jId)?.hourly_wage ?? 10030;
  const oW = await O.from('wages').upsert({ unit_id: UNIT, staff_id: jId, hourly_wage: jWage }).select('staff_id');
  check('회귀: 사장 시급 쓰기 정상', !oW.error && (oW.data?.length ?? 0) === 1, oW.error?.message ?? '');
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  // ── 정리 + 고정 계정 원복 ────────────────────────────────────────────────
  if (O && !setupFailed && snap) {
    try {
      const left = await cleanupRows(O);
      check(`정리: ${P} 행 0`, left === 0, `left=${left}`);
      // 역할 — 시드대로(J=junior, M=manager). 뚫린 경우에도 여기서 되돌아온다.
      for (const [uid, role, c] of [[J.uid, 'junior', J], [M.uid, 'manager', M]]) {
        const row = ((await c.rpc('my_units')).data ?? []).find((r) => r.unit_id === UNIT);
        if (row && row.role !== role) {
          const { error } = await O.rpc('set_member_role', { p_uid: uid, p_role: role });
          console.log(`  · 역할 되돌림 ${uid} → ${role}`, error?.message ?? '');
        }
      }
      // 시급 — 시작 때 값으로. 시작 때 없던 행은 지운다.
      const { data: wNow } = await O.from('wages').select('staff_id, hourly_wage').eq('unit_id', UNIT).in('staff_id', [M.uid, J.uid]);
      for (const id of [M.uid, J.uid]) {
        const was = snap.wages.find((w) => w.staff_id === id);
        const now = (wNow ?? []).find((w) => w.staff_id === id);
        if (was && now?.hourly_wage !== was.hourly_wage) await O.from('wages').upsert({ unit_id: UNIT, staff_id: id, hourly_wage: was.hourly_wage });
        if (!was && now) await O.from('wages').delete().eq('unit_id', UNIT).eq('staff_id', id);
      }
      // 급여설정·매장 이름 — 뚫렸을 때만 다르다.
      const { data: u } = await O.from('units').select('store_name, payroll_settings').eq('id', UNIT).maybeSingle();
      if (JSON.stringify(u?.payroll_settings) !== JSON.stringify(snap.payroll)) await O.rpc('save_payroll_settings', { p_settings: snap.payroll });
      if (u && u.store_name !== snap.storeName) {
        const { error } = await O.rpc('rename_store', { p_name: snap.storeName });
        console.log('  ! 매장 이름이 바뀌어 있었다 → 되돌림', error?.message ?? '');
      }
      const { data: w2 } = await O.from('wages').select('staff_id, hourly_wage').eq('unit_id', UNIT).in('staff_id', [M.uid, J.uid]);
      const { data: u2 } = await O.from('units').select('store_name, payroll_settings').eq('id', UNIT).maybeSingle();
      const key = (rows) => (rows ?? []).map((w) => `${w.staff_id}:${w.hourly_wage}`).sort().join(',');
      check('정리: 시급·급여설정·매장 이름 시작 때와 동일',
        key(w2) === key(snap.wages) && JSON.stringify(u2?.payroll_settings) === JSON.stringify(snap.payroll) && u2?.store_name === snap.storeName);
    } catch (e) { fail++; console.log('  FAIL 정리 예외:', e.message); }
  }
  // 활성 매장 원복은 셋업이 중간에 실패해도 한다 — ensureActive 로 바꿔 둔 뒤 원복용 값 읽기가 실패하면
  // 위 블록이 통째로 건너뛰어 고정 계정이 store_001 에 남는다(10-03 리뷰). 전후 비교보다 먼저 한다.
  for (const [k, c] of Object.entries({ owner: O, manager: M, junior: J })) {
    if (c && prevActive[k] !== undefined) { try { await restoreActive(c, prevActive[k]); } catch (e) { fail++; console.log(`  FAIL 활성 매장 원복(${k}):`, e.message); } }
  }
  if (O && !setupFailed && snap) {
    try {
      const after = await stateLine({ owner: O, manager: M, junior: J });
      check('정리: 고정 계정 역할·활성 매장 전후 동일', after === before, after === before ? '' : `\n    전 ${before}\n    후 ${after}`);
    } catch (e) { fail++; console.log('  FAIL 상태 비교 예외:', e.message); }
  }
  for (const c of [O, M, J, X]) { try { await c?.auth.signOut(); } catch { /* best-effort */ } }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(setupFailed ? 2 : fail ? 1 : 0);
