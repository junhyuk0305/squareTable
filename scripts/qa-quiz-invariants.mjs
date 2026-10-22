// 퀴즈 불변식 I1~I8 (근본원인_개발계획_2026-10-22 §5 P1). 로컬 도커 전용 · 자가정리.
// 시나리오가 아니라 "같은 fixture 에서 여러 경로가 같은 답을 내는가"를 본다. 지금은 RED 가 정상인 항목이 있다(계획서 표).
// 건너뛴 항목(함수 없음·셋업 실패)은 FAIL 로 센다. --expect-red 같은 예외는 두지 않는다.
// TS 판정은 qa-quiz-progress 와 같은 방식(tsc → 임시 폴더 commonjs)으로 불러온다.
// 아직 단일 함수가 없는 판정(홈 개수·카드 수·벨 수, P3 에서 생김)은 현재 코드 경로를 그대로 옮겨 재현한다.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const st = Object.fromEntries(
  execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const URL = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY;
if (!URL || !/^http:\/\/127\.0\.0\.1:/.test(URL)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL); process.exit(2); }

const out = mkdtempSync(join(tmpdir(), 'quiz-inv-'));
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/lib/quiz/courseItems.ts', 'src/lib/quiz/progress.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--ignoreConfig'], { stdio: 'pipe' });
const req = createRequire(import.meta.url);
const { itemsOfCourse } = req(join(out, 'courseItems.js'));
const { quizTodo } = req(join(out, 'progress.js'));

const opt = { auth: { persistSession: false, autoRefreshToken: false } };
const mk = () => createClient(URL, ANON, opt);
const srv = createClient(URL, SRV, opt);
const anon = mk();
const s = String(Date.now()).slice(-8), p = 'qa_inv_' + s, pw = 'Test1234!qa';
const phones = ['0106', '0107', '0108'].map((x) => `${x}${s.slice(0, 7)}`);
const users = [];
let fails = 0;
const results = [];
const check = (id, ok, detail) => { if (!ok) fails++; results.push([id, ok ? 'GREEN' : 'RED']); console.log(ok ? 'GREEN' : 'RED  ', id, JSON.stringify(detail ?? '')); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data; };
const signUp = async (email, meta, phone) => {
  const c = mk();
  const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', phone, ...meta } } });
  if (error || !data.session) throw new Error(`signUp ${email}: ${error?.message ?? 'no session'}`);
  users.push(data.user.id); c.uid = data.user.id; return c;
};
const servable = async (unit, course) => { const r = await srv.rpc('quiz_course_servable', { p_unit: unit, p_course: course }); return r.error ? { err: r.error.message } : r.data.map((q) => q.id).sort(); };
const run = async (id, fn) => { try { await fn(); } catch (e) { check(id, false, 'skip=fail: ' + e.message); } };

