// 직원 쪽 퀴즈 경로(0139·0140) QA — 실 백엔드 대상·자가정리.
//
// 사장 화면과 직원 화면이 어긋나던 자리를 전수로 친다. 화면 렌더는 못 재지만,
// **카드 노출 판정이 딛고 서는 데이터**는 전부 여기서 증명한다(WorkBoard.trainingCards 의 입력).
//
//   ① 발송 원장이 직원에게 어떻게 보이나 — 받은 사람만 자기 행을 본다(RLS qz_select)
//   ② 안 보낸 직원에게는 원장 행이 0건 → 카드가 뜰 근거가 없다
//   ③ 예약(미래)은 sent_at 이 null → 카드 조건(sentAt 있음) 불충족
//   ④ 직원은 원장을 직접 못 고친다 — 마감·발송기록 위조 차단(RLS)
//   ⑤ 열기·완료가 본인 행에만 찍힌다(0140), 남의 행은 false
//   ⑥ 통과 기록(knowhow_understanding)은 서버가 제출 RPC 안에서 쓰고(0333) 사장 결과 화면이 그걸 읽는다
//   ⑦ 문항 수 판정(quiz_item_counts)이 직원 세션에서 자기 매장 것만, active 만 센다
//   ⑧ 크로스테넌트 — 남의 매장 발송 원장은 한 줄도 안 보인다
//
// ⚠️ 못 재는 것: 카드가 실제로 그려지는지 · 겹침 · 문구. 그건 브라우저 QA 몫이다.
//
// 사용: node scripts/qa-quiz-junior.mjs   (.env + .env.seed 자동 로드)
import './lib/require-local-target-files.mjs'; // 접속 대상 가드 — 로컬이 아니면 --allow-remote 없이 멈춘다
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { IS_LOCAL, localEnv, assertLocalUrl } from './qa-local-target.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
if (IS_LOCAL) Object.assign(env, localEnv());
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
if (IS_LOCAL) assertLocalUrl(URL_);
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const PW = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = ymd(kst);
const TOMORROW = ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + 1));

const qaPhones = [`0106${s.slice(0,7)}`, `0108${s.slice(0,7)}`, `0109${s.slice(0,7)}`];
let UNIT = null, UNIT2 = null;
const made = { entries: [] };

/**
 * WorkBoard.trainingCards 의 노출 판정(0139 게이트)을 그대로 옮긴 것.
 * ★여기서 규칙을 새로 만들지 않는다 — 클라와 같은 진리표인지 확인하는 대조표다.
 *   원장 행이 있는 퀴즈 = 나에게 나간 것만 / 원장 행이 없으면 = 예전 규칙 그대로.
 */
function cardVisible(myAssignments, allAssignmentsOfCourse, userId) {
  if (allAssignmentsOfCourse.length === 0) return true;
  return myAssignments.some((a) => a.user_id === userId && !!a.sent_at);
}

