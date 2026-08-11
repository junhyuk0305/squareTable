// 퀴즈 예약 발송·마감·재확인 간격(0139) QA — 실 백엔드 대상·자가정리.
//
// 무엇을 증명하나:
//   ① 컬럼 경로: 사장 실세션이 start_at·answer_days 를 저장하고 되읽는다(PGRST204 스키마 드리프트 검출).
//      interval_step 은 기본 0 으로 붙고 범위 밖 값은 DB 가 거부한다.
//   ② quiz_assignments RLS: 사장만 만든다 / 직원은 본인 것만 본다 / 남의 매장 코스·비멤버는 거부.
//   ③ due_quiz_sends 근무일 판정: 근무 중이면 대상, 근무표가 있는데 오늘 없으면 제외,
//      근무표를 아예 안 쓰는 매장은 fail-open(그 조건이 곧 "영원히 0건"이 되기 때문).
//   ④ 빈도 상한 = src/lib/quiz/schedule.ts 상수의 SQL 사본이 어긋나지 않는다:
//      하루 1회 · 주 2회 · 한 스윕에 같은 사람 2건 금지 · 연속 2회 무시 시 자동 정지 · 열면 재개.
//   ⑤ 예약일이 미래면 안 나간다. 내보낸 직원(멤버십 없음)에게도 안 나간다.
//   ⑥ claim_quiz_send 선점: 첫 호출만 true, due_on = 받은 날 + answer_days.
//   ⑦ 크론이 부르는 엣지 엔드포인트를 그대로 쳐서 퀴즈 갈래까지 실증한다.
//
// ★ ④ 의 기대값은 schedule.ts 를 읽어서 만든다 — 상수를 한쪽만 고치면 이 게이트가 red 가 된다.
//   (schedule.ts 머리말: "서버가 같은 판정을 해야 할 때는 상수를 마이그레이션에 옮겨 적고 양쪽을 같이 고친다")
//
// ⚠️ ⑦ 은 **전역 스윕**이라 다른 매장의 이미 도달한 할일 리마인더·예약 퀴즈도 같이 나간다
//    (크론이 5분 안에 어차피 보낼 것을 앞당기는 것뿐이지만, 의도된 동작임을 밝혀 둔다).
// ⚠️ 크론(task-reminders) 등록 자체는 여기서 못 본다 — 0139 는 새 크론을 만들지 않고 그 잡에 갈래만 얹는다.
//
// 사용: node scripts/qa-quiz-schedule.mjs   (.env + .env.seed 자동 로드)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const PW = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

// ── schedule.ts 상수 읽기 (SQL 사본과 대조할 기대값의 출처) ──────────────
const SCHED = readFileSync(here('../src/lib/quiz/schedule.ts'), 'utf8');
const constOf = (name) => {
  const m = SCHED.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`schedule.ts 에서 ${name} 을 못 찾았다 — 상수 이름이 바뀌었나?`);
  return Number(m[1]);
};
const MAX_PER_DAY = constOf('MAX_SENDS_PER_DAY');
const MAX_PER_WEEK = constOf('MAX_SENDS_PER_WEEK');
const AUTO_STOP = constOf('AUTO_STOP_AFTER_IGNORED');
const INTERVALS = JSON.parse(
  SCHED.match(/export const REVIEW_INTERVALS_DAYS\s*=\s*(\[[^\]]*\])/)[1],
);

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// ── KST 기준 오늘/시각 (서버 판정과 같은 축) ─────────────────────────────
const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = ymd(kst);
const DOW = kst.getDay();
const TOMORROW = ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + 1));
const minsNow = kst.getHours() * 60 + kst.getMinutes();
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
// 지금을 감싸는 근무 구간(±10분) / 지금을 벗어난 근무 구간.
const SHIFT_START = hhmm(minsNow - 10);
const SHIFT_END = hhmm(minsNow + 10);
const OFF_START = hhmm(minsNow + 60);
const OFF_END = hhmm(minsNow + 90);
const ANSWER_DAYS = 3;
const DUE_EXPECT = ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() + ANSWER_DAYS));

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const qaPhones = [`0106${s.slice(0,7)}`, `0108${s.slice(0,7)}`, `0109${s.slice(0,7)}`, `0107${s.slice(0,7)}`];

