#!/usr/bin/env node
// qa-feed-boundary.mjs — 업무 피드(work_feed)의 쓰기 경계 + 원자 갱신 게이트 (0176 · 0177 / 감사 #30 · #31)
//
// 무엇을 못박나:
//   ① 공지는 **누구나** 쓴다(0177에서 연 것). 자기 메시지를 공지로 승격하는 것도 된다.
//   ② 수정은 **본인이 쓴 것만** — 사장도 예외 없다.
//   ③ 삭제는 본인 것 + **사장·매니저**(모더레이션).
//   ④ 남의 행에 남기는 표시(읽음·반응·고정·승격)는 **키 하나만** 바꾸는 RPC 로만(0176).
//   ⑤ ★양방향 회귀: 읽음이 본문을 되돌리지 않고, 본문 수정이 읽음을 지우지 않는다(#31 의 정체).
//
// 왜 이 게이트가 따로 필요한가: 기존 방 게이트(qa:room-*)는 **방 가시성**을 본다. 작성자 경계는
//   아무도 안 봤고, 그래서 "방 멤버 누구나 남의 공지를 고칠 수 있다"가 오래 열려 있었다.
//
// 실행: node scripts/qa-feed-boundary.mjs   자가정리(계정·OTP 시드 정리).
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
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

const phones = [`0181${s.slice(0, 7)}`, `0182${s.slice(0, 7)}`, `0183${s.slice(0, 7)}`];
const emails = [`qa_fb_o_${s}@example.com`, `qa_fb_a_${s}@example.com`, `qa_fb_b_${s}@example.com`];
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

/** db.ts upsertFeed 와 같은 모양의 행. */
const feedRow = (id, unit, kind, text, authorId, authorName, role, roomId = null, extra = {}) => ({
  id, unit_id: unit, feed_date: today, room_id: roomId,
  data: {
    id, date: today, kind, text, authorId, authorName, authorRole: role,
    createdAt: new Date().toISOString(), reactions: {}, ...extra,
  },
});
const dataOf = async (c, id) => (await c.from('work_feed').select('data').eq('id', id).maybeSingle()).data?.data;

