// qa-push-kick.mjs — 알림 행이 생기면 스윕을 바로 깨운다(0961 push_kick_sweep · tg_push_kick · 2026-11-19) · 로컬 도커 + 로컬 엣지 전용 · 혼자 돈다
//
// 무엇을 증명하나(정본 = 산출물/첫사용측정_2026-11-17/알림덩이_구현계획_2026-11-19.md 4절):
//   K0 로컬 Vault(task_reminder_url·key)를 로컬 엣지로 맞춘다 · 엣지가 떠 있다.
//   K1 approve_member → member_notices 행 → 10초 안에 선점(claimed_at).
//   K2 퀴즈 받는 사람 추가(사장이 quiz_assignments 를 넣음 · 보낼 시각 지남) → 10초 안에 sent_at.
//   K3 owner_alerts 행 → 10초 안에 선점.
//   K4 sweep_owner_alerts 가 도는 트랜잭션 안에서 생긴 사장 알림은 'alerts' 깨우기를 쌓지 않는다(대조: 스윕 없이 넣으면 1개).
//   K5 한 트랜잭션에 member_notices 3행(문장 3개) → 'notices' 요청 1개.
//   K6 0행 넣기 · 지금 못 나가는 퀴즈 행(보낼 시각 전) → 요청 없음.
//   K7 Vault 를 처음 상태로 되돌린다(finally).
// K4~K6 은 net.http_request_queue 를 한 트랜잭션 안에서 세고 rollback 한다(요청이 실제로 나가지 않는다).
// ★Vault 와 엣지 컨테이너는 모든 세션이 같이 쓴다. 다른 하니스와 동시에 돌리지 않는다.
// 엣지: npx -y supabase@2.122.1 functions serve --env-file <VAPID 3 + 가짜 SOLAPI 3 + HTTPS_PROXY + NO_PROXY>(AGENTS 엣지 하니스 절)
// 사용: node scripts/qa-push-kick.mjs --local
import { localEnv, makeLocal, makeWorld, cleanupWorld, ok } from './lib/qa-fz-local.mjs';
import { makeRace, q } from './lib/qa-race.mjs';
import { seedPending } from './lib/qa-staff.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin } = L;
const R = makeRace(env.DB_CONTAINER);
// db 컨테이너 안에서 본 엣지 주소(같은 도커 네트워크의 kong 별칭).
const PUSH_IN_DOCKER = 'http://kong:8000/functions/v1/push';
console.log(`— 대상 로컬 ${env.URL_} · db ${env.DB_CONTAINER} · Vault → ${PUSH_IN_DOCKER} —`);

let pass = 0, fail = 0;
const skip = 0; // 건너뛰는 검사는 없다. 엣지가 안 떠 있으면 K1~K3 은 실패로 센다.
const check = (n, good, extra = '') => {
  if (good) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); }
};
const kase = async (id, name, run) => {
  console.log(`\n[${id}] ${name}`);
  try { await run(); } catch (e) { check(`${id} 실행`, false, String(e.message).split('\n')[0].slice(0, 200)); }
};
const waitFor = async (probe, ms = 10_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ok: false, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 500));
  }
};
const NAMES = ['task_reminder_url', 'task_reminder_key'];
const vaultGet = (name) => R.val(`select coalesce((select decrypted_secret from vault.decrypted_secrets where name = ${q(name)}), '<none>')`);
const vaultSet = (vals) => R.val(`delete from vault.secrets where name in (${NAMES.map(q).join(', ')});
${NAMES.filter((k) => vals[k] !== '<none>').map((k) => `select vault.create_secret(${q(vals[k])}, ${q(k)});`).join('\n')}
select 1;`);
/** 한 트랜잭션 안에서 stmts 를 돌리고 그 사이 쌓인 엣지 요청의 갈래(only[0] · 없으면 all)를 돌려준다. 끝에 rollback. */
const kicksIn = (stmts) => R.val(`begin;
create temp table _qk_mark on commit drop as select coalesce(max(id), 0) as m from net.http_request_queue;
${stmts}
select 'K|' || coalesce(string_agg(coalesce(convert_from(body, 'utf8')::jsonb -> 'only' ->> 0, 'all'), ',' order by id), '')
  from net.http_request_queue where id > (select m from _qk_mark) and url = ${q(PUSH_IN_DOCKER)};
rollback;`).split(/\r?\n/).find((l) => l.startsWith('K|'))?.slice(2) ?? '?';
const count = (list, branch) => list.split(',').filter((x) => x === branch).length;

