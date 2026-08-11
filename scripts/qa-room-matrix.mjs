// qa-room-matrix.mjs — P5 방 격리 전수 매트릭스 (2026-08-11 실측 QA)
//
// qa-room-isolation.mjs 가 재는 6건에 더해, 그 하니스가 **못 재는 것**을 잰다:
//   · A4 기본방 경로 — 하니스는 create_store 후 앱을 안 열어 기본방이 없어 조용히 skip 된다.
//   · 매니저 축 — 하니스에 매니저가 없다(시드에도 없다).
//   · 직원이 행위자일 때 — 하니스는 사장만 행위자로 쓴다.
//   · anon.
//   · due_task_reminders() 방 필터 — 0123 이 닫지 않은 세 번째 출구(푸시).
//
// 판정은 전부 **로그인 JWT로 PostgREST 직접 호출**. service_role 은 셋업·덤프 전용.
// 실행: node scripts/qa-room-matrix.mjs
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
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const rows = [];
// 매트릭스 한 줄 = 행동 × 역할 → 기대 vs 실제(에러코드 원문)
const M = (행동, 역할, 기대, ok, 실제) => {
  ok ? pass++ : fail++;
  rows.push({ 행동, 역할, 기대, 실제, 판정: ok ? 'PASS' : 'FAIL' });
  console.log(`  ${ok ? '✓' : '✗'} [${역할}] ${행동} → 기대 ${기대} / 실제 ${실제}`);
};

