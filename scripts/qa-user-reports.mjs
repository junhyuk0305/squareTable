#!/usr/bin/env node
// qa-user-reports.mjs — 0241 신고(F-1 · 정책 M5) · 고정 계정 · 끝나면 신고 행을 지운다
//
// 무엇을 못박나:
//   [1] report_targets: 같은 매장 사람만, 본인은 빼고 돌려준다. 남의 매장 id 로 부르면 not_a_member(IDOR).
//   [2] submit_user_report 판정 순서와 오류 코드
//       · 같은 매장 동료 신고는 성공한다. 이름·역할·매장 이름은 서버가 스냅샷으로 넣는다.
//       · 남의 매장 unit_id → not_a_member · 다른 매장 사람 지목 → target_not_member · 본인 → self_report
//       · 분류 'ai_answer' 만 대상 없이 보낼 수 있다(M5). 다른 분류에 대상이 없으면 target_required.
//       · 24시간 안 다섯 건이 넘으면 rate_limited · 같은 대상을 1시간 안에 또 → duplicate_recent
//       · 매장이 아닌 단위(brand_workspace)는 not_a_store(로컬에서만 임시 단위를 만들어 확인).
//   [3] 클라는 신고를 못 읽고 못 쓴다: 신고자·사장 select 0행, 직접 insert·update·delete 거부, anon 호출 거부.
//
// 계정: 로컬 부트스트랩의 고정 파일럿 계정만 쓴다(가입하지 않는다).
//   owner@pilot(store_001 사장) · staff@pilot(매니저) · staff2@pilot(직원) · owner-solo@pilot(다른 매장 사장)
// ★로컬 전용. 로컬이 아닌 URL 이면 멈춘다. 운영 고정 계정으로 돌릴 때만 QA_ALLOW_LIVE=1 을 붙인다.
// 정리: 시작과 끝에 본문이 '[QA-UR' 로 시작하는 신고 행을 service_role 로 지운다.
// 실행: node scripts/qa-user-reports.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_);
if (!LOCAL && env.QA_ALLOW_LIVE !== '1') {
  console.error(`중단: 로컬 도커 전용 하니스다. 운영 고정 계정으로 돌리려면 QA_ALLOW_LIVE=1 을 붙인다. 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = ${LOCAL ? '로컬' : '운영(QA_ALLOW_LIVE=1)'} ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const PW = env.SEED_PASSWORD || 'pilot1234';
const UNIT = 'store_001';
const s = String(Date.now()).slice(-9);
const MARK = `[QA-UR ${s}]`;
const BW = `qa_ur_bw_${s}`;
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return `psql 오류: ${String(e.stderr ?? e.message).trim()}`; }
};
const login = async (email) => {
  const c = mk();
  const r = await c.auth.signInWithPassword({ email, password: PW });
  if (r.error) throw new Error(`${email} 로그인: ${r.error.message}`);
  return { c, id: r.data.user.id };
};
const has = (error, code) => String(error?.message ?? '').includes(code);
const denied = (error) => /permission denied/i.test(String(error?.message ?? ''));
const hidden = ({ data, error }) => (!error && (data ?? []).length === 0) || denied(error);
const submit = (who, target, category, body, occurredAt = null, unit = UNIT) =>
  who.c.rpc('submit_user_report', {
    p_unit_id: unit, p_target: target, p_category: category, p_body: body, p_occurred_at: occurredAt,
  });
const cleanRows = async () => {
  const { error } = await admin.from('user_reports').delete().like('body', '[QA-UR%');
  return error;
};

try {
  await cleanRows(); // 지난 실행이 남긴 행(실패해도 계속 — 적용 전에는 표가 없다)
  const O = await login('owner@pilot.squaretable.app');
  const M = await login('staff@pilot.squaretable.app');
  const J = await login('staff2@pilot.squaretable.app');
  const X = await login('owner-solo@pilot.squaretable.app');
  const { data: unitRow } = await admin.from('units').select('store_name').eq('id', UNIT).single();
  const { data: profs } = await admin.from('profiles').select('id, name').in('id', [O.id, J.id]);
  const nameOf = (id) => (profs ?? []).find((p) => p.id === id)?.name ?? null;
  console.log(`setup: ${UNIT} 사장·매니저·직원 + 다른 매장 사장 · 표시 ${MARK}`);

  // ════════════════ [1] report_targets ════════════════
  console.log('\n[1] report_targets');
  {
    const { data, error } = await J.c.rpc('report_targets', { p_unit_id: UNIT });
    const ids = (data ?? []).map((r) => r.user_id);
    check('1-1 직원은 같은 매장 사장·매니저를 받는다', !error && ids.includes(O.id) && ids.includes(M.id), error?.message ?? JSON.stringify(data));
    check('1-2 본인은 목록에 없다', !error && !ids.includes(J.id), JSON.stringify(ids));
    const o = (data ?? []).find((r) => r.user_id === O.id);
    check('1-3 역할·이름이 붙는다', !!o && o.role === 'owner' && o.name === nameOf(O.id), JSON.stringify(o));
  }
  {
    const { error } = await X.c.rpc('report_targets', { p_unit_id: UNIT });
    check('1-4 남의 매장 id 로 부르면 not_a_member', has(error, 'not_a_member'), error?.message ?? '통과함');
  }
  {
    const { error } = await mk().rpc('report_targets', { p_unit_id: UNIT });
    check('1-5 anon 호출은 permission denied', denied(error), error?.message ?? '통과함');
  }

  // ════════════════ [2] submit_user_report ════════════════
  console.log('\n[2] submit_user_report');
  const occurred = new Date(Date.now() - 3600_000).toISOString();
  let R1 = null;
  {
    const { data, error } = await submit(J, O.id, 'harassment', `${MARK} 동료 신고 본문입니다`, occurred);
    R1 = typeof data === 'string' ? data : null;
    check('2-1 같은 매장 동료 신고는 성공하고 id 를 돌려준다', !error && !!R1, error?.message ?? JSON.stringify(data));
  }
  if (R1) {
    const { data: r } = await admin.from('user_reports')
      .select('unit_id, store_name, reporter_id, reporter_name, reporter_role, target_user_id, target_name, target_role, category, body, occurred_at, status')
      .eq('id', R1).single();
    check('2-2 스냅샷: 매장 이름·신고자·대상 이름과 역할',
      r && r.unit_id === UNIT && r.store_name === unitRow?.store_name && r.reporter_id === J.id
        && r.reporter_role === 'junior' && r.reporter_name === nameOf(J.id)
        && r.target_user_id === O.id && r.target_role === 'owner' && r.target_name === nameOf(O.id),
      JSON.stringify(r));
    check('2-3 상태 new · 분류 · 발생 시각이 남는다',
      r && r.status === 'new' && r.category === 'harassment' && r.occurred_at && Math.abs(new Date(r.occurred_at) - new Date(occurred)) < 1000,
      JSON.stringify(r));
  }
  {
    const { error } = await submit(J, O.id, 'other', `${MARK} 같은 사람 또 신고`);
    check('2-4 같은 대상을 1시간 안에 또 → duplicate_recent', has(error, 'duplicate_recent'), error?.message ?? '통과함');
  }
  {
    const { error } = await submit(J, X.id, 'spam', `${MARK} 다른 매장 사람`);
    check('2-5 다른 매장 사람 지목 → target_not_member', has(error, 'target_not_member'), error?.message ?? '통과함');
  }
  {
    const { error } = await submit(X, O.id, 'spam', `${MARK} 남의 매장 id`);
    check('2-6 남의 매장 unit_id → not_a_member', has(error, 'not_a_member'), error?.message ?? '통과함');
  }
  {
    const { error } = await submit(J, J.id, 'other', `${MARK} 나를 신고`);
    check('2-7 본인 신고 → self_report', has(error, 'self_report'), error?.message ?? '통과함');
  }
  {
    const { error } = await submit(J, null, 'harassment', `${MARK} 대상 없음`);
    check('2-8 사람 분류인데 대상이 없으면 target_required', has(error, 'target_required'), error?.message ?? '통과함');
  }
  {
    const { error } = await submit(J, M.id, 'bogus', `${MARK} 이상한 분류`);
    check('2-9 모르는 분류 → invalid_category', has(error, 'invalid_category'), error?.message ?? '통과함');
  }
  {
    const a = await submit(J, M.id, 'other', '짧음');
    const b = await submit(J, M.id, 'other', `${MARK} ${'가'.repeat(1000)}`);
    check('2-10 내용 5자 미만·1000자 초과 → invalid_body', has(a.error, 'invalid_body') && has(b.error, 'invalid_body'),
      `${a.error?.message ?? '통과함'} / ${b.error?.message ?? '통과함'}`);
  }
  {
    const { error } = await submit(J, M.id, 'other', `${MARK} 미래 시각`, new Date(Date.now() + 86400_000).toISOString());
    check('2-11 발생 시각이 미래 → invalid_occurred_at', has(error, 'invalid_occurred_at'), error?.message ?? '통과함');
  }
  let RAI = null;
  {
    const { data, error } = await submit(J, null, 'ai_answer', `${MARK} AI 답변이 불쾌했어요`);
    RAI = typeof data === 'string' ? data : null;
    const { data: r } = RAI
      ? await admin.from('user_reports').select('target_user_id, target_name, target_role, category').eq('id', RAI).single()
      : { data: null };
    check('2-12 ai_answer 는 대상 없이 보낸다(M5)',
      !error && r && r.target_user_id === null && r.target_name === null && r.category === 'ai_answer',
      error?.message ?? JSON.stringify(r));
  }
  {
    const { data, error } = await submit(M, J.id, 'inappropriate', `${MARK} 매니저가 직원을 신고`);
    const { data: r } = typeof data === 'string'
      ? await admin.from('user_reports').select('reporter_role, target_role').eq('id', data).single()
      : { data: null };
    check('2-13 매니저도 신고한다(역할 manager · 대상 junior)',
      !error && r && r.reporter_role === 'manager' && r.target_role === 'junior', error?.message ?? JSON.stringify(r));
  }
  {
    // 직원 J 는 지금 2건(R1, RAI). 3건을 더 넣어 5건을 채운다.
    const okAll = [];
    okAll.push(await submit(J, M.id, 'other', `${MARK} 세 번째`));
    okAll.push(await submit(J, null, 'ai_answer', `${MARK} 네 번째`));
    okAll.push(await submit(J, null, 'ai_answer', `${MARK} 다섯 번째`));
    check('2-14 24시간 안 다섯 건까지는 받는다', okAll.every((x) => !x.error),
      okAll.map((x) => x.error?.message ?? 'ok').join(' / '));
    const six = await submit(J, null, 'ai_answer', `${MARK} 여섯 번째`);
    check('2-15 여섯 번째는 rate_limited', has(six.error, 'rate_limited'), six.error?.message ?? '통과함');
    const sixDup = await submit(J, O.id, 'other', `${MARK} 여섯 번째(같은 대상)`);
    check('2-16 한도가 중복보다 먼저 판정된다', has(sixDup.error, 'rate_limited'), sixDup.error?.message ?? '통과함');
    const { count } = await admin.from('user_reports').select('id', { count: 'exact', head: true })
      .eq('reporter_id', J.id).like('body', `${MARK}%`);
    check('2-17 실패한 호출은 행을 남기지 않는다(직원 J = 5건)', count === 5, `count=${count}`);
  }
  if (LOCAL) {
    // 매장이 아닌 단위: 로컬에서만 임시 brand_workspace 를 만들어 다른 매장 사장을 넣는다.
    const made = psql(`begin; set local session_replication_role = replica;
      insert into public.units(id, owner_id, store_name, kind) values ('${BW}', '${X.id}', 'QA 신고 작업실', 'brand_workspace');
      commit;
      insert into public.unit_members(user_id, unit_id, role) values ('${X.id}', '${BW}', 'owner'), ('${O.id}', '${BW}', 'manager');
      select 'ok';`);
    const { error } = await submit(X, O.id, 'spam', `${MARK} 작업실`, null, BW);
    check('2-18 매장이 아닌 단위 → not_a_store', made.endsWith('ok') && has(error, 'not_a_store'), `${made} / ${error?.message ?? '통과함'}`);
  }

  // ════════════════ [3] 클라는 못 읽고 못 쓴다 ════════════════
  console.log('\n[3] 표 권한');
  {
    check('3-1 신고자 select 0행', hidden(await J.c.from('user_reports').select('id')), '');
    check('3-2 사장 select 0행', hidden(await O.c.from('user_reports').select('id')), '');
    check('3-3 anon select 0행', hidden(await mk().from('user_reports').select('id')), '');
  }
  {
    const { error } = await J.c.from('user_reports').insert({
      store_name: 'x', reporter_id: J.id, category: 'other', body: `${MARK} 직접 넣기`,
    });
    check('3-4 직접 insert 는 permission denied', denied(error), error?.message ?? '통과함');
  }
  if (R1) {
    const u = await O.c.from('user_reports').update({ status: 'done' }).eq('id', R1).select('id');
    const d = await O.c.from('user_reports').delete().eq('id', R1).select('id');
    const { data: still } = await admin.from('user_reports').select('status').eq('id', R1).single();
    check('3-5 사장이 직접 update·delete 해도 행이 그대로', hidden(u) && hidden(d) && still?.status === 'new',
      `${u.error?.message ?? 'ok'} / ${d.error?.message ?? 'ok'} / ${JSON.stringify(still)}`);
  }
  {
    const { error } = await mk().rpc('submit_user_report', {
      p_unit_id: UNIT, p_target: O.id, p_category: 'spam', p_body: `${MARK} anon`, p_occurred_at: null,
    });
    check('3-6 anon 의 submit_user_report 는 permission denied', denied(error), error?.message ?? '통과함');
  }
  if (LOCAL) {
    const out = psql(`select (select relrowsecurity from pg_class where oid = 'public.user_reports'::regclass)::text
      || ',' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_reports')::text
      || ',' || has_table_privilege('authenticated', 'public.user_reports', 'SELECT,INSERT,UPDATE,DELETE')::text
      || ',' || has_table_privilege('service_role', 'public.user_reports', 'SELECT')::text
      || ',' || has_table_privilege('service_role', 'public.user_reports', 'UPDATE')::text`);
    check('3-7 RLS on · 정책 0개 · authenticated 권한 없음 · service_role 읽기·고치기', out === 'true,0,false,true,true', out);
  }
} catch (e) {
  fail++;
  console.log('  FAIL 예외', e?.message ?? e);
} finally {
  if (LOCAL) psql(`delete from public.units where id = '${BW}'`);
  const err = await cleanRows();
  if (!err) {
    const { count } = await admin.from('user_reports').select('id', { count: 'exact', head: true }).like('body', '[QA-UR%');
    console.log(`정리: 신고 테스트 행 남은 수 = ${count}`);
  }
}
console.log(`\nqa:user-reports  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
