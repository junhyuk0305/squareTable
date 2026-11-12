// qa-scheduler-recheck.mjs — A2 예약 발송기 X칸 1~4 결정적 재현 (2026-11-03 · P2 · 로컬 도커 전용 · 자가정리 · AI 호출 0회)
//
// 근거 = 산출물/오류탐지_2026-11-03/A2_예약발송기.md §3·§4. 각 칸을 고정 순서로 만들고 발송기 함수를 service_role 로 직접 부른다.
//   ✗(FAIL) = 그 X칸이 실제로 재현됐다(결함 확인). ✓(PASS) = 재현 안 됨(기각 후보). 대조군이 안 서면 skip(통과로 세지 않는다).
//   ① 좌석 잠김: 유료 때 3명이 들어온 뒤 만료로 무료가 된 매장(seat_locked_for = true 인 3번째 직원)에게
//      due_quiz_sends · due_task_reminders 가 내보내는가.
//   ② 완료 뒤 대기 행(결함 ②): 다 푼 뒤에도 그 전에 만든 다시 알리기(manual) 대기 행이 후보인가. 대조군 = 같은 모양의 join 행.
//   ③ 재확인 대기 행이 다시 확인(verified_at 갱신) 뒤에도 후보로 남는가. 재확인 행은 enqueue_knowhow_rechecks 로 실제로 만든다.
//      11-05 사용자 결정 = 남아야 한다(재확인을 끝내기 전이면 보낸다). 빠지면 ✗.
//   ④ 마감 날짜가 어제인 행이 후보인가 · 선점하면 due_on 이 어제로 찍히는가.
// ⚠️ due_quiz_sends 는 전역 함수이고 맨 앞에서 enqueue_knowhow_rechecks 를 전역으로 돈다. 이 매장 행만 선점한다(④ 한 건).
// 사용: node scripts/qa-scheduler-recheck.mjs --local
import { localEnv, makeLocal, makeWorld, cleanupWorld, kstDay, ok } from './lib/qa-fz-local.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin, psql } = L;
const MIG = psql('select max(version) from supabase_migrations.schema_migrations');
console.log(`— 대상 로컬 ${env.URL_} · schema_migrations 최고 ${MIG} · billing_free_mode ${psql('select public.billing_free_mode()')} —`);
if (Number(MIG) >= 348) console.log(`  · 0348(11-04 main 머지) 이후 DB 다. ①퀴즈·②·④ 는 0348 이 고쳤으므로 재현 안 됨이 정상이다. 수정 전 RED 를 보려면 0348 이전 DB 가 필요하다.`);

let pass = 0, fail = 0, skip = 0, executed = 0, ref = 0; // ref = 단언 없이 사실만 찍은 참고 줄(통과로 안 센다)
const PLANNED = 6;
const check = (n, reproduced, extra = '') => { executed++; reproduced ? (fail++, console.log('  ✗ 재현됨 ·', n, extra)) : (pass++, console.log('  ✓ 재현 안 됨 ·', n, extra)); };
const skipped = (n, why) => { executed++; skip++; console.log('  - skip ·', n, '·', why); };
const worlds = [];
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const dueIds = async (unit) => (await ok(admin.rpc('due_quiz_sends'), 'due_quiz_sends')).filter((r) => r.out_unit_id === unit).map((r) => r.out_assignment_id);
const insA = async (row) => (await ok(admin.from('quiz_assignments').insert(row).select('id').single(), 'insert assignment')).id;