let UNIT;
const now = new Date().toISOString();
await srv.from('phone_otps').upsert(phones.map((phone) => ({ phone, code_hash: 'qa-seed', expires_at: now, verified_at: now })));
try {
  // ── fixture: 매장 1 · 사장 1 · 직원 2 · 손님(anon) 1 ──
  const O = await signUp(`${p}_o@example.com`, { name: 'QA사장', role: 'owner' }, phones[0]);
  const cs = await must(O.rpc('create_store', { p_store_name: `불변식 ${s}`, p_industry: '카페·디저트', p_biz_no: null }), 'create_store');
  UNIT = cs?.[0]?.unit_id; const code = cs?.[0]?.invite_code;
  const S1 = await signUp(`${p}_s1@example.com`, { name: 'QA직원1', role: 'junior' }, phones[1]);
  const S2 = await signUp(`${p}_s2@example.com`, { name: 'QA직원2', role: 'junior' }, phones[2]);
  for (const u of [S1, S2]) { await must(u.rpc('join_by_invite', { p_code: code }), 'join'); await must(O.rpc('approve_member', { p_uid: u.uid }), 'approve'); }

  // 노하우 3
  const E = [1, 2, 3].map((i) => `${p}_e${i}`);
  for (const id of E) await must(O.from('playbook_entries').insert({ id, unit_id: UNIT, creator_id: O.uid, creator_name: 'QA', category: 'Know-how', subcategory: '일반', title: id, tags: [], search_keywords: [], square: { situation: '마감', action: { steps: ['잠근다'] }, extract: { do: '잠근다', dont: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' }, execution: { tone: '친절', timing: '마감', channel: '구두', stakeholders: [] }, stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: 0, resolution_rate: 0 }, photos: [], version: 1, status: 'published', quality_score: 0.6, is_template: false, needs_review: false, correction_points: [], order_index: 0 }), 'entry');
  // 퀴즈 A(보냄) B(보냄) C(초안) L(링크 전용)
  const C = { A: `${p}_A`, B: `${p}_B`, C: `${p}_C`, L: `${p}_L` };
  const courseEntries = { A: [E[0], E[1]], B: [E[1], E[2]], C: [E[0]], L: [E[2]] };
  for (const [k, id] of Object.entries(C)) {
    await must(O.from('training_courses').insert({ id, unit_id: UNIT, key: id, name: `${p} ${k}`, min_items: 1, max_items: 10, position: 0, active: true, audience: k === 'L' ? 'guest' : 'staff', start_at: null, due_days: null }), 'course');
    for (const entry_id of courseEntries[k]) await must(O.from('course_entries').insert({ course_id: id, entry_id, unit_id: UNIT }), 'course_entries');
  }
  const mc = (ask) => ({ ask, choices: ['정답', '오답', '다른 답', '모름'], answer_index: 0, explain: 'QA' });
  const item = (id, course_id, entry_ids) => ({ id, unit_id: UNIT, course_id, entry_ids, kind: 't0', format: 'mc4', payload: mc(id), source: 'owner', status: 'active', created_by: O.uid });
  const I = { a1: `${p}_ia1`, a2: `${p}_ia2`, a3: `${p}_ia3`, b1: `${p}_ib1`, c1: `${p}_ic1`, l1: `${p}_il1`, sh: `${p}_ish` };
  await must(O.from('quiz_items').insert([
    item(I.a1, C.A, [E[0]]),
    item(I.a2, C.A, [E[0], E[1]]), // 근거 2개 문항
    item(I.a3, C.A, [E[2]]),       // A 소속이지만 A 의 노하우 밖(N06: TS 는 세고 서버는 안 낸다)
    item(I.b1, C.B, [E[2]]),
    item(I.c1, C.C, [E[0]]),
    item(I.l1, C.L, [E[2]]),
  ]), 'items');

  // I3: 공유(course_id null) 문항. 옛 앱처럼 사장 세션으로 넣어 본다. 거부되면 GREEN(P2 NOT NULL 뒤).
  await run('I3 course_id null 활성 문항 0개 (공유 문항 insert 거부)', async () => {
    const ins = await O.from('quiz_items').insert(item(I.sh, null, [E[1]]));
    const nulls = await must(srv.from('quiz_items').select('id').eq('unit_id', UNIT).eq('status', 'active').is('course_id', null), 'nulls');
    check('I3 course_id null 활성 문항 0개 (공유 문항 insert 거부)', !!ins.error && nulls.length === 0, { insertError: ins.error?.message ?? null, activeNull: nulls.length });
  });

  // 발송: S1←A(두 번: 다시 알리기), S1←B, S2←A. 링크: A·B·L
  const day = now.slice(0, 10), past = (m) => new Date(Date.now() - m * 60000).toISOString();
  const AS = { s1a: `${p}_as_s1a`, s1a2: `${p}_as_s1a2`, s1b: `${p}_as_s1b`, s2a: `${p}_as_s2a` };
  await must(srv.from('quiz_assignments').insert([
    { id: AS.s1a, unit_id: UNIT, course_id: C.A, user_id: S1.uid, scheduled_on: day, sent_at: past(30) },
    { id: AS.s1a2, unit_id: UNIT, course_id: C.A, user_id: S1.uid, scheduled_on: new Date(Date.now() + 86400000).toISOString().slice(0, 10), sent_at: past(20) }, // 다시 알리기(발송일 다름)
    { id: AS.s1b, unit_id: UNIT, course_id: C.B, user_id: S1.uid, scheduled_on: day, sent_at: past(30) },
    { id: AS.s2a, unit_id: UNIT, course_id: C.A, user_id: S2.uid, scheduled_on: day, sent_at: past(30) },
  ]), 'assignments');
  const T = { A: crypto.randomUUID().replaceAll('-', ''), B: crypto.randomUUID().replaceAll('-', ''), L: crypto.randomUUID().replaceAll('-', '') };
  for (const k of ['A', 'B', 'L']) await must(O.from('quiz_links').insert({ id: `${p}_link_${k}`, course_id: C[k], unit_id: UNIT, token: T[k], expires_at: new Date(Date.now() + 3600000).toISOString(), created_by: O.uid }), 'link');

  // I1: 퀴즈마다 servable = 직원 출제 = 링크 출제 = 사장 화면(TS itemsOfCourse)
  await run('I1 문항 수 4경로 일치', async () => {
    const ownerItems = (await must(O.from('quiz_items').select('*').eq('unit_id', UNIT), 'owner items')).filter((q) => q.status === 'active');
    const detail = {}; let ok = true;
    for (const k of ['A', 'B', 'L']) {
      const sv = await servable(UNIT, C[k]);
      if (sv.err) throw new Error('quiz_course_servable ' + sv.err);
      const staff = k === 'L' ? null : (await must(S1.rpc('quiz_assignment_progress', { p_course_id: C[k] }), 'progress')).at(-1)?.total_items ?? -1;
      const link = (await must(anon.rpc('quiz_link_items', { p_token: T[k] }), 'link items')).length;
      const liveEntries = (await must(O.from('playbook_entries').select('id,archived_at,brand_hidden_at').eq('unit_id', UNIT), 'entries'));
      const ts = itemsOfCourse(ownerItems, C[k], courseEntries[k], liveEntries).length;
      detail[k] = { servable: sv.length, staff, link, ts };
      if ((staff !== null && staff !== sv.length) || link !== sv.length || ts !== sv.length) ok = false;
    }
    check('I1 문항 수 4경로 일치', ok, detail);
  });

  // I7: 같은 입력(직원 1의 발송·진행)으로 홈 개수 = 카드 수 = 벨 수.
  //   P3 뒤 세 곳은 quizTodo 하나를 부른다(useJuniorHomeData · notifications myQuizTodo · WorkBoard 변경안).
  //   그래서 여기서는 그 함수가 서버 진행으로 계약대로 고르는지를 같이 본다:
  //   재발송(A 두 번)은 최신 발송 하나 · 1회성은 앞선 하나 · state 는 서버(0332)가 준다.
  await run('I7 홈 = 카드 = 벨', async () => {
    const asg = (await must(S1.from('quiz_assignments').select('*').eq('unit_id', UNIT), 'my assignments'))
      .map((a) => ({ id: a.id, courseId: a.course_id, userId: a.user_id, sentAt: a.sent_at, completedAt: a.completed_at }));
    const prog = (await must(S1.rpc('quiz_assignment_progress', { p_course_id: null }), 'progress'))
      .map((r) => ({ assignmentId: r.assignment_id, pendingEntryIds: r.pending_entry_ids ?? [], totalItems: r.total_items, answeredItems: r.answered_items, state: r.state }));
    const courses = [C.A, C.B, C.C].map((id) => ({ id, dueDays: null })); // 1회성 퀴즈 · 카드 순서
    const sentCourses = courses.filter((c) => asg.some((a) => a.courseId === c.id));
    const home = quizTodo(asg, prog, { userId: S1.uid, courses: sentCourses });
    const cards = quizTodo(asg, prog, { userId: S1.uid, courses: sentCourses });
    const bell = quizTodo(asg, prog, { userId: S1.uid, courses: courses.filter((c) => asg.some((a) => a.userId === S1.uid && a.sentAt && a.courseId === c.id)) });
    const states = Object.fromEntries(prog.map((p) => [p.assignmentId, p.state]));
    const ok = home.length === cards.length && cards.length === bell.length
      && home.length === 1 && home[0].assignment.id === AS.s1a2 && states[AS.s1a2] === 'todo';
    check('I7 홈 = 카드 = 벨', ok, { home: home.length, cards: cards.length, bell: bell.length, picked: home.map((t) => t.assignment.id), states });
  });

  // I4: 발송마다 progress.total = servable 수. answered=total>0 일 때만 완료 true.
  await run('I4 진행 total=servable · 완료는 다 풀었을 때만', async () => {
    const svA = await servable(UNIT, C.A); if (svA.err) throw new Error(svA.err);
    const svB = await servable(UNIT, C.B); if (svB.err) throw new Error(svB.err);
    const prog1 = await must(S1.rpc('quiz_assignment_progress', { p_course_id: null }), 'progress1');
    const prog2 = await must(S2.rpc('quiz_assignment_progress', { p_course_id: null }), 'progress2');
    const want = { [AS.s1a]: svA.length, [AS.s1a2]: svA.length, [AS.s1b]: svB.length, [AS.s2a]: svA.length };
    const totals = Object.fromEntries([...prog1, ...prog2].map((r) => [r.assignment_id, r.total_items]));
    const totalsOk = Object.entries(want).every(([id, n]) => totals[id] === n);
    const early = await must(S1.rpc('mark_quiz_completed', { p_id: AS.s1a2 }), 'mark early');
    // S2 는 A 를 일부만, S1 은 A 를 전부 푼다(정답).
    await must(S2.rpc('quiz_staff_record_v2', { p_course_id: C.A, p_request_id: p + '_s2a', p_rows: [{ item_id: svA[0], response: 0, ord: 0 }] }), 's2 submit');
    const part = await must(S2.rpc('mark_quiz_completed', { p_id: AS.s2a }), 'mark part');
    await must(S1.rpc('quiz_staff_record_v2', { p_course_id: C.A, p_request_id: p + '_s1a', p_rows: svA.map((id, i) => ({ item_id: id, response: 0, ord: i })) }), 's1 submit');
    const full = await must(S1.rpc('mark_quiz_completed', { p_id: AS.s1a2 }), 'mark full');
    check('I4 진행 total=servable · 완료는 다 풀었을 때만', totalsOk && svA.length > 0 && early === false && part === false && full === true, { want, totals, early, part, full });
  });

  // I8: quiz_course_stats(A) = 정의대로 센 값. 직원=사람별 첫 응시만, 링크=제출 전부. 둘 다 정답률에 포함.
  await run('I8 quiz_course_stats = P5 정의', async () => {
    const svA = await servable(UNIT, C.A); if (svA.err) throw new Error(svA.err);
    // S1 재응시(오답) → 첫 응시만 세야 한다. 손님 제출 2건(정답 1·오답 1).
    await must(S1.rpc('quiz_staff_record_v2', { p_course_id: C.A, p_request_id: p + '_s1a_retry', p_rows: svA.map((id, i) => ({ item_id: id, response: 1, ord: i })) }), 's1 retry');
    for (const [n, r] of [['g1', 0], ['g2', 1]]) await must(anon.rpc('quiz_link_submit_v2', { p_token: T.A, p_guest_name: `${p}_${n}`, p_guest_phone: null, p_phone_verified: false, p_request_id: `${p}_${n}`, p_answers: [{ item_id: svA[0], response: r }] }), 'guest submit');
    // Q1: 업무 자청(코스 없는 v2)은 발송된 퀴즈 A 의 문항을 받지 않는다. 안 보낸 퀴즈 C 문항은 source=self 로 남는다.
    const selfA = await S2.rpc('quiz_staff_record_v2', { p_course_id: null, p_request_id: p + '_selfA', p_rows: [{ item_id: svA[0], response: 0, ord: 0 }] });
    const selfC = await must(S2.rpc('quiz_staff_record_v2', { p_course_id: null, p_request_id: p + '_selfC', p_rows: [{ item_id: I.c1, response: 0, ord: 0 }] }), 'self C');
    const selfRows = await must(srv.from('quiz_attempt_items').select('source,course_id').eq('submission_id', selfC ?? '-'), 'self rows');
    if (selfA.error || selfA.data !== null || selfRows.length !== 1 || selfRows[0].source !== 'self') throw new Error('Q1 자청 분리 실패 ' + JSON.stringify({ selfA: selfA.error?.message ?? selfA.data, selfRows }));
    // 정의(metrics.ts quizRate): 직원은 사람·문항마다 가장 이른 답 하나(자청 제외) · 손님은 답 전부.
    //   옛 열 asked/correct 는 누적 그대로 두고, 새 열 first_asked/first_correct/guest_submissions 를 본다(0332).
    const rows = await must(srv.from('quiz_attempt_items').select('id,submission_id,staff_id,item_id,correct,created_at,source').eq('unit_id', UNIT).eq('course_id', C.A), 'attempt items');
    const first = new Map();
    for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      if (!r.staff_id || r.source === 'self') continue;
      const k = r.staff_id + ':' + r.item_id; if (!first.has(k)) first.set(k, r);
    }
    const counted = [...first.values(), ...rows.filter((r) => !r.staff_id)];
    const want = { asked: counted.length, correct: counted.filter((r) => r.correct).length, guest: new Set(rows.filter((r) => !r.staff_id).map((r) => r.submission_id)).size };
    const stat = (await must(O.rpc('quiz_course_stats'), 'stats')).find((r) => r.course_id === C.A);
    const got = { asked: Number(stat?.first_asked ?? -1), correct: Number(stat?.first_correct ?? -1), guest: Number(stat?.guest_submissions ?? -1) };
    check('I8 quiz_course_stats = P5 정의', got.asked === want.asked && got.correct === want.correct && got.guest === want.guest && want.guest === 2, { want, got, rows: rows.length });
  });

  // I6: grade_quiz 정답 1건만으로 이해 기록(verified_at)이 생기지 않는다.
  await run('I6 채점만으로 이해 기록 안 생김', async () => {
    const g = await must(S2.rpc('grade_quiz', { p_item_id: I.b1, p_response: 0 }), 'grade');
    const ins = await S2.from('knowhow_understanding').upsert({ unit_id: UNIT, entry_id: E[2], staff_id: S2.uid, staff_name: 'QA', verified_at: new Date().toISOString() }, { onConflict: 'entry_id,staff_id' });
    const row = await must(srv.from('knowhow_understanding').select('verified_at').eq('entry_id', E[2]).eq('staff_id', S2.uid), 'ku');
    check('I6 채점만으로 이해 기록 안 생김', !row.some((r) => r.verified_at), { graded: g?.[0]?.correct, upsertError: ins.error?.message ?? null, rows: row });
  });

  // I5: 퀴즈 L 보관(active=false) 뒤 링크 열기 0문항, 제출 link_unavailable.
  await run('I5 보관한 퀴즈 링크 닫힘', async () => {
    await must(O.from('training_courses').update({ active: false }).eq('id', C.L), 'archive');
    const items = await must(anon.rpc('quiz_link_items', { p_token: T.L }), 'link items');
    const sub = await anon.rpc('quiz_link_submit_v2', { p_token: T.L, p_guest_name: p + '_g3', p_guest_phone: null, p_phone_verified: false, p_request_id: p + '_g3', p_answers: [{ item_id: I.l1, response: 0 }] });
    check('I5 보관한 퀴즈 링크 닫힘', items.length === 0 && sub.error?.message === 'link_unavailable', { openItems: items.length, submit: sub.error?.message ?? sub.data });
  });

  // I2: 초안 C 삭제 뒤 A·B servable 불변.
  await run('I2 초안 삭제 뒤 다른 퀴즈 문항 불변', async () => {
    const before = { A: await servable(UNIT, C.A), B: await servable(UNIT, C.B) };
    if (before.A.err) throw new Error(before.A.err);
    await must(O.from('training_courses').delete().eq('id', C.C), 'delete C');
    const after = { A: await servable(UNIT, C.A), B: await servable(UNIT, C.B) };
    const left = await must(srv.from('quiz_items').select('id,course_id').eq('id', I.c1), 'c1');
    check('I2 초안 삭제 뒤 다른 퀴즈 문항 불변', JSON.stringify(before) === JSON.stringify(after), { before: { A: before.A.length, B: before.B.length }, after: { A: after.A.length, B: after.B.length }, c1: left });
  });
} catch (e) {
  console.log('SETUP FAIL', e.message); fails++;
} finally {
  // 정리: 매장 cascade → 남은 행 확인 → 계정·번호 삭제
  if (UNIT) {
    for (const t of ['quiz_attempt_items', 'quiz_attempts', 'quiz_grade_log', 'knowhow_understanding', 'knowhow_quiz_stats', 'quiz_assignments', 'quiz_links', 'quiz_items', 'course_entries', 'training_courses', 'playbook_entries']) {
      const r = await srv.from(t).delete().eq('unit_id', UNIT); if (r.error) console.log('cleanup', t, r.error.message);
    }
    const r = await srv.from('units').delete().eq('id', UNIT); if (r.error) { console.log('cleanup units', r.error.message); fails++; }
  }
  for (const id of users) { const r = await srv.auth.admin.deleteUser(id); if (r.error) { console.log('cleanup user', r.error.message); fails++; } }
  await srv.from('phone_otps').delete().in('phone', phones);
  if (UNIT) { const left = await srv.from('units').select('id').eq('id', UNIT); console.log('cleanup unit left', left.data?.length ?? '?'); }
}
const ids = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8'];
console.log('SUMMARY', ids.map((i) => `${i}=${results.find((r) => r[0].startsWith(i + ' '))?.[1] ?? 'SKIP(fail)'}`).join(' '));
const missing = ids.filter((i) => !results.some((r) => r[0].startsWith(i + ' '))).length;
console.log('RESULT', fails + missing ? 'RED' : 'GREEN', `fail=${fails + missing}`);
process.exitCode = fails + missing ? 1 : 0;
