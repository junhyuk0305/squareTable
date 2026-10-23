// KH-03 재현·검사: 노하우 목록이 서버 응답 상한(PostgREST max_rows=1000) 밖을 잃지 않는가.
// 로컬 격리 DB 전용. `node scripts/qa-kh03-knowhow-paging.mjs --local`
// 대상 주소는 npx supabase status 에서만 읽고 127.0.0.1 이 아니면 멈춘다(qa-local-target).
// 시드는 docker exec supabase_db_SquareTable psql 로 넣고, 끝나면(실패해도) 지운다.
// 검사 대상 함수는 src/lib/db.ts 의 실제 본문을 잘라 실행한다(통신만 로컬 supabase-js).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { IS_LOCAL, localEnv, assertLocalUrl } from './qa-local-target.mjs';

if (!IS_LOCAL) { console.error('중단: --local 전용 검사'); process.exit(2); }
const env = localEnv();
assertLocalUrl(env.SUPABASE_URL);
const DB_CONTAINER = 'supabase_db_SquareTable';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const { createClient } = req('@supabase/supabase-js');

const psql = (sql) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'], { input: sql, encoding: 'utf8' });

// ── db.ts 실제 함수 본문 실행 ──
const DB_FNS = ['fetchEntries', 'fetchOwnerKnowhowEntries', 'readAllPages'];
function loadDbFns(supabase) {
  const p = path.join(root, 'src/lib/db.ts');
  const text = fs.readFileSync(p, 'utf8');
  const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  sf.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && DB_FNS.includes(n.name?.text)) found.push(n.getText(sf).replace(/^export /, '')); });
  const js = ts.transpileModule(found.join('\n') + '\nmodule.exports = { fetchEntries, fetchOwnerKnowhowEntries };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const fails = [];
  vm.runInNewContext(js, { supabase, HAS_SUPABASE: true, readFail: (l, e) => fails.push([l, e?.message]), module: mod, exports: mod.exports });
  return { ...mod.exports, fails, helpers: found.length };
}

// 다른 에이전트도 로컬 DB를 쓴다 → 실행마다 고유 접두사. 정리도 이 접두사만 지운다.
const PFX = `qa-kh03-${process.pid}-${Date.now().toString(36)}`;
const BOUNDS = [0, 1000, 1001];
const users = { a: `${PFX}-owner-a@local.test`, b: `${PFX}-owner-b@local.test`, ...Object.fromEntries(BOUNDS.map((n) => ['n' + n, `${PFX}-owner-n${n}@local.test`])) };
const PW = 'qa-kh03-Local-only-1!';
async function adminCreate(email) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  });
  const j = await r.json();
  if (!j.id) throw new Error('user create failed ' + JSON.stringify(j));
  return j.id;
}
function cleanup() {
  psql(`delete from public.playbook_entries where unit_id like '${PFX}-%';
        delete from public.unit_members where unit_id like '${PFX}-%';
        update public.profiles set unit_id = null, active_unit_id = null where id in (select id from auth.users where email like '${PFX}-%');
        delete from public.units where id like '${PFX}-%';
        delete from auth.users where email like '${PFX}-%';`);
  return psql(`select (select count(*) from public.playbook_entries where unit_id like '${PFX}-%') + (select count(*) from public.units where id like '${PFX}-%') + (select count(*) from auth.users where email like '${PFX}-%');`).trim();
}

