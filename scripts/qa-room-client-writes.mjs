// qa-room-client-writes.mjs — **무음 실패 게이트**. 2026-08-19 화면 개편이 새로 쓰는 경로가
// 서버에 실제로 닿는지만 잰다. 화면 동작이 아니라 "조용히 사라지는 곳이 있나"를 본다.
//
// 왜 필요한가: 이번 개편에서 클라(db.ts)가 **새 컬럼·새 테이블·새 RPC**를 쓰기 시작했다.
//   · work_rooms.image_url / color        (0149)
//   · work_room_prefs                      (0149)
//   · soft_delete_room()                   (0148)
//   · scope='shared' + owner_id 조합의 할일 (0150·0152 — 배정 ≠ 비공개)
//   이 프로젝트에서 실제로 났던 사고가 정확히 이 유형이다: db.ts 가 라이브에 없는 컬럼을 보내
//   PGRST204 로 **조용히** 유실되고, 화면은 성공한 것처럼 보였다(2026-08-19 0145/0146).
//   그래서 여기서는 "썼다"가 아니라 **"다시 읽었다"**까지 확인한다.
//
// 실행: node scripts/qa-room-client-writes.mjs   자가정리(계정·OTP 시드 정리).
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

const phones = [`0104${s.slice(0, 7)}`, `0105${s.slice(0, 7)}`, `0106${s.slice(0, 7)}`];
const emails = [`qa_rcw_o_${s}@example.com`, `qa_rcw_a_${s}@example.com`, `qa_rcw_b_${s}@example.com`];

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const owner = mk(), jA = mk(), jB = mk();

  const up = async (c, email, phone, name, role, birth) => {
    const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: birth } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const ownerId = await up(owner, emails[0], phones[0], 'QA쓰기사장', 'owner', '1980-02-20');
  const aId = await up(jA, emails[1], phones[1], 'QA쓰기직원A', 'junior', '2000-03-03');
  const bId = await up(jB, emails[2], phones[2], 'QA쓰기직원B', 'junior', '2001-04-04');

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA쓰기카페', p_industry: '카페·디저트', p_biz_no: null });
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
  console.log(`셋업 — 매장 ${UNIT} · 사장 + 직원 A/B`);

  // ═════════ 1. 방 만들기 — 직원이 · 사진·색까지 (RoomComposer → insertRoom) ═════════
  console.log('\n[1] 방 만들기 · 외형 컬럼 (work_rooms.image_url/color · 0149)');
  const ROOM = `wr_rcw_${s}`;
  const IMG = 'work-photos/qa-room-cover.webp';
  const COLOR = '#F26A50';
  {
    // 직원 A 가 만든다 — 0148 로 열린 경로. 트리거(wr_add_creator_member)가 자기를 멤버로 넣는다.
    const { error } = await jA.from('work_rooms').insert([
      { id: ROOM, unit_id: UNIT, name: 'QA주방', is_default: false, image_url: IMG, color: COLOR, created_by: aId },
    ]);
    check('1-1 직원이 방을 만든다(사진·색 포함) = 통과', !error, error?.message ?? '');
  }
  {
    // ★핵심: 보낸 값이 **되읽힌다**. 컬럼이 없으면 PostgREST 가 조용히 떨어뜨린다(PGRST204 유형).
    const { data, error } = await jA.from('work_rooms').select('image_url, color, name').eq('id', ROOM).maybeSingle();
    check('1-2 ★사진·색이 되읽힌다(무음 유실 없음)', !error && data?.image_url === IMG && data?.color === COLOR,
      error?.message ?? `실측 ${JSON.stringify(data)}`);
  }

  // ═════════ 2. 개인 설정 — 나에게만 (work_room_prefs · 0149) ═════════
  console.log('\n[2] 방 개인 설정 (work_room_prefs · 0149)');
  {
    const { error } = await jA.from('work_room_prefs').upsert({
      room_id: ROOM, user_id: aId, name: 'A만 보는 이름', image_url: null, color: '#8A63D2', show_task_done: false,
    });
    check('2-1 내 개인 설정 저장 = 통과', !error, error?.message ?? '');
  }
  {
    const { data, error } = await jA.from('work_room_prefs').select('name, color, show_task_done').eq('room_id', ROOM).maybeSingle();
    check('2-2 ★개인 설정이 되읽힌다', !error && data?.name === 'A만 보는 이름' && data?.show_task_done === false,
      error?.message ?? `실측 ${JSON.stringify(data)}`);
  }
  {
    // 남의 개인 설정은 0건이어야 한다 — 이게 새면 '나에게만'이 거짓말이 된다.
    const { data, error } = await jB.from('work_room_prefs').select('room_id').eq('room_id', ROOM);
    check('2-3 남의 개인 설정은 안 보인다', !error && (data ?? []).length === 0, error?.message ?? `실측 ${(data ?? []).length}건`);
  }

  // ═════════ 3. 배정 ≠ 비공개 (0150·0152) ═════════
  console.log('\n[3] 매장 전체 할일 + 담당자 (배정 ≠ 비공개)');
  const now = new Date().toISOString();
  const SHARED_TASK = `wt_rcw_sh_${s}`;
  {
    // 직원 A 가 만든 **매장 전체 할일**에 담당자 B. 예전 규칙이면 scope=private 이라 B와 사장만 봤다.
    const { error } = await jA.from('work_templates').insert([{
      id: SHARED_TASK, unit_id: UNIT, text: 'QA 매장 전체 할일', section: 'open',
      scope: 'shared', owner_id: bId, created_by: aId, created_at: now, room_id: ROOM,
      recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] },
    }]);
    check('3-1 직원이 매장 전체 할일을 만든다(담당 B) = 통과', !error, error?.message ?? '');
  }
  {
    // ★B 는 이 방 멤버가 아니다. 그래도 보여야 한다 — 할일에 방 격리가 없기 때문(0152).
    const { data, error } = await jB.from('work_templates').select('id').eq('id', SHARED_TASK);
    check('3-2 ★방 밖 담당자에게도 보인다(방 격리 없음)', !error && (data ?? []).length === 1,
      error?.message ?? `실측 ${(data ?? []).length}건`);
  }
  {
    // 사장도 본다(매장 전체니까).
    const { data, error } = await owner.from('work_templates').select('id').eq('id', SHARED_TASK);
    check('3-3 사장에게도 보인다', !error && (data ?? []).length === 1, error?.message ?? `실측 ${(data ?? []).length}건`);
  }
  const PRIV_TASK = `wt_rcw_pv_${s}`;
  {
    const { error } = await jA.from('work_templates').insert([{
      id: PRIV_TASK, unit_id: UNIT, text: 'QA 개인 할일', section: 'open',
      scope: 'private', owner_id: aId, created_by: aId, created_at: now,
      recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] },
    }]);
    check('3-4 개인 할일 저장 = 통과', !error, error?.message ?? '');
  }
  {
    const { data, error } = await owner.from('work_templates').select('id').eq('id', PRIV_TASK);
    check('3-5 ★개인 할일은 사장도 못 본다', !error && (data ?? []).length === 0, error?.message ?? `실측 ${(data ?? []).length}건`);
  }
  {
    // 남의 할일 수정은 막힌다(0150). 0행이 돌아오는 것도 '조용한 거부'라 여기서 명시적으로 센다.
    const { data, error } = await jB.from('work_templates').update({ text: 'B가 고침' }).eq('id', SHARED_TASK).select('id');
    check('3-6 직원이 남의 할일을 못 고친다', !!error || (data ?? []).length === 0, `실측 ${JSON.stringify(data)}`);
  }

  // ═════════ 4. 완료 알림은 매장 단위 (roomId 없이 쓴다 · 판정 Ⓐ) ═════════
  console.log('\n[4] 완료 알림 피드 — room_id 없이 쓰기');
  const DONE_FEED = `f_rcw_${s}`;
  {
    const { error } = await jB.from('work_feed').insert([{
      id: DONE_FEED, unit_id: UNIT, feed_date: now.slice(0, 10), room_id: null,
      data: { kind: 'task_done', text: 'QA쓰기직원B · QA 매장 전체 할일 완료', authorId: bId, authorName: 'QA쓰기직원B', createdAt: now, refId: SHARED_TASK },
    }]);
    check('4-1 room_id 없는 완료 알림 저장 = 통과', !error, error?.message ?? '');
  }
  {
    // 방에 안 들어간 사람에게도 보여야 한다(매장 단위라서). 안 보이면 화면이 무엇을 하든 못 그린다.
    const { data, error } = await owner.from('work_feed').select('id').eq('id', DONE_FEED);
    check('4-2 ★매장 단위 완료 알림이 모두에게 내려온다', !error && (data ?? []).length === 1,
      error?.message ?? `실측 ${(data ?? []).length}건`);
  }

  // ═════════ 5. 방 삭제 = soft delete RPC (0148) ═════════
  console.log('\n[5] 방 삭제 (soft_delete_room · 0148)');
  {
    // 사장이지만 그 방 멤버가 아니다 → 거부(false)여야 한다. 이게 true 면 "나가면 삭제 못 한다"가 거짓이 된다.
    const { data, error } = await owner.rpc('soft_delete_room', { rid: ROOM });
    check('5-1 방에 없는 사장은 삭제 못 한다', !error && data === false, error?.message ?? `실측 ${JSON.stringify(data)}`);
  }
  {
    await admin.from('work_room_members').insert([{ room_id: ROOM, user_id: ownerId }]);
    const { data, error } = await owner.rpc('soft_delete_room', { rid: ROOM });
    check('5-2 방 멤버인 사장은 삭제한다', !error && data === true, error?.message ?? `실측 ${JSON.stringify(data)}`);
  }
  {
    const { data, error } = await jA.from('work_rooms').select('id').eq('id', ROOM);
    check('5-3 ★삭제한 방은 목록에서 사라진다', !error && (data ?? []).length === 0, error?.message ?? `실측 ${(data ?? []).length}건`);
  }
  {
    // soft delete 라 행 자체는 남아야 한다(대화·기록 보존). 진짜로 지워졌으면 복구할 수 없다.
    const { data } = await admin.from('work_rooms').select('id, deleted_at').eq('id', ROOM).maybeSingle();
    check('5-4 DB에는 남아 있다(soft delete)', !!data?.deleted_at, `실측 ${JSON.stringify(data)}`);
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
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 화면 개편이 쓰는 경로의 무음 실패 · 통과 ${pass} / 실패 ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
