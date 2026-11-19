// qa-scheduler-recheck.mjs — A2 예약 발송기 X칸 1~4 결정적 재현 (2026-11-03 · P2 · 로컬 도커 전용 · 자가정리 · AI 호출 0회)
//
// 근거 = 산출물/오류탐지_2026-11-03/A2_예약발송기.md §3·§4. 각 칸을 고정 순서로 만들고 발송기 함수를 service_role 로 직접 부른다.
//   ✗(FAIL) = 그 X칸이 실제로 재현됐다(결함 확인). ✓(PASS) = 재현 안 됨(기각 후보). 대조군이 안 서면 skip(통과로 세지 않는다).
//   ① 좌석 잠김: 유료 때 3명이 들어온 뒤 만료로 무료가 된 매장(seat_locked_for = true 인 3번째 직원)에게
//      due_quiz_sends · due_task_reminders 가 내보내는가.
//   ② 완료 뒤 대기 행(결함 ②): 다 푼 뒤에도 그 전에 만든 다시 알리기(manual) 대기 행이 후보인가. 대조군 = 같은 모양의 join 행.
//   ③ ★0871(2026-11-19 사용자 결정 · 재확인 기능 없앰): 노하우가 바뀌어도 예약 발송이 재확인 행을 만들지 않는가(③a) ·
//      남아 있는 재확인 대기 행이 후보에서 빠지는가(③b). 만들거나 후보면 ✗. (옛 ③ = 11-05 "다시 확인 뒤에도 남아야 한다")
//   ④ 마감 날짜가 어제인 행이 후보인가 · 선점하면 due_on 이 어제로 찍히는가.
// ⚠️ due_quiz_sends 는 전역 함수다. 이 매장 행만 선점한다(④ 한 건). ★0871 부터 재확인 큐(enqueue_knowhow_rechecks)는 안 돈다.
// ★0871: 예약일이 오늘이고 보낼 시각(send_at)이 없는 행은 09:00 KST 에 나간다. 시각과 무관하게 재려고 오늘 행에 1분 전 send_at 을 넣는다.
// 사용: node scripts/qa-scheduler-recheck.mjs --local
import { spawnSync } from 'node:child_process';
import { localEnv, makeLocal, makeWorld, cleanupWorld, kstDay, ok } from './lib/qa-fz-local.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin, psql } = L;
const MIG = psql('select max(version) from supabase_migrations.schema_migrations');
console.log(`— 대상 로컬 ${env.URL_} · schema_migrations 최고 ${MIG} · billing_free_mode ${psql('select public.billing_free_mode()')} —`);
if (Number(MIG) >= 348) console.log(`  · 0348(11-04 main 머지) 이후 DB 다. ①퀴즈·②·④ 는 0348 이 고쳤으므로 재현 안 됨이 정상이다. 수정 전 RED 를 보려면 0348 이전 DB 가 필요하다.`);

