// qa-quiet-digest.mjs — 방해금지 보관·요약(0960 · 2026-11-19 사용자 결정) · 로컬 도커 전용 · 자가정리 · 엣지 0회 · LLM 0회
//
// 무엇을 증명하나(정본 = 산출물/첫사용측정_2026-11-17/알림덩이_구현계획_2026-11-19.md 2·3·4절):
//   D1 방해금지 중인 사람을 두 번 보관하면 열린 행 하나에 held = 2 · last_tag = 마지막 태그.
//   D2 방해금지가 아닌 사람은 보관하지 않는다(돌려받는 사람 없음 · 행 없음 → 엣지가 바로 보낸다).
//   D3 방해금지가 끝나기 전 선점 0 · 끝난 뒤 1행 "방해금지 동안 알림 2개가 왔어요" · url = /junior/notifications.
//   D4 같은 시각에 다시 선점하면 0(이미 선점).
//   D5 선점 뒤 다시 보관하면(다음 밤) 새 행이 생긴다.
//   D6 나간 직원의 행 · 하루 넘게 못 보낸 열린 행은 버린다(dropped_at · delivered 0 · 돌려주지 않음).
//   D7 결과를 못 적은 행은 10분 뒤 한 번 더 준다(delivered 0) · 결과를 적은 행 · 다시 준 행은 다시 안 나온다.
//   D8 한 번에 push_sweep_cap() = 100개 · 105명이면 100 + 5.
//   D9 앱(authenticated)은 표·함수를 못 쓴다(42501).
//   D10 방해금지 중인 직원의 퀴즈 행은 quiz_send_block = null(카드는 제시각에 뜨고 푸시만 모은다) · 크론 주기 '* * * * *'.
// 시각: push_quiet_hold 는 서버 now() 로 판정한다. 그래서 방해금지 창을 지금 앞뒤 30분으로 두고, claim_push_digests 에는
//   p_now 를 넣어 "끝난 뒤"(지금 + 2시간)를 만든다.
// 0960~0962 가 없으면(적용 전) 각 케이스가 실패로 센다(없어서 건너뛰지 않는다).
// 사용: node scripts/qa-quiet-digest.mjs --local
import { localEnv, makeLocal, makeWorld, cleanupWorld, ok } from './lib/qa-fz-local.mjs';
import { seedVerifiedPhones } from './qa-otp-seed.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin, psql } = L;
console.log(`— 대상 로컬 ${env.URL_} · db ${env.DB_CONTAINER} —`);