let UNIT = null, UNIT2 = null;
const made = { entries: [] };

// 이 매장에서 지금 나갈 것들.
const due = async () => {
  const { data, error } = await admin.rpc('due_quiz_sends');
  if (error) throw new Error('due_quiz_sends: ' + error.message);
  return (data ?? []).filter((r) => r.out_unit_id === UNIT);
};
const dueFor = async (uid) => (await due()).filter((r) => r.out_user_id === uid);

async function main() {
  console.log(`— 상수 (schedule.ts) 하루 ${MAX_PER_DAY} · 주 ${MAX_PER_WEEK} · 자동정지 ${AUTO_STOP} · 간격 ${INTERVALS.join('/')}일 —`);
  console.log(`— 셋업 (KST ${DAY} · 근무 ${SHIFT_START}~${SHIFT_END} · 비번 ${OFF_START}~${OFF_END}) —`);
  await seedVerifiedPhones(URL_, SRV, qaPhones);

  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_qs_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0106${s.slice(0,7)}`, store_name: 'QS', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'QS 퀴즈매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('매장 생성', !!UNIT && !!CODE, `unit=${UNIT}`);

  const jA = mk(), jB = mk(), jC = mk();
  const aId = await signUpSession(jA, `qa_qs_a_${s}@example.com`, { name: 'QA직원A', role: 'junior', phone: `0108${s.slice(0,7)}` });
  const bId = await signUpSession(jB, `qa_qs_b_${s}@example.com`, { name: 'QA직원B', role: 'junior', phone: `0109${s.slice(0,7)}` });
  const cId = await signUpSession(jC, `qa_qs_c_${s}@example.com`, { name: 'QA직원C', role: 'junior', phone: `0107${s.slice(0,7)}` });
  for (const [j, id] of [[jA, aId], [jB, bId], [jC, cId]]) {
    await j.rpc('join_by_invite', { p_code: CODE });
    const { error } = await owner.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await j.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  check('직원 3명 합류 승인', true);

  // ── ① 일정 컬럼 저장/되읽기 ─────────────────────────────────────────────
  console.log('— ① 일정 컬럼(start_at · answer_days · interval_step) —');
  const QUIZ = `tc_qs_${s}`;
  const { error: tcErr } = await owner.from('training_courses').insert({
    id: QUIZ, unit_id: UNIT, key: `qs_${s}`, name: '마감 청소 확인',
    description: null, preset: null, min_items: 1, max_items: 5,
    due_days: null, position: 0, active: true, start_at: DAY, answer_days: ANSWER_DAYS,
  });
  check('사장 세션 insert(start_at · answer_days)', !tcErr, tcErr?.message ?? '');
  const { data: tcBack } = await owner.from('training_courses').select('start_at, answer_days').eq('id', QUIZ).maybeSingle();
  check('되읽기 일치', tcBack?.start_at === DAY && tcBack?.answer_days === ANSWER_DAYS, `${tcBack?.start_at} / ${tcBack?.answer_days}`);

  const { error: adErr } = await owner.from('training_courses').insert({
    id: `tc_qs_bad_${s}`, unit_id: UNIT, key: `qs_bad_${s}`, name: '범위 위반', answer_days: 0,
  });
  check('answer_days=0 은 DB가 거부', !!adErr, adErr?.code ?? '거부 안 됨');

  // interval_step — 통과 기록 1건을 만들어 기본값·범위를 본다.
  const ENTRY = `pb_qs_${s}`;
  made.entries.push(ENTRY);
  const nowIso = new Date().toISOString();
  const { error: peErr } = await owner.from('playbook_entries').insert({
    id: ENTRY, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA사장', category: 'Routine',
    subcategory: '마감', title: '마감 청소', tags: [], search_keywords: ['마감'],
    square: { situation: '마감', action: { steps: ['닦는다'] }, extract: { do: '', dont: '', template: '' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '', timing: '', channel: '', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: null, query_hits_30d: 0, resolution_rate: 0 },
    photos: [], version: 1, status: 'published', quality_score: 0.7, created_at: nowIso, updated_at: nowIso,
    is_template: false, pack_id: null, needs_review: false, correction_points: [], section: null, order_index: 0,
  });
  if (peErr) throw new Error('playbook_entries: ' + peErr.message);
  const { error: kuErr } = await jA.from('knowhow_understanding').insert({ unit_id: UNIT, entry_id: ENTRY, staff_id: aId, staff_name: 'QA직원A' });
  check('통과 기록 insert', !kuErr, kuErr?.message ?? '');
  const { data: kuBack } = await admin.from('knowhow_understanding').select('interval_step').eq('entry_id', ENTRY).eq('staff_id', aId).maybeSingle();
  check('interval_step 기본값 0', kuBack?.interval_step === 0, `got=${kuBack?.interval_step}`);
  const { error: stepErr } = await admin.from('knowhow_understanding')
    .update({ interval_step: INTERVALS.length }).eq('entry_id', ENTRY).eq('staff_id', aId);
  check(`interval_step=${INTERVALS.length}(상한 초과) 거부`, !!stepErr, stepErr?.code ?? '거부 안 됨');

  // ── ② quiz_assignments RLS ──────────────────────────────────────────────
  console.log('— ② quiz_assignments RLS —');
  const asg = (id, uid, on = DAY, unit = UNIT, course = QUIZ) =>
    ({ id, unit_id: unit, course_id: course, user_id: uid, scheduled_on: on });
  const A1 = `qz_a1_${s}`, A2 = `qz_a2_${s}`, A3 = `qz_a3_${s}`;
  const B1 = `qz_b1_${s}`, C1 = `qz_c1_${s}`;
  const { error: oiErr } = await owner.from('quiz_assignments').insert([asg(A1, aId), asg(B1, bId), asg(C1, cId)]);
  check('사장 insert 성공', !oiErr, oiErr?.message ?? '');

  const { data: aSees } = await jA.from('quiz_assignments').select('id').eq('unit_id', UNIT);
  check('직원은 본인 것만 조회', (aSees ?? []).length === 1 && aSees[0].id === A1, `n=${aSees?.length}`);

  const { error: jiErr } = await jA.from('quiz_assignments').insert(asg(`qz_hack_${s}`, aId, TOMORROW));
  check('직원 insert 거부', !!jiErr, jiErr?.code ?? '거부 안 됨');

  const { data: juUp } = await jA.from('quiz_assignments').update({ sent_at: null, due_on: null }).eq('id', A1).select();
  check('직원 update 0행(마감 무력화 차단)', (juUp ?? []).length === 0, `updated=${juUp?.length}`);

  // 2호점을 만들어 "코스·수신자가 그 매장 것인가" 가드를 실제로 친다.
  const slotRes = await fetch(`${URL_}/rest/v1/store_slots`, {
    method: 'POST',
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_id: ownerId, paid_until: new Date(Date.now() + 30 * 864e5).toISOString() }),
  });
  if (!slotRes.ok) throw new Error('store_slots 적립 실패: ' + slotRes.status);
  const { data: c2, error: c2e } = await owner.rpc('create_store', { p_store_name: 'QS 2호점', p_industry: '카페·디저트', p_biz_no: null });
  if (c2e) throw new Error('create_store(2호점): ' + c2e.message);
  UNIT2 = c2?.[0]?.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT2, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT2 });
  const QUIZ2 = `tc_qs2_${s}`;
  await owner.from('training_courses').insert({ id: QUIZ2, unit_id: UNIT2, key: `qs2_${s}`, name: '2호점 퀴즈' });

  const { error: xcErr } = await owner.from('quiz_assignments').insert(asg(`qz_xc_${s}`, ownerId, DAY, UNIT2, QUIZ));
  check('남의 매장 코스 참조 거부', !!xcErr, xcErr?.code ?? '거부 안 됨');
  const { error: xmErr } = await owner.from('quiz_assignments').insert(asg(`qz_xm_${s}`, aId, DAY, UNIT2, QUIZ2));
  check('그 매장 멤버가 아닌 수신자 거부', !!xmErr, xmErr?.code ?? '거부 안 됨');
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });

  // ── ③ 근무일 판정 ───────────────────────────────────────────────────────
  console.log('— ③ 근무일 판정 —');
  // 아직 shift_templates 가 0행 = 근무표를 안 쓰는 매장 → fail-open.
  check('근무표 없는 매장은 fail-open(3명 전부 대상)', (await due()).length === 3, `n=${(await due()).length}`);

  const shA = `sh_qs_a_${s}`, shB = `sh_qs_b_${s}`, shC = `sh_qs_c_${s}`;
  const { error: shErr } = await admin.from('shift_templates').insert([
    { id: shA, unit_id: UNIT, staff_id: aId, weekday: DOW, start_time: SHIFT_START, end_time: SHIFT_END },
    { id: shB, unit_id: UNIT, staff_id: bId, weekday: DOW, start_time: OFF_START, end_time: OFF_END },
    { id: shC, unit_id: UNIT, staff_id: cId, weekday: DOW, start_time: SHIFT_START, end_time: SHIFT_END },
  ]);
  if (shErr) throw new Error('shift insert: ' + shErr.message);
  check('근무 중인 사람은 대상(A)', (await dueFor(aId)).length === 1);
  check('근무표가 있는데 지금 근무가 아니면 제외(B)', (await dueFor(bId)).length === 0);

  // ── ④ 빈도 상한 (기대값은 schedule.ts 에서 온다) ────────────────────────
  console.log('— ④ 빈도 상한 —');
  await admin.from('quiz_assignments').insert(asg(A2, aId, TOMORROW));
  check('예약일이 미래면 제외', (await dueFor(aId)).length === 1, '오늘치 1건만');

  // 같은 사람에게 오늘치 2건 → 한 스윕에 1건만(아직 sent_at 이 없어 원장 조회만으로는 못 막는 자리).
  const QUIZ_B = `tc_qsb_${s}`;
  await owner.from('training_courses').insert({ id: QUIZ_B, unit_id: UNIT, key: `qsb_${s}`, name: '두 번째 퀴즈', start_at: DAY });
  await admin.from('quiz_assignments').insert(asg(A3, aId, DAY, UNIT, QUIZ_B));
  check(`한 스윕에 같은 사람 ${MAX_PER_DAY}건까지`, (await dueFor(aId)).length === MAX_PER_DAY, `n=${(await dueFor(aId)).length}`);

  // 주 상한 — 최근 7일 안에 발송 MAX_PER_WEEK 건(열어 둬서 자동 정지와 섞이지 않게).
  const wk = [];
  for (let i = 0; i < MAX_PER_WEEK; i++) {
    wk.push({ id: `qz_wk${i}_${s}`, unit_id: UNIT, course_id: QUIZ, user_id: cId,
      scheduled_on: DAY, sent_at: daysAgo(2 + i), opened_at: daysAgo(2 + i), due_on: null });
  }
  // scheduled_on 이 같으면 unique(course,user,scheduled_on) 에 걸린다 → 날짜를 흩는다.
  wk.forEach((r, i) => { r.scheduled_on = ymd(new Date(kst.getFullYear(), kst.getMonth(), kst.getDate() - 2 - i)); });
  const { error: wkErr } = await admin.from('quiz_assignments').insert(wk);
  if (wkErr) throw new Error('주 상한 시드: ' + wkErr.message);
  check(`7일 안에 ${MAX_PER_WEEK}건 발송했으면 제외`, (await dueFor(cId)).length === 0);

  // 창 밖으로 밀면 다시 대상. 동시에 자동 정지 판정의 재료가 된다.
  for (const [i, r] of wk.entries()) {
    await admin.from('quiz_assignments').update({ sent_at: daysAgo(10 + i), opened_at: daysAgo(10 + i) }).eq('id', r.id);
  }
  check('7일 창 밖이면 다시 대상', (await dueFor(cId)).length === 1);

  // 자동 정지 — 연속 AUTO_STOP 건을 안 열면 멈춘다.
  for (const r of wk) await admin.from('quiz_assignments').update({ opened_at: null }).eq('id', r.id);
  check(`연속 ${AUTO_STOP}회 무시하면 자동 정지`, (await dueFor(cId)).length === 0);
  const newest = wk[0]; // sent_at 이 가장 최근인 것(-10일)
  await admin.from('quiz_assignments').update({ opened_at: daysAgo(9) }).eq('id', newest.id);
  check('그 사람이 열면 다시 시작', (await dueFor(cId)).length === 1);

  // ── ⑤ 내보낸 직원 ───────────────────────────────────────────────────────
  console.log('— ⑤ 내보낸 직원 —');
  const { data: memB } = await admin.from('unit_members').select('*').eq('unit_id', UNIT).eq('user_id', bId).maybeSingle();
  await admin.from('shift_templates').update({ start_time: SHIFT_START, end_time: SHIFT_END }).eq('id', shB);
  check('B가 근무 중이 되면 대상', (await dueFor(bId)).length === 1);
  await admin.from('unit_members').delete().eq('unit_id', UNIT).eq('user_id', bId);
  check('멤버십이 없으면 제외(퇴사자 폰에 안 간다)', (await dueFor(bId)).length === 0);
  if (memB) await admin.from('unit_members').insert(memB);

  // ── ⑥ claim_quiz_send 선점 ──────────────────────────────────────────────
  console.log('— ⑥ 발송 선점 —');
  const { data: cl1, error: clErr } = await admin.rpc('claim_quiz_send', { p_id: A1 });
  check('첫 선점 true', !clErr && cl1 === true, clErr?.message ?? `got=${cl1}`);
  const { data: cl2 } = await admin.rpc('claim_quiz_send', { p_id: A1 });
  check('두 번째 선점 false(중복 발송 방지)', cl2 === false, `got=${cl2}`);
  const { data: a1Row } = await admin.from('quiz_assignments').select('sent_at, due_on').eq('id', A1).maybeSingle();
  check('sent_at 채워짐', !!a1Row?.sent_at);
  check(`due_on = 받은 날 + ${ANSWER_DAYS}일`, a1Row?.due_on === DUE_EXPECT, `${a1Row?.due_on} vs ${DUE_EXPECT}`);
  check(`오늘 이미 받았으면 제외(하루 ${MAX_PER_DAY}회)`, (await dueFor(aId)).length === 0);

  // 마감 없는 퀴즈는 due_on 도 없다.
  const { data: cl3 } = await admin.rpc('claim_quiz_send', { p_id: A3 });
  const { data: a3Row } = await admin.from('quiz_assignments').select('due_on').eq('id', A3).maybeSingle();
  check('마감 없는 퀴즈는 due_on null', cl3 === true && a3Row?.due_on === null, `${a3Row?.due_on}`);

  // ── ⑦ 엣지 스윕 E2E ────────────────────────────────────────────────────
  console.log('— ⑦ 엣지 스윕(크론이 부르는 경로) —');
  const sweep = async (key) => {
    const res = await fetch(`${URL_}/functions/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ mode: 'task_reminders' }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const denied = await sweep(ANON);
  check('anon 키로는 스윕 거부(403)', denied.status === 403, `status=${denied.status}`);

  const before = (await dueFor(cId)).length;
  const first = await sweep(SRV);
  check('service_role 스윕 200', first.status === 200, JSON.stringify(first.body));
  check('응답에 퀴즈 갈래가 있다', typeof first.body?.quizSwept === 'number' && !first.body?.quizError, JSON.stringify(first.body));
  const { data: cRow } = await admin.from('quiz_assignments').select('sent_at').eq('id', C1).maybeSingle();
  check('스윕이 선점까지 마쳤다', before === 1 && !!cRow?.sent_at, `before=${before} sent_at=${cRow?.sent_at}`);
  check('선점된 건은 다음 스윕 대상에서 빠짐', (await dueFor(cId)).length === 0);
}

async function cleanup() {
  for (const unit of [UNIT, UNIT2].filter(Boolean)) {
    await admin.from('quiz_assignments').delete().eq('unit_id', unit);
    await admin.from('shift_templates').delete().eq('unit_id', unit);
    await admin.from('knowhow_understanding').delete().eq('unit_id', unit);
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
