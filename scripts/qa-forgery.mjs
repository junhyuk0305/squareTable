#!/usr/bin/env node
// qa-forgery.mjs — 직원이 앱을 거치지 않고 서버에 직접 요청해 사칭·위조·권한 밖 조작을 하는가 (로컬 도커 전용 · 2026-10-19 지시서)
//
// 왜: 구멍 17개가 한 모양이었다 — "누가 했는가·무슨 상태인가"를 앱이 보내고 서버가 그대로 믿었다.
//   이 하니스는 직원 토큰으로 위조 요청을 실제로 보내고, 서버가 막거나 덮어썼는지를 저장된 값으로 본다.
//   번호는 지시서 §3 항목 번호다. [OK] 로 시작하는 검사는 옛 앱의 정상 요청이 계속 통과하는지 본다.
//
// 실행: 로컬 도커(supabase start) + 로컬 엣지(npx supabase functions serve) 를 띄운 뒤
//   node scripts/qa-forgery.mjs
// 계정은 로컬에만 만든다(지시서 §5 예외). 주소가 127.0.0.1 이 아니면 멈춘다.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const st = Object.fromEntries(
  execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const URL = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY;
if (!URL || !/^http:\/\/127\.0\.0\.1:/.test(URL)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const srv = createClient(URL, SRV, { auth: { persistSession: false } });
const s = String(Date.now()).slice(-8);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const one = async (q) => { const { data } = await q; return Array.isArray(data) ? (data[0] ?? null) : (data ?? null); };
// 시드 쓰기는 실패하면 멈춘다 — 시드가 조용히 빠지면 위조 검사가 거짓으로 통과한다.
const must = async (q, label) => { const { error } = await q; if (error) throw new Error(`시드 실패 ${label}: ${error.message}`); };

async function signUp(email, meta) {
  const c = mk();
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp ${email}: ${error?.message ?? 'no session'}`);
  return { c, id: data.user.id, token: data.session.access_token };
}
async function push(token, body) {
  try {
    const r = await fetch(`${URL}/functions/v1/push`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  } catch (e) { return { status: 0, err: String(e) }; }
}
// 위조 푸시가 막혔다 = 4xx 이거나, 200 이어도 받는 사람이 0명.
// 5xx 는 막힌 게 아니라 엣지가 고장 난 것이다(로컬 VAPID 미설정 등) — 실패로 센다.
const pushBlocked = (r) => (r.status >= 400 && r.status < 500) || (r.status === 200 && (r.recipients ?? 0) === 0);
const pushDelivered = (r) => r.status === 200 && (r.recipients ?? 0) > 0;

const phones = ['0101', '0102', '0103', '0104', '0105'].map((p) => `${p}${s.slice(0, 7)}`);
const now = new Date().toISOString();
await srv.from('phone_otps').upsert(phones.map((phone) => ({ phone, code_hash: 'qa-seed', expires_at: now, verified_at: now })));

// ── 셋업: 사장 O · 직원 J(공격자) · 직원 K(피해자) · 합류 대기 P ─────────────────────
const O = await signUp(`qa_forg_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: phones[0] });
const { data: cs } = await O.c.rpc('create_store', { p_store_name: `위조검사 ${s}`, p_industry: '카페·디저트', p_biz_no: null });
const S1 = cs?.[0]?.unit_id, code = cs?.[0]?.invite_code;
const J = await signUp(`qa_forg_j_${s}@example.com`, { name: 'QA직원J', role: 'junior', phone: phones[1] });
const K = await signUp(`qa_forg_k_${s}@example.com`, { name: 'QA직원K', role: 'junior', phone: phones[2] });
for (const u of [J, K]) { await u.c.rpc('join_by_invite', { p_code: code }); await O.c.rpc('approve_member', { p_uid: u.id }); }
const P = await signUp(`qa_forg_p_${s}@example.com`, { name: 'QA신청P', role: 'junior', phone: phones[3] });
await P.c.rpc('join_by_invite', { p_code: code });
const { count: memberCount } = await srv.from('unit_members').select('user_id', { count: 'exact', head: true }).eq('unit_id', S1);
check('setup: 사장·직원 둘·합류 대기 하나', !!S1 && memberCount === 3, `S1=${S1} members=${memberCount}`);

