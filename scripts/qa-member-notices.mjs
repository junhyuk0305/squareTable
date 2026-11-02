#!/usr/bin/env node
// qa-member-notices.mjs — 승인·반려·내보냄·나감·탈퇴 알림 대기열(member_notices) + 크론 스윕 (로컬 도커 전용)
//
// 무엇을 못박나(0247 · Q22 · 설계 02 · 정책 L7):
//   [1] 표 member_notices — RLS on · 본인 행만 읽기 · 앱은 쓸 수 없다 · kind 에 question_answered(Q23 용)가 미리 있다.
//   [2] approve_member · reject_member 끝에 신청자에게 알림 한 줄.
//   [3] 내보냄(remove_staff)은 내보낸 사람에게, 나감(leave_store)·탈퇴(delete_my_account)는 그 매장 사장 멤버십에게만
//       (매니저는 받지 않는다 · 이동 화면 /owner/staff 가 사장 전용 · F-2). 다시 열기(reopen)는 알림이 없다.
//   [4] sweep_member_notices() — service_role 만 · 먼저 claim 하고 돌려준다(두 번째 호출은 0) · 하루 지난 알림은 버린다.
//   [5] 엣지 push/index.ts — 크론 갈래 sweepMemberNotices 가 반드시 deliver() 를 지난다(세션·음소거 판정이 적용된다).
//   [6] 0345 처리한 합류 신청 — approve·reject 가 처리자(actor_id)를 찍는다 · join_history_rows 는 그 매장 사장만 읽는다
//       (매니저·신청자·다른 매장 사장·anon 은 0행 또는 거부) · 허브 my_units_notif_data 'join_done' 이 같은 행을 준다.
//
// 지금(0246)은 알림이 어디에도 없다. 내보낸 직원은 앱을 열기 전까지 모르고, 엣지 user 대상은 같은 매장 멤버만
//   받아서 내보낸 뒤에는 클라이언트가 보낼 수도 없다.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-member-notices.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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

const phones = ['0131', '0132', '0133', '0134', '0135', '0136', '0137'].map((p) => `${p}${s.slice(0, 7)}`);
const H = 3600000;
const users = [];
let UNIT = null;
let UNIT2 = null;

