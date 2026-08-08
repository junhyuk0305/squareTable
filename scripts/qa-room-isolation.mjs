// qa-room-isolation.mjs — 방(room) 격리를 **서버 쪽에서** 실증한다 (0123).
//
// 무엇을 재나: 화면이 아니라 **서버가** 막는가. 그래서 전부 실 백엔드 · 실 세션으로 친다.
//   A. work_templates 쓰기 — "방 밖 직원에게 그 방의 개인 할 일을 꽂기"가 거부되는가.
//      ★정상 경로 4종(방 멤버 배정 · 담당자 없음 · 기본방 · 본인)이 그대로 통과하는지도 같이 잰다 —
//        보안을 조인다면서 멀쩡한 길을 막으면 그건 고친 게 아니다.
//   B. my_units_notif_data() — 이미 심어진(과거에 새어 들어온) 방 밖 배정이 알림에서 걸러지는가.
//      ★service_role 로 심는다: RLS 를 우회해 "0123 이전에 만들어진 행"을 재현하려는 것이다.
//
// 0123 적용 전에 돌리면 A1·A5·B1 이 FAIL(=취약 실증), 적용 후 전부 PASS 여야 한다.
// 실행: node scripts/qa-room-isolation.mjs   자가정리(계정·OTP 시드 정리).
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
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const phones = [`0107${s.slice(0, 7)}`, `0108${s.slice(0, 7)}`, `0109${s.slice(0, 7)}`];
const emails = [`qa_room_o_${s}@example.com`, `qa_room_a_${s}@example.com`, `qa_room_b_${s}@example.com`];

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const owner = mk(), jA = mk(), jB = mk();

  const up = async (c, email, phone, name, role, birth) => {
    const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: birth } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const ownerId = await up(owner, emails[0], phones[0], 'QA방사장', 'owner', '1980-01-15');
  const aId = await up(jA, emails[1], phones[1], 'QA방멤버', 'junior', '2000-05-05');
  const bId = await up(jB, emails[2], phones[2], 'QA방밖직원', 'junior', '2001-06-06');

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA방카페', p_industry: '카페·디저트', p_biz_no: null });
  const storeRow = Array.isArray(c1) ? c1[0] : c1;
  if (e1 || !storeRow?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = storeRow.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });

  for (const [c, id] of [[jA, aId], [jB, bId]]) {
    await c.rpc('join_by_invite', { p_code: storeRow.invite_code });
    const { error } = await owner.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }

  // 방 2개: 기본방(매장 전원) + 비기본방 R(멤버 = A 만).
  const { data: defRoom } = await admin.from('work_rooms').select('id').eq('unit_id', UNIT).eq('is_default', true).maybeSingle();
  const DEFAULT_ROOM = defRoom?.id ?? null;
  const ROOM = `wr_qa_${s}`;
  {
    const { error } = await admin.from('work_rooms').insert([{ id: ROOM, unit_id: UNIT, name: 'QA비밀방', is_default: false, created_by: ownerId }]);
    if (error) throw new Error('방 시드: ' + error.message);
  }
  {
    const { error } = await admin.from('work_room_members').insert([{ room_id: ROOM, user_id: aId }]);
    if (error) throw new Error('방 멤버 시드: ' + error.message);
  }
  console.log(`셋업 — 매장 ${UNIT} · 비기본방 ${ROOM}(멤버=A) · 기본방 ${DEFAULT_ROOM ?? '없음'}`);

  const now = new Date().toISOString();
  const task = (id, extra) => ({
    id, unit_id: UNIT, text: `QA 할일 ${id}`, section: 'open', scope: 'personal',
    created_at: now, created_by: ownerId, recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] }, ...extra,
  });

  // ═════════ A. 쓰기 경계 ═════════
  console.log('\n[A] work_templates 쓰기 — 담당자가 그 방을 볼 수 있어야 한다');

  // A1 ★핵심: 방 밖 직원(B)에게, 그 방(R)의 개인 할 일을 꽂는다 → 거부되어야 한다.
  {
    const { error } = await owner.from('work_templates').insert([task(`wt_a1_${s}`, { room_id: ROOM, owner_id: bId })]);
    check('A1 ★방 밖 직원에게 그 방 할 일 배정 = 거부', !!error, error ? '' : '통과됨 = 서버가 안 막는다(취약)');
    if (!error) await admin.from('work_templates').delete().eq('id', `wt_a1_${s}`);
  }

  // A2 방 멤버(A)에게 같은 방 배정 → 통과해야 한다(정상 경로를 막으면 안 된다).
  {
    const { error } = await owner.from('work_templates').insert([task(`wt_a2_${s}`, { room_id: ROOM, owner_id: aId })]);
    check('A2 방 멤버에게 배정 = 통과', !error, error?.message ?? '');
  }

  // A3 담당자 없는 공용 할 일 → 통과.
  {
    const { error } = await owner.from('work_templates').insert([task(`wt_a3_${s}`, { room_id: ROOM, owner_id: null, scope: 'shared' })]);
    check('A3 담당자 없는 공용 할 일 = 통과', !error, error?.message ?? '');
  }

  // A4 기본방(매장 전원이 보는 방) + 방 밖 개념이 없는 직원 → 통과.
  if (DEFAULT_ROOM) {
    const { error } = await owner.from('work_templates').insert([task(`wt_a4_${s}`, { room_id: DEFAULT_ROOM, owner_id: bId })]);
    check('A4 기본방에 아무에게나 배정 = 통과', !error, error?.message ?? '');
  } else {
    console.log('  - A4 건너뜀(기본방 없음)');
  }

  // A5 ★우회로: 담당자 없이 넣고 UPDATE 로 방 밖 직원에게 넘긴다 → 거부되어야 한다.
  //    INSERT 만 막으면 이 경로로 그대로 뚫린다 — 한쪽만 막은 것은 막은 게 아니다.
  {
    const { error } = await owner.from('work_templates').update({ owner_id: bId }).eq('id', `wt_a3_${s}`).select('id');
    const { data: after } = await admin.from('work_templates').select('owner_id').eq('id', `wt_a3_${s}`).maybeSingle();
    const changed = after?.owner_id === bId;
    check('A5 ★UPDATE 로 방 밖 직원에게 넘기기 = 거부', !changed, changed ? '바뀜 = 우회로가 열려 있다(취약)' : (error?.message ?? ''));
    if (changed) await admin.from('work_templates').update({ owner_id: null }).eq('id', `wt_a3_${s}`);
  }

  // ═════════ B. 알림 원천 ═════════
  console.log('\n[B] my_units_notif_data() — 방 밖 배정이 알림으로 새지 않는다');

  // B0 과거에 새어 들어온 행을 재현: service_role 로 직접 심는다(RLS 우회 = 0123 이전 상태).
  const LEAK = `wt_leak_${s}`;
  {
    const { error } = await admin.from('work_templates').insert([task(LEAK, { room_id: ROOM, owner_id: bId })]);
    if (error) throw new Error('유출 행 시드: ' + error.message);
  }
  // B0b 정상 배정(방 멤버 A) — 이건 알림에 **나와야** 한다(과잉 차단 회귀 방지).
  const OKROW = `wt_ok_${s}`;
  {
    const { error } = await admin.from('work_templates').insert([task(OKROW, { room_id: ROOM, owner_id: aId })]);
    if (error) throw new Error('정상 행 시드: ' + error.message);
  }

  const notifTemplateIds = async (client) => {
    const { data, error } = await client.rpc('my_units_notif_data');
    if (error) throw new Error('my_units_notif_data: ' + error.message);
    return (data ?? [])
      .filter((r) => r.source === 'template')
      .map((r) => r.payload?.id)
      .filter(Boolean);
  };

  const bIds = await notifTemplateIds(jB);
  check('B1 ★방 밖 직원의 알림에 그 방 할 일이 안 나온다', !bIds.includes(LEAK),
    bIds.includes(LEAK) ? '나옴 = 알림이 방 격리를 뚫는다(취약)' : '');

  const aIds = await notifTemplateIds(jA);
  check('B2 방 멤버의 알림에는 정상 배정이 나온다(과잉 차단 아님)', aIds.includes(OKROW),
    aIds.includes(OKROW) ? '' : `안 나옴 — 실측 ${JSON.stringify(aIds)}`);
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
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 방 격리 서버 검증 · 통과 ${pass} / 실패 ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