let pass = 0, fail = 0, skip = 0, executed = 0, ref = 0; // ref = 단언 없이 사실만 찍은 참고 줄(통과로 안 센다)
const PLANNED = 19;   // ⑤~⑧ 4개를 더했다(2026-11-12 S0) · ⑨~⑫ 4개(S3) · ⑬~⑯ 4개(11-16 U-4) · ③ 이 ③a·③b 둘이 됐다(0871)
const check = (n, reproduced, extra = '') => { executed++; reproduced ? (fail++, console.log('  ✗ 재현됨 ·', n, extra)) : (pass++, console.log('  ✓ 재현 안 됨 ·', n, extra)); };
const skipped = (n, why) => { executed++; skip++; console.log('  - skip ·', n, '·', why); };
const worlds = [];
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const dueIds = async (unit) => (await ok(admin.rpc('due_quiz_sends'), 'due_quiz_sends')).filter((r) => r.out_unit_id === unit).map((r) => r.out_assignment_id);
const DUE_NOW = new Date(Date.now() - 60e3).toISOString();   // ★0871 보낼 시각 = 1분 전
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
  const aL = await insA({ unit_id: w.unit, course_id: w.courses[0].id, user_id: L3.id, scheduled_on: day, send_at: DUE_NOW });
  const aO = await insA({ unit_id: w.unit, course_id: w.courses[0].id, user_id: open.id, scheduled_on: day, send_at: DUE_NOW });
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
    const a2 = await insA({ unit_id: w.unit, course_id: C.id, user_id: s.id, scheduled_on: day, origin: 'manual', send_at: DUE_NOW });
    await ok(admin.from('quiz_assignments').update({ created_at: ago(72) }).eq('id', a2), 'A2 created_at');
    s.a2 = a2;
  }
  let ids = await dueIds(w.unit);
  if (!ids.includes(sCtl.a2)) skipped('②', '대조군(안 푼 직원의 manual 대기 행)도 후보가 아니다 — 다른 상한에 걸렸다');
  else check('②: 다 푼 직원의 다시 알리기(manual) 대기 행이 후보다', ids.includes(sDone.a2), `manual ${ids.includes(sDone.a2) ? '후보' : '빠짐'} · 대조군 후보`);

  console.log('— ③ 재확인 없앰(0871): 예약 발송이 재확인 행을 만들지 않고 · 남은 재확인 행도 안 나간다 —');
  // 통과 기록(3일 전) → 사장이 노하우를 고침(1시간 전) → 문항 검수(source_updated_at 갱신). 0871 전에는 다음 스윕이 재확인 행을 만들었다.
  await ok(admin.from('knowhow_understanding').insert({ unit_id: w.unit, entry_id: C.entry, staff_id: sRe.id, staff_name: 'QA_FZ_re', verified_at: ago(72) }), 'ku');
  await ok(admin.from('playbook_entries').update({ updated_at: ago(1) }).eq('id', C.entry), 'pe edit');
  for (const it of C.items) await ok(admin.from('quiz_items').update({ payload: { ask: `FZ 검수 ${it.id}`, choices: ['가', '나', '다'], answer_index: 1, explain: 'QA' } }).eq('id', it.id), 'item restamp');
  ids = await dueIds(w.unit);   // 크론 한 틱과 같다(enqueue 를 직접 부르지 않는다)
  const re = await ok(admin.from('quiz_assignments').select('id').eq('unit_id', w.unit).eq('user_id', sRe.id).eq('origin', 'recheck'), 'recheck rows');
  // 대조군 = 같은 상태에서 옛 재확인 큐(되돌리기용으로 남은 함수)를 트랜잭션 안에서 부르면 행이 생긴다(되돌린다).
  const tx = spawnSync('docker', ['exec', '-i', env.DB_CONTAINER, 'psql', '-U', 'postgres', '-tA', '-q', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8',
    input: `begin;\nselect public.enqueue_knowhow_rechecks();\nselect count(*) from public.quiz_assignments where unit_id = '${w.unit}' and user_id = '${sRe.id}' and origin = 'recheck';\nrollback;` });
  const oldWould = tx.status === 0 ? Number(tx.stdout.trim().split('\n').filter(Boolean).pop()) : NaN;
  if (!(oldWould > 0)) skipped('③a', `대조군: 옛 재확인 큐도 이 상태에서 행을 안 만든다(${tx.status === 0 ? oldWould : tx.stderr.trim()})`);
  else check('③a(0871): 노하우가 바뀐 뒤 예약 발송이 재확인 행을 만든다', re.length > 0, `재확인 행 ${re.length}건 · 옛 큐였으면 ${oldWould}건`);
  // 0871 전에 만들어져 남은 재확인 대기 행(마이그레이션이 지우지만 되돌리기·동시 쓰기로 남을 수 있다)을 직접 심는다.
  const rc = await insA({ unit_id: w.unit, course_id: C.id, user_id: sRe.id, scheduled_on: kstDay(-1), origin: 'recheck' });
  ids = await dueIds(w.unit);
  const why = psql(`select coalesce(public.quiz_send_block(a), 'NULL') from public.quiz_assignments a where a.id = '${rc}'`);
  if (!ids.includes(sCtl.a2)) skipped('③b', '대조군(안 푼 직원의 manual 대기 행)도 후보가 아니다');
  else check('③b(0871): 재확인 대기 행이 발송 후보다', ids.includes(rc), `재확인 행 ${ids.includes(rc) ? '후보' : '빠짐'} · 이유 ${why}`);

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