// 노하우 1 · 퀴즈 1 · 문항 1(mc4, 정답 1) — 서비스 키로 심는다(쓰기 권한은 이 하니스의 대상이 아니다).
const E1 = `pe_forg_${s}`, C1 = `tc_forg_${s}`, QI = `qi_forg_${s}`;
await must(srv.from('playbook_entries').insert({ id: E1, unit_id: S1, category: '운영', title: '위조검사 노하우' }), 'entry');
await must(srv.from('training_courses').insert({ id: C1, unit_id: S1, key: `k${s}`, name: '위조검사 퀴즈' }), 'course');
await must(srv.from('course_entries').insert({ course_id: C1, entry_id: E1, unit_id: S1 }), 'course_entries');
await must(srv.from('quiz_items').insert({ id: QI, unit_id: S1, entry_ids: [E1], kind: 'check', format: 'mc4', payload: { question: 'q', options: ['a', 'b', 'c', 'd'], answer_index: 1 }, status: 'active', course_id: C1 }), 'quiz_item');
const { data: rooms } = await srv.from('work_rooms').select('id, is_default').eq('unit_id', S1);
let defaultRoom = rooms?.find((r) => r.is_default)?.id;
if (!defaultRoom) { defaultRoom = `room_def_${s}`; await srv.from('work_rooms').insert({ id: defaultRoom, unit_id: S1, name: '전체', is_default: true }); }
const privRoom = `room_priv_${s}`;
await must(srv.from('work_rooms').insert({ id: privRoom, unit_id: S1, name: '비공개', is_default: false, created_by: O.id }), 'privRoom');
await must(srv.from('work_room_members').insert({ room_id: privRoom, user_id: J.id }) /* 사장은 wr_add_creator_member 가 넣는다 */, 'room_members');