/** 이 사람이 받은 알림(service_role 로 읽는다). 오류면 문자열. */
const noticesOf = async (uid) => {
  const { data, error } = await admin.from('member_notices').select('id, user_id, unit_id, kind, title, body, url, claimed_at').eq('user_id', uid).order('id');
  return error ? `오류 ${error.code ?? ''} ${error.message}` : (data ?? []);
};
const kinds = (r) => (Array.isArray(r) ? r.map((x) => x.kind).join(',') : r);

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const up = async (i, name, role, birth) => {
    const c = mk();
    const r = await c.auth.signUp({
      email: `qa_mn_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: birth } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    const u = { c, id: r.data.user?.id, name };
    users.push(u);
    return u;
  };
  const O = await up(0, 'QA알림사장', 'owner', '1980-01-01');
  const A = await up(1, 'QA알림내보냄', 'junior', '2000-01-01');
  const B = await up(2, 'QA알림반려', 'junior', '2000-01-01');
  const C = await up(3, 'QA알림나감', 'junior', '2000-01-01');
  const D = await up(4, 'QA알림탈퇴', 'junior', '2000-01-01');
  const M = await up(5, 'QA알림매니저', 'junior', '2000-01-01');

  const { data: st, error: e1 } = await O.c.rpc('create_store', { p_store_name: 'QA알림카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  UNIT = row.unit_id;
  await O.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  const joinUnit = async (U) => {
    const j = await U.c.rpc('join_by_invite', { p_code: row.invite_code });
    if (j.error) throw new Error(`${U.name} join_by_invite: ${j.error.message}`);
  };
  const approve = async (U) => {
    await joinUnit(U);
    const a = await O.c.rpc('approve_member', { p_uid: U.id });
    if (a.error) throw new Error(`${U.name} approve_member: ${a.error.message}`);
    await U.c.rpc('switch_active_unit', { p_unit_id: UNIT });
  };
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 5명`);

  // ═══════ 1. 표 ═══════
  console.log('\n[1] member_notices 표 — RLS · 본인만 읽기 · 앱 쓰기 불가');
  {
    const t = await admin.from('member_notices').select('id').limit(1);
    check('1-1 member_notices 표가 있다', !t.error, t.error?.message);
    const ins = await O.c.from('member_notices').insert({ user_id: O.id, unit_id: UNIT, kind: 'approved', title: 't', body: 'b', url: '/' });
    check('1-2 앱(authenticated)은 알림을 넣을 수 없다', !!ins.error, ins.error ? `${ins.error.code} ${ins.error.message}` : '들어감');
    const q = await admin.from('member_notices').insert({ user_id: O.id, unit_id: UNIT, kind: 'question_answered', title: 't', body: 'b', url: '/' }).select('id');
    check('1-3 kind 에 question_answered 가 미리 있다(Q23 용)', !q.error, q.error?.message);
    if (!q.error) await admin.from('member_notices').delete().eq('id', q.data?.[0]?.id ?? -1);
    const bad = await admin.from('member_notices').insert({ user_id: O.id, unit_id: UNIT, kind: 'hello', title: 't', body: 'b', url: '/' });
    check('1-4 모르는 kind 는 거부(CHECK)', bad.error?.code === '23514', bad.error ? `${bad.error.code} ${bad.error.message}` : '들어감');
    const an = await mk().rpc('sweep_member_notices');
    check('1-5 anon 은 sweep_member_notices 를 실행할 수 없다(42501)', an.error?.code === '42501', `code=${an.error?.code ?? '-'} ${an.error?.message ?? ''}`);
    const au = await O.c.rpc('sweep_member_notices');
    check('1-6 authenticated 도 실행할 수 없다(42501)', au.error?.code === '42501', `code=${au.error?.code ?? '-'} ${au.error?.message ?? ''}`);
  }

  // ═══════ 2. 승인 · 반려 ═══════
  console.log('\n[2] approve_member · reject_member — 신청자에게 알림 한 줄');
  {
    await approve(A);
    const a = await noticesOf(A.id);
    check('2-1 ★승인하면 신청자에게 approved 1행', Array.isArray(a) && a.length === 1 && a[0].kind === 'approved' && a[0].unit_id === UNIT, kinds(a));
    check('2-2 승인 알림 문구에 매장 이름', Array.isArray(a) && /QA알림카페/.test(`${a[0]?.title} ${a[0]?.body}`), JSON.stringify(a[0] ?? {}));
    const mine = await A.c.from('member_notices').select('id, kind');
    check('2-3 받은 사람은 자기 알림을 읽는다', !mine.error && (mine.data ?? []).length === 1, mine.error?.message ?? String((mine.data ?? []).length));
    const other = await O.c.from('member_notices').select('id').eq('user_id', A.id);
    check('2-4 다른 사람(사장)은 그 알림을 못 읽는다(0행)', !other.error && (other.data ?? []).length === 0, other.error?.message ?? String((other.data ?? []).length));
    const upd = await A.c.from('member_notices').update({ title: 'x' }).eq('user_id', A.id).select('id');
    check('2-5 받은 사람도 고칠 수 없다', !!upd.error || (upd.data ?? []).length === 0, upd.error?.message ?? JSON.stringify(upd.data));

    await joinUnit(B);
    const r = await O.c.rpc('reject_member', { p_uid: B.id });
    check('2-6 reject_member 성공', !r.error, r.error?.message);
    const b = await noticesOf(B.id);
    check('2-7 ★반려하면 신청자에게 rejected 1행', Array.isArray(b) && b.length === 1 && b[0].kind === 'rejected', kinds(b));
  }

  // ═══════ 3. 내보냄 · 나감 · 탈퇴 ═══════
  console.log('\n[3] remove_staff → 그 직원 · leave_store · delete_my_account → 사장만(매니저 제외)');
  {
    const r = await O.c.rpc('remove_staff', { p_staff_id: A.id });
    check('3-1 remove_staff 성공', !r.error, r.error?.message);
    const a = await noticesOf(A.id);
    check('3-2 ★내보낸 직원에게 removed 1행(approved 다음)', Array.isArray(a) && kinds(a) === 'approved,removed', kinds(a));

    await approve(M);
    { const { error } = await O.c.rpc('set_member_role', { p_uid: M.id, p_role: 'manager' }); if (error) throw new Error('set_member_role: ' + error.message); }
    await approve(C);
    await approve(D);
    const before = await noticesOf(O.id);
    const beforeN = Array.isArray(before) ? before.length : -1;

    const l = await C.c.rpc('leave_store');
    check('3-3 leave_store 성공', !l.error, l.error?.message);
    const o1 = await noticesOf(O.id);
    const left = Array.isArray(o1) ? o1.slice(beforeN).filter((x) => x.kind === 'left') : [];
    check('3-4 ★나가면 사장에게 left 1행 · 이름이 들어간다', left.length === 1 && left[0].unit_id === UNIT && /QA알림나감/.test(`${left[0].title} ${left[0].body}`),
      JSON.stringify(Array.isArray(o1) ? o1.slice(beforeN) : o1));
    check('3-5 left 알림은 사장 직원 화면으로(/owner/staff)', left[0]?.url === '/owner/staff', left[0]?.url ?? '-');

    const d = await D.c.rpc('delete_my_account');
    check('3-6 delete_my_account(직원) 성공', !d.error, d.error?.message);
    const o2 = await noticesOf(O.id);
    const gone = Array.isArray(o2) ? o2.slice(beforeN).filter((x) => x.kind === 'account_deleted') : [];
    check('3-7 ★탈퇴하면 사장에게 account_deleted 1행 · 이름이 들어간다', gone.length === 1 && /QA알림탈퇴/.test(`${gone[0].title} ${gone[0].body}`),
      JSON.stringify(Array.isArray(o2) ? o2.slice(beforeN) : o2));
    const m = await noticesOf(M.id);
    check('3-8 ★매니저는 나감·탈퇴 알림을 받지 않는다', Array.isArray(m) && !m.some((x) => x.kind === 'left' || x.kind === 'account_deleted'), kinds(m));
    const c = await noticesOf(C.id);
    check('3-9 나간 본인에게는 left 알림이 가지 않는다', Array.isArray(c) && !c.some((x) => x.kind === 'left'), kinds(c));
  }

  // ═══════ 6. 처리한 합류 신청(0345) ═══════
  // 이 시점 = A 승인(뒤 내보냄) · B 반려 · M·C·D 승인(M 매니저 · C 나감 · D 탈퇴). 처리자는 모두 O.
  console.log('\n[6] 0345 join_history_rows — 처리자 기록 · 그 매장 사장만 · 허브 join_done');
  {
    const O2 = await up(6, 'QA알림다른사장', 'owner', '1980-01-01');
    const { data: st2, error: e2 } = await O2.c.rpc('create_store', { p_store_name: 'QA알림다른매장', p_industry: '카페·디저트', p_biz_no: null });
    const row2 = Array.isArray(st2) ? st2[0] : st2;
    if (e2 || !row2?.unit_id) throw new Error('create_store O2: ' + (e2?.message ?? 'no row'));
    UNIT2 = row2.unit_id;

    const { data: raw } = await admin.from('member_notices').select('user_id, kind, actor_id').eq('unit_id', UNIT).in('kind', ['approved', 'rejected']);
    check('6-1 ★승인·반려 행에 처리자(actor_id = 사장)가 찍힌다', (raw ?? []).length === 5 && (raw ?? []).every((x) => x.actor_id === O.id), JSON.stringify(raw));

    const jh = await O.c.rpc('join_history_rows');
    const mineRows = (jh.data ?? []).filter((x) => x.unit_id === UNIT);
    const byUser = (uid) => mineRows.find((x) => x.payload?.applicant_id === uid)?.payload;
    const pa = byUser(A.id), pb = byUser(B.id), pd = byUser(D.id);
    check('6-2 ★사장은 처리한 신청 5건을 읽는다(승인 4 · 반려 1)', !jh.error && mineRows.length === 5
      && mineRows.filter((x) => x.payload?.kind === 'approved').length === 4, jh.error?.message ?? JSON.stringify(mineRows.map((x) => x.payload?.kind)));
    check('6-3 행에 신청자 이름 · 처리자 이름 · 결과', pa?.applicant_name === 'QA알림내보냄' && pa?.actor_id === O.id && pa?.actor_name === 'QA알림사장'
      && pa?.kind === 'approved' && pb?.kind === 'rejected' && pb?.applicant_name === 'QA알림반려', JSON.stringify({ pa, pb }));
    check('6-4 탈퇴한 신청자는 이름을 비운다', pd?.applicant_name === '', JSON.stringify(pd));

    const jm = await M.c.rpc('join_history_rows');
    check('6-5 ★매니저는 0행(승인·반려가 사장 전용)', !jm.error && (jm.data ?? []).length === 0, jm.error?.message ?? `rows=${(jm.data ?? []).length}`);
    const jb = await B.c.rpc('join_history_rows');
    check('6-6 ★반려된 신청자 본인도 0행', !jb.error && (jb.data ?? []).length === 0, jb.error?.message ?? `rows=${(jb.data ?? []).length}`);
    const jo2 = await O2.c.rpc('join_history_rows');
    check('6-7 ★다른 매장 사장은 이 매장 행을 못 본다(0행)', !jo2.error && !(jo2.data ?? []).some((x) => x.unit_id === UNIT), jo2.error?.message ?? `rows=${(jo2.data ?? []).length}`);
    const jan = await mk().rpc('join_history_rows');
    check('6-8 anon 은 실행할 수 없다(42501)', jan.error?.code === '42501', `code=${jan.error?.code ?? '-'} ${jan.error?.message ?? ''}`);

    const hub = await O.c.rpc('my_units_notif_data');
    const hubDone = (hub.data ?? []).filter((x) => x.source === 'join_done' && x.unit_id === UNIT);
    check('6-9 ★허브(my_units_notif_data)도 같은 5건을 join_done 으로 준다', !hub.error && hubDone.length === 5
      && hubDone.every((x) => mineRows.some((y) => y.payload?.id === x.payload?.id)), hub.error?.message ?? `rows=${hubDone.length}`);
    const hubM = await M.c.rpc('my_units_notif_data');
    check('6-10 매니저 허브에는 join_done 이 없다', !hubM.error && !(hubM.data ?? []).some((x) => x.source === 'join_done'), hubM.error?.message ?? '');
    const direct = await O.c.from('member_notices').select('id').eq('unit_id', UNIT).in('kind', ['approved', 'rejected']);
    check('6-11 표 RLS 는 그대로 — 사장이 신청자 행을 직접 읽지는 못한다(0행)', !direct.error && (direct.data ?? []).length === 0, direct.error?.message ?? `rows=${(direct.data ?? []).length}`);
  }

  // ═══════ 4. 스윕 ═══════
  console.log('\n[4] sweep_member_notices — service_role · 먼저 claim · 두 번째 0 · 하루 지난 알림은 버린다');
  {
    const old = await admin.from('member_notices')
      .insert({ user_id: O.id, unit_id: UNIT, kind: 'left', title: '오래된', body: 'b', url: '/owner/staff', created_at: new Date(Date.now() - 26 * H).toISOString() })
      .select('id');
    const oldId = old.data?.[0]?.id;
    check('4-0 하루 지난 알림 셋업', !old.error && !!oldId, old.error?.message);
    // 한 틱에 200개까지 claim 한다. 로컬 DB 에 다른 하니스가 남긴 미발송 알림이 많아도 빠짐없이 보게 빌 때까지 돈다.
    const s1 = await admin.rpc('sweep_member_notices');
    const rows1 = [...(s1.data ?? [])];
    for (let i = 0, last = rows1.length; !s1.error && last === 200 && i < 20; i++) {
      const more = await admin.rpc('sweep_member_notices');
      last = (more.data ?? []).length;
      rows1.push(...(more.data ?? []));
    }
    const myIds = new Set([...(await noticesOf(A.id)), ...(await noticesOf(B.id)), ...(await noticesOf(O.id))].map((x) => x.id));
    const got = rows1.filter((x) => myIds.has(x.out_id));
    check('4-1 ★첫 스윕이 이 매장 알림을 돌려준다(승인 · 반려 · 내보냄 · 나감 · 탈퇴 = 5행 이상)', !s1.error && got.length >= 5,
      s1.error?.message ?? `rows=${rows1.length} mine=${got.length}`);
    const one = got.find((x) => x.out_user_id === A.id);
    check('4-2 행마다 받는 사람 · 매장 · 제목 · 본문 · 이동 경로', !!one && one.out_unit_id === UNIT && !!one.out_title && !!one.out_url,
      JSON.stringify(one ?? {}));
    check('4-3 ★하루 지난 알림은 돌려주지 않는다', !rows1.some((x) => x.out_id === oldId), `old=${oldId}`);
    const oldRow = (await admin.from('member_notices').select('claimed_at, delivered').eq('id', oldId ?? -1).maybeSingle()).data;
    check('4-4 하루 지난 알림은 버린 것으로 남긴다(claimed · delivered 0)', !!oldRow?.claimed_at && oldRow?.delivered === 0, JSON.stringify(oldRow));
    const s2 = await admin.rpc('sweep_member_notices');
    check('4-5 ★두 번째 스윕은 0행(이미 claim 됨)', !s2.error && (s2.data ?? []).length === 0, s2.error?.message ?? `rows=${(s2.data ?? []).length}`);
  }

  // ═══════ 5. 엣지 — 순수 검사 ═══════
  console.log('\n[5] 엣지 push/index.ts — sweepMemberNotices 는 deliver() 를 지난다(정책 L7)');
  {
    const edgeSrc = readFileSync(join(ROOT, 'supabase/functions/push/index.ts'), 'utf8').replace(/\r\n/g, '\n');
    const extract = (name) => {
      const start = edgeSrc.search(new RegExp(`(async )?function ${name}\\(`));
      if (start < 0) return null;
      const end = edgeSrc.indexOf('\n}\n', start);
      return ts.transpileModule(edgeSrc.slice(start, end + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    };
    const src = extract('sweepMemberNotices');
    check('5-1 sweepMemberNotices 가 있다', !!src);
    if (src) {
      const calls = { deliver: [], update: [] };
      const fakeAdmin = {
        rpc: async (name) => (name === 'sweep_member_notices'
          ? { data: [
            { out_id: 1, out_user_id: 'u1', out_unit_id: 's1', out_kind: 'removed', out_title: 't1', out_body: 'b1', out_url: '/stores' },
            { out_id: 2, out_user_id: 'u2', out_unit_id: 's1', out_kind: 'left', out_title: 't2', out_body: 'b2', out_url: '/owner/staff' },
          ], error: null }
          : { data: null, error: { message: 'unexpected rpc ' + name } }),
        from: (t) => ({ update: (v) => ({ eq: async (_c, id) => { calls.update.push([t, id, v]); return { error: null }; } }) }),
      };
      const fakeDeliver = async (_a, scope, targets, notif) => { calls.deliver.push({ scope, targets, notif }); return { sent: 1, recipients: 1, suppressed: 0, pruned: 0 }; };
      const fn = new Function('createClient', 'SUPABASE_URL', 'deliver', `${src}; return sweepMemberNotices;`)(() => fakeAdmin, 'http://x', fakeDeliver);
      const res = await fn('tok');
      check('5-2 ★행마다 deliver() 를 한 번 부른다(받는 사람 1명 · 매장 범위 · 이동 경로)', calls.deliver.length === 2
        && calls.deliver[0].scope === 's1' && JSON.stringify(calls.deliver[0].targets) === '["u1"]' && calls.deliver[1].notif.url === '/owner/staff',
        JSON.stringify(calls.deliver));
      check('5-3 결과(delivered)를 member_notices 에 남긴다', calls.update.length === 2 && calls.update.every(([t]) => t === 'member_notices'),
        JSON.stringify(calls.update));
      check('5-4 반환 = swept 2 · sent 2', res?.swept === 2 && res?.sent === 2, JSON.stringify(res));
    }
    const serve = edgeSrc.slice(edgeSrc.indexOf('Deno.serve('));
    check('5-5 ★크론 갈래(task_reminders)가 sweepMemberNotices 를 부른다', /await sweepMemberNotices\(token\)/.test(serve));
    check('5-6 발송은 deliver() 밖에서 하지 않는다(webpush · deliverExpoPush 직접 호출 없음)',
      !!src && !/sendNotification|deliverExpoPush/.test(src));
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  if (UNIT) { try { await admin.from('units').delete().eq('id', UNIT); } catch { /* best-effort */ } }
  if (UNIT2) { try { await admin.from('units').delete().eq('id', UNIT2); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