// ── ⑤~⑧ 구성원 알림·사장 알림 스윕이 보내는 시점에 다시 보는가(결함 전수 점검 S0 · 2026-11-12 · 레이스지도 M8·M9·M10) ──
// 스윕 함수는 전역으로 200행까지 선점한다. 다른 세션의 행을 건드리지 않게 트랜잭션 안에서 부르고 되돌린다(rollback).
// 행은 실제 생산자가 넣는 모양 그대로 심는다(swap_confirmed = put_schedule_notice · role_changed · question = space_question_send · ai_cap = 0193).
async function sweeps() {
  const w = await makeWorld(L, env, { tag: 'x5', staffN: 2, courses: [] });
  worlds.push(w);
  const [s1, s2] = w.staff;
  const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const inTx = (sql) => {
    const r = spawnSync('docker', ['exec', '-i', env.DB_CONTAINER, 'psql', '-U', 'postgres', '-tA', '-q', '-v', 'ON_ERROR_STOP=1'], { input: `begin;\n${sql}\nrollback;`, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`스윕 실행 실패: ${r.stderr}`);
    return r.stdout.trim();
  };
  const notice = (uid, kind, title, body = 'QA', url = '/junior/schedule') => Number(psql(`with x as (insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    values (${sq(uid)}, ${sq(w.unit)}, ${sq(kind)}, 'QA', ${sq(title)}, ${sq(body)}, ${sq(url)}) returning id) select id from x`));
  // 스윕은 한 틱에 200행이다. 공유 로컬 DB 에 다른 세션의 미발송 행이 밀려 있으면 이 매장 행이 창 밖으로 밀린다.
  //   → 같은 트랜잭션 안에서 다른 매장 행을 먼저 선점 처리한다(rollback 으로 되돌아간다).
  //   대조군 = 아직 매장에 있는 직원의 같은 종류 알림. 대조군이 안 나가면 skip(통과로 세지 않는다).
  const sweptMember = (ids) => inTx(`update public.member_notices set claimed_at = now() where claimed_at is null and unit_id <> ${sq(w.unit)};
select coalesce(string_agg(out_id::text, ','), '') from public.sweep_member_notices() where out_id in (${ids.join(',')});`).split(',').filter(Boolean).map(Number);

  console.log('— ⑤ 나간 직원에게 쌓여 있던 근무 알림 —');
  const n5 = notice(s1.id, 'swap_confirmed', '대타가 확정됐어요');
  const c5 = notice(s2.id, 'swap_confirmed', '대타가 확정됐어요');
  psql(`delete from public.unit_members where unit_id = ${sq(w.unit)} and user_id = ${sq(s1.id)}`);
  const got5 = sweptMember([n5, c5]);
  if (!got5.includes(c5)) skipped('⑤(M8)', '대조군(매장에 있는 직원)도 안 나갔다');
  else check('⑤(M8): 매장을 나간 직원의 대기 알림을 스윕이 보낸다', got5.includes(n5));

  console.log('— ⑥ 역할을 두 번 바꾼 뒤 쌓인 역할 알림 —');
  const n6a = notice(s2.id, 'role_changed', '매니저가 됐어요');
  // 제목은 set_member_role(0318:39) 이 넣는 두 문장 그대로다. s2 는 지금 직원(junior)이라 '해제' 가 지금 역할이다.
  const n6b = notice(s2.id, 'role_changed', '매니저에서 해제됐어요');
  const got6 = sweptMember([n6a, n6b]);
  if (!got6.includes(n6b)) skipped('⑥(M8)', '지금 역할 알림(대조군)도 안 나갔다');
  else check('⑥(M8): 지금 역할과 다른 옛 역할 알림까지 보낸다', got6.includes(n6a), `보낸 수 ${got6.length}/2`);

  console.log('— ⑦ 이미 답한 질문의 알림 —');
  const uq = `uq_x7_${w.s}`, uqc = `uq_x7c_${w.s}`;
  psql(`insert into public.unknown_queries(id, unit_id, query_text, status) values (${sq(uq)}, ${sq(w.unit)}, 'QA 질문', 'answered_direct'), (${sq(uqc)}, ${sq(w.unit)}, 'QA 대조 질문', 'pending_owner_answer')`);
  const n7 = notice(w.owner.id, 'question', 'QA님의 질문', 'QA 질문', `/space/answer/${uq}?space=${w.unit}`);
  const c7 = notice(w.owner.id, 'question', 'QA님의 질문', 'QA 대조 질문', `/space/answer/${uqc}?space=${w.unit}`);
  const got7 = sweptMember([n7, c7]);
  if (!got7.includes(c7)) skipped('⑦(M9)', '대기 중인 질문 알림(대조군)도 안 나갔다');
  else check('⑦(M9): 답이 끝난 질문의 알림을 스윕이 보낸다', got7.includes(n7));

  console.log('— ⑧ 요금제를 올린 뒤 쌓여 있던 AI 한도 알림 —');
  const month = psql(`select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')`);
  const a8 = Number(psql(`with x as (insert into public.owner_alerts (unit_id, kind, period, step, title, body) values (${sq(w.unit)}, 'ai_cap', ${sq(month)}, 1, 'AI 질문을 거의 다 썼어요', 'QA') returning id) select id from x`));
  await ok(admin.rpc('admin_activate_store', { p_unit_id: w.unit, p_days: 30, p_plan: 'multi' }), 'admin_activate_store');
  const used = Number(psql(`select coalesce((select used from public.ai_usage_monthly where unit_id = ${sq(w.unit)} and month = ${sq(month)}), 0)`));
  const cap = Number(psql(`select cap from public.unit_ai_cap(${sq(w.unit)})`));
  const got8 = Number(inTx(`select count(*) from public.sweep_owner_alerts() where out_id = ${a8};`));
  check('⑧(M10): 한도에 한참 못 미치는데(사용 ' + used + ' / 상한 ' + cap + ') 한도 알림을 보낸다', got8 === 1);

  // ── ⑨~⑫ S3(2026-11-12) · 종류별 재확인 표의 나머지 칸 ──
  console.log('— ⑨ 같은 역할 알림이 두 번 쌓임(매니저 → 직원 → 매니저 → 직원) —');
  const n9a = notice(s2.id, 'role_changed', '매니저에서 해제됐어요');
  const n9b = notice(s2.id, 'role_changed', '매니저에서 해제됐어요');
  const got9 = sweptMember([n9a, n9b]);
  if (!got9.includes(n9b)) skipped('⑨(M8)', '마지막 역할 알림(대조군)도 안 나갔다');
  else check('⑨(M8): 같은 역할 알림을 두 번 보낸다', got9.includes(n9a), `보낸 수 ${got9.length}/2`);

  console.log('— ⑩ 승인 알림이 나가기 전에 내보낸 직원 —');
  const n10 = notice(s1.id, 'approved', '합류가 승인됐어요', 'QA', '/stores');   // s1 은 ⑤ 에서 이미 나갔다
  const c10 = notice(s2.id, 'approved', '합류가 승인됐어요', 'QA', '/stores');
  const got10 = sweptMember([n10, c10]);
  if (!got10.includes(c10)) skipped('⑩(M8)', '대조군(매장에 있는 직원)도 안 나갔다');
  else check('⑩(M8): 이미 나간 사람에게 합류 승인 알림을 보낸다', got10.includes(n10));

  console.log('— ⑪ 재선점(엣지가 결과를 못 적은 행)도 다시 본다 —');
  const n11 = notice(s1.id, 'shift_changed', '근무가 바뀌었어요');
  const c11 = notice(s2.id, 'shift_changed', '근무가 바뀌었어요');
  psql(`update public.member_notices set claimed_at = now() - interval '20 minutes', delivered = null where id in (${n11}, ${c11})`);
  const got11 = sweptMember([n11, c11]);
  if (!got11.includes(c11)) skipped('⑪(M8)', '재선점 대조군도 안 나갔다');
  else check('⑪(M8): 나간 직원의 행을 재선점으로 한 번 더 보낸다', got11.includes(n11));

  console.log('— ⑫ 좌석 잠김 주기가 닫힌 뒤의 좌석 알림 —');
  const ep = Number(psql(`with x as (insert into public.seat_lock_episodes (unit_id, started_at, closed_at) values (${sq(w.unit)}, now() - interval '1 hour', now()) returning id) select id from x`));
  const a12 = Number(psql(`with x as (insert into public.owner_alerts (unit_id, kind, period, step, title, body) values (${sq(w.unit)}, 'seat_lock', ${sq(String(ep))}, 1, 'QA 직원 1명이 앱을 못 쓰고 있어요', 'QA') returning id) select id from x`));
  // 대조군 = 같은 매장의 재확인 대상이 아닌 종류(card_renew). 스윕이 이 매장 행까지 닿았는지만 본다.
  const c12 = Number(psql(`with x as (insert into public.owner_alerts (unit_id, kind, period, step, title, body) values (${sq(w.unit)}, 'card_renew', ${sq('qa:' + w.s)}, 3, 'QA 결제 예고', 'QA') returning id) select id from x`));
  const got12 = inTx(`select coalesce(string_agg(out_id::text, ','), '') from public.sweep_owner_alerts() where out_id in (${a12}, ${c12});`).split(',').filter(Boolean).map(Number);
  if (!got12.includes(c12)) skipped('⑫', '대조군(card_renew)도 안 나갔다');
  else check('⑫: 좌석이 풀려 주기가 닫혔는데 좌석 알림을 보낸다', got12.includes(a12));

  // ── ⑬~⑯ 버린 알림이 알림함에도 안 보이는가(11-16 사용자 결정 U-4) ──
  // 스윕을 같은 트랜잭션 안에서 돌린 뒤, 받는 사람 세션(authenticated · jwt sub)으로 알림함이 읽는 두 길을 본다.
  //   길 1 = 표 직접 읽기(RLS · fetchScheduleNotices · fetchJoinNotices · fetchOwnerAlerts) · 길 2 = my_units_notif_data(허브 벨 · 정의자).
  //   대조군 = 같은 사람의 버리지 않은 알림. 대조군이 안 보이면 skip.
  const seenAfterSweep = (uid, sweepSql, readSql) => inTx(`update public.member_notices set claimed_at = now() where claimed_at is null and unit_id <> ${sq(w.unit)};
update public.owner_alerts set claimed_at = now() where claimed_at is null and unit_id <> ${sq(w.unit)};
${sweepSql}
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', ${sq(uid)}, 'role', 'authenticated')::text, true);
${readSql}`).split('\n').pop().split(',').filter(Boolean).map(Number);
  const SWEEP_M = 'select count(*) from public.sweep_member_notices();';
  const SWEEP_A = 'select count(*) from public.sweep_owner_alerts();';
  const viaTable = (tbl, ids) => `select coalesce(string_agg(id::text, ','), '') from public.${tbl} where id in (${ids.join(',')});`;
  const viaHub = (kind, ids) => `select coalesce(string_agg((payload->>'id'), ','), '') from public.my_units_notif_data() where source = '${kind}' and (payload->>'id')::bigint in (${ids.join(',')});`;

  console.log('— ⑬ 버린 옛 역할 알림이 알림함(표 읽기)에 남는가 —');
  const n13a = notice(s2.id, 'role_changed', '매니저가 됐어요');           // s2 는 지금 직원 → 버린다
  const n13b = notice(s2.id, 'role_changed', '매니저에서 해제됐어요');     // 대조군(지금 역할)
  const seen13 = seenAfterSweep(s2.id, SWEEP_M, viaTable('member_notices', [n13a, n13b]));
  if (!seen13.includes(n13b)) skipped('⑬(U-4)', '대조군(지금 역할 알림)도 안 보인다');
  else check('⑬(U-4): 스윕이 버린 옛 역할 알림이 받는 사람 알림함(표 읽기)에 보인다', seen13.includes(n13a));

  console.log('— ⑭ 같은 알림이 허브 벨(my_units_notif_data)에 남는가 —');
  const n14a = notice(s2.id, 'role_changed', '매니저가 됐어요');
  const n14b = notice(s2.id, 'role_changed', '매니저에서 해제됐어요');
  const seen14 = seenAfterSweep(s2.id, SWEEP_M, viaHub('schednotice', [n14a, n14b]));
  if (!seen14.includes(n14b)) skipped('⑭(U-4)', '대조군(지금 역할 알림)도 허브에 없다');
  else check('⑭(U-4): 스윕이 버린 옛 역할 알림이 허브 벨에 보인다', seen14.includes(n14a));

  console.log('— ⑮ 나간 사람의 합류 승인 알림(매장과 무관하게 읽는 길) —');
  const n15 = notice(s1.id, 'approved', '합류가 승인됐어요', 'QA', '/stores');   // s1 은 ⑤ 에서 나갔다 → 버린다
  const c15 = notice(s1.id, 'rejected', '합류가 반려됐어요', 'QA', '/stores');   // 대조군(재확인 없는 종류)
  const seen15 = seenAfterSweep(s1.id, SWEEP_M, viaTable('member_notices', [n15, c15]));
  if (!seen15.includes(c15)) skipped('⑮(U-4)', '대조군(반려 알림)도 안 보인다');
  else check('⑮(U-4): 스윕이 버린 합류 승인 알림이 나간 사람 알림함에 보인다', seen15.includes(n15));

  console.log('— ⑯ 버린 AI 한도 알림이 사장 알림함에 남는가 —');
  // ⑧ 에서 요금제를 올렸다(한도 아래). a16 은 버리고 c16(card_renew · 재확인 없음)은 남는다.
  const a16 = Number(psql(`with x as (insert into public.owner_alerts (unit_id, kind, period, step, title, body) values (${sq(w.unit)}, 'ai_cap', ${sq(month)}, 2, 'AI 질문을 다 썼어요', 'QA') returning id) select id from x`));
  const c16 = Number(psql(`with x as (insert into public.owner_alerts (unit_id, kind, period, step, title, body) values (${sq(w.unit)}, 'card_renew', ${sq('qa16:' + w.s)}, 3, 'QA 결제 예고', 'QA') returning id) select id from x`));
  const seen16 = seenAfterSweep(w.owner.id, SWEEP_A, viaTable('owner_alerts', [a16, c16]));
  const hub16 = seenAfterSweep(w.owner.id, SWEEP_A, viaHub('alert', [a16, c16]));
  if (!seen16.includes(c16) || !hub16.includes(c16)) skipped('⑯(U-4)', `대조군(card_renew)이 안 보인다(표 ${seen16.includes(c16)} · 허브 ${hub16.includes(c16)})`);
  else check('⑯(U-4): 스윕이 버린 AI 한도 알림이 사장 알림함(표 · 허브)에 보인다', seen16.includes(a16) || hub16.includes(a16), `표 ${seen16.includes(a16)} · 허브 ${hub16.includes(a16)}`);
}

let crashed = null;
// 무료 모드(app_config.billing_free_mode)가 켜져 있으면 effective_plan 이 free 로 안 떨어져 ① 셋업이 안 선다.
// ① 동안만 끄고 되돌린다(qa-quiz-resend (m) · qa-store-slots 와 같은 방식 · 2026-11-12). 로컬 전용 하니스다.
const freeModeWas = psql(`select value from public.app_config where key = 'billing_free_mode'`);
try {
  if (freeModeWas === 'true') psql(`update public.app_config set value = 'false' where key = 'billing_free_mode'`);
  try { await seatLock(); } finally { if (freeModeWas === 'true') psql(`update public.app_config set value = 'true' where key = 'billing_free_mode'`); }
  await multiStore();
  await sweeps();
} catch (e) { crashed = e; console.error('  ✗ 예외:', e?.stack ?? e); }
const cl = await cleanupWorld(L, env, worlds).catch((e) => ({ units: 0, users: 0, left: -1, detail: [String(e.message)] }));
const notRun = crashed ? PLANNED - executed - ref : 0;
if (crashed) fail++;
console.log(`  · 정리: 매장 ${cl.units} · 계정 ${cl.users} · 남은 행 ${cl.left}${cl.detail.length ? ' (' + cl.detail.join(', ') + ')' : ''}`);
console.log(`\nPASS ${pass} · FAIL ${fail} · skip ${skip} · 참고 ${ref} · 실행 못 한 단언 ${notRun} · AI 호출 0회 · 정리 남은 행 ${cl.left}`);
// skip 은 통과가 아니다(AGENTS "게이트가 거짓말하는 3가지").
process.exit(fail === 0 && skip === 0 && !crashed ? 0 : 1);
