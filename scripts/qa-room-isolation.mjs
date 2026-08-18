// qa-room-isolation.mjs — 할일의 경계를 **서버 쪽에서** 실증한다.
//
// ★2026-08-19(0152/0153) 규칙 변경: **할일에는 방 개념이 없다. 할일은 사람에게 배정된다.**
//   방마다 할일을 나누면 사장 입장에서 복잡해진다는 판단으로, work_templates·work_done 에서
//   방 격리를 걷어냈다(0152). 그래서 이 파일이 재던 것도 바뀐다:
//     · 옛 단언 "방 밖 직원에게 배정 = 거부"  → 지금은 **통과가 정답**이다(같은 매장 사람이므로).
//     · 새 경계는 **매장**이다 — 다른 매장 사람은 여전히 차단돼야 한다(0153).
//   ⛔ 대화·공지(work_feed)의 방 격리는 그대로다. 이 파일은 **할일만** 다룬다.
//
// 무엇을 재나: 화면이 아니라 **서버가** 막는가. 그래서 전부 실 백엔드 · 실 세션으로 친다.
//   A. work_templates 쓰기 — 같은 매장이면 방과 무관하게 배정되는가(정상 경로).
//      그리고 **다른 매장 사람**에게는 알림이 안 가는가(0153 의 매장 소속 필터).
//   B. my_units_notif_data() — 배정받은 사람의 알림에 방과 무관하게 나오는가.
//      ★service_role 로 심는다: RLS 를 우회해 방 밖 배정 행을 재현하려는 것이다.
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
  // ★기본방은 서버가 안 만든다 — 클라(useRoomStore.hydrate, 사장 첫 진입)가 만든다. 이 하니스는
  //   create_store RPC 로만 매장을 세우고 앱을 열지 않으므로 기본방이 없었고, A4 가 **매번 조용히
  //   건너뛰어져** "6 통과"가 전수를 뜻하지 않았다(2026-08-11 P5-#7). 클라와 같은 id 규칙으로 직접 심는다.
  const { data: defRoom } = await admin.from('work_rooms').select('id').eq('unit_id', UNIT).eq('is_default', true).maybeSingle();
  let DEFAULT_ROOM = defRoom?.id ?? null;
  if (!DEFAULT_ROOM) {
    const id = `room_main_${UNIT}`;
    const { error } = await admin.from('work_rooms').insert([{ id, unit_id: UNIT, name: '전체', is_default: true, created_by: ownerId }]);
    if (error) throw new Error('기본방 시드: ' + error.message);
    DEFAULT_ROOM = id;
  }
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
  console.log('\n[A] work_templates 쓰기 — 경계는 방이 아니라 **매장**이다 (0152)');

  // A1 ★규칙 변경(0152): 방 밖 직원(B)에게 배정 → **통과가 정답**이다.
  //    할일은 사람에게 배정되고, B 는 같은 매장 사람이다. 방은 배정과 무관하다.
  {
    const { error } = await owner.from('work_templates').insert([task(`wt_a1_${s}`, { room_id: ROOM, owner_id: bId })]);
    check('A1 ★방과 무관하게 같은 매장 사람에게 배정 = 통과', !error, error?.message ?? '');
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
    // 위 셋업이 기본방을 보장하므로 여기 오면 셋업이 깨진 것이다. 조용히 넘기지 않는다 —
    // 건너뛴 항목을 통과로 세면 게이트가 자기 항목의 일부를 안 재고 green 을 보고한다.
    check('A4 기본방에 아무에게나 배정 = 통과', false, '기본방 셋업 실패 — 건너뛴 것을 통과로 세지 않는다');
  }

  // A5 ★규칙 변경(0152): UPDATE 로 방 밖 직원에게 넘기기 → **통과가 정답**이다(A1 과 같은 이유).
  {
    const { error } = await owner.from('work_templates').update({ owner_id: bId }).eq('id', `wt_a3_${s}`).select('id');
    const { data: after } = await admin.from('work_templates').select('owner_id').eq('id', `wt_a3_${s}`).maybeSingle();
    const changed = after?.owner_id === bId;
    check('A5 ★UPDATE 로 담당자 넘기기 = 통과', changed, changed ? '' : `안 바뀜 ${error?.message ?? ''}`);
    await admin.from('work_templates').update({ owner_id: null }).eq('id', `wt_a3_${s}`);
  }

  // A6 ★새 경계: **다른 매장 사람**을 담당자로 꽂으면 푸시 수신자에서 빠져야 한다(0153).
  //    wt_insert 는 owner_id 를 검사하지 않으므로(행은 들어간다) 방어선은 알림 쪽이다 —
  //    이걸 안 재면 "임의 사용자에게 푸시" 벡터(0127 C1)가 조용히 다시 열린 것을 아무도 모른다.
  {
    const outsider = '00000000-0000-4000-8000-0000000dead1'; // 이 매장 멤버가 아닌 uuid
    const ID = `wt_a6_${s}`;
    await admin.from('work_templates').insert([task(ID, {
      room_id: DEFAULT_ROOM ?? ROOM, owner_id: outsider, scope: 'private',
      remind_at: '00:00', recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] },
    })]);
    const { data: rows, error } = await admin.rpc('due_task_reminders');
    const mine = (rows ?? []).find((r) => r.out_template_id === ID);
    const listed = !!mine && (mine.out_recipients ?? []).includes(outsider);
    check('A6 ★다른 매장 사람은 푸시 수신자에서 빠진다', !listed,
      error?.message ?? (listed ? '남음 = 임의 사용자에게 푸시 가능(취약)' : `수신자=${JSON.stringify(mine?.out_recipients ?? [])}`));
    await admin.from('work_templates').delete().eq('id', ID);
  }

  // ═════════ B. 알림 원천 ═════════
  console.log('\n[B] my_units_notif_data() — 배정받은 사람에게는 방과 무관하게 알림이 간다 (0153)');

  // B0 방 밖 배정 행: service_role 로 직접 심는다(RLS 우회).
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

  // B1 ★규칙 변경(0153): 배정받았으면 그 방에 없어도 알림이 **나와야** 한다.
  //    안 나오면 "할일은 보이는데 배정 알림은 안 온다"가 된다.
  const bIds = await notifTemplateIds(jB);
  check('B1 ★방 밖 직원도 배정받으면 알림에 나온다', bIds.includes(LEAK),
    bIds.includes(LEAK) ? '' : `안 나옴 — 실측 ${JSON.stringify(bIds)}`);

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