let pass = 0, fail = 0;
const skip = 0; // 건너뛰는 검사는 없다. 최종 줄 규약만 맞춘다.
const check = (n, good, extra = '') => {
  if (good) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); }
};
const pad = (n) => String(n).padStart(2, '0');
const kst = new Date(Date.now() + 9 * 3600e3);
const minsNow = kst.getUTCHours() * 60 + kst.getUTCMinutes();
const hhmm = (m) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 60) + 60) % 60))}`;
const T0 = Date.now();
const at = (min) => new Date(T0 + min * 60e3).toISOString();
const IN = at(0);          // 방해금지 중(지금)
const AFTER = at(120);     // 방해금지 끝난 뒤(창 = 지금 ±30분)

const call = async (fn, args) => {
  const r = await admin.rpc(fn, args);
  if (r.error) throw new Error(`${fn}: ${r.error.code ?? ''} ${r.error.message}`);
  return r.data ?? [];
};
const claim = (p_now) => call('claim_push_digests', { p_now });
const rowsOf = (unit, uid) => {
  const out = psql(`select coalesce(json_agg(d order by d.id), '[]') from public.push_quiet_digests d where d.unit_id = '${unit}' and d.user_id = '${uid}'`);
  return JSON.parse(out);
};
const kase = async (id, name, run) => {
  console.log(`\n[${id}] ${name}`);
  try { await run(); } catch (e) { check(`${id} 실행`, false, String(e.stderr ?? e.message).split('\n')[0].slice(0, 200)); }
};

const worlds = [];
const bulk = { unit: null, users: [], phones: [] };
try {
  const w = await makeWorld(L, env, { tag: 'qd', staffN: 6, plan: 'multi', courses: [{ items: 1 }] });
  worlds.push(w);
  const [a, b, c, d, e] = w.staff;   // a 보관·요약 · b 방해금지 아님 · c 나감 · d 퀴즈 · e 하루 지난 행
  check('셋업: 매장(유료) + 직원 6 + 퀴즈 1', !!w.unit && w.staff.length === 6, `unit=${w.unit}`);
  const quiet = { quiet_enabled: true, quiet_start: hhmm(minsNow - 30), quiet_end: hhmm(minsNow + 30) };
  await ok(admin.from('unit_member_prefs').upsert([a, c, d].map((p) => ({ user_id: p.id, unit_id: w.unit, ...quiet })), { onConflict: 'user_id,unit_id' }), '방해금지');
  const tbl = psql(`select coalesce(to_regclass('public.push_quiet_digests')::text, 'NULL')`);
  check('표 push_quiet_digests 가 있다', tbl !== 'NULL', tbl);

  let row1 = null;
  await kase('D1', '방해금지 중 두 번 보관 → 열린 행 하나 · held 2', async () => {
    const h1 = await call('push_quiet_hold', { p_unit: w.unit, p_user_ids: [a.id], p_tag: 'question' });
    const h2 = await call('push_quiet_hold', { p_unit: w.unit, p_user_ids: [a.id], p_tag: 'mention' });
    check('D1 두 번 다 a 를 돌려준다', h1.length === 1 && h1[0].user_id === a.id && h2.length === 1 && h2[0].user_id === a.id, JSON.stringify([h1, h2]));
    const rs = rowsOf(w.unit, a.id);
    row1 = rs[0];
    check('D1 열린 행 1개 · held 2 · last_tag = mention', rs.length === 1 && rs[0].claimed_at === null && rs[0].held === 2 && rs[0].last_tag === 'mention', JSON.stringify(rs));
  });

  await kase('D2', '방해금지 아닌 사람은 보관 안 함', async () => {
    const h = await call('push_quiet_hold', { p_unit: w.unit, p_user_ids: [b.id], p_tag: 'question' });
    check('D2 돌려받는 사람 없음', h.length === 0, JSON.stringify(h));
    check('D2 행 없음', rowsOf(w.unit, b.id).length === 0);
  });

  await kase('D3', '끝나기 전 선점 0 · 끝난 뒤 1행 "알림 2개"', async () => {
    const before = (await claim(IN)).filter((r) => r.out_user_id === a.id);
    check('D3 방해금지 중(p_now = 지금) 선점 0', before.length === 0, JSON.stringify(before));
    const got = (await claim(AFTER)).filter((r) => r.out_user_id === a.id);
    const g = got[0];
    check('D3 끝난 뒤 1행', got.length === 1 && g.out_id === row1?.id && g.out_unit_id === w.unit, JSON.stringify(got));
    check('D3 제목 = 방해금지 동안 알림 2개가 왔어요', g?.out_title === '방해금지 동안 알림 2개가 왔어요', g?.out_title);
    check('D3 본문 = 알림함에서 볼 수 있어요.', g?.out_body === '알림함에서 볼 수 있어요.', g?.out_body);
    check('D3 이동 = /junior/notifications(매장)', g?.out_url === '/junior/notifications', g?.out_url);
    const r = rowsOf(w.unit, a.id)[0];
    check('D3 선점 시각 = p_now · 결과 null(엣지가 적는다)', !!r?.claimed_at && new Date(r.claimed_at).getTime() === new Date(AFTER).getTime() && r.delivered === null, JSON.stringify(r));
  });

  await kase('D4', '같은 시각에 다시 선점 → 0', async () => {
    const got = (await claim(AFTER)).filter((r) => r.out_user_id === a.id);
    check('D4 다시 부르면 0', got.length === 0, JSON.stringify(got));
  });

  let row2 = null;
  await kase('D5', '선점 뒤 다시 보관(다음 밤) → 새 행', async () => {
    const h = await call('push_quiet_hold', { p_unit: w.unit, p_user_ids: [a.id], p_tag: 'question' });
    const rs = rowsOf(w.unit, a.id);
    row2 = rs.find((x) => x.claimed_at === null);
    check('D5 a 를 돌려준다', h.length === 1 && h[0].user_id === a.id, JSON.stringify(h));
    check('D5 행 2개 · 새 열린 행 held 1', rs.length === 2 && !!row2 && row2.id !== row1?.id && row2.held === 1, JSON.stringify(rs));
  });

  await kase('D7', '결과 못 적은 행은 10분 뒤 한 번 더 · 그 뒤 안 나옴', async () => {
    const got = (await claim(at(135))).filter((r) => r.out_user_id === a.id).map((r) => r.out_id);
    const rs = Object.fromEntries(rowsOf(w.unit, a.id).map((x) => [x.id, x]));
    check('D7 15분 뒤: 결과 없는 첫 행을 다시 준다 · delivered 0', got.includes(row1?.id) && rs[row1?.id]?.delivered === 0, JSON.stringify({ got, r: rs[row1?.id] }));
    check('D7 새 열린 행도 같이 첫 선점 · delivered null', got.includes(row2?.id) && rs[row2?.id]?.delivered === null, JSON.stringify(rs[row2?.id]));
    await call('mark_push_digest_result', { p_id: row2?.id ?? -1, p_delivered: 1 });
    const r2 = rowsOf(w.unit, a.id).find((x) => x.id === row2?.id);
    check('D7 mark_push_digest_result 가 결과를 적는다(1)', r2?.delivered === 1, JSON.stringify(r2));
    const again = (await claim(at(160))).filter((r) => r.out_user_id === a.id);
    check('D7 40분 뒤: 다시 준 행 · 결과 적은 행은 안 나온다', again.length === 0, JSON.stringify(again));
  });

  await kase('D6', '나간 직원 · 하루 지난 열린 행은 버린다', async () => {
    const h = await call('push_quiet_hold', { p_unit: w.unit, p_user_ids: [c.id], p_tag: 'question' });
    check('D6 셋업: c 보관', h.length === 1, JSON.stringify(h));
    psql(`delete from public.unit_members where unit_id = '${w.unit}' and user_id = '${c.id}'`);
    psql(`insert into public.push_quiet_digests(user_id, unit_id, held, first_at, last_at) values ('${e.id}', '${w.unit}', 3, now() - interval '25 hours', now() - interval '25 hours')`);
    const got = (await claim(at(180))).filter((r) => r.out_unit_id === w.unit && [c.id, e.id].includes(r.out_user_id));
    check('D6 둘 다 돌려주지 않는다', got.length === 0, JSON.stringify(got));
    for (const [who, p] of [['나간 c', c], ['하루 지난 e', e]]) {
      const r = rowsOf(w.unit, p.id)[0];
      check(`D6 ${who}: dropped_at · delivered 0 · claimed_at 찍힘`, !!r?.dropped_at && r.delivered === 0 && !!r.claimed_at, JSON.stringify(r));
    }
  });

  await kase('D8', '한 번에 100개 · 105명이면 100 + 5', async () => {
    const cap = Number(psql('select public.push_sweep_cap()'));
    check('D8 push_sweep_cap() = 100', cap === 100, String(cap));
    const P = at(300);
    // 로컬 DB 에 남은 열린 행을 먼저 비운다(전역 선점이다).
    for (let i = 0; i < 30; i++) if ((await claim(P)).length < cap) break;
    // 직원 105명(계정 + 멤버십). 행은 psql 로 바로 넣는다(보관 판정은 D1 이 본다).
    const base = String(Date.now()).slice(-4);
    bulk.phones = Array.from({ length: 105 }, (_, i) => `0101${base}${String(i).padStart(3, '0')}`);
    await seedVerifiedPhones(env.URL_, env.SRV, bulk.phones);
    for (let i = 0; i < 105; i += 15) {
      const made = await Promise.all(bulk.phones.slice(i, i + 15).map(async (phone, k) => {
        const r = await admin.auth.admin.createUser({ email: `qa_qd_bulk_${w.s}_${i + k}@example.com`, password: 'Test1234!qa', email_confirm: true,
          user_metadata: { name: `QA_QD_${i + k}`, role: 'junior', phone, birth_date: '1994-03-03' } });
        if (r.error) throw new Error(`createUser bulk ${i + k}: ${r.error.message}`);
        return r.data.user.id;
      }));
      bulk.users.push(...made);
    }
    const lit = `'{${bulk.users.join(',')}}'::uuid[]`;
    psql(`insert into public.unit_members(user_id, unit_id, role) select u, '${w.unit}', 'junior' from unnest(${lit}) u`);
    psql(`insert into public.push_quiet_digests(user_id, unit_id) select u, '${w.unit}' from unnest(${lit}) u`);
    const mine = new Set(bulk.users);
    const s1 = await claim(P);
    const s2 = await claim(P);
    const m1 = s1.filter((r) => mine.has(r.out_user_id)).length, m2 = s2.filter((r) => mine.has(r.out_user_id)).length;
    check('D8 첫 선점 = 100행(전부 이 매장 105명 중)', s1.length === 100 && m1 === 100, `all=${s1.length} mine=${m1}`);
    check('D8 두 번째 선점 = 남은 5', m2 === 5, `all=${s2.length} mine=${m2}`);
  });

  await kase('D9', '앱(authenticated)은 표·함수를 못 쓴다', async () => {
    const denied = (r) => r.error?.code === '42501';
    const r1 = await a.c.rpc('push_quiet_hold', { p_unit: w.unit, p_user_ids: [a.id], p_tag: 'x' });
    check('D9 push_quiet_hold → 42501', denied(r1), `${r1.error?.code ?? '-'} ${r1.error?.message ?? JSON.stringify(r1.data)}`);
    const r2 = await a.c.rpc('claim_push_digests', {});
    check('D9 claim_push_digests → 42501', denied(r2), `${r2.error?.code ?? '-'} ${r2.error?.message ?? JSON.stringify(r2.data)}`);
    const r3 = await a.c.rpc('mark_push_digest_result', { p_id: row1?.id ?? 1, p_delivered: 9 });
    check('D9 mark_push_digest_result → 42501', denied(r3), `${r3.error?.code ?? '-'} ${r3.error?.message ?? ''}`);
    const r4 = await a.c.from('push_quiet_digests').select('id');
    check('D9 표 읽기 → 42501 또는 0행(표가 있을 때)', tbl !== 'NULL' && (denied(r4) || (!r4.error && (r4.data ?? []).length === 0)), `${r4.error?.code ?? '-'} rows=${(r4.data ?? []).length}`);
    const r5 = await a.c.from('push_quiet_digests').insert({ user_id: a.id, unit_id: w.unit });
    check('D9 표 쓰기 거부', tbl !== 'NULL' && !!r5.error, `${r5.error?.code ?? '들어감'}`);
  });

  await kase('D10', '방해금지 중 퀴즈 행은 막히지 않는다 · 크론 1분', async () => {
    const qid = `qz_qd_d_${w.s}`;
    await ok(w.owner.c.from('quiz_assignments').insert({ id: qid, unit_id: w.unit, course_id: w.courses[0].id, user_id: d.id,
      scheduled_on: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), origin: 'manual', send_now: true }), '퀴즈 행');
    check('D10 셋업: d 는 지금 방해금지', psql(`select public.member_quiet_now('${w.unit}', '${d.id}')`) === 't');
    const blk = psql(`select coalesce(public.quiz_send_block(a), 'NULL') from public.quiz_assignments a where a.id = '${qid}'`);
    check("D10 quiz_send_block = null('quiet' 아님)", blk === 'NULL', blk);
    const due = (await call('due_quiz_sends', {})).some((r) => r.out_assignment_id === qid);
    check('D10 due_quiz_sends 후보', due);
    const src = psql(`select prosrc from pg_proc where proname = 'schedule_task_reminder_cron' and pronamespace = 'public'::regnamespace`);
    check("D10b schedule_task_reminder_cron 주기 = '* * * * *'", src.includes("'* * * * *'") && !src.includes("'*/5 * * * *'"),
      (src.match(/cron\.schedule\([^;]*/) ?? [''])[0].slice(0, 80));
    const hasCron = psql(`select count(*) from pg_extension where extname = 'pg_cron'`) === '1';
    if (hasCron) {
      const sch = psql(`select coalesce((select schedule from cron.job where jobname = 'task-reminders'), 'NULL')`);
      check("D10b cron.job task-reminders = '* * * * *'(잡이 있으면)", sch === 'NULL' || sch === '* * * * *', sch);
    } else console.log('  · pg_cron 없음(로컬) — 잡 주기는 함수 본문으로만 본다');
  });
} catch (err) {
  fail++; console.log('  ✗ 중단:', err.message);
} finally {
  const units = worlds.map((x) => x.unit).filter(Boolean);
  if (units.length) await admin.from('unit_member_prefs').delete().in('unit_id', units);
  const cl = await cleanupWorld(L, env, [...worlds, bulk]).catch((err) => ({ left: -1, detail: [err.message] }));
  check('정리: 남은 행 0', cl.left === 0, cl.detail?.join(' ') ?? '');
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · skip ${skip} · 엣지 0회 · LLM 0회`);
process.exit(fail === 0 ? 0 : 1);
