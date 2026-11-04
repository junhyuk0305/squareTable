// qa-fz-local.mjs — 퍼징·발송기 재현 하니스(qa-quiz-fuzz · qa-scheduler-recheck)의 로컬 전용 셋업 (2026-11-03)
//
// ★로컬 도커만 친다. 접속 정보는 `supabase status -o env` 에서만 얻고 .env 는 읽지 않는다.
//   주소가 http://127.0.0.1: 이 아니면 exit 2. psql 은 로컬 db 컨테이너 안에서만 돈다.
// ★세션: 로컬 auth 의 sign_in_sign_ups 상한(5분 30회 · config.toml)에 shrink 재실행이 걸린다.
//   그래서 계정은 admin.createUser 로 만들고, 세션 JWT 는 로컬 JWT_SECRET 으로 직접 서명한다(HS256 · 로컬 전용).
//   PostgREST·RPC 에서는 auth.uid() = sub 로 실세션과 같다. auth 엔드포인트(refresh·signOut)는 안 쓴다.
// ★정리: service_role 하드 삭제 뒤 unit_id 열이 있는 public 표 전부와 auth.users·profiles 를 다시 세어 남은 행 수를 돌려준다.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from '../qa-otp-seed.mjs';
import { joinAsStaff } from './qa-staff.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));

