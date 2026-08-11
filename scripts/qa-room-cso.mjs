// qa-room-cso.mjs — 0126 보안 리뷰(/cso) 중 발견한 두 경로를 **실측**한다.
//
// P1. work_rooms.created_by 가 클라 입력이고 wr_insert 가 검증하지 않는다 →
//     0126 트리거(SECURITY DEFINER)가 그 값을 그대로 믿고 멤버로 넣는다.
//     매니저가 created_by 에 **남의 매장 사람 uuid** 를 실어 방을 만들면 그 사람이 이 방 멤버가 되나?
// P2. user_can_see_room() 의 `r.is_default` 가 **매장 소속 검사 없이** 단락된다 →
//     기본방에 대해서는 "아무 uuid" 나 true. due_task_reminders() 가 이 함수로 수신자를 거르므로
//     기본방 할일의 담당자로 외부인 uuid 를 꽂으면 그대로 푸시 수신자에 남나?
//     (엣지 deliver() 는 수신자가 그 매장 소속인지 검사하지 않는다 — push/index.ts:102 확인)
//
// 실행: node scripts/qa-room-cso.mjs
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
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const M = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

const phones = [`0102${s.slice(0, 7)}`, `0103${s.slice(0, 7)}`, `0104${s.slice(0, 7)}`];
const emails = ['o', 'm', 'x'].map((t) => `qa_cso_${t}_${s}@example.com`);

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), MG = mk(), X = mk();
  const up = async (c, email, phone, name, role, birth) => {
    const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: birth } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const oId = await up(O, emails[0], phones[0], 'CSO사장', 'owner', '1980-01-01');
  const mId = await up(MG, emails[1], phones[1], 'CSO매니저', 'junior', '1990-01-01');
  // X = **완전히 다른 매장의 사장**. A매장과 아무 관계도 없다.
  const xId = await up(X, emails[2], phones[2], 'CSO외부인', 'owner', '1985-01-01');

  const mkStore = async (c, name) => {
    const { data, error } = await c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.unit_id) throw new Error('create_store: ' + (error?.message ?? 'no row'));
    await admin.rpc('admin_activate_store', { p_unit_id: row.unit_id, p_days: 1, p_plan: 'multi' });
    await c.rpc('switch_active_unit', { p_unit_id: row.unit_id });
    return row;
  };
  const A = await mkStore(O, 'CSO A매장');
  await mkStore(X, 'CSO B매장(무관)');

  await MG.rpc('join_by_invite', { p_code: A.invite_code });
  await O.rpc('approve_member', { p_uid: mId });
  await MG.rpc('switch_active_unit', { p_unit_id: A.unit_id });
  await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });

  const DROOM = `room_main_${A.unit_id}`;
  await admin.from('work_rooms').insert([{ id: DROOM, unit_id: A.unit_id, name: '전체', is_default: true, created_by: oId }]);
  console.log(`셋업 — A매장 ${A.unit_id} · 기본방 ${DROOM} · 외부인 ${xId}\n`);

  // ── P1: created_by 위조 → 트리거가 외부인을 멤버로 넣나 ──
  console.log('[P1] work_rooms.created_by 위조 → 0126 트리거');
  const FORGED = `wr_cso_${s}`;
  {
    const { error } = await MG.from('work_rooms').insert([{ id: FORGED, unit_id: A.unit_id, name: '위조방', is_default: false, created_by: xId }]);
    const { data: mem } = await admin.from('work_room_members').select('user_id').eq('room_id', FORGED);
    const injected = (mem ?? []).some((r) => r.user_id === xId);
    M('created_by 에 남의 매장 사람 uuid 를 실어 방 생성', !error ? true : true, error ? `insert 거부됨: ${error.code} ${error.message}` : 'insert 통과');
    M('★그 외부인이 이 방 멤버가 되나 (기대: 안 됨)', !injected,
      injected ? '멤버가 됨 = 트리거가 클라 입력을 그대로 믿는다(취약)' : `멤버 아님 (현재 멤버 ${JSON.stringify(mem)})`);
    // 외부인이 실제로 읽을 수 있나(활성 매장이 달라 RLS가 한 번 더 막는지)
    const { data: rd } = await X.from('work_rooms').select('id').eq('id', FORGED);
    M('외부인이 그 방을 읽나 (기대: 0행)', (rd ?? []).length === 0, `${(rd ?? []).length}행`);
  }

  // ── P2: is_default 단락 → 푸시 수신자에 외부인이 남나 ──
  console.log('\n[P2] user_can_see_room 의 is_default 단락 → due_task_reminders 수신자');
  {
    const probe = await admin.rpc('user_can_see_room', { rid: DROOM, uid: xId });
    M('user_can_see_room(기본방, 외부인) 반환값 (기대: false)', probe.data === false, `실제 ${JSON.stringify(probe.data)}`);

    const kst = new Date(Date.now() + 9 * 3600e3);
    const hhmm = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
    const TPL = `wt_cso_${s}`;
    const { error: insErr } = await O.from('work_templates').insert([{
      id: TPL, unit_id: A.unit_id, room_id: DROOM, text: '외부인에게 보내는 임의 문구(푸시 스팸 벡터)',
      section: 'open', scope: 'private', owner_id: xId, created_by: oId,
      recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] }, remind_at: hhmm,
    }]);
    M('기본방 할일의 담당자로 외부인 uuid 를 꽂기', true, insErr ? `거부됨: ${insErr.code}` : '통과됨(wt_insert 가 막지 않는다)');
    if (!insErr) {
      const { data } = await admin.rpc('due_task_reminders');
      const row = (data ?? []).find((r) => r.out_template_id === TPL);
      const leaked = (row?.out_recipients ?? []).includes(xId);
      M('★그 외부인이 푸시 수신자에 남나 (기대: 안 남음)', !leaked,
        leaked ? `남음 = 임의 사용자에게 푸시 발송 가능 · 본문="${row.out_text}"` : `수신자 ${JSON.stringify(row?.out_recipients ?? [])}`);
      await admin.from('work_templates').delete().eq('id', TPL);
    }
  }
} catch (e) {
  fail++;
  console.error('\n✗ 예외:', e.message);
} finally {
  try {
    for (const email of emails) {
      const c = mk();
      const r = await c.auth.signInWithPassword({ email, password: pw });
      if (!r.error) await c.rpc('delete_my_account');
    }
    await cleanupSeededPhones(URL_, SRV, phones);
  } catch (e) { console.log('  (정리 일부 실패:', e.message, ')'); }
  console.log(`\n${fail === 0 ? '✅ 취약점 없음' : '❌ 취약'} — 통과 ${pass} / 실패 ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
