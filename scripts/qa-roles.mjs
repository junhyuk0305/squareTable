#!/usr/bin/env node
// qa-roles.mjs — 매니저 역할(0093) 권한 매트릭스 실증. 실 백엔드 대상·자가정리.
//
// 실증(3역할 × 도메인):
//  · 직원(junior): 시급 쓰기·제안 승인·발행·합류 승인·급여설정·임명 전부 거부(회귀)
//  · 매니저: 시급·출퇴근 보정·제안 승인·노하우 발행·합류 승인·급여설정 허용 /
//            임명·매장이름·매장삭제 거부(사장 전용 잠금)
//  · 좌석캡: 매니저도 무료 3좌석에 포함(junior+manager 카운트)
//  · 역할 열람: 같은 매장 멤버는 unit_members 역할 열람 가능, 타 테넌트는 불가
//  · ★보안: 해제 즉시 권한 소멸 / 매니저 내보내기·나가기 후 멤버십 잔존 0(재접근 차단)
// 실행: node scripts/qa-roles.mjs (.env + .env.seed 필요). 적용 전제 = 0093 push.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// 0088 게이트 라이브 — signUp이 쓰는 번호 전부 '인증됨' 선등록.
const qaPhones = ['0106', '0105', '0108', '0107', '0109', '0102'].map((p) => `${p}${s.slice(0, 7)}`);
await seedVerifiedPhones(URL, SRV, qaPhones);