async function main() {
  console.log(`— 셋업 (KST ${DAY}) —`);
  await seedVerifiedPhones(URL_, SRV, qaPhones);

  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_qj_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0106${s.slice(0,7)}`, store_name: 'QJ', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'QJ 퀴즈매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });

  const jA = mk(), jB = mk();
  const aId = await signUpSession(jA, `qa_qj_a_${s}@example.com`, { name: 'QA받은직원', role: 'junior', phone: `0108${s.slice(0,7)}` });
  const bId = await signUpSession(jB, `qa_qj_b_${s}@example.com`, { name: 'QA안받은직원', role: 'junior', phone: `0109${s.slice(0,7)}` });
  for (const [j, id] of [[jA, aId], [jB, bId]]) {
    await j.rpc('join_by_invite', { p_code: CODE });
    const { error } = await owner.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await j.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  check('매장 + 직원 2명', !!UNIT, `unit=${UNIT}`);

  // 노하우 1건 + 문항 1건 + 퀴즈(코스) 1건
  const ENTRY = `pb_qj_${s}`;
  made.entries.push(ENTRY);
  const nowIso = new Date().toISOString();
  const { error: peErr } = await owner.from('playbook_entries').insert({
    id: ENTRY, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장', category: 'Routine',
    subcategory: '마감', title: '마감 청소', tags: [], search_keywords: ['마감'],
    square: { situation: '마감', action: { steps: ['홀 정리', '기계 청소'] }, extract: { do: '', dont: '가스 밸브를 열어 둔 채 나가지 않아요', template: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '', timing: '', channel: '', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.7, created_at: nowIso, updated_at: nowIso,
    is_template: false, pack_id: null, needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  if (peErr) throw new Error('playbook_entries: ' + peErr.message);

  const QUIZ = `tc_qj_${s}`;
  const { error: tcErr } = await owner.from('training_courses').insert({
    id: QUIZ, unit_id: UNIT, key: `qj_${s}`, name: '마감 청소 확인',
    min_items: 1, max_items: 10, due_days: null, start_at: DAY, answer_days: 3, position: 0, active: true,
  });
  if (tcErr) throw new Error('training_courses: ' + tcErr.message);
  await owner.from('course_entries').insert({ course_id: QUIZ, entry_id: ENTRY, unit_id: UNIT, position: 0 });

  const ITEM = `qz_qj_${s}`;
  const { error: qiErr } = await owner.from('quiz_items').insert({
    id: ITEM, unit_id: UNIT, course_id: QUIZ, entry_ids: [ENTRY], kind: 't0', format: 'mc4',
    // ⑥ 에서 제출 RPC 가 서버 채점한다. mc4 채점 키는 choices·answer_index 다(0170).
    payload: { ask: '마감할 때 먼저 하는 것은?', choices: ['홀 정리', '기계 청소', '퇴근', '주문'], answer_index: 0, explain: '홀부터 정리해요' },
    source: 'owner', status: 'active', created_by: ownerId,
  });
  check('노하우·퀴즈·문항 시드', !qiErr, qiErr?.message ?? '');

  // ── ① 발송: A 에게만 ────────────────────────────────────────────────────
  console.log('— ① 사장이 A 에게만 보낸다 —');
  const AS_A = `qza_a_${s}`;
  const { error: asgErr } = await owner.from('quiz_assignments').insert({
    id: AS_A, unit_id: UNIT, course_id: QUIZ, user_id: aId, scheduled_on: DAY,
  });
  check('사장 발행 성공', !asgErr, asgErr?.message ?? '');
  await admin.from('quiz_assignments').update({ sent_at: new Date().toISOString(), due_on: TOMORROW }).eq('id', AS_A);

  const mineA = async (cli) => {
    const { data, error } = await cli.from('quiz_assignments').select('id, course_id, user_id, sent_at, due_on, opened_at, completed_at').eq('course_id', QUIZ);
    if (error) throw new Error('assignments read: ' + error.message);
    return data ?? [];
  };
  const aRows = await mineA(jA);
  const bRows = await mineA(jB);
  check('받은 직원 A: 자기 발송 1건이 보인다', aRows.length === 1 && aRows[0].user_id === aId, `n=${aRows.length}`);
  check('A 는 남의 발송을 못 본다', aRows.every((r) => r.user_id === aId));
  // ★마감을 직원이 읽을 수 있어야 카드에 "○월 ○일까지"를 띄울 수 있다(2026-08-12).
  //   못 읽으면 사장이 정한 "3일 안에"가 사장만 아는 숫자가 된다.
  check('A 가 마감(due_on)을 읽는다', aRows[0]?.due_on === TOMORROW, `${aRows[0]?.due_on} vs ${TOMORROW}`);

  // ── ② 안 받은 직원 ──────────────────────────────────────────────────────
  console.log('— ② 안 보낸 직원 —');
  check('안 받은 직원 B: 원장 0건', bRows.length === 0, `n=${bRows.length}`);
  const ownerRows = await mineA(owner);
  check('사장은 매장 전체 발송을 본다(결과 화면 근거)', ownerRows.length === 1);
  check('★A 는 카드가 뜬다', cardVisible(aRows, ownerRows, aId) === true);
  check('★B 는 카드가 안 뜬다(고친 자리)', cardVisible(bRows, ownerRows, bId) === false);

  // ── ③ 예약(미래) ────────────────────────────────────────────────────────
  console.log('— ③ 예약은 아직 안 나간 것 —');
  const AS_B = `qza_b_${s}`;
  await owner.from('quiz_assignments').insert({ id: AS_B, unit_id: UNIT, course_id: QUIZ, user_id: bId, scheduled_on: TOMORROW });
  const bRows2 = await mineA(jB);
  check('B 원장 1건(예약)', bRows2.length === 1);
  check('sent_at 이 없다', bRows2[0]?.sent_at === null);
  check('★예약만 있으면 카드가 안 뜬다', cardVisible(bRows2, await mineA(owner), bId) === false);

  // ── ④ 직원이 원장을 고칠 수 없다 ───────────────────────────────────────
  console.log('— ④ 마감·발송기록 위조 차단 —');
  const { data: u1 } = await jA.from('quiz_assignments').update({ due_on: '2099-12-31' }).eq('id', AS_A).select();
  check('직원 due_on 변조 0행', (u1 ?? []).length === 0, `updated=${u1?.length}`);
  const { data: u2 } = await jA.from('quiz_assignments').update({ sent_at: null }).eq('id', AS_A).select();
  check('직원 sent_at 되돌리기 0행(빈도 상한 근거 보호)', (u2 ?? []).length === 0);
  const { data: d1 } = await jA.from('quiz_assignments').delete().eq('id', AS_A).select();
  check('직원 발송 삭제 0행', (d1 ?? []).length === 0);
  const { error: i1 } = await jA.from('quiz_assignments').insert({ id: `qza_hack_${s}`, unit_id: UNIT, course_id: QUIZ, user_id: aId, scheduled_on: DAY });
  check('직원 자가 발행 거부', !!i1, i1?.code ?? '거부 안 됨');

  // ── ⑤ 열기·완료(0140) ──────────────────────────────────────────────────
  console.log('— ⑤ 열기 · 완료 —');
  const { data: op } = await jA.rpc('mark_quiz_opened', { p_id: AS_A });
  check('A 본인 열기 true', op === true, `got=${op}`);
  const { data: opOther } = await jB.rpc('mark_quiz_opened', { p_id: AS_A });
  check('B 가 A 의 발송을 못 연다', opOther === false, `got=${opOther}`);
  const { data: opPend } = await jB.rpc('mark_quiz_opened', { p_id: AS_B });
  check('아직 안 나간 예약은 못 연다', opPend === false, `got=${opPend}`);

  // ── ⑥ 통과 기록 ────────────────────────────────────────────────────────
  console.log('— ⑥ 통과 기록 —');
  // 0333: 이해 기록은 서버가 제출(quiz_staff_record_v2) 안에서 쓴다. 본인 직접 insert 도 오류 없이 무시된다.
  const { error: kuErr } = await jA.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: ENTRY, staff_id: aId, staff_name: 'QA받은직원' });
  const { data: kuDirect } = await admin.from('knowhow_understanding').select('entry_id').eq('entry_id', ENTRY).eq('staff_id', aId);
  check('본인 직접 insert 는 무시(오류 없음 · 행 0)', !kuErr && (kuDirect ?? []).length === 0, kuErr?.message ?? `n=${kuDirect?.length}`);
  const { data: sub, error: subErr } = await jA.rpc('quiz_staff_record_v2', { p_course_id: QUIZ, p_request_id: `qj_${s}_pass`, p_rows: [{ item_id: ITEM, response: 0, ord: 0 }] });
  const { data: kuRow } = await admin.from('knowhow_understanding').select('staff_name, verified_at').eq('entry_id', ENTRY).eq('staff_id', aId).maybeSingle();
  check('본인 통과 기록 = 제출 RPC(정답) 뒤 서버가 쓴다', !subErr && !!sub && !!kuRow?.verified_at && kuRow?.staff_name === 'QA받은직원', subErr?.message ?? JSON.stringify(kuRow));
  const { error: kuHack } = await jB.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: ENTRY, staff_id: aId, staff_name: '위조' });
  // 0333: 앱의 직접 쓰기는 오류 없이 무시된다(출시 앱에 실패 문구를 띄우지 않으려고). 위조 행이 안 생기는지가 핵심이다.
  const { data: kuForged } = await admin.from('knowhow_understanding').select('staff_name').eq('entry_id', ENTRY).eq('staff_id', aId).eq('staff_name', '위조');
  check('남의 통과 기록 위조 안 생김(오류 없음 · 행 0)', !kuHack && (kuForged ?? []).length === 0, kuHack?.message ?? `n=${kuForged?.length}`);
  const { data: done } = await jA.rpc('mark_quiz_completed', { p_id: AS_A });
  check('완료 기록 true', done === true, `got=${done}`);
  const { data: fin } = await admin.from('quiz_assignments').select('opened_at, completed_at').eq('id', AS_A).maybeSingle();
  check('opened_at · completed_at 둘 다 있다', !!fin?.opened_at && !!fin?.completed_at);

  const { data: seen } = await owner.from('knowhow_understanding').select('staff_id').eq('entry_id', ENTRY);
  check('사장 결과 화면이 통과를 읽는다', (seen ?? []).length === 1 && seen[0].staff_id === aId);

  // ── ⑦ 문항 수 판정 ─────────────────────────────────────────────────────
  console.log('— ⑦ 문항 수(카드가 시작 가능한지) —');
  const { data: cnt, error: cntErr } = await jA.rpc('quiz_item_counts');
  const mineCnt = (cnt ?? []).find((r) => r.entry_id === ENTRY);
  check('직원 세션에서 문항 1건으로 센다', !cntErr && Number(mineCnt?.n) === 1, cntErr?.message ?? `n=${mineCnt?.n}`);
  await admin.from('quiz_items').update({ status: 'archived' }).eq('id', ITEM);
  const { data: cnt2 } = await jA.rpc('quiz_item_counts');
  check('보관한 문항은 안 센다(카드도 안 뜬다)', !(cnt2 ?? []).some((r) => r.entry_id === ENTRY));
  await admin.from('quiz_items').update({ status: 'active' }).eq('id', ITEM);

  // ── ⑧ 크로스테넌트 ─────────────────────────────────────────────────────
  console.log('— ⑧ 남의 매장 —');
  const slotRes = await fetch(`${URL_}/rest/v1/store_slots`, {
    method: 'POST',
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_id: ownerId, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() }),
  });
  if (!slotRes.ok) throw new Error('store_slots: ' + slotRes.status);
  const { data: c2, error: c2e } = await owner.rpc('create_store', { p_store_name: 'QJ 2호점', p_industry: '카페·디저트', p_biz_no: null });
  if (c2e) throw new Error('create_store(2): ' + c2e.message);
  UNIT2 = c2?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT2, p_days: 1, p_plan: 'multi' });
  const QUIZ2 = `tc_qj2_${s}`;
  await admin.from('training_courses').insert({ id: QUIZ2, unit_id: UNIT2, key: `qj2_${s}`, name: '2호점 퀴즈', min_items: 1, max_items: 10, position: 0, active: true });
  await admin.from('quiz_assignments').insert({ id: `qza_x_${s}`, unit_id: UNIT2, course_id: QUIZ2, user_id: ownerId, scheduled_on: DAY, sent_at: new Date().toISOString() });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });

  const { data: xRows } = await jA.from('quiz_assignments').select('id').eq('unit_id', UNIT2);
  check('직원이 남의 매장 발송 0행', (xRows ?? []).length === 0, `n=${xRows?.length}`);
  const { data: xAll } = await jA.from('quiz_assignments').select('unit_id');
  check('직원이 보는 발송은 전부 자기 매장', (xAll ?? []).every((r) => r.unit_id === UNIT), `units=${[...new Set((xAll ?? []).map((r) => r.unit_id))].join(',')}`);

  // ── ⑨ 문항은 퀴즈에 묶인다(0307) · 다시 알리기 · 마감 달력 ─────────────────────
  //   2026-10-15 안드로이드 실측 QA 에서 나온 결함 셋이 기존 하니스에 없었다:
  //   #1 같은 노하우로 퀴즈를 두 번 만들면 두 번째 퀴즈에 첫 퀴즈 문항까지 딸려 왔다(4개 고르고 '문항 6개').
  //   #6 '다시 알리기'가 오늘 보낸 사람에게 오늘 날짜 행을 또 넣어 0행 실패 → 오류 토스트.
  //   #7 설정의 마감을 바꿔도 이미 받은 사람의 마감은 그대로였다(이제 달력으로 고르면 전부 바뀐다).
  console.log('— ⑨ 문항은 퀴즈에 묶인다(0307) —');
  const QUIZ_B = `tc_qjb_${s}`;
  await owner.from('training_courses').insert({ id: QUIZ_B, unit_id: UNIT, key: `qjb_${s}`, name: '같은 노하우 두 번째 퀴즈', min_items: 1, max_items: 10, position: 1, active: true });
  await owner.from('course_entries').insert({ course_id: QUIZ_B, entry_id: ENTRY, unit_id: UNIT, position: 0 });
  const ITEM_B = `qz_qjb_${s}`;
  const { error: qbErr } = await owner.from('quiz_items').insert({
    id: ITEM_B, unit_id: UNIT, entry_ids: [ENTRY], kind: 't0', format: 'mc4',
    payload: { ask: '두 번째 퀴즈 문항', options: ['가', '나', '다', '라'], answer: 1 },
    source: 'owner', status: 'active', created_by: ownerId, course_id: QUIZ_B,
  });
  check('⑨-1 course_id 를 실어 문항을 저장한다', !qbErr, qbErr?.message ?? '');
  await admin.from('quiz_items').update({ course_id: QUIZ }).eq('id', ITEM);
  const ids = (rows) => (rows ?? []).map((r) => r.id).sort().join(',');
  { const { data, error } = await jA.rpc('quiz_items_for', { p_entry_ids: [ENTRY], p_limit: 3, p_course_id: QUIZ });
    check('⑨-2 퀴즈 A 응시 = A 문항만(같은 노하우의 다른 퀴즈 문항이 안 딸려온다)', !error && ids(data) === ITEM, error?.message ?? `ids=${ids(data)}`); }
  { const { data } = await jA.rpc('quiz_items_for', { p_entry_ids: [ENTRY], p_limit: 3, p_course_id: QUIZ_B });
    check('⑨-3 퀴즈 B 응시 = B 문항만', ids(data) === ITEM_B, `ids=${ids(data)}`); }
  { const { data, error } = await jA.rpc('quiz_items_for', { p_entry_ids: [ENTRY], p_limit: 3 });
    check('⑨-4 옛 앱(2인자 호출)은 전처럼 노하우 겹침 전부', !error && (data ?? []).length === 2, error?.message ?? `n=${data?.length}`); }
  // 0330: 공유 문항(course_id 없음)은 이제 만들 수 없다. 풀어 두려는 시도 자체가 거부돼야 한다.
  { const { error } = await admin.from('quiz_items').update({ course_id: null }).eq('id', ITEM_B);
    check('⑨-5 문항의 course_id 를 비우는 것은 거부된다(0330 NOT NULL)', !!error, error?.code ?? '거부 안 됨');
    const { error: insNullErr } = await admin.from('quiz_items').insert({
      id: `qz_qjnull_${s}`, unit_id: UNIT, entry_ids: [ENTRY], kind: 't0', format: 'mc4',
      payload: { ask: '공유 문항', options: ['가', '나', '다', '라'], answer: 0 }, source: 'owner', status: 'active' });
    check('⑨-5b course_id 없는 문항 insert 는 거부된다(0330)', !!insNullErr, insNullErr?.code ?? '거부 안 됨'); }
  const TOKEN = `qjtok_${s}_abcdefghijklmnopqrstuvwxyz`;
  { const { error: lkErr } = await owner.from('quiz_links').insert({
      id: `ql_qj_${s}`, unit_id: UNIT, course_id: QUIZ, token: TOKEN, expires_at: new Date(Date.now() + 864e5).toISOString() });
    const { data, error } = await mk().rpc('quiz_link_items', { p_token: TOKEN, p_limit: null });
    check('⑨-6 외부 링크(anon)도 그 퀴즈의 문항만', !lkErr && !error && ids(data) === ITEM, lkErr?.message ?? error?.message ?? `ids=${ids(data)}`); }
  { const { error } = await owner.from('quiz_assignments').insert({ id: `qza_dup_${s}`, unit_id: UNIT, course_id: QUIZ, user_id: aId, scheduled_on: DAY });
    check('⑨-7 같은 날 같은 사람 발송 행은 유일(23505) → 다시 알리기는 오늘 행이 있으면 내일 날짜로 넣는다', error?.code === '23505', `code=${error?.code}`); }
  { const { data, error } = await owner.from('quiz_assignments').insert({ id: `qza_rem_${s}`, unit_id: UNIT, course_id: QUIZ, user_id: aId, scheduled_on: TOMORROW }).select('id');
    check('⑨-8 내일 날짜 다시 알리기 행은 들어간다', !error && (data ?? []).length === 1, error?.message ?? ''); }
  const NEWDUE = ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + 5));
  { const { data, error } = await owner.from('quiz_assignments').update({ due_date: NEWDUE, due_on: NEWDUE }).eq('course_id', QUIZ).select('id');
    check('⑨-9 사장이 마감 날짜를 바꾸면 이미 받은 발송까지 전부 바뀐다', !error && (data ?? []).length >= 3, error?.message ?? `n=${data?.length}`); }
  { const { data } = await jA.from('quiz_assignments').select('due_on').eq('id', AS_A).maybeSingle();
    check('⑨-10 직원 카드가 바뀐 마감을 읽는다', data?.due_on === NEWDUE, `due_on=${data?.due_on}`); }
}

async function cleanup() {
  for (const unit of [UNIT, UNIT2].filter(Boolean)) {
    await admin.from('quiz_assignments').delete().eq('unit_id', unit);
    await admin.from('quiz_links').delete().eq('unit_id', unit);
    await admin.from('quiz_items').delete().eq('unit_id', unit);
    await admin.from('knowhow_understanding').delete().eq('unit_id', unit);
    await admin.from('quiz_attempt_items').delete().eq('unit_id', unit);
    await admin.from('quiz_attempts').delete().eq('unit_id', unit);
    await admin.from('course_entries').delete().eq('unit_id', unit);
    await admin.from('training_courses').delete().eq('unit_id', unit);
  }
  for (const id of made.entries) await admin.from('playbook_entries').delete().eq('id', id);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('  ✗ 예외:', e?.message ?? e);
} finally {
  await cleanup().catch((e) => console.error('  ! 정리 실패:', e?.message ?? e));
  await cleanupSeededPhones(URL_, SRV, qaPhones).catch(() => {});
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} / fail ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
