#!/usr/bin/env node
// qa-store-retention.mjs — W5 데이터 보관 규칙(시프티 방식) 실증 (로컬 도커 전용 · 0358~0361)
//
// 정본: 산출물/매장측_후속작업_2026-11-03/설계_W5_보관규칙_시프티방식_2026-11-10.md
// 무엇을 못박나:
//   [1] 매장 삭제 = 소프트 삭제(0358). 기록은 남고, 사장도 못 보고, 다시 열 수 없고, 게스트 링크가 닫힌다.
//       사장이 탈퇴해 삭제 대기인 매장의 게스트 링크도 닫힌다(멤버십이 못 막는 유일한 길 · W5-0 새는 곳 1).
//   [2] 탈퇴한 직원(0359·0360) — 탈퇴하자마자 저장된 표시 이름이 "탈퇴한 직원"이 된다(근무 기록 이름은 유지).
//       계정 30일 파기 뒤에도 퀴즈 응시·문항별 답·이해 확인·제안·교육 요청·채팅·질문이 남고 사장이 읽는다.
//   [3] 6개월 지난 채팅·피드·질문을 지우지 않는다(0360 · purge_retention_global).
//   [4] 매장 삭제 30일 파기(0361) — 개인 기록은 없고, 통계·노하우·문항 글이 매장 연결 없이 남는다. 근로기록은 남는다.
//       다시 돌려도 통계가 두 번 쌓이지 않는다.
//
// ★로컬 전용: 계정을 가입시키고 psql 로 시각을 되돌린다. 대상이 127.0.0.1 이 아니면 멈춘다.
// 실행: node scripts/qa-store-retention.mjs --local   자가정리(계정·남은 매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { localEnv } from './qa-local-target.mjs';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