try {
  const day = new Date().toISOString().slice(0, 10);

  // ── 2. 채팅·공지 작성자 사칭 ───────────────────────────────────────────────
  {
    const id = `wf_forg1_${s}`;
    await J.c.from('work_feed').upsert({ id, unit_id: S1, feed_date: day, room_id: null, data: { id, kind: 'message', text: '사장입니다', authorId: O.id, authorName: 'QA사장', authorRole: 'owner', createdAt: now } });
    const row = await one(srv.from('work_feed').select('data').eq('id', id));
    check('2-1 직원이 작성자를 사장으로 적어 글을 올리면 작성자는 직원으로 남는다', !row || (row.data.authorId === J.id && row.data.authorRole !== 'owner'), JSON.stringify(row?.data));
    const id2 = `wf_forg2_${s}`;
    await J.c.from('work_feed').upsert({ id: id2, unit_id: S1, feed_date: day, data: { id: id2, kind: 'message', text: '내 글', authorId: J.id, authorName: 'QA직원J', createdAt: now } });
    await J.c.from('work_feed').update({ data: { id: id2, kind: 'message', text: '내 글', authorId: J.id, authorName: 'QA사장', authorRole: 'owner', createdAt: now } }).eq('id', id2);
    const r2 = await one(srv.from('work_feed').select('data').eq('id', id2));
    check('2-2 내 글을 고치며 이름·역할을 사장으로 바꿀 수 없다', r2?.data.authorName === 'QA직원J' && r2?.data.authorRole !== 'owner', JSON.stringify(r2?.data));
    const id3 = `wf_forg3_${s}`;
    await J.c.from('work_feed').upsert({ id: id3, unit_id: S1, feed_date: day, data: { id: id3, kind: 'message', text: '읽음 위조', authorId: J.id, createdAt: now, read_by: [O.id, K.id], reactions: { '👍': [O.id, K.id] } } });
    const r3 = await one(srv.from('work_feed').select('data').eq('id', id3));
    const rb = r3?.data.read_by ?? [], rx = r3?.data.reactions?.['👍'] ?? [];
    check('2-3 남이 읽었다·반응했다고 적어 올릴 수 없다', !rb.includes(O.id) && !rx.includes(O.id), JSON.stringify(r3?.data));
    // [OK] 앱의 '할 일 완료' 자동 글(직원이 만든다)은 계속 올라간다.
    const id4 = `fdone_${day}_wt_forg_${s}`;
    const { error: e4 } = await J.c.from('work_feed').upsert({ id: id4, unit_id: S1, feed_date: day, data: { id: id4, kind: 'task_done', text: 'QA직원J · 할일 완료', authorId: J.id, authorName: 'QA직원J', authorRole: 'junior', createdAt: now } }, { onConflict: 'id', ignoreDuplicates: true });
    check('2-4 [OK] 직원의 할 일 완료 글은 그대로 올라간다', !e4 && !!(await one(srv.from('work_feed').select('id').eq('id', id4))), e4?.message);
  }

  // ── 3. 업무방 변조 ─────────────────────────────────────────────────────────
  {
    await J.c.from('work_rooms').update({ deleted_at: now }).eq('id', defaultRoom);
    const d = await one(srv.from('work_rooms').select('deleted_at').eq('id', defaultRoom));
    check('3-1 직원이 기본방을 지울(deleted_at) 수 없다', d && d.deleted_at == null, JSON.stringify(d));
    await J.c.from('work_rooms').update({ is_default: true }).eq('id', privRoom);
    const p = await one(srv.from('work_rooms').select('is_default, created_by').eq('id', privRoom));
    check('3-2 직원이 비공개 방을 전체 공개(is_default)로 바꿀 수 없다', p && p.is_default === false, JSON.stringify(p));
    await J.c.from('work_rooms').update({ created_by: J.id }).eq('id', privRoom);
    const p2 = await one(srv.from('work_rooms').select('created_by').eq('id', privRoom));
    check('3-3 방 만든 사람을 바꿀 수 없다', p2?.created_by === O.id, JSON.stringify(p2));
    const { error: e4 } = await J.c.from('work_rooms').update({ name: '이름바꿈' }).eq('id', privRoom);
    const p3 = await one(srv.from('work_rooms').select('name').eq('id', privRoom));
    check('3-4 [OK] 방 멤버는 방 이름을 바꿀 수 있다', !e4 && p3?.name === '이름바꿈', e4?.message);
  }

  // ── 4. 인증번호 시도 제한 경쟁조건 ──────────────────────────────────────────
  {
    const ph = `0106${s.slice(0, 7)}`;
    const exp = new Date(Date.now() + 180_000).toISOString();
    await srv.from('phone_otps').upsert({ phone: ph, code_hash: createHash('sha256').update(`${ph}:123456`).digest('hex'), expires_at: exp, attempts: 0, verified_at: null });
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${URL}/functions/v1/otp`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', phone: ph, code: String(200000 + i) }),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) })).catch((e) => ({ status: 0, err: String(e) }))));
    const reached = rs.every((r) => r.status !== 0);
    const guesses = rs.filter((r) => r.reason === 'mismatch').length;
    check('4-1 틀린 번호를 동시에 20번 보내도 대조는 5번까지만 한다', reached && guesses <= 5, reached ? `mismatch=${guesses}` : `엣지 미기동 ${rs[0]?.err}`);
    await srv.from('phone_otps').delete().eq('phone', ph);
  }

  // ── 5. 질문함 위조 ─────────────────────────────────────────────────────────
  {
    const kq = `uq_k_${s}`;
    await K.c.from('unknown_queries').insert({ id: kq, unit_id: S1, query_text: 'K의 질문', status: 'pending_owner_answer' });
    const jq = `uq_j_${s}`;
    await J.c.from('unknown_queries').insert({ id: jq, unit_id: S1, junior_id: K.id, junior_name: 'QA직원K', query_text: '가짜', status: 'resolved_with_entry', answered_by: O.id, resolved_with_entry_id: E1 });
    const r1 = await one(srv.from('unknown_queries').select('junior_id, junior_name, status, answered_by').eq('id', jq));
    check('5-1 질문을 남의 이름·해결됨 상태로 넣을 수 없다', !r1 || (r1.junior_id === J.id && r1.junior_name !== 'QA직원K' && r1.status !== 'resolved_with_entry' && r1.answered_by == null), JSON.stringify(r1));
    await J.c.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: 'pe_없는노하우', answered_by: J.id }).eq('id', kq);
    const r2 = await one(srv.from('unknown_queries').select('status').eq('id', kq));
    check('5-2 동료가 없는 노하우로 남의 질문을 해결 처리할 수 없다', r2?.status === 'pending_owner_answer', JSON.stringify(r2));
    const { error: e3 } = await J.c.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: E1, answered_by: J.id }).eq('id', kq);
    const r3 = await one(srv.from('unknown_queries').select('status, answered_by').eq('id', kq));
    check('5-3 [OK] 동료가 실제 노하우로 답하면 해결되고 답한 사람이 남는다', !e3 && r3?.status === 'resolved_with_entry' && r3?.answered_by === J.id, e3?.message ?? JSON.stringify(r3));
    const { data: log } = await O.c.from('peer_answer_log').select('uq_id, answered_by, entry_id').eq('uq_id', kq);
    check('5-4 사장이 동료 답변 기록을 본다', (log ?? []).some((l) => l.answered_by === J.id && l.entry_id === E1), JSON.stringify(log));
  }

  // ── 6. 할 일 완료 위조 ─────────────────────────────────────────────────────
  {
    const t1 = `wt_forg_${s}`;
    await J.c.from('work_done').upsert({ unit_id: S1, work_date: day, template_id: t1, data: { by: K.id, byName: 'QA직원K', at: now } });
    const r1 = await one(srv.from('work_done').select('data').eq('template_id', t1));
    check('6-1 완료한 사람을 남으로 적을 수 없다', !r1 || r1.data.by === J.id, JSON.stringify(r1?.data));
    const t2 = `wt_forg_k_${s}`;
    await K.c.from('work_done').upsert({ unit_id: S1, work_date: day, template_id: t2, data: { by: K.id, byName: 'QA직원K', at: now } });
    const k0 = await one(srv.from('work_done').select('template_id').eq('template_id', t2));
    await J.c.from('work_done').delete().eq('template_id', t2);
    const r2 = await one(srv.from('work_done').select('template_id').eq('template_id', t2));
    check('6-2 남의 완료를 지울 수 없다', !!k0 && !!r2, k0 ? 'K 의 완료가 지워졌다' : 'K 완료 시드가 안 들어갔다');
  }

  // ── 7. 퀴즈·이해 확인 위조 ─────────────────────────────────────────────────
  {
    await J.c.from('quiz_attempts').insert({ id: `qa_forg_${s}`, unit_id: S1, entry_id: E1, staff_id: J.id, total: 10, correct: 10, course_id: C1 });
    const r1 = await one(srv.from('quiz_attempts').select('id').eq('id', `qa_forg_${s}`));
    check('7-1 응시 기록(맞힌 수)을 직접 넣을 수 없다', !r1, '들어갔다');
    await K.c.from('knowhow_understanding').upsert({ unit_id: S1, entry_id: E1, staff_name: 'QA직원K', verified_at: now }, { onConflict: 'entry_id,staff_id' });
    const r2 = await one(srv.from('knowhow_understanding').select('verified_at').eq('staff_id', K.id).eq('entry_id', E1));
    check('7-2 퀴즈를 맞히지 않고 이해 확인(verified_at)을 찍을 수 없다', !r2?.verified_at, JSON.stringify(r2));
    // [OK] 옛 앱 흐름: 문항 채점(grade_quiz) → 다 맞으면 이해 확인 저장(응시 기록 저장과 순서가 정해져 있지 않다).
    const { data: g } = await J.c.rpc('grade_quiz', { p_item_id: QI, p_response: 1 });
    await J.c.from('knowhow_understanding').upsert({ unit_id: S1, entry_id: E1, staff_name: 'QA직원J', verified_at: now }, { onConflict: 'entry_id,staff_id' });
    const r3 = await one(srv.from('knowhow_understanding').select('verified_at').eq('staff_id', J.id).eq('entry_id', E1));
    check('7-3 [OK] 문항을 맞힌 뒤의 이해 확인은 저장된다', !!(g?.[0]?.correct ?? g?.correct) && !!r3?.verified_at, JSON.stringify({ g, r3 }));
    await K.c.rpc('record_quiz_stats', { p_stats: [{ entry_id: E1, attempts: 10, misses: 10 }] }); // 앱과 같은 키(db.ts recordQuizStats) · 서버 상한 10
    const qs = await one(srv.from('knowhow_quiz_stats').select('attempt_count, miss_count').eq('entry_id', E1));
    check('7-4 푼 적 없는 문항으로 오답률 통계를 올릴 수 없다', (qs?.miss_count ?? 0) === 0, JSON.stringify(qs));
  }

  // ── 8. 노하우 제안 상태 위조 ───────────────────────────────────────────────
  {
    const id = `ps_forg_${s}`;
    await J.c.from('playbook_suggestions').insert({ id, unit_id: S1, kind: 'new', proposer_id: J.id, proposer_name: 'QA사장', text: '제안', status: 'approved', reviewed_by: O.id, reviewed_at: now, resulting_entry_id: E1 });
    const r = await one(srv.from('playbook_suggestions').select('status, reviewed_by, resulting_entry_id, proposer_name').eq('id', id));
    check('8-1 제안을 승인됨·검토자 사장으로 넣을 수 없다', !r || ((r.status ?? 'pending') === 'pending' && r.reviewed_by == null && r.resulting_entry_id == null), JSON.stringify(r));
    check('8-2 제안자 이름은 서버가 적는다', !r || r.proposer_name === 'QA직원J', JSON.stringify(r));
  }

  // ── 9. 검색 색인·통계 조작 ─────────────────────────────────────────────────
  {
    await must(srv.from('playbook_embeddings').upsert({ entry_id: E1, unit_id: S1, attempts: 0 }), 'embedding');
    await J.c.from('playbook_embeddings').update({ attempts: 99, last_error: 'forged' }).eq('entry_id', E1);
    const r = await one(srv.from('playbook_embeddings').select('attempts').eq('entry_id', E1));
    check('9-1 직원이 검색 색인 행을 고칠 수 없다', r?.attempts === 0, JSON.stringify(r));
    await J.c.from('playbook_embeddings').delete().eq('entry_id', E1);
    check('9-2 직원이 검색 색인 행을 지울 수 없다', !!(await one(srv.from('playbook_embeddings').select('entry_id').eq('entry_id', E1))));
  }

  // ── 10. 출퇴근 (나): 고칠 수 있지만 흔적은 위조할 수 없고 사장에게 보인다 ──────────
  {
    const id = `att_forg_${s}`;
    // [OK] 출근 버튼(지금 시각)은 수정이 아니다.
    const { error: e0 } = await J.c.from('attendance').upsert({ id, unit_id: S1, staff_id: J.id, date: day, check_in: new Date().toISOString(), check_out: null, work_minutes: 0, edited_by: null });
    const r0 = await one(srv.from('attendance').select('edited_by').eq('id', id));
    check('10-1 [OK] 출근 버튼 기록은 수정 표시가 없다', !e0 && r0 && r0.edited_by == null, e0?.message ?? JSON.stringify(r0));
    const ci = `${day}T00:00:00.000Z`, co = `${day}T01:00:00.000Z`;
    const { error: e1 } = await J.c.from('attendance').upsert({ id, unit_id: S1, staff_id: J.id, date: day, check_in: ci, check_out: co, work_minutes: 999, edited_by: 'owner' });
    const r1 = await one(srv.from('attendance').select('edited_by, work_minutes').eq('id', id));
    check('10-2 [OK] 직원은 자기 기록을 고칠 수 있다', !e1 && !!r1, e1?.message);
    check('10-3 고친 표시를 사장으로 적을 수 없다(직원 수정으로 남는다)', r1?.edited_by === 'staff', JSON.stringify(r1));
    check('10-4 근무 분은 서버가 출퇴근 시각으로 센다', r1?.work_minutes === 60, JSON.stringify(r1));
    await J.c.from('attendance').update({ edited_by: null }).eq('id', id);
    const r2 = await one(srv.from('attendance').select('edited_by').eq('id', id));
    check('10-5 직원 수정 표시를 지울 수 없다', r2?.edited_by === 'staff', JSON.stringify(r2));
    const { data: hist } = await O.c.from('attendance_edits').select('attendance_id, old_check_in, new_check_in, edited_by_uid').eq('attendance_id', id);
    check('10-6 사장이 고치기 전 값을 본다', (hist ?? []).some((h) => h.edited_by_uid === J.id && h.new_check_in), JSON.stringify(hist));
    await J.c.from('attendance_edits').delete().eq('attendance_id', id);
    const { count } = await srv.from('attendance_edits').select('attendance_id', { count: 'exact', head: true }).eq('attendance_id', id);
    check('10-7 직원이 수정 이력을 지울 수 없다', (count ?? 0) > 0, `count=${count}`);
    const { data: kh } = await K.c.from('attendance_edits').select('attendance_id').eq('attendance_id', id);
    check('10-8 다른 직원은 남의 수정 이력을 못 읽는다', (kh ?? []).length === 0, JSON.stringify(kh));
  }

  // ── 11. 게스트 퀴즈 번호 사칭 ──────────────────────────────────────────────
  {
    const tok = `tok_forg_${s}_padpadpadpad`; // 0160 토큰 20자 이상
    await must(srv.from('quiz_links').insert({ id: `ql_forg_${s}`, unit_id: S1, course_id: C1, token: tok, expires_at: new Date(Date.now() + 86400_000).toISOString(), created_by: O.id }), 'quiz_link');
    const victim = `0109${s.slice(0, 7)}`;
    const anon = mk();
    const { error: e1 } = await anon.rpc('quiz_link_submit', { p_token: tok, p_guest_name: '사칭', p_guest_phone: victim, p_phone_verified: true, p_answers: [{ item_id: QI, response: 1 }] });
    const { data: rows } = await srv.from('quiz_attempts').select('guest_phone_verified').eq('guest_phone', victim);
    check('11-1 인증 안 한 번호를 인증됨으로 저장할 수 없다', !e1 && (rows ?? []).length > 0 && rows.every((r) => r.guest_phone_verified !== true), e1?.message ?? JSON.stringify(rows));
    let blocked = false;
    for (let i = 0; i < 35 && !blocked; i++) { // 0321 상한 = 10분 30회
      const { error } = await anon.rpc('quiz_link_submit', { p_token: tok, p_guest_name: `반복${i}`, p_guest_phone: null, p_phone_verified: false, p_answers: [{ item_id: QI, response: 0 }] });
      if (error) blocked = /too_many/.test(error.message);
    }
    check('11-2 링크 하나로 짧은 시간에 끝없이 제출할 수 없다', blocked);
  }

  // ── 14. 코드 대입 ──────────────────────────────────────────────────────────
  {
    // 인증된 번호 계정은 10분 5회에 잠긴다.
    const A1 = await signUp(`qa_forg_a1_${s}@example.com`, { name: 'QA대입1', role: 'junior', phone: phones[4] });
    for (let i = 0; i < 5; i++) await A1.c.rpc('join_by_invite', { p_code: String(100000 + i) });
    const { error: e0 } = await A1.c.rpc('join_by_invite', { p_code: '999998' });
    check('14-1 초대코드를 5번 틀리면 잠긴다', /too_many_attempts/.test(e0?.message ?? ''), e0?.message ?? '잠기지 않았다');
    // 같은 역할은 번호를 같이 못 쓴다 → 새 계정은 번호 없는 계정이 된다. 번호 없는 계정은 아예 대입할 수 없어야 한다.
    const A2 = await signUp(`qa_forg_a2_${s}@example.com`, { name: 'QA대입2', role: 'junior', phone: phones[4] });
    const { error: e1 } = await A2.c.rpc('join_by_invite', { p_code: '999999' });
    check('14-1b 번호 인증 없는 새 계정으로는 초대코드를 대입할 수 없다', /PHONE_NOT_VERIFIED|too_many_attempts/.test(e1?.message ?? ''), e1?.message ?? '대입이 됐다');
    let locked = false;
    for (let i = 0; i < 7 && !locked; i++) {
      const { error } = await O.c.rpc('redeem_promo_code', { p_code: `NOPE${s}${i}` });
      locked = /too_many_attempts/.test(error?.message ?? '');
    }
    check('14-2 할인 코드를 계속 대입하면 잠긴다', locked);
  }

  // ── 1. 가짜 푸시 (로컬 엣지) ───────────────────────────────────────────────
  {
    const probe = await push(J.token, { audience: 'owners', title: 'x' });
    if (probe.status === 0) { check('1-0 로컬 엣지가 떠 있다(npx supabase functions serve)', false, probe.err); }
    else {
      check('1-1 직원이 사장에게 아무 문구나 보낼 수 없다', pushBlocked(probe), JSON.stringify(probe));
      const r2 = await push(J.token, { audience: 'staff', tag: 'swap', title: '대타 요청', body: '가짜' });
      check('1-2 대타 요청이 없는데 대타 푸시를 보낼 수 없다', pushBlocked(r2), JSON.stringify(r2));
      const r3 = await push(J.token, { audience: 'owners', tag: 'question', itemId: `uq_k_${s}`, title: '답변 대기 질문', body: '가짜' });
      check('1-3 남의 질문으로 질문 푸시를 보낼 수 없다', pushBlocked(r3), JSON.stringify(r3));
      const r4 = await push(J.token, { audience: 'user', userId: K.id, tag: 'mention', itemId: `wf_forg1_${s}x`, title: '사장님이 나를 언급했어요', body: '가짜' });
      check('1-4 없는 글로 멘션 푸시를 보낼 수 없다', pushBlocked(r4), JSON.stringify(r4));
      const r5 = await push(J.token, { audience: 'user', userId: K.id, tag: 'assign', itemId: 'wt_없음', title: '배정', body: '가짜' });
      check('1-5 없는 할 일로 배정 푸시를 보낼 수 없다', pushBlocked(r5), JSON.stringify(r5));
      const r6 = await push(J.token, { audience: 'user', userId: K.id, tag: 'swap-req', title: '맞교환 요청', body: '가짜' });
      check('1-6 맞교환 요청 없이 맞교환 푸시를 보낼 수 없다', pushBlocked(r6), JSON.stringify(r6));
      const r7 = await push(J.token, { audience: 'owners', tag: 'quiz-done', itemId: C1, title: '다 풀었어요', body: '가짜' });
      check('1-7 퀴즈를 끝내지 않고 완료 푸시를 보낼 수 없다', pushBlocked(r7), JSON.stringify(r7));
      const r8 = await push(K.token, { audience: 'owners', tag: 'suggestion', ownerOnly: true, title: '제안', body: '가짜' });
      check('1-8 제안 없이 제안 푸시를 보낼 수 없다(제안 안 한 K)', pushBlocked(r8), JSON.stringify(r8));
      // [OK] 실제 사건이 있으면 옛 앱 요청이 그대로 간다.
      const jq = `uq_jok_${s}`;
      await J.c.from('unknown_queries').insert({ id: jq, unit_id: S1, query_text: '진짜 질문', status: 'pending_owner_answer' });
      const ok1 = await push(J.token, { audience: 'owners', tag: 'question', itemId: jq, title: '답변 대기 질문', body: '진짜 질문' });
      check('1-9 [OK] 내 질문의 푸시는 사장에게 간다', pushDelivered(ok1), JSON.stringify(ok1));
      const dup = await push(J.token, { audience: 'owners', tag: 'question', itemId: jq, title: '답변 대기 질문', body: '진짜 질문' });
      check('1-10 같은 사건으로 푸시를 두 번 보낼 수 없다', pushBlocked(dup), JSON.stringify(dup));
      const fid = `wf_jm_${s}`;
      await J.c.from('work_feed').upsert({ id: fid, unit_id: S1, feed_date: day, mentions: [K.id], data: { id: fid, kind: 'message', text: '@K 확인', authorId: J.id, authorName: 'QA직원J', createdAt: now, mentions: [K.id] } });
      const ok2 = await push(J.token, { audience: 'user', userId: K.id, tag: 'mention', itemId: fid, title: 'QA직원J님이 나를 언급했어요', body: '@K 확인' });
      check('1-11 [OK] 내 글의 멘션 푸시는 간다', pushDelivered(ok2), JSON.stringify(ok2));
      const ok3 = await push(P.token, { audience: 'join_owners', tag: 'join', itemId: P.id, title: '합류 신청', body: 'QA신청P님이 합류를 신청했어요' });
      check('1-12 [OK] 합류 신청 푸시는 사장에게 간다', pushDelivered(ok3), JSON.stringify(ok3));
    }
  }
} finally {
  // 로컬 전용이라 매장·계정은 남겨도 되지만, 인증 시드는 지운다(qa-otp-seed 와 같은 이유).
  await srv.from('phone_otps').delete().in('phone', phones);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