async function seatLock() {
  console.log('— ① 좌석 잠김(무료 상한 2 · 만료로 무료가 된 매장의 3번째 직원) —');
  const w = await makeWorld(L, env, { tag: 'x1', staffN: 3, plan: 'multi', courses: [{ items: 2 }] });
  worlds.push(w);
  // 유료(multi) 동안 3명이 합류했다 → 이용 기간이 끝나 무료가 됐다(실제로 3번째 좌석 잠금이 생기는 길).
  await ok(admin.from('unit_subscriptions').update({ paid_until: ago(1) }).eq('unit_id', w.unit), 'expire');
  const [s1, s2, s3] = w.staff;
  const q = (sql) => psql(sql.replaceAll('$U', `'${w.unit}'`));
  const plan = q('select public.effective_plan($U)');
  const locked = q(`select public.unit_access_locked($U)`);
  const seat = w.staff.map((s) => q(`select public.seat_locked_for($U, '${s.id}')`));
  console.log(`  · plan ${plan} · 매장 잠김 ${locked} · 좌석 잠김 ${seat.join('/')}`);
  const lockedStaff = w.staff.filter((_, i) => seat[i] === 't');
  if (plan !== 'free' || locked !== 'f' || lockedStaff.length !== 1) {
    skipped('①퀴즈', `셋업 안 섬(plan ${plan} · locked ${locked} · 잠긴 직원 ${lockedStaff.length})`);
    skipped('①할일', '같은 셋업');
    return;
  }
  const L3 = lockedStaff[0]; const open = w.staff.find((s) => s !== L3);
  const day = kstDay();
  const aL = await insA({ unit_id: w.unit, course_id: w.courses[0].id, user_id: L3.id, scheduled_on: day });
  const aO = await insA({ unit_id: w.unit, course_id: w.courses[0].id, user_id: open.id, scheduled_on: day });
  const ids = await dueIds(w.unit);
  if (!ids.includes(aO)) skipped('①퀴즈', '대조군(잠기지 않은 직원) 행도 후보가 아니다');
  else check('①퀴즈: 좌석 잠긴 직원에게 due_quiz_sends 가 내보낸다', ids.includes(aL), `후보 ${ids.length}건 · 잠긴 직원 행 ${ids.includes(aL) ? '있음' : '없음'}`);

  const k = new Date(Date.now() + 9 * 3600e3);
  const mins = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (mins < 5) { skipped('①할일', 'KST 자정 직후 5분 — remind_at 창이 어제로 넘어간다'); return; }
  const T = `${String(Math.floor((mins - 2) / 60)).padStart(2, '0')}:${String((mins - 2) % 60).padStart(2, '0')}`;
  const tid = `t_fz_x1_${w.s}`;
  await ok(admin.from('work_templates').insert({ id: tid, unit_id: w.unit, section: 'open', text: 'FZ 좌석 잠김 할일', scope: 'shared',
    created_by: w.owner.id, recurrence: null, date: day, remind_at: T, owner_ids: [open.id, L3.id] }), 'work_templates');
  const rows = (await ok(admin.rpc('due_task_reminders'), 'due_task_reminders')).filter((r) => r.out_template_id === tid);
  const rec = rows[0]?.out_recipients ?? [];
  if (!rec.includes(open.id)) skipped('①할일', `대조군(잠기지 않은 담당자)도 수신자가 아니다(행 ${rows.length})`);
  else check('①할일: 좌석 잠긴 담당자가 due_task_reminders 수신자에 들어간다', rec.includes(L3.id), `수신자 ${rec.length}명`);
  void s1; void s2; void s3;
}

