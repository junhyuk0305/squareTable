// qa-quiz-send-rules.mjs — 퀴즈 발송 규칙 정리(0931 · B8 · 2026-11-19 사용자 결정) · 로컬 도커 전용 · 자가정리 · 엣지 0회 · LLM 0회
//
// 무엇을 증명하나(정본 = 산출물/첫사용측정_2026-11-17/세션A_첫사용수정_멀티에이전트_2026-11-19.md "B8 재설계 결정"):
//   (1) 지운 제한 넷: 근무 밖 직원 · 오늘·이번 주 이미 받은 직원 · 두 번 안 연 직원의 오늘 행이 due_quiz_sends 후보다.
//   (2) 한 스윕에 같은 사람의 퀴즈 둘이 같이 나간다(v_taken 지움).
//   (3) 보낼 시각: send_at 이 미래면 후보가 아니고, 지났으면 후보다. send_at 없는 행은 예약일 09:00 KST(quiz_send_block 시각 인자로 잰다).
//   (4) 방해금지: 그 매장 방해금지 시간이면 후보가 아니고 이유 = quiet. 시간대를 지금 밖으로 옮기면 후보다.
//   (5) 이유와 발송이 같은 답: 후보인 사람은 quiz_send_status 에 이유가 없고, 아닌 사람(quiet · due_passed)은 그 이유가 있다.
//   (6) 재확인 행은 나가지 않는다(재확인 기능 없앰).
//   (7) 다시 알리기: 쿨다운 1분(2분 전 요청 뒤 다시 됨 · 30초 전이면 resend_cooldown) · 이번 주 2번 받은 직원도 sent(queued 없음).
//   (8) recipient_readiness: 근무표에 없는 직원도 on_schedule = true · weekly_quota_left = 2.
// 사용: node scripts/qa-quiz-send-rules.mjs --local
import { localEnv, makeLocal, makeWorld, cleanupWorld, kstDay, ok } from './lib/qa-fz-local.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin, psql } = L;
const MIG = psql('select max(version) from supabase_migrations.schema_migrations');
console.log(`— 대상 로컬 ${env.URL_} · schema_migrations 최고 ${MIG} —`);

