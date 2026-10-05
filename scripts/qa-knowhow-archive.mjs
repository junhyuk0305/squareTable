#!/usr/bin/env node
// qa-knowhow-archive.mjs — J10 노하우 보관(0248 · P5-1) 회귀 하니스 (로컬 도커 전용)
//
// 무엇을 못박나
//   [1] 순수 함수 — src/lib/knowhow/archive.ts 를 임시 트랜스파일해 실제 함수로 본다(로직 복제 없음).
//       확인 문구는 계획 글자 그대로 시작하고, 쓰는 곳(퀴즈·할일)이 있으면 그 수를 덧붙인다.
//   [2] 소스 계약 — fetchEntries 가 보관된 행을 빼고, 수정 화면의 지우기가 보관(archive_knowhow)이 되고,
//       보관함 화면에 되살리기가 있고, "완전히 삭제"는 앱 어디에도 없다.
//   [3] DB — 지금 경로(옛 앱 DELETE)로 지우면 응시 기록(quiz_attempts)이 0 이 된다(기준선).
//       고친 뒤: 옛 앱 DELETE 도 보관이 되고 응시 기록 수가 같다 · 보관한 노하우는 직원 select·match_playbook·
//       quiz_items_for·quiz_item_counts·게스트 링크·사장 개요 수에서 빠진다 · 매니저 거부 · 본사 사본 거부 ·
//       service_role 예외 · 되살리면 다시 보인다 · 초안 삭제와 service_role 삭제는 그대로 지운다 ·
//       신입 첫 퀴즈로 노하우가 전부 보관된 코스를 고르지 않는다.
//
// ★로컬 전용: 실행할 때마다 계정 4개를 가입시킨다. 라이브에서 돌리면 고정 계정 규칙 위반이라 URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-knowhow-archive.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '');

// 2026-10-05 사용자 결정(J10 정정): '보관'이 아니라 '삭제'다. 앱 어디에서도(사장 포함) 사라지고 되살릴 수 없다.
//   DB 는 지우지 않는다(archived_at 소프트 삭제 · 응시 기록 보존).
const BASE = '노하우를 삭제할까요? 삭제하면 되살릴 수 없어요.';