const cleanup = [];
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const owner = mk(), jA = mk(), jB = mk();
  cleanup.push(jA, jB, owner);   // ★사장을 마지막에 — 매장이 먼저 지워지면 직원 정리가 꼬인다.
  const up = async (c, email, phone, name, role, birth) => {
    const r = await c.auth.signUp({ email, password: pw, options: { data: { name, role, phone, birth_date: birth } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    return r.data.user?.id;
  };
  const ownerId = await up(owner, emails[0], phones[0], 'QA경계사장', 'owner', '1980-05-05');
  const aId = await up(jA, emails[1], phones[1], 'QA경계직원A', 'junior', '2000-06-06');
  const bId = await up(jB, emails[2], phones[2], 'QA경계직원B', 'junior', '2001-07-07');

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA경계카페', p_industry: '카페·디저트', p_biz_no: null });
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

  // ═════════ 1. 공지는 누구나 쓴다 (0177에서 연 것) ═════════
  console.log('\n[1] 공지 작성 개방');
  const NOTICE_A = `f_fb_na_${s}`;
  {
    const { error } = await jA.from('work_feed').insert([feedRow(NOTICE_A, UNIT, 'notice', '직원이 올린 공지', aId, 'QA경계직원A', 'junior')]);
    check('1-1 ★직원이 공지를 쓴다 = 성공(수정 전엔 42501)', !error, error?.message ?? '');
  }
  const MSG_A = `f_fb_ma_${s}`;
  {
    await jA.from('work_feed').insert([feedRow(MSG_A, UNIT, 'message', '직원 A 의 일반 메시지', aId, 'QA경계직원A', 'junior')]);
    // 자기 메시지를 공지로 승격 = 본인 행의 kind 변경. 본문 수정 경로(wf_update)를 탄다.
    const cur = await dataOf(jA, MSG_A);
    const { data, error } = await jA.from('work_feed').update({ data: { ...cur, kind: 'notice' } }).eq('id', MSG_A).select('id');
    check('1-2 ★자기 메시지를 공지로 승격 = 성공', !error && (data ?? []).length === 1, error?.message ?? `rows=${(data ?? []).length}`);
    // 되돌린다(뒤 케이스는 이 행을 '일반 메시지'로 쓴다)
    await jA.from('work_feed').update({ data: { ...cur, kind: 'message' } }).eq('id', MSG_A);
  }
  const NOTICE_O = `f_fb_no_${s}`;
  await owner.from('work_feed').insert([feedRow(NOTICE_O, UNIT, 'notice', '사장 공지 원본', ownerId, 'QA경계사장', 'owner')]);

  // ═════════ 2. 수정은 본인 것만 — 사장도 예외 없다 ═════════
  console.log('\n[2] 수정 경계 (wf_update)');
  {
    const cur = await dataOf(jB, NOTICE_A);
    const { data, error } = await jB.from('work_feed').update({ data: { ...cur, text: 'B 가 남의 공지를 고침' } }).eq('id', NOTICE_A).select('id');
    check('2-1 ★직원 B 가 남의 공지 본문 수정 = 거부(0행)', !error && (data ?? []).length === 0, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const cur = await dataOf(owner, NOTICE_A);
    const { data, error } = await owner.from('work_feed').update({ data: { ...cur, text: '사장이 남의 공지를 고침' } }).eq('id', NOTICE_A).select('id');
    check('2-2 ★사장도 남의 글은 못 고친다 = 거부(0행)', !error && (data ?? []).length === 0, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    // authorId 를 자기 것으로 바꿔 소유권을 훔치는 UPDATE — USING 에도 작성자 조건이 있어야 막힌다.
    const cur = await dataOf(jB, NOTICE_A);
    const { data, error } = await jB.from('work_feed').update({ data: { ...cur, authorId: bId, text: '탈취' } }).eq('id', NOTICE_A).select('id');
    check('2-3 ★authorId 를 내 것으로 바꾸는 UPDATE = 거부(0행)', !error && (data ?? []).length === 0, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const r = await jA.rpc('edit_feed_text', { p_feed_id: NOTICE_A, p_text: '본인이 고친 공지' });
    const after = await dataOf(jA, NOTICE_A);
    check('2-4 본인 글 수정 = 성공(회귀)', !r.error && r.data === true && after?.text === '본인이 고친 공지',
      r.error?.message ?? `rpc=${r.data} text=${after?.text}`);
  }
  {
    const r = await jB.rpc('edit_feed_text', { p_feed_id: NOTICE_A, p_text: 'B 가 RPC 로 우회' });
    const after = await dataOf(jB, NOTICE_A);
    check('2-5 ★edit_feed_text 로도 남의 글은 못 고친다(invoker=RLS 그대로)',
      !r.error && r.data === false && after?.text === '본인이 고친 공지', r.error?.message ?? `rpc=${r.data} text=${after?.text}`);
  }

  // ═════════ 3. 읽음·반응 — 남의 행에 남기는 표시 (0176 RPC) ═════════
  console.log('\n[3] 읽음·반응 원자 갱신 (0176)');
  {
    const r = await jA.rpc('mark_feed_read', { p_feed_id: NOTICE_O });
    const after = await dataOf(jA, NOTICE_O);
    check('3-1 ★회귀: 직원이 사장 공지를 읽음 처리 = 성공', !r.error && r.data === true && (after?.read_by ?? []).includes(aId),
      r.error?.message ?? `rpc=${r.data} read_by=${JSON.stringify(after?.read_by)}`);
  }
  {
    const r = await jA.rpc('mark_feed_read', { p_feed_id: NOTICE_O });
    const after = await dataOf(jA, NOTICE_O);
    check('3-2 두 번 눌러도 한 번만 들어간다(멱등)',
      !r.error && (after?.read_by ?? []).filter((x) => x === aId).length === 1, `read_by=${JSON.stringify(after?.read_by)}`);
  }
  {
    const r = await jB.rpc('mark_all_feed_read', { p_feed_ids: [NOTICE_O, NOTICE_A] });
    const o = await dataOf(jB, NOTICE_O), a = await dataOf(jB, NOTICE_A);
    check('3-3 전체 읽음 = 요청한 만큼 반영(한 문장)',
      !r.error && r.data === 2 && (o?.read_by ?? []).includes(bId) && (a?.read_by ?? []).includes(bId),
      r.error?.message ?? `n=${r.data}`);
  }
  {
    const r = await jA.rpc('toggle_feed_reaction', { p_feed_id: NOTICE_O, p_emoji: '✅' });
    const after = await dataOf(jA, NOTICE_O);
    check('3-4 직원이 사장 공지에 반응 = 성공', !r.error && r.data === true && (after?.reactions?.['✅'] ?? []).includes(aId),
      r.error?.message ?? JSON.stringify(after?.reactions));
  }
  {
    await jA.rpc('toggle_feed_reaction', { p_feed_id: NOTICE_O, p_emoji: '👍' });
    const after = await dataOf(jA, NOTICE_O);
    check('3-5 한 사람당 이모지 1개 — 다른 걸 누르면 교체',
      !(after?.reactions?.['✅'] ?? []).includes(aId) && (after?.reactions?.['👍'] ?? []).includes(aId), JSON.stringify(after?.reactions));
  }
  {
    await jA.rpc('toggle_feed_reaction', { p_feed_id: NOTICE_O, p_emoji: '👍' });
    const after = await dataOf(jA, NOTICE_O);
    check('3-6 같은 걸 다시 누르면 해제 + 빈 배열은 사라진다',
      !(after?.reactions?.['👍'] ?? []).includes(aId) && after?.reactions?.['👍'] === undefined, JSON.stringify(after?.reactions));
  }

  // ═════════ 4. ★#31 — 본문과 표시가 서로를 덮지 않는다 (양방향) ═════════
  console.log('\n[4] #31 양방향 회귀 — 통째 덮어쓰기가 남아 있나');
  {
    // (가) 사장이 본문을 고친 뒤 → 직원이 전체읽음 → **본문이 되돌아가지 않는다**
    await owner.rpc('edit_feed_text', { p_feed_id: NOTICE_O, p_text: '사장이 방금 고친 본문' });
    await jA.rpc('mark_all_feed_read', { p_feed_ids: [NOTICE_O] }); // A 는 이미 읽음 → 0건이지만 경로는 탄다
    const r = await jB.rpc('mark_feed_read', { p_feed_id: NOTICE_O });
    const after = await dataOf(owner, NOTICE_O);
    check('4-1 ★읽음 처리가 방금 고친 본문을 되돌리지 않는다', !r.error && after?.text === '사장이 방금 고친 본문', `text=${after?.text}`);
  }
  {
    // (나) 반대 방향 — 읽음이 쌓인 뒤 사장이 본문을 고쳐도 **읽음이 지워지지 않는다**
    const before = await dataOf(owner, NOTICE_O);
    const readBefore = (before?.read_by ?? []).length;
    await owner.rpc('edit_feed_text', { p_feed_id: NOTICE_O, p_text: '두 번째 수정' });
    const after = await dataOf(owner, NOTICE_O);
    check('4-2 ★본문 수정이 읽음을 지우지 않는다(반대 방향)',
      after?.text === '두 번째 수정' && (after?.read_by ?? []).length === readBefore && readBefore > 0,
      `read_by ${readBefore} → ${(after?.read_by ?? []).length}`);
  }

  // ═════════ 5. 고정·승격 — 관리자만 ═════════
  console.log('\n[5] 모더레이션 RPC (관리자 전용)');
  {
    const r = await jA.rpc('toggle_feed_pin', { p_feed_id: NOTICE_O });
    check('5-1 직원이 공지 고정 = 거부', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    const r = await owner.rpc('toggle_feed_pin', { p_feed_id: NOTICE_A });
    const after = await dataOf(owner, NOTICE_A);
    check('5-2 ★사장이 직원 공지를 고정 = 성공(예전엔 upsert 라 42501)', !r.error && r.data === true && after?.pinned === true,
      r.error?.message ?? `rpc=${r.data} pinned=${after?.pinned}`);
  }
  {
    const r = await jA.rpc('mark_feed_promoted', { p_feed_id: MSG_A, p_entry_id: 'pb_qa_1' });
    check('5-3 직원이 승격 흔적 남기기 = 거부', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
  }
  {
    const r = await owner.rpc('mark_feed_promoted', { p_feed_id: MSG_A, p_entry_id: 'pb_qa_1' });
    const after = await dataOf(owner, MSG_A);
    check('5-4 ★사장이 직원 메시지를 노하우로 승격 = 성공', !r.error && r.data === true && after?.promotedEntryId === 'pb_qa_1',
      r.error?.message ?? `rpc=${r.data} promoted=${after?.promotedEntryId}`);
  }

  // ═════════ 6. 방 경계 — definer 가 RLS 를 우회하므로 함수 안에서 다시 본다 ═════════
  console.log('\n[6] 방 경계 재검사 (definer 우회 방어)');
  const ROOM = `wr_fb_${s}`;
  {
    // A 가 비공개 방을 만든다(생성자만 멤버) → B 는 볼 수 없다.
    await jA.from('work_rooms').insert([{ id: ROOM, unit_id: UNIT, name: 'QA비공개', is_default: false, created_by: aId }]);
    const ROOM_MSG = `f_fb_rm_${s}`;
    await jA.from('work_feed').insert([feedRow(ROOM_MSG, UNIT, 'message', '방 안 메시지', aId, 'QA경계직원A', 'junior', ROOM)]);
    const r = await jB.rpc('mark_feed_read', { p_feed_id: ROOM_MSG });
    check('6-1 ★못 보는 방의 행은 읽음 처리도 거부', !r.error && r.data === false, r.error?.message ?? `rpc=${r.data}`);
    const r2 = await jB.rpc('mark_all_feed_read', { p_feed_ids: [ROOM_MSG] });
    check('6-2 ★전체 읽음도 못 보는 방은 건드리지 않는다(0건)', !r2.error && r2.data === 0, r2.error?.message ?? `n=${r2.data}`);
  }

  // ═════════ 7. 삭제 경계 ═════════
  console.log('\n[7] 삭제 경계 (wf_delete)');
  {
    const { data, error } = await jB.from('work_feed').delete().eq('id', MSG_A).select('id');
    check('7-1 ★직원 B 가 남의 일반 메시지 삭제 = 거부(0행)', !error && (data ?? []).length === 0, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const { data, error } = await jA.from('work_feed').delete().eq('id', MSG_A).select('id');
    check('7-2 본인 메시지 삭제 = 성공', !error && (data ?? []).length === 1, error?.message ?? `rows=${(data ?? []).length}`);
  }
  {
    const { data, error } = await owner.from('work_feed').delete().eq('id', NOTICE_A).select('id');
    check('7-3 ★사장이 직원 공지 삭제 = 성공(모더레이션 확정)', !error && (data ?? []).length === 1, error?.message ?? `rows=${(data ?? []).length}`);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const c of cleanup) { try { await c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  await cleanupSeededPhones(URL_, SRV, phones).catch(() => {});
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
