#!/usr/bin/env node
// qa-instant-join.mjs — 직원 즉시 합류(0346) · 사장 '합류했어요'·'인원이 다 찼어요' 알림 (로컬 도커 전용)
//
// 무엇을 못박나(2026-11-02 사용자 결정 1~4):
//   [1] 코드 입력 → 바로 멤버(unit_members) · 대기(pending_unit_id) 0 · 첫 매장이면 주매장·활성.
//   [2] 사장 몫 member_joined 1행(명부의 그 직원 주소 · actor_id = 직원) · 매니저·본인 0행. 크론 스윕이 그 행을 돌려준다.
//   [3] 이미 멤버인데 approve_member → 오류 없음 · 알림·멤버십 변화 없음(옛 사장 앱·하니스).
//   [4] 첫 퀴즈 배정(created_by = 매장 주인)과 게스트 응시 승계가 즉시 합류에서도 일어난다.
//   [5] 무료 좌석이 차면 staff_limit · 멤버 아님 · report_join_full → 사장 몫 join_full 1행 · 하루 두 번 해도 1행 ·
//       매니저 0행 · 틀린 코드·이미 멤버·좌석 여유는 행을 넣지 않는다.
//   [6] 격리 — 다른 매장 사장은 이 행을 못 읽는다 · 허브(my_units_notif_data schednotice)는 사장에게만 준다.
//   [7] 옛 신청(0346 전 대기 행)은 approve_member 로 예전처럼 승인된다.
//
// ★좌석 캡을 보려고 app_config.billing_free_mode 를 잠깐 false 로 두고 끝나면 원래 값으로 돌린다(qa-billing-tiers 와 같다).
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-instant-join.mjs   자가정리(계정·매장·OTP 시드·스위치 원복).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { joinAsStaff, seedPending } from './lib/qa-staff.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const phones = ['0141', '0142', '0143', '0144', '0145', '0146', '0147'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
let freeMode0 = null;

/** 이 매장에서 이 사람이 받은 알림(service_role 로 읽는다). */
const noticesOf = async (uid, unit, kind) => {
  let q = admin.from('member_notices').select('id, user_id, unit_id, kind, title, body, url, actor_id, created_at').eq('user_id', uid).eq('unit_id', unit);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q.order('id');
  if (error) throw new Error(`member_notices 읽기: ${error.message}`);
  return data ?? [];
};
const isMember = async (uid, unit) => {
  const { data } = await admin.from('unit_members').select('role').eq('user_id', uid).eq('unit_id', unit).maybeSingle();
  return data?.role ?? null;
};
const profileOf = async (uid) => (await admin.from('profiles').select('unit_id, active_unit_id, pending_unit_id, role').eq('id', uid).single()).data;