/** 로컬 접속 정보. --local 이 없거나 주소가 로컬이 아니면 멈춘다. */
export function localEnv() {
  if (!process.argv.includes('--local')) { console.error('중단: 이 하니스는 --local 전용이다'); process.exit(2); }
  // 전역 CLI 3.x 는 이 저장소 config.toml 의 [inbucket] 을 거부한다(2026-11-03 실측). 2.x 로 한 번 더 시도한다.
  const tries = [['supabase', 'status', '-o', 'env'], ['--yes', 'supabase@2.122.1', 'status', '-o', 'env']];
  let st = {};
  for (const args of tries) {
    try {
      const out = execFileSync('npx', args, { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'], cwd: here('../..') });
      st = Object.fromEntries(out.split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?\r?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
      if (st.API_URL) break;
    } catch { /* 다음 시도 */ }
  }
  const URL_ = st.API_URL, ANON = st.ANON_KEY, SRV = st.SERVICE_ROLE_KEY, JWT = st.JWT_SECRET;
  if (!URL_ || !/^http:\/\/127\.0\.0\.1:/.test(URL_)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL_); process.exit(2); }
  if (!ANON || !SRV || !JWT) { console.error('중단: 로컬 키를 못 읽었다'); process.exit(2); }
  const proj = readFileSync(here('../../supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  return { URL_, ANON, SRV, JWT, DB_CONTAINER: `supabase_db_${proj}` };
}

export function makeLocal(env) {
  const admin = createClient(env.URL_, env.SRV, { auth: { persistSession: false, autoRefreshToken: false } });
  const psql = (sql) => execFileSync('docker', ['exec', '-i', env.DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mintJwt = (uid, email) => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: uid, email, role: 'authenticated', aud: 'authenticated', iss: `${env.URL_}/auth/v1`, iat: now, exp: now + 6 * 3600, aal: 'aal1', session_id: randomUUID() });
    const sig = createHmac('sha256', env.JWT).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  };
  const clientFor = (uid, email) => {
    const jwt = mintJwt(uid, email);
    return createClient(env.URL_, env.ANON, { accessToken: async () => jwt, auth: { persistSession: false, autoRefreshToken: false } });
  };
  return { admin, psql, clientFor };
}

const ok = async (q, what) => { const r = await q; if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
export { ok };

const pad = (n) => String(n).padStart(2, '0');
/** KST 오늘(+n일) "YYYY-MM-DD" — 서버 due_quiz_sends 와 같은 축. */
export const kstDay = (n = 0) => { const k = new Date(Date.now() + 9 * 3600e3 + n * 864e5); return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`; };

/**
 * 매장 하나 = 사장 1 + 직원 n + 퀴즈들. 근무표 없음(fail-open).
 * opts: { tag, staffN, courses: [{ items, answerDays }], plan: 'multi'|null }
 * 반환 world: { unit, code, owner:{id,c}, staff:[{id,c,email,key}], courses:[{id, items:[{id, answer}] , entries}] , users, phones }
 */
export async function makeWorld(L, env, opts) {
  const s = `${opts.tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const w = { s, unit: null, code: null, owner: null, staff: [], courses: [], users: [], phones: [], entries: [] };
  // 셋업 중간에 던지면 호출자가 w 를 못 받아 정리 집계에서 빠진다. 여기서 지우고 남은 행 수를 붙여 다시 던진다.
  try { return await fillWorld(L, env, opts, w); } catch (e) {
    const cl = await cleanupWorld(L, env, [w]).catch(() => null);
    e.message = `${e.message} (셋업 실패 · 정리 남은 행 ${cl ? cl.left : '?'})`;
    throw e;
  }
}

async function fillWorld(L, env, opts, w) {
  const { admin, clientFor } = L;
  const { s } = w;
  const digits = String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 10));
  const mkUser = async (key, role, phonePrefix, extra = {}) => {
    const email = `qa_fz_${key}_${s}@example.com`.toLowerCase();
    const phone = `${phonePrefix}${digits}`;
    w.phones.push(phone);
    await seedVerifiedPhones(env.URL_, env.SRV, [phone]);
    const { data, error } = await admin.auth.admin.createUser({
      email, password: 'Test1234!qa', email_confirm: true,
      user_metadata: { name: `QA_FZ_${key}`, role, phone, birth_date: '1994-03-03', ...extra },
    });
    if (error) throw new Error(`createUser(${key}): ${error.message}`);
    w.users.push(data.user.id);
    return { id: data.user.id, email, key, c: clientFor(data.user.id, email) };
  };
  w.owner = await mkUser('o', 'owner', '0106', { store_name: 'FZ', industry: '카페·디저트' });
  const c1 = await ok(w.owner.c.rpc('create_store', { p_store_name: `FZ ${s}`, p_industry: '카페·디저트', p_biz_no: null }), 'create_store');
  w.unit = c1?.[0]?.unit_id; w.code = c1?.[0]?.invite_code;
  if (!w.unit || !w.code) throw new Error('create_store: 빈 결과');
  if (opts.plan) await ok(admin.rpc('admin_activate_store', { p_unit_id: w.unit, p_days: 1, p_plan: opts.plan }), 'admin_activate_store');
  await ok(w.owner.c.rpc('switch_active_unit', { p_unit_id: w.unit }), 'switch owner');
  const prefixes = ['0108', '0109', '0107', '0102', '0105', '0103'];
  for (let i = 0; i < (opts.staffN ?? 2); i++) {
    const st = await mkUser(String.fromCharCode(97 + i), 'junior', prefixes[i]);
    w.staff.push(st);
  }
  // 직원은 퀴즈를 만들기 전에 합류한다 — 입사 트리거(0169·0273)가 첫 퀴즈를 자동 배정하지 않게.
  for (const st of w.staff.slice(0, opts.joinN ?? w.staff.length)) {
    await joinAsStaff(st.c, w.code);
    await ok(st.c.rpc('switch_active_unit', { p_unit_id: w.unit }), 'switch staff');
  }
  const day = kstDay();
  const fiveDaysAgo = new Date(Date.now() - 5 * 864e5).toISOString();
  for (const [ci, spec] of (opts.courses ?? []).entries()) {
    const cid = `tc_fz_${ci}_${s}`;
    await ok(w.owner.c.from('training_courses').insert({
      id: cid, unit_id: w.unit, key: `fz_${ci}_${s}`, name: `FZ 퀴즈 ${ci + 1}`, description: null, preset: null,
      min_items: 1, max_items: 5, due_days: null, position: ci, active: true, start_at: day, answer_days: spec.answerDays ?? null,
    }), 'training_courses');
    const eid = `pb_fz_${ci}_${s}`;
    w.entries.push(eid);
    // updated_at 은 과거로 — 직원 통과(verified_at = 서버 now())보다 뒤가 되면 재확인 트리거가 끼어든다(qa-quiz-schedule 과 같은 이유).
    await ok(admin.from('playbook_entries').insert({ id: eid, unit_id: w.unit, category: 'Routine', title: `FZ 근거 ${ci}`, status: 'published', updated_at: fiveDaysAgo }), 'playbook_entries');
    await ok(admin.from('course_entries').insert({ course_id: cid, entry_id: eid, unit_id: w.unit, position: 0 }), 'course_entries');
    const items = [];
    for (let k = 0; k < spec.items; k++) {
      const qid = `qi_fz_${ci}_${k}_${s}`;
      await ok(admin.from('quiz_items').insert({ id: qid, unit_id: w.unit, course_id: cid, entry_ids: [eid], kind: 't0', format: 'mc4', status: 'active',
        payload: { ask: `FZ 문항 ${ci}-${k}`, choices: ['가', '나', '다'], answer_index: 1, explain: 'QA' } }), 'quiz_items');
      items.push({ id: qid, answer: 1, wrong: 0 });
    }
    w.courses.push({ id: cid, items, entry: eid });
  }
  return w;
}

/** 이 world 가 만든 것을 지우고 남은 행 수를 센다(하드 삭제 · service_role/psql). */
export async function cleanupWorld(L, env, worlds) {
  const { admin, psql } = L;
  const units = worlds.map((w) => w.unit).filter(Boolean);
  const users = worlds.flatMap((w) => w.users);
  const phones = worlds.flatMap((w) => w.phones);
  const lit = (a) => `'{${a.join(',')}}'`;
  if (units.length) {
    // 자식 → 부모 순. units 하드 삭제가 나머지를 cascade 한다. 사장 세션 delete 는 soft delete 로 바뀌므로 쓰지 않는다.
    for (const t of ['quiz_attempt_items', 'quiz_attempts', 'quiz_assignments', 'knowhow_understanding', 'quiz_items', 'course_entries', 'training_courses', 'work_templates', 'playbook_entries']) {
      await admin.from(t).delete().in('unit_id', units);
    }
    for (const u of units) { const r = await admin.from('units').delete().eq('id', u); if (r.error) console.error('  ! 정리 units:', r.error.message); }
  }
  for (const id of users) { const r = await admin.auth.admin.deleteUser(id); if (r.error && !/not found/i.test(r.error.message)) console.error('  ! 정리 user:', r.error.message); }
  await cleanupSeededPhones(env.URL_, env.SRV, phones).catch(() => {});
  // 남은 행: unit_id 열이 있는 모든 public 기본 표 + 계정 + 프로필 + 시드 번호.
  let left = 0; const detail = [];
  if (units.length) {
    const rows = psql(`select c.table_name || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I where unit_id::text = any(%L::text[])', c.table_name, ${lit(units)}), false, true, '')))[1]::text
      from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'unit_id'
      union all select 'units=' || count(*) from public.units where id = any(${lit(units)}::text[])`);
    for (const l of rows.split('\n')) { const [t, n] = l.split('='); if (Number(n) > 0) { left += Number(n); detail.push(`${t}=${n}`); } }
  }
  if (users.length) {
    const n1 = Number(psql(`select count(*) from auth.users where id = any(${lit(users)}::uuid[])`));
    const n2 = Number(psql(`select count(*) from public.profiles where id = any(${lit(users)}::uuid[])`));
    if (n1) detail.push(`auth.users=${n1}`); if (n2) detail.push(`profiles=${n2}`); left += n1 + n2;
  }
  if (phones.length) {
    const n3 = Number(psql(`select count(*) from public.phone_otps where code_hash = 'qa-seed' and phone = any('{${phones.join(',')}}'::text[])`));
    if (n3) detail.push(`phone_otps=${n3}`); left += n3;
  }
  return { units: units.length, users: users.length, left, detail };
}