const worlds = [];
let orig = null;
try {
  orig = Object.fromEntries(NAMES.map((k) => [k, vaultGet(k)]));
  console.log(`  · 처음 Vault: ${NAMES.map((k) => `${k}=${orig[k] === '<none>' ? '없음' : '있음'}`).join(' · ')}`);

  await kase('K0', 'Vault 를 로컬 엣지로 · 엣지가 떠 있다', async () => {
    vaultSet({ task_reminder_url: PUSH_IN_DOCKER, task_reminder_key: env.SRV });
    check('K0 Vault = 로컬 엣지 주소 · 로컬 service_role 키', vaultGet('task_reminder_url') === PUSH_IN_DOCKER && vaultGet('task_reminder_key') === env.SRV);
    const r = await fetch(`${env.URL_}/functions/v1/push`, { method: 'OPTIONS' }).catch(() => null);
    check('K0 로컬 엣지 push 가 떠 있다', !!r && r.status !== 503, r ? `status=${r.status}` : '응답 없음');
  });

  const w = await makeWorld(L, env, { tag: 'pk', staffN: 2, joinN: 1, plan: 'multi', courses: [{ items: 1 }] });
  worlds.push(w);
  const [s1, s2] = w.staff; // s1 합류함 · s2 옛 신청(대기)
  check('셋업: 매장(유료) + 직원 1 + 대기 1 + 퀴즈 1', !!w.unit && w.courses.length === 1, `unit=${w.unit}`);

  await kase('K1', 'approve_member → 10초 안에 구성원 알림 선점', async () => {
    await seedPending(admin, s2.id, w.unit);
    await ok(w.owner.c.rpc('approve_member', { p_uid: s2.id }), 'approve_member');
    const got = await waitFor(async () => {
      const { data } = await admin.from('member_notices').select('claimed_at').eq('user_id', s2.id).eq('unit_id', w.unit).eq('kind', 'approved');
      return (data ?? []).length === 1 && !!data[0].claimed_at;
    });
    check('K1 ★승인 알림이 10초 안에 선점된다', got.ok, `${got.ms}ms`);
  });

  await kase('K2', '받는 사람 추가 → 10초 안에 퀴즈 발송', async () => {
    const id = `qz_pk_${w.s}`;
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    await ok(w.owner.c.from('quiz_assignments').insert({ id, unit_id: w.unit, course_id: w.courses[0].id, user_id: s1.id, scheduled_on: day,
      origin: 'manual', send_at: new Date(Date.now() - 60e3).toISOString() }), '퀴즈 행');
    check('K2 셋업: 이 행은 지금 나갈 수 있다(quiz_send_block null)', R.val(`select coalesce(public.quiz_send_block(a), 'NULL') from public.quiz_assignments a where a.id = ${q(id)}`) === 'NULL');
    const got = await waitFor(async () => {
      const { data } = await admin.from('quiz_assignments').select('sent_at').eq('id', id).maybeSingle();
      return !!data?.sent_at;
    });
    check('K2 ★10초 안에 sent_at', got.ok, `${got.ms}ms`);
  });

  await kase('K3', 'owner_alerts 행 → 10초 안에 선점', async () => {
    const ins = await admin.from('owner_alerts').insert({ unit_id: w.unit, kind: 'card_fail', period: `qa-pk-${w.s}`, step: 1, title: 'QA 깨우기', body: 'b' }).select('id').single();
    if (ins.error) throw new Error(`owner_alerts 시드: ${ins.error.message}`);
    const got = await waitFor(async () => {
      const { data } = await admin.from('owner_alerts').select('claimed_at').eq('id', ins.data.id).maybeSingle();
      return !!data?.claimed_at;
    });
    check('K3 ★사장 알림이 10초 안에 선점된다', got.ok, `${got.ms}ms`);
  });

  const oaRow = (tag) => `insert into public.owner_alerts(unit_id, kind, period, step, title, body) values (${q(w.unit)}, 'card_fail', ${q(`qa-pk-${tag}-${w.s}`)}, 1, 'QA', 'b');`;
  const mnRow = (i) => `insert into public.member_notices(user_id, unit_id, kind, title, body, url) values (${q(w.owner.id)}, ${q(w.unit)}, 'left', ${q(`QA 깨우기 ${i}`)}, 'b', '/owner/staff');`;

  await kase('K4', '스윕 안에서 생긴 사장 알림은 alerts 깨우기를 쌓지 않는다', async () => {
    const ctl = kicksIn(oaRow('ctl'));
    check('K4 대조: 스윕 없이 넣으면 alerts 요청 1', count(ctl, 'alerts') === 1, `요청=[${ctl}]`);
    const inSweep = kicksIn(`select count(*) from public.sweep_owner_alerts();\n${oaRow('sw')}`);
    check('K4 ★sweep_owner_alerts 트랜잭션 안에서는 alerts 요청 0', count(inSweep, 'alerts') === 0, `요청=[${inSweep}]`);
  });

  await kase('K5', '한 트랜잭션 3행 → notices 요청 1', async () => {
    const k = kicksIn([1, 2, 3].map(mnRow).join('\n'));
    check('K5 ★문장 3개 · 요청 1개', count(k, 'notices') === 1 && k.split(',').filter(Boolean).length === 1, `요청=[${k}]`);
  });

  await kase('K6', '0행 · 지금 못 나가는 퀴즈 행 → 요청 없음', async () => {
    const z = kicksIn(`insert into public.member_notices(user_id, unit_id, kind, title, body, url) select user_id, unit_id, kind, title, body, url from public.member_notices where false;`);
    check('K6 0행 넣기 → 요청 0', z === '', `요청=[${z}]`);
    const tomorrow = new Date(Date.now() + 9 * 3600e3 + 864e5).toISOString().slice(0, 10);
    const nq = kicksIn(`insert into public.quiz_assignments(id, unit_id, course_id, user_id, scheduled_on, origin) values (${q(`qz_pk_nt_${w.s}`)}, ${q(w.unit)}, ${q(w.courses[0].id)}, ${q(s1.id)}, ${q(tomorrow)}, 'manual');`);
    check('K6 보낼 시각 전(내일) 퀴즈 행 → quiz 요청 0', count(nq, 'quiz') === 0, `요청=[${nq}]`);
  });
} catch (err) {
  fail++; console.log('  ✗ 중단:', err.message);
} finally {
  console.log('\n[K7] Vault 원상 복구');
  if (orig) {
    try {
      vaultSet(orig);
      const back = NAMES.every((k) => vaultGet(k) === orig[k]);
      check('K7 Vault = 처음 상태', back);
    } catch (e) { check('K7 Vault = 처음 상태', false, e.message); }
  } else check('K7 Vault 처음 상태를 못 읽음(아무것도 안 바꿈)', false);
  const cl = await cleanupWorld(L, env, worlds).catch((err) => ({ left: -1, detail: [err.message] }));
  check('정리: 남은 행 0', cl.left === 0, cl.detail?.join(' ') ?? '');
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · skip ${skip} · LLM 0회`);
process.exit(fail === 0 ? 0 : 1);