const cleanup = [];
try {
  // ── 셋업: 오너 O(S1) · 타 테넌트 O2(S2) · 직원 M/J 합류 ─────────────────
  const O = mk();
  const oId = await signUpSession(O, `qa_rol_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0] });
  cleanup.push(O);
  const { data: c1 } = await O.rpc('create_store', { p_store_name: 'ROL 1호점', p_industry: '카페·디저트', p_biz_no: null });
  const S1 = c1?.[0]?.unit_id, code1 = c1?.[0]?.invite_code;

  const O2 = mk();
  await signUpSession(O2, `qa_rol_o2_${s}@example.com`, { name: 'QA타사장', role: 'owner', phone: qaPhones[1] });
  cleanup.push(O2);
  const { data: c2 } = await O2.rpc('create_store', { p_store_name: 'ROL 타매장', p_industry: '카페·디저트', p_biz_no: null });
  const S2 = c2?.[0]?.unit_id;
  check('setup: S1·S2 생성', !!S1 && !!S2, `S1=${S1}`);

  const M = mk();
  const mId = await signUpSession(M, `qa_rol_m_${s}@example.com`, { name: 'QA매니저', role: 'junior', phone: qaPhones[2] });
  cleanup.push(M);
  const J = mk();
  const jId = await signUpSession(J, `qa_rol_j_${s}@example.com`, { name: 'QA직원', role: 'junior', phone: qaPhones[3] });
  cleanup.push(J);
  await M.rpc('join_by_invite', { p_code: code1 });
  await J.rpc('join_by_invite', { p_code: code1 });
  const { error: a1 } = await O.rpc('approve_member', { p_uid: mId });
  const { error: a2 } = await O.rpc('approve_member', { p_uid: jId });
  check('setup: M·J 합류 승인(사장)', !a1 && !a2, a1?.message ?? a2?.message ?? '');

  // 제안 1건(J 작성) — 승인 권한 시험대.
  const sugId = `sug_${s}`;
  const { error: se } = await J.from('playbook_suggestions').insert({ id: sugId, unit_id: S1, kind: 'new', proposer_id: jId, proposer_name: 'QA직원', text: 'QA 제안' });
  check('setup: 직원 제안 등록', !se, se?.message ?? '');

  // ── ① 승격 전(junior) — 전부 거부여야 한다(회귀) ─────────────────────────
  const wDeny = await M.from('wages').upsert({ unit_id: S1, staff_id: jId, hourly_wage: 11000 }).select('staff_id');
  check('직원: 시급 쓰기 거부', !!wDeny.error || (wDeny.data?.length ?? 0) === 0, wDeny.error?.code ?? '');
  const sDeny = await M.from('playbook_suggestions').update({ status: 'approved' }).eq('id', sugId).select('id');
  check('직원: 제안 승인 거부(0행)', !sDeny.error && (sDeny.data?.length ?? 0) === 0, `rows=${sDeny.data?.length}`);
  const eDeny = await M.from('playbook_entries').insert({ id: `pe_d_${s}`, unit_id: S1, category: 'Know-how', title: 'QA 거부' });
  check('직원: 노하우 발행 거부', !!eDeny.error, eDeny.error?.code ?? '(차단 안 됨!)');
  const rDeny = await M.rpc('set_member_role', { p_uid: jId, p_role: 'manager' });
  check('직원: 임명 거부(not_owner)', /not_owner/.test(rDeny.error?.message ?? ''), rDeny.error?.message ?? '');
  const pDeny = await M.rpc('save_payroll_settings', { p_settings: { qa: true } });
  check('직원: 급여설정 거부(manager_only)', /manager_only/.test(pDeny.error?.message ?? ''), pDeny.error?.message ?? '');

  // ── ② 임명(사장 전용) ────────────────────────────────────────────────────
  const selfDeny = await O.rpc('set_member_role', { p_uid: oId, p_role: 'manager' });
  check('사장: 본인 임명 거부(cannot_change_self)', /cannot_change_self/.test(selfDeny.error?.message ?? ''), selfDeny.error?.message ?? '');
  const { error: promo } = await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  check('★사장: M 매니저 지정', !promo, promo?.message ?? '');
  const mu = (await M.rpc('my_units')).data;
  check('★M my_units.role=manager', mu?.[0]?.role === 'manager', `role=${mu?.[0]?.role}`);

  // ── ③ 매니저 허용 도메인 ─────────────────────────────────────────────────
  const wOk = await M.from('wages').upsert({ unit_id: S1, staff_id: jId, hourly_wage: 12000 }).select('staff_id');
  check('★매니저: 시급 쓰기 허용', !wOk.error && (wOk.data?.length ?? 0) === 1, wOk.error?.message ?? '');
  const att = await M.from('attendance').insert({ id: `att_${s}`, unit_id: S1, staff_id: jId, date: '2026-07-30', work_minutes: 60 });
  check('★매니저: 남의 출퇴근 보정 허용', !att.error, att.error?.message ?? '');
  const sOk = await M.from('playbook_suggestions').update({ status: 'approved', reviewed_by: mId }).eq('id', sugId).select('id');
  check('★매니저: 제안 승인 허용', !sOk.error && (sOk.data?.length ?? 0) === 1, sOk.error?.message ?? '');
  const eOk = await M.from('playbook_entries').insert({ id: `pe_m_${s}`, unit_id: S1, category: 'Know-how', title: 'QA 매니저 발행', creator_id: mId, creator_name: 'QA매니저' });
  check('★매니저: 노하우 발행 허용(저자=매니저)', !eOk.error, eOk.error?.message ?? '');
  const pOk = await M.rpc('save_payroll_settings', { p_settings: { qa: true } });
  check('★매니저: 급여설정 허용', !pOk.error, pOk.error?.message ?? '');

  // 합류 승인 — K를 매니저가 승인.
  const K = mk();
  const kId = await signUpSession(K, `qa_rol_k_${s}@example.com`, { name: 'QA직원K', role: 'junior', phone: qaPhones[4] });
  cleanup.push(K);
  await K.rpc('join_by_invite', { p_code: code1 });
  const { error: ka } = await M.rpc('approve_member', { p_uid: kId });
  check('★매니저: 합류 승인 허용', !ka, ka?.message ?? '');

  // 좌석캡 — 무료 3좌석에 매니저 포함(M+J+K=3) → 4번째 승인은 staff_limit.
  // ★0134(가입하면 N일): create_store 가 1호점을 **single·trialing** 으로 연다. 그 동안은 캡을 일부러
  //   안 건다(0136 주석: "체험 중엔 캡을 안 건다"가 목적). 그래서 이 매장을 그대로 두고 재면
  //   "캡 미작동"으로 보이는데 **의도된 동작**이다 — 재려는 것은 무료 매장의 캡이므로 체험을 끝내고 잰다.
  //   (2026-08-11 P9: 0130 이 같은 이유로 게이트 5개를 깨뜨렸다. 모델을 바꾸면 게이트가 카운터파트다.)
  {
    const srv = createClient(URL, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await srv.rpc('admin_expire_store', { p_unit_id: S1 });
    if (error) throw new Error('좌석캡 전제(체험 종료): ' + error.message);
  }
  const L = mk();
  await signUpSession(L, `qa_rol_l_${s}@example.com`, { name: 'QA직원L', role: 'junior', phone: qaPhones[5] });
  cleanup.push(L);
  const { data: lRow } = await L.auth.getUser();
  await L.rpc('join_by_invite', { p_code: code1 });
  const la = await M.rpc('approve_member', { p_uid: lRow.user.id });
  check('★좌석캡: 매니저 포함 3좌석 초과 승인 거부(staff_limit)', /staff_limit/.test(la.error?.message ?? ''), la.error?.message ?? '(캡 미작동!)');

  // ── ④ 매니저 잠금 3영역(사장 전용) ───────────────────────────────────────
  const rn = await M.rpc('rename_store', { p_name: 'ROL 탈취' });
  check('매니저: 매장 이름 변경 거부(not_owner)', /not_owner/.test(rn.error?.message ?? ''), rn.error?.message ?? '');
  const dl = await M.rpc('delete_store', { p_unit_id: S1 });
  check('매니저: 매장 삭제 거부(not_owner)', /not_owner/.test(dl.error?.message ?? ''), dl.error?.message ?? '');
  const ap = await M.rpc('set_member_role', { p_uid: jId, p_role: 'manager' });
  check('매니저: 다른 매니저 임명 거부(not_owner)', /not_owner/.test(ap.error?.message ?? ''), ap.error?.message ?? '');

  // ── ⑤ 역할 열람(um_select_same_unit) ────────────────────────────────────
  const jSee = await J.from('unit_members').select('user_id, role').eq('unit_id', S1);
  check('직원: 같은 매장 역할 열람(매니저 배지 입력)', (jSee.data ?? []).some((r) => r.user_id === mId && r.role === 'manager'), `rows=${jSee.data?.length}`);
  const o2See = await O2.from('unit_members').select('user_id').eq('unit_id', S1);
  check('★타 테넌트: S1 멤버십 열람 불가', !o2See.error && (o2See.data?.length ?? 0) === 0, `rows=${o2See.data?.length}`);

  // ── ⑥ 해제 즉시 권한 소멸 ────────────────────────────────────────────────
  await O.rpc('set_member_role', { p_uid: mId, p_role: 'junior' });
  const wAfter = await M.from('wages').upsert({ unit_id: S1, staff_id: jId, hourly_wage: 13000 }).select('staff_id');
  check('★해제 후: 시급 쓰기 즉시 거부', !!wAfter.error || (wAfter.data?.length ?? 0) === 0, wAfter.error?.code ?? '');

  // ── ⑦ ★보안: 매니저 내보내기·나가기 후 멤버십 잔존 0 ────────────────────
  await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  const { error: rm } = await O.rpc('remove_staff', { p_staff_id: mId });
  check('★매니저 내보내기(remove_staff) 성공', !rm, rm?.message ?? '');
  const mAfter = (await M.rpc('my_units')).data;
  check('★내보낸 매니저 my_units 비움', (mAfter ?? []).every((x) => x.unit_id !== S1), `n=${mAfter?.length}`);
  const sw = await M.rpc('switch_active_unit', { p_unit_id: S1 });
  check('★내보낸 매니저 재전환 거부(not_a_member)', /not_a_member/.test(sw.error?.message ?? ''), sw.error?.message ?? '');

  await O.rpc('set_member_role', { p_uid: jId, p_role: 'manager' });
  const { error: lv } = await J.rpc('leave_store');
  check('★매니저 나가기(leave_store) 성공', !lv, lv?.message ?? '');
  const jAfter = (await J.rpc('my_units')).data;
  check('★나간 매니저 멤버십 잔존 0', (jAfter?.length ?? 0) === 0, `n=${jAfter?.length}`);

  // ── ⑧ 회귀: 사장 권한 무변 ───────────────────────────────────────────────
  const oW = await O.from('wages').upsert({ unit_id: S1, staff_id: kId, hourly_wage: 10030 }).select('staff_id');
  check('회귀: 사장 시급 쓰기 정상', !oW.error && (oW.data?.length ?? 0) === 1, oW.error?.message ?? '');
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL, SRV, qaPhones);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