const N_A = 1205, N_A2 = 300, N_C = 50, N_DRAFT = 3;
async function seed() {
  cleanup();
  const ua = await adminCreate(users.a), ub = await adminCreate(users.b);
  // 같은 created_at 을 5개씩 묶어 1000번째 경계에 동점을 둔다(정렬 안정성 검사).
  // 로컬 시드 전용: 가입 트리거(전화 인증 등)를 이 세션에서만 끈다. 검사 대상은 읽기 RLS 라 영향 없다.
  psql(`set session_replication_role = replica;
    insert into public.units (id, store_name, owner_id) values ('${PFX}-A','QA A','${ua}'),('${PFX}-A2','QA A2','${ua}'),('${PFX}-C','QA C','${ub}');
    insert into public.unit_members (user_id, unit_id, role) values ('${ua}','${PFX}-A','owner'),('${ua}','${PFX}-A2','owner'),('${ub}','${PFX}-C','owner');
    update public.profiles set role='owner', unit_id='${PFX}-A', active_unit_id='${PFX}-A' where id='${ua}';
    update public.profiles set role='owner', unit_id='${PFX}-C', active_unit_id='${PFX}-C' where id='${ub}';
    insert into public.playbook_entries (id, unit_id, category, title, created_at)
      select '${PFX}-A-' || lpad(g::text, 4, '0'), '${PFX}-A', 'qa', 'QA A ' || g, timestamptz '2026-01-01' + (g / 5) * interval '1 minute' from generate_series(0, ${N_A - 1}) g;
    insert into public.playbook_entries (id, unit_id, category, title, status, created_at)
      select '${PFX}-A-draft-' || g, '${PFX}-A', 'qa', 'QA draft ' || g, 'draft', timestamptz '2026-01-01' from generate_series(1, ${N_DRAFT}) g;
    insert into public.playbook_entries (id, unit_id, category, title, archived_at) values ('${PFX}-A-archived', '${PFX}-A', 'qa', 'QA archived', now());
    insert into public.playbook_entries (id, unit_id, category, title, created_at)
      select '${PFX}-A2-' || lpad(g::text, 4, '0'), '${PFX}-A2', 'qa', 'QA A2 ' || g, timestamptz '2026-01-01' + (g / 7) * interval '1 minute' from generate_series(0, ${N_A2 - 1}) g;
    insert into public.playbook_entries (id, unit_id, category, title)
      select '${PFX}-C-' || g, '${PFX}-C', 'qa', 'QA C ' || g from generate_series(1, ${N_C}) g;`);
  // 경계 사례: 정확히 0 · 1000 · 1001 건인 매장(모두 같은 시각 → 동점 최대).
  for (const n of BOUNDS) {
    const u = await adminCreate(users['n' + n]), unit = `${PFX}-N${n}`;
    psql(`set session_replication_role = replica;
      insert into public.units (id, store_name, owner_id) values ('${unit}','QA N${n}','${u}');
      insert into public.unit_members (user_id, unit_id, role) values ('${u}','${unit}','owner');
      update public.profiles set role='owner', unit_id='${unit}', active_unit_id='${unit}' where id='${u}';
      insert into public.playbook_entries (id, unit_id, category, title, created_at)
        select '${unit}-' || g, '${unit}', 'qa', 'QA N ' || g, timestamptz '2026-01-01' from generate_series(1, ${n}) g;`);
  }
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
function audit(label, rows, expectedIds, foreignPrefix) {
  const ids = rows.map((r) => r.id);
  const uniq = new Set(ids);
  const missing = expectedIds.filter((id) => !uniq.has(id));
  const foreign = ids.filter((id) => !expectedIds.includes(id) || id.startsWith(foreignPrefix));
  let sorted = true;
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].created_at < rows[i].created_at) sorted = false;
  check(`${label}: 전체 수`, rows.length === expectedIds.length, { got: rows.length, expected: expectedIds.length });
  check(`${label}: 중복 0`, ids.length === uniq.size, { dup: ids.length - uniq.size });
  check(`${label}: 누락 0`, missing.length === 0, { missing: missing.length, sample: missing.slice(0, 3) });
  check(`${label}: 다른 매장·보관 0`, foreign.length === 0, { foreign: foreign.length });
  check(`${label}: created_at 내림차순`, sorted, {});
  // searchClient.hybridSearch 는 검색 결과 ID 를 이 목록(byId)에서만 찾는다 → 1000번째 밖 ID 가 목록에 있어야 검색에 뜬다.
  check(`${label}: 1000번째 밖 노하우(가장 오래된 것) 검색 대상 포함`, uniq.has(`${PFX}-A-0000`), {});
}