async function multiStore() {
  const w = await makeWorld(L, env, { tag: 'x2', staffN: 4, plan: 'multi', courses: [{ items: 2, answerDays: 3 }] });
  worlds.push(w);
  const [sDone, sCtl, sRe, sDue] = w.staff;
  const C = w.courses[0];
  const day = kstDay();

  console.log('— ② 완료 뒤 대기 행(다시 알리기 manual · 대조군 = 아직 안 푼 직원의 manual) —');
  // A2 R-X2: 앞 발송을 이틀 전에 받았다. sDone 은 어제 끝냈고 sCtl 은 안 끝냈다. 대기 행은 그보다 먼저(3일 전) 만들어졌다.
  // 대조군은 원래 join 행이었다. 0348(11-04)이 다 푼 사람의 join 도 막아 대조군이 될 수 없어 바꿨다.
  for (const [s, done] of [[sDone, true], [sCtl, false]]) {
    const a1 = await insA({ unit_id: w.unit, course_id: C.id, user_id: s.id, scheduled_on: kstDay(-2) });
    await ok(admin.from('quiz_assignments').update({ sent_at: ago(48), opened_at: ago(48), completed_at: done ? ago(24) : null }).eq('id', a1), 'A1 sent');
    const a2 = await insA({ unit_id: w.unit, course_id: C.id, user_id: s.id, scheduled_on: day, origin: 'manual' });
    await ok(admin.from('quiz_assignments').update({ created_at: ago(72) }).eq('id', a2), 'A2 created_at');
    s.a2 = a2;
  }
  let ids = await dueIds(w.unit);
  if (!ids.includes(sCtl.a2)) skipped('②', '대조군(안 푼 직원의 manual 대기 행)도 후보가 아니다 — 다른 상한에 걸렸다');
  else check('②: 다 푼 직원의 다시 알리기(manual) 대기 행이 후보다', ids.includes(sDone.a2), `manual ${ids.includes(sDone.a2) ? '후보' : '빠짐'} · 대조군 후보`);

  console.log('— ③ 재확인 대기 행이 다시 확인 뒤에도 나가는가 —');
  // 통과 기록(3일 전) → 사장이 노하우를 고침(1시간 전) → 문항 검수(source_updated_at 갱신) → enqueue 가 재확인 행을 만든다.
  await ok(admin.from('knowhow_understanding').insert({ unit_id: w.unit, entry_id: C.entry, staff_id: sRe.id, staff_name: 'QA_FZ_re', verified_at: ago(72) }), 'ku');
  await ok(admin.from('playbook_entries').update({ updated_at: ago(1) }).eq('id', C.entry), 'pe edit');
  for (const it of C.items) await ok(admin.from('quiz_items').update({ payload: { ask: `FZ 검수 ${it.id}`, choices: ['가', '나', '다'], answer_index: 1, explain: 'QA' } }).eq('id', it.id), 'item restamp');
  await ok(admin.rpc('enqueue_knowhow_rechecks'), 'enqueue');
  const re = await ok(admin.from('quiz_assignments').select('id, created_at').eq('unit_id', w.unit).eq('user_id', sRe.id).eq('origin', 'recheck').is('sent_at', null), 'recheck rows');
  if (re.length !== 1) skipped('③', `재확인 행이 안 만들어졌다(${re.length}건)`);
  else {
    const before = (await dueIds(w.unit)).includes(re[0].id);
    // 그 사이 직원이 같은 노하우를 다시 확인했다(verified_at 이 재확인 행보다 뒤).
    await ok(admin.from('knowhow_understanding').update({ verified_at: new Date().toISOString() }).eq('unit_id', w.unit).eq('staff_id', sRe.id).eq('entry_id', C.entry), 'reverify');
    ids = await dueIds(w.unit);
    if (!before) skipped('③', '다시 확인 전에도 재확인 행이 후보가 아니다(대조군 실패)');
    // 11-05 사용자 결정: 재확인을 끝내기 전이면 다른 퀴즈로 같은 노하우를 다시 확인했어도 보낸다. 빠지면 결함이다.
    else check('③: 다른 경로로 다시 확인한 직원의 재확인 대기 행이 후보에서 빠진다', !ids.includes(re[0].id), `재확인 행 ${ids.includes(re[0].id) ? '후보' : '빠짐'}`);
  }

  console.log('— ④ 마감 지난 행 —');
  const a4 = await insA({ unit_id: w.unit, course_id: C.id, user_id: sDue.id, scheduled_on: kstDay(-5), due_date: kstDay(-1) });
  ids = await dueIds(w.unit);
  const due4 = ids.includes(a4);
  check('④: 마감(due_date)이 어제인 대기 행이 후보다', due4, `due_date ${kstDay(-1)}`);
  // ④b 는 ④ 의 결과다. 후보에서 빠지면 크론이 이 행을 선점하지 않으므로 정상 경로로는 생기지 않는다(0348 이후).
  //   그때는 세지 않고 참고로만 찍는다(선점 함수 자체에 방어선이 없다는 사실).
  const claimed = await ok(admin.rpc('claim_quiz_send', { p_id: a4 }), 'claim');
  const r4 = await ok(admin.from('quiz_assignments').select('due_on, sent_at').eq('id', a4).single(), 'a4');
  const past4 = claimed === true && !!r4.due_on && r4.due_on < kstDay();
  if (!due4) { ref++; console.log(`  · 참고 · ④b: 후보가 아니라 정상 경로로는 안 생긴다. 직접 선점하면 due_on ${r4.due_on ?? '없음'}${past4 ? '(지난 날짜 · 선점 함수에 방어선 없음)' : ''}`); }
  else if (claimed !== true) skipped('④b', 'claim 이 false');
  else check('④b: 선점하면 due_on 이 이미 지난 날짜로 찍힌다', past4, `due_on ${r4.due_on} · 오늘 ${kstDay()}`);
}

let crashed = null;
// 무료 모드(app_config.billing_free_mode)가 켜져 있으면 effective_plan 이 free 로 안 떨어져 ① 셋업이 안 선다.
// ① 동안만 끄고 되돌린다(qa-quiz-resend (m) · qa-store-slots 와 같은 방식 · 2026-11-12). 로컬 전용 하니스다.
const freeModeWas = psql(`select value from public.app_config where key = 'billing_free_mode'`);
try {
  if (freeModeWas === 'true') psql(`update public.app_config set value = 'false' where key = 'billing_free_mode'`);
  try { await seatLock(); } finally { if (freeModeWas === 'true') psql(`update public.app_config set value = 'true' where key = 'billing_free_mode'`); }
  await multiStore();
} catch (e) { crashed = e; console.error('  ✗ 예외:', e?.stack ?? e); }
const cl = await cleanupWorld(L, env, worlds).catch((e) => ({ units: 0, users: 0, left: -1, detail: [String(e.message)] }));
const notRun = crashed ? PLANNED - executed - ref : 0;
if (crashed) fail++;
console.log(`  · 정리: 매장 ${cl.units} · 계정 ${cl.users} · 남은 행 ${cl.left}${cl.detail.length ? ' (' + cl.detail.join(', ') + ')' : ''}`);
console.log(`\nPASS ${pass} · FAIL ${fail} · skip ${skip} · 참고 ${ref} · 실행 못 한 단언 ${notRun} · AI 호출 0회 · 정리 남은 행 ${cl.left}`);
// skip 은 통과가 아니다(AGENTS "게이트가 거짓말하는 3가지").
process.exit(fail === 0 && skip === 0 && !crashed ? 0 : 1);