try {
  // 좌석 캡 실증 — 서버 스위치를 끈다(끝나면 원복).
  {
    const { data } = await admin.from('app_config').select('value').eq('key', 'billing_free_mode').maybeSingle();
    freeMode0 = data?.value ?? null;
    const { error } = await admin.from('app_config').upsert({ key: 'billing_free_mode', value: 'false' });
    if (error) throw new Error('billing_free_mode 끄기: ' + error.message);
  }
  await seedVerifiedPhones(URL_, SRV, phones);
  const up = async (i, name, role, birth) => {
    const c = mk();
    const r = await c.auth.signUp({
      email: `qa_ij_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    const u = { c, id: r.data.user?.id, name };
    users.push(u);
    return u;
  };
  const O = await up(0, 'QA즉시사장', 'owner', '1980-01-01');
  const M = await up(1, 'QA즉시매니저', 'junior', '2000-01-01');
  const J = await up(2, 'QA즉시직원', 'junior', '2000-01-01');
  const F = await up(3, 'QA즉시초과', 'junior', '2000-01-01');
  const P = await up(4, 'QA즉시옛신청', 'junior', '2000-01-01');
  const O2 = await up(5, 'QA즉시다른사장', 'owner', '1980-01-01');

  const mkStore = async (U, name) => {
    const { data, error } = await U.c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.unit_id) throw new Error(`create_store ${name}: ${error?.message ?? 'no row'}`);
    units.push(row.unit_id);
    await U.c.rpc('switch_active_unit', { p_unit_id: row.unit_id });
    return row;
  };
  const st = await mkStore(O, 'QA즉시카페');
  const UNIT = st.unit_id, CODE = st.invite_code;
  const st2 = await mkStore(O2, 'QA즉시다른매장');

  // 첫 퀴즈 재료(노하우 1 · 코스 1)와 J 의 게스트 응시 이력을 합류 전에 심는다.
  const entryId = `qa_ij_e_${s}`, courseId = `qa_ij_c_${s}`;
  {
    const e = await admin.from('playbook_entries').insert({ id: entryId, unit_id: UNIT, category: 'QA', title: 'QA즉시 노하우' });
    if (e.error) throw new Error('노하우 심기: ' + e.error.message);
    const c = await admin.from('training_courses').insert({ id: courseId, unit_id: UNIT, key: `qa_ij_${s}`, name: 'QA즉시 첫 퀴즈', start_at: new Date().toISOString(), audience: 'staff' });
    if (c.error) throw new Error('코스 심기: ' + c.error.message);
    const ce = await admin.from('course_entries').insert({ course_id: courseId, entry_id: entryId, unit_id: UNIT });
    if (ce.error) throw new Error('코스 노하우 심기: ' + ce.error.message);
    // 문항이 없는 코스는 시스템 배정이 버려진다(trg_quiz_assignment_no_items).
    const qi = await admin.from('quiz_items').insert({ id: `qa_ij_q_${s}`, unit_id: UNIT, entry_ids: [entryId], kind: 'check', format: 'mc4', payload: { question: 'q', options: ['a', 'b', 'c', 'd'], answer_index: 1 }, status: 'active', course_id: courseId });
    if (qi.error) throw new Error('문항 심기: ' + qi.error.message);
    const jp = (await admin.from('profiles').select('phone_norm').eq('id', J.id).single()).data?.phone_norm;
    const g = await admin.from('quiz_attempts').insert({ unit_id: UNIT, entry_id: entryId, course_id: courseId, guest_name: '게스트QA', guest_phone: jp, total: 1, correct: 1, submission_id: `qs_ij_${s}` });
    if (g.error) throw new Error('게스트 응시 심기: ' + g.error.message);
  }
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 4명 · 다른 매장 ${st2.unit_id} · 무료 좌석 캡 켬`);

  // ═══════ 1. 즉시 합류 ═══════
  console.log('\n[1] join_by_invite — 코드를 넣으면 바로 멤버');
  {
    await joinAsStaff(M.c, CODE);
    const r = await O.c.rpc('set_member_role', { p_uid: M.id, p_role: 'manager' });
    if (r.error) throw new Error('set_member_role: ' + r.error.message);

    const j = await J.c.rpc('join_by_invite', { p_code: CODE });
    const row = Array.isArray(j.data) ? j.data[0] : j.data;
    check('1-1 오류 없이 매장 한 줄을 돌려준다(반환형 그대로)', !j.error && row?.unit_id === UNIT && row?.store_name === 'QA즉시카페', j.error?.message ?? JSON.stringify(j.data));
    check('1-2 ★바로 멤버(unit_members junior)', (await isMember(J.id, UNIT)) === 'junior');
    const p = await profileOf(J.id);
    check('1-3 ★대기 0 · 첫 매장이라 주매장·활성 = 이 매장', !p.pending_unit_id && p.unit_id === UNIT && p.active_unit_id === UNIT, JSON.stringify(p));
    const again = await J.c.rpc('join_by_invite', { p_code: CODE });
    check('1-4 같은 코드를 또 넣으면 already_member', /already_member/.test(again.error?.message ?? ''), again.error?.message ?? '성공함');
  }

  // ═══════ 2. 사장 알림 ═══════
  console.log('\n[2] member_joined — 사장 몫 1행 · 매니저·본인 0행 · 크론이 돌려준다');
  {
    const o = (await noticesOf(O.id, UNIT, 'member_joined')).filter((x) => x.actor_id === J.id);
    check('2-1 ★사장 몫 member_joined 1행', o.length === 1, JSON.stringify(o));
    check('2-2 문구에 직원 이름 · 매장 이름', /QA즉시직원님이 합류했어요/.test(o[0]?.title ?? '') && /QA즉시카페/.test(o[0]?.body ?? ''), JSON.stringify(o[0] ?? {}));
    check('2-3 ★누르면 명부의 그 직원(/owner/staff?member=<id>)', o[0]?.url === `/owner/staff?member=${J.id}`, o[0]?.url ?? '-');
    const m = await noticesOf(M.id, UNIT, 'member_joined');
    check('2-4 ★매니저는 받지 않는다(0행)', m.length === 0, JSON.stringify(m));
    const self = await noticesOf(J.id, UNIT);
    check('2-5 합류한 본인에게는 알림이 없다(승인 알림도 없다)', self.length === 0, JSON.stringify(self));
    const mine = await O.c.from('member_notices').select('id, kind').eq('unit_id', UNIT).eq('kind', 'member_joined');
    check('2-6 사장은 자기 행을 직접 읽는다(RLS 본인 행)', !mine.error && (mine.data ?? []).length === 2, mine.error?.message ?? String((mine.data ?? []).length));
    const rows = [];
    for (let i = 0; i < 20; i++) {
      const sw = await admin.rpc('sweep_member_notices');
      if (sw.error) throw new Error('sweep: ' + sw.error.message);
      rows.push(...(sw.data ?? []));
      if ((sw.data ?? []).length < 200) break;
    }
    const got = rows.find((x) => x.out_id === o[0]?.id);
    check('2-7 ★크론 스윕이 그 행을 사장에게 돌려준다(제목·주소 그대로)', !!got && got.out_user_id === O.id && got.out_kind === 'member_joined' && got.out_url === o[0]?.url, JSON.stringify(got ?? {}));
  }

  // ═══════ 3. approve_member 멱등 ═══════
  console.log('\n[3] 이미 멤버인데 approve_member — 오류 없음 · 변화 없음');
  {
    const before = (await admin.from('member_notices').select('id', { count: 'exact', head: true }).eq('unit_id', UNIT)).count;
    const a = await O.c.rpc('approve_member', { p_uid: J.id });
    check('3-1 ★오류 없이 끝난다', !a.error, a.error?.message);
    const after = (await admin.from('member_notices').select('id', { count: 'exact', head: true }).eq('unit_id', UNIT)).count;
    check('3-2 알림 행이 늘지 않는다(승인 알림 없음)', before === after, `${before} → ${after}`);
    check('3-3 멤버십 그대로(junior)', (await isMember(J.id, UNIT)) === 'junior');
    const nm = await M.c.rpc('approve_member', { p_uid: J.id });
    check('3-4 매니저는 여전히 못 부른다(not_owner)', /not_owner/.test(nm.error?.message ?? ''), nm.error?.message ?? '성공함');
  }

  // ═══════ 4. 첫 퀴즈 · 게스트 승계 ═══════
  console.log('\n[4] 즉시 합류에서도 첫 퀴즈 배정 · 게스트 응시 승계');
  {
    const { data: qa } = await admin.from('quiz_assignments').select('course_id, origin, created_by').eq('user_id', J.id).eq('unit_id', UNIT);
    check('4-1 ★첫 퀴즈 1개(origin join)', (qa ?? []).length === 1 && qa[0].origin === 'join', JSON.stringify(qa));
    check('4-2 배정한 사람 = 매장 주인(본인이 아니다)', qa?.[0]?.created_by === O.id, JSON.stringify(qa?.[0] ?? {}));
    const { data: at } = await admin.from('quiz_attempts').select('staff_id, guest_phone, former_guest_name').eq('submission_id', `qs_ij_${s}`);
    check('4-3 ★게스트 응시가 이 직원 것으로 넘어온다', (at ?? []).length === 1 && at[0].staff_id === J.id && at[0].guest_phone === null && at[0].former_guest_name === '게스트QA', JSON.stringify(at));
  }

  // ═══════ 5. 인원 초과 ═══════
  console.log('\n[5] 무료 좌석이 차면 staff_limit · report_join_full → 사장 몫 join_full 하루 1행');
  {
    const f = await F.c.rpc('join_by_invite', { p_code: CODE });
    check('5-1 ★staff_limit 로 막힌다', /staff_limit/.test(f.error?.message ?? ''), f.error?.message ?? JSON.stringify(f.data));
    check('5-2 멤버가 아니다 · 대기도 없다', (await isMember(F.id, UNIT)) === null && !(await profileOf(F.id)).pending_unit_id);
    const r1 = await F.c.rpc('report_join_full', { p_code: CODE });
    check('5-3 report_join_full 이 행을 넣는다(true)', !r1.error && r1.data === true, r1.error?.message ?? String(r1.data));
    const o1 = (await noticesOf(O.id, UNIT, 'join_full')).filter((x) => x.actor_id === F.id);
    check('5-4 ★사장 몫 join_full 1행 · 문구', o1.length === 1 && /QA즉시초과님이 합류하려 했지만 인원이 다 찼어요/.test(o1[0].title) && /2명/.test(o1[0].body) && o1[0].url === '/owner/staff', JSON.stringify(o1));
    await F.c.rpc('join_by_invite', { p_code: CODE });
    const r2 = await F.c.rpc('report_join_full', { p_code: CODE });
    const o2 = (await noticesOf(O.id, UNIT, 'join_full')).filter((x) => x.actor_id === F.id);
    check('5-5 ★하루 두 번 시도해도 1행', !r2.error && r2.data === false && o2.length === 1, `${r2.error?.message ?? r2.data} rows=${o2.length}`);
    const m = await noticesOf(M.id, UNIT, 'join_full');
    check('5-6 ★매니저는 받지 않는다(0행)', m.length === 0, JSON.stringify(m));
    const bad = await F.c.rpc('report_join_full', { p_code: 'NOPE00' });
    const fails = (await admin.from('join_attempts').select('ok').eq('uid', F.id).eq('ok', false)).data ?? [];
    check('5-7 틀린 코드는 행을 넣지 않고 실패로 센다(잠금)', !bad.error && bad.data === false && fails.length >= 1, `${bad.error?.message ?? bad.data} fails=${fails.length}`);
    const mem = await J.c.rpc('report_join_full', { p_code: CODE });
    check('5-8 이미 멤버가 부르면 행을 넣지 않는다', !mem.error && mem.data === false, mem.error?.message ?? String(mem.data));
    const an = await mk().rpc('report_join_full', { p_code: CODE });
    check('5-9 anon 은 실행할 수 없다', !!an.error, an.error?.message ?? '성공함');
    // 좌석이 하나 비면 다시 들어온다(그때는 report 가 행을 넣지 않는다).
    const rm = await O.c.rpc('remove_staff', { p_staff_id: J.id });
    if (rm.error) throw new Error('remove_staff: ' + rm.error.message);
    const free = await F.c.rpc('report_join_full', { p_code: CODE });
    check('5-10 좌석이 비면 report_join_full 은 행을 넣지 않는다', !free.error && free.data === false, free.error?.message ?? String(free.data));
    const f2 = await F.c.rpc('join_by_invite', { p_code: CODE });
    check('5-11 좌석이 비면 바로 합류한다', !f2.error && (await isMember(F.id, UNIT)) === 'junior', f2.error?.message ?? '');
  }

  // ═══════ 6. 격리 · 허브 ═══════
  console.log('\n[6] 다른 매장 사장은 못 읽는다 · 허브는 사장에게만');
  {
    const other = await O2.c.from('member_notices').select('id').eq('unit_id', UNIT);
    check('6-1 ★다른 매장 사장은 이 매장 알림을 못 읽는다(0행)', !other.error && (other.data ?? []).length === 0, other.error?.message ?? String((other.data ?? []).length));
    const hub2 = await O2.c.rpc('my_units_notif_data');
    check('6-2 다른 매장 사장 허브에 이 매장 행이 없다', !hub2.error && !(hub2.data ?? []).some((x) => x.unit_id === UNIT), hub2.error?.message ?? '');
    const hub = await O.c.rpc('my_units_notif_data');
    const sn = (hub.data ?? []).filter((x) => x.unit_id === UNIT && x.source === 'schednotice');
    const joined = sn.filter((x) => x.payload?.kind === 'member_joined');
    const full = sn.filter((x) => x.payload?.kind === 'join_full');
    check('6-3 ★사장 허브 schednotice 에 member_joined(직원 id 포함) · join_full', !hub.error && joined.some((x) => x.payload?.actor_id === J.id) && full.length === 1,
      hub.error?.message ?? JSON.stringify(sn.map((x) => [x.payload?.kind, x.payload?.actor_id])));
    const hubM = await M.c.rpc('my_units_notif_data');
    check('6-4 매니저 허브에는 없다', !hubM.error && !(hubM.data ?? []).some((x) => ['member_joined', 'join_full'].includes(x.payload?.kind)), hubM.error?.message ?? '');
  }

  // ═══════ 7. 옛 신청 ═══════
  console.log('\n[7] 0346 전 대기 신청은 approve_member 로 예전처럼 승인된다');
  {
    await seedPending(admin, P.id, st2.unit_id);
    const a = await O2.c.rpc('approve_member', { p_uid: P.id });
    check('7-1 승인 성공', !a.error, a.error?.message);
    const p = await profileOf(P.id);
    check('7-2 멤버 · 대기 지움 · 주매장', (await isMember(P.id, st2.unit_id)) === 'junior' && !p.pending_unit_id && p.unit_id === st2.unit_id, JSON.stringify(p));
    const n = await noticesOf(P.id, st2.unit_id, 'approved');
    check('7-3 신청자에게 approved 1행(처리자 = 사장)', n.length === 1 && n[0].actor_id === O2.id, JSON.stringify(n));
    const np = await O2.c.rpc('approve_member', { p_uid: F.id });
    check('7-4 신청도 멤버도 아니면 not_pending', /not_pending/.test(np.error?.message ?? ''), np.error?.message ?? '성공함');
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
  try {
    if (freeMode0 === null) await admin.from('app_config').delete().eq('key', 'billing_free_mode');
    else await admin.from('app_config').upsert({ key: 'billing_free_mode', value: freeMode0 });
  } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
