// 0333 이해 기록 경합 — 출시 앱(ios-v1.0.1 · android-v1.0.3)의 실제 호출 순서·모양으로 로컬 DB 에서 본다. 자가정리.
//   출시 앱 UnderstandingCheckSheet: recordStaffQuizAttempt(quiz_staff_record · p_rows 만)를 기다리지 않고
//   다 맞으면 onPass → insertKnowhowUnderstanding(upsert {unit_id, entry_id, staff_name, verified_at} onConflict entry_id,staff_id)을 바로 보낸다.
//   기대: upsert 는 어떤 순서에서도 오류가 없다(출시 앱에 "이해 확인 저장에 실패했어요"가 뜨지 않는다).
//         이해 기록은 서버가 제출 안에서 쓴다(그 노하우 문항 전부 정답일 때만). 근거 없는 upsert 는 조용히 무시된다.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const st = Object.fromEntries(
  execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const URL = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY;
if (!URL || !/^http:\/\/127\.0\.0\.1:/.test(URL)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL); process.exit(2); }
const opt = { auth: { persistSession: false, autoRefreshToken: false } };
const mk = () => createClient(URL, ANON, opt);
const srv = createClient(URL, SRV, opt);
const s = String(Date.now()).slice(-8), p = 'qa_race_' + s, pw = 'Test1234!qa';
const phones = ['0106', '0107', '0108', '0109'].map((x) => `${x}${s.slice(0, 7)}`);
const users = [], units = [];
let fails = 0;
const check = (id, ok, detail) => { if (!ok) fails++; console.log(ok ? 'GREEN' : 'RED  ', id, JSON.stringify(detail ?? '')); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data; };
const signUp = async (email, meta, phone) => {
  const c = mk();
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', phone, ...meta } } });
  if (error || !data.session) throw new Error(`signUp ${email}: ${error?.message ?? 'no session'}`);
  users.push(data.user.id); c.uid = data.user.id; return c;
};
// 출시 앱 db.ts insertKnowhowUnderstanding 그대로(staff_id 없음 · DB default auth.uid()).
const oldUpsert = (c, unit, entryIds) => c.from('knowhow_understanding').upsert(
  entryIds.map((entry_id) => ({ unit_id: unit, entry_id, staff_name: 'QA직원', verified_at: new Date().toISOString() })),
  { onConflict: 'entry_id,staff_id' },
);
// 출시 앱 db.ts recordStaffQuizAttempt 그대로(옛 서명).
const oldRecord = (c, rows) => c.rpc('quiz_staff_record', { p_rows: rows.map((r, i) => ({ item_id: r.item, response: r.response, ord: i })) });
const ku = async (uid, entry) => (await must(srv.from('knowhow_understanding').select('verified_at,staff_name,unit_id').eq('staff_id', uid).eq('entry_id', entry), 'ku'))[0] ?? null;
const reset = async () => { await srv.from('knowhow_understanding').delete().in('staff_id', users); };

