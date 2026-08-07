// 할일 시간대 알림(0118) QA — 실 백엔드 대상·자가정리.
//
// 무엇을 증명하나:
//   ① 클라 경로: 사장 실세션이 remind_at 을 붙여 할일을 저장하고 되읽을 수 있다(PGRST204 드리프트 검출).
//   ② task_occurs_on = occursOn(useWorkStore.ts:260) 진리표와 같다 — 어긋나면 "보이는데 알림이 안 오는" 버그.
//   ③ workers_at = shiftsOn(useScheduleStore.ts:335) + 시각 필터. 승인된 교대가 근무자를 치환한다.
//   ④ due_task_reminders 수신자 규칙: private→담당자 / shared→그 시각 근무자 / 근무자 0명→매장 전원.
//   ⑤ 이미 완료(work_done)한 할일은 대상에서 빠진다.
//   ⑥ 크론이 부르는 엣지 엔드포인트를 그대로 쳐서 선점(중복 발송 방지)까지 실증한다.
//
// ⚠️ ⑥ 은 **전역 스윕**이라 다른 매장의 "이미 도달한" 리마인더도 같이 발송된다(크론이 5분 안에
//    어차피 보낼 것을 앞당기는 것뿐이라 무해하지만, 조용한 부작용이 아니라 의도된 동작임을 밝혀 둔다).
//
// 사용: node scripts/qa-task-reminder.mjs   (.env + .env.seed 자동 로드)
// 정리: 종료 시 만든 행을 지우고, 계정/매장은 cleanup-orphan-stores.mjs 가 @example.com 규칙으로 수거.
//
// ⚠️ 크론(task-reminders) 자체의 등록 여부는 여기서 못 본다(cron 스키마는 PostgREST 밖).
//    등록은 node scripts/setup-task-reminder-cron.mjs 가 'ok' 를 반환하는 것으로 확인한다.
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

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: PW, options: { data: { birth_date: '1994-03-03', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// ── KST 기준 오늘/시각 ─────────────────────────────────────
// 서버(due_task_reminders)도 KST 고정이라 여기서도 같은 축으로 만든다.
const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const pad = (n) => String(n).padStart(2, '0');
const DAY = `${kst.getFullYear()}-${pad(kst.getMonth() + 1)}-${pad(kst.getDate())}`;
const DOW = kst.getDay();
const minsNow = kst.getHours() * 60 + kst.getMinutes();
// 알림 시각 T = 5분 전(이미 도달 + 1시간 창 안). 자정 직후엔 하루를 넘지 않게 00:00 으로 클램프.
const tMin = Math.max(0, minsNow - 5);
const hhmm = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
const T = hhmm(tMin);
// T 를 감싸는 근무 구간(±10분). 자정을 넘는 구간은 서버가 심야 시프트로 올바르게 해석한다.
// 좁게 잡는 이유: "근무자 0명" 케이스도 **1시간 발송 창 안**(T-30분)에서 검사해야 실제로 실행된다.
const SHIFT_START = hhmm((tMin - 10 + 1440) % 1440);
const SHIFT_END = hhmm((tMin + 10) % 1440);
// 발송 창(직전 1시간) 안이면서 근무 구간 밖인 시각.
const OUTSIDE = hhmm((tMin - 30 + 1440) % 1440);

const qaPhones = [`0106${s.slice(0,7)}`, `0108${s.slice(0,7)}`, `0109${s.slice(0,7)}`];
const made = { templates: [], shifts: [], swaps: [], done: [], sent: [] };

async function main() {
  console.log(`— 셋업 (KST ${DAY} · 알림시각 T=${T} · 근무 ${SHIFT_START}~${SHIFT_END}) —`);
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const owner = mk();
  const ownerId = await signUpSession(owner, `qa_tr_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: `0106${s.slice(0,7)}`, store_name: 'TR', industry: '카페·디저트' });
  const { data: c1, error: ce } = await owner.rpc('create_store', { p_store_name: 'TR 알림매장', p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error('create_store: ' + ce.message);
  const UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  check('매장 생성', !!UNIT && !!CODE, `unit=${UNIT}`);

  const jA = mk(), jB = mk();
  const aId = await signUpSession(jA, `qa_tr_a_${s}@example.com`, { name: 'QA직원A', role: 'junior', phone: `0108${s.slice(0,7)}` });
  const bId = await signUpSession(jB, `qa_tr_b_${s}@example.com`, { name: 'QA직원B', role: 'junior', phone: `0109${s.slice(0,7)}` });
  for (const [j, id] of [[jA, aId], [jB, bId]]) {
    await j.rpc('join_by_invite', { p_code: CODE });
    const { error } = await owner.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await j.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  check('직원 2명 합류 승인', true);

  // ── ① 클라 경로: 사장 실세션이 remind_at 을 저장/되읽기 ────────────────
  console.log('— ① remind_at 저장 경로 —');
  const tShared = `t_tr_sh_${s}`;
  made.templates.push(tShared);
  const { error: insErr } = await owner.from('work_templates').insert({
    id: tShared, unit_id: UNIT, section: 'open', text: '매장 전체 할일(알림)',
    scope: 'shared', created_by: ownerId, recurrence: null, date: DAY, remind_at: T,
  });
  check('사장 세션 insert(remind_at)', !insErr, insErr?.message ?? '');
  const { data: back } = await owner.from('work_templates').select('remind_at').eq('id', tShared).maybeSingle();
  check('되읽기 remind_at 일치', back?.remind_at === T, `${back?.remind_at} vs ${T}`);

  const { error: badErr } = await owner.from('work_templates').insert({
    id: `t_tr_bad_${s}`, unit_id: UNIT, section: 'open', text: '형식 위반', scope: 'shared', created_by: ownerId, remind_at: '25:99',
  });
  check('잘못된 시각은 DB가 거부', !!badErr, badErr?.code ?? '거부 안 됨');

  // ── ② task_occurs_on 진리표 (occursOn 과 동일해야 한다) ────────────────
  console.log('— ② task_occurs_on 진리표 —');
  const cases = [
    ['숨김이면 어느 날도 아님', { p_recurrence: null, p_date: DAY, p_due_date: null, p_hidden: true, p_day: DAY }, false],
    ['오늘 요일 반복 → 발생', { p_recurrence: { weekly: [DOW] }, p_date: null, p_due_date: null, p_hidden: false, p_day: DAY }, true],
    ['다른 요일 반복 → 미발생', { p_recurrence: { weekly: [(DOW + 1) % 7] }, p_date: null, p_due_date: null, p_hidden: false, p_day: DAY }, false],
    ['예정일=오늘 → 발생', { p_recurrence: 'once', p_date: DAY, p_due_date: null, p_hidden: false, p_day: DAY }, true],
    ['once 인데 날짜 없음 → 미발생', { p_recurrence: 'once', p_date: null, p_due_date: null, p_hidden: false, p_day: DAY }, false],
    ['레거시(전부 없음) → 매일', { p_recurrence: null, p_date: null, p_due_date: null, p_hidden: false, p_day: DAY }, true],
  ];
  for (const [name, args, want] of cases) {
    const { data, error } = await admin.rpc('task_occurs_on', args);
    check(name, !error && data === want, error?.message ?? `got=${data} want=${want}`);
  }

  // ── ③ workers_at ───────────────────────────────────────────────────────
  console.log('— ③ workers_at (근무자 + 승인 교대) —');
  const shA = `sh_tr_a_${s}`;
  made.shifts.push(shA);
  const { error: shErr } = await admin.from('shift_templates').insert({
    id: shA, unit_id: UNIT, staff_id: aId, weekday: DOW, start_time: SHIFT_START, end_time: SHIFT_END,
  });
  if (shErr) throw new Error('shift insert: ' + shErr.message);
  const at = async (time) => {
    const { data, error } = await admin.rpc('workers_at', { p_unit: UNIT, p_day: DAY, p_time: time });
    if (error) throw new Error('workers_at: ' + error.message);
    return (data ?? []).map((r) => (typeof r === 'string' ? r : r.workers_at)).sort();
  };
  check('근무 시간 안 → A', JSON.stringify(await at(T)) === JSON.stringify([aId]));
  check('근무 시간 밖 → 없음', (await at(OUTSIDE)).length === 0, `at ${OUTSIDE}`);

  const swapId = `swap_tr_${s}`;
  made.swaps.push(swapId);
  const nowIso = new Date().toISOString();
  const { error: swErr } = await admin.from('swap_requests').insert({
    id: swapId, unit_id: UNIT, kind: 'cover', requester_id: aId, date: DAY, template_id: shA,
    note: 'QA', status: 'approved', accepted_by: bId, created_at: nowIso, updated_at: nowIso,
  });
  if (swErr) throw new Error('swap insert: ' + swErr.message);
  check('승인된 대타 → 근무자가 B로 치환', JSON.stringify(await at(T)) === JSON.stringify([bId]));

  // ── ④⑤ due_task_reminders ─────────────────────────────────────────────
  console.log('— ④ 수신자 규칙 —');
  const mine = async () => {
    const { data, error } = await admin.rpc('due_task_reminders');
    if (error) throw new Error('due_task_reminders: ' + error.message);
    return (data ?? []).filter((r) => r.out_unit_id === UNIT);
  };
  let rows = await mine();
  const shared = rows.find((r) => r.out_template_id === tShared);
  check('매장 전체 할일이 대상에 포함', !!shared, `rows=${rows.length}`);
  check('수신자 = 그 시각 근무자(교대 반영 B)', JSON.stringify(shared?.out_recipients ?? []) === JSON.stringify([bId]));

  const tPrivate = `t_tr_pv_${s}`;
  made.templates.push(tPrivate);
  await owner.from('work_templates').insert({
    id: tPrivate, unit_id: UNIT, section: 'open', text: '담당자 할일(알림)',
    scope: 'private', owner_id: aId, created_by: ownerId, date: DAY, remind_at: T,
  });
  rows = await mine();
  const priv = rows.find((r) => r.out_template_id === tPrivate);
  check('담당자 지정 할일 → 담당자 1명', JSON.stringify(priv?.out_recipients ?? []) === JSON.stringify([aId]));

  // 근무자 0명 fallback — 근무 구간 밖 시각으로 매장 전체 할일 하나 더.
  const tNoShift = `t_tr_ns_${s}`;
  made.templates.push(tNoShift);
  await owner.from('work_templates').insert({
    id: tNoShift, unit_id: UNIT, section: 'open', text: '근무자 없는 시각(알림)',
    scope: 'shared', created_by: ownerId, date: DAY, remind_at: OUTSIDE,
  });
  rows = await mine();
  const ns = rows.find((r) => r.out_template_id === tNoShift);
  check('근무자 0명 → 매장 전원(3명)', (ns?.out_recipients ?? []).length === 3, `n=${ns?.out_recipients?.length}`);

  console.log('— ⑤ 완료한 할일은 제외 —');
  made.done.push(tShared);
  await admin.from('work_done').insert({
    unit_id: UNIT, work_date: DAY, template_id: tShared,
    data: { by: aId, byName: 'QA직원A', at: new Date().toISOString() },
  });
  rows = await mine();
  check('완료한 할일은 대상에서 빠짐', !rows.some((r) => r.out_template_id === tShared));

  // ── ⑥ 엣지 스윕 E2E — 크론이 부르는 그 엔드포인트를 그대로 친다 ──────────
  console.log('— ⑥ 엣지 스윕(크론이 부르는 경로) —');
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

  made.sent.push(tPrivate, tNoShift);
  const first = await sweep(SRV);
  check('service_role 스윕 200', first.status === 200, JSON.stringify(first.body));
  const { data: claimed } = await admin
    .from('task_reminder_sent').select('template_id').eq('unit_id', UNIT).eq('remind_date', DAY);
  const claimedIds = (claimed ?? []).map((r) => r.template_id).sort();
  check('발송 원장에 선점 기록', JSON.stringify(claimedIds) === JSON.stringify([tNoShift, tPrivate].sort()), claimedIds.join(','));

  rows = await mine();
  check('선점된 할일은 다음 스윕 대상에서 빠짐(중복 발송 방지)', rows.length === 0, `남은 ${rows.length}건`);

  // ── 정리 ────────────────────────────────────────────────────────────────
  for (const id of made.sent) await admin.from('task_reminder_sent').delete().eq('template_id', id).eq('remind_date', DAY);
  for (const id of made.done) await admin.from('work_done').delete().eq('unit_id', UNIT).eq('work_date', DAY).eq('template_id', id);
  for (const id of made.swaps) await admin.from('swap_requests').delete().eq('id', id);
  for (const id of made.shifts) await admin.from('shift_templates').delete().eq('id', id);
  for (const id of made.templates) await admin.from('work_templates').delete().eq('id', id);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('  ✗ 예외:', e?.message ?? e);
} finally {
  await cleanupSeededPhones(URL_, SRV, qaPhones).catch(() => {});
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} / fail ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