let pass = 0, fail = 0;
const check = (n, good, extra = '') => {
  if (good) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); }
};
const pad = (n) => String(n).padStart(2, '0');
const kst = new Date(Date.now() + 9 * 3600e3);
const minsNow = kst.getUTCHours() * 60 + kst.getUTCMinutes();
const DOW = kst.getUTCDay();
const hhmm = (m) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 60) + 60) % 60))}`;
const ON = [hhmm(minsNow - 10), hhmm(minsNow + 10)];
const OFF = [hhmm(minsNow + 60), hhmm(minsNow + 90)];
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const later = (m) => new Date(Date.now() + m * 60e3).toISOString();

const worlds = [];
try {
  const w = await makeWorld(L, env, { tag: 'sr', staffN: 6, courses: [{ items: 2 }, { items: 1 }, { items: 1 }] });
  worlds.push(w);
  const [a, b, c, d, e, f] = w.staff;   // a 근무 밖 · b 오늘·주 2번 받음 · c 두 번 안 염 · d 방해금지 · e 마감 지남(근무표 없음) · f 퀴즈 둘
  const [C0, C1, C2] = w.courses.map((x) => x.id);
  const today = kstDay(0);
  check('셋업: 매장 + 직원 6 + 퀴즈 3', !!w.unit && w.staff.length === 6, `unit=${w.unit}`);

  // 근무표를 쓰는 매장. a = 지금이 아닌 근무 · e = 근무 없음 · 나머지 = 지금 근무.
  const shifts = [a, b, c, d, f].map((p) => ({ id: `sh_sr_${p.key}_${w.s}`, unit_id: w.unit, staff_id: p.id, weekday: DOW,
    start_time: (p === a ? OFF : ON)[0], end_time: (p === a ? OFF : ON)[1] }));
  await ok(admin.from('shift_templates').insert(shifts), 'shift_templates');

  // 지난 발송(퀴즈 1). b = 오늘 1건 + 이틀 전 1건(열어 둠) · c = 이틀·사흘 전 안 연 2건.
  await ok(admin.from('quiz_assignments').insert([
    { id: `qz_sr_b0_${w.s}`, user_id: b.id, scheduled_on: kstDay(0), sent_at: ago(1), opened_at: ago(1) },
    { id: `qz_sr_b1_${w.s}`, user_id: b.id, scheduled_on: kstDay(-2), sent_at: ago(48), opened_at: ago(48) },
    { id: `qz_sr_c0_${w.s}`, user_id: c.id, scheduled_on: kstDay(-2), sent_at: ago(48) },
    { id: `qz_sr_c1_${w.s}`, user_id: c.id, scheduled_on: kstDay(-3), sent_at: ago(72) },
  ].map((r) => ({ unit_id: w.unit, course_id: C1, origin: 'manual', ...r }))), '지난 발송');

  // 사장이 오늘치 퀴즈 0 행을 넣는다(앱과 같은 길 · 사장 세션). e 는 어제 마감.
  const rid = (k, n = 0) => `qz_sr_${k}${n}_${w.s}_t`;
  await ok(w.owner.c.from('quiz_assignments').insert([a, b, c, d, e, f].map((p) => ({
    id: rid(p.key), unit_id: w.unit, course_id: C0, user_id: p.id, scheduled_on: today, origin: 'manual',
    due_date: p === e ? kstDay(-1) : null,
  }))), '퀴즈 0 행');
  // f 는 퀴즈 2 도 오늘 받는다(한 스윕에 둘).
  await ok(w.owner.c.from('quiz_assignments').insert({ id: rid(f.key, 2), unit_id: w.unit, course_id: C2, user_id: f.id, scheduled_on: today, origin: 'manual' }), '퀴즈 2 행');
  // 재확인 대기 행(어제치 · 지금 근무 중인 f · 퀴즈 1).
  await ok(admin.from('quiz_assignments').insert({ id: rid('rc'), unit_id: w.unit, course_id: C1, user_id: f.id, scheduled_on: kstDay(-1), origin: 'recheck' }), '재확인 행');
  // d = 이 매장 방해금지(지금을 감싸는 1시간).
  await ok(admin.from('unit_member_prefs').upsert({ user_id: d.id, unit_id: w.unit, quiet_enabled: true,
    quiet_start: hhmm(minsNow - 30), quiet_end: hhmm(minsNow + 30) }, { onConflict: 'user_id,unit_id' }), '방해금지');

  // 보낼 시각 열(send_at · 0931 이 더한다). 없으면 이 셋은 실패로 센다.
  const sa1 = await admin.from('quiz_assignments').insert({ id: rid('sa', 1), unit_id: w.unit, course_id: C1, user_id: a.id, scheduled_on: today, origin: 'manual', send_at: later(60) });
  const sa2 = await admin.from('quiz_assignments').insert({ id: rid('sa', 2), unit_id: w.unit, course_id: C2, user_id: a.id, scheduled_on: today, origin: 'manual', send_at: later(-1) });
  check('(3) send_at 열이 있다', !sa1.error && !sa2.error, sa1.error?.message ?? sa2.error?.message ?? '');

  const due = async () => (await ok(admin.rpc('due_quiz_sends'), 'due_quiz_sends')).filter((r) => r.out_unit_id === w.unit).map((r) => r.out_assignment_id);
  const ids = new Set(await due());
  check('(1) 근무 밖 직원 a 가 후보', ids.has(rid(a.key)));
  check('(1) 오늘·이번 주 2번 받은 b 가 후보', ids.has(rid(b.key)));
  check('(1) 두 번 안 연 c 가 후보', ids.has(rid(c.key)));
  check('(2) f 의 퀴즈 둘이 한 스윕에 같이 후보', ids.has(rid(f.key)) && ids.has(rid(f.key, 2)));
  check('(3) send_at 1시간 뒤 행은 후보 아님', !sa1.error && !ids.has(rid('sa', 1)));
  check('(3) send_at 1분 전 행은 후보', !sa2.error && ids.has(rid('sa', 2)));
  check('(4) 방해금지 중인 d 는 후보 아님', !ids.has(rid(d.key)));
  check('(5) 마감 지난 e 는 후보 아님', !ids.has(rid(e.key)));
  check('(6) 재확인 행은 후보 아님', !ids.has(rid('rc')));

  // (3) send_at 없는 행 = 예약일 09:00 KST. 시각 인자로 08:59 · 09:00 을 잰다.
  let at859 = null, at900 = null, blockErr = '';
  try {
    const q = (t) => psql(`select coalesce(public.quiz_send_block(a, ((a.scheduled_on + time '${t}') at time zone 'Asia/Seoul')), 'NULL') from public.quiz_assignments a where a.id = '${rid(b.key)}'`);
    at859 = q('08:59'); at900 = q('09:00');
  } catch (err) { blockErr = String(err.stderr ?? err.message).split('\n')[0]; }
  check('(3) 시간 없는 예약 행은 08:59 에 not_yet', at859 === 'not_yet', at859 ?? blockErr);
  check('(3) 시간 없는 예약 행은 09:00 에 나감', at900 === 'NULL', at900 ?? blockErr);

  // (5) 이유 = 발송. 사장 세션으로 읽는다.
  const st = Object.fromEntries((await ok(w.owner.c.rpc('quiz_send_status', { p_course_id: C0 }), 'quiz_send_status')).map((r) => [r.user_id, r.reason]));
  check('(5) d 의 이유 = quiet', st[d.id] === 'quiet', JSON.stringify(st[d.id] ?? null));
  check('(5) e 의 이유 = due_passed', st[e.id] === 'due_passed', JSON.stringify(st[e.id] ?? null));
  const agree = [a, b, c, f].every((p) => ids.has(rid(p.key)) && !st[p.id]);
  check('(5) 후보인 a·b·c·f 는 이유가 없다', agree, JSON.stringify([a, b, c, f].map((p) => st[p.id] ?? null)));

  // (4) 방해금지를 지금 밖으로 옮기면 후보.
  await ok(admin.from('unit_member_prefs').update({ quiet_start: hhmm(minsNow + 120), quiet_end: hhmm(minsNow + 180) }).eq('user_id', d.id).eq('unit_id', w.unit), '방해금지 옮김');
  check('(4) 방해금지가 끝나면 d 가 후보', (await due()).includes(rid(d.key)));

  // (7) 다시 알리기. b = 이번 주 2번 받음 · 2분 전 다시 알리기 → 1분 쿨다운이 지나 sent.
  await ok(admin.from('quiz_assignments').insert({ id: rid('rs', 1), unit_id: w.unit, course_id: C2, user_id: b.id, scheduled_on: kstDay(1), origin: 'manual', resend_at: new Date(Date.now() - 120e3).toISOString() }), '다시 알리기 시드 b');
  const r1 = await w.owner.c.rpc('quiz_resend', { p_course_id: C2, p_user_ids: [b.id] });
  check('(7) 2분 전 다시 알리기 뒤 다시 됨 · 주 2번 받아도 sent', !r1.error && r1.data?.[0]?.result === 'sent', r1.error?.message ?? JSON.stringify(r1.data));
  await ok(admin.from('quiz_assignments').insert({ id: rid('rs', 2), unit_id: w.unit, course_id: C2, user_id: e.id, scheduled_on: kstDay(1), origin: 'manual', resend_at: new Date(Date.now() - 30e3).toISOString() }), '다시 알리기 시드 e');
  const r2 = await w.owner.c.rpc('quiz_resend', { p_course_id: C2, p_user_ids: [e.id] });
  check('(7) 30초 전이면 resend_cooldown', r2.error?.message === 'resend_cooldown', r2.error?.message ?? JSON.stringify(r2.data));

  // (8) 준비 상태. e 는 근무표에 없다.
  const rr = await w.owner.c.rpc('recipient_readiness', { p_unit_id: w.unit, p_user_ids: [e.id, b.id] });
  const re = (rr.data ?? []).find((r) => r.user_id === e.id), rb = (rr.data ?? []).find((r) => r.user_id === b.id);
  check('(8) 근무표에 없는 e 도 on_schedule = true', !rr.error && re?.on_schedule === true, rr.error?.message ?? JSON.stringify(re));
  check('(8) 이번 주 2번 받은 b 도 weekly_quota_left = 2', !rr.error && rb?.weekly_quota_left === 2, JSON.stringify(rb?.weekly_quota_left));

  // (9) 지금 바로 = 앱이 send_now 로 넣는 행(send_at 없음 · 기기 시계를 싣지 않는다). 시각과 상관없이 바로 후보다.
  //     예약일 09:00 규칙에 걸리면 안 된다 → quiz_send_block 을 오늘 08:00 KST 로 잰다(만든 시각 = 서버 시계).
  await ok(w.owner.c.from('quiz_assignments').insert({ id: rid('nw'), unit_id: w.unit, course_id: C1, user_id: e.id, scheduled_on: today, origin: 'manual', send_now: true }), '지금 바로 행');
  check('(9) 앱이 send_now 로 넣은 행은 후보', (await due()).includes(rid('nw')));
  const nw8 = psql(`select coalesce(public.quiz_send_block(a, a.created_at), 'NULL') from public.quiz_assignments a where a.id = '${rid('nw')}'`);
  check('(9) 지금 바로 행은 만든 순간부터 나간다(09:00 전이어도)', nw8 === 'NULL', nw8);

  // (10) 방해금지 경계(엣지 inQuietWindow 와 같은 셈 · [시작, 끝) · 자정 넘김 · 시작=끝 = 빈 구간).
  const quietAt = (start, end, hm) => {
    psql(`update public.unit_member_prefs set quiet_start = '${start}', quiet_end = '${end}' where unit_id = '${w.unit}' and user_id = '${d.id}'`);
    return psql(`select public.member_quiet_now('${w.unit}', '${d.id}', timestamptz '${today} ${hm}+09')`);
  };
  check('(10) 22:00~08:00 · 23:00 = 방해금지', quietAt('22:00', '08:00', '23:00') === 't');
  check('(10) 22:00~08:00 · 07:59 = 방해금지', quietAt('22:00', '08:00', '07:59') === 't');
  check('(10) 22:00~08:00 · 08:00 = 끝남', quietAt('22:00', '08:00', '08:00') === 'f');
  check('(10) 22:00~08:00 · 21:59 = 아님', quietAt('22:00', '08:00', '21:59') === 'f');
  check('(10) 13:00~14:00 · 13:00 = 방해금지', quietAt('13:00', '14:00', '13:00') === 't');
  check('(10) 시작=끝 = 빈 구간', quietAt('10:00', '10:00', '10:00') === 'f');
  check('(10) 설정 없는 직원 = 아님', psql(`select public.member_quiet_now('${w.unit}', '${e.id}', now())`) === 'f');
} catch (err) {
  fail++; console.log('  ✗ 중단:', err.message);
} finally {
  await admin.from('unit_member_prefs').delete().in('unit_id', worlds.map((x) => x.unit).filter(Boolean));
  await admin.from('shift_templates').delete().in('unit_id', worlds.map((x) => x.unit).filter(Boolean));
  const cl = await cleanupWorld(L, env, worlds).catch((err) => ({ left: -1, detail: [err.message] }));
  check('정리: 남은 행 0', cl.left === 0, cl.detail?.join(' ') ?? '');
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} 통과 · ${fail} 실패 · LLM 0회`);
process.exit(fail === 0 ? 0 : 1);