const phones = [`0106${s.slice(0, 7)}`, `0107${s.slice(0, 7)}`, `0108${s.slice(0, 7)}`, `0109${s.slice(0, 7)}`];
const emails = ['o', 'm', 'a', 'b'].map((t) => `qa_p5_${t}_${s}@example.com`);
const errStr = (e) => (e ? `${e.code ?? ''} ${e.message}`.trim() : 'error=null');

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), MG = mk(), A = mk(), B = mk();

  const up = async (c, email, phone, name, role, birth) => {
    const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: birth } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const oId = await up(O, emails[0], phones[0], 'P5사장', 'owner', '1980-01-15');
  const mId = await up(MG, emails[1], phones[1], 'P5매니저', 'junior', '1990-02-02');
  const aId = await up(A, emails[2], phones[2], 'P5방멤버', 'junior', '2000-05-05');
  const bId = await up(B, emails[3], phones[3], 'P5방밖', 'junior', '2001-06-06');

  const { data: c1, error: e1 } = await O.rpc('create_store', { p_store_name: 'P5방카페', p_industry: '카페·디저트', p_biz_no: null });
  const store = Array.isArray(c1) ? c1[0] : c1;
  if (e1 || !store?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = store.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await O.rpc('switch_active_unit', { p_unit_id: UNIT });

  for (const [c, id] of [[MG, mId], [A, aId], [B, bId]]) {
    await c.rpc('join_by_invite', { p_code: store.invite_code });
    const { error } = await O.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  const { error: promoErr } = await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' });
  if (promoErr) throw new Error('set_member_role: ' + promoErr.message);

  // ── 방 셋업 ───────────────────────────────────────────────
  // 기본방: create_store 는 안 만든다(클라 useRoomStore.hydrate 가 사장 첫 진입 때 만든다).
  //         그래서 여기서 **그 클라 경로와 같은 id 규칙**으로 심는다.
  const DROOM = `room_main_${UNIT}`;
  {
    const { error } = await admin.from('work_rooms').insert([{ id: DROOM, unit_id: UNIT, name: '전체', is_default: true, created_by: oId }]);
    if (error) throw new Error('기본방 시드: ' + error.message);
  }
  const ROOM = `wr_p5_${s}`;
  await admin.from('work_rooms').insert([{ id: ROOM, unit_id: UNIT, name: 'P5비밀방', is_default: false, created_by: oId }]);
  await admin.from('work_room_members').insert([{ room_id: ROOM, user_id: aId }]);
  console.log(`셋업 — 매장 ${UNIT} · 기본방 ${DROOM} · 비기본방 ${ROOM}(멤버=A)\n`);

  const now = new Date().toISOString();
  const task = (id, extra) => ({
    id, unit_id: UNIT, text: `P5 할일 ${id}`, section: 'open', scope: 'private',
    created_at: now, created_by: oId, recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] }, ...extra,
  });
  const del = (id) => admin.from('work_templates').delete().eq('id', id);

  // ═════════ A. work_templates 쓰기 경계 ═════════
  console.log('[A] work_templates INSERT/UPDATE — 담당자의 방 가시성');
  const ins = async (client, id, extra) => {
    const { error } = await client.from('work_templates').insert([task(id, extra)]);
    return error;
  };

  { const e = await ins(O, `p5_a1_${s}`, { room_id: ROOM, owner_id: bId });
    M('비기본방 R에 방 밖 직원 B 배정 (INSERT)', '사장', '거부', !!e, errStr(e)); if (!e) await del(`p5_a1_${s}`); }

  { const e = await ins(O, `p5_a2_${s}`, { room_id: ROOM, owner_id: aId });
    M('비기본방 R에 방 멤버 A 배정 (INSERT)', '사장', '허용', !e, errStr(e)); }

  { const e = await ins(O, `p5_a3_${s}`, { room_id: ROOM, owner_id: null, scope: 'shared' });
    M('비기본방 R에 담당자 없이 배정 (INSERT)', '사장', '허용', !e, errStr(e)); }

  { const e = await ins(O, `p5_a3b_${s}`, { room_id: ROOM, owner_id: oId });
    M('비기본방 R에 본인 배정 (INSERT)', '사장', '허용', !e, errStr(e)); }

  // ★ 하니스가 조용히 건너뛰는 자리 — 기본방은 매장 전원이 보므로 아무에게나 배정이 통과해야 한다.
  { const e = await ins(O, `p5_a4_${s}`, { room_id: DROOM, owner_id: bId });
    M('★기본방 D에 아무 직원 B 배정 (INSERT)', '사장', '허용', !e, errStr(e)); }

  { const { error: e } = await O.from('work_templates').update({ owner_id: bId }).eq('id', `p5_a3_${s}`).select('id');
    const { data: after } = await admin.from('work_templates').select('owner_id').eq('id', `p5_a3_${s}`).maybeSingle();
    const changed = after?.owner_id === bId;
    M('담당자 없이 넣고 UPDATE 로 B에게 넘기기', '사장', '거부', !changed, changed ? '바뀜(우회 성공)' : errStr(e));
    if (changed) await admin.from('work_templates').update({ owner_id: null }).eq('id', `p5_a3_${s}`); }

  // ★ 방 이동 우회: 기본방에 B 배정으로 넣은 뒤 room_id 만 비밀방으로 옮긴다.
  { const { error: e } = await O.from('work_templates').update({ room_id: ROOM }).eq('id', `p5_a4_${s}`).select('id');
    const { data: after } = await admin.from('work_templates').select('room_id').eq('id', `p5_a4_${s}`).maybeSingle();
    const moved = after?.room_id === ROOM;
    M('★B 배정 할일을 기본방→비밀방으로 room_id 이동', '사장', '거부', !moved, moved ? '옮겨짐(우회 성공)' : errStr(e));
    if (moved) await admin.from('work_templates').update({ room_id: DROOM }).eq('id', `p5_a4_${s}`); }

  { const e = await ins(MG, `p5_a7_${s}`, { room_id: ROOM, owner_id: bId, created_by: mId });
    M('비기본방 R에 방 밖 직원 B 배정 (INSERT)', '매니저', '거부', !!e, errStr(e)); if (!e) await del(`p5_a7_${s}`); }

  { const e = await ins(A, `p5_a8_${s}`, { room_id: ROOM, owner_id: bId, created_by: aId });
    M('비기본방 R에 방 밖 직원 B 배정 (INSERT)', '직원A(방멤버)', '거부', !!e, errStr(e)); if (!e) await del(`p5_a8_${s}`); }

  { const e = await ins(B, `p5_a10_${s}`, { room_id: ROOM, owner_id: bId, created_by: bId });
    M('자기가 못 보는 방 R에 자기 할일 밀어넣기 (INSERT)', '직원B(방밖)', '거부', !!e, errStr(e)); if (!e) await del(`p5_a10_${s}`); }

  // ★ room_id=null 경로 — 방 술어가 아예 안 걸리는 자리(0013 레거시). 의도인지 기록만.
  { const e = await ins(A, `p5_a11_${s}`, { room_id: null, owner_id: bId, created_by: aId });
    M('room_id=null 로 남에게 배정 (INSERT·방 술어 미적용 경로)', '직원A', '기록', true, e ? `거부 ${errStr(e)}` : '허용됨'); if (!e) await del(`p5_a11_${s}`); }

  // ═════════ B. 읽기 경계 ═════════
  console.log('\n[B] SELECT — 비멤버·매니저·anon');
  await admin.from('work_feed').insert([{
    id: `wf_p5_${s}`, unit_id: UNIT, room_id: ROOM, feed_date: new Date().toISOString().slice(0, 10),
    data: { kind: 'msg', text: 'P5 비밀방 메시지', authorId: oId }, created_at: now,
  }]);
  const cnt = async (c, tbl, col, val) => {
    const { data, error } = await c.from(tbl).select('id').eq(col, val);
    return { n: (data ?? []).length, e: error };
  };
  { const r = await cnt(B, 'work_feed', 'room_id', ROOM); M('비밀방 메시지 SELECT', '직원B(방밖)', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }
  { const r = await cnt(A, 'work_feed', 'room_id', ROOM); M('비밀방 메시지 SELECT', '직원A(방멤버)', '≥1행', r.n >= 1, `${r.n}행 ${errStr(r.e)}`); }
  // ★2026-08-11 규칙 변경: 매니저도 **본인이 멤버인 방**만 본다(사장만 전부).
  //   0122 는 매니저를 모든 방에 통과시켰는데, 그 결과 못 들어간 방을 읽고 전체방으로 승격까지 할 수 있었다.
  { const r = await cnt(MG, 'work_feed', 'room_id', ROOM); M('★안 들어간 방의 메시지 SELECT', '매니저', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }
  { const r = await cnt(MG, 'work_rooms', 'id', ROOM); M('★안 들어간 방 자체 SELECT', '매니저', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }
  { const { error } = await MG.from('work_room_members').insert([{ room_id: ROOM, user_id: mId }]);
    const { data: after } = await admin.from('work_room_members').select('user_id').eq('room_id', ROOM).eq('user_id', mId);
    const joined = (after ?? []).length > 0;
    M('★안 들어간 방에 자기를 멤버로 밀어넣기', '매니저', '거부', !joined, joined ? '들어감(우회 성공)' : errStr(error));
    if (joined) await admin.from('work_room_members').delete().eq('room_id', ROOM).eq('user_id', mId); }
  { const e = await ins(MG, `p5_a7b_${s}`, { room_id: ROOM, owner_id: mId, created_by: mId });
    M('★안 들어간 방에 자기 할일 밀어넣기 (INSERT)', '매니저', '거부', !!e, errStr(e)); if (!e) await del(`p5_a7b_${s}`); }
  { const r = await cnt(B, 'work_templates', 'room_id', ROOM); M('비밀방 할일 SELECT', '직원B(방밖)', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }
  { const r = await cnt(B, 'work_rooms', 'id', ROOM); M('비밀방 자체 SELECT', '직원B(방밖)', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }
  { const anon = mk();
    const r1 = await cnt(anon, 'work_feed', 'room_id', ROOM);
    const r2 = await cnt(anon, 'work_templates', 'room_id', ROOM);
    M('work_feed / work_templates SELECT', 'anon', '0행', r1.n === 0 && r2.n === 0, `feed ${r1.n}행 · tpl ${r2.n}행`); }

  // ═════════ C. 방 메타 변경 — 못 보는 방은 못 만지고, 보는 방은 만질 수 있어야 한다 ═════════
  console.log('\n[C] 방 메타 변경 경계');
  { const { error: e } = await MG.from('work_rooms').update({ is_default: true }).eq('id', ROOM).select('id');
    const { data: after } = await admin.from('work_rooms').select('is_default').eq('id', ROOM).maybeSingle();
    const promoted = !!after?.is_default;
    let leak = '—';
    if (promoted) { const r = await cnt(B, 'work_feed', 'room_id', ROOM); leak = `승격 후 B가 ${r.n}행 읽음`; }
    M('★안 들어간 방을 is_default=true 로 승격', '매니저', '거부', !promoted, promoted ? `승격됨 · ${leak}` : errStr(e));
    if (promoted) await admin.from('work_rooms').update({ is_default: false }).eq('id', ROOM); }

  // ★사용자 확정 규칙: 매니저는 **방을 만들 수 있고**, 자기가 만든(=들어가 있는) 방은
  //   이름 변경·전체방 전환('초대'의 개념)·멤버 관리까지 할 수 있어야 한다. 여기가 막히면 고친 게 아니다.
  const MYROOM = `wr_p5_mgr_${s}`;
  { const { error } = await MG.from('work_rooms').insert([{ id: MYROOM, unit_id: UNIT, name: '매니저가 만든 방', is_default: false, created_by: mId }]);
    M('방 만들기', '매니저', '허용', !error, errStr(error)); }
  { const r = await cnt(MG, 'work_rooms', 'id', MYROOM); M('★자기가 만든 방이 자기에게 보인다(생성자 자동 참여)', '매니저', '≥1행', r.n >= 1, `${r.n}행 ${errStr(r.e)}`); }
  { const { error } = await MG.from('work_room_members').insert([{ room_id: MYROOM, user_id: aId }]);
    M('자기가 만든 방에 직원 초대', '매니저', '허용', !error, errStr(error)); }
  { const e = await ins(MG, `p5_mine_${s}`, { room_id: MYROOM, owner_id: aId, created_by: mId });
    M('자기가 만든 방의 멤버에게 할일 배정', '매니저', '허용', !e, errStr(e)); if (!e) await del(`p5_mine_${s}`); }
  { const { error } = await MG.from('work_rooms').update({ is_default: true }).eq('id', MYROOM).select('id');
    const { data: after } = await admin.from('work_rooms').select('is_default').eq('id', MYROOM).maybeSingle();
    M('★자기가 만든 방을 전체방으로 전환(초대 개념)', '매니저', '허용', !!after?.is_default, after?.is_default ? '전환됨' : errStr(error));
    await admin.from('work_rooms').update({ is_default: false }).eq('id', MYROOM); }
  { const { data: fd } = await admin.from('work_feed').insert([{
      id: `wf_p5_mine_${s}`, unit_id: UNIT, room_id: MYROOM, feed_date: new Date().toISOString().slice(0, 10),
      data: { kind: 'message', text: '매니저 방 메시지', authorId: mId }, created_at: now }]).select('id');
    const r = await cnt(MG, 'work_feed', 'room_id', MYROOM);
    M('★자기가 들어간 방의 메시지는 읽힌다(0122가 고친 것 보존)', '매니저', '≥1행', r.n >= 1, `${r.n}행 (시드 ${(fd ?? []).length})`); }
  { const r = await cnt(B, 'work_feed', 'room_id', MYROOM); M('매니저 방 메시지 SELECT', '직원B(방밖)', '0행', r.n === 0, `${r.n}행 ${errStr(r.e)}`); }

  // ═════════ D. my_units_notif_data() ═════════
  console.log('\n[D] my_units_notif_data() — 알림 원천');
  const LEAK = `p5_leak_${s}`, OKROW = `p5_ok_${s}`;
  await admin.from('work_templates').insert([task(LEAK, { room_id: ROOM, owner_id: bId })]);
  await admin.from('work_templates').insert([task(OKROW, { room_id: ROOM, owner_id: aId })]);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  await admin.from('work_done').insert([{ unit_id: UNIT, work_date: today, template_id: LEAK, room_id: ROOM, data: {} }]);
  const notif = async (c, src) => {
    const { data, error } = await c.rpc('my_units_notif_data');
    if (error) return { ids: [], e: error };
    return { ids: (data ?? []).filter((r) => r.source === src).map((r) => r.payload?.id ?? r.payload?.template_id).filter(Boolean), e: null };
  };
  { const r = await notif(B, 'template'); M("방 밖 배정이 'template' 분기에 나오나", '직원B(방밖)', '안 나옴', !r.ids.includes(LEAK), r.ids.includes(LEAK) ? '나옴' : `없음(${r.ids.length}건)`); }
  { const r = await notif(A, 'template'); M("정상 배정이 'template' 분기에 나오나", '직원A(방멤버)', '나옴', r.ids.includes(OKROW), r.ids.includes(OKROW) ? '나옴' : `없음(${r.ids.length}건)`); }
  { const r = await notif(B, 'done'); M("방 밖 할일 완료마크가 'done' 분기에 나오나", '직원B(방밖)', '안 나옴', !r.ids.includes(LEAK), r.ids.includes(LEAK) ? '나옴' : `없음(${r.ids.length}건)`); }
  // ★알림 원천의 방 술어도 같은 규칙이어야 한다 — 여기만 넓으면 "못 여는 방의 공지"가 알림으로 샌다(P5-#1과 같은 부류).
  {
    const NOTICE = `wf_p5_notice_${s}`;
    await admin.from('work_feed').insert([{
      id: NOTICE, unit_id: UNIT, room_id: ROOM, feed_date: today,
      data: { id: NOTICE, kind: 'notice', text: '비밀방 공지', authorId: oId, read_by: [] }, created_at: now }]);
    const { data, error } = await MG.rpc('my_units_notif_data');
    const ids = error ? [] : (data ?? []).filter((r) => r.source === 'feed').map((r) => r.payload?.id);
    M('★안 들어간 방의 공지가 알림 원천에 나오나', '매니저', '안 나옴', !ids.includes(NOTICE),
      ids.includes(NOTICE) ? '나옴(알림이 방 격리를 뚫는다)' : `없음(feed ${ids.length}건)`);
  }

  // ═════════ E. ★due_task_reminders() — 0123 이 닫지 않은 세 번째 출구 ═════════
  // 푸시는 my_units_notif_data 를 안 탄다. 수신자를 정하는 곳은 due_task_reminders() 하나뿐이고
  // 그 본문에 방 술어가 없다. shared 할일이면 수신자 = 그 시각 근무자 전원 = 방 밖 직원 포함.
  console.log('\n[E] due_task_reminders() — 푸시 수신자에 방 필터가 있나');
  {
    const kst = new Date(Date.now() + 9 * 3600e3);
    const hhmm = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
    const dow = kst.getUTCDay();
    // B 를 지금 시각 근무자로 만든다(A 는 근무 없음) — 방 밖 사람만 근무 중인 상황.
    await admin.from('shift_templates').insert([{ id: `sh_p5_${s}`, unit_id: UNIT, staff_id: bId, weekday: dow, start_time: '00:00', end_time: '23:59' }]);
    const SEC = `p5_secret_${s}`;
    await admin.from('work_templates').insert([task(SEC, {
      room_id: ROOM, owner_id: null, scope: 'shared', remind_at: hhmm,
      text: '비밀방 전용 업무 — 신메뉴 원가표 확인',
    })]);
    const { data, error } = await admin.rpc('due_task_reminders');
    const row = (data ?? []).find((r) => r.out_template_id === SEC);
    const recips = row?.out_recipients ?? [];
    const leaked = recips.includes(bId);
    M('비밀방 shared 할일의 푸시 수신자에 방 밖 직원 B 포함되나', '서버(크론 경로)', 'B 미포함',
      !leaked, error ? errStr(error) : (row ? `수신자 ${recips.length}명 · B포함=${leaked} · 본문="${row.out_text}"` : '해당 행 없음'));
    await admin.from('work_templates').delete().eq('id', SEC);
    await admin.from('shift_templates').delete().eq('id', `sh_p5_${s}`);
  }
} catch (e) {
  fail++;
  console.error('\n✗ 예외:', e.message);
} finally {
  console.log('\n──── 매트릭스 ────');
  console.table(rows);
  try {
    for (const email of emails) {
      const c = mk();
      const r = await c.auth.signInWithPassword({ email, password: pw });
      if (!r.error) await c.rpc('delete_my_account');
    }
    await cleanupSeededPhones(URL_, SRV, phones);
  } catch (e) { console.log('  (정리 일부 실패:', e.message, ')'); }
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — P5 방 격리 전수 · 통과 ${pass} / 실패 ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