async function main() {
  let exit = 0;
  try {
    await seed();
    const expA = psql(`select id from public.playbook_entries where unit_id='${PFX}-A' and archived_at is null order by id`).trim().split('\n');
    const expOwner = psql(`select id from public.playbook_entries where unit_id in ('${PFX}-A','${PFX}-A2') and status='published' and archived_at is null order by id`).trim().split('\n');
    const client = createClient(env.SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: se } = await client.auth.signInWithPassword({ email: users.a, password: PW });
    if (se) throw se;
    // 서버 상한 실측: 한 번의 무제한 select 가 몇 행을 주는가.
    const { data: one } = await client.from('playbook_entries').select('id');
    console.log('INFO 한 번 select 행 수(max_rows 실측) =', one?.length, '· 기대 전체 =', expA.length);

    const fns = loadDbFns(client);
    const e = await fns.fetchEntries();
    check('fetchEntries: error=false', e.error === false, {});
    audit('fetchEntries', e.data, expA, `${PFX}-C`);
    const o = await fns.fetchOwnerKnowhowEntries();
    check('fetchOwnerKnowhowEntries: error=null', o.error === null, { error: o.error?.message });
    audit('fetchOwnerKnowhowEntries', o.data ?? [], expOwner, `${PFX}-C`);

    // 중간 페이지 실패(모의): 두 번째 range 요청만 실패시킨다. 일부만 담긴 목록을 성공으로 주면 안 된다.
    for (const [name, mode] of [['fetchEntries', 'from'], ['fetchOwnerKnowhowEntries', 'rpc']]) {
      let calls = 0;
      const wrap = (b) => new Proxy(b, { get(t, k) {
        if (k === 'range') return (...a) => { calls++; return calls === 2 ? Promise.resolve({ data: null, error: { code: 'QA', message: 'mock page 2 failure' } }) : wrap(t.range(...a)); };
        const v = t[k]; return typeof v === 'function' ? (...a) => { const r = v.apply(t, a); return r && typeof r === 'object' && 'then' in r && k !== 'then' ? wrap(r) : r; } : v;
      } });
      const flaky = new Proxy(client, { get(t, k) { const v = t[k]; return (k === 'from' || k === 'rpc') ? (...a) => wrap(v.apply(t, a)) : v; } });
      const f = loadDbFns(flaky);
      const r = await f[name]();
      const failedOk = name === 'fetchEntries' ? (r.error === true && r.data.length === 0) : (r.error != null && r.data == null);
      check(`${name}: 중간 페이지 실패 → 실패로 반환(부분 목록 0)`, failedOk && calls >= 2, { calls, error: !!r.error, rows: r.data?.length ?? null });
    }

    for (const n of BOUNDS) {
      const cn = createClient(env.SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await cn.auth.signInWithPassword({ email: users['n' + n], password: PW });
      const fn = loadDbFns(cn);
      const en = await fn.fetchEntries(), on = await fn.fetchOwnerKnowhowEntries();
      const uniq = new Set((en.data ?? []).map((r) => r.id)).size;
      check(`경계 ${n}건: fetchEntries·owner 모두 ${n}건 · 중복 0`, !en.error && !on.error && en.data.length === n && uniq === n && (on.data ?? []).length === n, { entries: en.data?.length, uniq, owner: on.data?.length });
    }
    // 다른 매장 사장(B)은 A 자료를 0건 받는다.
    const cb = createClient(env.SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await cb.auth.signInWithPassword({ email: users.b, password: PW });
    const fb = loadDbFns(cb);
    const eb = await fb.fetchEntries(), ob = await fb.fetchOwnerKnowhowEntries();
    const leak = [...(eb.data ?? []), ...(ob.data ?? [])].filter((r) => !String(r.id).startsWith(`${PFX}-C-`)).length;
    check('다른 매장 사장 B: A 자료 0건', leak === 0 && eb.data.length === N_C && (ob.data ?? []).length === N_C, { leak, entries: eb.data.length, owner: ob.data?.length });
  } catch (err) {
    console.error('ERROR', err); exit = 1;
  } finally {
    const left = cleanup();
    console.log('CLEANUP 남은 시드 행 =', left);
    if (left !== '0') exit = 1;
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ target: env.SUPABASE_URL, db: DB_CONTAINER, passed: results.length - failed, failed }));
  process.exitCode = failed || exit ? 1 : 0;
}
main();