const now = new Date().toISOString();
await srv.from('phone_otps').upsert(phones.map((phone) => ({ phone, code_hash: 'qa-seed', expires_at: now, verified_at: now })));
try {
  const O = await signUp(`${p}_o@example.com`, { name: 'QA사장', role: 'owner' }, phones[0]);
  const cs = await must(O.rpc('create_store', { p_store_name: `경합 ${s}`, p_industry: '카페·디저트', p_biz_no: null }), 'create_store');
  const UNIT = cs[0].unit_id; units.push(UNIT);
  const J = await signUp(`${p}_j@example.com`, { name: 'QA직원', role: 'junior' }, phones[1]);
  await must(J.rpc('join_by_invite', { p_code: cs[0].invite_code }), 'join'); await must(O.rpc('approve_member', { p_uid: J.uid }), 'approve');
  // 다른 매장(사장 O2 · 직원 X)
  const O2 = await signUp(`${p}_o2@example.com`, { name: 'QA사장2', role: 'owner' }, phones[2]);
  const cs2 = await must(O2.rpc('create_store', { p_store_name: `경합B ${s}`, p_industry: '카페·디저트', p_biz_no: null }), 'create_store2');
  units.push(cs2[0].unit_id);
  const X = await signUp(`${p}_x@example.com`, { name: 'QA남', role: 'junior' }, phones[3]);
  await must(X.rpc('join_by_invite', { p_code: cs2[0].invite_code }), 'join2'); await must(O2.rpc('approve_member', { p_uid: X.uid }), 'approve2');

  const E = [1, 2, 3].map((i) => `${p}_e${i}`);
  for (const id of E) await must(O.from('playbook_entries').insert({ id, unit_id: UNIT, creator_id: O.uid, creator_name: 'QA', category: 'Know-how', subcategory: '일반', title: id, tags: [], search_keywords: [], square: { situation: '마감', action: { steps: ['잠근다'] }, extract: { do: '잠근다', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' }, execution: { tone: '친절', timing: '마감', channel: '구두', stakeholders: [] }, stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 }, photos: [], version: 1, status: 'published', quality_score: 0.6, is_template: false, needs_review: false, correction_points: [], order_index: 0 }), 'entry');
  const C = `${p}_A`;
  await must(O.from('training_courses').insert({ id: C, unit_id: UNIT, key: C, name: p, min_items: 1, max_items: 10, position: 0, active: true, audience: 'staff', start_at: null, due_days: null }), 'course');
  for (const entry_id of E) await must(O.from('course_entries').insert({ course_id: C, entry_id, unit_id: UNIT }), 'ce');
  const mc = (ask) => ({ ask, choices: ['정답', '오답', '다른 답', '모름'], answer_index: 0, explain: 'QA' });
  const I = { e1a: `${p}_i1a`, e1b: `${p}_i1b`, e2: `${p}_i2`, e3: `${p}_i3` };
  await must(O.from('quiz_items').insert([
    { id: I.e1a, entry_ids: [E[0]] }, { id: I.e1b, entry_ids: [E[0]] }, { id: I.e2, entry_ids: [E[1]] }, { id: I.e3, entry_ids: [E[2]] },
  ].map((x) => ({ ...x, unit_id: UNIT, course_id: C, kind: 't0', format: 'mc4', payload: mc(x.id), source: 'owner', status: 'active', created_by: O.uid }))), 'items');
  // 발송(출시 앱이 실제로 받는 상태)
  await must(srv.from('quiz_assignments').insert({ id: `${p}_as`, unit_id: UNIT, course_id: C, user_id: J.uid, scheduled_on: now.slice(0, 10), sent_at: new Date(Date.now() - 60000).toISOString() }), 'assign');
  const allRight = [{ item: I.e1a, response: 0 }, { item: I.e1b, response: 0 }];

  // R1 upsert 먼저(응시 저장보다 먼저 닿음) → 오류 없음 · 응시 저장 뒤 이해 기록 있음
  {
    await reset();
    const up = await oldUpsert(J, UNIT, [E[0]]);
    const before = await ku(J.uid, E[0]);
    const rec = await oldRecord(J, allRight);
    const after = await ku(J.uid, E[0]);
    check('R1 upsert 먼저 → 오류 없음 · 제출 뒤 서버가 기록', !up.error && !rec.error && !before && !!after?.verified_at, { upsertError: up.error?.message ?? null, before, after, rec: rec.error?.message ?? 'ok' });
  }
  // R2 응시 저장 먼저 → upsert 오류 없음 · 기록 있음
  {
    await reset();
    const rec = await oldRecord(J, allRight);
    const mid = await ku(J.uid, E[0]);
    const up = await oldUpsert(J, UNIT, [E[0]]);
    const after = await ku(J.uid, E[0]);
    check('R2 응시 먼저 → 서버가 이미 기록 · upsert 오류 없음', !rec.error && !up.error && !!mid?.verified_at && !!after?.verified_at, { upsertError: up.error?.message ?? null, mid, after });
  }
  // R3 출시 앱 그대로: 기다리지 않고 동시에(10회 반복)
  {
    let errs = 0, missing = 0;
    for (let k = 0; k < 10; k++) {
      await reset();
      const [rec, up] = await Promise.all([oldRecord(J, allRight), oldUpsert(J, UNIT, [E[0]])]);
      if (rec.error || up.error) errs++;
      if (!(await ku(J.uid, E[0]))?.verified_at) missing++;
    }
    check('R3 동시 전송 10회 → 오류 0 · 기록 누락 0', errs === 0 && missing === 0, { errs, missing });
  }
  // R4 채점만 반복(제출 없음) → 오류 없음 · 기록 없음
  {
    await reset();
    for (let k = 0; k < 3; k++) await must(J.rpc('grade_quiz', { p_item_id: I.e2, p_response: 0 }), 'grade');
    const up = await oldUpsert(J, UNIT, [E[1]]);
    const row = await ku(J.uid, E[1]);
    check('R4 채점만 반복 → upsert 오류 없음 · 기록 없음', !up.error && !row, { upsertError: up.error?.message ?? null, row });
  }
  // R5 같은 노하우 문항 하나라도 틀리면 그 노하우는 기록 안 됨 · 다른 노하우(다 맞음)는 기록
  {
    await reset();
    const rec = await oldRecord(J, [{ item: I.e1a, response: 0 }, { item: I.e1b, response: 1 }, { item: I.e2, response: 0 }]);
    const up = await oldUpsert(J, UNIT, [E[0], E[1]]);
    const e1 = await ku(J.uid, E[0]), e2 = await ku(J.uid, E[1]);
    check('R5 부분 오답 노하우 기록 안 됨 · 전부 정답 노하우만 기록', !rec.error && !up.error && !e1 && !!e2?.verified_at, { e1, e2, upsertError: up.error?.message ?? null });
  }
  // R6 다른 매장: X(매장 B) 가 매장 A 노하우로 upsert → 행 없음 · 서버 기록도 다른 매장에 안 생김
  {
    await reset();
    const up = await oldUpsert(X, UNIT, [E[2]]);
    const row = await ku(X.uid, E[2]);
    const recX = await oldRecord(X, [{ item: I.e3, response: 0 }]);
    const row2 = await ku(X.uid, E[2]);
    check('R6 다른 매장 → 이해 기록 없음', !row && !row2, { upsertError: up.error?.message ?? null, recX: recX.error?.message ?? recX.data, row, row2 });
  }
  // R7 정상 통과(새 앱): v2 제출을 기다린 뒤 upsert · 이미 있는 행의 갱신
  {
    await reset();
    const v2 = await J.rpc('quiz_staff_record_v2', { p_course_id: C, p_request_id: `${p}_v2`, p_rows: [{ item_id: I.e3, response: 0, ord: 0 }] });
    const first = await ku(J.uid, E[2]);
    const up = await oldUpsert(J, UNIT, [E[2]]);
    check('R7 새 앱 정상 통과 → 기록 있음 · upsert 오류 없음 · 이름은 서버 값', !v2.error && !up.error && !!first?.verified_at && first?.staff_name === 'QA직원', { first, upsertError: up.error?.message ?? null });
  }
  // R8 근거 없는 upsert 는 있던 기록을 바꾸지 않는다(UPDATE 경로)
  {
    await reset();
    const old = '2026-01-01T00:00:00+00:00';
    await must(srv.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: E[1], staff_id: J.uid, staff_name: 'QA직원', verified_at: old }), 'seed');
    await srv.from('quiz_attempt_items').delete().eq('staff_id', J.uid).contains('entry_ids', [E[1]]);
    const up = await oldUpsert(J, UNIT, [E[1]]);
    const row = await ku(J.uid, E[1]);
    check('R8 근거 없는 upsert → 오류 없음 · 기존 시각 유지', !up.error && Date.parse(row?.verified_at) === Date.parse(old), { upsertError: up.error?.message ?? null, row });
  }
} catch (e) {
  console.log('SETUP FAIL', e.message); fails++;
} finally {
  for (const u of units) {
    for (const t of ['quiz_attempt_items', 'quiz_attempts', 'quiz_grade_log', 'knowhow_understanding', 'knowhow_quiz_stats', 'quiz_assignments', 'quiz_items', 'course_entries', 'training_courses', 'playbook_entries']) {
      const r = await srv.from(t).delete().eq('unit_id', u); if (r.error) console.log('cleanup', t, r.error.message);
    }
    const r = await srv.from('units').delete().eq('id', u); if (r.error) { console.log('cleanup units', r.error.message); fails++; }
  }
  for (const id of users) { const r = await srv.auth.admin.deleteUser(id); if (r.error) { console.log('cleanup user', r.error.message); fails++; } }
  await srv.from('phone_otps').delete().in('phone', phones);
}
console.log('RESULT', fails ? 'RED' : 'GREEN', `fail=${fails}`);
process.exitCode = fails ? 1 : 0;