if (!process.argv.includes('--local')) { console.error('중단: 로컬 전용 하니스다. --local 로 돌린다.'); process.exit(2); }
const env = localEnv();
const URL_ = env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const LABEL = '탈퇴한 직원';
const phones = ['0371', '0372', '0373', '0374'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const nowIso = () => new Date().toISOString();
const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
const cnt = async (t, col, v) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const must = async (label, q) => { const { error } = await q; if (error) throw new Error(`${label}: ${error.message}`); };

// 매장 하나에 노하우·퀴즈·링크를 심는다. 반환 = { entry, course, item, token }
// pii 가 있으면 글 곳곳(설명·태그·교정 포인트·상황·문항 해설·보기)에 넣는다 — 보관 표 정리(scrub) 검사용.
async function seedQuiz(unit, owner, tag, pii = '') {
  const now = nowIso();
  const entry = `sr_e_${tag}_${s}`, course = `sr_c_${tag}_${s}`, item = `sr_q_${tag}_${s}`, token = `sr_tok_${tag}_${s}_0123456789`;
  await must('entry', admin.from('playbook_entries').insert({ id: entry, unit_id: unit, creator_id: owner, creator_name: '사장', category: 'Routine',
    title: `보관 노하우 ${tag} ${s}`, description: `마감 때 가스 밸브를 잠근다 ${pii}`, square: { situation: `마감 ${pii}`, steps: [{ text: pii }] },
    tags: pii ? [pii] : [], correction_points: pii ? [pii] : [], search_keywords: pii ? [pii] : [], photos: ['x/y.jpg'], status: 'published', created_at: now, updated_at: now }));
  await must('course', admin.from('training_courses').insert({ id: course, unit_id: unit, key: course, name: `퀴즈 ${tag}`, min_items: 1, max_items: 10, position: 0, active: true, start_at: now.slice(0, 10) }));
  await must('course_entries', admin.from('course_entries').insert({ course_id: course, entry_id: entry, unit_id: unit }));
  await must('quiz_items', admin.from('quiz_items').insert({ id: item, unit_id: unit, course_id: course, entry_ids: [entry], kind: 't3', format: 'mc4', status: 'active', source: 'owner',
    payload: { ask: `무엇을 잠그나요 ${tag} ${s}`, choices: ['가스 밸브', `창문 ${pii}`, '냉장고'], answer_index: 0, explain: `가스 밸브 ${pii}` }, created_by: owner, created_at: now, source_updated_at: now }));
  await must('quiz_links', admin.from('quiz_links').insert({ id: `sr_l_${tag}_${s}`, course_id: course, unit_id: unit, token,
    expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: now, created_by: owner }));
  return { entry, course, item, token };
}
// quiz_link_open 은 못 여는 링크에도 행 하나(ok=false)를 준다. ok 와 문항 수로 판정한다.
const linkOpens = async (token) => { const r = await mk().rpc('quiz_link_open', { p_token: token }); const row = Array.isArray(r.data) ? r.data[0] : r.data; return !r.error && row?.ok === true && (row?.item_count ?? 0) > 0; };

try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), J = mk(), X = mk();
  const up = async (c, i, name, role) => {
    const r = await c.auth.signUp({ email: `qa_sr_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: role === 'owner' ? '1980-01-01' : '2000-01-01' } } });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    users.push(r.data.user.id);
    return r.data.user.id;
  };
  const oId = await up(O, 0, 'QA보관사장', 'owner');
  const jId = await up(J, 1, 'QA탈퇴직원', 'junior');
  const xId = await up(X, 2, 'QA탈퇴사장', 'owner');
  const Z = mk();
  const zId = await up(Z, 3, 'QA다른탈퇴', 'junior');

  const mkStore = async (c, name) => {
    const { data, error } = await c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null });
    if (error) throw new Error(`create_store ${name}: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data; units.push(row.unit_id); return row;
  };
  const S = await mkStore(O, 'QA보관본점');
  await must('multi S', admin.rpc('admin_activate_store', { p_unit_id: S.unit_id, p_days: 1, p_plan: 'multi' }));
  await must('slot', admin.from('store_slots').insert({ owner_id: oId, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() }));
  const D = await mkStore(O, 'QA보관지울점');
  const XS = await mkStore(X, 'QA탈퇴사장점');
  await O.rpc('switch_active_unit', { p_unit_id: S.unit_id });
  await J.rpc('join_by_invite', { p_code: S.invite_code });
  await must('approve J', O.rpc('approve_member', { p_uid: jId }));
  await J.rpc('switch_active_unit', { p_unit_id: S.unit_id });

  // 개인 식별 내용: 매장 이름 · 사장 이름 · 예전 직원 이름(재직 기간 스냅샷) · 휴대폰 두 모양 · 이메일
  const PII = ['QA보관지울점', 'QA보관사장', 'QA탈퇴직원', '010-1234-5678', '010 9876 5432', '01055556666', 'qa.pii@example.com'];
  const qD = await seedQuiz(D.unit_id, oId, 'd', `${PII.join(' / ')} 님께 연락`);
  const qX = await seedQuiz(XS.unit_id, xId, 'x');
  const qS = await seedQuiz(S.unit_id, oId, 's');
  // D 의 개인 기록(30일 파기 대상) + 근로기록(남길 것)
  await must('D chat', admin.from('chat_queries').insert({ id: `sr_cq_d_${s}`, unit_id: D.unit_id, junior_id: jId, junior_name: 'QA탈퇴직원', query_text: '가스 밸브 어디', matched_entry_ids: [qD.entry], asked_at: nowIso() }));
  await must('D unknown', admin.from('unknown_queries').insert({ id: `sr_uq_d_${s}`, unit_id: D.unit_id, junior_id: jId, junior_name: 'QA탈퇴직원', query_text: '포스 오류', presumed_category: 'Event', status: 'archived', asked_at: nowIso() }));
  await must('D feed', admin.from('work_feed').insert({ id: `sr_wf_d_${s}`, unit_id: D.unit_id, feed_date: nowIso().slice(0, 10), data: { kind: 'message', text: '안녕', authorId: jId, authorName: 'QA탈퇴직원' } }));
  await must('D attempt items', admin.from('quiz_attempt_items').insert([true, false].map((ok, i) => ({ id: `sr_ai_d${i}_${s}`, unit_id: D.unit_id, submission_id: `sr_sub_d_${s}`,
    item_id: qD.item, ord: i, format: 'mc4', payload: {}, response: {}, correct: ok, staff_id: jId, course_id: qD.course, entry_ids: [qD.entry] }))));
  await must('D attempts', admin.from('quiz_attempts').insert({ unit_id: D.unit_id, entry_id: qD.entry, staff_id: jId, total: 2, correct: 1, course_id: qD.course }));
  // 근로기록: 예전에 D 에서 일하고 나간 직원 J(재직 기간 있음) 몫은 3년 남기고, 사장 본인(재직 기간 없음) 몫은 30일 파기 때 지운다.
  await must('D tenure', admin.from('member_tenures').insert({ unit_id: D.unit_id, user_id: jId, joined_at: days(60), left_at: days(10), left_reason: 'left', name_snapshot: 'QA탈퇴직원' }));
  await must('D attendance', admin.from('attendance').insert({ id: `sr_at_d_${s}`, unit_id: D.unit_id, staff_id: jId, date: nowIso().slice(0, 10) }));
  await must('D owner attendance', admin.from('attendance').insert({ id: `sr_at_do_${s}`, unit_id: D.unit_id, staff_id: oId, date: nowIso().slice(0, 10) }));

  // ═══ [1] 매장 소프트 삭제 · 새는 곳 ═══
  console.log('\n[1] 매장 삭제 = 소프트 삭제 · 지운 매장으로 새는 곳');
  check('1-0 지우기 전 D 게스트 링크가 열린다(전제)', await linkOpens(qD.token));
  const del = await O.rpc('delete_store', { p_unit_id: D.unit_id });
  check('1-1 O → delete_store(D) 성공', !del.error, del.error?.message);
  check('1-2 지운 매장 문항이 게스트 링크로 안 열린다', !(await linkOpens(qD.token)));
  const dRow = (await admin.from('units').select('deleted_at, invite_code, biz_no').eq('id', D.unit_id).maybeSingle()).data;
  check('1-3 ★매장 행은 남고 deleted_at 이 찍힌다(초대 코드는 비움)', !!dRow?.deleted_at && dRow.invite_code == null, JSON.stringify(dRow));
  check('1-4 ★매장 기록(노하우)이 남는다', (await cnt('playbook_entries', 'unit_id', D.unit_id)) === 1);
  const oSees = await O.from('playbook_entries').select('id').eq('unit_id', D.unit_id);
  check('1-5 사장도 지운 매장 노하우를 못 읽는다', !oSees.error && (oSees.data ?? []).length === 0, JSON.stringify(oSees.data ?? oSees.error));
  const ro = await O.rpc('reopen_store', { p_unit: D.unit_id });
  check('1-6 지운 매장은 다시 열 수 없다(not_owner)', /not_owner/.test(ro.error?.message ?? ''), ro.error?.message ?? '(열림!)');
  const again = await O.rpc('delete_store', { p_unit_id: D.unit_id });
  check('1-7 같은 매장을 두 번 지울 수 없다(not_owner · 몫 두 번 반환 방지)', /not_owner/.test(again.error?.message ?? ''), again.error?.message ?? '(두 번 지움!)');
  const pv = await O.rpc('delete_store_preview', { p_unit: D.unit_id });
  check('1-8 지운 매장 삭제 미리보기 거부(not_owner)', /not_owner/.test(pv.error?.message ?? ''), pv.error?.message ?? '(보임!)');
  const myU = (await O.rpc('my_units')).data ?? [];
  check('1-9 내 매장 목록에서 빠진다', !myU.some((u) => u.unit_id === D.unit_id));
  // 0362: 사장 전용 복사 RPC 도 지운 매장을 소유하지 않은 것으로 본다(기존 오류 코드)
  const lk = await O.rpc('list_unit_knowhow', { p_from_unit: D.unit_id });
  check('1-9a 지운 매장 노하우 목록 거부(not_owner)', /not_owner/.test(lk.error?.message ?? ''), lk.error?.message ?? `(보임 ${JSON.stringify(lk.data)?.slice(0, 80)})`);
  const cf = await O.rpc('copy_knowhow', { p_from_unit: D.unit_id, p_entry_ids: [qD.entry] });
  check('1-9b 지운 매장에서 노하우 복사 거부(not_owner_source)', /not_owner_source/.test(cf.error?.message ?? ''), cf.error?.message ?? `(복사됨 ${cf.data})`);
  const ct = await O.rpc('copy_knowhow_to', { p_to_unit: D.unit_id, p_entry_ids: [qS.entry] });
  check('1-9c 지운 매장으로 노하우 복사 거부(not_owner_target)', /not_owner_target/.test(ct.error?.message ?? ''), ct.error?.message ?? `(복사됨 ${ct.data})`);
  check('1-10 X 매장 링크는 탈퇴 전 열린다(전제)', await linkOpens(qX.token));
  const xd = await X.rpc('delete_my_account');
  check('1-11 X 탈퇴 성공', !xd.error, xd.error?.message);
  check('1-12 ★사장이 탈퇴해 삭제 대기인 매장 문항이 게스트 링크로 안 열린다', !(await linkOpens(qX.token)));
  const own = psql(`select public.auth_owns_unit('${D.unit_id}') from (select set_config('request.jwt.claims', '{"sub":"${oId}","role":"authenticated"}', true)) x`);
  check('1-13 auth_owns_unit(지운 매장) = false', own === 'f', own);

  // ═══ [2] 탈퇴한 직원 ═══
  console.log('\n[2] 탈퇴한 직원 — 이름 "탈퇴한 직원" · 계정 파기 뒤에도 기록이 남는다');
  const U = S.unit_id;
  await must('tpl', admin.from('work_templates').insert({ id: `sr_t_${s}`, unit_id: U, section: 'open', text: '오픈 점검' }));
  const seeds = [
    ['feed', admin.from('work_feed').insert({ id: `sr_wf_j_${s}`, unit_id: U, feed_date: nowIso().slice(0, 10), data: { kind: 'message', text: '출근했어요', authorId: jId, authorName: 'QA탈퇴직원', authorRole: 'junior' } })],
    ['done', admin.from('work_done').insert({ unit_id: U, work_date: nowIso().slice(0, 10), template_id: `sr_t_${s}`, data: { by: jId, byName: 'QA탈퇴직원', at: nowIso() } })],
    // 질문 두 표는 작성자 트리거(stamp_author)가 junior_id 를 세션에서 찍는다 — 직원 세션으로 넣어야 실제 모양이 된다.
    ['chat', J.from('chat_queries').insert({ id: `sr_cq_j_${s}`, unit_id: U, junior_name: 'QA탈퇴직원', query_text: '마감 순서', asked_at: nowIso() })],
    ['unknown', J.from('unknown_queries').insert({ id: `sr_uq_j_${s}`, unit_id: U, junior_name: 'QA탈퇴직원', query_text: '포스 오류', asked_at: nowIso() })],
    ['attempts', admin.from('quiz_attempts').insert({ unit_id: U, entry_id: qS.entry, staff_id: jId, total: 1, correct: 1, course_id: qS.course })],
    ['attempt_items', admin.from('quiz_attempt_items').insert({ id: `sr_ai_j_${s}`, unit_id: U, submission_id: `sr_sub_j_${s}`, item_id: qS.item, ord: 0, format: 'mc4', payload: {}, response: {}, correct: true, staff_id: jId, course_id: qS.course, entry_ids: [qS.entry] })],
    ['task_u', admin.from('task_understanding').insert({ unit_id: U, template_id: `sr_t_${s}`, staff_id: jId, staff_name: 'QA탈퇴직원' })],
    // knowhow_understanding 은 quiz_attempts 저장 트리거가 이미 적는다(같은 키) — 이름만 맞춘다.
    ['knowhow_u', admin.from('knowhow_understanding').upsert({ unit_id: U, entry_id: qS.entry, staff_id: jId, staff_name: 'QA탈퇴직원' }, { onConflict: 'entry_id,staff_id' })],
    ['suggestion', admin.from('playbook_suggestions').insert({ id: `sr_ps_j_${s}`, unit_id: U, proposer_id: jId, proposer_name: 'QA탈퇴직원', kind: 'new', text: '새 노하우 제안' })],
    ['training_req', admin.from('training_requests').insert({ id: `sr_tr_j_${s}`, unit_id: U, staff_id: jId, entry_id: qS.entry })],
  ];
  for (const [l, q] of seeds) await must(l, q);
  const jd = await J.rpc('delete_my_account');
  check('2-0 J 탈퇴 성공', !jd.error, jd.error?.message);
  const nm = psql(`select concat_ws('|',
    (select data->>'authorName' from public.work_feed where id = 'sr_wf_j_${s}'),
    (select data->>'byName' from public.work_done where template_id = 'sr_t_${s}'),
    (select junior_name from public.chat_queries where id = 'sr_cq_j_${s}'),
    (select junior_name from public.unknown_queries where id = 'sr_uq_j_${s}'),
    (select staff_name from public.task_understanding where template_id = 'sr_t_${s}'),
    (select staff_name from public.knowhow_understanding where entry_id = '${qS.entry}'),
    (select proposer_name from public.playbook_suggestions where id = 'sr_ps_j_${s}'))`);
  check('2-1 ★탈퇴 즉시 저장된 표시 이름 7곳이 "탈퇴한 직원"', nm === Array(7).fill(LABEL).join('|'), nm);
  const snap = psql(`select name_snapshot from public.member_tenures where unit_id = '${U}' and user_id = '${jId}' order by joined_at desc limit 1`);
  check('2-2 근무 기록 이름(member_tenures.name_snapshot)은 그대로', snap === 'QA탈퇴직원', snap);
  psql(`update public.profiles set deleted_at = now() - interval '31 days' where id = '${jId}'`);
  const pr = psql('select public.purge_deleted_accounts()');
  check('2-3 30일 파기 실행', !pr.startsWith('psql 오류'), pr);
  check('2-4 J 계정(auth.users)은 지워졌다', psql(`select count(*) from auth.users where id = '${jId}'`) === '0');
  const left = psql(`select concat_ws('|',
    (select count(*) from public.quiz_attempts where staff_id = '${jId}' and unit_id = '${U}'),
    (select count(*) from public.quiz_attempt_items where staff_id = '${jId}' and unit_id = '${U}'),
    (select count(*) from public.task_understanding where staff_id = '${jId}'),
    (select count(*) from public.knowhow_understanding where staff_id = '${jId}'),
    (select count(*) from public.playbook_suggestions where proposer_id = '${jId}'),
    (select count(*) from public.training_requests where staff_id = '${jId}'),
    (select count(*) from public.chat_queries where id = 'sr_cq_j_${s}'),
    (select count(*) from public.work_feed where id = 'sr_wf_j_${s}'))`);
  check('2-5 ★계정 파기 뒤에도 퀴즈 응시·문항별 답·이해 확인 2종·제안·교육 요청·채팅·피드가 남는다', left === '1|1|1|1|1|1|1|1', left);
  const oq = await O.from('quiz_attempts').select('staff_id').eq('unit_id', U).eq('staff_id', jId);
  check('2-6 사장은 탈퇴한 직원의 퀴즈 기록을 계속 읽는다(id 유지)', !oq.error && (oq.data ?? []).length === 1, JSON.stringify(oq.error ?? oq.data));

  // ═══ [3] 6개월 파기 없음 ═══
  console.log('\n[3] 6개월 지난 채팅·피드·질문을 지우지 않는다');
  await must('old chat', admin.from('chat_queries').insert({ id: `sr_cq_old_${s}`, unit_id: U, junior_id: oId, junior_name: '사장', query_text: '옛 질문', asked_at: days(400) }));
  await must('old feed', admin.from('work_feed').insert({ id: `sr_wf_old_${s}`, unit_id: U, feed_date: days(400).slice(0, 10), created_at: days(400), data: { kind: 'message', text: '옛 대화', authorId: oId } }));
  await must('old unknown', admin.from('unknown_queries').insert({ id: `sr_uq_old_${s}`, unit_id: U, junior_id: oId, query_text: '옛 모르는 질문', status: 'archived', asked_at: days(400) }));
  const pg = await admin.rpc('purge_retention_global');
  check('3-0 purge_retention_global 실행', !pg.error, pg.error?.message);
  const old = psql(`select concat_ws('|', (select count(*) from public.chat_queries where id = 'sr_cq_old_${s}'),
    (select count(*) from public.work_feed where id = 'sr_wf_old_${s}'), (select count(*) from public.unknown_queries where id = 'sr_uq_old_${s}'))`);
  check('3-1 ★400일 지난 채팅·피드·모르는 질문이 남는다', old === '1|1|1', old);

  // ═══ [4] 매장 삭제 30일 파기 ═══
  console.log('\n[4] 매장 삭제 30일 뒤 — 개인 기록 파기 · 통계·콘텐츠 보관 · 근로기록 유지');
  const statBefore = psql(`select coalesce(sum(questions), 0) from public.retained_question_stats where industry = '카페·디저트' and month = date_trunc('month', now())::date`);
  psql(`update public.units set deleted_at = now() - interval '31 days' where id = '${D.unit_id}'`);
  // [5] 준비: X 매장(XS)의 파기를 일부러 실패시킨다(노하우 삭제에서 예외). X 계정·Z 계정도 30일이 지났다.
  const zd = await Z.rpc('delete_my_account');
  if (zd.error) throw new Error('Z delete_my_account: ' + zd.error.message);
  psql(`update public.units set deleted_at = now() - interval '31 days' where id = '${XS.unit_id}'`);
  psql(`update public.profiles set deleted_at = now() - interval '31 days' where id in ('${xId}', '${zId}')`);
  const trg = psql(`create or replace function public.qa_sr_fail_${s}() returns trigger language plpgsql as $f$ begin raise exception 'qa_forced_purge_failure'; end $f$;
    create trigger qa_sr_fail_${s} before delete on public.playbook_entries for each row when (old.unit_id = '${XS.unit_id}') execute function public.qa_sr_fail_${s}();`);
  if (trg.startsWith('psql 오류')) throw new Error('실패 트리거: ' + trg);
  const pd = psql('select public.purge_deleted_accounts()');
  check('4-0 30일 파기 실행', !pd.startsWith('psql 오류'), pd);
  const gone = psql(`select concat_ws('|', ${['playbook_entries', 'chat_queries', 'unknown_queries', 'work_feed', 'quiz_items', 'quiz_attempts', 'quiz_attempt_items', 'quiz_links', 'training_courses']
    .map((t) => `(select count(*) from public.${t} where unit_id = '${D.unit_id}')`).join(', ')})`);
  check('4-1 ★개인 기록·매장 콘텐츠 원본이 없다(9개 표 0건)', gone === Array(9).fill('0').join('|'), gone);
  const kh = psql(`select concat_ws('|', count(*), bool_and(photos_dropped)) from (select (to_jsonb(r) ? 'photos') as photos_dropped from public.retained_knowhow r where title = '보관 노하우 d ${s}') x`);
  check('4-2 ★노하우 글이 매장 연결 없이 남는다(사진 열 없음)', kh === '1|f', kh);
  const khCols = psql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'retained_knowhow' and column_name ~ '(unit|creator|owner|staff|user)'`);
  const khExists = psql(`select to_regclass('public.retained_knowhow') is not null`);
  check('4-3 보관 노하우 표가 있고 매장·작성자 열이 없다', khExists === 't' && khCols === '', `${khExists} ${khCols}`);
  const qi = psql(`select concat_ws('|', attempts, correct, cardinality(knowhow_ids)) from public.retained_quiz_items where payload->>'ask' = '무엇을 잠그나요 d ${s}'`);
  check('4-4 ★문항 글 + 문항별 응시 수·정답 수가 남는다(2회 중 1회 정답 · 노하우 연결)', qi === '2|1|1', qi);
  const statAfter = psql(`select coalesce(sum(questions), 0) from public.retained_question_stats where industry = '카페·디저트' and month = date_trunc('month', now())::date`);
  check('4-5 ★질문 통계(업종 × 카테고리 × 월)가 2건 늘었다', Number(statAfter) - Number(statBefore) === 2, `${statBefore} → ${statAfter}`);
  const tomb = psql(`select concat_ws('|', (select count(*) from public.attendance where id = 'sr_at_d_${s}'), (select count(*) from public.attendance where id = 'sr_at_do_${s}'),
    (select count(*) from public.member_tenures where unit_id = '${D.unit_id}'), (select (purged_at is not null)::text from public.units where id = '${D.unit_id}'))`);
  check('4-6 ★직원 근로기록(출퇴근·재직 기간)은 남고 사장 본인 출퇴근은 지운다 · 매장 행은 파기 표시만 남는다', tomb === '1|0|1|true', tomb);
  psql('select public.purge_deleted_accounts()');
  const statAgain = psql(`select coalesce(sum(questions), 0) from public.retained_question_stats where industry = '카페·디저트' and month = date_trunc('month', now())::date`);
  check('4-7 다시 돌려도 통계가 두 번 쌓이지 않는다', !statAgain.startsWith('psql 오류') && statAgain === statAfter, `${statAfter} → ${statAgain}`);
  // ★개인 식별 내용 정리(약관 제8조 제3항): 보관 노하우·문항 글에 매장 이름·사람 이름·전화·이메일이 없다
  const khDump = psql(`select coalesce((select to_jsonb(r)::text from public.retained_knowhow r where title = '보관 노하우 d ${s}'), '')`);
  const qiDump = psql(`select coalesce((select payload::text from public.retained_quiz_items where payload->>'ask' = '무엇을 잠그나요 d ${s}'), '')`);
  const leaked = (d) => PII.filter((v) => d.includes(v));
  check('4-9 ★보관 노하우 글(제목·설명·태그·교정·키워드·상황 jsonb)에 매장명·이름·전화·이메일이 없고 자리표시로 바뀐다',
    khDump !== '' && leaked(khDump).length === 0 && ['[매장]', '[이름]', '[연락처]'].every((m) => khDump.includes(m)), `${leaked(khDump)} · ${khDump.slice(0, 200)}`);
  check('4-10 ★보관 문항 payload(보기·해설 안 문자열까지)에 매장명·이름·전화·이메일이 없다',
    qiDump !== '' && leaked(qiDump).length === 0 && qiDump.includes('[연락처]'), `${leaked(qiDump)} · ${qiDump.slice(0, 200)}`);

  // ═══ [5] 한 매장 파기가 실패해도 다른 파기는 진행된다 ═══
  console.log('\n[5] 매장 하나의 파기 실패가 계정 파기를 멈추지 않는다');
  check('5-1 ★실패하는 매장이 있어도 다른 탈퇴 계정(Z) 파기가 진행됐다', psql(`select count(*) from auth.users where id = '${zId}'`) === '0');
  const xs = psql(`select concat_ws('|', (select (purged_at is null)::text from public.units where id = '${XS.unit_id}'), (select count(*) from auth.users where id = '${xId}'))`);
  check('5-2 실패한 매장은 파기 전 그대로 남고(다음 실행에서 다시) 그 사장 계정은 이번에 지우지 않는다', xs === 'true|1', xs);
  const flog = psql(`select count(*) from public.retention_purge_log where job = 'purge_deleted_store' and counts->>'unit_id' = '${XS.unit_id}' and (counts->>'failed')::boolean`);
  check('5-3 실패가 retention_purge_log 에 남는다(4-0·4-7 두 번 실행 = 실행마다 1줄)', flog === '2', flog);
  psql(`drop trigger if exists qa_sr_fail_${s} on public.playbook_entries; drop function if exists public.qa_sr_fail_${s}();`);
  const pd2 = psql('select public.purge_deleted_accounts()');
  const xs2 = psql(`select concat_ws('|', (select coalesce((purged_at is not null)::text, 'deleted') from public.units where id = '${XS.unit_id}'), (select count(*) from auth.users where id = '${xId}'))`);
  check('5-4 원인이 사라지면 다음 실행에서 그 매장과 계정도 파기된다', !pd2.startsWith('psql 오류') && (xs2 === '|0' || xs2 === 'true|0' || xs2 === '0'), `${pd2} · ${xs2}`);

  const anon = await mk().from('retained_knowhow').select('id').limit(1);
  const authd = await O.from('retained_question_stats').select('month').limit(1);
  check('4-8 보관 표는 앱에서 못 읽는다(anon·사장 0행 또는 거부)', khExists === 't' && (anon.error || (anon.data ?? []).length === 0) && (authd.error || (authd.data ?? []).length === 0),
    JSON.stringify({ a: anon.error?.code ?? anon.data?.length, o: authd.error?.code ?? authd.data?.length }));
} catch (e) {
  fail++;
  console.log('  FAIL 셋업/실행 예외:', e.message);
} finally {
  psql(`drop trigger if exists qa_sr_fail_${s} on public.playbook_entries; drop function if exists public.qa_sr_fail_${s}();`);
  for (const u of units) { try { psql(`delete from public.units where id = '${u}'`); } catch { /* skip */ } }
  for (const id of users) { try { await admin.auth.admin.deleteUser(id); } catch { /* skip */ } }
  psql(`delete from public.retained_knowhow where title like '보관 노하우 % ${s}'`);
  psql(`delete from public.retained_quiz_items where payload->>'ask' like '무엇을 잠그나요 % ${s}'`);
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* skip */ }
}
console.log(`\n결과: ${pass} 통과 · ${fail} 실패 · skip 0`);
process.exit(fail ? 1 : 0);