// ── [1] 순수 함수 ──────────────────────────────────────────────────────────
console.log('[1] 순수 함수 deleteConfirmMessage');
{
  const src = 'src/lib/knowhow/archive.ts';
  let A = null;
  if (existsSync(join(root, src))) {
    const OUT = join(root, '.qa-out', 'knowhow-archive');
    try {
      execFileSync('npx', ['tsc', src, '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
        '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0'],
      { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
    } catch { /* tsc 는 성공해도 종종 비-0 경고 — 산출물 존재로 판정 */ }
    writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
    A = await import(pathToFileURL(join(OUT, 'archive.js')));
  }
  const msg = typeof A?.deleteConfirmMessage === 'function' ? A.deleteConfirmMessage : null;
  check('1-0 archive.ts 에 deleteConfirmMessage 가 있다', !!msg, existsSync(join(root, src)) ? '함수 없음' : '파일 없음');
  if (msg) {
    check('1-1 쓰는 곳이 없으면 계획 문구 그대로', msg({ courses: 0, tasks: 0, attempts: 0 }) === BASE, msg({ courses: 0, tasks: 0, attempts: 0 }));
    check('1-2 사용 정보를 못 받으면(null) 계획 문구 그대로', msg(null) === BASE, msg(null));
    const both = msg({ courses: 3, tasks: 2, attempts: 9 });
    check('1-3 퀴즈 3개·할일 2개에서 쓰는 중이면 그 수를 덧붙인다', both === `${BASE} 퀴즈 3개·할일 2개에서 쓰는 중이에요.`, both);
    const onlyQuiz = msg({ courses: 1, tasks: 0, attempts: 0 });
    check('1-4 퀴즈만이면 퀴즈만', onlyQuiz === `${BASE} 퀴즈 1개에서 쓰는 중이에요.`, onlyQuiz);
    const onlyTask = msg({ courses: 0, tasks: 4, attempts: 0 });
    check('1-5 할일만이면 할일만', onlyTask === `${BASE} 할일 4개에서 쓰는 중이에요.`, onlyTask);
  }
}

// ── [2] 소스 계약 ──────────────────────────────────────────────────────────
console.log('\n[2] 소스 계약');
{
  const db = read('src/lib/db.ts');
  const fe = db.slice(db.indexOf('export async function fetchEntries'), db.indexOf('export async function fetchEntries') + 900);
  check("2-1 fetchEntries 가 보관된 행을 뺀다(.is('archived_at', null))", fe.includes(".is('archived_at', null)"));
  check('2-2 db.ts 가 archive_knowhow · knowhow_usage 를 부르고 보관함 읽기(archived_knowhow)는 없다',
    ["rpc('archive_knowhow'", "rpc('knowhow_usage'"].every((t) => db.includes(t)) && !db.includes("rpc('archived_knowhow'") && !/p_archived:\s*archived/.test(db));
  const edit = read('src/app/owner/edit/[id].tsx');
  check('2-3 수정 화면의 지우기 = 삭제 확인창 · 삭제 버튼 · "삭제했어요." 토스트',
    edit.includes('deleteConfirmMessage') && edit.includes("'노하우 삭제'") && edit.includes("'삭제'") && edit.includes('삭제했어요.') && !edit.includes("'보관'"));
  const store = read('src/lib/store/usePlaybookStore.ts');
  check('2-4 스토어에 archive 는 있고 restore · loadArchived 는 없다', store.includes('archive:') && !['restore:', 'loadArchived:'].some((t) => store.includes(t)));
  check('2-5 보관함 화면이 없다', !existsSync(join(root, 'src/app/owner/knowhow-archive.tsx')) && !read('src/app/owner/_layout.tsx').includes('knowhow-archive'));
  check('2-6 내 노하우·노하우 탭 머리에 보관함 진입이 없다',
    !read('src/app/owner/knowledge.tsx').includes('knowhow-archive') && !read('src/app/owner/categories.tsx').includes('knowhow-archive'));
  // 앱에 보이는 노하우 문구에 '보관' 낱말이 없다(주석 제외).
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const KW = ['src/app/owner/edit/[id].tsx', 'src/app/owner/knowledge.tsx', 'src/app/owner/categories.tsx', 'src/lib/store/usePlaybookStore.ts', 'src/lib/knowhow/archive.ts'];
  const word = KW.filter((p) => existsSync(join(root, p)) && strip(read(p)).includes('보관'));
  check("2-8 노하우 화면 코드·문구에 '보관'이 없다(주석 제외)", word.length === 0, word.join(', '));
  // 매장 삭제(store-config)는 다른 기능이다. 노하우를 지우는 화면·스토어만 본다.
  const KH = ['src/app/owner/edit/[id].tsx', 'src/components/coach/MiniSquareCard.tsx', 'src/lib/store/usePlaybookStore.ts', 'src/lib/knowhow/archive.ts'];
  const hard = KH.filter((p) => read(p).includes('완전히 삭제'));
  check("2-7 노하우 화면에 '완전히 삭제'가 없다", hard.length === 0, hard.join(', '));
}

// ── [3] DB(로컬) ───────────────────────────────────────────────────────────
console.log('\n[3] DB — 보관 경로(로컬 도커)');
function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
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
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
const phones = ['0261', '0262', '0263', '0264'].map((p) => `${p}${s.slice(0, 7)}`);
const TOKEN = `khatoken${s}abcdefghijkl`; // quiz_links_token_len(20자 이상)
const VEC = `[${Array.from({ length: 768 }, (_, i) => (i % 7 === 0 ? 0.05 : 0.01)).join(',')}]`;
const users = [];
let UNIT = null;
try {
  await seedVerifiedPhones(URL_, SRV, phones);
  const O = mk(), J = mk(), M = mk(), J2 = mk();
  const up = async (c, i, name, role) => {
    const r = await c.auth.signUp({
      email: `qa_kha_${i}_${s}@example.com`, password: pw,
      options: { data: { name, role, phone: phones[i], birth_date: role === 'owner' ? '1980-01-01' : '2000-01-01' } },
    });
    if (r.error) throw new Error(`${name} signUp: ${r.error.message}`);
    users.push({ c, id: r.data.user?.id });
    return r.data.user?.id;
  };
  const oId = await up(O, 0, 'QA보관사장', 'owner');
  const jId = await up(J, 1, 'QA보관직원', 'junior');
  const mId = await up(M, 2, 'QA보관매니저', 'junior');
  const j2Id = await up(J2, 3, 'QA보관신입', 'junior');

  const { data: st, error: e1 } = await O.rpc('create_store', { p_store_name: 'QA보관카페', p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(st) ? st[0] : st;
  if (e1 || !row?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  UNIT = row.unit_id;
  await O.rpc('switch_active_unit', { p_unit_id: UNIT });
  for (const [c, id] of [[J, jId], [M, mId]]) {
    await c.rpc('join_by_invite', { p_code: row.invite_code });
    const { error } = await O.rpc('approve_member', { p_uid: id });
    if (error) throw new Error('approve_member: ' + error.message);
    await c.rpc('switch_active_unit', { p_unit_id: UNIT });
  }
  { const { error } = await O.rpc('set_member_role', { p_uid: mId, p_role: 'manager' }); if (error) throw new Error('set_member_role: ' + error.message); }

  // ── 시드(service_role) ──
  const now = new Date().toISOString();
  const E = { e0: `kha_e0_${s}`, e1: `kha_e1_${s}`, e2: `kha_e2_${s}`, e3: `kha_e3_${s}`, e4: `kha_e4_${s}`, e5: `kha_e5_${s}` };
  const entry = (id, title, extra = {}) => ({
    id, unit_id: UNIT, creator_id: oId, creator_name: 'QA보관사장', category: 'operation', title,
    square: { situation: title }, status: 'published', created_at: now, updated_at: now, ...extra,
  });
  const seeds = [
    ['entries', admin.from('playbook_entries').insert([
      entry(E.e0, '옛 앱으로 지울 노하우'), entry(E.e1, '보관할 노하우'),
      entry(E.e2, '본사 사본', { brand_entry_id: `kha_src_${s}`, brand_version: 1 }),
      entry(E.e3, '초안', { status: 'draft' }), entry(E.e4, '매니저가 지우려는 노하우'), entry(E.e5, 'service_role 노하우'),
    ])],
    ['embeddings', admin.from('playbook_embeddings').insert([E.e1, E.e4].map((id) => ({ entry_id: id, unit_id: UNIT, embedding: VEC })))],
    ['courses', admin.from('training_courses').insert([
      { id: `kha_c0_${s}`, unit_id: UNIT, key: `kha_c0_${s}`, name: 'E0 퀴즈', min_items: 1, max_items: 10, position: 2, active: true },
      // 신입용 코스(first_day)인데 담긴 노하우가 E1 하나뿐 — E1 을 보관하면 신입 첫 퀴즈로 고르면 안 된다.
      { id: `kha_c1_${s}`, unit_id: UNIT, key: `kha_c1_${s}`, name: 'E1 퀴즈', preset: 'first_day', min_items: 1, max_items: 10, position: 0, active: true },
      { id: `kha_c4_${s}`, unit_id: UNIT, key: `kha_c4_${s}`, name: 'E4 퀴즈', min_items: 1, max_items: 10, position: 1, active: true },
    ])],
    ['course_entries', admin.from('course_entries').insert([
      { course_id: `kha_c0_${s}`, entry_id: E.e0, unit_id: UNIT },
      { course_id: `kha_c1_${s}`, entry_id: E.e1, unit_id: UNIT },
      { course_id: `kha_c4_${s}`, entry_id: E.e4, unit_id: UNIT },
    ])],
    ['quiz_items', admin.from('quiz_items').insert([E.e0, E.e1, E.e4].map((id) => ({
      id: `kha_q_${id}`, unit_id: UNIT, entry_ids: [id], kind: 't3', format: 'mc4', status: 'active', source: 'owner',
      payload: { ask: '마감 때 무엇을 잠그나요?', choices: ['가스 밸브', '창문', '냉장고'], answer_index: 0, explain: '가스 밸브' },
      created_by: oId, created_at: now, source_updated_at: now,
    })))],
    ['quiz_attempts', admin.from('quiz_attempts').insert([E.e0, E.e1].map((id) => ({ unit_id: UNIT, entry_id: id, staff_id: jId, total: 3, correct: 3 })))],
    ['understanding', admin.from('knowhow_understanding').insert([E.e0, E.e1].map((id) => ({ unit_id: UNIT, entry_id: id, staff_id: jId, staff_name: 'QA보관직원' })))],
    ['work_templates', admin.from('work_templates').insert({ id: `kha_t1_${s}`, unit_id: UNIT, section: 'open', text: '오픈 점검' })],
    ['work_template_knowhow', admin.from('work_template_knowhow').insert({ unit_id: UNIT, template_id: `kha_t1_${s}`, entry_id: E.e1 })],
    ['quiz_links', admin.from('quiz_links').insert({ id: `kha_l1_${s}`, course_id: `kha_c1_${s}`, unit_id: UNIT, token: TOKEN,
      expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null, created_at: now, created_by: oId })],
  ];
  for (const [label, q] of seeds) { const { error } = await q; if (error) throw new Error(`${label} 시드: ${error.message}`); }
  console.log(`셋업 — 매장 ${UNIT} · 사장 · 직원 J · 매니저 M · 노하우 6건 · 퀴즈 3개 · 응시 2건`);

  const cnt = async (t, col, v) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
  const rowOf = async (id) => (await admin.from('playbook_entries').select('*').eq('id', id).maybeSingle()).data;
  const ids = (r) => (r.data ?? []).map((x) => x.id);
  const overview = async () => (await O.rpc('owner_overview')).data?.find((x) => x.unit_id === UNIT)?.knowhow;
  const stats = async () => (await O.rpc('owner_knowhow_stats')).data?.find((x) => x.unit_id === UNIT)?.entries;
  const growth = async () => (await J.rpc('my_growth')).data?.find((x) => x.unit_id === UNIT)?.entries_total;

  // ═══ A. 옛 앱 DELETE ═══
  console.log('\n[3-A] 옛 앱 DELETE(사장이 직접 지움) = 보관');
  {
    const before = await cnt('quiz_attempts', 'entry_id', E.e0);
    const del = await O.from('playbook_entries').delete().eq('id', E.e0).select('id');
    const after = await cnt('quiz_attempts', 'entry_id', E.e0);
    console.log(`    기준선: 지금 경로로 지우기 전 응시 기록 ${before}건 → 지운 뒤 ${after}건`);
    check('A-1 옛 앱 DELETE 는 오류가 나지 않는다', !del.error, del.error?.message ?? '');
    const r = await rowOf(E.e0);
    check('A-2 ★행이 남고 archived_at 이 찼다(지우지 않고 보관)', !!r && !!r.archived_at, r ? `archived_at=${r.archived_at}` : '행이 지워졌다');
    check('A-3 ★응시 기록(quiz_attempts) 수가 같다', after === before && before === 1, `before=${before} after=${after}`);
    check('A-4 ★통과 기록 · 코스 구성 · 문항이 남는다',
      (await cnt('knowhow_understanding', 'entry_id', E.e0)) === 1 && (await cnt('course_entries', 'entry_id', E.e0)) === 1
      && (await cnt('quiz_items', 'id', `kha_q_${E.e0}`)) === 1);
    check('A-5 archived_by = 지운 사장', r?.archived_by === oId, `archived_by=${r?.archived_by}`);
  }

  // ═══ B. 보관(새 앱 RPC) ═══
  console.log('\n[3-B] 보관 archive_knowhow — 직원·검색·퀴즈·개요에서 빠진다');
  {
    // 보관 전 기준(같은 실행 안에서 비교한다)
    const jSee0 = ids(await J.from('playbook_entries').select('id').eq('id', E.e1));
    const mp0 = ids(await J.rpc('match_playbook', { query_embedding: VEC, p_unit_id: UNIT, match_count: 8 }));
    const qi0 = ids(await J.rpc('quiz_items_for', { p_entry_ids: [E.e1], p_limit: 3 }));
    check('B-0 보관 전에는 직원에게 보인다(select · match_playbook · quiz_items_for)', jSee0.length === 1 && mp0.includes(E.e1) && qi0.length === 1,
      `select=${jSee0.length} match=${mp0.includes(E.e1)} quiz=${qi0.length}`);
    const k0 = await overview(), s0 = await stats(), g0 = await growth();

    const u = await O.rpc('knowhow_usage', { p_entry_id: E.e1 });
    check('B-1 knowhow_usage = 퀴즈 1 · 할일 1 · 응시 1', !u.error && u.data?.courses === 1 && u.data?.tasks === 1 && u.data?.attempts === 1,
      u.error?.message ?? JSON.stringify(u.data));
    const a = await O.rpc('archive_knowhow', { p_entry_id: E.e1, p_archived: true });
    check('B-2 사장이 보관한다', !a.error, a.error?.message ?? '');
    check('B-3 ★보관 뒤 응시 기록 수가 같다', (await cnt('quiz_attempts', 'entry_id', E.e1)) === 1);
    check('B-4 ★직원 select 0행', ids(await J.from('playbook_entries').select('id').eq('id', E.e1)).length === 0);
    check('B-5 매니저 select 0행', ids(await M.from('playbook_entries').select('id').eq('id', E.e1)).length === 0);
    check('B-6 사장의 일반 목록(select)에서도 빠진다', ids(await O.from('playbook_entries').select('id').eq('id', E.e1)).length === 0);
    const ar = await O.rpc('archived_knowhow');
    check('B-7 ★보관함 읽기 RPC(archived_knowhow)가 없다 — 사장도 지운 노하우를 못 본다', !!ar.error, ar.error?.message ?? JSON.stringify(ids(ar)));
    const mpJ = ids(await J.rpc('match_playbook', { query_embedding: VEC, p_unit_id: UNIT, match_count: 8 }));
    const mpO = ids(await O.rpc('match_playbook', { query_embedding: VEC, p_unit_id: UNIT, match_count: 8 }));
    check('B-9 ★match_playbook(직원 · 사장)에서 빠진다', !mpJ.includes(E.e1) && !mpO.includes(E.e1) && mpJ.includes(E.e4), `J=${mpJ} O=${mpO}`);
    check('B-10 ★quiz_items_for 에서 빠진다', ids(await J.rpc('quiz_items_for', { p_entry_ids: [E.e1, E.e4], p_limit: 5 })).join() === `kha_q_${E.e4}`);
    const qc = (await O.rpc('quiz_item_counts')).data ?? [];
    check('B-11 quiz_item_counts 에서 빠진다', !qc.some((x) => x.entry_id === E.e1) && qc.some((x) => x.entry_id === E.e4), JSON.stringify(qc));
    const guest = mk();
    const li = await guest.rpc('quiz_link_items', { p_token: TOKEN });
    check('B-12 게스트 링크 문항에서 빠진다', (li.data ?? []).length === 0, `rows=${(li.data ?? []).length}`);
    const lo = await guest.rpc('quiz_link_open', { p_token: TOKEN });
    const loRow = Array.isArray(lo.data) ? lo.data[0] : lo.data;
    check('B-13 노하우가 전부 보관된 퀴즈의 링크는 닫힌다', loRow?.ok === false, JSON.stringify(loRow));
    const k1 = await overview(), s1 = await stats(), g1 = await growth();
    check('B-14 사장 개요(owner_overview.knowhow)에서 하나 준다', k1 === k0 - 1, `before=${k0} after=${k1}`);
    check('B-15 이해도 지표(owner_knowhow_stats.entries)에서 하나 준다', s1 === s0 - 1, `before=${s0} after=${s1}`);
    check('B-16 직원 성장 분모(my_growth.entries_total)에서 하나 준다', g1 === g0 - 1, `before=${g0} after=${g1}`);
    const lk = await O.rpc('list_unit_knowhow', { p_from_unit: UNIT });
    check('B-17 복사할 노하우 목록(list_unit_knowhow)에서 빠진다', !lk.error && !ids(lk).includes(E.e1) && ids(lk).includes(E.e4), lk.error?.message ?? '');
    const at0 = (await rowOf(E.e1))?.archived_at;
    const again = await O.rpc('archive_knowhow', { p_entry_id: E.e1, p_archived: true });
    const at1 = (await rowOf(E.e1))?.archived_at;
    check('B-18 다시 보관해도 오류 없이 보관 시각을 유지한다', !again.error && !!at0 && at1 === at0, again.error?.message ?? `${at0} → ${at1}`);
  }

  // ═══ C. 신입 첫 퀴즈 ═══
  console.log('\n[3-C] approve_member — 노하우가 전부 보관된 코스를 첫 퀴즈로 고르지 않는다');
  {
    await J2.rpc('join_by_invite', { p_code: row.invite_code });
    const { error } = await O.rpc('approve_member', { p_uid: j2Id });
    check('C-1 승인 성공', !error, error?.message ?? '');
    const qa = (await admin.from('quiz_assignments').select('course_id').eq('unit_id', UNIT).eq('user_id', j2Id)).data ?? [];
    check('C-2 ★첫 퀴즈 = 보관 안 된 코스(E0 퀴즈 또는 E4 퀴즈 중 position 순 = E4)', qa.length === 1 && qa[0].course_id === `kha_c4_${s}`, JSON.stringify(qa));
  }

  // ═══ D. 매니저 ═══
  console.log('\n[3-D] 매니저는 보관 · 되살리기 · 지우기를 못 한다');
  {
    const a = await M.rpc('archive_knowhow', { p_entry_id: E.e4, p_archived: true });
    check('D-1 매니저 archive_knowhow 거부(not_owner)', /not_owner/.test(a.error?.message ?? ''), a.error?.message ?? 'ok');
    const u = await M.from('playbook_entries').update({ archived_at: new Date().toISOString() }).eq('id', E.e4).select('id');
    check('D-2 매니저 직접 UPDATE archived_at 거부(오류 또는 0행)', !!u.error || (u.data ?? []).length === 0, JSON.stringify(u.data));
    const d = await M.from('playbook_entries').delete().eq('id', E.e4).select('id');
    const r = await rowOf(E.e4);
    check('D-3 ★매니저 직접 DELETE 는 지우지도 보관하지도 못한다', !!r && !r.archived_at, `error=${d.error?.message ?? '-'} row=${r ? `archived_at=${r.archived_at}` : '지워짐'}`);
    const rs = await M.rpc('archive_knowhow', { p_entry_id: E.e0, p_archived: false });
    check('D-4 매니저 되살리기 거부', !!rs.error, rs.error?.message ?? 'ok');
    const uu = await J.rpc('knowhow_usage', { p_entry_id: E.e4 });
    check('D-5 직원 knowhow_usage 거부', !!uu.error, JSON.stringify(uu.data));
  }

  // ═══ E. 본사 사본 · service_role ═══
  console.log('\n[3-E] 본사 사본은 보관하지 않는다 · service_role 은 예외');
  {
    const a = await O.rpc('archive_knowhow', { p_entry_id: E.e2, p_archived: true });
    check('E-1 ★본사 사본 보관 거부(brand_copy_use_hide)', /brand_copy_use_hide/.test(a.error?.message ?? ''), a.error?.message ?? 'ok');
    check('E-2 본사 사본은 그대로', !(await rowOf(E.e2))?.archived_at);
    const sr = await admin.from('playbook_entries').update({ archived_at: new Date().toISOString() }).eq('id', E.e5).select('id, archived_at');
    check('E-3 service_role 은 archived_at 을 바꿀 수 있다(가드 예외)', !sr.error && !!sr.data?.[0]?.archived_at, sr.error?.message ?? JSON.stringify(sr.data));
    const sd = await admin.from('playbook_entries').delete().eq('id', E.e5).select('id');
    check('E-4 service_role DELETE 는 그대로 지운다(정리·파기 경로)', !sd.error && !(await rowOf(E.e5)), sd.error?.message ?? '');
    const dd = await O.from('playbook_entries').delete().eq('id', E.e3).select('id');
    check('E-5 초안 삭제는 그대로 지운다(인수인계 되돌리기)', !dd.error && !(await rowOf(E.e3)), dd.error?.message ?? '');
  }

  // ═══ F. 되살릴 수 없다(2026-10-05 J10 정정) ═══
  console.log('\n[3-F] 되살릴 수 없다');
  {
    const r = await O.rpc('archive_knowhow', { p_entry_id: E.e1, p_archived: false });
    check('F-1 ★사장도 되살리지 못한다(restore_not_allowed)', /restore_not_allowed/.test(r.error?.message ?? ''), r.error?.message ?? 'ok');
    const u = await O.from('playbook_entries').update({ archived_at: null }).eq('id', E.e1).select('id');
    check('F-2 사장 직접 UPDATE 로도 되살리지 못한다(오류 또는 0행)', !!u.error || (u.data ?? []).length === 0, JSON.stringify(u.data));
    const row1 = await rowOf(E.e1);
    check('F-3 ★지운 노하우는 그대로 · 응시 기록은 남는다', !!row1?.archived_at && (await cnt('quiz_attempts', 'entry_id', E.e1)) === 1, JSON.stringify({ a: row1?.archived_at }));
    check('F-4 사장 select 0행', ids(await O.from('playbook_entries').select('id').eq('id', E.e1)).length === 0);
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  if (UNIT) { try { await admin.from('units').delete().eq('id', UNIT); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
